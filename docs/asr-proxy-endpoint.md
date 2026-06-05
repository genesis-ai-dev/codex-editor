# ASR HTTP POST Endpoint Specification

This document describes the HTTP POST protocol the Codex Editor expects from
an ASR (Automatic Speech Recognition) endpoint. The reference upstream is
**Meta Omnilingual ASR** (`omniASR_LLM_1B_v2`), served on Modal as
`genesis-ai-dev--codex-asr-serve.modal.run` (renamed from the
historical `mms-zeroshot-asr` deployment).

The Frontier auth server runs a thin **proxy** in front of that Modal
endpoint, adds JWT validation, and is what the Codex client actually talks to
in production. This spec covers the proxy's wire contract; the proxy in turn
forwards to OmniASR.

## Overview

The client uses a simple multipart HTTP POST to the proxy URL. No
WebSockets, no streaming progress messages. One request → one transcription.

## Authentication

The client passes a Frontier JWT via either:
1. **Authorization header**: `Authorization: Bearer <token>`
2. **Query parameter**: `?token=<token>&source=codex`

The server should:
1. Validate the JWT before processing.
2. Reject invalid/missing tokens with HTTP 401.
3. Forward the audio (and the optional `lang` query parameter, if present)
   to the upstream OmniASR service.
4. Return the upstream's JSON response.

## Request Protocol

### Endpoint

```
POST /api/v1/asr/transcribe
```

### Headers

```
Content-Type: multipart/form-data
Authorization: Bearer <token>  (optional if token in query)
```

### Query Parameters

- `source` (required): `"codex"` or `"langquest"` — for logging.
- `token` (optional): JWT, if not in the Authorization header.
- `lang` (**optional**): OmniASR language code in
  `{iso639_3}_{Script}` form (e.g. `swh_Latn`, `urd_Arab`, `cmn_Hans`).
  Forward this directly to OmniASR. **Omit** it to engage the upstream's
  built-in language ID — `codex-asr` runs MMS-LID first and feeds the
  detected code into OmniASR (the resolved code is then included in the
  response). The full list of accepted codes is bundled with the client
  in `sharedUtils/omniAsrSupportedLangs.ts` (and is the live response of
  OmniASR's `GET /languages`).

### Request Body

**Content-Type**: `multipart/form-data`

**Form Fields**:
- `file`: Audio file (WAV, MP3, OGG, FLAC, WebM, M4A — max 50 MB,
  max 40 s per chunk; OmniASR chunks longer audio internally)

### Example Requests

```bash
# Auto-detect (no lang)
curl -X POST "https://auth.frontier.example/api/v1/asr/transcribe?source=codex&token=JWT_TOKEN" \
  -F "file=@audio.wav"

# Project-language mode (Swahili, Latin script)
curl -X POST "https://auth.frontier.example/api/v1/asr/transcribe?source=codex&token=JWT_TOKEN&lang=swh_Latn" \
  -F "file=@audio.wav"
```

## Response Protocol

### Success Response (200 OK)

```json
{
  "text": "This is the transcribed text",
  "duration_s": 4.94,
  "inference_s": 1.72,
  "lang": "swh_Latn"
}
```

The `lang` field reflects what was **actually used** for transcription:
- Request supplied `lang` → echoed verbatim.
- Request omitted `lang` → upstream ran MMS-LID and the resolved
  `{iso639_3}_{Script}` code is returned here. If LID failed (silence,
  unrecognised language, …) the field is omitted and the response also
  includes `lid_s` so callers can tell auto-detect actually ran. The
  client renders an "Auto Detect" badge in that case.

Auto-detect responses include an additional `"lid_s": <float>` field
with the LID inference time (useful for monitoring).

The client also accepts a legacy field name `language` in place of `lang`
(this was the Frontier proxy's earlier convention) — either works. Prefer
`lang` going forward.

### Error Response (4xx/5xx)

```json
{
  "detail": "Error description"
}
```

**Common Error Codes**:
- `400`: Bad request (missing source, invalid audio, unknown `lang` code)
- `401`: Unauthorized (invalid or missing token)
- `502`: Bad gateway (upstream OmniASR unavailable)
- `504`: Gateway timeout (upstream timeout)

## Example Implementation (Python/FastAPI)

```python
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Header
from fastapi.responses import JSONResponse
import httpx
import jwt
from typing import Optional

app = FastAPI()

# Configuration (post-rename; the old URL was
# https://genesis-ai-dev--mms-zeroshot-asr-serve.modal.run/transcribe)
ASR_SERVICE_URL = "https://genesis-ai-dev--codex-asr-serve.modal.run/transcribe"
JWT_SECRET = "your-jwt-secret"

def validate_token(token: str) -> dict:
    try:
        return jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/v1/asr/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    source: str = Query(...),
    lang: Optional[str] = Query(None),  # OmniASR {iso639_3}_{Script}
):
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization[7:]
    elif token:
        auth_token = token
    if not auth_token:
        raise HTTPException(status_code=401, detail="Token required")
    validate_token(auth_token)

    audio_content = await file.read()

    async with httpx.AsyncClient(timeout=60.0) as client:
        files = {"file": (file.filename, audio_content, file.content_type)}
        params = {}
        if lang:
            params["lang"] = lang
        response = await client.post(ASR_SERVICE_URL, files=files, params=params)

        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Transcription service error: {response.text}",
            )

        # Pass OmniASR's response through verbatim (it already echoes `lang`
        # when present, and omits it in auto-detect mode).
        return JSONResponse(content=response.json())
```

## Client Implementation Reference

- **Client**: `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`
- **Code resolver** (project language → `{iso639_3}_{Script}`):
  `sharedUtils/asrLanguageUtils.ts`
- **Supported codes**: `sharedUtils/omniAsrSupportedLangs.ts`
- **Default scripts**: `sharedUtils/omniAsrDefaultScripts.ts`
- **Friendly names**: `sharedUtils/omniAsrFriendlyNames.ts`

### Key Client Behaviour

1. Requests ASR config (endpoint + auth token + resolved OmniASR code) from the extension host.
2. POSTs `multipart/form-data` with the audio file; forwards `?lang=...` when in project mode.
3. Parses `lang` (or legacy `language`) from the JSON response and stores it
   on the cell's audio attachment.
4. Renders the badge from the stored code via
   `labelForTranscriptionLanguage()`.

## Testing Your Implementation

1. **Project-mode request**: `?lang=swh_Latn` → expect 200 with
   `"lang": "swh_Latn"` in response.
2. **Auto-detect**: no `lang` → expect 200, **no** `lang` in response.
3. **Unknown code**: `?lang=zzz_Zzzz` → expect 400 with descriptive error.
4. **Invalid token**: 401.
5. **Large audio (≤ 50 MB)**: 200.
6. **Long audio (> 40 s)**: OmniASR chunks it; expect 200 with full
   concatenated transcription.
7. **Network error / upstream down**: 502/504 surfaced honestly.

## Supported Audio Formats

- `audio/webm` (recommended for browser recording)
- `audio/wav`
- `audio/mp3`
- `audio/m4a`
- `audio/ogg`
- `audio/flac`

## Security Considerations

1. **Token validation**: validate JWT before processing.
2. **Rate limiting**: per-user limits to prevent abuse.
3. **File size limits**: 50 MB.
4. **Timeout**: server-side timeouts to prevent hanging requests (60 s recommended).
5. **Logging**: log usage for monitoring but respect privacy.
6. **HTTPS**: always.

## Integration with Frontier Auth Server

The Frontier auth server should:

1. Implement `getAsrEndpoint()` returning the proxy HTTPS URL.
2. Generate short-lived JWTs for ASR requests.
3. Include user identification in tokens for logging.
4. Handle token refresh for long transcriptions if needed.

This follows the same pattern as the existing `getLlmEndpoint()`.
