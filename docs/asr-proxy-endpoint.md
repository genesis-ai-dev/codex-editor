# ASR WebSocket Endpoint Specification

This document describes the WebSocket protocol for implementing an ASR (Automatic Speech Recognition) transcription endpoint compatible with the Codex Editor.

## Overview

The Codex Editor uses a WebSocket-based protocol for real-time audio transcription. This allows for streaming audio data and receiving progress updates during transcription.

## Authentication

The client passes authentication via a JWT token as a query parameter:

```
wss://your-endpoint.com/ws/asr?token=JWT_TOKEN
```

The server should:
1. Validate the JWT token before establishing the WebSocket connection
2. Reject connections with invalid or missing tokens
3. Establish a proxy connection to the actual ASR service (e.g., Modal endpoint)

## Message Protocol

The client and server communicate using JSON messages and binary data over WebSocket.

### 1. Client Sends Metadata (JSON)

First, the client sends a JSON string with transcription configuration:

```json
{
  "type": "meta",
  "provider": "mms",
  "model": "facebook/mms-1b-all",
  "mime": "audio/webm",
  "language": "eng",
  "task": "transcribe",
  "phonetic": false
}
```

#### Metadata Fields

- `type`: Always `"meta"` for metadata messages
- `provider`: ASR provider - `"mms"` (Massively Multilingual Speech) or `"whisper"`
- `model`: Model identifier (e.g., `"facebook/mms-1b-all"`)
- `mime`: Audio MIME type (e.g., `"audio/webm"`, `"audio/wav"`, `"audio/mp3"`)
- `language`: ISO-639-3 language code (required for MMS, e.g., `"eng"`, `"fra"`, `"spa"`)
- `task`: Either `"transcribe"` or `"translate"`
- `phonetic`: Boolean indicating if phonetic (IPA) transcription is desired

#### Minimal Metadata (Whisper)

For Whisper provider with auto-detection:

```json
{
  "type": "meta",
  "mime": "audio/webm"
}
```

### 2. Client Sends Audio Data (Binary)

Immediately after metadata, the client sends the audio file as a binary Blob.

### 3. Server Sends Progress Updates (JSON)

During processing, the server can send progress updates:

```json
{
  "type": "progress",
  "data": "Processing audio...",
  "percentage": 50
}
```

- `type`: Always `"progress"`
- `data`: Human-readable progress message
- `percentage`: Progress percentage (0-100)

### 4. Server Sends Transcription Result (JSON)

Upon completion, the server sends the final result:

```json
{
  "type": "done",
  "text": "This is the transcribed text",
  "language": "eng",
  "provider": "mms",
  "model": "facebook/mms-1b-all",
  "phonetic": "ðɪs ɪz ðə trænskraɪbd tɛkst"
}
```

- `type`: Always `"done"`
- `text`: Transcribed text (required)
- `language`: Detected or specified language code
- `provider`: ASR provider used
- `model`: Model used for transcription
- `phonetic`: Phonetic (IPA) transcription if requested (optional)

### 5. Server Sends Error Messages (JSON)

If an error occurs, the server sends:

```json
{
  "type": "error",
  "message": "Transcription failed: invalid audio format"
}
```

- `type`: Always `"error"`
- `message`: Human-readable error description

## Example Implementation (Python/FastAPI)

Here's a basic example of implementing the ASR proxy endpoint:

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse
import websockets
import json
import jwt

app = FastAPI()

# Configuration
ASR_SERVICE_URL = "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe"
JWT_SECRET = "your-jwt-secret"

def validate_token(token: str) -> dict:
    """Validate JWT token and return payload"""
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=["HS256"])
        return payload
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.websocket("/ws/asr")
async def websocket_asr_proxy(
    websocket: WebSocket,
    token: str = Query(...)
):
    """WebSocket proxy for ASR transcription with authentication"""
    
    # Validate token
    try:
        user = validate_token(token)
        user_id = user.get("sub")
    except HTTPException:
        await websocket.close(code=1008, reason="Invalid authentication token")
        return
    
    # Accept client connection
    await websocket.accept()
    
    # Log usage
    print(f"User {user_id} starting transcription")
    
    # Connect to actual ASR service
    try:
        async with websockets.connect(ASR_SERVICE_URL) as asr_ws:
            async def forward_to_client():
                """Forward messages from ASR service to client"""
                try:
                    async for message in asr_ws:
                        await websocket.send_text(message)
                except Exception as e:
                    print(f"Error forwarding to client: {e}")
            
            async def forward_to_asr():
                """Forward messages from client to ASR service"""
                try:
                    while True:
                        message = await websocket.receive()
                        
                        if "text" in message:
                            # Forward JSON metadata
                            await asr_ws.send(message["text"])
                        elif "bytes" in message:
                            # Forward binary audio data
                            await asr_ws.send(message["bytes"])
                except WebSocketDisconnect:
                    print("Client disconnected")
                except Exception as e:
                    print(f"Error forwarding to ASR: {e}")
            
            # Run both forwarding tasks concurrently
            import asyncio
            await asyncio.gather(
                forward_to_client(),
                forward_to_asr()
            )
            
    except Exception as e:
        error_msg = json.dumps({
            "type": "error",
            "message": f"Failed to connect to ASR service: {str(e)}"
        })
        await websocket.send_text(error_msg)
    finally:
        await websocket.close()
        print(f"User {user_id} transcription session ended")

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## Client Implementation Reference

The Codex Editor client implementation can be found in:

- **TypeScript Client**: `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`
- **Integration**: `webviews/codex-webviews/src/CodexCellEditor/CodexCellEditor.tsx`

### Key Client Behavior

1. Requests ASR config (including auth token) from VS Code extension
2. Constructs WebSocket URL with token as query parameter
3. Opens WebSocket connection
4. Sends metadata JSON
5. Sends audio binary data
6. Listens for progress updates
7. Receives final transcription result
8. Handles errors and timeouts (default 30s)

## Testing Your Implementation

### Test with Manual Endpoint

Users can test custom ASR endpoints by setting the VS Code configuration:

```json
{
  "codex-editor-extension.asrEndpoint": "ws://localhost:8000/ws/asr"
}
```

### Test Cases

1. **Valid audio**: Should return transcription
2. **Invalid audio format**: Should return error message
3. **Missing token**: Should reject connection
4. **Invalid token**: Should reject connection with 401
5. **Timeout**: Should handle gracefully (client has 30s timeout)
6. **Large audio files**: Should handle streaming properly
7. **Connection interruption**: Should clean up resources

## Supported Audio Formats

The endpoint should support common audio formats:

- `audio/webm` (recommended for browser recording)
- `audio/wav`
- `audio/mp3`
- `audio/m4a`
- `audio/ogg`
- `audio/aac`
- `audio/flac`

## Security Considerations

1. **Token Validation**: Always validate JWT tokens before processing
2. **Rate Limiting**: Implement per-user rate limits to prevent abuse
3. **File Size Limits**: Set reasonable limits on audio file sizes
4. **Timeout**: Implement server-side timeouts to prevent hanging connections
5. **Logging**: Log usage for monitoring and debugging (but respect privacy)
6. **HTTPS/WSS**: Always use secure WebSocket connections in production

## Performance Recommendations

1. **Streaming**: Use streaming audio processing when possible
2. **Caching**: Cache model loading to reduce cold starts
3. **Resource Cleanup**: Properly close connections and free resources
4. **Concurrent Requests**: Handle multiple simultaneous transcriptions efficiently
5. **Progress Updates**: Send periodic updates for long transcriptions (>5s)

## Integration with Frontier Auth Server

The Frontier auth server should:

1. Provide `getAsrEndpoint()` method returning the proxy WebSocket URL
2. Generate short-lived JWT tokens for ASR requests
3. Include user identification in tokens for logging
4. Handle token refresh if needed for long transcriptions

This follows the same pattern as the existing `getLlmEndpoint()` implementation.

