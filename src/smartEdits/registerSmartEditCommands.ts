import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { PromptedSmartEdits } from "./smartPrompts";
import { getWorkSpaceFolder } from "../utils";
import { SmartPassages } from "./smartPassages";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const smartEdits = new SmartEdits(vscode.Uri.file(workspaceFolder));
    const promptedSmartEdits = new PromptedSmartEdits(vscode.Uri.file(workspaceFolder));
    const smartPassages = new SmartPassages();

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
            "codex-smart-edits.hasApplicablePrompts",
            async (cellId: string, text: string) => {
                return await promptedSmartEdits.hasApplicablePrompts(cellId, text);
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
            "codex-smart-edits.getTopPrompts",
            async (cellId: string, text: string) => {
                try {
                    const prompts = await promptedSmartEdits.getTopPrompts(cellId, text);
                    return prompts;
                } catch (error) {
                    console.error("Error getting top prompts:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get top prompts. Please check the console for more details."
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

    // Add new command for SmartPassages chat
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.chat",
            async (cellIds: string[], query: string) => {
                try {
                    const response = await smartPassages.chat(cellIds, query);
                    return response;
                } catch (error) {
                    console.error("Error in smart passages chat:", error);
                    vscode.window.showErrorMessage(
                        "Failed to process chat request. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );

    console.log("Smart Edit commands registered");
};
