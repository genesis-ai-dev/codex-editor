import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { PromptedSmartEdits } from "./smartPrompts";
import { getWorkSpaceFolder } from "../utils";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const smartEdits = new SmartEdits(vscode.Uri.file(workspaceFolder));
    const promptedSmartEdits = new PromptedSmartEdits(vscode.Uri.file(workspaceFolder));

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
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getSavedSuggestions",
            async (cellId: string) => {
                try {
                    const suggestions = await smartEdits.loadSavedSuggestions(cellId);
                    return suggestions;
                } catch (error) {
                    console.error("Error getting saved suggestions:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get smart edits. Please check the console for more details."
                    );
                    return [];
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.applyPromptedEdit",
            async (text: string, prompt: string, cellId: string) => {
                try {
                    const modifiedText = await promptedSmartEdits.applyPromptedEdit(
                        text,
                        prompt,
                        cellId
                    );
                    console.log("Modified text: ", modifiedText);
                    return modifiedText;
                } catch (error) {
                    console.error("Error applying prompted edit:", error);
                    vscode.window.showErrorMessage(
                        "Failed to apply prompted edit. Please check the console for more details."
                    );
                    return text;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getPromptFromCellId",
            async (cellId: string) => {
                try {
                    const prompt = await promptedSmartEdits.getPromptFromCellId(cellId);
                    return prompt;
                } catch (error) {
                    console.error("Error getting prompt:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get prompt. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getAndApplyTopPrompts",
            async (cellId: string, text: string) => {
                try {
                    const modifiedText = await promptedSmartEdits.getAndApplyTopPrompts(
                        cellId,
                        text
                    );
                    return modifiedText;
                } catch (error) {
                    console.error("Error getting and applying prompted edit:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get and apply prompted edit. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.supplyRecentEditHistory",
            async ({ cellId, editHistory }) => {
                try {
                    await smartEdits.updateEditHistory(cellId, editHistory);
                    // TODO: Think about if below would be nice or not
                    // await promptedSmartEdits.updateEditHistory(cellId, editHistory);
                    return true;
                } catch (error) {
                    console.error("Error updating edit history:", error);
                    return false;
                }
            }
        )
    );

    console.log("Smart Edit commands registered");
};
