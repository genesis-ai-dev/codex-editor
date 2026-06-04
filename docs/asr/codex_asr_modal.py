"""
codex-asr — Modal deployment for the Codex Translation Editor's ASR backend.

This is the **source of truth** for the deployed Modal app at
`https://genesis-ai-dev--codex-asr-serve.modal.run`.

Model: Meta Omnilingual ASR (`omniASR_LLM_1B_v2`). 1600+ languages.
Native-script output, optional language conditioning.

Naming
~~~~~~
The Modal app is named `codex-asr` (model-agnostic) rather than
`mms-zeroshot-asr` (the old name, when the upstream was MMS Zero-Shot).
This is so the URL stays stable when we change models. Do NOT rename
again casually — every consumer (Codex client default endpoint,
Frontier auth proxy upstream URL, docs, snapshot regen instructions)
hard-codes `codex-asr`.

Migration plan (if `codex-asr` ever needs to change):
  1. Deploy the new name first, keep `codex-asr` running.
  2. Update the Frontier auth proxy's upstream URL.
  3. Update the client's default endpoint in `package.json`
     (`codex-editor-extension.asrEndpoint`) and any docs.
  4. Decommission `codex-asr` after a release cycle.

The old `mms-zeroshot-asr` deployment is kept warm for backward
compatibility during the transition. Both serve identical responses.

Auto-detect language ID
~~~~~~~~~~~~~~~~~~~~~~~
OmniASR LLM models don't have built-in LID — without a `lang`
parameter they generate without conditioning and the response has no
"detected language" field. Adding a separate LID model (e.g.
`facebook/mms-lid-2048`) is a planned follow-up. For now, auto-detect
mode returns no `lang` and the client renders an honest "Auto Detect"
badge.

Deploy / Dev
~~~~~~~~~~~~
  modal deploy docs/asr/codex_asr_modal.py
  modal serve  docs/asr/codex_asr_modal.py   # local dev

Test
~~~~
  curl -X POST -F "file=@audio.wav" \\
    https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe

  curl -X POST -F "file=@audio.wav" \\
    "https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe?lang=urd_Arab"

Endpoints
~~~~~~~~~
  GET  /            — service identity
  GET  /health      — readiness probe
  GET  /languages   — full list of supported {iso639_3}_{Script} codes
                      (used by the client snapshot in sharedUtils/)
  POST /transcribe  — transcription endpoint
"""

import modal

# Renamed from "mms-zeroshot-asr" to be model-agnostic. See module docstring
# for migration notes.
app = modal.App("codex-asr")

MODEL_CARD = "omniASR_LLM_1B_v2"
MODEL_CACHE_DIR = "/root/model_cache"


def download_model():
    """Download model weights during image build (runs with GPU so fairseq2 can verify)."""
    import os
    os.environ["FAIRSEQ2_CACHE_DIR"] = MODEL_CACHE_DIR

    from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline

    print(f"Downloading and verifying {MODEL_CARD}...")
    pipeline = ASRInferencePipeline(model_card=MODEL_CARD)
    print("Model downloaded and verified OK")
    del pipeline


# Build the image with model weights baked in.
# The run_function step uses a T4 GPU so fairseq2 can fully verify the
# checkpoint. This only runs once — the resulting image is cached by Modal.
#
# Versions / CUDA notes:
#  - omnilingual-asr 0.2.0 is the first release that ships the
#    `omniASR_LLM_1B_v2` model card; 0.1.0 only has `omniASR_LLM_1B`.
#  - omnilingual-asr -> fairseq2[arrow]<=0.6 -> fairseq2n which pins
#    `torch==2.8.0` built specifically against CUDA 12.8 (it asserts this at
#    import time). Newer torch wheels are CUDA 13 and fail to load on Modal's
#    `debian_slim` (libcudart.so.13 missing).
#  - We install everything in one pip call so the resolver lands on the
#    cu128 wheel of torch 2.8.0.
image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("ffmpeg", "libsndfile1")
    .pip_install(
        "torch==2.8.0",
        "torchaudio==2.8.0",
        "omnilingual-asr==0.2.0",
        "fastapi",
        "uvicorn",
        "python-multipart",
        "soundfile",
        "numpy",
        extra_index_url="https://download.pytorch.org/whl/cu128",
    )
    .env({"FAIRSEQ2_CACHE_DIR": MODEL_CACHE_DIR})
    .run_function(download_model, gpu="T4")
)

_pipeline = None


def _ensure_gang_context() -> None:
    """
    Initialise fairseq2's thread-local gang stack on the current thread.

    fairseq2 0.6 stores the "current gangs" stack on a `threading.local()`,
    but only initialises the underlying `current_gangs = []` attribute on
    the importing thread. FastAPI dispatches sync request handlers on
    worker threads where the attribute is missing, causing inference to
    fail with::

        AttributeError: '_thread._local' object has no attribute 'current_gangs'

    Cheap to call per-request — just sets a list on the thread-local if
    it isn't already there.
    """
    try:
        from fairseq2.gang import _thread_local  # type: ignore[attr-defined]
        if not hasattr(_thread_local, "current_gangs"):
            _thread_local.current_gangs = []
    except Exception:  # pragma: no cover — defensive only
        pass


def get_pipeline():
    """Load the ASR pipeline from baked-in weights (no download needed)."""
    global _pipeline
    if _pipeline is None:
        import os
        os.environ["FAIRSEQ2_CACHE_DIR"] = MODEL_CACHE_DIR

        from omnilingual_asr.models.inference.pipeline import ASRInferencePipeline

        print(f"Loading {MODEL_CARD} from image cache...")
        _ensure_gang_context()
        _pipeline = ASRInferencePipeline(model_card=MODEL_CARD)
        print("Pipeline ready")
    return _pipeline


def transcribe_audio(audio_bytes: bytes, mime_type: str = "audio/wav", lang: str | None = None) -> dict:
    """
    Transcribe audio bytes → text using OmniASR LLM 1B v2.

    Args:
        audio_bytes: Raw audio file bytes.
        mime_type: MIME type for format detection.
        lang: Optional OmniASR language code (e.g. "eng_Latn", "urd_Arab").
              If None, the model runs without language conditioning. The model
              does NOT do internal LID, so the response will not contain a
              `lang` field when this is None.

    Returns:
        dict with text, duration_s, inference_s, and lang (only when one was provided).
    """
    import soundfile as sf
    import numpy as np
    import tempfile
    import subprocess
    import os
    import time

    pipeline = get_pipeline()
    _ensure_gang_context()

    # --- Convert to 16kHz mono WAV via ffmpeg ---
    ext_map = {
        "audio/wav": ".wav", "audio/x-wav": ".wav",
        "audio/mpeg": ".mp3", "audio/mp3": ".mp3",
        "audio/webm": ".webm", "audio/ogg": ".ogg",
        "audio/flac": ".flac", "audio/mp4": ".m4a",
    }
    ext = ext_map.get(mime_type, ".wav")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as f:
        f.write(audio_bytes)
        input_path = f.name

    output_path = input_path.rsplit(".", 1)[0] + "_16k.wav"
    try:
        result = subprocess.run(
            ["ffmpeg", "-y", "-i", input_path,
             "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
             output_path],
            capture_output=True, text=True, timeout=60,
        )
        if result.returncode != 0:
            raise RuntimeError(f"ffmpeg failed: {(result.stderr or '')[:500]}")

        waveform, sr = sf.read(output_path)
        waveform = waveform.astype(np.float32)
        if waveform.ndim > 1:
            waveform = waveform.mean(axis=-1)
        duration = len(waveform) / sr

        # --- Chunk if > 40s (model limitation) ---
        max_samples = 40 * sr  # 40 seconds
        if len(waveform) > max_samples:
            chunks = []
            for start in range(0, len(waveform), max_samples):
                chunks.append(waveform[start : start + max_samples])
        else:
            chunks = [waveform]

        # Build audio dicts for the pipeline
        audio_inputs = [
            {"waveform": chunk, "sample_rate": sr}
            for chunk in chunks
        ]

        # Build lang list to match (one per chunk), or None
        lang_list = [lang] * len(audio_inputs) if lang else None

        # --- Transcribe ---
        start_t = time.perf_counter()
        transcriptions = pipeline.transcribe(
            audio_inputs,
            lang=lang_list,
            batch_size=1,
        )
        inference_time = time.perf_counter() - start_t

        # Join chunks with space
        full_text = " ".join(t.strip() for t in transcriptions if t.strip())

        resp = {
            "text": full_text,
            "duration_s": round(duration, 2),
            "inference_s": round(inference_time, 3),
        }
        # Echo the lang we used so the client can render the badge. In auto-detect
        # mode (lang is None) we have no detected language to report — omit the
        # field and let the client render "Auto Detect" honestly.
        if lang:
            resp["lang"] = lang

        return resp

    finally:
        os.unlink(input_path)
        if os.path.exists(output_path):
            os.unlink(output_path)


# ---------- Modal function ----------

@app.function(
    image=image,
    gpu="T4",
    timeout=600,
    scaledown_window=120,     # keep warm 2 min after last request
    max_containers=3,
)
@modal.asgi_app()
def serve():
    from fastapi import FastAPI, UploadFile, File, Query, HTTPException
    from fastapi.middleware.cors import CORSMiddleware

    web_app = FastAPI(title="Codex ASR (OmniASR LLM 1B v2)")
    web_app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @web_app.get("/")
    def root():
        return {
            "service": "codex-asr",
            "model": MODEL_CARD,
            "languages": "1600+",
            "note": "Pass ?lang={iso639_3}_{Script} (e.g. eng_Latn) for best accuracy. Omit for autodetect (no LID, lower accuracy).",
        }

    @web_app.get("/health")
    def health():
        return {"status": "ok", "model_loaded": _pipeline is not None}

    @web_app.get("/languages")
    def list_languages():
        """Return all supported language codes."""
        from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs
        return {"count": len(supported_langs), "languages": sorted(supported_langs)}

    @web_app.post("/transcribe")
    async def transcribe_endpoint(
        file: UploadFile = File(...),
        lang: str | None = Query(
            default=None,
            description="OmniASR language code in {iso639_3}_{Script} form, e.g. eng_Latn, urd_Arab, spa_Latn. Omit to let the model transcribe without language conditioning.",
        ),
    ):
        # Validate language code if provided
        if lang is not None:
            from omnilingual_asr.models.wav2vec2_llama.lang_ids import supported_langs
            if lang not in supported_langs:
                raise HTTPException(
                    400,
                    f"Unknown language code: '{lang}'. "
                    f"Use GET /languages for the full list. "
                    f"Format: {{iso639_3}}_{{Script}}, e.g. eng_Latn",
                )

        try:
            audio_bytes = await file.read()
            if len(audio_bytes) > 50 * 1024 * 1024:
                raise HTTPException(413, "File too large (50MB max)")
            if len(audio_bytes) == 0:
                raise HTTPException(400, "Empty file")

            mime = file.content_type or "audio/wav"
            return transcribe_audio(audio_bytes, mime, lang=lang)

        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(500, f"Transcription failed: {str(e)}")

    # Model loads lazily on first /transcribe request via get_pipeline().
    # Weights are baked into the image so loading takes ~15-20s (no download).
    return web_app
