import * as vscode from "vscode";
import * as os from "os";
import { PostHog } from "posthog-node";

const EXTENSION_ID = "project-accelerate.codex-editor-extension";
const POSTHOG_PROJECT_TOKEN = "phc_RI95xdYMQyCjOFSfPmsWrj9zviS4ywf56XwEX9cZ6Mf";

let client: PostHog | undefined;
let distinctId: string | undefined;

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
    distinctId = vscode.env.machineId;

    client = new PostHog(POSTHOG_PROJECT_TOKEN, {
        host: "https://us.i.posthog.com",
        flushAt: 20,
        flushInterval: 30_000,
    });

    client.identify({
        distinctId,
        properties: getSystemProperties(),
    });

    captureTelemetryEvent("extension_activated", getSystemProperties());
};

export const captureTelemetryEvent = (
    event: string,
    properties?: Record<string, unknown>,
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
