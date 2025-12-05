export class WhisperTranscriptionClient {
    private url: string;
    private authToken?: string;

    public onError?: (error: string) => void;

    constructor(url: string, authToken?: string) {
        this.url = url;
        this.authToken = authToken;
    }

    async transcribe(
        audioBlob: Blob,
        timeoutMs: number = 60000
    ): Promise<{ text: string; }> {
        try {
            // Create FormData with audio file
            const formData = new FormData();
            const filename = audioBlob.type === "audio/webm" ? "audio.webm" : "audio.wav";
            formData.append("file", audioBlob, filename);

            // Build URL with query parameters
            const url = new URL(this.url);
            url.searchParams.set("source", "codex");
            if (this.authToken) {
                url.searchParams.set("token", this.authToken);
            }

            // Prepare headers
            const headers: HeadersInit = {};
            if (this.authToken) {
                headers["Authorization"] = `Bearer ${this.authToken}`;
            }

            // Log for debugging
            console.log(`[WhisperTranscriptionClient] Endpoint: ${this.url}`);
            console.log(`[WhisperTranscriptionClient] Has auth token: ${!!this.authToken}`);
            const urlWithoutToken = url.toString().replace(/token=[^&]*/, "token=***");
            console.log(`[WhisperTranscriptionClient] Final URL: ${urlWithoutToken}`);

            // Create abort controller for timeout
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

            try {
                // Make POST request
                const response = await fetch(url.toString(), {
                    method: "POST",
                    body: formData,
                    headers,
                    signal: controller.signal,
                });

                clearTimeout(timeoutId);

                if (!response.ok) {
                    let errorMsg = `Transcription failed: ${response.status} ${response.statusText}`;
                    try {
                        const errorData = await response.json();
                        errorMsg = errorData.detail || errorData.message || errorMsg;
                    } catch {
                        // If response isn't JSON, use status text
                        const text = await response.text();
                        if (text) {
                            errorMsg = text;
                        }
                    }

                    // Enhance error messages for common issues
                    if (response.status === 401) {
                        errorMsg = `Authentication failed. Please check your login status.\n\n${errorMsg}`;
                    } else if (response.status === 504) {
                        errorMsg = `Transcription timeout. The service took too long to respond.\n\n${errorMsg}`;
                    } else if (response.status === 502) {
                        errorMsg = `Failed to connect to transcription service. Please check your network connection.\n\n${errorMsg}`;
                    }

                    if (this.onError) {
                        this.onError(errorMsg);
                    }
                    throw new Error(errorMsg);
                }

                // Parse response
                const result = await response.json();
                return { text: result.text || "" };
            } catch (error) {
                clearTimeout(timeoutId);

                if (error instanceof Error) {
                    if (error.name === "AbortError") {
                        const errorMsg = "Transcription timeout";
                        if (this.onError) {
                            this.onError(errorMsg);
                        }
                        throw new Error(errorMsg);
                    }

                    // Network or other errors
                    let errorMsg = error.message;
                    if (errorMsg.includes("Failed to fetch") || errorMsg.includes("NetworkError")) {
                        errorMsg = `Network error: Unable to reach transcription service.\n\nThis usually means:\n1. You may be logged out - please check your authentication status\n2. The endpoint URL is invalid or unreachable\n3. There may be a network connectivity issue\n\nEndpoint: ${this.url.split("?")[0]}`;
                    }

                    if (this.onError) {
                        this.onError(errorMsg);
                    }
                    throw error;
                }

                throw error;
            }
        } catch (error) {
            let errorMsg: string;
            if (error instanceof TypeError && error.message.includes("Invalid URL")) {
                errorMsg = `Invalid ASR endpoint URL: ${this.url}. Please check your ASR settings or authentication status.`;
            } else {
                errorMsg = error instanceof Error ? error.message : String(error);
            }
            if (this.onError) {
                this.onError(errorMsg);
            }
            throw new Error(errorMsg);
        }
    }

    abort() {
        // No-op for HTTP requests (abort handled by AbortController)
    }
}
