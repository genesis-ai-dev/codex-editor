import * as vscode from "vscode";
import { EXTENSION_PIN_POLICY } from "../../sharedUtils/extensionPinFeatureFlag";

export interface PinPolicyStatus {
    protocolVersion: number;
    mode: "ignore" | "enforce";
    phase: "resolving" | "preparing" | "switching" | "ready" | "blocked";
    generation: number;
    error?: string;
    workspace?: string;
}

/** The binary is authoritative. Legacy hosts retain their existing pin behavior. */
export async function refreshPinPolicy(): Promise<PinPolicyStatus | undefined> {
    const commands = await vscode.commands.getCommands(true);
    if (!commands.includes("codex.conductor.getPinPolicyStatus")) {
        EXTENSION_PIN_POLICY.ignoreProjectPins = false;
        return undefined;
    }
    const status = await vscode.commands.executeCommand<PinPolicyStatus>("codex.conductor.getPinPolicyStatus");
    if (!status || status.protocolVersion !== 1) { throw new Error("Unsupported Codex pin-policy protocol"); }
    EXTENSION_PIN_POLICY.ignoreProjectPins = status.mode === "ignore";
    return status;
}

export async function prepareProjectPinPolicy(_folder: vscode.Uri): Promise<Record<string, never>> {
    await refreshPinPolicy();
    // Native startup owns profile selection, including recent-project/restored windows.
    return {};
}

export async function reconcilePinPolicy(): Promise<boolean> {
    if (!await refreshPinPolicy()) { return true; }
    const status = await vscode.commands.executeCommand<PinPolicyStatus>("codex.conductor.reconcilePinPolicy");
    if (status?.phase === "ready") { return true; }
    if (status?.phase === "blocked") {
        void vscode.window.showWarningMessage(
            `Project extension recovery paused: ${status.error ?? "required packages are unavailable"}`,
            "Retry Recovery"
        ).then(action => {
            if (action) { return vscode.commands.executeCommand("codex.conductor.retryPinRecovery"); }
            return undefined;
        });
    }
    return false;
}
