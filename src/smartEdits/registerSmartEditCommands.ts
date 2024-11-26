import * as vscode from "vscode";
import { SmartEdits } from "./smartEdits";
import { PromptedSmartEdits } from "./smartPrompts";
import { getWorkSpaceFolder } from "../utils";
import { SmartPassages } from "./smartPassages";
import { SmartBacktranslation, SavedBacktranslation } from "./smartBacktranslation";

export const registerSmartEditCommands = (context: vscode.ExtensionContext) => {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.error("No workspace folder found");
        return;
    }

    const smartEdits = new SmartEdits(vscode.Uri.file(workspaceFolder));
    const promptedSmartEdits = new PromptedSmartEdits(vscode.Uri.file(workspaceFolder));
    const smartPassages = new SmartPassages();
    const smartBacktranslation = new SmartBacktranslation(vscode.Uri.file(workspaceFolder));

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
    // Add command for toggling pin status of prompts
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-smart-edits.togglePinPrompt",
            async (cellId: string, promptText: string) => {
                try {
                    const isPinned = await promptedSmartEdits.togglePinPrompt(cellId, promptText);
                    return isPinned;
                } catch (error) {
                    console.error("Error toggling pin status:", error);
                    vscode.window.showErrorMessage(
                        "Failed to toggle pin status. Please check the console for more details."
                    );
                    return false;
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

    console.log("Smart Edit commands registered");
};
