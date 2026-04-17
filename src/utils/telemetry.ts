import * as vscode from "vscode";
import * as os from "os";
import * as crypto from "crypto";
import { PostHog } from "posthog-node";

const EXTENSION_ID = "project-accelerate.codex-editor-extension";
const POSTHOG_PROJECT_TOKEN = "phc_RI95xdYMQyCjOFSfPmsWrj9zviS4ywf56XwEX9cZ6Mf";
const POSTHOG_HOST = "https://us.i.posthog.com";

const GLOBAL_STATE_ANON_KEY = "telemetry.anonymousDistinctId";

let extensionContext: vscode.ExtensionContext | undefined;
let client: PostHog | undefined;
let distinctId: string | undefined;

const isTelemetryEnabled = (): boolean =>
    vscode.workspace
        .getConfiguration("codex-editor-extension")
        .get<boolean>("telemetryEnabled", true);

const getOrCreateAnonymousDistinctId = (): string => {
    if (!extensionContext) {
        return `anonymous_${crypto.randomUUID()}`;
    }
    const existing = extensionContext.globalState.get<string>(GLOBAL_STATE_ANON_KEY);
    if (existing) {
        return existing;
    }
    const created = `anonymous_${crypto.randomUUID()}`;
    void extensionContext.globalState.update(GLOBAL_STATE_ANON_KEY, created);
    return created;
};

const getExtensionVersion = (): string => {
    const ext = vscode.extensions.getExtension(EXTENSION_ID);
    return (ext?.packageJSON?.version as string) ?? "unknown";
};

const getSystemProperties = () => ({
    osPlatform: os.platform(),
    osRelease: os.release(),
    osArch: os.arch(),
    totalMemoryGB: Math.round(os.totalmem() / 1024 / 1024 / 1024),
    freeMemoryGB: Math.round(os.freemem() / 1024 / 1024 / 1024),
    cpuCores: os.cpus().length,
    cpuModel: os.cpus()[0]?.model,
    vscodeVersion: vscode.version,
    extensionVersion: getExtensionVersion(),
    nodeVersion: process.version,
    locale: vscode.env.language,
});

export const initTelemetry = (context: vscode.ExtensionContext): void => {
    extensionContext = context;

    if (!isTelemetryEnabled()) {
        return;
    }

    distinctId = getOrCreateAnonymousDistinctId();

    client = new PostHog(POSTHOG_PROJECT_TOKEN, {
        host: POSTHOG_HOST,
        flushAt: 20,
        flushInterval: 30_000,
    });

    client.identify({
        distinctId,
        properties: getSystemProperties(),
    });
};

/**
 * Resolves distinct ID from Frontier GitLab session (getUserInfo email) or falls back to
 * persisted anonymous ID. Call after frontier-authentication activates and on auth state changes.
 */
export const refreshTelemetryDistinctIdFromAuth = async (): Promise<void> => {
    if (!client || !isTelemetryEnabled() || !extensionContext) {
        return;
    }

    try {
        const { getAuthApi } = await import("../extension");
        const api = getAuthApi();
        if (!api?.getUserInfo || !api.getAuthStatus) {
            return;
        }

        let isAuthenticated = false;
        try {
            isAuthenticated = !!api.getAuthStatus().isAuthenticated;
        } catch {
            return;
        }

        const anonymousId = getOrCreateAnonymousDistinctId();

        if (!isAuthenticated) {
            if (distinctId !== anonymousId) {
                distinctId = anonymousId;
                client.identify({
                    distinctId,
                    properties: getSystemProperties(),
                });
            }
            return;
        }

        const userInfo = await api.getUserInfo();
        const email = userInfo?.email?.trim();
        if (!email) {
            if (distinctId !== anonymousId) {
                distinctId = anonymousId;
                client.identify({
                    distinctId,
                    properties: getSystemProperties(),
                });
            }
            return;
        }

        const prev = distinctId;
        if (prev === email) {
            return;
        }

        distinctId = email;
        if (prev && prev.startsWith("anonymous_") && prev !== email) {
            client.alias({ distinctId: email, alias: prev });
        }
        client.identify({
            distinctId: email,
            properties: getSystemProperties(),
        });
    } catch (error) {
        console.warn("[Telemetry] refreshTelemetryDistinctIdFromAuth failed:", error);
    }
};

export const captureException = (
    error: Error | unknown,
    context?: Record<string, unknown>
): void => {
    if (!client || !distinctId) {
        return;
    }

    const err = error instanceof Error ? error : new Error(String(error));

    client.captureException(err, distinctId, context);
};

export const captureEvent = (
    event: string,
    properties?: Record<string, unknown>
): void => {
    if (!client || !distinctId) {
        return;
    }

    client.capture({
        distinctId,
        event,
        properties,
    });
};

export const shutdownTelemetry = async (): Promise<void> => {
    if (!client) {
        return;
    }

    try {
        await client.shutdown();
    } catch (error) {
        console.warn("[Telemetry] Error during PostHog shutdown:", error);
    } finally {
        client = undefined;
    }
};

const SESSION_RECORDING_WEBVIEWS = new Set([
    "CodexCellEditor",
    "NavigationView",
    "MainMenu",
    "CommentsView",
    "ParallelView",
]);

export const getPostHogWebviewScript = (nonce: string, webviewName?: string): string => {
    if (!isTelemetryEnabled()) {
        return `<script nonce="${nonce}">/* telemetry disabled */</script>`;
    }

    const userEnabled = vscode.workspace
        .getConfiguration("codex-editor-extension")
        .get<boolean>("sessionRecordingEnabled", false);

    const enableRecording = userEnabled && SESSION_RECORDING_WEBVIEWS.has(webviewName ?? "");

    const idForWebview = distinctId ?? getOrCreateAnonymousDistinctId();

    return `<script nonce="${nonce}">
        window.__POSTHOG_CONFIG__ = ${JSON.stringify({
        token: POSTHOG_PROJECT_TOKEN,
        host: POSTHOG_HOST,
        distinctId: idForWebview,
        enableRecording,
    })};
    </script>`;
};
