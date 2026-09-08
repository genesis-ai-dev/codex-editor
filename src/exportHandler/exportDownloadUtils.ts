import type * as vscode from "vscode";

const DEBUG = false;
const debug = DEBUG ? (...args: unknown[]) => console.log("[ExportDownload]", ...args) : () => { };

/** Signals intentional cancellation rather than a per-file export failure. */
export class ExportCancelledError extends Error {
    constructor(message = "Export cancelled") {
        super(message);
        this.name = "ExportCancelledError";
    }
}

/**
 * Bridges a VS Code `CancellationToken` to a DOM `AbortSignal` so it can be
 * handed to fetch-based APIs (e.g. the Frontier LFS download). The returned
 * `dispose` must be called to detach the listener and avoid leaks.
 */
export function tokenToAbortSignal(
    token?: vscode.CancellationToken
): { signal: AbortSignal | undefined; dispose: () => void; } {
    if (!token) {
        return { signal: undefined, dispose: () => undefined };
    }
    const controller = new AbortController();
    if (token.isCancellationRequested) {
        controller.abort();
        return { signal: controller.signal, dispose: () => undefined };
    }
    const sub = token.onCancellationRequested(() => controller.abort());
    return { signal: controller.signal, dispose: () => sub.dispose() };
}

/**
 * Sleeps for `ms`, resolving early (without throwing) if the signal aborts —
 * so a cancellation during a retry backoff doesn't have to wait out the delay.
 */
function delay(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve) => {
        if (signal?.aborted) {
            resolve();
            return;
        }
        const timer = setTimeout(() => {
            signal?.removeEventListener("abort", onAbort);
            resolve();
        }, ms);
        const onAbort = () => {
            clearTimeout(timer);
            resolve();
        };
        signal?.addEventListener("abort", onAbort, { once: true });
    });
}

/**
 * Decides whether a failed LFS download is worth retrying. Transient
 * server/network hiccups (5xx, 429, timeouts, reset connections) usually
 * succeed on a second attempt; permanent conditions (404, auth, a corrupt
 * pointer, or a user-initiated abort) do not, so we fail fast on those.
 */
function isRetryableDownloadError(error: unknown, signal?: AbortSignal): boolean {
    // Never retry something the user cancelled.
    if (signal?.aborted) return false;
    const name = (error as { name?: string; })?.name;
    if (name === "AbortError") return false;

    const message = error instanceof Error ? error.message : String(error ?? "");
    const haystack = message.toLowerCase();

    // Permanent / non-retryable signals — bail out immediately.
    if (/\b(400|401|403|404|409|410|422)\b/.test(message)) return false;
    if (haystack.includes("invalid lfs pointer")) return false;

    // Transient signals worth another attempt.
    return (
        /\b(429|500|502|503|504)\b/.test(message) ||
        haystack.includes("internal server error") ||
        haystack.includes("bad gateway") ||
        haystack.includes("service unavailable") ||
        haystack.includes("gateway timeout") ||
        haystack.includes("timeout") ||
        haystack.includes("timed out") ||
        haystack.includes("econnreset") ||
        haystack.includes("econnrefused") ||
        haystack.includes("etimedout") ||
        haystack.includes("enotfound") ||
        haystack.includes("socket hang up") ||
        haystack.includes("network") ||
        haystack.includes("fetch failed")
    );
}

/** Max LFS download attempts (1 initial + retries) and the base backoff. */
const LFS_DOWNLOAD_MAX_ATTEMPTS = 4;
const LFS_DOWNLOAD_BACKOFF_BASE_MS = 600;

/**
 * Downloads an LFS object with bounded exponential backoff + jitter so
 * transient server failures do not immediately fail an export.
 */
export async function downloadLfsWithRetry(
    frontierApi: { downloadLFSFile: (projectPath: string, oid: string, size: number, signal?: AbortSignal) => Promise<Uint8Array>; },
    projectPath: string,
    oid: string,
    size: number,
    signal?: AbortSignal
): Promise<Uint8Array> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= LFS_DOWNLOAD_MAX_ATTEMPTS; attempt++) {
        if (signal?.aborted) throw new ExportCancelledError();
        try {
            return await frontierApi.downloadLFSFile(projectPath, oid, size, signal);
        } catch (error) {
            lastError = error;
            const canRetry =
                attempt < LFS_DOWNLOAD_MAX_ATTEMPTS &&
                isRetryableDownloadError(error, signal);
            if (!canRetry) break;
            // Exponential backoff (0.6s, 1.2s, 2.4s …) with up to 50% jitter to
            // avoid 30 concurrent workers hammering the server in lockstep.
            const base = LFS_DOWNLOAD_BACKOFF_BASE_MS * 2 ** (attempt - 1);
            const wait = base + Math.floor(Math.random() * base * 0.5);
            debug(
                `LFS download for ${oid} failed (attempt ${attempt}/${LFS_DOWNLOAD_MAX_ATTEMPTS}), ` +
                `retrying in ${wait}ms: ${error instanceof Error ? error.message : String(error)}`
            );
            await delay(wait, signal);
            if (signal?.aborted) break;
        }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
