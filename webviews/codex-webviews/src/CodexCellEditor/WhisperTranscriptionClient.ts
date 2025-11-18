export type AsrMeta =
    | { type: 'meta'; mime: string }
    | {
          type: 'meta';
          provider: 'mms' | 'whisper' | string;
          model: string;
          mime: string;
          language?: string;
          task?: 'transcribe' | 'translate';
          phonetic?: boolean;
      };

export class WhisperTranscriptionClient {
    private ws: WebSocket | null = null;
    private url: string;
    private authToken?: string;

    public onProgress?: (message: string, percentage: number) => void;
    public onError?: (error: string) => void;

    constructor(url: string, authToken?: string) {
        this.url = url;
        this.authToken = authToken;
    }

    async transcribe(
        audioBlob: Blob,
        meta: AsrMeta,
        timeoutMs: number = 30000
    ): Promise<{ text: string; language: string; provider?: string; model?: string; phonetic?: string | null }> {
        return new Promise((resolve, reject) => {
            try {
                // Create WebSocket connection with auth token if available
                const url = new URL(this.url);
                const isAuthenticatedEndpoint = this.url.includes('api.frontierrnd.com') || this.url.includes('frontier');
                
                // Log token status for debugging
                console.log(`[WhisperTranscriptionClient] Endpoint: ${this.url}`);
                console.log(`[WhisperTranscriptionClient] Is authenticated endpoint: ${isAuthenticatedEndpoint}`);
                console.log(`[WhisperTranscriptionClient] Has auth token: ${!!this.authToken}`);
                console.log(`[WhisperTranscriptionClient] Token length: ${this.authToken?.length || 0}`);
                
                if (this.authToken) {
                    url.searchParams.set('token', this.authToken);
                    console.log(`[WhisperTranscriptionClient] Token added to URL`);
                } else if (isAuthenticatedEndpoint) {
                    // Authenticated endpoint but no token - this will likely fail
                    console.error(`[WhisperTranscriptionClient] ERROR: Authenticated endpoint detected but no auth token provided!`);
                    console.error(`[WhisperTranscriptionClient] Endpoint: ${this.url}`);
                    console.error(`[WhisperTranscriptionClient] This connection will likely fail due to missing authentication.`);
                }
                
                const finalUrl = url.toString();
                // Log URL structure without exposing token value
                const urlWithoutToken = finalUrl.replace(/token=[^&]*/, 'token=***');
                console.log(`[WhisperTranscriptionClient] Final WebSocket URL: ${urlWithoutToken}`);
                console.log(`[WhisperTranscriptionClient] URL has token param: ${url.searchParams.has('token')}`);
                console.log(`[WhisperTranscriptionClient] All query params: ${Array.from(url.searchParams.keys()).join(', ')}`);
                this.ws = new WebSocket(finalUrl);

                this.ws.onopen = () => {
                    console.log('WebSocket connection opened for transcription');
                    // 1. Send metadata JSON (provider-specific if provided)
                    const metaToSend: AsrMeta = meta ?? { type: 'meta', mime: audioBlob.type || 'audio/webm' };
                    this.ws?.send(JSON.stringify(metaToSend));
                    // 2. Send the audio blob as binary data
                    this.ws?.send(audioBlob);
                };

                this.ws.onmessage = (event) => {
                    try {
                        const message = JSON.parse(event.data);

                        switch (message.type) {
                            case 'progress':
                                if (this.onProgress) {
                                    this.onProgress(message.data, message.percentage);
                                }
                                break;

                            case 'done':
                                this.cleanup();
                                resolve({
                                    text: message.text,
                                    language: message.language,
                                    provider: message.provider,
                                    model: message.model,
                                    phonetic: message.phonetic ?? null,
                                });
                                break;

                            case 'error': {
                                this.cleanup();
                                // Handle empty or missing error messages from server
                                let errorMsg = message.message?.trim() || 'Transcription failed';
                                if (!errorMsg || errorMsg === '') {
                                    errorMsg = 'Transcription failed: Server returned an error with no details. This may indicate a temporary service issue or network problem.';
                                }
                                // Enhance error messages for common DNS/connection issues
                                if (errorMsg.includes('Name or service not known') || errorMsg.includes('Errno -2')) {
                                    errorMsg = `Transcription failed: Unable to resolve ASR endpoint hostname. This usually means:\n1. You may be logged out - please check your authentication status\n2. The endpoint URL is invalid or unreachable\n3. There may be a network connectivity issue\n\nOriginal error: ${errorMsg}`;
                                }
                                if (this.onError) {
                                    this.onError(errorMsg);
                                }
                                reject(new Error(errorMsg));
                                break;
                            }

                            default:
                                console.warn('Unknown message type:', message.type);
                        }
                    } catch (error) {
                        console.error('Error parsing WebSocket message:', error);
                        reject(error);
                    }
                };

                this.ws.onerror = (error) => {
                    console.error('[WhisperTranscriptionClient] WebSocket error:', error);
                    this.cleanup();
                    const isAuthenticatedEndpoint = this.url.includes('api.frontierrnd.com') || this.url.includes('frontier');
                    const missingToken = isAuthenticatedEndpoint && !this.authToken;
                    
                    let errorMsg: string;
                    if (missingToken) {
                        errorMsg = `WebSocket connection failed: Missing authentication token.\n\nThe endpoint requires authentication but no token was provided. This usually means:\n1. Your session may have expired - please check your authentication status\n2. The auth token was not retrieved properly - try refreshing or logging in again\n\nEndpoint: ${this.url}`;
                    } else if (isAuthenticatedEndpoint) {
                        // Token is present but connection still failed - likely invalid/expired token
                        errorMsg = `WebSocket connection failed: Authentication issue.\n\nA token was provided but the server rejected the connection. This usually means:\n1. Your authentication token has expired - please log out and log back in\n2. Your session may have been invalidated - try refreshing your authentication\n3. The token format may be incorrect\n4. There may be a server-side issue\n\nToken was present (length: ${this.authToken?.length || 0}) but connection was rejected.\nEndpoint: ${this.url.split('?')[0]} (token included in query)`; // Don't show full URL with token
                    } else {
                        errorMsg = `WebSocket connection failed. This usually means:\n1. You may be logged out - please check your authentication status\n2. The ASR endpoint is unreachable - check your network connection\n3. The endpoint URL may be invalid - check your ASR settings\n4. Your authentication token may be invalid or expired\n\nEndpoint: ${this.url}`;
                    }
                    if (this.onError) {
                        this.onError(errorMsg);
                    }
                    reject(new Error(errorMsg));
                };

                this.ws.onclose = (event) => {
                    if (!event.wasClean) {
                        console.error('[WhisperTranscriptionClient] WebSocket connection closed unexpectedly:', event);
                        console.error(`[WhisperTranscriptionClient] Close code: ${event.code}, reason: ${event.reason || '(none)'}`);
                        const isAuthenticatedEndpoint = this.url.includes('api.frontierrnd.com') || this.url.includes('frontier');
                        const missingToken = isAuthenticatedEndpoint && !this.authToken;
                        
                        let errorMsg: string;
                        if (event.code === 1006) {
                            // Code 1006 usually means abnormal closure (no close frame)
                            // This often happens with auth failures or network issues
                            if (missingToken) {
                                errorMsg = `Connection closed abnormally (code 1006): Missing authentication token.\n\nThe endpoint requires authentication but no token was provided. Please check your authentication status.`;
                            } else if (isAuthenticatedEndpoint) {
                                // Token was present but connection closed abnormally - likely auth failure
                                errorMsg = `Connection closed abnormally (code 1006): Authentication failure.\n\nA token was provided (length: ${this.authToken?.length || 0}) but the server rejected the connection. This usually means:\n1. Your authentication token has expired - please log out and log back in\n2. Your session was invalidated - try refreshing your authentication\n3. The server may be experiencing issues\n\nEndpoint: ${this.url.split('?')[0]} (authentication attempted)`;
                            } else {
                                errorMsg = `Connection closed abnormally (code 1006). This usually indicates:\n1. Server rejected the connection\n2. Network connectivity issue\n3. Endpoint may be unreachable\n\nEndpoint: ${this.url}`;
                            }
                        } else {
                            errorMsg = `Connection closed: ${event.reason || `Code ${event.code}`}`;
                        }
                        if (this.onError) {
                            this.onError(errorMsg);
                        }
                        reject(new Error(errorMsg));
                    }
                };

                // Add timeout (default 30s, configurable)
                setTimeout(() => {
                    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
                        this.cleanup();
                        const errorMsg = 'Transcription timeout';
                        if (this.onError) {
                            this.onError(errorMsg);
                        }
                        reject(new Error(errorMsg));
                    }
                }, timeoutMs);

            } catch (error) {
                this.cleanup();
                let errorMsg: string;
                if (error instanceof TypeError && error.message.includes('Invalid URL')) {
                    errorMsg = `Invalid ASR endpoint URL: ${this.url}. Please check your ASR settings or authentication status.`;
                } else {
                    errorMsg = error instanceof Error ? error.message : String(error);
                }
                if (this.onError) {
                    this.onError(errorMsg);
                }
                reject(new Error(errorMsg));
            }
        });
    }

    private cleanup() {
        if (this.ws) {
            if (this.ws.readyState === WebSocket.OPEN) {
                this.ws.close();
            }
            this.ws = null;
        }
    }

    abort() {
        this.cleanup();
    }
} 
