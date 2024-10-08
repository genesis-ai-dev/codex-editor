import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { getWorkSpaceFolder } from "../utils";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const smartEdits = new SmartEdits(vscode.Uri.file(workspaceFolder));

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getEdits",
            async (text: string, cellId: string) => {
                try {
                    const suggestions = await smartEdits.getEdits(text, cellId);
                    return suggestions;
                } catch (error) {
                    console.error("Error getting smart edits:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get smart edits. Please check the console for more details."
                    );
                    return [];
                }
            }
        )
    );

    console.log("Smart Edit commands registered");
};
