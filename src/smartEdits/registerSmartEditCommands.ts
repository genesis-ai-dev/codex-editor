import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { SmartAdvice } from "./smartAdvice";
import { getWorkSpaceFolder } from "../utils";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const smartEdits = new SmartEdits(vscode.Uri.file(workspaceFolder));
    const smartAdvice = new SmartAdvice(vscode.Uri.file(workspaceFolder));

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
            "codex-smart-edits.applyAdvice",
            async (text: string, advicePrompt: string, cellId: string) => {
                try {
                    const modifiedText = await smartAdvice.applyAdvice(text, advicePrompt, cellId);
                    console.log("Modified text: ", modifiedText);
                    return modifiedText;
                } catch (error) {
                    console.error("Error applying advice:", error);
                    vscode.window.showErrorMessage(
                        "Failed to apply advice. Please check the console for more details."
                    );
                    return text;
                }
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.getAdvice", async (cellId: string) => {
            try {
                const advice = await smartAdvice.getAdvice(cellId);
                return advice;
            } catch (error) {
                console.error("Error getting advice:", error);
                vscode.window.showErrorMessage(
                    "Failed to get advice. Please check the console for more details."
                );
                return null;
            }
        })
    );
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getAndApplyAdvice",
            async (cellId: string, text: string) => {
                try {
                    const modifiedText = await smartAdvice.getAndApplyTopAdvice(cellId, text);
                    return modifiedText;
                } catch (error) {
                    console.error("Error getting and applying advice:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get and apply advice. Please check the console for more details."
                    );
                    return null;
                }
            }
        )
    );
    console.log("Smart Edit commands registered");
};
