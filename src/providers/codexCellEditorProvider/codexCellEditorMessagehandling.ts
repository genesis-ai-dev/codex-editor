import * as vscode from "vscode";
import { CodexCellDocument } from "./codexDocument";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
// Use type-only import to break circular dependency
import type { CodexCellEditorProvider } from "./codexCellEditorProvider";
import { GlobalMessage, EditorPostMessages, EditHistory, CodexNotebookAsJSONData } from "../../../types";
import { EditMapUtils } from "../../utils/editMapUtils";
import { EditType, CodexCellTypes } from "../../../types/enums";
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
// Use VS Code FS API for all file operations (supports remote and virtual workspaces)
import { getCommentsFromFile } from "../../utils/fileUtils";
import { getUnresolvedCommentsCountForCell } from "../../utils/commentsUtils";
import { toPosixPath } from "../../utils/pathUtils";
import { revalidateCellMissingFlags } from "../../utils/audioMissingUtils";
import { mergeAudioFiles } from "../../utils/audioMerger";
import { getCorrespondingSourceUri } from "../../utils/codexNotebookUtils";
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

// Debounce container for broadcasting auto-download flag updates
let autoDownloadBroadcastTimer: NodeJS.Timeout | undefined;
let pendingAutoDownloadValue: boolean | undefined;


// Helper to use VS Code FS API
async function pathExists(filePath: string): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(vscode.Uri.file(filePath));
        return true;
    } catch {
        return false;
    }
}

/**
 * Sanitizes a name to be safe for use as a folder name.
 * Removes invalid characters and normalizes the name.
 */
function sanitizeFolderName(name: string): string {
    return (
        name
            .replace(/[<>:"/\\|?*]|^\.|\.$|\.lock$/g, "-") // Invalid/reserved chars
            .replace(/\s+/g, "-") // Replace spaces with hyphens
            .replace(/\.+/g, "-") // Replace periods with hyphens
            .replace(/-+/g, "-") // Replace multiple hyphens with single hyphen
            .replace(/^-|-$/g, "") // Remove leading/trailing hyphens
        || "UNKNOWN" // Fallback if name becomes empty
    );
}

/**
 * Determines the document segment for attachment storage.
 * Uses originalName from metadata (sanitized), falls back to first cell's cellId, 
 * then corpusMarker, then "UNKNOWN".
 */
function getDocumentSegment(document: CodexCellDocument): string {
    const metadata = document.getNotebookMetadata();

    // First priority: use originalName from metadata (sanitized for folder name)
    if (metadata?.originalName) {
        const sanitized = sanitizeFolderName(metadata.originalName);
        if (sanitized && sanitized !== "UNKNOWN") {
            return sanitized;
        }
    }

    // Fallback to first cell's cellId
    const firstCell = document.getCellByIndex(0);
    if (firstCell?.metadata?.id) {
        const cellId = firstCell.metadata.id;
        const segment = cellId.split(' ')[0];
        if (segment) {
            return segment;
        }
    }

    // Fallback to corpusMarker
    const corpusMarker = metadata?.corpusMarker;
    if (corpusMarker) {
        return corpusMarker;
    }

    // Final fallback
    return "UNKNOWN";
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

/**
 * Helper function to get the audio file path for a cell
 * Checks metadata attachments first, then falls back to filesystem lookup
 * @param cell The cell object
 * @param cellId The cell ID
 * @param workspaceFolder The workspace folder
 * @returns Full path to audio file if found, null otherwise
 */
async function getAudioFilePathForCell(
    cell: any,
    cellId: string,
    workspaceFolder: vscode.WorkspaceFolder
): Promise<string | null> {
    // First, check if cell has audio attachments in metadata
    if (cell?.metadata?.attachments) {
        const attachments = Object.entries(cell.metadata.attachments);
        for (const [attachmentId, attachment] of attachments) {
            const att = attachment as any;
            if (att && att.type === "audio" && !att.isDeleted && att.url) {
                const attachmentPath = toPosixPath(att.url);
                const fullPath = path.isAbsolute(attachmentPath)
                    ? attachmentPath
                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                // Check if file exists
                if (await pathExists(fullPath)) {
                    return fullPath;
                }
            }
        }
    }

    // Fallback: check filesystem for legacy audio files
    // Extract book name from globalReferences if available, otherwise fall back to parsing cell ID
    let bookAbbr = "";
    let basename = "";

    // Try to get book name from globalReferences first
    const globalRefs = cell?.metadata?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const firstRef = globalRefs[0];
        // Extract book name: "GEN 1:1" -> "GEN" or "TheChosen-201-en-SingleSpeaker 1:jkflds" -> "TheChosen-201-en-SingleSpeaker"
        const bookMatch = firstRef.match(/^([^\s]+)/);
        if (bookMatch) {
            bookAbbr = bookMatch[1];
        }
    }

    // Fallback to parsing cell ID if globalReferences not available (legacy support)
    if (!bookAbbr) {
        bookAbbr = cellId.split(' ')[0];
    }

    const parseCellIdToBookChapterVerse = (refId: string): { book: string; chapter?: number; verse?: number; } => {
        try {
            const [book, rest] = refId.split(" ");
            const [chapterStr, verseStr] = (rest || "").split(":");
            let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
            let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
            if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
            if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
            return { book: (book || "").toUpperCase(), chapter, verse };
        } catch {
            return { book: "", chapter: undefined, verse: undefined };
        }
    };

    const toBookChapterVerseBasename = (refId: string): string => {
        const { book, chapter, verse } = parseCellIdToBookChapterVerse(refId);
        const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
        const chapStr = safePad(chapter);
        const verseStr = safePad(verse);
        const sanitizeFileComponent = (input: string): string => {
            return input
                .replace(/\s+/g, "_")
                .replace(/[^a-zA-Z0-9._-]/g, "-")
                .replace(/_+/g, "_");
        };
        return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
    };

    // Use globalReferences for basename if available
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        basename = toBookChapterVerseBasename(globalRefs[0]);
    } else {
        // Fallback to parsing cell ID (legacy)
        basename = toBookChapterVerseBasename(cellId);
    }
    const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];

    const attachmentsFilesPath = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        "files",
        bookAbbr
    );
    const legacyAttachmentsPath = path.join(
        workspaceFolder.uri.fsPath,
        ".project",
        "attachments",
        bookAbbr
    );

    const tryPaths = [attachmentsFilesPath, legacyAttachmentsPath];
    for (const attachmentsPath of tryPaths) {
        if (!(await pathExists(attachmentsPath))) continue;
        try {
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));
            for (const [entryName, entryType] of files) {
                if (entryType !== vscode.FileType.File) continue;
                if (audioExtensions.some(ext => entryName.toLowerCase().endsWith(ext))) {
                    // Check if filename matches the cell ID pattern
                    if (entryName.startsWith(basename) || entryName.includes(cellId.replace(/[:\s]/g, '_'))) {
                        const fullPath = path.join(attachmentsPath, entryName);
                        if (await pathExists(fullPath)) {
                            return fullPath;
                        }
                    }
                }
            }
        } catch (err) {
            debug("Error reading attachments directory:", err);
        }
    }

    return null;
}

// Individual message handlers
const messageHandlers: Record<string, (ctx: MessageHandlerContext) => Promise<void> | void> = {
    webviewReady: () => { /* no-op */ },
    setAutoDownloadAudioOnOpen: async ({ event, document, webviewPanel, provider }) => {
        try {
            const typed = event as any;
            const value = !!typed?.content?.value;
            const ws = vscode.workspace.getWorkspaceFolder(document.uri);
            const { setAutoDownloadAudioOnOpen } = await import("../../utils/localProjectSettings");
            await setAutoDownloadAudioOnOpen(value, ws?.uri);
            // Debounce broadcast so rapid toggles coalesce
            pendingAutoDownloadValue = value;
            if (autoDownloadBroadcastTimer) {
                clearTimeout(autoDownloadBroadcastTimer);
            }
            autoDownloadBroadcastTimer = setTimeout(() => {
                try {
                    const panels = provider.getWebviewPanels();
                    panels.forEach((panel) => {
                        provider.postMessageToWebview(panel, {
                            type: "providerUpdatesNotebookMetadataForWebview",
                            content: { autoDownloadAudioOnOpen: pendingAutoDownloadValue },
                        } as any);
                    });
                } catch (broadcastErr) {
                    console.warn("Failed to broadcast autoDownloadAudioOnOpen", broadcastErr);
                } finally {
                    autoDownloadBroadcastTimer = undefined;
                }
            }, 150);
        } catch (e) {
            console.warn("Failed to set autoDownloadAudioOnOpen", e);
        }
    },
    getAsrConfig: async ({ webviewPanel }) => {
        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            let endpoint = config.get<string>("asrEndpoint", "http://localhost:8000/api/v1/asr/transcribe");

            let authToken: string | undefined;

            // Try to get authenticated endpoint from FrontierAPI
            try {
                const frontierApi = getAuthApi();
                if (frontierApi) {
                    const authStatus = frontierApi.getAuthStatus();
                    if (authStatus.isAuthenticated) {
                        const asrEndpoint = await frontierApi.getAsrEndpoint();
                        // Validate endpoint URL before using it
                        if (asrEndpoint && asrEndpoint.trim()) {
                            try {
                                new URL(asrEndpoint);
                                endpoint = asrEndpoint;
                            } catch (urlError) {
                                console.warn("Invalid ASR endpoint URL from auth API:", asrEndpoint, urlError);
                                // Fall back to default endpoint
                            }
                        }
                        // Get auth token for authenticated requests
                        try {
                            authToken = await frontierApi.authProvider.getToken();
                            console.log(`[getAsrConfig] Token retrieved: ${authToken ? `present (length: ${authToken.length})` : 'empty/undefined'}`);
                            if (!authToken) {
                                console.error("[getAsrConfig] ERROR: ASR endpoint requires authentication but token retrieval returned empty value");
                            }
                        } catch (tokenError) {
                            console.error("[getAsrConfig] ERROR: Could not get auth token for ASR endpoint:", tokenError);
                        }
                    }
                }
            } catch (error) {
                console.debug("Could not get ASR endpoint from auth API:", error);
            }

            // Final validation: ensure endpoint is a valid URL
            try {
                new URL(endpoint);
            } catch (urlError) {
                console.error("Invalid ASR endpoint configuration:", endpoint, urlError);
                throw new Error(`Invalid ASR endpoint: ${endpoint}. Please check your ASR settings or login status.`);
            }

            // Warn if using authenticated endpoint without token
            const isAuthenticatedEndpoint = endpoint.includes('api.frontierrnd.com') || endpoint.includes('frontier');
            console.log(`[getAsrConfig] Calculation: isAuthenticatedEndpoint=${isAuthenticatedEndpoint}, hasToken=${!!authToken}`);
            if (isAuthenticatedEndpoint && !authToken) {
                console.error(`[getAsrConfig] ERROR: ASR endpoint appears to require authentication but no token was retrieved!`);
                console.error(`[getAsrConfig] Endpoint: ${endpoint}`);
                console.error(`[getAsrConfig] This will cause transcription to fail. Please check authentication status.`);
            }

            console.log(`[getAsrConfig] Sending config: endpoint=${endpoint}, hasToken=${!!authToken}`);
            safePostMessageToPanel(webviewPanel, {
                type: "asrConfig",
                content: { endpoint, authToken }
            });
        } catch (error) {
            console.error("Error sending ASR config:", error);
            // Always provide a valid fallback endpoint
            const fallbackEndpoint = "http://localhost:8000/api/v1/asr/transcribe";
            safePostMessageToPanel(webviewPanel, {
                type: "asrConfig",
                content: {
                    endpoint: fallbackEndpoint,
                    provider: "mms",
                    model: "facebook/mms-1b-all",
                    language: "eng",
                    phonetic: false,
                    authToken: undefined
                }
            });
        }
    },

    updateCellAfterTranscription: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellAfterTranscription"; }>;
        const { cellId, transcribedText, language } = typedEvent.content;
        try {
            // Get current selected audio attachment for this cell
            const currentAttachment = document.getCurrentAttachment(cellId, "audio");
            if (!currentAttachment) {
                console.warn("No current audio attachment to save transcription for cell:", cellId);
                return;
            }
            const { attachmentId, attachment } = currentAttachment as any;
            const updated = {
                ...(attachment || {}),
                transcription: {
                    content: transcribedText,
                    language: language || "unknown",
                    timestamp: Date.now(),
                },
                updatedAt: Date.now(),
            };
            await document.updateCellAttachment(cellId, attachmentId, updated);

            // Notify webview(s) of updated audio attachments status
            await scanForAudioAttachments(document, webviewPanel);
            // Recompute availability with pointer detection so UI shows correct icon
            try {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                const notebookData = JSON.parse(document.getText());
                const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                if (Array.isArray(notebookData?.cells) && workspaceFolder) {
                    for (const cell of notebookData.cells) {
                        const id = cell?.metadata?.id;
                        if (!id) continue;
                        let hasAvailable = false;
                        let hasAvailablePointer = false;
                        let hasMissing = false;
                        let hasDeleted = false;
                        const atts = cell?.metadata?.attachments || {};
                        for (const key of Object.keys(atts)) {
                            const att: any = (atts as any)[key];
                            if (att && att.type === "audio") {
                                if (att.isDeleted) {
                                    hasDeleted = true;
                                } else if (att.isMissing) {
                                    hasMissing = true;
                                } else {
                                    try {
                                        const url = String(att.url || "");
                                        if (url) {
                                            const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                            const abs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                            const { isPointerFile } = await import("../../utils/lfsHelpers");
                                            const isPtr = await isPointerFile(abs).catch(() => false);
                                            if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                        } else {
                                            hasAvailable = true;
                                        }
                                    } catch { hasAvailable = true; }
                                }
                            }
                        }

                        let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                        if (hasAvailable) state = "available-local";
                        else if (hasAvailablePointer) state = "available-pointer";
                        else if (hasMissing) state = "missing";
                        else if (hasDeleted) state = "deletedOnly";
                        else state = "none";

                        // Apply installed-version gate (no modal) to avoid showing Play when blocked
                        if (state !== "available-local") {
                            try {
                                const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                                const status = await getFrontierVersionStatus();
                                if (!status.ok) {
                                    if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                        state = "available-pointer";
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        availability[id] = state as any;
                    }
                }
                provider.postMessageToWebview(webviewPanel, {
                    type: "providerSendsAudioAttachments",
                    attachments: availability,
                });
            } catch (err) {
                console.warn("Failed to compute audio availability after transcription", err);
            }
        } catch (error) {
            console.error("Failed to update transcription for cell:", cellId, error);
        }
    },

    // Return the user's preferred editor tab (workspace-scoped), default to "source"
    getPreferredEditorTab: async ({ webviewPanel, provider }) => {
        try {
            const tab = provider.getPreferredEditorTab();
            provider.postMessageToWebview(webviewPanel, {
                type: "preferredEditorTab",
                tab,
            });
        } catch (error) {
            console.error("Error getting preferred editor tab:", error);
        }
    },

    // Update the user's preferred editor tab
    setPreferredEditorTab: async ({ event, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setPreferredEditorTab"; }>;
        try {
            provider.updatePreferredEditorTab(typedEvent.content.tab);
        } catch (error) {
            console.error("Error setting preferred editor tab:", error);
        }
    },

    addWord: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "addWord"; }>;
        await vscode.commands.executeCommand("spellcheck.addWord", typedEvent.words);
        safePostMessageToPanel(webviewPanel, {
            type: "wordAdded",
            content: typedEvent.words,
        });
    },

    getCommentsForCell: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getCommentsForCell"; }>;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                safePostMessageToPanel(webviewPanel, {
                    type: "commentsForCell",
                    content: {
                        cellId: typedEvent.content.cellId,
                        unresolvedCount: 0
                    },
                });
                return;
            }

            const comments = await getCommentsFromFile(".project/comments.json");
            const unresolvedCount = getUnresolvedCommentsCountForCell(comments, typedEvent.content.cellId);

            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCell",
                content: {
                    cellId: typedEvent.content.cellId,
                    unresolvedCount: unresolvedCount
                },
            });
        } catch (error) {
            // Silent fallback - getCommentsFromFile now handles file not found gracefully
            // Only log if it's an unexpected error (not file not found)
            if (!(error instanceof Error && error.message === "Failed to parse notebook comments from file")) {
                console.error("Unexpected error getting comments for cell:", error);
            }
            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCell",
                content: {
                    cellId: typedEvent.content.cellId,
                    unresolvedCount: 0
                },
            });
        }
    },

    getCommentsForCells: async ({ event, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getCommentsForCells"; }>;
        try {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders || workspaceFolders.length === 0) {
                const result: { [cellId: string]: number; } = {};
                typedEvent.content.cellIds.forEach(cellId => {
                    result[cellId] = 0;
                });
                safePostMessageToPanel(webviewPanel, {
                    type: "commentsForCells",
                    content: result,
                });
                return;
            }

            const comments = await getCommentsFromFile(".project/comments.json");
            const result: { [cellId: string]: number; } = {};

            typedEvent.content.cellIds.forEach(cellId => {
                result[cellId] = getUnresolvedCommentsCountForCell(comments, cellId);
            });

            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCells",
                content: result,
            });
        } catch (error) {
            // Silent fallback
            if (!(error instanceof Error && error.message === "Failed to parse notebook comments from file")) {
                console.error("Unexpected error getting comments for cells:", error);
            }
            const result: { [cellId: string]: number; } = {};
            typedEvent.content.cellIds.forEach(cellId => {
                result[cellId] = 0;
            });
            safePostMessageToPanel(webviewPanel, {
                type: "commentsForCells",
                content: result,
            });
        }
    },

    openCommentsForCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "openCommentsForCell"; }>;
        try {
            // First, update the global state to set the current cell ID
            const uri = document.uri.toString();
            provider.updateCellIdState(typedEvent.content.cellId, uri, document);

            // Open the comments view and navigate to the specific cell
            await vscode.commands.executeCommand("codex-editor-extension.focusCommentsView");

            // Send a message to the comments view to navigate to this cell
            vscode.commands.executeCommand("codex-editor-extension.navigateToCellInComments", typedEvent.content.cellId);
        } catch (error) {
            console.error("Error opening comments for cell:", error);
        }
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
                debug("[Message Handler] Spellcheck is disabled, skipping alert codes");
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

        const cellId = typedEvent.content.cellMarkers[0];
        const oldContent = document.getCellContent(cellId);

        // Block saveHtml operations on locked cells
        if (oldContent?.metadata?.isLocked) {
            console.warn(`Attempted to save locked cell ${cellId}. Operation blocked.`);
            return;
        }

        const oldText = oldContent?.cellContent || "";
        const newText = typedEvent.content.cellContent || "";
        const isSourceText = document.uri.toString().includes(".source");
        const isTranscription = newText.includes('data-transcription="true"');


        if (oldText !== newText) {
            if (!isSourceText) {
                await vscode.commands.executeCommand(
                    "codex-smart-edits.recordIceEdit",
                    oldText,
                    newText
                );
            }
            provider.updateFileStatus("dirty");
        }


        const finalContent = typedEvent.content.cellContent === "<span></span>" ? "" : typedEvent.content.cellContent;

        // For source file transcriptions, wait for index update to complete
        // so that the source content is immediately available for translation
        if (isSourceText && isTranscription) {
            await document.updateCellContent(
                cellId,
                finalContent,
                EditType.USER_EDIT
            );
            // Wait for the index to be updated and verify it's available
            await document.ensureCellIndexed(cellId, 3000);
        } else {
            await document.updateCellContent(
                cellId,
                finalContent,
                EditType.USER_EDIT
            );
        }
    },

    getContent: ({ updateWebview }) => {
        updateWebview();
    },

    setCurrentIdToGlobalState: ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setCurrentIdToGlobalState"; }>;
        const uri = document.uri.toString();
        provider.updateCellIdState(typedEvent.content.currentLineId, uri, document);
    },

    llmCompletion: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "llmCompletion"; }>;
        debug("llmCompletion message received", { event, document, provider, webviewPanel });

        const cellId = typedEvent.content.currentLineId;
        const addContentToValue = typedEvent.content.addContentToValue;

        // Always preflight: if source text is empty, try to transcribe first, then only attempt LLM
        // In test environments the command may be unregistered; skip gracefully in that case.
        let contentIsEmpty = false;
        try {
            const sourceCell = await vscode.commands.executeCommand(
                "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                cellId
            ) as { cellId: string; content: string; } | null;
            contentIsEmpty = !sourceCell || !sourceCell.content || (sourceCell.content.replace(/<[^>]*>/g, "").trim() === "");
        } catch (e) {
            console.warn("getSourceCellByCellIdFromAllSourceCells unavailable; skipping transcription preflight");
            contentIsEmpty = false;
        }

        if (contentIsEmpty) {
            try {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                // In VS Code test environments (and in some real usage), the active document can be
                // outside of any workspace folder. In that case we can't open the corresponding
                // source file for transcription, but we should still honor the user's request and
                // enqueue the LLM completion.
                if (!workspaceFolder) {
                    console.warn("No workspace folder found; skipping transcription preflight and queuing LLM completion.");
                    await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                    return;
                }

                const normalizedPath = document.uri.fsPath.replace(/\\/g, "/");
                const baseFileName = path.basename(normalizedPath);
                const sourceFileName = baseFileName.endsWith(".codex")
                    ? baseFileName.replace(".codex", ".source")
                    : baseFileName;
                const sourcePath = vscode.Uri.joinPath(
                    workspaceFolder.uri,
                    ".project",
                    "sourceTexts",
                    sourceFileName
                );

                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    sourcePath,
                    "codex.cellEditor",
                    { viewColumn: vscode.ViewColumn.One }
                );

                // Wait for source webview to be ready
                await provider.waitForWebviewReady(sourcePath.toString(), 3000);

                // Wait briefly for the source panel to register
                let sourcePanel = provider.getWebviewPanels().get(sourcePath.toString());
                if (!sourcePanel) {
                    const waitStart = Date.now();
                    while (!sourcePanel && Date.now() - waitStart < 1500) {
                        await new Promise((r) => setTimeout(r, 100));
                        sourcePanel = provider.getWebviewPanels().get(sourcePath.toString());
                    }
                }

                if (!sourcePanel) {
                    vscode.window.showWarningMessage("Could not open source for transcription. Please try again.");
                    return;
                }

                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Transcribing source audio…",
                        cancellable: false,
                    },
                    async (progress) => {
                        // Start transcription for the specific cell only
                        safePostMessageToPanel(sourcePanel!, {
                            type: "startBatchTranscription",
                            content: { count: 1, cellId }
                        } as any);

                        // Mock progress while polling for source content availability
                        let progressValue = 0;
                        const timer = setInterval(() => {
                            progressValue = Math.min(progressValue + 3, 95);
                            progress.report({ increment: 3 });
                        }, 500);

                        try {
                            const timeoutMs = 40000;
                            const start = Date.now();
                            let foundText = false;
                            for (; ;) {
                                let src: { cellId: string; content: string; } | null = null;
                                try {
                                    src = await vscode.commands.executeCommand(
                                        "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                                        cellId
                                    ) as { cellId: string; content: string; } | null;
                                } catch {
                                    // Command not available; abort polling
                                    break;
                                }
                                const hasText = !!src && !!src.content && src.content.replace(/<[^>]*>/g, "").trim() !== "";
                                if (hasText) {
                                    foundText = true;
                                    // Wait a bit more to ensure index is fully updated and propagated
                                    await new Promise((r) => setTimeout(r, 500));
                                    // Verify one more time that source is still available
                                    try {
                                        const verifySrc = await vscode.commands.executeCommand(
                                            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                                            cellId
                                        ) as { cellId: string; content: string; } | null;
                                        const stillHasText = !!verifySrc && !!verifySrc.content && verifySrc.content.replace(/<[^>]*>/g, "").trim() !== "";
                                        if (stillHasText) break;
                                    } catch {
                                        // If verification fails, proceed anyway since we found text once
                                        break;
                                    }
                                }
                                if (Date.now() - start > timeoutMs) break;
                                await new Promise((r) => setTimeout(r, 400));
                            }
                        } finally {
                            clearInterval(timer);
                            progress.report({ increment: 100 - progressValue });
                        }
                    }
                );

                // After transcription completes (or timeout), only then try LLM
                const ready = await provider.isLLMReady().catch(() => true);
                if (!ready) {
                    vscode.window.showWarningMessage(
                        "Transcription complete, but LLM is not configured. Set an API key or sign in to generate predictions."
                    );
                }
                await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                return;
            } catch (e) {
                // Transcription preflight is best-effort. If it fails, still queue the LLM request
                // so the user action isn't dropped (and tests can assert queueing deterministically).
                console.warn("Transcription preflight failed; continuing to queue LLM completion", e);
                await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
                return;
            }
        }

        // If source already has text, proceed only if LLM is ready
        const ready = await provider.isLLMReady().catch(() => true);
        if (!ready) {
            vscode.window.showWarningMessage(
                "LLM is not configured. Set an API key or sign in to generate predictions."
            );
        }
        await provider.addCellToSingleCellQueue(cellId, document, webviewPanel, addContentToValue);
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

        try {
            await vscode.commands.executeCommand(
                "vscode.openWith",
                sourceUri,
                "codex.cellEditor",
                { viewColumn: vscode.ViewColumn.Beside }
            );
        } catch (error) {
            console.error(`Failed to open source file: ${error}`);
            vscode.window.showErrorMessage(
                `Failed to open source file: ${sourceUri.toString()}`
            );
        }
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
        console.log("deleteCell (soft) message received", { event });
        // Soft-delete: mark the cell as deleted in metadata instead of removing it
        document.softDeleteCell(typedEvent.content.cellId);
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

    updateCellIsLocked: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCellIsLocked"; }>;
        console.log("updateCellIsLocked message received", { event });
        document.updateCellIsLocked(typedEvent.content.cellId, typedEvent.content.isLocked);
    },

    updateMilestoneValue: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateMilestoneValue"; }>;
        console.log("updateMilestoneValue message received", { event });

        // Build milestone index to find the milestone cell
        const milestoneIndex = document.buildMilestoneIndex();
        const milestoneInfo = milestoneIndex.milestones[typedEvent.content.milestoneIndex];

        if (!milestoneInfo) {
            console.error("Milestone not found at index", typedEvent.content.milestoneIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: milestone not found at index ${typedEvent.content.milestoneIndex}`);
            return;
        }

        // Use the cellIndex directly from milestoneInfo for O(1) access
        const milestoneCell = document.getCellByIndex(milestoneInfo.cellIndex);

        if (!milestoneCell || !milestoneCell.metadata?.id) {
            console.error("Milestone cell not found at index", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: cell not found at index ${milestoneInfo.cellIndex}`);
            return;
        }

        // Verify it's actually a milestone cell (safety check)
        if (milestoneCell.metadata?.type !== CodexCellTypes.MILESTONE) {
            console.error("Cell at index is not a milestone cell", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage(`Failed to update milestone: cell at index ${milestoneInfo.cellIndex} is not a milestone cell`);
            return;
        }

        // Skip deleted milestone cells
        if (milestoneCell.metadata?.data?.deleted === true) {
            console.error("Milestone cell is deleted", milestoneInfo.cellIndex);
            vscode.window.showErrorMessage("Failed to update milestone: milestone cell has been deleted");
            return;
        }

        const milestoneCellId = milestoneCell.metadata.id;
        const cancellationToken = new vscode.CancellationTokenSource().token;
        let codexSaveSucceeded = false;
        let sourceUpdateSucceeded = false;

        // Preserve current milestone index and subsection before refreshing webview
        // Get current subsection from map if available, otherwise use cached subsection
        const docUri = document.uri.toString();
        const currentPosition = provider.currentMilestoneSubsectionMap.get(docUri);
        const subsectionIndex = currentPosition?.subsectionIndex ?? provider.getCachedSubsection(docUri);

        // Save milestone index to preserve position after refresh
        provider.currentMilestoneSubsectionMap.set(docUri, {
            milestoneIndex: typedEvent.content.milestoneIndex,
            subsectionIndex: subsectionIndex,
        });

        try {
            // Ensure author is set correctly before creating edit
            await document.refreshAuthor();

            // Update the milestone cell value in codex file
            await document.updateCellContent(
                milestoneCellId,
                typedEvent.content.newValue,
                EditType.USER_EDIT,
                true, // shouldUpdateValue
                false, // retainValidations
                false // skipAutoValidation
            );

            // Note: The custom document change event is automatically fired by updateCellContent
            // through the document's _onDidChangeForVsCodeAndWebview event, which the provider
            // listens to and fires _onDidChangeCustomDocument. No need to fire it explicitly here.

            // Save the codex document using provider's saveCustomDocument for proper VS Code integration
            try {
                await provider.saveCustomDocument(document, cancellationToken);
                codexSaveSucceeded = true;
                console.log(`[updateMilestoneValue] Successfully updated and saved milestone in codex file: ${document.uri.fsPath}`);
            } catch (saveError) {
                console.error(`[updateMilestoneValue] Failed to save codex file ${document.uri.fsPath}:`, saveError);
                vscode.window.showErrorMessage(
                    `Failed to save milestone update to codex file: ${saveError instanceof Error ? saveError.message : String(saveError)}`
                );
                return; // Don't proceed with source file update if codex save failed
            }

            // Also update the corresponding source file to keep milestones in sync
            // Since the UI only shows the edit button in target files, we know document is always target here
            const sourceUri = getCorrespondingSourceUri(document.uri);
            if (!sourceUri) {
                console.warn(`[updateMilestoneValue] Could not find corresponding source file for ${document.uri.fsPath}`);
                vscode.window.showWarningMessage(
                    `Milestone updated in codex file, but could not find corresponding source file.`
                );
                // Refresh webview even if source file not found - codex update succeeded
                provider.refreshWebview(webviewPanel, document);
                return;
            }

            // Check if source file exists before attempting to open it
            try {
                await vscode.workspace.fs.stat(sourceUri);
            } catch (statError) {
                console.warn(`[updateMilestoneValue] Source file does not exist: ${sourceUri.fsPath}`);
                vscode.window.showWarningMessage(
                    `Milestone updated in codex file, but source file not found at ${sourceUri.fsPath}`
                );
                // Refresh webview even if source file doesn't exist - codex update succeeded
                provider.refreshWebview(webviewPanel, document);
                return;
            }

            try {
                // Open the source file as a CodexCellDocument
                const sourceDocument = await provider.openCustomDocument(
                    sourceUri,
                    {},
                    cancellationToken
                );

                // Build milestone index for source document to find milestone at same index
                const sourceMilestoneIndex = sourceDocument.buildMilestoneIndex();
                const sourceMilestoneInfo = sourceMilestoneIndex.milestones[typedEvent.content.milestoneIndex];

                if (!sourceMilestoneInfo) {
                    console.warn(`[updateMilestoneValue] Milestone at index ${typedEvent.content.milestoneIndex} not found in source file ${sourceUri.fsPath}`);
                    vscode.window.showWarningMessage(
                        `Milestone updated in codex file, but milestone at index ${typedEvent.content.milestoneIndex} not found in source file.`
                    );
                    // Refresh webview even if milestone not found - codex update succeeded
                    provider.refreshWebview(webviewPanel, document);
                    return;
                }

                // Get the milestone cell from source document using the cellIndex from milestoneInfo
                const sourceMilestoneCell = sourceDocument.getCellByIndex(sourceMilestoneInfo.cellIndex);
                if (!sourceMilestoneCell || !sourceMilestoneCell.metadata?.id) {
                    console.warn(`[updateMilestoneValue] Milestone cell not found at index ${sourceMilestoneInfo.cellIndex} in source file ${sourceUri.fsPath}`);
                    vscode.window.showWarningMessage(
                        `Milestone updated in codex file, but milestone cell not found in source file.`
                    );
                    // Refresh webview even if milestone cell not found - codex update succeeded
                    provider.refreshWebview(webviewPanel, document);
                    return;
                }

                // Verify it's actually a milestone cell (safety check)
                if (sourceMilestoneCell.metadata?.type !== CodexCellTypes.MILESTONE) {
                    console.warn(`[updateMilestoneValue] Cell at index ${sourceMilestoneInfo.cellIndex} in source file ${sourceUri.fsPath} is not a milestone cell`);
                    vscode.window.showWarningMessage(
                        `Milestone updated in codex file, but cell in source file is not a milestone cell.`
                    );
                    // Refresh webview even if cell type mismatch - codex update succeeded
                    provider.refreshWebview(webviewPanel, document);
                    return;
                }

                const sourceMilestoneCellId = sourceMilestoneCell.metadata.id;

                // Ensure author is set correctly before creating edit
                await sourceDocument.refreshAuthor();

                // Update the milestone cell value in source file using the source milestone cell ID
                await sourceDocument.updateCellContent(
                    sourceMilestoneCellId,
                    typedEvent.content.newValue,
                    EditType.USER_EDIT,
                    true, // shouldUpdateValue
                    false, // retainValidations
                    false // skipAutoValidation
                );

                // Save the source document
                try {
                    await provider.saveCustomDocument(sourceDocument, cancellationToken);
                    sourceUpdateSucceeded = true;
                    console.log(`[updateMilestoneValue] Successfully updated and saved milestone in source file: ${sourceUri.fsPath}`);

                    // Refresh the source webview panel if it's open
                    const sourcePanel = provider.getWebviewPanels().get(sourceUri.toString());
                    if (sourcePanel) {
                        // Preserve milestone index for source document as well
                        const sourceDocUri = sourceDocument.uri.toString();
                        const sourceCurrentPosition = provider.currentMilestoneSubsectionMap.get(sourceDocUri);
                        const sourceSubsectionIndex = sourceCurrentPosition?.subsectionIndex ?? provider.getCachedSubsection(sourceDocUri);
                        provider.currentMilestoneSubsectionMap.set(sourceDocUri, {
                            milestoneIndex: typedEvent.content.milestoneIndex,
                            subsectionIndex: sourceSubsectionIndex,
                        });
                        provider.refreshWebview(sourcePanel, sourceDocument);
                    }
                } catch (sourceSaveError) {
                    console.error(`[updateMilestoneValue] Failed to save source file ${sourceUri.fsPath}:`, sourceSaveError);
                    vscode.window.showWarningMessage(
                        `Milestone updated in codex file, but failed to save source file: ${sourceSaveError instanceof Error ? sourceSaveError.message : String(sourceSaveError)}`
                    );
                    // Refresh webview even if source save failed - codex update succeeded
                    provider.refreshWebview(webviewPanel, document);
                    return;
                }

                // Both updates succeeded
                if (codexSaveSucceeded && sourceUpdateSucceeded) {
                    vscode.window.showInformationMessage(
                        `Milestone "${typedEvent.content.newValue}" updated successfully.`
                    );
                }
            } catch (sourceError) {
                // Log error but don't fail - milestone update in target file should still succeed
                console.error(`[updateMilestoneValue] Error updating milestone in source file ${sourceUri.fsPath}:`, sourceError);
                vscode.window.showWarningMessage(
                    `Milestone updated in codex file, but error updating source file: ${sourceError instanceof Error ? sourceError.message : String(sourceError)}`
                );
            }
        } catch (error) {
            // Critical error - codex update failed
            console.error(`[updateMilestoneValue] Critical error updating milestone:`, error);
            vscode.window.showErrorMessage(
                `Failed to update milestone: ${error instanceof Error ? error.message : String(error)}`
            );
            return;
        }

        // Refresh the webview to show the updated milestone
        provider.refreshWebview(webviewPanel, document);
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
                Videos: ["mp4", "mkv", "avi", "mov", "webm"],
            },
        });
        const fileUri = result?.[0];
        if (fileUri) {
            try {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }

                // Read the video file content
                const fileData = await vscode.workspace.fs.readFile(fileUri);

                // Enforce a reasonable max size (e.g., 600 MB) for video files
                const MAX_BYTES = 600 * 1024 * 1024;
                if (fileData.length > MAX_BYTES) {
                    throw new Error("Video file exceeds maximum allowed size (500 MB)");
                }

                // Determine document segment
                const documentSegment = getDocumentSegment(document);

                // Generate safe filename from original file
                const originalFileName = path.basename(fileUri.fsPath);
                const ext = path.extname(originalFileName).toLowerCase().slice(1); // Remove leading dot
                const allowedExtensions = new Set(["mp4", "mkv", "avi", "mov", "webm", "m4v"]);
                const safeExt = allowedExtensions.has(ext) ? ext : "mp4";

                // Sanitize filename (keep base name, replace unsafe chars)
                const baseName = path.basename(originalFileName, path.extname(originalFileName));
                const sanitizedBaseName = baseName.replace(/[^a-zA-Z0-9._-]/g, "-");
                const fileName = `${sanitizedBaseName}.${safeExt}`;

                // Create directory paths
                const pointersDir = path.join(
                    workspaceFolder.uri.fsPath,
                    ".project",
                    "attachments",
                    "pointers",
                    documentSegment
                );
                const filesDir = path.join(
                    workspaceFolder.uri.fsPath,
                    ".project",
                    "attachments",
                    "files",
                    documentSegment
                );

                // Create directories if they don't exist
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(pointersDir));
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

                const pointersPath = path.join(pointersDir, fileName);
                const filesPath = path.join(filesDir, fileName);

                // Atomic write helper (write to temp then rename)
                const writeFileAtomically = async (finalFsPath: string, data: Uint8Array): Promise<void> => {
                    const tmpPath = `${finalFsPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                    const tmpUri = vscode.Uri.file(tmpPath);
                    const finalUri = vscode.Uri.file(finalFsPath);
                    await vscode.workspace.fs.writeFile(tmpUri, data);
                    await vscode.workspace.fs.rename(tmpUri, finalUri, { overwrite: true });
                    // Optional sanity check to ensure size matches
                    try {
                        const stat = await vscode.workspace.fs.stat(finalUri);
                        if (typeof stat.size === 'number' && stat.size !== data.length) {
                            console.warn("Size mismatch after write for", finalFsPath, { expected: data.length, actual: stat.size });
                        }
                    } catch {
                        // ignore stat issues
                    }
                };

                // Write actual file (primary). Pointer write is best-effort.
                await writeFileAtomically(filesPath, fileData);
                try {
                    await writeFileAtomically(pointersPath, fileData);
                } catch (pointerErr) {
                    console.warn("Pointer write failed; proceeding with saved file only", pointerErr);
                }

                // Store the files path in metadata (relative path from workspace root)
                const relativePath = toPosixPath(path.relative(workspaceFolder.uri.fsPath, filesPath));
                await document.updateNotebookMetadata({ videoUrl: relativePath });
                await document.save(new vscode.CancellationTokenSource().token);
                provider.refreshWebview(webviewPanel, document);
            } catch (error) {
                console.error("Error saving video file:", error);
                vscode.window.showErrorMessage(
                    `Failed to save video file: ${error instanceof Error ? error.message : "Unknown error"}`
                );
            }
        }
    },

    replaceDuplicateCells: ({ event, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "replaceDuplicateCells"; }>;
        console.log("replaceDuplicateCells message received", { event });
        document.replaceDuplicateCells(typedEvent.content);
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

    openLoginFlow: async () => {
        await vscode.commands.executeCommand("codex-project-manager.openStartupFlow", {
            forceLogin: true,
        });
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

    generateBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "generateBacktranslation"; }>;
        const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.generateBacktranslation",
            typedEvent.content.text,
            typedEvent.content.cellId,
            document.uri.fsPath
        );
        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsBacktranslation",
            content: backtranslation,
        });
    },

    editBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "editBacktranslation"; }>;
        const updatedBacktranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.editBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.newText,
            typedEvent.content.existingBacktranslation,
            document.uri.fsPath
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

    getBatchBacktranslations: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getBatchBacktranslations"; }>;
        const cellIds = typedEvent.content.cellIds;

        // Fetch backtranslations for all cell IDs
        const backtranslations: { [cellId: string]: SavedBacktranslation | null; } = {};
        for (const cellId of cellIds) {
            const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
                "codex-smart-edits.getBacktranslation",
                cellId
            );
            backtranslations[cellId] = backtranslation;
        }

        provider.postMessageToWebview(webviewPanel, {
            type: "providerSendsBatchBacktranslations",
            content: backtranslations,
        });
    },

    setBacktranslation: async ({ event, webviewPanel, provider, document }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "setBacktranslation"; }>;
        const backtranslation = await vscode.commands.executeCommand<SavedBacktranslation | null>(
            "codex-smart-edits.setBacktranslation",
            typedEvent.content.cellId,
            typedEvent.content.originalText,
            typedEvent.content.userBacktranslation,
            document.uri.fsPath
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

    updateCachedSubsection: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "updateCachedSubsection"; }>;
        await provider.updateCachedSubsection(document.uri.toString(), typedEvent.content);
    },

    selectABTestVariant: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "selectABTestVariant"; }>;
        const { cellId, selectedIndex, testId, testName, selectionTimeMs, names } = (typedEvent as any).content || {};

        // Import and call the A/B testing feedback function
        const { recordVariantSelection } = await import("../../utils/abTestingUtils");
        await recordVariantSelection(testId, cellId, selectedIndex, selectionTimeMs, names, testName);

        console.log(`A/B test feedback recorded: Cell ${cellId}, variant ${selectedIndex}, test ${testId}, took ${selectionTimeMs}ms`);
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

    validateAudioCell: async ({ event, document, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "validateAudioCell"; }>;
        if (typedEvent.content?.cellId) {
            await provider.enqueueAudioValidation(
                typedEvent.content.cellId,
                document,
                typedEvent.content.validate
            );
        }
    },

    getValidationCount: async ({ webviewPanel, provider }) => {
        // Validation count is now bundled with initial content; only send on explicit request
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCount = config.get("validationCount", 1);
        provider.postMessageToWebview(webviewPanel, {
            type: "validationCount",
            content: validationCount,
        });
    },

    getValidationCountAudio: async ({ webviewPanel, provider }) => {
        // Audio validation count is now bundled with initial content; only send on explicit request
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCountAudio = config.get("validationCountAudio", 1);
        provider.postMessageToWebview(webviewPanel, {
            type: "validationCountAudio",
            content: validationCountAudio,
        });
    },

    adjustABTestingProbability: async ({ event, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "adjustABTestingProbability"; }>;
        const delta = Number(typedEvent.content?.delta) || 0;
        const buttonChoice = typedEvent.content?.buttonChoice as "more" | "less" | undefined;
        const testId = typedEvent.content?.testId;
        const cellId = typedEvent.content?.cellId;

        // TEMPORARY: Disabled probability adjustment to prevent feedback loop during A/B testing.
        // If "See more" actually increases probability, users who prefer more tests will see more tests,
        // creating a biased feedback loop. For now, buttons only record preference without changing settings.
        // TODO: Re-enable probability adjustment after A/B test analysis is complete.

        // Record A/B test result if a button was clicked
        if (buttonChoice && testId && cellId) {
            try {
                const { recordAbResult } = await import("../../utils/abTestingAnalytics");
                await recordAbResult({
                    category: "Frequency Preference",
                    options: ["See more", "See less"],
                    winner: buttonChoice === "more" ? 0 : 1,
                });
                console.log(`Recorded frequency preference A/B test: ${buttonChoice} won`);
            } catch (analyticsError) {
                console.warn("[A/B] Failed to post frequency preference analytics", analyticsError);
            }
        }

        // TEMPORARY: Probability adjustment disabled - see comment above
        // try {
        //     const config = vscode.workspace.getConfiguration("codex-editor-extension");
        //     const current = Number(config.get("abTestingProbability")) || 0;
        //     const next = Math.max(0, Math.min(1, current + delta));
        //     await config.update("abTestingProbability", next, vscode.ConfigurationTarget.Workspace);
        //     // Inform webview of new value
        //     provider.postMessageToWebview(webviewPanel, {
        //         type: "abTestingProbabilityUpdated",
        //         content: { value: next }
        //     });
        //     vscode.window.setStatusBarMessage(`A/B test frequency set to ${(next * 100).toFixed(0)}%`, 2000);
        // } catch (err) {
        //     console.error("Failed to update A/B testing probability", err);
        // }
    },

    getCurrentUsername: async ({ webviewPanel, provider }) => {
        // Username is now bundled with initial content; only send on explicit request
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

    toggleCorrectionEditorMode: ({ provider }) => {
        console.log("toggleCorrectionEditorMode message received");
        provider.toggleCorrectionEditorMode();
    },

    cancelMerge: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "cancelMerge"; }>;
        const cellId = typedEvent.content.cellId;

        console.log("cancelMerge message received for cell:", cellId);

        try {
            // Get the current cell data and remove the merged flag
            const currentCellData = document.getCellData(cellId) || {};

            // Remove the merged flag by setting it to false in the current document
            document.updateCellData(cellId, {
                ...currentCellData,
                merged: false
            });

            // Record an edit on the (now unmerged) current cell to reflect the merged flag change to false
            try {
                const currentCellForEdits = document.getCell(cellId);
                if (currentCellForEdits) {
                    if (!currentCellForEdits.metadata.edits) {
                        currentCellForEdits.metadata.edits = [] as any;
                    }
                    const ts = Date.now();
                    // Best-effort user lookup (anonymous fallback)
                    let user = "anonymous";
                    try {
                        const authApi = await provider.getAuthApi();
                        const userInfo = await authApi?.getUserInfo();
                        user = userInfo?.username || "anonymous";
                    } catch { /* ignore */ }
                    (currentCellForEdits.metadata.edits as any[]).push({
                        editMap: EditMapUtils.metadataNested("data", "merged"),
                        value: false,
                        timestamp: ts,
                        type: EditType.USER_EDIT,
                        author: user,
                        validatedBy: []
                    });
                }
            } catch (e) {
                console.warn("Failed to record unmerge edit entry on source cell", e);
            }

            // Save the current document
            await document.save(new vscode.CancellationTokenSource().token);

            console.log(`Successfully unmerged cell in source: ${cellId}`);

            // Also unmerge the corresponding cell in the target file (like merge function does)
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                await provider.unmergeMatchingCellsInTargetFile(cellId, document.uri.toString(), workspaceFolder);
            } else {
                console.warn("No workspace folder found, skipping target file unmerge");
                vscode.window.showWarningMessage("Could not unmerge corresponding cell in target file - no workspace folder found");
            }

            // Refresh the webview to show the updated state
            provider.refreshWebview(webviewPanel, document);

        } catch (error) {
            console.error("Error canceling merge for cell:", cellId, error);
            vscode.window.showErrorMessage(
                `Failed to unmerge cell: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    },

    triggerReindexing: async () => {
        console.log("Triggering reindexing after all translations completed");
        await vscode.commands.executeCommand("codex-editor-extension.forceReindex");
    },

    // requestAudioAttachments removed: provider proactively sends status; no webview-initiated fallback

    requestAudioForCell: async ({ event, document, webviewPanel }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "requestAudioForCell"; }>;
        const cellId = typedEvent.content.cellId;
        const audioId = (typedEvent.content as any).audioId; // Optional specific audio ID
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        if (!workspaceFolder) {
            debug("No workspace folder found");
            return;
        }

        try {
            let targetAttachment;
            let targetAttachmentId;

            if (audioId) {
                // Specific audio ID requested - get that exact attachment
                const documentText = document.getText();
                const notebookData = JSON.parse(documentText);
                const cell = notebookData.cells.find((c: any) => c.metadata?.id === cellId);

                if (cell?.metadata?.attachments?.[audioId]) {
                    targetAttachment = cell.metadata.attachments[audioId];
                    targetAttachmentId = audioId;
                }
            } else {
                // No specific ID - use the currently selected audio (respects selectedAudioId)
                const currentAttachment = document.getCurrentAttachment(cellId, "audio");
                if (currentAttachment) {
                    targetAttachment = currentAttachment.attachment;
                    targetAttachmentId = currentAttachment.attachmentId;
                }
            }

            if (targetAttachment && targetAttachmentId) {
                const attachmentPath = toPosixPath(targetAttachment.url);
                const fullPath = path.isAbsolute(attachmentPath)
                    ? attachmentPath
                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                // Check if the file exists and get its stats to ensure we're serving the latest version
                let fileExists = false;
                let fileStats: vscode.FileStat | undefined;

                try {
                    fileStats = await vscode.workspace.fs.stat(vscode.Uri.file(fullPath));
                    fileExists = true;
                } catch {
                    fileExists = false;
                }

                if (fileExists && fileStats) {
                    const ext = path.extname(fullPath).toLowerCase();
                    const mimeType = ext === ".webm" ? "audio/webm" :
                        ext === ".mp3" ? "audio/mp3" :
                            ext === ".m4a" ? "audio/mp4" :
                                ext === ".ogg" ? "audio/ogg" : "audio/wav";

                    let fileData: Uint8Array;

                    try {
                        // ========== LFS STREAMING LOGIC ==========
                        // Import LFS helpers
                        const { isPointerFile, parsePointerFile, replaceFileWithPointer } = await import("../../utils/lfsHelpers");
                        const { getMediaFilesStrategy: getStrategy } = await import("../../utils/localProjectSettings");

                        // Check if file is an LFS pointer
                        const isPointer = await isPointerFile(fullPath);

                        if (isPointer) {
                            // File is an LFS pointer - need to stream from LFS
                            debug("File is LFS pointer, streaming from server:", fullPath);

                            // Get media strategy
                            const mediaStrategy = await getStrategy(workspaceFolder.uri);

                            if (mediaStrategy === "auto-download") {
                                // This shouldn't happen in auto-download mode
                                throw new Error("File should have been downloaded in auto-download mode");
                            }

                            // Enforce version gates (Frontier required version + project metadata versions)
                            const { ensureAllVersionGatesForMedia } = await import("../../utils/versionGate");
                            const allowed = await ensureAllVersionGatesForMedia(true);
                            if (!allowed) {
                                throw new Error("Media operation blocked due to version requirements.");
                            }

                            // Parse pointer to get OID and size
                            const pointer = await parsePointerFile(fullPath);
                            if (!pointer) {
                                throw new Error("Invalid LFS pointer file format");
                            }

                            // Get frontier API
                            const { getAuthApi } = await import("../../extension");
                            const frontierApi = getAuthApi();
                            if (!frontierApi) {
                                throw new Error("Frontier authentication extension not available. Please ensure it's installed and active.");
                            }

                            // Download from LFS
                            debug(`Downloading LFS file: OID=${pointer.oid.substring(0, 8)}..., size=${pointer.size}`);
                            const lfsData = await frontierApi.downloadLFSFile(
                                workspaceFolder.uri.fsPath,
                                pointer.oid,
                                pointer.size
                            );

                            fileData = lfsData;
                            debug("Successfully streamed file from LFS");

                            // If strategy is "stream-and-save", replace pointer with actual file
                            if (mediaStrategy === "stream-and-save") {
                                try {
                                    await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), fileData);
                                    debug("Saved streamed file to disk (stream-and-save mode)");
                                    // Immediately inform webview this cell now has a local file
                                    try {
                                        safePostMessageToPanel(webviewPanel, {
                                            type: "providerSendsAudioAttachments",
                                            attachments: { [cellId]: "available-local" as const }
                                        });
                                    } catch { /* non-fatal */ }
                                } catch (saveError) {
                                    console.warn("Failed to save streamed file:", saveError);
                                    // Don't fail the whole operation if save fails
                                }
                            }
                        } else {
                            // File is actual audio data - read normally
                            fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                            debug("Read audio file from disk:", fullPath);
                        }
                    } catch (lfsError) {
                        // LFS streaming failed - send error to webview
                        console.error("Error streaming audio file:", lfsError);
                        const errorMessage = lfsError instanceof Error ? lfsError.message : "Failed to load audio file";

                        safePostMessageToPanel(webviewPanel, {
                            type: "providerSendsAudioData",
                            content: {
                                cellId: cellId,
                                audioId: targetAttachmentId,
                                audioData: null,
                                error: errorMessage,
                                transcription: targetAttachment.transcription || null
                            }
                        });

                        return;
                    }

                    // Convert to base64 and send to webview
                    const base64Data = `data:${mimeType};base64,${Buffer.from(fileData).toString('base64')}`;

                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioData",
                        content: {
                            cellId: cellId,
                            audioId: targetAttachmentId,
                            audioData: base64Data,
                            transcription: targetAttachment.transcription || null,
                            fileModified: fileStats.mtime
                        }
                    });

                    debug("Sent audio data for cell:", cellId, "audioId:", targetAttachmentId, "modified:", fileStats.mtime);
                    return;
                } else {
                    debug("Audio file not found in files/ path:", fullPath);

                    // Attempt fallback: look for pointer under attachments/pointers and stream from LFS
                    try {
                        const filesPosix = toPosixPath(fullPath);
                        const pointerFullPath = filesPosix.includes("/.project/attachments/files/")
                            ? filesPosix.replace("/.project/attachments/files/", "/.project/attachments/pointers/")
                            : filesPosix.replace(".project/attachments/files/", ".project/attachments/pointers/");

                        // Check if pointer exists
                        let pointerStats: vscode.FileStat | undefined;
                        try {
                            pointerStats = await vscode.workspace.fs.stat(vscode.Uri.file(pointerFullPath));
                        } catch { /* no-op */ }

                        if (pointerStats) {
                            // Enforce version gates prior to fallback streaming
                            const { ensureAllVersionGatesForMedia } = await import("../../utils/versionGate");
                            const allowed = await ensureAllVersionGatesForMedia(true);
                            if (!allowed) {
                                throw new Error("Media operation blocked due to version requirements.");
                            }

                            // Parse pointer
                            const { parsePointerFile, replaceFileWithPointer } = await import("../../utils/lfsHelpers");
                            const pointer = await parsePointerFile(pointerFullPath);
                            if (!pointer) {
                                throw new Error("Invalid LFS pointer file format (fallback)");
                            }

                            // Get media strategy
                            const { getMediaFilesStrategy: getStrategy } = await import("../../utils/localProjectSettings");
                            const mediaStrategy = await getStrategy(workspaceFolder.uri);

                            // Download from LFS via Frontier API
                            const { getAuthApi } = await import("../../extension");
                            const frontierApi = getAuthApi();
                            if (!frontierApi) {
                                throw new Error("Frontier authentication extension not available");
                            }

                            const lfsData = await frontierApi.downloadLFSFile(
                                workspaceFolder.uri.fsPath,
                                pointer.oid,
                                pointer.size
                            );

                            // If stream-and-save, write file bytes to files path
                            if (mediaStrategy === "stream-and-save") {
                                try {
                                    await vscode.workspace.fs.createDirectory(vscode.Uri.file(path.dirname(fullPath)));
                                    await vscode.workspace.fs.writeFile(vscode.Uri.file(fullPath), lfsData);
                                    // Targeted availability update for this cell
                                    try {
                                        safePostMessageToPanel(webviewPanel, {
                                            type: "providerSendsAudioAttachments",
                                            attachments: { [cellId]: "available-local" as const }
                                        });
                                    } catch { /* non-fatal */ }
                                } catch (e) {
                                    console.warn("Failed to save streamed file in fallback:", e);
                                }
                            } else if (mediaStrategy === "stream-only") {
                                // Ensure files/ contains pointer for consistency (avoid repeated "not found")
                                try {
                                    // Derive relative path under pointers/
                                    const relFromPointers = pointerFullPath.split("/.project/attachments/pointers/").pop() ||
                                        pointerFullPath.split(".project/attachments/pointers/").pop();
                                    if (relFromPointers) {
                                        await replaceFileWithPointer(workspaceFolder.uri.fsPath, relFromPointers);
                                    }
                                } catch (e) {
                                    // Non-fatal
                                }
                            }

                            // Send to webview
                            const ext = path.extname(fullPath).toLowerCase();
                            const mimeType = ext === ".webm" ? "audio/webm" :
                                ext === ".mp3" ? "audio/mp3" :
                                    ext === ".m4a" ? "audio/mp4" :
                                        ext === ".ogg" ? "audio/ogg" : "audio/wav";
                            const base64Data = `data:${mimeType};base64,${Buffer.from(lfsData).toString('base64')}`;

                            safePostMessageToPanel(webviewPanel, {
                                type: "providerSendsAudioData",
                                content: {
                                    cellId: cellId,
                                    audioId: targetAttachmentId,
                                    audioData: base64Data,
                                    transcription: targetAttachment.transcription || null,
                                    fileModified: pointerStats.mtime,
                                }
                            });

                            return;
                        }
                    } catch (fallbackErr) {
                        console.error("Fallback pointer streaming failed:", fallbackErr);
                    }
                }
            }

            // If no audio found and no specific audioId requested, send empty response
            if (!audioId) {
                safePostMessageToPanel(webviewPanel, {
                    type: "providerSendsAudioData",
                    content: {
                        cellId: cellId,
                        audioId: null,
                        audioData: null
                    }
                });
                debug("No current audio attachment found for cell:", cellId);
                return;
            }
        } catch (error) {
            console.error("Error in requestAudioForCell:", error);
        }

        // If no attachment in metadata, check filesystem for legacy files
        const bookAbbr = cellId.split(' ')[0];
        const attachmentsFilesPath = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            "files",
            bookAbbr
        );
        const legacyAttachmentsPath = path.join(
            workspaceFolder.uri.fsPath,
            ".project",
            "attachments",
            bookAbbr
        );

        const tryPaths = [attachmentsFilesPath, legacyAttachmentsPath];
        for (const attachmentsPath of tryPaths) {
            if (!(await pathExists(attachmentsPath))) continue;
            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));
            const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];

            for (const [entryName, entryType] of files) {
                if (entryType !== vscode.FileType.File) continue;
                const audioFile = entryName;
                if (audioExtensions.some(ext => audioFile.toLowerCase().endsWith(ext))) {
                    const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                    if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                        const fullPath = path.join(attachmentsPath, audioFile);

                        const fileData = await vscode.workspace.fs.readFile(vscode.Uri.file(fullPath));
                        const mimeType = audioFile.endsWith('.webm') ? 'audio/webm' :
                            audioFile.endsWith('.mp3') ? 'audio/mp3' :
                                audioFile.endsWith('.m4a') ? 'audio/mp4' :
                                    audioFile.endsWith('.ogg') ? 'audio/ogg' :
                                        'audio/wav';
                        const base64Data = `data:${mimeType};base64,${Buffer.from(fileData).toString('base64')}`;

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

        // Always send a response, even if no audio is found
        safePostMessageToPanel(webviewPanel, {
            type: "providerSendsAudioData",
            content: {
                cellId: cellId,
                audioId: audioId || null,
                audioData: null
            }
        });
    },

    saveAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "saveAudioAttachment"; }>;
        console.log("saveAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId,
            fileExtension: typedEvent.content.fileExtension
        });

        // Prevent saving audio if cell is locked
        const cellId = typedEvent.content.cellId;
        const cell = document.getCell(cellId);
        if (cell?.metadata?.isLocked) {
            console.warn(`Attempted to save audio to locked cell ${cellId}. Operation blocked.`);
            safePostMessageToPanel(webviewPanel, {
                type: "error",
                content: { message: `Cannot save audio: cell ${cellId} is locked` }
            });
            return;
        }

        try {
            const documentSegment = typedEvent.content.cellId.split(' ')[0];
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            // Basic input validation and normalization
            const allowedExtensions = new Set(["webm", "wav", "mp3", "m4a", "ogg"]);
            const sanitizedAudioId = String(typedEvent.content.audioId).replace(/[^a-zA-Z0-9._-]/g, "-");
            const ext = (typedEvent.content.fileExtension || "webm").toLowerCase();
            const safeExt = allowedExtensions.has(ext) ? ext : "webm";

            const base64Data = typedEvent.content.audioData.split(',')[1] || typedEvent.content.audioData;
            const buffer = Buffer.from(base64Data, 'base64');

            if (!buffer || buffer.length === 0) {
                throw new Error("Decoded audio is empty");
            }
            // Enforce a reasonable max size (e.g., 50 MB) to avoid runaway writes
            const MAX_BYTES = 50 * 1024 * 1024;
            if (buffer.length > MAX_BYTES) {
                throw new Error("Audio exceeds maximum allowed size (50 MB)");
            }

            const pointersDir = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                "attachments",
                "pointers",
                documentSegment
            );
            const filesDir = path.join(
                workspaceFolder.uri.fsPath,
                ".project",
                "attachments",
                "files",
                documentSegment
            );

            await vscode.workspace.fs.createDirectory(vscode.Uri.file(pointersDir));
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(filesDir));

            const fileName = `${sanitizedAudioId}.${safeExt}`;
            const pointersPath = path.join(pointersDir, fileName);
            const filesPath = path.join(filesDir, fileName);

            // Atomic write helper (write to temp then rename)
            const writeFileAtomically = async (finalFsPath: string, data: Uint8Array): Promise<void> => {
                const tmpPath = `${finalFsPath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2)}`;
                const tmpUri = vscode.Uri.file(tmpPath);
                const finalUri = vscode.Uri.file(finalFsPath);
                await vscode.workspace.fs.writeFile(tmpUri, data);
                await vscode.workspace.fs.rename(tmpUri, finalUri, { overwrite: true });
                // Optional sanity check to ensure size matches
                try {
                    const stat = await vscode.workspace.fs.stat(finalUri);
                    if (typeof stat.size === 'number' && stat.size !== data.length) {
                        console.warn("Size mismatch after write for", finalFsPath, { expected: data.length, actual: stat.size });
                    }
                } catch {
                    // ignore stat issues
                }
            };

            // Write actual file (primary). Pointer write is best-effort.
            await writeFileAtomically(filesPath, buffer);
            try {
                await writeFileAtomically(pointersPath, buffer);
            } catch (pointerErr) {
                console.warn("Pointer write failed; proceeding with saved file only", pointerErr);
            }

            // Store the files path in metadata (not the pointer path) so we can directly read the actual file
            const relativePath = toPosixPath(path.relative(workspaceFolder.uri.fsPath, filesPath));
            await document.updateCellAttachment(typedEvent.content.cellId, sanitizedAudioId, {
                url: relativePath,
                type: "audio",
                createdAt: Date.now(),
                updatedAt: Date.now(),
                isDeleted: false,
                // Persist optional metadata if provided by client
                ...(typedEvent.content.metadata ? { metadata: typedEvent.content.metadata } : {}),
            } as any);

            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSaved",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: sanitizedAudioId,
                    success: true
                }
            });

            // Send targeted audio attachment update instead of full refresh to preserve tab state
            const documentText = document.getText();
            let notebookData: any = {};
            if (documentText.trim().length > 0) {
                try {
                    notebookData = JSON.parse(documentText);
                } catch {
                    debug("Could not parse document as JSON for audio attachment update");
                    notebookData = {};
                }
            }
            const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
            const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {} as any;

            for (const cell of cells) {
                const cellId = cell?.metadata?.id;
                if (!cellId) continue;
                let hasAvailable = false;
                let hasAvailablePointer = false;
                let hasMissing = false;
                let hasDeleted = false;
                const atts = cell?.metadata?.attachments || {};
                for (const key of Object.keys(atts)) {
                    const att: any = (atts as any)[key];
                    if (att && att.type === "audio") {
                        if (att.isDeleted) {
                            hasDeleted = true;
                        } else if (att.isMissing) {
                            hasMissing = true;
                        } else {
                            try {
                                const url = String(att.url || "");
                                if (url) {
                                    const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                    const filesAbs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                    try {
                                        await vscode.workspace.fs.stat(vscode.Uri.file(filesAbs));
                                        const { isPointerFile } = await import("../../utils/lfsHelpers");
                                        const isPtr = await isPointerFile(filesAbs).catch(() => false);
                                        if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                    } catch {
                                        const pointerAbs = filesAbs.includes("/.project/attachments/files/")
                                            ? filesAbs.replace("/.project/attachments/files/", "/.project/attachments/pointers/")
                                            : filesAbs.replace(".project/attachments/files/", ".project/attachments/pointers/");
                                        try {
                                            await vscode.workspace.fs.stat(vscode.Uri.file(pointerAbs));
                                            hasAvailablePointer = true;
                                        } catch {
                                            hasMissing = true;
                                        }
                                    }
                                } else {
                                    hasMissing = true;
                                }
                            } catch { hasMissing = true; }
                        }
                    }
                }
                // Provisional state
                let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                if (hasAvailable) state = "available-local";
                else if (hasAvailablePointer) state = "available-pointer";
                else if (hasMissing) state = "missing";
                else if (hasDeleted) state = "deletedOnly";
                else state = "none";

                if (state !== "available-local") {
                    try {
                        const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                        const status = await getFrontierVersionStatus();
                        if (!status.ok) {
                            if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                state = "available-pointer";
                            }
                        }
                    } catch { /* ignore */ }
                }

                availability[cellId] = state as any;
            }

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsAudioAttachments",
                attachments: availability as any,
            });

            debug("Audio attachment saved successfully:", { pointersPath, filesPath });

            // Proactively send the audio data so the editor waveform loads immediately after save
            // If immediate disk read fails (e.g., Windows rename latency), fall back to in-memory buffer
            {
                const absPath = path.isAbsolute(filesPath) ? filesPath : path.join(workspaceFolder.uri.fsPath, filesPath);
                const extNow = path.extname(absPath).toLowerCase();
                const mimeNow = extNow === ".webm" ? "audio/webm" :
                    extNow === ".mp3" ? "audio/mp3" :
                        extNow === ".m4a" ? "audio/mp4" :
                            extNow === ".ogg" ? "audio/ogg" : "audio/wav";

                let base64Now: string | null = null;
                try {
                    const bytesNow = await vscode.workspace.fs.readFile(vscode.Uri.file(absPath));
                    base64Now = `data:${mimeNow};base64,${Buffer.from(bytesNow).toString('base64')}`;
                } catch (e) {
                    console.warn("Failed to read freshly saved audio from disk; falling back to buffer", e);
                    try {
                        base64Now = `data:${mimeNow};base64,${Buffer.from(buffer).toString('base64')}`;
                    } catch (fallbackErr) {
                        console.warn("Fallback to in-memory buffer failed", fallbackErr);
                    }
                }

                if (typeof base64Now === 'string') {
                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioData",
                        content: {
                            cellId: typedEvent.content.cellId,
                            audioId: sanitizedAudioId,
                            audioData: base64Now,
                            fileModified: Date.now()
                        }
                    } as any);
                }
            }
        } catch (error) {
            console.error("Error saving audio attachment:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSaved",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    },

    deleteAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "deleteAudioAttachment"; }>;


        // Soft delete the attachment (set isDeleted: true) instead of hard deleting files
        await document.softDeleteCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentDeleted",
            content: {
                cellId: typedEvent.content.cellId,
                audioId: typedEvent.content.audioId,
                success: true
            }
        });

        // The modal will handle refreshing its own history, and the main UI will 
        // update when the user navigates away and back or when the document is saved

        debug("Audio attachment soft deleted successfully");
    },

    getAudioHistory: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "getAudioHistory"; }>;

        // Clean up any invalid audio selections (safe to do now that document is loaded)
        document.cleanupInvalidAudioSelections();

        const audioHistory = document.getAttachmentHistory(typedEvent.content.cellId, "audio") || [];

        // Get the current attachment to know which one is actually selected
        const currentAttachment = document.getCurrentAttachment(typedEvent.content.cellId, "audio");

        // Check if there's an explicit selection or if we're using automatic behavior
        const explicitSelection = document.getExplicitAudioSelection(typedEvent.content.cellId);

        provider.postMessageToWebview(webviewPanel, {
            type: "audioHistoryReceived",
            content: {
                cellId: typedEvent.content.cellId,
                audioHistory: audioHistory,
                currentAttachmentId: currentAttachment?.attachmentId ?? null,
                hasExplicitSelection: explicitSelection !== null
            }
        });

        debug("Audio history sent successfully:", { cellId: typedEvent.content.cellId, count: audioHistory.length, currentId: currentAttachment?.attachmentId });
    },

    restoreAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "restoreAudioAttachment"; }>;
        console.log("restoreAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId
        });

        // Restore the attachment (set isDeleted: false)
        await document.restoreCellAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

        provider.postMessageToWebview(webviewPanel, {
            type: "audioAttachmentRestored",
            content: {
                cellId: typedEvent.content.cellId,
                audioId: typedEvent.content.audioId,
                success: true
            }
        });

        // The modal will handle refreshing its own history, and the main UI will 
        // update when the user navigates away and back or when the document is saved

        debug("Audio attachment restored successfully");
    },

    selectAudioAttachment: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "selectAudioAttachment"; }>;
        console.log("selectAudioAttachment message received", {
            cellId: typedEvent.content.cellId,
            audioId: typedEvent.content.audioId
        });

        try {
            // Select the audio attachment
            await document.selectAudioAttachment(typedEvent.content.cellId, typedEvent.content.audioId);

            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSelected",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    success: true
                }
            });

            // Send targeted audio attachment update instead of full refresh to preserve tab state
            const documentText = document.getText();
            let notebookData: any = {};
            if (documentText.trim().length > 0) {
                try {
                    notebookData = JSON.parse(documentText);
                } catch {
                    debug("Could not parse document as JSON for audio attachment update");
                    notebookData = {};
                }
            }
            const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
            const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {} as any;
            let validatedByArray: ValidationEntry[] = [];

            for (const cell of cells) {
                const cellId = cell?.metadata?.id;
                if (!cellId) continue;
                let hasAvailable = false;
                let hasAvailablePointer = false;
                let hasMissing = false;
                let hasDeleted = false;
                const atts = cell?.metadata?.attachments || {};

                for (const key of Object.keys(atts)) {
                    const att: any = (atts as any)[key];
                    if (att && att.type === "audio") {
                        if (att.isDeleted) {
                            hasDeleted = true;
                        } else if (att.isMissing) {
                            hasMissing = true;
                        } else {
                            // Differentiate pointer vs real file by inspecting attachments/files path
                            try {
                                const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                                const url = String(att.url || "");
                                if (ws && url) {
                                    const filesPath = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                    const abs = path.join(ws.uri.fsPath, filesPath);
                                    const { isPointerFile } = await import("../../utils/lfsHelpers");
                                    const isPtr = await isPointerFile(abs).catch(() => false);
                                    if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                } else {
                                    hasAvailable = true;
                                }
                            } catch {
                                hasAvailable = true;
                            }
                        }
                    }

                    if (cellId === typedEvent.content.cellId && key === cell?.metadata?.selectedAudioId) {
                        const validatedBy = Array.isArray(att?.validatedBy) ? att.validatedBy : [];
                        validatedByArray = [...validatedBy];
                    }
                }
                availability[cellId] = hasAvailable
                    ? "available-local"
                    : hasAvailablePointer
                        ? "available-pointer"
                        : hasMissing
                            ? "missing"
                            : hasDeleted
                                ? "deletedOnly"
                                : "none";
            }

            provider.postMessageToWebview(webviewPanel, {
                type: "providerSendsAudioAttachments",
                attachments: availability as any,
            });

            provider.postMessageToWebview(webviewPanel, {
                type: "providerUpdatesAudioValidationState",
                content: {
                    cellId: typedEvent.content.cellId,
                    selectedAudioId: typedEvent.content.audioId,
                    validatedBy: validatedByArray
                },
            });



            // Save the changes to the document

            await document.save(new vscode.CancellationTokenSource().token);

            debug("Audio attachment selected successfully");
        } catch (error) {
            console.error("Error selecting audio attachment:", error);
            provider.postMessageToWebview(webviewPanel, {
                type: "audioAttachmentSelected",
                content: {
                    cellId: typedEvent.content.cellId,
                    audioId: typedEvent.content.audioId,
                    success: false,
                    error: error instanceof Error ? error.message : String(error)
                }
            });
        }
    },

    confirmCellMerge: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "confirmCellMerge"; }>;
        const { currentCellId, previousCellId, currentContent, previousContent, message } = typedEvent.content;

        console.log("confirmCellMerge message received for cells:", { currentCellId, previousCellId });

        try {
            // Check if we're working with a source file and need to check for child cells
            const isSourceFile = document.uri.toString().includes(".source");

            if (isSourceFile) {
                const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                if (!workspaceFolder) {
                    throw new Error("No workspace folder found");
                }

                // Check for child cells in the target that correspond to the cells being merged
                const cellsToCheck = [currentCellId, previousCellId];
                const childCells = await provider.checkForChildCellsInTarget(cellsToCheck, workspaceFolder);

                if (childCells.length > 0) {
                    // Child cells exist - prevent the merge
                    const childCellsList = childCells.map(id => `• ${id}`).join('\n');
                    const errorMessage = `Cannot merge source cells because the following child cells exist in the target file:\n\n${childCellsList}\n\nPlease remove or delete these child cells first before merging the source cells.`;

                    vscode.window.showErrorMessage(errorMessage, { modal: true });
                    return; // Exit early, don't proceed with merge
                }
            }

            // No child cells found, proceed with existing confirmation flow
            const confirmed = await vscode.window.showWarningMessage(
                message,
                { modal: false },
                "Yes",
                "No"
            );

            if (confirmed === "Yes") {
                // User confirmed, proceed with merge
                const mergeEvent: EditorPostMessages = {
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
                    provider,
                    updateWebview: () => {
                        provider.refreshWebview(webviewPanel, document);
                    }
                });

                // Only merge in target if we're working with a source file
                if (isSourceFile) {
                    const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
                    if (!workspaceFolder) {
                        throw new Error("No workspace folder found");
                    }
                    await provider.mergeMatchingCellsInTargetFile(currentCellId, previousCellId, document.uri.toString(), workspaceFolder);
                }
            }
        } catch (error) {
            console.error("Error in confirmCellMerge:", error);
            vscode.window.showErrorMessage(
                `Failed to confirm cell merge: ${error instanceof Error ? error.message : String(error)}`
            );
        }
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

            // Get workspace folder for audio file operations
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);

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

            // Ensure an INITIAL_IMPORT exists for previous cell value if missing
            if (existingEdits.length === 0 && previousCell.value) {
                existingEdits.push({
                    editMap: EditMapUtils.value(),
                    value: previousCell.value,
                    timestamp: timestamp,
                    type: EditType.INITIAL_IMPORT,
                    author: currentUser,
                    validatedBy: []
                } as any);
            }

            // 1. Concatenate content and create merged edit
            const mergedContent = previousContent + "<span>&nbsp;</span>" + currentContent;
            const mergeEdit: EditHistory = {
                editMap: EditMapUtils.value(),
                value: mergedContent,
                timestamp: timestamp + 1,
                type: EditType.USER_EDIT,
                author: currentUser,
                validatedBy: []
            };

            // 3. Merge cell labels with a hyphen
            const previousLabel = previousCell.metadata?.cellLabel || "";
            const currentLabel = currentCell.metadata?.cellLabel || "";
            let mergedLabel = "";

            if (previousLabel && currentLabel) {
                mergedLabel = `${previousLabel}-${currentLabel}`;
            } else if (previousLabel) {
                mergedLabel = previousLabel;
            } else if (currentLabel) {
                mergedLabel = currentLabel;
            }

            // Update the previous cell content and edit history directly
            // Since this is a merge operation in source files, we need to bypass normal restrictions
            const updatedEdits = [...existingEdits, mergeEdit];

            // Update the previous cell content and metadata directly
            previousCell.value = mergedContent;
            if (!previousCell.metadata.edits) {
                previousCell.metadata.edits = [];
            }
            previousCell.metadata.edits = updatedEdits;

            // Update the merged cell label
            if (mergedLabel) {
                previousCell.metadata.cellLabel = mergedLabel;
            }

            // 4. Merge time ranges if both cells have timing data
            const previousData = previousCell.metadata?.data;
            const currentData = currentCell.metadata?.data;

            if (previousData?.startTime !== undefined && currentData?.endTime !== undefined) {
                // Take startTime from previous cell and endTime from current cell
                const mergedStartTime = previousData.startTime;
                const mergedEndTime = currentData.endTime;

                // Update the previous cell's time range
                if (!previousCell.metadata.data) {
                    previousCell.metadata.data = {};
                }

                previousCell.metadata.data = {
                    ...previousCell.metadata.data,
                    startTime: mergedStartTime,
                    endTime: mergedEndTime
                };
            }

            // 5. Merge audio files if both cells have audio attachments
            if (workspaceFolder) {
                try {
                    // Get current attachments - read directly from previousCell to ensure we have the latest state
                    // This is important because previousCell may have been modified in a previous merge operation
                    let previousAttachment: { attachmentId: string; attachment: any; } | null = null;

                    // Check if previousCell has a selectedAudioId, otherwise get the latest attachment
                    if (previousCell.metadata?.selectedAudioId && previousCell.metadata?.attachments) {
                        const selectedId = previousCell.metadata.selectedAudioId;
                        const selectedAtt = previousCell.metadata.attachments[selectedId];
                        if (selectedAtt && selectedAtt.type === "audio" && !selectedAtt.isDeleted) {
                            previousAttachment = { attachmentId: selectedId, attachment: selectedAtt };
                            console.log(`[mergeCellWithPrevious] Using selected audio attachment: ${selectedId} for cell ${previousCellId}`);
                        }
                    }

                    // Fallback to latest non-deleted attachment if no explicit selection
                    if (!previousAttachment && previousCell.metadata?.attachments) {
                        const attachments = Object.entries(previousCell.metadata.attachments)
                            .filter(([_, att]: [string, any]) =>
                                att && att.type === "audio" && !att.isDeleted
                            )
                            .sort(([_, a]: [string, any], [__, b]: [string, any]) =>
                                (b.updatedAt || 0) - (a.updatedAt || 0)
                            );
                        if (attachments.length > 0) {
                            const [attachmentId, attachment] = attachments[0];
                            previousAttachment = { attachmentId, attachment };
                            console.log(`[mergeCellWithPrevious] Using latest audio attachment: ${attachmentId} (updatedAt: ${attachment.updatedAt}) for cell ${previousCellId}`);
                        }
                    }

                    // Get current cell's attachment using getCurrentAttachment (this should be fine for current cell)
                    const currentAttachment = document.getCurrentAttachment(currentCellId, "audio");

                    // Resolve file paths from attachment URLs
                    let previousAudioPath: string | null = null;
                    let currentAudioPath: string | null = null;

                    if (previousAttachment?.attachment?.url) {
                        const attachmentPath = toPosixPath(previousAttachment.attachment.url);
                        previousAudioPath = path.isAbsolute(attachmentPath)
                            ? attachmentPath
                            : path.join(workspaceFolder.uri.fsPath, attachmentPath);
                        // Verify file exists
                        if (!(await pathExists(previousAudioPath))) {
                            previousAudioPath = null;
                        }
                    }

                    if (currentAttachment?.attachment?.url) {
                        const attachmentPath = toPosixPath(currentAttachment.attachment.url);
                        currentAudioPath = path.isAbsolute(attachmentPath)
                            ? attachmentPath
                            : path.join(workspaceFolder.uri.fsPath, attachmentPath);
                        // Verify file exists
                        if (!(await pathExists(currentAudioPath))) {
                            currentAudioPath = null;
                        }
                    }

                    if (previousAudioPath && currentAudioPath) {
                        // Both cells have audio - merge them
                        console.log(`[mergeCellWithPrevious] Merging audio files: ${previousAudioPath} + ${currentAudioPath}`);

                        // Determine output filename using previous cell's globalReferences or ID
                        // Try to get cell from document to access globalReferences
                        let bookAbbr = "";
                        let basename = "";

                        try {
                            const previousCell = (document as any)._documentData?.cells?.find((c: any) => c.metadata?.id === previousCellId);
                            const globalRefs = previousCell?.metadata?.data?.globalReferences;

                            if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
                                const firstRef = globalRefs[0];
                                const bookMatch = firstRef.match(/^([^\s]+)/);
                                if (bookMatch) {
                                    bookAbbr = bookMatch[1];
                                }

                                // Parse for basename
                                const parseCellIdToBookChapterVerse = (refId: string): { book: string; chapter?: number; verse?: number; } => {
                                    try {
                                        const [book, rest] = refId.split(" ");
                                        const [chapterStr, verseStr] = (rest || "").split(":");
                                        let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
                                        let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
                                        if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
                                        if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
                                        return { book: (book || "").toUpperCase(), chapter, verse };
                                    } catch {
                                        return { book: "", chapter: undefined, verse: undefined };
                                    }
                                };

                                const toBookChapterVerseBasename = (refId: string): string => {
                                    const { book, chapter, verse } = parseCellIdToBookChapterVerse(refId);
                                    const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
                                    const chapStr = safePad(chapter);
                                    const verseStr = safePad(verse);
                                    const sanitizeFileComponent = (input: string): string => {
                                        return input
                                            .replace(/\s+/g, "_")
                                            .replace(/[^a-zA-Z0-9._-]/g, "-")
                                            .replace(/_+/g, "_");
                                    };
                                    return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
                                };

                                basename = toBookChapterVerseBasename(firstRef);
                            }
                        } catch (e) {
                            // Fall through to legacy parsing
                        }

                        // Fallback to legacy parsing if globalReferences not available
                        if (!bookAbbr) {
                            bookAbbr = previousCellId.split(' ')[0];
                        }
                        if (!basename) {
                            const parseCellIdToBookChapterVerse = (cellId: string): { book: string; chapter?: number; verse?: number; } => {
                                try {
                                    const [book, rest] = cellId.split(" ");
                                    const [chapterStr, verseStr] = (rest || "").split(":");
                                    let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
                                    let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
                                    if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
                                    if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
                                    return { book: (book || "").toUpperCase(), chapter, verse };
                                } catch {
                                    return { book: "", chapter: undefined, verse: undefined };
                                }
                            };

                            const toBookChapterVerseBasename = (cellId: string): string => {
                                const { book, chapter, verse } = parseCellIdToBookChapterVerse(cellId);
                                const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
                                const chapStr = safePad(chapter);
                                const verseStr = safePad(verse);
                                const sanitizeFileComponent = (input: string): string => {
                                    return input
                                        .replace(/\s+/g, "_")
                                        .replace(/[^a-zA-Z0-9._-]/g, "-")
                                        .replace(/_+/g, "_");
                                };
                                return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
                            };

                            basename = toBookChapterVerseBasename(previousCellId);
                        }
                        const ext = path.extname(previousAudioPath) || path.extname(currentAudioPath) || '.wav';
                        const outputFilename = `${basename}${ext}`;

                        // Try attachments/files first, then legacy attachments
                        const attachmentsFilesPath = path.join(
                            workspaceFolder.uri.fsPath,
                            ".project",
                            "attachments",
                            "files",
                            bookAbbr
                        );
                        const legacyAttachmentsPath = path.join(
                            workspaceFolder.uri.fsPath,
                            ".project",
                            "attachments",
                            bookAbbr
                        );

                        let outputDir = attachmentsFilesPath;
                        if (!(await pathExists(attachmentsFilesPath))) {
                            outputDir = legacyAttachmentsPath;
                        }

                        let outputPath = path.join(outputDir, outputFilename);

                        // Normalize paths for comparison (resolve to absolute and normalize separators)
                        const normalizedOutputPath = path.resolve(outputPath);
                        const normalizedPreviousPath = path.resolve(previousAudioPath);

                        // CRITICAL: If outputPath is the same as previousAudioPath, use a temporary path first
                        // to avoid overwriting the input file during merge (which can cause corruption)
                        let tempOutputPath: string | null = null;
                        const finalOutputPath = outputPath;
                        if (normalizedOutputPath === normalizedPreviousPath) {
                            // Use a temp filename that preserves the extension but adds timestamp before it
                            const ext = path.extname(outputFilename);
                            const basenameWithoutExt = path.basename(outputFilename, ext);
                            tempOutputPath = path.join(outputDir, `${basenameWithoutExt}_tmp_${timestamp}${ext}`);
                            outputPath = tempOutputPath;
                            console.log(`[mergeCellWithPrevious] WARNING: Output path matches input path, using temporary path: ${tempOutputPath}`);
                        }

                        // Merge audio files using FFmpeg
                        const mergedAudioPath = await mergeAudioFiles(previousAudioPath, currentAudioPath, outputPath);

                        // If we used a temp path and merge succeeded, move it to the final location
                        if (tempOutputPath && mergedAudioPath && mergedAudioPath === tempOutputPath) {
                            try {
                                // Verify temp file exists before moving
                                if (!(await pathExists(tempOutputPath))) {
                                    console.error(`[mergeCellWithPrevious] ERROR: Temp file does not exist: ${tempOutputPath}`);
                                    // Don't throw - just log and continue with temp path
                                } else {
                                    // Remove old file if it exists
                                    if (await pathExists(finalOutputPath)) {
                                        await vscode.workspace.fs.delete(vscode.Uri.file(finalOutputPath));
                                    }

                                    // Move temp file to final location
                                    await vscode.workspace.fs.rename(
                                        vscode.Uri.file(tempOutputPath),
                                        vscode.Uri.file(finalOutputPath),
                                        { overwrite: true }
                                    );
                                    console.log(`[mergeCellWithPrevious] Successfully moved temporary file to final location: ${finalOutputPath}`);

                                    // Verify final file exists
                                    if (!(await pathExists(finalOutputPath))) {
                                        console.error(`[mergeCellWithPrevious] ERROR: Final file does not exist after move: ${finalOutputPath}`);
                                        // Don't throw - file might still be at temp path
                                    }
                                }
                            } catch (moveError) {
                                console.error(`[mergeCellWithPrevious] Failed to move temp file to final location:`, moveError);
                                // If move fails, log error but don't throw - the merge succeeded, just in wrong location
                                // The file is still usable at tempOutputPath
                            }
                        }

                        if (mergedAudioPath) {
                            // Create/update attachment metadata in previous cell
                            if (!previousCell.metadata.attachments) {
                                previousCell.metadata.attachments = {};
                            }

                            // Generate new unique attachment ID
                            const newAttachmentId = `merged_${timestamp}`;

                            // Calculate relative path from workspace root
                            // Use finalOutputPath if we used a temp path and it exists, otherwise use mergedAudioPath
                            let pathForAttachment = mergedAudioPath;
                            if (tempOutputPath) {
                                // Check if final file exists (move succeeded), otherwise use temp path
                                if (await pathExists(finalOutputPath)) {
                                    pathForAttachment = finalOutputPath;
                                } else {
                                    // Move failed or not attempted, use temp path
                                    pathForAttachment = tempOutputPath;
                                    console.warn(`[mergeCellWithPrevious] Using temp path for attachment since final move failed or not attempted: ${tempOutputPath}`);
                                }
                            }

                            let relativePath = path.relative(workspaceFolder.uri.fsPath, pathForAttachment);
                            // Ensure path starts with .project or similar for relative paths
                            if (!relativePath.startsWith('.') && !path.isAbsolute(relativePath)) {
                                relativePath = `.${path.sep}${relativePath}`;
                            }
                            const relativePathPosix = toPosixPath(relativePath);

                            // Merge attachment properties
                            const mergedAttachment: any = {
                                type: "audio",
                                url: relativePathPosix,
                                updatedAt: timestamp,
                                isDeleted: false
                            };

                            // Calculate duration: startTime from previous cell, endTime from current cell
                            // This ensures the total duration reflects all merged audio segments
                            if (previousAttachment?.attachment?.startTime !== undefined) {
                                mergedAttachment.startTime = previousAttachment.attachment.startTime;
                            }
                            if (currentAttachment?.attachment?.endTime !== undefined) {
                                mergedAttachment.endTime = currentAttachment.attachment.endTime;
                            } else if (previousAttachment?.attachment?.endTime !== undefined && currentAttachment?.attachment?.startTime !== undefined) {
                                // Fallback: if current doesn't have endTime, use previous endTime
                                // This handles cases where the current cell's audio doesn't have timing metadata
                                mergedAttachment.endTime = previousAttachment.attachment.endTime;
                            }

                            // Preserve transcription if available (prefer previous, fallback to current)
                            if (previousAttachment?.attachment?.transcription) {
                                mergedAttachment.transcription = previousAttachment.attachment.transcription;
                            } else if (currentAttachment?.attachment?.transcription) {
                                mergedAttachment.transcription = currentAttachment.attachment.transcription;
                            }

                            // Add merged attachment
                            previousCell.metadata.attachments[newAttachmentId] = mergedAttachment;

                            // Set as selected audio
                            previousCell.metadata.selectedAudioId = newAttachmentId;

                            console.log(`[mergeCellWithPrevious] Successfully merged audio files and updated attachment metadata`);
                        } else {
                            console.warn(`[mergeCellWithPrevious] Audio merge failed, continuing with text merge only`);
                            vscode.window.showWarningMessage("Audio files could not be merged, but text merge completed successfully.");
                        }
                    } else if (previousAudioPath || currentAudioPath) {
                        // Only one cell has audio - preserve it in the previous cell
                        const sourceAttachment = previousAudioPath ? previousAttachment : currentAttachment;
                        const sourceCellId = previousAudioPath ? previousCellId : currentCellId;

                        if (sourceAttachment && !previousCell.metadata.attachments) {
                            previousCell.metadata.attachments = {};
                        }
                        if (sourceAttachment) {
                            // Copy the attachment to previous cell
                            const copyAttachmentId = `copied_${timestamp}`;
                            previousCell.metadata.attachments![copyAttachmentId] = {
                                ...sourceAttachment.attachment,
                                updatedAt: timestamp
                            };
                            previousCell.metadata.selectedAudioId = copyAttachmentId;
                            console.log(`[mergeCellWithPrevious] Preserved audio attachment from ${sourceCellId}`);
                        }
                    }
                } catch (audioError) {
                    console.error(`[mergeCellWithPrevious] Error merging audio files:`, audioError);
                    // Don't fail the entire merge if audio merge fails
                }
            }

            // Mark the document as dirty manually since we bypassed the normal update methods
            (document as any)._isDirty = true;

            // 6. Mark current cell as merged by updating its data
            const currentCellData = document.getCellData(currentCellId) || {};
            document.updateCellData(currentCellId, {
                ...currentCellData,
                merged: true
            });

            // Record an edit on the merged (current) cell to reflect the merged flag change
            const currentCellForEdits = document.getCell(currentCellId);
            if (currentCellForEdits) {
                if (!currentCellForEdits.metadata.edits) {
                    currentCellForEdits.metadata.edits = [] as any;
                }
                (currentCellForEdits.metadata.edits as any[]).push({
                    editMap: EditMapUtils.metadataNested("data", "merged"),
                    value: true,
                    timestamp: timestamp + 2,
                    type: EditType.USER_EDIT,
                    author: currentUser,
                    validatedBy: []
                });
            }

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

    showErrorMessage: async ({ event }) => {
        const typedEvent = event as Extract<EditorPostMessages, { command: "showErrorMessage"; }>;
        vscode.window.showErrorMessage(typedEvent.text);
    },

    revalidateMissingForCell: async ({ event, document, webviewPanel, provider }) => {
        const typedEvent = event as any;
        const cellId = typedEvent?.content?.cellId as string;
        if (!cellId) return;
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) return;
            const changed = await revalidateCellMissingFlags(document, workspaceFolder, cellId);

            // If anything changed, persist and send updated history and availability
            if (changed) {
                await document.save(new vscode.CancellationTokenSource().token);

                // Send updated history
                const audioHistory = document.getAttachmentHistory(cellId, "audio") || [];
                const currentAttachment = document.getCurrentAttachment(cellId, "audio");
                const explicitSelection = document.getExplicitAudioSelection(cellId);
                provider.postMessageToWebview(webviewPanel, {
                    type: "audioHistoryReceived",
                    content: {
                        cellId,
                        audioHistory,
                        currentAttachmentId: currentAttachment?.attachmentId ?? null,
                        hasExplicitSelection: explicitSelection !== null
                    }
                });

                // Send updated availability for this cell
                try {
                    const documentText = document.getText();
                    const notebookData = JSON.parse(documentText);
                    const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
                    const availability: { [k: string]: "available" | "missing" | "deletedOnly" | "none"; } = {} as any;
                    const cell = cells.find((c: any) => c?.metadata?.id === cellId);
                    if (cell) {
                        let hasAvailable = false; let hasAvailablePointer = false; let hasMissing = false; let hasDeleted = false;
                        const atts = cell?.metadata?.attachments || {};
                        for (const key of Object.keys(atts)) {
                            const att: any = atts[key];
                            if (att && att.type === "audio") {
                                if (att.isDeleted) hasDeleted = true;
                                else if (att.isMissing) hasMissing = true;
                                else {
                                    try {
                                        const url = String(att.url || "");
                                        if (url) {
                                            const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                            const abs = path.join(workspaceFolder.uri.fsPath, filesRel);
                                            const { isPointerFile } = await import("../../utils/lfsHelpers");
                                            const isPtr = await isPointerFile(abs).catch(() => false);
                                            if (isPtr) hasAvailablePointer = true; else hasAvailable = true;
                                        } else {
                                            hasAvailable = true;
                                        }
                                    } catch { hasAvailable = true; }
                                }
                            }
                        }
                        // Provisional state
                        let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                        if (hasAvailable) state = "available-local";
                        else if (hasAvailablePointer) state = "available-pointer";
                        else if (hasMissing) state = "missing";
                        else if (hasDeleted) state = "deletedOnly";
                        else state = "none";

                        // Apply installed-version gate to avoid Play icon when blocked
                        if (state !== "available-local") {
                            try {
                                const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                                const status = await getFrontierVersionStatus();
                                if (!status.ok) {
                                    if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                        state = "available-pointer";
                                    }
                                }
                            } catch { /* ignore */ }
                        }

                        availability[cellId] = state as any;
                        safePostMessageToPanel(webviewPanel, { type: "providerSendsAudioAttachments", attachments: availability });
                    }
                } catch { /* ignore */ }
            }
        } catch (err) {
            console.error("Failed to revalidate missing for cell", { cellId, err });
        }
    },

    // Handler for requesting cells for a specific milestone/subsection (lazy loading)
    requestCellsForMilestone: async ({ event, document, webviewPanel, provider }) => {
        const typed = event as any;
        const milestoneIndex = typed?.content?.milestoneIndex ?? 0;
        const subsectionIndex = typed?.content?.subsectionIndex ?? 0;

        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            const cellsPerPage = config.get("cellsPerPage", 50);

            // Get cells for the requested milestone/subsection
            const cells = document.getCellsForMilestone(milestoneIndex, subsectionIndex, cellsPerPage);

            // Process cells (merge ranges, etc.)
            const isSourceText = document.uri.toString().includes(".source");
            const processedCells = provider.mergeRangesAndProcess(
                cells,
                provider.isCorrectionEditorMode,
                isSourceText
            );

            // Build source cell map for these cells
            const sourceCellMap: { [k: string]: { content: string; versions: string[]; }; } = {};
            for (const cell of cells) {
                const cellId = cell.cellMarkers?.[0];
                if (cellId && document._sourceCellMap[cellId]) {
                    sourceCellMap[cellId] = document._sourceCellMap[cellId];
                }
            }

            // Store the current milestone/subsection for this document to preserve position during updates
            provider.currentMilestoneSubsectionMap.set(document.uri.toString(), {
                milestoneIndex,
                subsectionIndex,
            });

            // Send the cell page to the webview
            safePostMessageToPanel(webviewPanel, {
                type: "providerSendsCellPage",
                milestoneIndex,
                subsectionIndex,
                cells: processedCells,
                sourceCellMap,
            });

            debug(`Sent cells for milestone ${milestoneIndex}, subsection ${subsectionIndex}: ${processedCells.length} cells`);
        } catch (error) {
            console.error("Error fetching cells for milestone:", error);
        }
    },

    // Handler for requesting subsection progress for a milestone
    requestSubsectionProgress: async ({ event, document, webviewPanel, provider }) => {
        const typed = event as any;
        const milestoneIndex = typed?.content?.milestoneIndex ?? 0;

        try {
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const validationCount = config.get("validationCount", 1);
            const validationCountAudio = config.get("validationCountAudio", 1);
            const cellsPerPage = vscode.workspace.getConfiguration("codex-editor-extension").get("cellsPerPage", 50);

            // Calculate progress for all subsections in this milestone
            const subsectionProgress = document.calculateSubsectionProgress(
                milestoneIndex,
                cellsPerPage,
                validationCount,
                validationCountAudio
            );

            // Send the progress data to the webview
            safePostMessageToPanel(webviewPanel, {
                type: "providerSendsSubsectionProgress",
                milestoneIndex,
                subsectionProgress,
            });

            debug(`Sent subsection progress for milestone ${milestoneIndex}:`, subsectionProgress);
        } catch (error) {
            console.error("Error fetching subsection progress:", error);
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
        case "refreshAllEditors": {
            console.log("refreshAllEditors message received", { event });
            // Send refreshMetadata message to all open editor webviews
            provider.getWebviewPanels().forEach((panel) => {
                provider.postMessageToWebview(panel, {
                    type: "refreshMetadata"
                });
            });
            break;
        }
        case "commentsUpdated": {
            if (event.content.type === "commentsFileChanged") {
                // Send a direct message to all active webview panels to refresh comment counts
                // Access webviewPanels through a public method
                provider.postMessageToWebviews({
                    type: "refreshCommentCounts",
                    timestamp: event.content.timestamp
                });
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
                                const attachmentPath = toPosixPath((attachment as any).url);

                                // Build full path
                                const fullPath = path.isAbsolute(attachmentPath)
                                    ? attachmentPath
                                    : path.join(workspaceFolder.uri.fsPath, attachmentPath);

                                try {
                                    // Check if file exists and read it
                                    if (await pathExists(fullPath)) {
                                        // Record availability only; avoid sending base64 audio during scans
                                        audioAttachments[cellId] = fullPath;
                                        debug("Found audio attachment in metadata (availability only):", {
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
                    const attachmentsFilesPath = path.join(
                        workspaceFolder.uri.fsPath,
                        ".project",
                        "attachments",
                        "files",
                        bookAbbr
                    );
                    const legacyAttachmentsPath = path.join(
                        workspaceFolder.uri.fsPath,
                        ".project",
                        "attachments",
                        bookAbbr
                    );

                    for (const attachmentsPath of [attachmentsFilesPath, legacyAttachmentsPath]) {
                        if (!(await pathExists(attachmentsPath))) continue;
                        try {
                            const files = await vscode.workspace.fs.readDirectory(vscode.Uri.file(attachmentsPath));

                            // Look for any audio files that might match this cell
                            const audioExtensions = ['.wav', '.mp3', '.m4a', '.ogg', '.webm'];
                            const audioFiles = files
                                .filter(([name, type]) => type === vscode.FileType.File)
                                .map(([name]) => name)
                                .filter(name => audioExtensions.some(ext => name.toLowerCase().endsWith(ext)));

                            for (const audioFile of audioFiles) {
                                // Check if the file name contains the cell ID pattern
                                const cellIdPattern = cellId.replace(/[:\s]/g, '_');
                                if (audioFile.includes(cellIdPattern) || audioFile.includes(cellId)) {
                                    const fullAudioPath = path.join(attachmentsPath, audioFile);

                                    // Only process if not already found in metadata
                                    if (!audioAttachments[cellId]) {
                                        try {
                                            // Record availability only; avoid sending base64 during scans
                                            audioAttachments[cellId] = fullAudioPath;
                                            debug("Found legacy audio file (availability only):", {
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
