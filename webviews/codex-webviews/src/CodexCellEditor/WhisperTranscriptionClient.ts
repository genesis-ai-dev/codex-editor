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

    public onProgress?: (message: string, percentage: number) => void;
    public onError?: (error: string) => void;

    constructor(url: string) {
        this.url = url;
    }

    async transcribe(
        audioBlob: Blob,
        meta: AsrMeta
    ): Promise<{ text: string; language: string; provider?: string; model?: string; phonetic?: string | null }> {
        return new Promise((resolve, reject) => {
            try {
                // Create WebSocket connection
                this.ws = new WebSocket(this.url);

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
                                const errorMsg = message.message || 'Transcription failed';
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
                    console.error('WebSocket error:', error);
                    this.cleanup();
                    const errorMsg = 'WebSocket connection failed';
                    if (this.onError) {
                        this.onError(errorMsg);
                    }
                    reject(new Error(errorMsg));
                };

                this.ws.onclose = (event) => {
                    if (!event.wasClean) {
                        console.error('WebSocket connection closed unexpectedly:', event);
                        const errorMsg = `Connection closed: ${event.reason || 'Unknown reason'}`;
                        if (this.onError) {
                            this.onError(errorMsg);
                        }
                        reject(new Error(errorMsg));
                    }
                };

                // Add timeout
                setTimeout(() => {
                    if (this.ws?.readyState === WebSocket.OPEN || this.ws?.readyState === WebSocket.CONNECTING) {
                        this.cleanup();
                        const errorMsg = 'Transcription timeout';
                        if (this.onError) {
                            this.onError(errorMsg);
                        }
                        reject(new Error(errorMsg));
                    }
                }, 300000); // 5 minute timeout

            } catch (error) {
                this.cleanup();
                reject(error);
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
