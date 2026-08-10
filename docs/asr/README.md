# Codex ASR deployment

Modal source for the ASR backend used by the Codex Translation Editor.

| File | What it is |
|------|------------|
| [`codex_asr_modal.py`](./codex_asr_modal.py) | The Modal app source. Deploy with `modal deploy`. |

## Live URLs

- **Current (post-rename)**: `https://genesis-ai-dev--codex-asr-serve.modal.run`
- **Legacy (kept warm during migration)**: `https://genesis-ai-dev--mms-zeroshot-asr-serve.modal.run`

The legacy URL serves the same workload — the app was renamed from
`mms-zeroshot-asr` to `codex-asr` so the URL no longer encodes the
model family. Both deployments will be active during the rollout; the
legacy one is decommissioned after the Frontier auth proxy and any
hard-coded client defaults are updated to the new URL.

## Deploying

You need `modal` CLI installed (`pipx install modal`) and authenticated
(`modal token new`) with access to the `genesis-ai-dev` workspace.

```bash
cd <repo-root>
modal deploy docs/asr/codex_asr_modal.py
```

For local development against your own Modal workspace:

```bash
modal serve docs/asr/codex_asr_modal.py
```

## Sanity-checking after deploy

```bash
# Service identity
curl -s https://genesis-ai-dev--codex-asr-serve.modal.run/

# Full supported-langs list (used to regenerate the client snapshot)
curl -s https://genesis-ai-dev--codex-asr-serve.modal.run/languages | jq '.count'

# Transcribe with language hint
curl -X POST -F "file=@some_audio.wav" \
  "https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe?lang=eng_Latn"

# Transcribe in auto-detect mode (no `lang` field in response)
curl -X POST -F "file=@some_audio.wav" \
  https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe
```

## Wire spec

See [`../asr-proxy-endpoint.md`](../asr-proxy-endpoint.md) for the full
HTTP POST contract the Codex client expects (this Modal app implements
it; the Frontier auth proxy sits in front and adds JWT validation).

## Open follow-ups

- **Server-side LID for auto-detect mode.** OmniASR LLM doesn't return a
  detected language when run without `lang` conditioning. The plan is to
  bake `facebook/mms-lid-2048` into the image and run it before
  transcription when the client omits `lang`, then pass the detected
  code through as the conditioning input and echo it back. ~+1 GB VRAM,
  ~+1–2 s latency, makes the badge honest in auto-detect mode. Deferred
  to a follow-up PR; the client is already prepared to consume the
  field if/when it appears.
