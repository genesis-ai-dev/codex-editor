import * as vscode from "vscode";
import * as os from "os";
import * as crypto from "crypto";
import { PostHog } from "posthog-node";

const EXTENSION_ID = "project-accelerate.codex-editor-extension";
const POSTHOG_PROJECT_TOKEN = "phc_RI95xdYMQyCjOFSfPmsWrj9zviS4ywf56XwEX9cZ6Mf";
const POSTHOG_HOST = "https://us.i.posthog.com";

let client: PostHog | undefined;
let distinctId: string | undefined;

const buildDistinctId = (): string => {
    const uuid = crypto.randomUUID();
    try {
        const pm = vscode.workspace.getConfiguration("codex-project-manager");
        const email = pm.get<string>("userEmail");
        
        if (email) {
            return `${email}`;
        }
    } catch {
        // Config unavailable — fall through to OS username
    }

    return `anonymous_${uuid}`;
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

export const initTelemetry = (): void => {
    distinctId = buildDistinctId();

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

export const captureException = (
    error: Error | unknown,
    context?: Record<string, unknown>
): void => {
    if (!client || !distinctId) {
        return;
    }

    const err = error instanceof Error ? error : new Error(String(error));

    client.capture({
        distinctId,
        event: "$exception",
        properties: {
            $exception_type: err.name,
            $exception_message: err.message,
            $exception_stack_trace_raw: err.stack,
            ...context,
        },
    });
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

export const getPostHogWebviewScript = (nonce: string): string => {
    const enabled = vscode.workspace
        .getConfiguration("codex-editor-extension")
        .get<boolean>("sessionRecordingEnabled", true);

    return `<script nonce="${nonce}">
        window.__POSTHOG_CONFIG__ = ${JSON.stringify({
            token: POSTHOG_PROJECT_TOKEN,
            host: POSTHOG_HOST,
            distinctId: buildDistinctId(),
            sessionRecordingEnabled: enabled,
        })};
    </script>`;
};
