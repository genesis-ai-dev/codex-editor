# Auth Server ASR Proxy Implementation Guide

## Overview

The Codex Editor client now supports authenticated ASR (Automatic Speech Recognition) transcription through the Frontier auth server. This document describes what needs to be implemented on the auth server side.

**Status**: Client implementation is complete and deployed. Auth server implementation is required to enable the feature.

## What You Need to Implement

### 1. Add `getAsrEndpoint()` Method to FrontierAPI

The client expects a new method on the FrontierAPI interface that returns the authenticated ASR proxy endpoint.

**Method Signature**:
```typescript
getAsrEndpoint(): Promise<string | undefined>
```

**Returns**: The WebSocket URL for the authenticated ASR proxy (e.g., `wss://auth.frontier.com/ws/asr`)

**Example Implementation**:
```typescript
async getAsrEndpoint(): Promise<string | undefined> {
    if (!this.isAuthenticated) {
        return undefined;
    }
    
    // Return your ASR proxy WebSocket URL
    return "wss://auth.frontier.com/ws/asr";
    // OR from config:
    // return this.config.asrProxyUrl;
}
```

**Pattern Reference**: This follows the exact same pattern as your existing `getLlmEndpoint()` method.

### 2. Implement WebSocket Proxy Endpoint: `/ws/asr`

Create a new WebSocket endpoint that:
1. Validates the JWT token from the query parameter
2. Proxies messages between the client and the actual ASR service (Ryder's Modal endpoint)
3. Logs usage for authenticated users

#### Endpoint Details

**URL Pattern**: `wss://your-auth-server.com/ws/asr?token=JWT_TOKEN`

**Authentication**: JWT token passed as query parameter `token`

**Upstream Service**: `wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe`

#### Message Flow

```
Client → Auth Server → ASR Service (Ryder's endpoint)
   ↓         ↓              ↓
   ←─────────←──────────────←
```

1. Client sends metadata (JSON)
2. Auth server forwards to ASR service
3. Client sends audio (binary)
4. Auth server forwards to ASR service
5. ASR service sends progress/results (JSON)
6. Auth server forwards to client

## Complete Python Implementation Example

Here's a complete FastAPI implementation you can use as a reference:

```python
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query, HTTPException
from fastapi.responses import JSONResponse
import websockets
import jwt
import asyncio
import logging
from datetime import datetime

app = FastAPI()
logger = logging.getLogger(__name__)

# Configuration
ASR_UPSTREAM_URL = "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe"
JWT_SECRET = "your-jwt-secret-here"  # Use your actual JWT secret
JWT_ALGORITHM = "HS256"

def validate_token(token: str) -> dict:
    """
    Validate JWT token and return decoded payload.
    
    Raises:
        HTTPException: If token is invalid or expired
    """
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Token expired")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Invalid token")

@app.websocket("/ws/asr")
async def websocket_asr_proxy(
    websocket: WebSocket,
    token: str = Query(..., description="JWT authentication token")
):
    """
    WebSocket proxy for ASR transcription with authentication.
    
    This endpoint:
    1. Validates the user's JWT token
    2. Establishes a connection to the upstream ASR service
    3. Proxies messages bidirectionally between client and ASR service
    4. Logs usage for monitoring
    """
    
    # Validate token before accepting connection
    try:
        user_payload = validate_token(token)
        user_id = user_payload.get("sub") or user_payload.get("user_id")
        username = user_payload.get("username") or user_payload.get("email")
    except HTTPException as e:
        await websocket.close(code=1008, reason=f"Authentication failed: {e.detail}")
        logger.warning(f"Authentication failed: {e.detail}")
        return
    
    # Accept client connection
    await websocket.accept()
    logger.info(f"User {username} (ID: {user_id}) started ASR session at {datetime.utcnow()}")
    
    # Connect to upstream ASR service
    upstream_ws = None
    try:
        upstream_ws = await websockets.connect(ASR_UPSTREAM_URL)
        logger.info(f"Connected to upstream ASR service for user {username}")
        
        async def forward_to_client():
            """Forward messages from ASR service to client"""
            try:
                async for message in upstream_ws:
                    await websocket.send_text(message)
                    logger.debug(f"Forwarded message to client {username}: {message[:100]}...")
            except websockets.exceptions.ConnectionClosed:
                logger.info(f"Upstream ASR connection closed for user {username}")
            except Exception as e:
                logger.error(f"Error forwarding to client {username}: {e}")
                try:
                    await websocket.send_text(
                        '{"type": "error", "message": "Connection to transcription service lost"}'
                    )
                except:
                    pass
        
        async def forward_to_asr():
            """Forward messages from client to ASR service"""
            try:
                while True:
                    message = await websocket.receive()
                    
                    if "text" in message:
                        # Forward JSON metadata
                        await upstream_ws.send(message["text"])
                        logger.debug(f"Forwarded metadata from {username}: {message['text'][:100]}...")
                    elif "bytes" in message:
                        # Forward binary audio data
                        audio_size = len(message["bytes"])
                        await upstream_ws.send(message["bytes"])
                        logger.info(f"Forwarded {audio_size} bytes of audio from {username}")
            except WebSocketDisconnect:
                logger.info(f"Client {username} disconnected")
            except Exception as e:
                logger.error(f"Error forwarding from client {username}: {e}")
        
        # Run both forwarding tasks concurrently
        await asyncio.gather(
            forward_to_client(),
            forward_to_asr(),
            return_exceptions=True
        )
        
    except Exception as e:
        logger.error(f"Failed to connect to upstream ASR service for user {username}: {e}")
        error_msg = {
            "type": "error",
            "message": f"Failed to connect to transcription service: {str(e)}"
        }
        try:
            await websocket.send_json(error_msg)
        except:
            pass
    finally:
        # Cleanup
        if upstream_ws:
            await upstream_ws.close()
        try:
            await websocket.close()
        except:
            pass
        logger.info(f"ASR session ended for user {username} (ID: {user_id})")

@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "healthy", "service": "asr-proxy"}

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
```

## WebSocket Protocol Details

The client implements this protocol, which your proxy must support:

### Client → ASR Service

**Step 1**: Client sends JSON metadata
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

**Step 2**: Client sends binary audio data (Blob)

### ASR Service → Client

**Progress Updates** (during processing):
```json
{
  "type": "progress",
  "data": "Processing audio...",
  "percentage": 50
}
```

**Final Result** (on completion):
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

**Error Message** (on failure):
```json
{
  "type": "error",
  "message": "Transcription failed: invalid audio format"
}
```

## Implementation Checklist

- [ ] Add `getAsrEndpoint()` method to FrontierAPI class
  - Returns `Promise<string | undefined>`
  - Returns your ASR proxy URL (e.g., `wss://auth.frontier.com/ws/asr`)
  - Returns `undefined` if not authenticated

- [ ] Create WebSocket endpoint at `/ws/asr`
  - Accepts `token` as query parameter
  - Validates JWT token
  - Rejects with code 1008 if token invalid

- [ ] Implement bidirectional proxy
  - Forward JSON text messages
  - Forward binary audio data
  - Handle connection lifecycle
  - Clean up resources on disconnect

- [ ] Add logging
  - Log successful authentications with user ID
  - Log ASR session start/end times
  - Log audio data sizes for monitoring
  - Log errors and failures

- [ ] Test the implementation
  - Valid token → successful proxying
  - Invalid token → rejection with code 1008
  - Missing token → rejection
  - Large audio files → proper streaming
  - Connection interruptions → graceful cleanup

## Configuration

You'll need to configure:

1. **JWT Secret**: Same secret used for other JWT validation
2. **Upstream ASR URL**: `wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe`
3. **Proxy Endpoint URL**: The URL you'll return from `getAsrEndpoint()`

## Testing

### Manual Test with wscat

```bash
# Install wscat
npm install -g wscat

# Test with valid token
wscat -c "wss://your-auth-server.com/ws/asr?token=YOUR_JWT_TOKEN"

# Send metadata
> {"type":"meta","mime":"audio/webm"}

# Observe responses
< {"type":"progress","data":"Processing...","percentage":50}
```

### Integration Test

The Codex Editor client will automatically use your proxy when:
1. User is authenticated
2. `getAsrEndpoint()` returns a URL
3. User transcribes audio

You can verify by checking your logs for authenticated transcription sessions.

## Security Considerations

1. **Token Validation**: Always validate JWT before accepting connection
2. **Rate Limiting**: Consider implementing per-user rate limits
3. **Timeout**: Set reasonable timeouts (30-60s) for transcription
4. **File Size Limits**: Consider limiting audio size if needed
5. **HTTPS/WSS**: Always use secure WebSocket in production
6. **Logging**: Log usage but respect user privacy (don't log audio content)

## Monitoring Recommendations

Track these metrics:
- Total ASR requests per day
- Active concurrent transcriptions
- Average transcription duration
- Error rate by error type
- Audio size distribution
- Per-user usage

## Reference Implementation

The LLM proxy endpoint on your auth server follows a similar pattern. You can use that as a reference for:
- JWT validation approach
- Error handling patterns
- Logging format
- Configuration management

## Support

If you need clarification on:
- Client behavior: See `docs/asr-proxy-endpoint.md`
- Message protocol: See examples above
- Client implementation: See `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`

## Deployment Notes

### Before Deployment
1. Test with a staging environment first
2. Verify JWT token validation works correctly
3. Test with large audio files (>10MB)
4. Confirm error handling works as expected

### After Deployment
1. Monitor logs for authentication failures
2. Check for any proxy errors
3. Verify transcription quality unchanged
4. Monitor for rate limit needs

## Timeline

**Client Ready**: ✅ Implemented and deployed

**Auth Server Required**: This implementation

**User Impact**: None until auth server is deployed (users will continue using manual endpoint configuration)

**Urgency**: Medium - allows transition away from Ryder's personal namespace

---

## Questions?

For questions about:
- **Client implementation**: Check `docs/asr-auth-proxy-implementation-summary.md`
- **Protocol details**: Check `docs/asr-proxy-endpoint.md`
- **Client code**: Check `webviews/codex-webviews/src/CodexCellEditor/WhisperTranscriptionClient.ts`

## Version

- **Client Version**: Implemented in v0.6.21+
- **Last Updated**: 2025-10-14

