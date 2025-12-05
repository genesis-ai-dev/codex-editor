# ASR HTTP POST Endpoint Specification

This document describes the HTTP POST protocol for implementing an ASR (Automatic Speech Recognition) transcription endpoint compatible with the Codex Editor.

## Overview

The Codex Editor uses a simple HTTP POST request for audio transcription. This allows for straightforward integration without WebSocket complexity.

## Authentication

The client passes authentication via a JWT token as either:
1. **Authorization header**: `Authorization: Bearer <token>`
2. **Query parameter**: `?token=<token>&source=codex`

The server should:
1. Validate the JWT token before processing the request
2. Reject requests with invalid or missing tokens (401)
3. Establish a connection to the actual ASR service (e.g., Modal endpoint)
4. Forward the audio file and return the transcription result

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

- `source` (required): `"codex"` or `"langquest"`
- `token` (optional): JWT token if not in Authorization header

### Request Body

**Content-Type**: `multipart/form-data`

**Form Fields**:
- `file`: Audio file (WAV, MP3, OGG, FLAC, WebM - max 50MB)

### Example Request

```bash
curl -X POST "http://localhost:8000/api/v1/asr/transcribe?source=codex&token=JWT_TOKEN" \
  -F "file=@audio.wav"
```

## Response Protocol

### Success Response (200 OK)

```json
{
  "text": "This is the transcribed text",
  "duration_s": 4.94,
  "inference_s": 1.72
}
```

### Error Response (4xx/5xx)

```json
{
  "detail": "Error description"
}
```

**Common Error Codes**:
- `400`: Bad Request (missing source parameter, invalid audio format)
- `401`: Unauthorized (invalid or missing token)
- `502`: Bad Gateway (upstream service unavailable)
- `504`: Gateway Timeout (upstream service timeout)

## Example Implementation (Python/FastAPI)

Here's a basic example of implementing the ASR proxy endpoint:

```python
from fastapi import FastAPI, UploadFile, File, HTTPException, Query, Header
from fastapi.responses import JSONResponse
import httpx
import jwt

app = FastAPI()

# Configuration
ASR_SERVICE_URL = "https://genesis-ai-dev--mms-zeroshot-asr-serve.modal.run/transcribe"
JWT_SECRET = "your-jwt-secret"

def validate_token(token: str) -> dict:
    """Validate JWT token and return payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.post("/api/v1/asr/transcribe")
async def transcribe_audio(
    file: UploadFile = File(...),
    authorization: Optional[str] = Header(None),
    token: Optional[str] = Query(None),
    source: str = Query(...)
):
    """HTTP POST endpoint for ASR transcription with authentication"""
    
    # Extract token from header or query
    auth_token = None
    if authorization and authorization.startswith("Bearer "):
        auth_token = authorization[7:]
    elif token:
        auth_token = token
    
    if not auth_token:
        raise HTTPException(status_code=401, detail="Token required")
    
    # Validate token
    try:
        user = validate_token(auth_token)
        user_id = user.get("sub")
    except HTTPException:
        raise
    
    # Read audio file
    audio_content = await file.read()
    
    # Forward to upstream ASR service
    async with httpx.AsyncClient(timeout=60.0) as client:
        files = {"file": (file.filename, audio_content, file.content_type)}
        response = await client.post(ASR_SERVICE_URL, files=files)
        
        if response.status_code != 200:
            raise HTTPException(
                status_code=response.status_code,
                detail=f"Transcription service error: {response.text}"
            )
        
        return JSONResponse(content=response.json())
```

## Client Implementation Reference

The Codex Editor client implementation can be found in:

- **TypeScript Client**: `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`
- **Integration**: `webviews/codex-webviews/src/CodexCellEditor/CodexCellEditor.tsx`

### Key Client Behavior

1. Requests ASR config (including auth token) from VS Code extension
2. Creates FormData with audio blob
3. POSTs to endpoint URL with token in query parameter or Authorization header
4. Receives JSON response with transcription text
5. Handles errors and timeouts (default 60s)

## Testing Your Implementation

### Test Cases

1. **Valid audio**: Should return transcription
2. **Invalid audio format**: Should return error message
3. **Missing token**: Should reject with 401
4. **Invalid token**: Should reject with 401
5. **Timeout**: Should handle gracefully (client has 60s timeout)
6. **Large audio files**: Should handle up to 50MB
7. **Network errors**: Should return appropriate error codes

## Supported Audio Formats

The endpoint should support common audio formats:

- `audio/webm` (recommended for browser recording)
- `audio/wav`
- `audio/mp3`
- `audio/m4a`
- `audio/ogg`
- `audio/flac`

## Security Considerations

1. **Token Validation**: Always validate JWT tokens before processing
2. **Rate Limiting**: Implement per-user rate limits to prevent abuse
3. **File Size Limits**: Set reasonable limits on audio file sizes (50MB recommended)
4. **Timeout**: Implement server-side timeouts to prevent hanging requests (60s recommended)
5. **Logging**: Log usage for monitoring and debugging (but respect privacy)
6. **HTTPS**: Always use secure connections in production

## Performance Recommendations

1. **Streaming**: For very large files, consider streaming uploads
2. **Caching**: Cache model loading to reduce cold starts (handled by upstream service)
3. **Resource Cleanup**: Properly close connections and free resources
4. **Concurrent Requests**: Handle multiple simultaneous transcriptions efficiently
5. **Timeout Handling**: Set reasonable timeouts for upstream requests

## Integration with Frontier Auth Server

The Frontier auth server should:

1. Provide `getAsrEndpoint()` method returning the proxy HTTP URL
2. Generate short-lived JWT tokens for ASR requests
3. Include user identification in tokens for logging
4. Handle token refresh if needed for long transcriptions

This follows the same pattern as the existing `getLlmEndpoint()` implementation.
