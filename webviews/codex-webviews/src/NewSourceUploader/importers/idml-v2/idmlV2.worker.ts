import { IdmlError, parseIdml } from "@aquilla/idml-roundtrip";
import type {
    IdmlDiagnostic,
    IdmlParseResult,
    IdmlProgress,
    IdmlSemanticProfile,
} from "@aquilla/idml-roundtrip";

type ParseRequest = {
    id: string;
    type: "parse";
    bytes: ArrayBuffer;
    profile: Extract<IdmlSemanticProfile, string>;
};

type CancelRequest = {
    id: string;
    type: "cancel";
};

type WorkerRequest = ParseRequest | CancelRequest;

type WorkerResponse =
    | { id: string; type: "progress"; progress: IdmlProgress }
    | { id: string; type: "result"; result: IdmlParseResult }
    | {
          id: string;
          type: "error";
          error: { message: string; diagnostics: readonly IdmlDiagnostic[] };
      };

const controllers = new Map<string, AbortController>();

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
    const request = event.data;
    if (request.type === "cancel") {
        controllers.get(request.id)?.abort();
        return;
    }

    const controller = new AbortController();
    controllers.set(request.id, controller);
    void parseIdml(request.bytes, request.profile, {
        signal: controller.signal,
        onProgress: (progress) => {
            const response: WorkerResponse = { id: request.id, type: "progress", progress };
            self.postMessage(response);
        },
    })
        .then((result) => {
            const response: WorkerResponse = { id: request.id, type: "result", result };
            self.postMessage(response);
        })
        .catch((error: unknown) => {
            const response: WorkerResponse = {
                id: request.id,
                type: "error",
                error: {
                    message: error instanceof Error ? error.message : String(error),
                    diagnostics: error instanceof IdmlError ? error.diagnostics : [],
                },
            };
            self.postMessage(response);
        })
        .finally(() => {
            controllers.delete(request.id);
        });
});

export {};
