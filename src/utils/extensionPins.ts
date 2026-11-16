import * as vscode from "vscode";
import { MetadataManager } from "./metadataManager";
import { refreshPinPolicy, reconcilePinPolicy } from "./projectPinPolicy";

/** Register before awaiting anything: Frontier can call back during Editor activation. */
export function registerPinPolicyCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("codex.pinPolicyReady", () => ({ capability: 2 })),
        vscode.commands.registerCommand("codex.applyRemoteProjectPins", async (input: { generation: number; pins: Record<string, { version: string; url: string }> }) => {
            const folder = vscode.workspace.workspaceFolders?.[0];
            if (!folder) { throw new Error("No project open"); }
            const policy = await refreshPinPolicy();
            if (!policy) { throw new Error("Coordinated binary required"); }
            await MetadataManager.withMetadataWrite(folder.uri, async () => {
                const latest = await refreshPinPolicy();
                if (!latest || input.generation !== latest.generation) { throw new Error("Remote pin decision was superseded; retry sync"); }
                MetadataManager.assertMetadataSaved(folder.uri);
                await vscode.commands.executeCommand("codex.conductor.writeProjectPins", { generation: input.generation });
            });
        }),
        vscode.commands.registerCommand("codex.clearProjectExtensionPins", async (uri: string) => {
            await refreshPinPolicy();
            return MetadataManager.clearExtensionPins(vscode.Uri.parse(uri));
        }),
        vscode.commands.registerCommand("codex.openProjectFolder", (uri: string) => MetadataManager.safeOpenFolder(vscode.Uri.parse(uri)))
    );
}

export async function prepareProjectPinsForActivation(): Promise<boolean> {
    const status = await refreshPinPolicy();
    const folder = vscode.workspace.workspaceFolders?.[0];
    if (!status || !folder) { return true; }
    if (status.mode === "ignore") { await MetadataManager.clearExtensionPins(folder.uri); }
    return reconcilePinPolicy();
}
