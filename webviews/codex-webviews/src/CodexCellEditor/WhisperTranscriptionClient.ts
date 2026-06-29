/**
 * HTTP client for the OmniASR transcription service.
 *
 * Despite the class name (kept for git-history continuity), this talks to
 * Meta Omnilingual ASR through the Frontier auth-proxy. Contract spec lives
 * at `docs/asr-proxy-endpoint.md`.
 */
export class WhisperTranscriptionClient {
    private url: string;
    private authToken?: string;

    public onError?: (error: string) => void;

    constructor(url: string, authToken?: string) {
        this.url = url;
        this.authToken = authToken;
    }

    /**
     * @param audioBlob audio bytes (WebM, WAV, MP3, OGG, FLAC, ...).
     * @param options.lang   OmniASR `{iso639_3}_{Script}` code (e.g. `swh_Latn`).
     *                       Omit to let the server transcribe without language conditioning.
     * @param options.timeoutMs request timeout in ms. Default 60s.
     */
    async transcribe(
        audioBlob: Blob,
        options: { lang?: string; timeoutMs?: number; } = {}
    ): Promise<{ text: string; lang: string | null; }> {
        const { lang, timeoutMs = 60000 } = options;
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
            // OmniASR-specific: forward the language hint when provided. Omitting it tells
            // the model to transcribe without conditioning (no internal LID, just the
            // model's autoregressive guess).
            if (lang) {
                url.searchParams.set("lang", lang);
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
                        errorMsg = `Sign-in failed. Please check that you're logged in.\n\n${errorMsg}`;
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

                // Parse response. OmniASR echoes `lang` when one was sent; in auto-detect
                // mode it omits the field. The Frontier proxy used to call this field
                // `language`, so we accept either.
                const result = await response.json();
                const echoedLang: string | null =
                    (typeof result?.lang === "string" && result.lang) ||
                    (typeof result?.language === "string" && result.language) ||
                    null;
                return { text: result.text || "", lang: echoedLang };
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
                        errorMsg = `Network error: Unable to reach the transcription service.\n\nThis usually means:\n1. You may be logged out — please check your login status\n2. The service address may be incorrect or unreachable\n3. There may be a network or internet issue`;
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
                errorMsg = `Invalid transcription service address. Please check your settings or login status.`;
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
