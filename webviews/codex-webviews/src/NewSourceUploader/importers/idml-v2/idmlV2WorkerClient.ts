import type {
    IdmlDiagnostic,
    IdmlParseResult,
    IdmlProgress,
    IdmlSemanticProfile,
} from "@aquilla/idml-roundtrip";

type WorkerResponse =
    | { id: string; type: "progress"; progress: IdmlProgress }
    | { id: string; type: "result"; result: IdmlParseResult }
    | {
          id: string;
          type: "error";
          error: { message: string; diagnostics: readonly IdmlDiagnostic[] };
      };

export class IdmlWorkerError extends Error {
    constructor(
        message: string,
        readonly diagnostics: readonly IdmlDiagnostic[]
    ) {
        super(message);
        this.name = "IdmlWorkerError";
    }
}

export interface IdmlWorkerParseOptions {
    signal?: AbortSignal;
    onProgress?: (progress: IdmlProgress) => void;
}

export function parseIdmlInWorker(
    sourceBytes: ArrayBuffer,
    profile: Extract<IdmlSemanticProfile, string>,
    options: IdmlWorkerParseOptions = {}
): Promise<IdmlParseResult> {
    const id = crypto.randomUUID();
    const worker = new Worker(new URL("./idmlV2.worker.ts", import.meta.url), {
        type: "module",
        name: "codex-idml-v2",
    });
    const bytes = sourceBytes.slice(0);

    return new Promise<IdmlParseResult>((resolve, reject) => {
        const cleanup = () => {
            options.signal?.removeEventListener("abort", abort);
            worker.terminate();
        };
        const abort = () => {
            worker.postMessage({ id, type: "cancel" });
            cleanup();
            reject(new DOMException("IDML import cancelled", "AbortError"));
        };

        if (options.signal?.aborted) {
            abort();
            return;
        }
        options.signal?.addEventListener("abort", abort, { once: true });
        worker.onerror = (event) => {
            cleanup();
            reject(new IdmlWorkerError(event.message || "IDML worker failed", []));
        };
        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
            if (event.data.id !== id) return;
            if (event.data.type === "progress") {
                options.onProgress?.(event.data.progress);
                return;
            }
            cleanup();
            if (event.data.type === "error") {
                reject(
                    new IdmlWorkerError(event.data.error.message, event.data.error.diagnostics)
                );
                return;
            }
            resolve(event.data.result);
        };
        worker.postMessage({ id, type: "parse", bytes, profile }, [bytes]);
    });
}
