import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { getWorkSpaceFolder } from "../utils";
import { SmartBacktranslation, SavedBacktranslation } from "./smartBacktranslation";
import { ICEEdits } from "./iceEdits";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.warn("No workspace folder found, smart edits will be disabled");
        return;
    }

    const workspaceUri = vscode.Uri.file(workspaceFolder);
    const smartEdits = new SmartEdits(workspaceUri);
    const smartBacktranslation = new SmartBacktranslation(workspaceUri);
    const iceEdits = new ICEEdits(workspaceFolder);

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.getEdits",
            async (text: string, cellId: string) => {
                try {
                    const suggestions = await smartEdits.getEdits(text, cellId);
                    return suggestions;
                } catch (error) {
                    console.error("Error getting smart edits:", error);
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
                    return [];
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


    // Add new commands for SmartBacktranslation
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


    // Test command for ICE edits
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.testIceEdit", async () => {
            try {
                // Record a test edit
                await iceEdits.recordEdit("hello", "hi", "", "there");
                vscode.window.showInformationMessage(
                    "Recorded test ICE edit: 'hello' -> 'hi' (with 'there' as right context)"
                );
            } catch (error) {
                console.error("Error recording ICE edit:", error);
                vscode.window.showErrorMessage("Failed to record ICE edit");
            }
        })
    );

    // Test command to check ICE suggestions
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.checkIceSuggestions", async () => {
            try {
                const suggestions = await iceEdits.calculateSuggestions("hello", "", "there");
                vscode.window.showInformationMessage(`Found ${suggestions.length} ICE suggestions`);
            } catch (error) {
                console.error("Error checking ICE suggestions:", error);
                vscode.window.showErrorMessage("Failed to check ICE suggestions");
            }
        })
    );

    // Register the getIceEdits command
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.getIceEdits", async (text: string) => {
            const suggestions = await smartEdits.getIceEdits(text);
            return suggestions;
        })
    );

    // Add new command for recording ICE edits
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.recordIceEdit",
            async (oldText: string, newText: string) => {
                try {
                    // Use recordFullEdit which handles diffing and context extraction
                    await iceEdits.recordFullEdit(oldText, newText);
                } catch (error) {
                    console.error("Error recording ICE edit:", error);
                    vscode.window.showErrorMessage(
                        "Failed to record ICE edit. Please check the console for more details."
                    );
                }
            }
        )
    );

    // Add command to reject edit suggestions
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.rejectEditSuggestion",
            async ({
                source,
                cellId,
                oldString,
                newString,
                leftToken,
                rightToken,
            }: {
                source: "ice" | "llm";
                cellId?: string;
                oldString: string;
                newString: string;
                leftToken: string;
                rightToken: string;
            }) => {
                try {
                    if (source === "ice") {
                        if (!leftToken && !rightToken) {
                            throw new Error(
                                "At least one of leftToken or rightToken is required for ICE edit rejections"
                            );
                        }
                        await iceEdits.rejectEdit(oldString, newString, leftToken, rightToken);
                    } else {
                        if (!cellId) {
                            throw new Error("cellId is required for LLM edit rejections");
                        }
                        await smartEdits.rejectSmartSuggestion(cellId, oldString, newString);
                    }
                    return true;
                } catch (error) {
                    console.error("Error rejecting edit suggestion:", error);
                    vscode.window.showErrorMessage(
                        "Failed to reject edit suggestion. Please check the console for more details."
                    );
                    return false;
                }
            }
        )
    );

    console.log("Smart Edit commands registered");
};
