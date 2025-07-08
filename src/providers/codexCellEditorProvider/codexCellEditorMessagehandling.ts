import * as vscode from "vscode";
import { CodexCellDocument } from "./codexDocument";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
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
import { fetchCompletionConfig } from "@/utils/llmUtils";
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
const DEBUG_MODE = false;
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

// Centralized error handler wrapper
async function withErrorHandling<T>(
    operation: () => Promise<T> | T,
    context: string,
    showUserError: boolean = true
): Promise<T | undefined> {
    try {
        return await operation();
    } catch (error) {
        console.error(`Error ${context}:`, error);
        if (showUserError) {
            vscode.window.showErrorMessage(`Failed to ${context}.`);
        }
        return undefined;
    }
}

// Message handler context type
interface MessageHandlerContext {
    event: EditorPostMessages;
    webviewPanel: vscode.WebviewPanel;
    document: CodexCellDocument;
    updateWebview: () => void;
    provider: CodexCellEditorProvider;
}

// Individual message handlers
const messageHandlers: Record<string, (ctx: MessageHandlerContext) => Promise<void> | void> = {
    webviewReady: () => {
        console.log("Webview is ready");
    },

    addWord: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "addWord"; }>;
        await vscode.commands.executeCommand("spellcheck.addWord", typedEvent.words);
        safePostMessageToPanel(webviewPanel, {
            type: "wordAdded",
            content: typedEvent.words,
        });
    },

    searchSimilarCellIds: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "searchSimilarCellIds"; }>;
        const response = await vscode.commands.executeCommand<
            Array<{ cellId: string; score: number; }>
        >(
            "codex-editor-extension.searchSimilarCellIds",
            typedEvent.content.cellId,
            5,
            0.2
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsSimilarCellIdsResponse",
            content: response || [],
        });
    },

    "from-quill-spellcheck-getSpellCheckResponse": async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "from-quill-spellcheck-getSpellCheckResponse"; }>;
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const spellcheckEnabled = config.get("spellcheckIsEnabled", false);
        if (!spellcheckEnabled) {
            console.log("Spellcheck is disabled, skipping spell check");
            return;
        }

        const response = await vscode.commands.executeCommand(
            "codex-editor-extension.spellCheckText",
            typedEvent.content.cellContent
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsSpellCheckResponse",
            content: response as SpellCheckResponse,
        });
    },

    getAlertCodes: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getAlertCodes"; }>;

        try {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const spellcheckEnabled = config.get("spellcheckIsEnabled", false);

            if (!spellcheckEnabled) {
                console.log("[Message Handler] Spellcheck is disabled, skipping alert codes");
                return;
            }

            const result: AlertCodesServerResponse = await vscode.commands.executeCommand(
                "codex-editor-extension.alertCodes",
                typedEvent.content
            );

            const content: { [cellId: string]: number; } = {};
            result.forEach((item) => {
                content[item.cellId] = item.code;
            });

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsgetAlertCodeResponse",
                content,
            });
        } catch (error) {
            console.error("[Message Handler] Failed to get alert codes:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined,
                requestedCells: typedEvent?.content?.length || 0,
                cellIds: typedEvent?.content?.map(item => item.cellId) || [],
                errorType: error instanceof Error ? error.constructor.name : typeof error
            });

            // Provide fallback response with empty codes for all requested cells
            const content: { [cellId: string]: number; } = {};
            if (typedEvent?.content && Array.isArray(typedEvent.content)) {
                typedEvent.content.forEach((item) => {
                    content[item.cellId] = 0; // 0 = no alerts
                });
            }

            // Always send a response to prevent webview from waiting indefinitely
            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsgetAlertCodeResponse",
                content,
            });
        }
    },

    saveHtml: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveHtml"; }>;
        if (document.uri.toString() !== (typedEvent.content.uri || document.uri.toString())) {
            console.warn("Attempted to update content in a different file. This operation is not allowed.");
            return;
        }

        const oldContent = document.getCellContent(typedEvent.content.cellMarkers[0]);
        const oldText = oldContent?.cellContent || "";
        const newText = typedEvent.content.cellContent || "";

        if (oldText !== newText) {
            await vscode.commands.executeCommand(
                "codex-smart-edits.recordIceEdit",
                oldText,
                newText
            );
            provider.updateFileStatus("dirty");
        }

        document.updateCellContent(
            typedEvent.content.cellMarkers[0],
            typedEvent.content.cellContent === "<span></span>" ? "" : typedEvent.content.cellContent,
            EditType.USER_EDIT
        );
    },

    getContent: ({ updateWebview }) => {
        updateWebview();
    },

    setCurrentIdToGlobalState: ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setCurrentIdToGlobalState"; }>;
        const uri = document.uri.toString();
        provider.updateCellIdState(typedEvent.content.currentLineId, uri);
    },

    llmCompletion: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "llmCompletion"; }>;
        debug("llmCompletion message received", { event, document, provider, webviewPanel });

        const cellId = typedEvent.content.currentLineId;
        const addContentToValue = typedEvent.content.addContentToValue;

        // Add cell to the single cell queue (accumulate cells like autocomplete chapter does)
        await provider.addCellToSingleCellQueue(cellId, document, webviewPanel);

        // Note: The response is now handled by the queue system's completion callback
        // The old direct response is no longer needed since the queue system manages state
    },

    stopAutocompleteChapter: ({ provider }) => {
        console.log("stopAutocompleteChapter message received");
        const cancelled = provider.cancelAutocompleteChapter();
        if (cancelled) {
            vscode.window.showInformationMessage("Autocomplete operation stopped.");
        } else {
            console.log("No active autocomplete operation to stop");
        }
    },

    stopSingleCellTranslation: ({ provider }) => {
        console.log("stopSingleCellTranslation message received");

        // Try the new robust single cell queue system first
        const cancelledQueue = provider.cancelSingleCellQueue();

        // Fallback to old system for backward compatibility
        if (!cancelledQueue && provider?.singleCellTranslationState.isProcessing) {
            provider.clearTranslationQueue();
            provider.updateSingleCellTranslation(1.0);
        }

        if (cancelledQueue || provider?.singleCellTranslationState.isProcessing) {
            vscode.window.showInformationMessage("Translation cancelled.");
        }
    },

    cellError: ({ event, provider }) => {
        console.log("cellError message received", { event });
        const cellId = (event as any).content?.cellId;
        if (cellId && typeof cellId === "string") {
            provider.markCellComplete(cellId);
        }
    },

    requestAutocompleteChapter: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestAutocompleteChapter"; }>;
        await provider.performAutocompleteChapter(
            document,
            webviewPanel,
            typedEvent.content as QuillCellContent[]
        );
    },

    updateTextDirection: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateTextDirection"; }>;
        const updatedMetadata = {
            textDirection: typedEvent.direction,
        };
        await document.updateNotebookMetadata(updatedMetadata);
        await document.save(new vscode.CancellationTokenSource().token);
        console.log("Text direction updated successfully.");
        provider.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: await document.getNotebookMetadata(),
        });
    },

    getSourceText: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getSourceText"; }>;
        const sourceText = (await vscode.commands.executeCommand(
            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
            typedEvent.content.cellId
        )) as { cellId: string; content: string; };
        console.log("providerSendsSourceText", { sourceText });
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsSourceText",
            content: sourceText.content,
        });
    },

    openSourceText: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "openSourceText"; }>;
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
            content: typedEvent.content.chapterNumber.toString(),
        });
    },

    makeChildOfCell: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "makeChildOfCell"; }>;
        document.addCell(
            typedEvent.content.newCellId,
            typedEvent.content.referenceCellId,
            typedEvent.content.direction,
            typedEvent.content.cellType,
            typedEvent.content.data
        );
    },

    deleteCell: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deleteCell"; }>;
        console.log("deleteCell message received", { event });
        document.deleteCell(typedEvent.content.cellId);
    },

    updateCellTimestamps: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellTimestamps"; }>;
        console.log("updateCellTimestamps message received", { event });
        document.updateCellTimestamps(typedEvent.content.cellId, typedEvent.content.timestamps);
    },

    updateCellLabel: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellLabel"; }>;
        console.log("updateCellLabel message received", { event });
        document.updateCellLabel(typedEvent.content.cellId, typedEvent.content.cellLabel);
    },

    updateNotebookMetadata: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateNotebookMetadata"; }>;
        console.log("updateNotebookMetadata message received", { event });
        const newMetadata = typedEvent.content;
        await document.updateNotebookMetadata(newMetadata);
        await document.save(new vscode.CancellationTokenSource().token);
        vscode.window.showInformationMessage("Notebook metadata updated successfully.");
        provider.refreshWebview(webviewPanel, document);
    },

    pickVideoFile: async ({ document, webviewPanel, provider }) => {
        console.log("pickVideoFile message received");
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
    },

    replaceDuplicateCells: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "replaceDuplicateCells"; }>;
        console.log("replaceDuplicateCells message received", { event });
        document.replaceDuplicateCells(typedEvent.content);
    },

    saveTimeBlocks: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveTimeBlocks"; }>;
        console.log("saveTimeBlocks message received", { event });
        typedEvent.content.forEach((cell) => {
            document.updateCellTimestamps(cell.id, {
                startTime: cell.begin,
                endTime: cell.end,
            });
        });
    },

    supplyRecentEditHistory: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "supplyRecentEditHistory"; }>;
        console.log("supplyRecentEditHistory message received", { event });
        await vscode.commands.executeCommand(
            "codex-smart-edits.supplyRecentEditHistory",
            typedEvent.content.cellId,
            typedEvent.content.editHistory
        );
    },

    exportFile: async ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "exportFile"; }>;
        const notebookName = path.parse(document.uri.fsPath).name;
        const fileExtension = typedEvent.content.format;
        const fileName = `${notebookName}.${fileExtension}`;

        const saveUri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(fileName),
            filters: {
                "Subtitle files": ["vtt", "srt"],
            },
        });

        if (saveUri) {
            await vscode.workspace.fs.writeFile(
                saveUri,
                Buffer.from(typedEvent.content.subtitleData, "utf-8")
            );
            vscode.window.showInformationMessage(
                `File exported successfully as ${fileExtension.toUpperCase()}`
            );
        }
    },

    executeCommand: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "executeCommand"; }>;
        await vscode.commands.executeCommand(typedEvent.content.command, ...typedEvent.content.args);
    },

    togglePinPrompt: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "togglePinPrompt"; }>;
        console.log("togglePinPrompt message received", { event });
        await vscode.commands.executeCommand(
            "codex-smart-edits.togglePinPrompt",
            typedEvent.content.cellId,
            typedEvent.content.promptText
        );
    },

    generateBacktranslation: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "generateBacktranslation"; }>;
        const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.generateBacktranslation",
            typedEvent.content.text,
            typedEvent.content.cellId
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsBacktranslation",
            content: backtranslation,
        });
    },

    editBacktranslation: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "editBacktranslation"; }>;
        const updatedBacktranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.editBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.newText,
            typedEvent.content.existingBacktranslation
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsUpdatedBacktranslation",
            content: updatedBacktranslation,
        });
    },

    getBacktranslation: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getBacktranslation"; }>;
        const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.getBacktranslation",
            typedEvent.content.cellId
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsExistingBacktranslation",
            content: backtranslation,
        });
    },

    setBacktranslation: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setBacktranslation"; }>;
        const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.setBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.originalText,
            typedEvent.content.userBacktranslation
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerConfirmsBacktranslationSet",
            content: backtranslation,
        });
    },

    rejectEditSuggestion: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "rejectEditSuggestion"; }>;
        await vscode.commands.executeCommand(
            "codex-smart-edits.rejectEditSuggestion",
            typedEvent.content
        );
    },

    webviewFocused: ({ event, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "webviewFocused"; }>;
        if (provider.currentDocument && typedEvent.content?.uri) {
            const newUri = vscode.Uri.parse(typedEvent.content.uri);
            if (newUri.scheme === "file") {
                provider.currentDocument.updateUri(newUri);
            }
        }
    },

    updateCachedChapter: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCachedChapter"; }>;
        await provider.updateCachedChapter(document.uri.toString(), typedEvent.content);
    },

    updateCellDisplayMode: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellDisplayMode"; }>;
        const updatedMetadata = {
            cellDisplayMode: typedEvent.mode,
        };
        await document.updateNotebookMetadata(updatedMetadata);
        await document.save(new vscode.CancellationTokenSource().token);
        console.log("Cell display mode updated successfully.");
        provider.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: await document.getNotebookMetadata(),
        });
    },

    validateCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "validateCell"; }>;
        if (typedEvent.content?.cellId) {
            await provider.enqueueValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate
            );
        }
    },

    getValidationCount: async ({ webviewPanel, provider }) => {
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCount = config.get("validationCount", 1);
        provider.postMessageToWebview(webviewPanel, {
            type: "validationCount",
            content: validationCount,
        });
    },

    getCurrentUsername: async ({ webviewPanel, provider }) => {
        const authApi = await provider.getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const username = userInfo?.username || "anonymous";

        provider.postMessageToWebview(webviewPanel, {
            type: "currentUsername",
            content: { username },
        });
    },

    togglePrimarySidebar: async () => {
        vscode.window.showInformationMessage("togglePrimarySidebar");
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
        await vscode.commands.executeCommand("codex-editor.navigation.focus");
    },

    toggleSecondarySidebar: async () => {
        await vscode.commands.executeCommand("workbench.action.toggleAuxiliaryBar");
    },

    getEditorPosition: async ({ webviewPanel }) => {
        const activeEditor = vscode.window.activeTextEditor;
        let position = "unknown";

        if (activeEditor) {
            const visibleEditors = vscode.window.visibleTextEditors;

            if (visibleEditors.length <= 1) {
                position = "single";
            } else {
                const sortedEditors = [...visibleEditors].sort(
                    (a, b) => (a.viewColumn || 0) - (b.viewColumn || 0)
                );

                const activeEditorIndex = sortedEditors.findIndex(
                    (editor) => editor.document.uri.toString() === activeEditor.document.uri.toString()
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

        safePostMessageToPanel(webviewPanel, {
            type: "editorPosition",
            position,
        });
    },

    queueValidation: ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "queueValidation"; }>;
        if (typedEvent.content?.cellId) {
            provider.queueValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate,
                typedEvent.content.pending
            );
        }
    },

    applyPendingValidations: async ({ provider }) => {
        await provider.applyPendingValidations();
    },

    clearPendingValidations: ({ provider }) => {
        provider.clearPendingValidations();
    },

    jumpToChapter: ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "jumpToChapter"; }>;
        provider.updateCachedChapter(document.uri.toString(), typedEvent.chapterNumber);
        provider.postMessageToWebview(webviewPanel, {
            type: "setChapterNumber",
            content: typedEvent.chapterNumber,
        });
    },

    closeCurrentDocument: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "closeCurrentDocument"; }>;
        console.log("Close document request received:", typedEvent.content);
        const fileUri = typedEvent.content?.uri;
        const isSourceDocument = typedEvent.content?.isSource === true;

        if (fileUri) {
            const urisToCheck = [
                vscode.Uri.file(fileUri),
                !fileUri.startsWith("file://") ? vscode.Uri.file(fileUri) : undefined,
            ].filter((uri): uri is vscode.Uri => uri !== undefined);

            const visibleEditors = vscode.window.visibleTextEditors;
            let found = false;

            for (const uri of urisToCheck) {
                if (found) break;
                for (const editor of visibleEditors) {
                    if (editor.document.uri.fsPath === uri.fsPath) {
                        await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                        await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                        found = true;
                        break;
                    }
                }
            }

            if (!found) {
                console.log("Could not find the specific editor to close, closing active editor");
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
        } else if (isSourceDocument) {
            const visibleEditors = vscode.window.visibleTextEditors;
            let found = false;

            for (const editor of visibleEditors) {
                if (editor.document.uri.fsPath.endsWith(".source")) {
                    await vscode.window.showTextDocument(editor.document, editor.viewColumn);
                    await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
                    found = true;
                    break;
                }
            }

            if (!found) {
                await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
            }
        } else {
            await vscode.commands.executeCommand("workbench.action.closeActiveEditor");
        }
    },

    toggleSidebar: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "toggleSidebar"; }>;
        console.log("toggleSidebar message received");
        await vscode.commands.executeCommand("workbench.action.toggleSidebarVisibility");
        if (typedEvent.content?.isOpening) {
            await vscode.commands.executeCommand("codex-editor.navigateToMainMenu");
        }
    },

    triggerSync: ({ provider }) => {
        console.log("triggerSync message received");
        provider.triggerSync();
    },

    triggerReindexing: async () => {
        console.log("Triggering reindexing after all translations completed");
        await vscode.commands.executeCommand("codex-editor-extension.forceReindex");
    },

    requestAudioAttachments: async ({ document, webviewPanel, provider }) => {
        console.log("requestAudioAttachments message received");
        const audioAttachments = await scanForAudioAttachments(document, webviewPanel);
        const audioCells: { [cellId: string]: boolean; } = {};
        for (const cellId of Object.keys(audioAttachments)) {
            audioCells[cellId] = true;
        }
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsAudioAttachments",
            attachments: audioCells,
        });
    },

    requestAudioForCell: async ({ event, document, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestAudioForCell"; }>;
        console.log("requestAudioForCell message received for cell:", typedEvent.content.cellId);
        const cellId = typedEvent.content.cellId;
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

                        if (fs.existsSync(fullPath)) {
                            const fileData = await fs.promises.readFile(fullPath);
                            const base64Data = `data:audio/webm;base64,${fileData.toString('base64')}`;

                            safePostMessageToPanel(webviewPanel, {
                                type: "providerSendsAudioData",
                                content: {
                                    cellId: cellId,
                                    audioId: attachmentId,
                                    audioData: base64Data
                                }
                            });

                            debug("Sent audio data for cell:", cellId);
                            return;
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
                    const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                    if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                        const fullPath = path.join(attachmentsPath, audioFile);

                        const fileData = await fs.promises.readFile(fullPath);
                        const mimeType = audioFile.endsWith('.webm') ? 'audio/webm' :
                            audioFile.endsWith('.mp3') ? 'audio/mp3' :
                                audioFile.endsWith('.m4a') ? 'audio/mp4' :
                                    audioFile.endsWith('.ogg') ? 'audio/ogg' :
                                        'audio/wav';
                        const base64Data = `data:${mimeType};base64,${fileData.toString('base64')}`;

                        safePostMessageToPanel(webviewPanel, {
                            type: "providerSendsAudioData",
                            content: {
                                cellId: cellId,
                                audioId: audioFile.replace(/\.[^/.]+$/, ""),
                                audioData: base64Data
                            }
                        });

                        debug("Sent legacy audio data for cell:", cellId);
                        return;
                    }
                }
            }
        }

        debug("No audio attachment found for cell:", cellId);
    },

    saveAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveAudioAttachment"; }>;
        console.log("saveAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId,
            fileExtension: typedEvent.content.fileExtension
        });

        const documentSegment = typedEvent.content.cellId.split(' ')[0];
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const attachmentsDir = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            documentSegment
        );

        await fs.promises.mkdir(attachmentsDir, { recursive: true });

        const fileName = `${typedEvent.content.audioId}.${typedEvent.content.fileExtension}`;
        const filePath = path.join(attachmentsDir, fileName);

        const base64Data = typedEvent.content.audioData.split(',')[1] || typedEvent.content.audioData;
        const buffer = Buffer.from(base64Data, 'base64');

        await fs.promises.writeFile(filePath, buffer);

        const relativePath = path.relative(workspaceFolder.uri.fsPath, filePath);
        await document.updateCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId, {
            url: relativePath,
            type: "audio"
        });

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentSaved",
            content: {
                cellId: typedEvent.content.cellId,
                audioId: typedEvent.content.audioId,
                success: true
            }
        });

        const updatedAudioAttachments = await scanForAudioAttachments(document, webviewPanel);
        const audioCells: { [cellId: string]: boolean; } = {};
        for (const cellId of Object.keys(updatedAudioAttachments)) {
            audioCells[cellId] = true;
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsAudioAttachments",
            attachments: audioCells as any,
        });

        debug("Audio attachment saved successfully:", filePath);
    },

    deleteAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deleteAudioAttachment"; }>;
        console.log("deleteAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId
        });

        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const documentSegment = typedEvent.content.cellId.split(' ')[0];
        const attachmentsDir = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            documentSegment
        );

        try {
            const files = await fs.promises.readdir(attachmentsDir);
            const audioFile = files.find(file => file.startsWith(typedEvent.content.audioId));

            if (audioFile) {
                const filePath = path.join(attachmentsDir, audioFile);
                await fs.promises.unlink(filePath);
                debug("Deleted audio file:", filePath);
            }
        } catch (err) {
            debug("Error reading attachments directory:", err);
        }

        await document.removeCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentDeleted",
            content: {
                cellId: typedEvent.content.cellId,
                audioId: typedEvent.content.audioId,
                success: true
            }
        });

        const updatedAudioAttachments = await scanForAudioAttachments(document, webviewPanel);
        const audioCells: { [cellId: string]: boolean; } = {};
        for (const cellId of Object.keys(updatedAudioAttachments)) {
            audioCells[cellId] = true;
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsAudioAttachments",
            attachments: audioCells as any,
        });

        debug("Audio attachment deleted successfully");
    },

    confirmCellMerge: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "confirmCellMerge"; }>;
        const { currentCellId, previousCellId, currentContent, previousContent, message } = typedEvent.content;

        // Show VS Code confirmation dialog
        const confirmed = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            "Yes",
            "No"
        );

        if (confirmed === "Yes") {
            // User confirmed, proceed with merge
            const mergeEvent = {
                command: "mergeCellWithPrevious" as const,
                content: {
                    currentCellId,
                    previousCellId,
                    currentContent,
                    previousContent
                }
            };

            // Call the existing merge handler
            await messageHandlers.mergeCellWithPrevious({
                event: mergeEvent,
                document,
                webviewPanel,
                provider
            });
        }
    },

    showErrorMessage: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "showErrorMessage"; }>;
        vscode.window.showErrorMessage(typedEvent.text);
    },

    mergeCellWithPrevious: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "mergeCellWithPrevious"; }>;
        const { currentCellId, previousCellId, currentContent, previousContent } = typedEvent.content;

        try {
            // Get all cell IDs to find the indices
            const allCellIds = document.getAllCellIds();
            const previousCellIndex = allCellIds.findIndex(id => id === previousCellId);
            const currentCellIndex = allCellIds.findIndex(id => id === currentCellId);

            if (previousCellIndex === -1 || currentCellIndex === -1) {
                console.error("Could not find cells for merge operation");
                vscode.window.showErrorMessage("Could not find cells for merge operation");
                return;
            }

            // Get the actual cell objects
            const previousCell = document.getCell(previousCellId);
            const currentCell = document.getCell(currentCellId);

            if (!previousCell || !currentCell) {
                console.error("Could not retrieve cell objects for merge operation");
                vscode.window.showErrorMessage("Could not retrieve cell objects for merge operation");
                return;
            }

            // Get current user using the provider's auth API
            let currentUser = "anonymous";
            try {
                const authApi = await provider.getAuthApi();
                const userInfo = await authApi?.getUserInfo();
                currentUser = userInfo?.username || "anonymous";
            } catch (error) {
                console.warn("Could not get user info for merge operation, using 'anonymous':", error);
            }

            const timestamp = Date.now();

            // Get existing edit history or create new one
            const existingEdits = previousCell.metadata?.edits || [];

            // 1. Add the current content as an edit entry (save original previous content)
            const firstEdit = {
                cellValue: previousContent,
                timestamp: timestamp,
                type: "user" as const,
                author: currentUser,
                validatedBy: []
            };

            // 2. Concatenate content and create second edit
            const mergedContent = previousContent + " " + currentContent;
            const secondEdit = {
                cellValue: mergedContent,
                timestamp: timestamp + 1,
                type: "user" as const,
                author: currentUser,
                validatedBy: []
            };

            // Update the previous cell content and edit history directly
            // Since this is a merge operation in source files, we need to bypass normal restrictions
            const updatedEdits = [...existingEdits, firstEdit, secondEdit];

            // Update the previous cell content and metadata directly
            previousCell.value = mergedContent;
            if (!previousCell.metadata.edits) {
                previousCell.metadata.edits = [];
            }
            previousCell.metadata.edits = updatedEdits;

            // Mark the document as dirty manually since we bypassed the normal update methods
            (document as any)._isDirty = true;

            // 3. Mark current cell as merged by updating its data
            const currentCellData = document.getCellData(currentCellId) || {};
            document.updateCellData(currentCellId, {
                ...currentCellData,
                merged: true
            });

            // Save the document
            await document.save(new vscode.CancellationTokenSource().token);

            console.log(`Successfully merged cell ${currentCellId} with ${previousCellId}`);

            // Refresh the webview content
            provider.refreshWebview(webviewPanel, document);

        } catch (error) {
            console.error("Error merging cells:", error);
            vscode.window.showErrorMessage(`Failed to merge cells: ${error}`);
        }
    },
};

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
    event: any, // Changed from EditorPostMessages to allow validation
    webviewPanel: vscode.WebviewPanel,
    document: CodexCellDocument,
    updateWebview: () => void,
    provider: CodexCellEditorProvider
) => {
    // Validate message structure before processing
    if (!event || typeof event !== 'object') {
        console.error("[Message Handler] Invalid message structure - not an object:", {
            event,
            eventType: typeof event
        });
        return;
    }

    // Check if this is a backend-to-frontend message (uses 'type' property)
    // These should not be processed by this handler
    if (event.type && !event.command) {
        console.warn("[Message Handler] Received backend-to-frontend message in frontend-to-backend handler - ignoring:", {
            messageType: event.type,
            eventKeys: Object.keys(event || {}),
            webviewPanelActive: webviewPanel?.active,
            documentUri: document?.uri?.toString()
        });
        return;
    }

    // Check for frontend-to-backend messages (should have 'command' property)
    if (!event.command) {
        console.error("[Message Handler] Frontend-to-backend message missing command property:", {
            event,
            eventKeys: Object.keys(event || {}),
            webviewPanelActive: webviewPanel?.active,
            documentUri: document?.uri?.toString()
        });
        return;
    }

    if (typeof event.command !== 'string') {
        console.error("[Message Handler] Message command is not a string:", {
            command: event.command,
            commandType: typeof event.command,
            event,
            webviewPanelActive: webviewPanel?.active
        });
        return;
    }

    // Cast to proper type after validation
    const validatedEvent = event as EditorPostMessages;

    const context: MessageHandlerContext = {
        event: validatedEvent,
        webviewPanel,
        document,
        updateWebview,
        provider,
    };

    const handler = messageHandlers[validatedEvent.command];
    if (handler) {
        await withErrorHandling(
            () => handler(context),
            `handle ${validatedEvent.command}`,
            true // Show user error for most operations
        );
    } else {
        console.error("[Message Handler] Unknown message command:", {
            command: validatedEvent.command,
            availableCommands: Object.keys(messageHandlers).slice(0, 10), // First 10 for debugging
            totalHandlers: Object.keys(messageHandlers).length,
            event: validatedEvent,
            webviewPanelActive: webviewPanel?.active
        });
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
): Promise<{ [cellId: string]: string; }> {
    debug("Scanning for audio attachments for document:", document.uri.toString());

    const audioAttachments: { [cellId: string]: string; } = {};

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
                                        safePostMessageToPanel(webviewPanel, {
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
                                            safePostMessageToPanel(webviewPanel, {
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
