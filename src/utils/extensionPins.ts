import { requireCompatibleFrontier, restoreDefaultProjectProfile } from "./projectPinPolicy";
import { EXTENSION_PIN_POLICY } from "../../sharedUtils/extensionPinFeatureFlag";
import * as vscode from "vscode";
import { MetadataManager } from "./metadataManager";

export async function clearCurrentProjectPins(): Promise<boolean> {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return false; }
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!folder) { return false; }
    // Read effective pins before cleanup, including stale remote/admin caches.
    const commands = await vscode.commands.getCommands(true);
    const effective = commands.includes("codex.conductor.getEffectivePinnedExtensions")
        ? await vscode.commands.executeCommand<Record<string, unknown>>("codex.conductor.getEffectivePinnedExtensions") : undefined;
    const changed = await MetadataManager.clearExtensionPins(folder.uri);
    await clearConductorPinState();
    return changed || !!(effective && Object.keys(effective).length);
}

/** Keep recovery available without loading a project whose cleanup failed. */
export async function prepareProjectPinsForActivation(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        if (EXTENSION_PIN_POLICY.ignoreProjectPins && vscode.workspace.workspaceFolders?.length) {
            const commands = await vscode.commands.getCommands(true);
            if (commands.includes("codex.conductor.getEffectivePinnedExtensions")) { requireCompatibleFrontier(); }
        }
        const pinsRemoved = await clearCurrentProjectPins();
        if (vscode.workspace.workspaceFolders?.length && await restoreDefaultProjectProfile(context, pinsRemoved)) { return false; }
        return true;
    } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        void vscode.window.showErrorMessage(
            `Project loading paused: ${detail}`,
            "Reload to Retry", "Open Another Project"
        ).then(async action => {
            if (action === "Reload to Retry") {
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
            } else if (action === "Open Another Project") {
                const folders = await vscode.window.showOpenDialog({ canSelectFolders: true, canSelectFiles: false, canSelectMany: false });
                if (folders?.[0]) { await MetadataManager.safeOpenFolder(folders[0]); }
            }
        }).then(undefined, error => {
            vscode.window.showErrorMessage(`Could not open project: ${String(error)}`);
        });
        return false;
    }
}

/** Clear current-workspace Conductor storage only after the file is saved.
 * Missing commands are expected on older binaries / stock VS Code.
 * Errors from commands that exist must propagate rather than pretending success.
 */
export async function clearConductorPinState(): Promise<void> {
    if (!EXTENSION_PIN_POLICY.ignoreProjectPins) { return; }
    const commands = await vscode.commands.getCommands(true);
    for (const [command, args] of [
        ["codex.conductor.setRemotePins", [{}]],
        ["codex.conductor.clearAdminPinIntent", []],
    ] as const) {
        if (commands.includes(command)) {
            await vscode.commands.executeCommand(command, ...args);
        }
    }
}
