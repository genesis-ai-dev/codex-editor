import * as vscode from "vscode";
import { CodexCellDocument } from "./codexDocument";
// Use type-only import to break circular dependency
import type { CodexCellEditorProvider } from "./codexCellEditorProvider";
import { GlobalMessage, EditorPostMessages } from "../../../types";
import { EditType } from "../../../types/enums";
import {
    QuillCellContent,
    SpellCheckResponse,
    AlertCodesServerResponse,
    GlobalContentType,
    ValidationEntry,
} from "../../../types";
import path from "path";
import { getWorkSpaceUri } from "../../utils";
import { SavedBacktranslation } from "../../smartEdits/smartBacktranslation";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";
import { CodexNotebookReader } from "@/serializer";
import { llmCompletion } from "../translationSuggestions/llmCompletion";
import { getAuthApi } from "@/extension";
import { GlobalProvider } from "../../globalProvider";
import { SyncManager } from "../../projectManager/syncManager";
import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";
import * as fs from "fs";
// Comment out problematic imports
// import { getAddWordToSpellcheckApi } from "../../extension";
// import { getSimilarCellIds } from "@/utils/semanticSearch";
// import { getSpellCheckResponseForText } from "../../extension";
// import { ChapterGenerationManager } from "./chapterGenerationManager";
// import { generateBackTranslation, editBacktranslation, getBacktranslation, setBacktranslation } from "../../backtranslation";
// import { rejectEditSuggestion } from "../../actions/suggestions/rejectEditSuggestion";

// Enable debug logging if needed
const DEBUG_MODE = true; // Temporarily enable for testing
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[CodexCellEditorMessageHandling]", ...args);
    }
}

// Get a reference to the provider
function getProvider(): CodexCellEditorProvider | undefined {
    // Find the provider through the window object
    return (vscode.window as any).createWebviewPanel?.owner;
}

export async function performLLMCompletion(
    currentCellId: string,
    currentDocument: CodexCellDocument,
    shouldUpdateValue = false
) {
    // Prevent LLM completion on source files
    if (currentDocument?.uri.fsPath.endsWith(".source")) {
        console.warn(
            "Attempted to perform LLM completion on a source file. This operation is not allowed."
        );
        return;
    }
    if (!currentDocument) {
        console.warn("No current document found when trying to perform LLM completion");
        return;
    }

    // Get the provider to access the unified queue
    const provider = getProvider();
    if (!provider) {
        console.warn("Could not find provider when trying to perform LLM completion");
        return;
    }

    // Use the provider's enqueueTranslation method to add to the unified queue
    try {
        return await provider.enqueueTranslation(currentCellId, currentDocument, shouldUpdateValue);
    } catch (error) {
        console.error("Error in performLLMCompletion:", error);
        vscode.window.showErrorMessage(
            `LLM completion failed: ${error instanceof Error ? error.message : String(error)}`
        );
        throw error;
    }
}

// export function createMessageHandlers(provider: CodexCellEditorProvider) {
export const handleGlobalMessage = async (
    provider: CodexCellEditorProvider,
    event: GlobalMessage
) => {
    console.log("handleGlobalMessage", { event });
    switch (event.command) {
        case "applyTranslation": {
            console.log("applyTranslation message received", { event });
            if (provider.currentDocument && event.content.type === "cellAndText") {
                provider.currentDocument.updateCellContent(
                    event.content.cellId,
                    event.content.text,
                    EditType.LLM_GENERATION
                );
            }
            break;
        }
        // Add more cases here for other global message commands
    }
};

export const handleMessages = async (
    event: EditorPostMessages,
    webviewPanel: vscode.WebviewPanel,
    document: CodexCellDocument,
    updateWebview: () => void,
    provider: CodexCellEditorProvider
) => {
    switch (event.command) {
        case "webviewReady":
            // The webview is ready to receive messages
            console.log("Webview is ready");
            return;
        case "requestUsername": {
            // Send the current username to the webview
            try {
                const api = await getAuthApi();
                const username = api ? api.username : "anonymous_user";
                console.log("Sending username to webview:", username);
                webviewPanel.webview.postMessage({
                    type: "setUsername",
                    value: username,
                });
            } catch (error) {
                console.error("Error getting username:", error);
                // Send a default username if there's an error
                webviewPanel.webview.postMessage({
                    type: "setUsername",
                    value: "anonymous_user",
                });
            }
            return;
        }
        case "addWord": {
            try {
                const result = await vscode.commands.executeCommand(
                    "spellcheck.addWord",
                    event.words
                );
                webviewPanel.webview.postMessage({
                    type: "wordAdded",
                    content: event.words,
                });
            } catch (error) {
                console.error("Error adding word:", error);
                vscode.window.showErrorMessage(`Failed to add word to dictionary:`);
            }
            return;
        }

        case "searchSimilarCellIds": {
            try {
                const response = await vscode.commands.executeCommand<
                    Array<{ cellId: string; score: number }>
                >(
                    "translators-copilot.searchSimilarCellIds",
                    event.content.cellId,
                    5, // Default k value from searchSimilarCellIds
                    0.2 // Default fuzziness from searchSimilarCellIds
                );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsSimilarCellIdsResponse",
                    content: response || [], // Ensure we always return an array
                });
            } catch (error) {
                console.error("Error searching for similar cell IDs:", error);
                vscode.window.showErrorMessage("Failed to search for similar cell IDs.");
            }
            return;
        }
        case "from-quill-spellcheck-getSpellCheckResponse": {
            try {
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const currentSpellcheckIsEnabledValue = config.get("spellcheckIsEnabled", false);
                if (!currentSpellcheckIsEnabledValue) {
                    console.log("Spellcheck is disabled, skipping spell check");
                    return;
                }

                const response = await vscode.commands.executeCommand(
                    "translators-copilot.spellCheckText",
                    event.content.cellContent
                );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsSpellCheckResponse",
                    content: response as SpellCheckResponse,
                });
            } catch (error) {
                console.error("Error during spell check:", error);
                vscode.window.showErrorMessage("Spell check failed.");
            }
            return;
        }

        case "getAlertCodes": {
            try {
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const currentSpellcheckIsEnabledValue = config.get("spellcheckIsEnabled", false);
                if (!currentSpellcheckIsEnabledValue) {
                    console.log("Spellcheck is disabled, skipping alert codes");
                    return;
                }
                const result: AlertCodesServerResponse = await vscode.commands.executeCommand(
                    "translators-copilot.alertCodes",
                    event.content
                );

                const content: { [cellId: string]: number } = {};

                result.forEach((item) => {
                    content[item.cellId] = item.code;
                });

                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsgetAlertCodeResponse",
                    content,
                });
            } catch (error) {
                console.error("Error during getAlertCode:", error);
                // vscode.window.showErrorMessage(
                //     "Failed to check if text is problematic."
                // );
            }
            return;
        }
        case "saveHtml":
            try {
                // Only allow updates to the document that sent the message
                if (document.uri.toString() !== (event.content.uri || document.uri.toString())) {
                    console.warn(
                        "Attempted to update content in a different file. This operation is not allowed."
                    );
                    return;
                }

                const oldContent = document.getCellContent(event.content.cellMarkers[0]);
                const oldText = oldContent?.cellContent || "";
                const newText = event.content.cellContent || "";

                // Only record ICE edit if content actually changed
                if (oldText !== newText) {
                    await vscode.commands.executeCommand(
                        "codex-smart-edits.recordIceEdit",
                        oldText,
                        newText
                    );

                    // Mark file as dirty
                    provider.updateFileStatus("dirty");
                }

                document.updateCellContent(
                    event.content.cellMarkers[0],
                    event.content.cellContent === "<span></span>" ? "" : event.content.cellContent,
                    EditType.USER_EDIT
                );
            } catch (error) {
                console.error("Error saving HTML:", error);
                vscode.window.showErrorMessage("Failed to save HTML content.");
            }
            return;
        case "getContent":
            updateWebview();
            return;
        case "setCurrentIdToGlobalState":
            try {
                const uri = document.uri.toString();
                provider.updateCellIdState(event.content.currentLineId, uri);
            } catch (error) {
                console.error("Error setting current ID to global state:", error);
                vscode.window.showErrorMessage("Failed to set current ID in global state.");
            }
            return;
        case "llmCompletion": {
            try {
                debug("llmCompletion message received", {
                    event,
                    document,
                    provider,
                    webviewPanel,
                    updateWebview,
                });

                const cellId = event.content.currentLineId;
                const addContentToValue = event.content.addContentToValue;

                // Directly add to the unified translation queue
                const completionResult = await provider.enqueueTranslation(
                    cellId,
                    document,
                    addContentToValue
                );

                // Send the result back to the webview when complete
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsLLMCompletionResponse",
                    content: {
                        completion: completionResult || "",
                    },
                });
            } catch (error) {
                console.error("Error during LLM completion:", error);
                vscode.window.showErrorMessage("LLM completion failed.");

                // Use provider state management for failure
                const errorMessage = error instanceof Error ? error.message : String(error);
                provider.failSingleCellTranslation(errorMessage);
            }
            return;
        }
        case "stopAutocompleteChapter": {
            console.log("stopAutocompleteChapter message received");
            try {
                // Call the method to cancel the ongoing operation
                const cancelled = provider.cancelAutocompleteChapter();

                if (cancelled) {
                    vscode.window.showInformationMessage("Autocomplete operation stopped.");
                } else {
                    console.log("No active autocomplete operation to stop");
                }

                // Provider's cancelAutocompleteChapter already handles updating the state and broadcasting
            } catch (error) {
                console.error("Error stopping autocomplete chapter:", error);
                vscode.window.showErrorMessage("Failed to stop autocomplete operation.");
            }
            return;
        }
        case "stopSingleCellTranslation" as any: {
            console.log("stopSingleCellTranslation message received");
            try {
                // Only attempt to clear if we have a provider
                if (provider) {
                    // Single cell translations will have a specific flag set
                    if (provider.singleCellTranslationState.isProcessing) {
                        // Clear the queue and reset state
                        provider.clearTranslationQueue();
                        provider.completeSingleCellTranslation();

                        vscode.window.showInformationMessage("Translation cancelled.");
                    }
                }
            } catch (error) {
                console.error("Error stopping single cell translations:", error);
                vscode.window.showErrorMessage("Failed to stop translation.");
            }
            return;
        }
        case "cellError" as any: {
            console.log("cellError message received", { event });
            try {
                // Extract cell ID from the event content safely
                const cellId = (event as any).content?.cellId;
                if (cellId && typeof cellId === "string") {
                    // Mark the cell as complete in the provider's state tracking
                    provider.markCellComplete(cellId);
                }
            } catch (error) {
                console.error("Error handling cell error:", error);
            }
            return;
        }
        case "requestAutocompleteChapter": {
            console.log("requestAutocompleteChapter message received", { event });
            try {
                await provider.performAutocompleteChapter(
                    document,
                    webviewPanel,
                    event.content as QuillCellContent[]
                );
            } catch (error) {
                console.error("Error during autocomplete chapter:", error);
                vscode.window.showErrorMessage("Autocomplete chapter failed.");
            }
            return;
        }
        case "updateTextDirection": {
            try {
                const updatedMetadata = {
                    textDirection: event.direction,
                };
                await document.updateNotebookMetadata(updatedMetadata);
                await document.save(new vscode.CancellationTokenSource().token);
                console.log("Text direction updated successfully.");
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesNotebookMetadataForWebview",
                    content: await document.getNotebookMetadata(),
                });
            } catch (error) {
                console.error("Error updating notebook text direction:", error);
                vscode.window.showErrorMessage("Failed to update text direction.");
            }
            return;
        }
        case "getSourceText": {
            try {
                const sourceText = (await vscode.commands.executeCommand(
                    "translators-copilot.getSourceCellByCellIdFromAllSourceCells",
                    event.content.cellId
                )) as { cellId: string; content: string };
                console.log("providerSendsSourceText", { sourceText });
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsSourceText",
                    content: sourceText.content,
                });
            } catch (error) {
                console.error("Error getting source text:", error);
                vscode.window.showErrorMessage("Failed to get source text.");
            }
            return;
        }
        case "openSourceText": {
            try {
                const workspaceFolderUri = getWorkSpaceUri();
                if (!workspaceFolderUri) {
                    throw new Error("No workspace folder found");
                }
                const currentFileName = document.uri.fsPath;
                const baseFileName = path.basename(currentFileName);
                const sourceFileName = baseFileName.replace(".codex", ".source");
                const sourceUri = vscode.Uri.joinPath(
                    workspaceFolderUri,
                    ".project",
                    "sourceTexts",
                    sourceFileName
                );

                await vscode.commands.executeCommand("codexNotebookTreeView.openSourceFile", {
                    sourceFileUri: sourceUri,
                });
                provider.postMessageToWebview(webviewPanel, {
                    type: "jumpToSection",
                    content: event.content.chapterNumber.toString(),
                });
            } catch (error) {
                console.error("Error opening source text:", error);
                vscode.window.showErrorMessage("Failed to open source text.");
            }
            return;
        }
        case "makeChildOfCell": {
            try {
                document.addCell(
                    event.content.newCellId,
                    event.content.referenceCellId,
                    event.content.direction,
                    event.content.cellType,
                    event.content.data
                );
            } catch (error) {
                console.error("Error making child:", error);
                vscode.window.showErrorMessage("Failed to make child.");
            }
            return;
        }
        case "deleteCell": {
            console.log("deleteCell message received", { event });
            try {
                document.deleteCell(event.content.cellId);
            } catch (error) {
                console.error("Error deleting cell:", error);
                vscode.window.showErrorMessage("Failed to delete cell.");
            }
            return;
        }
        case "updateCellTimestamps": {
            console.log("updateCellTimestamps message received", { event });
            try {
                document.updateCellTimestamps(event.content.cellId, event.content.timestamps);
            } catch (error) {
                console.error("Error updating cell timestamps:", error);
                vscode.window.showErrorMessage("Failed to update cell timestamps.");
            }
            return;
        }
        case "updateCellLabel": {
            console.log("updateCellLabel message received", { event });
            try {
                document.updateCellLabel(event.content.cellId, event.content.cellLabel);
            } catch (error) {
                console.error("Error updating cell label:", error);
                vscode.window.showErrorMessage("Failed to update cell label.");
            }
            return;
        }
        case "updateNotebookMetadata": {
            console.log("updateNotebookMetadata message received", { event });
            try {
                const newMetadata = event.content;
                await document.updateNotebookMetadata(newMetadata);
                await document.save(new vscode.CancellationTokenSource().token);
                vscode.window.showInformationMessage("Notebook metadata updated successfully.");

                // Refresh the entire webview to ensure all data is up-to-date
                provider.refreshWebview(webviewPanel, document);
            } catch (error) {
                console.error("Error updating notebook metadata:", error);
                vscode.window.showErrorMessage("Failed to update notebook metadata.");
            }
            return;
        }
        case "pickVideoFile": {
            console.log("pickVideoFile message received", { event });
            try {
                const result = await vscode.window.showOpenDialog({
                    canSelectMany: false,
                    openLabel: "Select Video File",
                    filters: {
                        Videos: ["mp4", "mkv", "avi", "mov"],
                    },
                });
                const fileUri = result?.[0];
                if (fileUri) {
                    const videoUrl = fileUri.toString();
                    await document.updateNotebookMetadata({ videoUrl });
                    await document.save(new vscode.CancellationTokenSource().token);
                    provider.refreshWebview(webviewPanel, document);
                }
            } catch (error) {
                console.error("Error picking video file:", error);
                vscode.window.showErrorMessage("Failed to pick video file.");
            }
            return;
        }
        case "replaceDuplicateCells": {
            console.log("replaceDuplicateCells message received", { event });
            try {
                document.replaceDuplicateCells(event.content);
            } catch (error) {
                console.error("Error replacing duplicate cells:", error);
                vscode.window.showErrorMessage("Failed to replace duplicate cells.");
            }
            return;
        }
        case "saveTimeBlocks": {
            console.log("saveTimeBlocks message received", { event });
            try {
                event.content.forEach((cell) => {
                    document.updateCellTimestamps(cell.id, {
                        startTime: cell.begin,
                        endTime: cell.end,
                    });
                });
            } catch (error) {
                console.error("Error updating cell timestamps:", error);
                vscode.window.showErrorMessage("Failed to update cell timestamps.");
            }
            return;
        }

        case "supplyRecentEditHistory": {
            console.log("supplyRecentEditHistory message received", { event });
            const result = await vscode.commands.executeCommand(
                "codex-smart-edits.supplyRecentEditHistory",
                event.content.cellId,
                event.content.editHistory
            );
            return;
        }
        case "exportFile": {
            try {
                // Get the notebook filename to use as base for the exported filename
                const notebookName = path.parse(document.uri.fsPath).name;
                const fileExtension = event.content.format;
                const fileName = `${notebookName}.${fileExtension}`;

                // Show save file dialog with appropriate filters
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(fileName),
                    filters: {
                        "Subtitle files": ["vtt", "srt"],
                    },
                });

                if (saveUri) {
                    await vscode.workspace.fs.writeFile(
                        saveUri,
                        Buffer.from(event.content.subtitleData, "utf-8")
                    );

                    vscode.window.showInformationMessage(
                        `File exported successfully as ${fileExtension.toUpperCase()}`
                    );
                }
            } catch (error) {
                console.error("Error exporting file:", error);
                vscode.window.showErrorMessage(
                    `Failed to export ${event.content.format.toUpperCase()} file`
                );
            }
            return;
        }
        case "executeCommand": {
            try {
                await vscode.commands.executeCommand(event.content.command, ...event.content.args);
            } catch (error) {
                console.error("Error executing command:", error);
                vscode.window.showErrorMessage(
                    `Failed to execute command: ${event.content.command}`
                );
            }
            return;
        }
        case "togglePinPrompt": {
            console.log("togglePinPrompt message received", { event });
            await vscode.commands.executeCommand(
                "codex-smart-edits.togglePinPrompt",
                event.content.cellId,
                event.content.promptText
            );
            return;
        }
        case "generateBacktranslation": {
            try {
                const backtranslation =
                    await vscode.commands.executeCommand<SavedBacktranslation | null>(
                        "codex-smart-edits.generateBacktranslation",
                        event.content.text,
                        event.content.cellId
                    );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsBacktranslation",
                    content: backtranslation,
                });
            } catch (error) {
                console.error("Error generating backtranslation:", error);
                vscode.window.showErrorMessage("Failed to generate backtranslation.");
            }
            return;
        }

        case "editBacktranslation": {
            try {
                const updatedBacktranslation =
                    await vscode.commands.executeCommand<SavedBacktranslation | null>(
                        "codex-smart-edits.editBacktranslation",
                        event.content.cellId,
                        event.content.newText,
                        event.content.existingBacktranslation
                    );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsUpdatedBacktranslation",
                    content: updatedBacktranslation,
                });
            } catch (error) {
                console.error("Error editing backtranslation:", error);
                vscode.window.showErrorMessage("Failed to edit backtranslation.");
            }
            return;
        }

        case "getBacktranslation": {
            try {
                const backtranslation =
                    await vscode.commands.executeCommand<SavedBacktranslation | null>(
                        "codex-smart-edits.getBacktranslation",
                        event.content.cellId
                    );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsExistingBacktranslation",
                    content: backtranslation,
                });
            } catch (error) {
                console.error("Error getting backtranslation:", error);
                vscode.window.showErrorMessage("Failed to get backtranslation.");
            }
            return;
        }

        case "setBacktranslation": {
            try {
                const backtranslation =
                    await vscode.commands.executeCommand<SavedBacktranslation | null>(
                        "codex-smart-edits.setBacktranslation",
                        event.content.cellId,
                        event.content.originalText,
                        event.content.userBacktranslation
                    );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerConfirmsBacktranslationSet",
                    content: backtranslation,
                });
            } catch (error) {
                console.error("Error setting backtranslation:", error);
                vscode.window.showErrorMessage("Failed to set backtranslation.");
            }
            return;
        }

        case "rejectEditSuggestion": {
            try {
                await vscode.commands.executeCommand(
                    "codex-smart-edits.rejectEditSuggestion",
                    event.content
                );
            } catch (error) {
                console.error("Error rejecting edit suggestion:", error);
                vscode.window.showErrorMessage("Failed to reject edit suggestion.");
            }
            return;
        }

        case "webviewFocused": {
            try {
                if (provider.currentDocument && event.content?.uri) {
                    // Only update if we have both a document and a valid URI
                    const newUri = vscode.Uri.parse(event.content.uri);
                    if (newUri.scheme === "file") {
                        // Ensure it's a valid file URI
                        provider.currentDocument.updateUri(newUri);
                    }
                }
            } catch (error) {
                console.error("Error handling webview focus:", error, event);
                vscode.window.showErrorMessage("Failed to update document reference on focus");
            }
            return;
        }
        case "updateCachedChapter": {
            await provider.updateCachedChapter(document.uri.toString(), event.content);
            return;
        }
        case "updateCellDisplayMode": {
            try {
                const updatedMetadata = {
                    cellDisplayMode: event.mode,
                };
                await document.updateNotebookMetadata(updatedMetadata);
                await document.save(new vscode.CancellationTokenSource().token);
                console.log("Cell display mode updated successfully.");
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesNotebookMetadataForWebview",
                    content: await document.getNotebookMetadata(),
                });
            } catch (error) {
                console.error("Error updating cell display mode:", error);
                vscode.window.showErrorMessage("Failed to update cell display mode.");
            }
            return;
        }
        case "validateCell":
            if (event.content && event.content.cellId) {
                try {
                    // Directly queue the validation for immediate processing
                    await provider.enqueueValidation(
                        event.content.cellId,
                        document,
                        event.content.validate
                    );

                    // Update is now handled within the queue processing
                } catch (error) {
                    console.error(`Error validating cell ${event.content.cellId}:`, error);
                    vscode.window.showErrorMessage("Failed to validate cell.");
                }
            }
            break;
        case "getValidationCount": {
            try {
                // Get the configured number of validations required from settings
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const validationCount = config.get("validationCount", 1);
                provider.postMessageToWebview(webviewPanel, {
                    type: "validationCount",
                    content: validationCount,
                });
            } catch (error) {
                console.error("Error getting validation count:", error);
                vscode.window.showErrorMessage("Failed to get validation count.");
            }
            return;
        }
        case "getCurrentUsername": {
            try {
                const authApi = await provider.getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                const username = userInfo?.username || "anonymous";

                provider.postMessageToWebview(webviewPanel, {
                    type: "currentUsername",
                    content: { username },
                });
            } catch (error) {
                console.error("Error getting current username:", error);
                // vscode.window.showErrorMessage("Failed to get current username.");
            }
            return;
        }
        case "togglePrimarySidebar": {
            vscode.window.showInformationMessage("togglePrimarySidebar");
            try {
                await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
                await vscode.commands.executeCommand("codex-editor.mainMenu.focus");
            } catch (error) {
                console.error("Error toggling primary sidebar:", error);
                vscode.window.showErrorMessage("Failed to toggle primary sidebar");
            }
            return;
        }
        case "toggleSecondarySidebar": {
            try {
                await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
            } catch (error) {
                console.error("Error toggling secondary sidebar:", error);
                vscode.window.showErrorMessage("Failed to toggle secondary sidebar");
            }
            return;
        }
        case "getEditorPosition": {
            try {
                const activeEditor = vscode.window.activeTextEditor;
                let position = "unknown";

                if (activeEditor) {
                    // Get all visible editors to determine the layout
                    const visibleEditors = vscode.window.visibleTextEditors;

                    // If there's only one editor, it's both leftmost and rightmost
                    if (visibleEditors.length <= 1) {
                        position = "single";
                    } else {
                        // Sort editors by their view column
                        const sortedEditors = [...visibleEditors].sort(
                            (a, b) => (a.viewColumn || 0) - (b.viewColumn || 0)
                        );

                        // Find the index of the active editor in the sorted array
                        const activeEditorIndex = sortedEditors.findIndex(
                            (editor) =>
                                editor.document.uri.toString() ===
                                activeEditor.document.uri.toString()
                        );

                        if (activeEditorIndex === 0) {
                            position = "leftmost";
                        } else if (activeEditorIndex === sortedEditors.length - 1) {
                            position = "rightmost";
                        } else {
                            position = "center";
                        }
                    }
                }

                webviewPanel.webview.postMessage({
                    type: "editorPosition",
                    position,
                });
            } catch (error) {
                console.error("Error determining editor position:", error);
                webviewPanel.webview.postMessage({
                    type: "editorPosition",
                    position: "unknown",
                });
            }
            return;
        }
        case "queueValidation":
            if (event.content && event.content.cellId) {
                try {
                    // Queue the validation instead of processing immediately
                    provider.queueValidation(
                        event.content.cellId,
                        document,
                        event.content.validate,
                        event.content.pending
                    );

                    // No need to call updateWebview - pending state is handled via messages
                } catch (error) {
                    console.error(
                        `Error queuing validation for cell ${event.content.cellId}:`,
                        error
                    );
                    vscode.window.showErrorMessage("Failed to queue validation.");
                }
            }
            break;
        case "applyPendingValidations":
            try {
                await provider.applyPendingValidations();
                // Webview updates will be handled by the validation process
            } catch (error) {
                console.error("Error applying pending validations:", error);
                vscode.window.showErrorMessage("Failed to apply validations.");
            }
            break;
        case "clearPendingValidations":
            try {
                // Clear all pending validations without applying them
                provider.clearPendingValidations();

                // Webview updates will be handled by the provider
            } catch (error) {
                console.error("Error clearing pending validations:", error);
                vscode.window.showErrorMessage("Failed to clear validations.");
            }
            break;
        case "jumpToChapter":
            try {
                provider.updateCachedChapter(document.uri.toString(), event.chapterNumber);
                provider.postMessageToWebview(webviewPanel, {
                    type: "setChapterNumber",
                    content: event.chapterNumber,
                });
            } catch (error) {
                console.error("Error jumping to chapter:", error);
                vscode.window.showErrorMessage("Failed to jump to chapter.");
            }
            return;
        case "closeCurrentDocument":
            try {
                console.log("Close document request received:", event.content);
                // Get the URI from the content if available
                const fileUri = event.content?.uri;
                const isSourceDocument = event.content?.isSource === true;

                if (fileUri) {
                    // We have a specific URI to close
                    const urisToCheck = [
                        // Check as-is
                        vscode.Uri.file(fileUri),
                        // Also check with file:// prefix if not already present
                        !fileUri.startsWith("file://") ? vscode.Uri.file(fileUri) : undefined,
                    ].filter((uri): uri is vscode.Uri => uri !== undefined);

                    // Get all visible editors
                    const visibleEditors = vscode.window.visibleTextEditors;
                    let found = false;

                    // Try to find the editor with the matching URI
                    for (const uri of urisToCheck) {
                        if (found) break;

                        for (const editor of visibleEditors) {
                            // Compare file system paths to account for different URI formats
                            if (editor.document.uri.fsPath === uri.fsPath) {
                                // Found the editor we want to close
                                await vscode.window.showTextDocument(
                                    editor.document,
                                    editor.viewColumn
                                );
                                await vscode.commands.executeCommand(
                                    "workbench.action.closeActiveEditor"
                                );
                                found = true;
                                break;
                            }
                        }
                    }

                    if (!found) {
                        // Fallback to just closing the active editor
                        console.log(
                            "Could not find the specific editor to close, closing active editor"
                        );
                        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    }
                } else if (isSourceDocument) {
                    // For source documents without specific URI, try to find by extension
                    const visibleEditors = vscode.window.visibleTextEditors;
                    let found = false;

                    for (const editor of visibleEditors) {
                        if (editor.document.uri.fsPath.endsWith(".source")) {
                            // Found a source editor to close
                            await vscode.window.showTextDocument(
                                editor.document,
                                editor.viewColumn
                            );
                            await vscode.commands.executeCommand(
                                "workbench.action.closeActiveEditor"
                            );
                            found = true;
                            break;
                        }
                    }

                    if (!found) {
                        // Fallback to just closing the active editor
                        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    }
                } else {
                    // No URI and not source, just close the active editor
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                }
            } catch (error) {
                console.error("Error closing document:", error);
                vscode.window.showErrorMessage("Failed to close document.");
            }
            return;
        case "toggleSidebar": {
            console.log("toggleSidebar message received");
            try {
                // Toggle main menu visibility
                await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");

                // Only focus the main menu if we're opening the sidebar (not closing it)
                if (event.content?.isOpening) {
                    await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
                }
            } catch (error) {
                console.error("Error toggling main menu visibility:", error);
                vscode.window.showErrorMessage("Failed to toggle sidebar visibility.");
            }
            return;
        }
        case "triggerSync": {
            console.log("triggerSync message received");
            try {
                // Trigger an immediate sync using the provider's method
                provider.triggerSync();
            } catch (error) {
                console.error("Error triggering sync:", error);
                vscode.window.showErrorMessage("Failed to trigger sync.");
            }
            return;
        }
        case "triggerReindexing": {
            console.log("Triggering reindexing after all translations completed");
            // Execute the force reindex command - this will ensure all indices are updated
            await vscode.commands.executeCommand("translators-copilot.forceReindex");
            break;
        }
        case "requestAudioAttachments": {
            console.log("requestAudioAttachments message received");
            try {
                const audioAttachments = await scanForAudioAttachments(document, webviewPanel);

                // Convert to boolean mapping for webview
                const audioCells: { [cellId: string]: boolean } = {};
                for (const cellId of Object.keys(audioAttachments)) {
                    audioCells[cellId] = true;
                }

                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsAudioAttachments",
                    attachments: audioCells,
                });
            } catch (error) {
                console.error("Error requesting audio attachments:", error);
                vscode.window.showErrorMessage("Failed to request audio attachments.");
            }
            return;
        }
        case "requestAudioForCell": {
            console.log("requestAudioForCell message received for cell:", event.content.cellId);
            try {
                const cellId = event.content.cellId;
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    debug("No workspace folder found");
                    return;
                }

                // Get the document data to check cell metadata
                const documentText = document.getText();
                const notebookData = JSON.parse(documentText);

                // Find the specific cell
                if (notebookData.cells && Array.isArray(notebookData.cells)) {
                    const cell = notebookData.cells.find((c: any) => c.metadata?.id === cellId);

                    if (cell?.metadata?.attachments) {
                        // Check for audio attachments in metadata
                        for (const [attachmentId, attachment] of Object.entries(cell.metadata.attachments)) {
                            if (attachment && (attachment as any).type === "audio") {
                                const attachmentPath = (attachment as any).url;
                                const fullPath = path.isAbsolute(attachmentPath)
                                    ? attachmentPath
                                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                                try {
                                    if (fs.existsSync(fullPath)) {
                                        const fileData = await fs.promises.readFile(fullPath);
                                        const base64Data = `data:audio/webm;base64,${fileData.toString('base64')}`;

                                        // Send the audio data to the webview
                                        webviewPanel.webview.postMessage({
                                            type: "providerSendsAudioData",
                                            content: {
                                                cellId: cellId,
                                                audioId: attachmentId,
                                                audioData: base64Data
                                            }
                                        });

                                        debug("Sent audio data for cell:", cellId);
                                        return; // Found and sent, we're done
                                    }
                                } catch (err) {
                                    console.error(`Error reading audio file ${fullPath}:`, err);
                                }
                            }
                        }
                    }
                }

                // If no attachment in metadata, check filesystem for legacy files
                const bookAbbr = cellId.split(' ')[0];
                const attachmentsPath = path.join(
                    workspaceFolder.uri.fsPath,
                    ".project",
                    "attachments",
                    bookAbbr
                );

                if (fs.existsSync(attachmentsPath)) {
                    const files = fs.readdirSync(attachmentsPath);
                    const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];

                    for (const audioFile of files) {
                        if (audioExtensions.some(ext => audioFile.toLowerCase().endsWith(ext))) {
                            // Check if this file matches the cell
                            const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                            if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                                const fullPath = path.join(attachmentsPath, audioFile);

                                try {
                                    const fileData = await fs.promises.readFile(fullPath);
                                    const mimeType = audioFile.endsWith('.webm') ? 'audio/webm' :
                                        audioFile.endsWith('.mp3') ? 'audio/mp3' :
                                            audioFile.endsWith('.m4a') ? 'audio/mp4' :
                                                audioFile.endsWith('.ogg') ? 'audio/ogg' :
                                                    'audio/wav';
                                    const base64Data = `data:${mimeType};base64,${fileData.toString('base64')}`;

                                    webviewPanel.webview.postMessage({
                                        type: "providerSendsAudioData",
                                        content: {
                                            cellId: cellId,
                                            audioId: audioFile.replace(/\.[^/.]+$/, ""),
                                            audioData: base64Data
                                        }
                                    });

                                    debug("Sent legacy audio data for cell:", cellId);
                                    return; // Found and sent
                                } catch (err) {
                                    console.error(`Error reading audio file ${fullPath}:`, err);
                                }
                            }
                        }
                    }
                }

                debug("No audio attachment found for cell:", cellId);
            } catch (error) {
                console.error("Error requesting audio for cell:", error);
            }
            return;
        }
        case "saveAudioAttachment": {
            console.log("saveAudioAttachment message received", {
                cellId: event.content.cellId,
                audioId: event.content.audioId,
                fileExtension: event.content.fileExtension
            });
            try {
                // Extract document segment from cellId (e.g., "JUD" from "JUD 1:1")
                const documentSegment = event.content.cellId.split(' ')[0];

                // Get workspace folder
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }

                // Build the attachments directory path
                const attachmentsDir = path.join(
                    workspaceFolder.uri.fsPath,
                    ".project",
                    "attachments",
                    documentSegment
                );

                // Ensure directory exists
                await fs.promises.mkdir(attachmentsDir, { recursive: true });

                // Build the full file path
                const fileName = `${event.content.audioId}.${event.content.fileExtension}`;
                const filePath = path.join(attachmentsDir, fileName);

                // Extract base64 data (remove data URL prefix)
                const base64Data = event.content.audioData.split(',')[1] || event.content.audioData;
                const buffer = Buffer.from(base64Data, 'base64');

                // Write the file
                await fs.promises.writeFile(filePath, buffer);

                // Update cell metadata with attachment reference
                const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
                await document.updateCellAttachment(event.content.cellId, event.content.audioId, {
                    url: relativePath,
                    type: "audio"
                });

                // Send success response
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioAttachmentSaved",
                    content: {
                        cellId: event.content.cellId,
                        audioId: event.content.audioId,
                        success: true
                    }
                });

                // Rescan and send updated audio attachments
                const updatedAudioAttachments = await scanForAudioAttachments(document, webviewPanel);
                const audioCells: { [cellId: string]: boolean } = {};
                for (const cellId of Object.keys(updatedAudioAttachments)) {
                    audioCells[cellId] = true;
                }

                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsAudioAttachments",
                    attachments: audioCells as any,
                });

                debug("Audio attachment saved successfully:", filePath);
            } catch (error) {
                console.error("Error saving audio attachment:", error);
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioAttachmentSaved",
                    content: {
                        cellId: event.content.cellId,
                        audioId: event.content.audioId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
                vscode.window.showErrorMessage("Failed to save audio attachment.");
            }
            return;
        }
        case "deleteAudioAttachment": {
            console.log("deleteAudioAttachment message received", {
                cellId: event.content.cellId,
                audioId: event.content.audioId
            });
            try {
                // Get workspace folder
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }

                // Extract document segment from cellId
                const documentSegment = event.content.cellId.split(' ')[0];

                // Build the attachments directory path
                const attachmentsDir = path.join(
                    workspaceFolder.uri.fsPath,
                    ".project",
                    "attachments",
                    documentSegment
                );

                // Find and delete the file with the given audioId
                try {
                    const files = await fs.promises.readdir(attachmentsDir);
                    const audioFile = files.find(file => file.startsWith(event.content.audioId));

                    if (audioFile) {
                        const filePath = path.join(attachmentsDir, audioFile);
                        await fs.promises.unlink(filePath);
                        debug("Deleted audio file:", filePath);
                    }
                } catch (err) {
                    // Directory might not exist if no attachments
                    debug("Error reading attachments directory:", err);
                }

                // Remove attachment from cell metadata
                await document.removeCellAttachment(event.content.cellId, event.content.audioId);

                // Send success response
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioAttachmentDeleted",
                    content: {
                        cellId: event.content.cellId,
                        audioId: event.content.audioId,
                        success: true
                    }
                });

                // Rescan and send updated audio attachments
                const updatedAudioAttachments = await scanForAudioAttachments(document, webviewPanel);
                const audioCells: { [cellId: string]: boolean } = {};
                for (const cellId of Object.keys(updatedAudioAttachments)) {
                    audioCells[cellId] = true;
                }

                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsAudioAttachments",
                    attachments: audioCells as any,
                });

                debug("Audio attachment deleted successfully");
            } catch (error) {
                console.error("Error deleting audio attachment:", error);
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioAttachmentDeleted",
                    content: {
                        cellId: event.content.cellId,
                        audioId: event.content.audioId,
                        success: false,
                        error: error instanceof Error ? error.message : String(error)
                    }
                });
                vscode.window.showErrorMessage("Failed to delete audio attachment.");
            }
            return;
        }
    }
};

/**
 * Scans for audio attachments that match cells in the current document
 * @param document The current CodexCellDocument
 * @returns A mapping of cellId to audio file path
 */
export async function scanForAudioAttachments(
    document: CodexCellDocument,
    webviewPanel: vscode.WebviewPanel
): Promise<{ [cellId: string]: string }> {
    debug("Scanning for audio attachments for document:", document.uri.toString());

    const audioAttachments: { [cellId: string]: string } = {};

    try {
        // Get the workspace folder
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            debug("No workspace folder found");
            return audioAttachments;
        }

        // Get the document data to find all cell IDs
        const documentText = document.getText();
        const notebookData = JSON.parse(documentText);

        // Process each cell in the document
        if (notebookData.cells && Array.isArray(notebookData.cells)) {
            for (const cell of notebookData.cells) {
                if (cell.metadata && cell.metadata.id) {
                    const cellId = cell.metadata.id;

                    // Check if cell has attachments in metadata
                    if (cell.metadata.attachments) {
                        for (const [attachmentId, attachment] of Object.entries(cell.metadata.attachments)) {
                            if (attachment && (attachment as any).type === "audio") {
                                const attachmentPath = (attachment as any).url;

                                // Build full path
                                const fullPath = path.isAbsolute(attachmentPath)
                                    ? attachmentPath
                                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                                try {
                                    // Check if file exists and read it
                                    if (fs.existsSync(fullPath)) {
                                        const fileData = await fs.promises.readFile(fullPath);
                                        const base64Data = `data:audio/webm;base64,${fileData.toString('base64')}`;

                                        // Send the audio data to the webview
                                        webviewPanel.webview.postMessage({
                                            type: "providerSendsAudioData",
                                            content: {
                                                cellId: cellId,
                                                audioId: attachmentId,
                                                audioData: base64Data
                                            }
                                        });

                                        audioAttachments[cellId] = fullPath;
                                        debug("Found audio attachment in metadata:", {
                                            cellId,
                                            attachmentId,
                                            path: fullPath
                                        });
                                    }
                                } catch (err) {
                                    console.error(`Error reading audio file ${fullPath}:`, err);
                                }
                            }
                        }
                    }

                    // Also check the filesystem for legacy audio files
                    const bookAbbr = cellId.split(' ')[0];
                    const attachmentsPath = path.join(
                        workspaceFolder.uri.fsPath,
                        ".project",
                        "attachments",
                        bookAbbr
                    );

                    if (fs.existsSync(attachmentsPath)) {
                        try {
                            const files = fs.readdirSync(attachmentsPath);

                            // Look for any audio files that might match this cell
                            const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];
                            const audioFiles = files.filter(file =>
                                audioExtensions.some(ext => file.toLowerCase().endsWith(ext))
                            );

                            for (const audioFile of audioFiles) {
                                // Check if the file name contains the cell ID pattern
                                const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                                if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                                    const fullAudioPath = path.join(attachmentsPath, audioFile);

                                    // Only process if not already found in metadata
                                    if (!audioAttachments[cellId]) {
                                        try {
                                            // Read the file and send as base64
                                            const fileData = await fs.promises.readFile(fullAudioPath);
                                            const mimeType = audioFile.endsWith('.webm') ? 'audio/webm' :
                                                audioFile.endsWith('.mp3') ? 'audio/mp3' :
                                                    audioFile.endsWith('.m4a') ? 'audio/mp4' :
                                                        audioFile.endsWith('.ogg') ? 'audio/ogg' :
                                                            'audio/wav';
                                            const base64Data = `data:${mimeType};base64,${fileData.toString('base64')}`;

                                            // Send the audio data to the webview
                                            webviewPanel.webview.postMessage({
                                                type: "providerSendsAudioData",
                                                content: {
                                                    cellId: cellId,
                                                    audioId: audioFile.replace(/\.[^/.]+$/, ""), // Remove extension
                                                    audioData: base64Data
                                                }
                                            });

                                            audioAttachments[cellId] = fullAudioPath;
                                            debug("Found and sent legacy audio file:", {
                                                cellId,
                                                audioFile,
                                                path: fullAudioPath
                                            });
                                        } catch (err) {
                                            console.error(`Error reading legacy audio file ${fullAudioPath}:`, err);
                                        }
                                    }
                                }
                            }
                        } catch (err) {
                            debug("Error reading attachments directory:", err);
                        }
                    }
                }
            }
        }

        debug("Total audio attachments found:", Object.keys(audioAttachments).length);
    } catch (error) {
        console.error("Error scanning for audio attachments:", error);
    }

    return audioAttachments;
}
