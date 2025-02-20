import { CodexCellEditorProvider } from "./codexCellEditorProvider";
import * as vscode from "vscode";
import { EditType } from "../../../types/enums";
import {
    QuillCellContent,
    EditorPostMessages,
    SpellCheckResponse,
    AlertCodesServerResponse,
    GlobalMessage,
    GlobalContentType,
} from "../../../types";
import path from "path";
import { getWorkSpaceUri } from "../../utils";
import { SavedBacktranslation } from "../../smartEdits/smartBacktranslation";
import { CodexCellDocument } from "./codexDocument";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";
import { CodexNotebookReader } from "@/serializer";
import { llmCompletion } from "../translationSuggestions/llmCompletion";

const DEBUG_ENABLED = false;
function debug(...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CodexCellEditorMessageHandling]`, ...args);
    }
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

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Generating Translation",
            cancellable: false,
        },
        async (progress) => {
            try {
                progress.report({ message: "Fetching completion configuration..." });
                // Fetch completion configuration
                const completionConfig = await fetchCompletionConfig();
                const notebookReader = new CodexNotebookReader(currentDocument.uri);
                console.log("Document URI: ", notebookReader);

                progress.report({ message: "Generating translation with LLM..." });
                // Perform LLM completion
                const result = await llmCompletion(
                    notebookReader,
                    currentCellId,
                    completionConfig,
                    new vscode.CancellationTokenSource().token
                );

                progress.report({ message: "Updating document..." });
                // Update content and metadata atomically
                currentDocument.updateCellContent(
                    currentCellId,
                    result,
                    EditType.LLM_GENERATION,
                    shouldUpdateValue
                );

                console.log("LLM completion result", { result });
                return result;
            } catch (error: any) {
                console.error("Error in performLLMCompletion:", error);
                vscode.window.showErrorMessage(`LLM completion failed: ${error.message}`);
                throw error;
            }
        }
    );
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
                }

                document.updateCellContent(
                    event.content.cellMarkers[0],
                    event.content.cellContent,
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

                const completionResult = await performLLMCompletion(
                    event.content.currentLineId,
                    document
                );
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsLLMCompletionResponse",
                    content: {
                        completion: completionResult || "",
                    },
                });
            } catch (error) {
                console.error("Error during LLM completion:", error);
                vscode.window.showErrorMessage("LLM completion failed.");
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
        case "exportVttFile": {
            try {
                // Get the notebook filename to use as base for the VTT filename
                const notebookName = path.parse(document.uri.fsPath).name;
                const vttFileName = `${notebookName}.vtt`;

                // Show save file dialog
                const saveUri = await vscode.window.showSaveDialog({
                    defaultUri: vscode.Uri.file(vttFileName),
                    filters: {
                        "WebVTT files": ["vtt"],
                    },
                });

                if (saveUri) {
                    await vscode.workspace.fs.writeFile(
                        saveUri,
                        Buffer.from(event.content.subtitleData, "utf-8")
                    );

                    vscode.window.showInformationMessage(`VTT file exported successfully`);
                }
            } catch (error) {
                console.error("Error exporting VTT file:", error);
                vscode.window.showErrorMessage("Failed to export VTT file");
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
    }
};
