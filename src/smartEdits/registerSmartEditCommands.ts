import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { getWorkSpaceFolder } from "../utils";
import { SmartPassages } from "./smartPassages";
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
    const smartPassages = new SmartPassages();
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
                    const sessionInfo = smartPassages.getCurrentSessionInfo();
                    return { response, sessionInfo };
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

    // Add new command for SmartPassages chat with streaming
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.chatStream",
            async (
                cellIds: string[],
                query: string,
                onChunk: (chunk: string) => void,
                editIndex?: number
            ) => {
                try {
                    const sessionInfo = smartPassages.getCurrentSessionInfo();
                    onChunk(JSON.stringify({ sessionInfo })); // Send session info as the first chunk

                    await smartPassages.chatStream(cellIds, query, onChunk, editIndex);
                } catch (error) {
                    console.error("Error in smart passages chat stream:", error);
                    vscode.window.showErrorMessage(
                        "Failed to process chat request. Please check the console for more details."
                    );
                    onChunk(JSON.stringify({ error: "Error processing request." }));
                }
            }
        )
    );

    // Add new commands for SmartBacktranslation
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.generateBacktranslation",
            async (text: string, cellId: string): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.generateBacktranslation(text, cellId);
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
                existingBacktranslation: string
            ): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.editBacktranslation(
                        cellId,
                        newText,
                        existingBacktranslation
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
                userBacktranslation: string
            ): Promise<SavedBacktranslation | null> => {
                try {
                    return await smartBacktranslation.setBacktranslation(
                        cellId,
                        originalText,
                        userBacktranslation
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

    // Add new command for updating/creating feedback
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.updateFeedback",
            async (cellId: string, content: string) => {
                try {
                    await smartPassages.updateFeedback(cellId, content);
                    console.log(`Feedback updated for cellId: ${cellId}`);
                    return true;
                } catch (error) {
                    console.error("Error updating feedback:", error);
                    vscode.window.showErrorMessage(
                        "Failed to update feedback. Please check the console for more details."
                    );
                    return false;
                }
            }
        )
    );

    // Add command to start a new chat session
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.startNewChatSession", () => {
            smartPassages.startNewSession();
            return smartPassages.getCurrentSessionInfo();
        })
    );

    // Add command to get current session info
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.getCurrentChatSessionInfo", () => {
            return smartPassages.getCurrentSessionInfo();
        })
    );

    // Add command to get all saved chat sessions
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-smart-edits.getAllChatSessions", async () => {
            return await smartPassages.getAllSessions();
        })
    );

    // Add command to load a specific chat session
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.loadChatSession",
            async (sessionId: string) => {
                const loadedSession = await smartPassages.loadChatHistory(sessionId);
                return {
                    sessionInfo: smartPassages.getCurrentSessionInfo(),
                    messages: loadedSession ? loadedSession.messages : [],
                };
            }
        )
    );

    // Add command to delete a specific chat session
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.deleteChatSession",
            async (sessionId: string) => {
                try {
                    const success = await smartPassages.deleteChatSession(sessionId);
                    if (success) {
                        console.log(`Chat session ${sessionId} deleted successfully`);
                        return true;
                    } else {
                        console.log(`Failed to delete chat session ${sessionId}`);
                        return false;
                    }
                } catch (error) {
                    console.error("Error deleting chat session:", error);
                    vscode.window.showErrorMessage(
                        "Failed to delete chat session. Please check the console for more details."
                    );
                    return false;
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
                console.log("ICE Suggestions:", suggestions);
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
            console.log("[ICE] Getting ICE edits for:", text);
            const suggestions = await smartEdits.getIceEdits(text);
            console.log("[ICE] Suggestions:", suggestions);
            return suggestions;
        })
    );

    // Add new command for recording ICE edits
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.recordIceEdit",
            async (oldText: string, newText: string) => {
                console.log("[RYDER] recordIceEdit called from registerSmartEditCommands.ts");
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
                console.log(
                    "[RYDER] rejectEditSuggestion called from registerSmartEditCommands.ts"
                );
                try {
                    if (source === "ice") {
                        console.log("[RYDER] rejecting ICE edit");
                        if (!leftToken && !rightToken) {
                            throw new Error(
                                "At least one of leftToken or rightToken is required for ICE edit rejections"
                            );
                        }
                        console.log("[RYDER] rejecting ICE edit", {
                            oldString,
                            newString,
                            leftToken,
                            rightToken,
                        });
                        await iceEdits.rejectEdit(oldString, newString, leftToken, rightToken);
                    } else {
                        if (!cellId) {
                            throw new Error("cellId is required for LLM edit rejections");
                        }
                        console.log("[RYDER] rejecting LLM edit");
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
