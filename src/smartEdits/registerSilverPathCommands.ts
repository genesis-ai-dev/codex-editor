import * as vscode from "vscode";
import { SilverPath } from "./silverPath";
import { getWorkSpaceFolder } from "../utils";

export const registerSilverPathCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const silverPath = new SilverPath(vscode.Uri.file(workspaceFolder));

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.generateTranslation",
            async (userQuery: string, text: string, cellId: string) => {
                try {
                    const translation = await silverPath.generateTranslation(
                        userQuery,
                        text,
                        cellId
                    );
                    return translation;
                } catch (error) {
                    console.error("Error generating translation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to generate translation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    console.log("Silver Path commands registered");
};
