import * as vscode from "vscode";
import { getWorkSpaceFolder } from "../utils";
import { SmartBacktranslation, SavedBacktranslation } from "./smartBacktranslation";

export const registerBacktranslationCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.warn("No workspace folder found, backtranslation will be disabled");
        return;
    }

    const workspaceUri = vscode.Uri.file(workspaceFolder);
    const smartBacktranslation = new SmartBacktranslation(workspaceUri);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.generateBacktranslation",
            async (text: string, cellId: string, filePath?: string): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.generateBacktranslation(text, cellId, filePath);
                } catch (error) {
                    console.error("Error generating backtranslation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to generate backtranslation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.editBacktranslation",
            async (
                cellId: string,
                newText: string,
                existingBacktranslation: string,
                filePath?: string
            ): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.editBacktranslation(
                        cellId,
                        newText,
                        existingBacktranslation,
                        filePath
                    );
                } catch (error) {
                    console.error("Error editing backtranslation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to edit backtranslation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getBacktranslation",
            async (cellId: string): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.getBacktranslation(cellId);
                } catch (error) {
                    console.error("Error getting backtranslation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get backtranslation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.setBacktranslation",
            async (
                cellId: string,
                originalText: string,
                userBacktranslation: string,
                filePath?: string
            ): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.setBacktranslation(
                        cellId,
                        originalText,
                        userBacktranslation,
                        filePath
                    );
                } catch (error) {
                    console.error("Error setting backtranslation:", error);
                    vscode.window.showErrorMessage(
                        "Failed to set backtranslation. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    console.log("Backtranslation commands registered");
};
