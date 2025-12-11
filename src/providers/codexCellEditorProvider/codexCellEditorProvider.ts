import * as vscode from "vscode";
import { fetchCompletionConfig } from "@/utils/llmUtils";
import { CodexNotebookReader } from "../../serializer";
import { workspaceStoreListener } from "../../utils/workspaceEventListener";
import { llmCompletion } from "../translationSuggestions/llmCompletion";
import { CodexCellTypes, EditType } from "../../../types/enums";
import {
    QuillCellContent,
    EditorPostMessages,
    EditorReceiveMessages,
    GlobalMessage,
    GlobalContentType,
    CellIdGlobalState,
    CustomNotebookCellData,
    CodexNotebookAsJSONData,
} from "../../../types";
import { CodexCellDocument } from "./codexDocument";
import {
    handleGlobalMessage,
    handleMessages,
    performLLMCompletion,
} from "./codexCellEditorMessagehandling";
import { GlobalProvider } from "../../globalProvider";
import { initializeStateStore } from "../../stateStore";
import { SyncManager } from "../../projectManager/syncManager";

import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";
import { getNonce } from "../dictionaryTable/utilities/getNonce";
import { safePostMessageToPanel } from "../../utils/webviewUtils";
import path from "path";
import { getAuthApi } from "@/extension";

// Enable debug logging if needed
const DEBUG_MODE = false;
function debug(...args: any[]) {
    if (DEBUG_MODE) {
        console.log("[CodexCellEditorProvider]", ...args);
    }
}

// StateStore interface matching what's provided by initializeStateStore
interface StateStore {
    storeListener: <K extends "cellId">(
        keyForListener: K,
        callback: (value: CellIdGlobalState | undefined) => void
    ) => () => void;
    updateStoreState: (update: { key: "cellId"; value: CellIdGlobalState; }) => void;
}

export class CodexCellEditorProvider implements vscode.CustomEditorProvider<CodexCellDocument> {
    private static instance: CodexCellEditorProvider | undefined;

    public currentDocument: CodexCellDocument | undefined;
    private webviewPanels: Map<string, vscode.WebviewPanel> = new Map();
    private webviewReadyState: Map<string, boolean> = new Map(); // Track if webview is ready to receive content
    private pendingWebviewUpdates: Map<string, (() => void)[]> = new Map(); // Track pending update functions
    private refreshInFlight: Set<string> = new Set(); // Prevent overlapping refreshes per document
    private pendingRefresh: Set<string> = new Set(); // Queue one follow-up refresh if needed
    private userInfo: { username: string; email: string; } | undefined;
    private stateStore: StateStore | undefined;
    private stateStoreListener: (() => void) | undefined;
    private commitTimer: NodeJS.Timeout | number | undefined;
    private autocompleteCancellation: vscode.CancellationTokenSource | undefined;
    // Removed media file watcher and refresh timer; attachments are provided via cell metadata

    // Cancellation token for single cell queue operations
    private singleCellQueueCancellation: vscode.CancellationTokenSource | undefined;

    // Add cells per page configuration
    private get CELLS_PER_PAGE(): number {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        return config.get("cellsPerPage", 50); // Default to 50 cells per page
    }

    // Translation queue system
    private translationQueue: {
        cellId: string;
        document: CodexCellDocument;
        shouldUpdateValue: boolean;
        validationRequest?: boolean;
        audioValidationRequest?: boolean;
        shouldValidate: boolean;
        resolve: (result: any) => void;
        reject: (error: any) => void;
    }[] = [];
    private isProcessingQueue: boolean = false;

    // New state for autocompletion process
    public autocompletionState: {
        isProcessing: boolean;
        totalCells: number;
        completedCells: number;
        currentCellId?: string;
        cellsToProcess: string[];
        progress: number;
    } = {
            isProcessing: false,
            totalCells: 0,
            completedCells: 0,
            currentCellId: undefined,
            cellsToProcess: [],
            progress: 0,
        };

    // Single cell translation state - using the same robust pattern as autocomplete
    public singleCellQueueState: {
        isProcessing: boolean;
        totalCells: number;
        completedCells: number;
        currentCellId?: string;
        cellsToProcess: string[];
        progress: number;
    } = {
            isProcessing: false,
            totalCells: 0,
            completedCells: 0,
            currentCellId: undefined,
            cellsToProcess: [],
            progress: 0,
        };

    // Legacy single cell translation state for backward compatibility
    public singleCellTranslationState: {
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    } = {
            isProcessing: false,
            cellId: undefined,
            progress: 0,
        };



    // Add a property to track pending validations
    private pendingValidations: Map<
        string,
        { cellId: string; document: CodexCellDocument; shouldValidate: boolean; }
    > = new Map();

    // Class property to track if we've registered the command already
    public syncChapterCommandRegistered = false;

    // Add bibleBookMap state to the provider
    private bibleBookMap: Map<string, { name: string;[key: string]: any; }> | undefined;

    // Add correction editor mode state
    private isCorrectionEditorMode: boolean = false;

    public static getInstance(): CodexCellEditorProvider | undefined {
        return CodexCellEditorProvider.instance;
    }

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        debug("Registering CodexCellEditorProvider");
        const provider = new CodexCellEditorProvider(context);
        CodexCellEditorProvider.instance = provider;
        const providerRegistration = vscode.window.registerCustomEditorProvider(
            CodexCellEditorProvider.viewType,
            provider,
            {
                supportsMultipleEditorsPerDocument: false,
                webviewOptions: {
                    retainContextWhenHidden: true,
                },
            }
        );
        const globalProviderRegistration = GlobalProvider.getInstance().registerProvider(
            "codex-cell-editor",
            provider
        );
        debug("Provider registered successfully");

        return new vscode.Disposable(() => {
            providerRegistration.dispose();
            globalProviderRegistration.dispose();
        });
    }

    private static readonly viewType = "codex.cellEditor";

    constructor(protected readonly context: vscode.ExtensionContext) {
        debug("Constructing CodexCellEditorProvider");
        this.initializeStateStore();

        // Listen for configuration changes
        const configurationChangeDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("codex-project-manager.validationCount")) {
                // Send updated validation count directly instead of triggering webview requests
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const validationCount = config.get("validationCount", 1);
                this.webviewPanels.forEach((panel) => {
                    this.postMessageToWebview(panel, {
                        type: "validationCount",
                        content: validationCount,
                    });
                });

                // Force a refresh of validation state for all open documents
                this.refreshValidationStateForAllDocuments();
            }

            if (e.affectsConfiguration("codex-project-manager.validationCountAudio")) {
                // Send updated audio validation count directly instead of triggering webview requests
                const config = vscode.workspace.getConfiguration("codex-project-manager");
                const validationCountAudio = config.get("validationCountAudio", 1);
                this.webviewPanels.forEach((panel) => {
                    this.postMessageToWebview(panel, {
                        type: "validationCountAudio",
                        content: validationCountAudio,
                    });
                });

                // Force a refresh of validation state for all open documents
                this.refreshValidationStateForAllDocuments();
            }

            if (e.affectsConfiguration("codex-editor-extension.cellsPerPage")) {
                // Update cells per page in all webviews
                const newCellsPerPage = this.CELLS_PER_PAGE;
                this.webviewPanels.forEach((panel) => {
                    // Use custom message type for cells per page update
                    safePostMessageToPanel(panel, {
                        type: "updateCellsPerPage",
                        cellsPerPage: newCellsPerPage,
                    });
                });
            }
        });

        this.context.subscriptions.push(configurationChangeDisposable);

        // Register a command to update validation indicators
        this.context.subscriptions.push(
            vscode.commands.registerCommand(
                "codex-editor-extension.updateValidationIndicators",
                () => {
                    // Send validation count to all webviews
                    this.updateValidationIndicatorsForAllDocuments();
                }
            )
        );

        // Register a command to toggle correction editor mode
        this.context.subscriptions.push(
            vscode.commands.registerCommand(
                "codex-editor-extension.toggleCorrectionEditorMode",
                () => {
                    this.toggleCorrectionEditorMode();
                }
            )
        );

    }

    private async initializeStateStore() {
        debug("Initializing state store");
        try {
            const { storeListener, updateStoreState } = await initializeStateStore();
            this.stateStore = { storeListener, updateStoreState };

            // Store the dispose function when setting up the listener
            this.stateStoreListener = this.stateStore.storeListener(
                "cellId",
                (value: CellIdGlobalState | undefined) => {
                    debug("Cell ID change detected:", value);
                    if (value?.cellId && value?.uri) {
                        // Only send highlight messages to source files when a codex file is active
                        const valueIsCodexFile = this.isCodexFile(value.uri);
                        if (valueIsCodexFile) {
                            debug("Processing codex file highlight");
                            for (const [panelUri, panel] of this.webviewPanels.entries()) {
                                const isSourceFile = this.isSourceText(panelUri);
                                if (isSourceFile) {
                                    debug("Sending highlight message to source file:", panelUri);
                                    safePostMessageToPanel(panel, {
                                        type: "highlightCell",
                                        cellId: value.cellId,
                                    });
                                }
                            }
                        }
                    }
                }
            );
            debug("State store initialized successfully");
        } catch (error) {
            console.error("Failed to initialize state store:", error);
        }
    }

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentContentChangeEvent<CodexCellDocument>
    >();

    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string; },
        _token: vscode.CancellationToken
    ): Promise<CodexCellDocument> {
        debug("Opening custom document:", uri.toString());
        const document = await CodexCellDocument.create(uri, openContext.backupId, _token);
        debug("Document created successfully");
        return document;
    }

    /**
     * Mark a webview as ready and execute any pending updates
     */
    private markWebviewReady(documentUri: string): void {
        debug("Marking webview ready for:", documentUri);
        this.webviewReadyState.set(documentUri, true);

        // Execute any pending updates
        const pending = this.pendingWebviewUpdates.get(documentUri);
        if (pending && pending.length > 0) {
            debug(`Executing ${pending.length} pending updates for:`, documentUri);
            pending.forEach(updateFn => updateFn());
            this.pendingWebviewUpdates.delete(documentUri);
        }
    }

    /**
     * Schedule a webview update, executing immediately if ready or queuing if not
     */
    private scheduleWebviewUpdate(documentUri: string, updateFn: () => void): void {
        const isReady = this.webviewReadyState.get(documentUri);

        if (isReady) {
            debug("Webview ready, executing update immediately for:", documentUri);
            updateFn();
        } else {
            debug("Webview not ready, queuing update for:", documentUri);
            const existing = this.pendingWebviewUpdates.get(documentUri) || [];
            existing.push(updateFn);
            this.pendingWebviewUpdates.set(documentUri, existing);
        }
    }

    /**
     * Reset webview ready state (called when HTML is reset)
     */
    private resetWebviewReadyState(documentUri: string): void {
        debug("Resetting webview ready state for:", documentUri);
        this.webviewReadyState.set(documentUri, false);
        this.pendingWebviewUpdates.delete(documentUri);
    }

    /**
     * Wait for a webview to be ready with exponential backoff
     * @param documentUri The URI of the document to wait for
     * @param maxWaitMs Maximum time to wait (default 5000ms)
     * @returns Promise that resolves when ready or times out
     */
    public async waitForWebviewReady(documentUri: string, maxWaitMs: number = 5000): Promise<boolean> {
        const startTime = Date.now();
        let attempt = 0;
        const maxAttempts = 10;

        while (Date.now() - startTime < maxWaitMs && attempt < maxAttempts) {
            if (this.webviewReadyState.get(documentUri)) {
                debug(`Webview ready after ${Date.now() - startTime}ms:`, documentUri);
                return true;
            }

            // Exponential backoff: 10ms, 20ms, 40ms, 80ms, 160ms, 320ms, 640ms...
            const backoffMs = Math.min(10 * Math.pow(2, attempt), 500);
            await new Promise(resolve => setTimeout(resolve, backoffMs));
            attempt++;
        }

        const isReady = this.webviewReadyState.get(documentUri) || false;
        if (!isReady) {
            debug(`Webview not ready after ${maxWaitMs}ms timeout:`, documentUri);
        }
        return isReady;
    }

    public async resolveCustomEditor(
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        debug("Resolving custom editor for:", document.uri.toString());

        // Store the webview panel with its document URI as the key
        this.webviewPanels.set(document.uri.toString(), webviewPanel);

        // Listen for when this editor becomes active
        const viewStateDisposable: vscode.Disposable = webviewPanel.onDidChangeViewState((e) => {
            debug("Webview panel state changed, active:", e.webviewPanel.active);
            if (e.webviewPanel.active) {
                // Update references and refresh content to ensure any changes (like font sizes) are applied
                this.currentDocument = document;
                // Refresh the webview to ensure it has the latest content and metadata
                updateWebview();
            }
        });

        // Initial setup
        this.currentDocument = document;
        try {
            const authApi = await this.getAuthApi(); // Assuming this.getAuthApi() is safe
            if (authApi) {
                const authStatus = authApi.getAuthStatus();
                if (authStatus.isAuthenticated && authApi.currentUser) {
                    this.userInfo = {
                        username: authApi.currentUser.username,
                        email: authApi.currentUser.email || "",
                    };
                    debug("User info set from authApi.currentUser:", this.userInfo);
                } else {
                    // Attempt to get more detailed info, new auth provider should handle internal errors
                    try {
                        const userInfo = await authApi.getUserInfo();
                        if (userInfo) {
                            this.userInfo = userInfo;
                            debug("User info retrieved from authApi.getUserInfo:", this.userInfo);
                        } else {
                            this.userInfo = undefined;
                            debug("authApi.getUserInfo() returned no data.");
                        }
                    } catch (error) {
                        console.error(
                            "Error calling authApi.getUserInfo() in resolveCustomEditor. User info remains undefined.",
                            error
                        );
                        this.userInfo = undefined; // Explicitly set to undefined on error
                    }
                }
            } else {
                this.userInfo = undefined;
                debug("AuthAPI not available in resolveCustomEditor.");
            }
        } catch (error) {
            console.error("Error initializing auth or user info in resolveCustomEditor:", error);
            this.userInfo = undefined; // Ensure userInfo is undefined if any auth-related error occurs
        }

        // Enable scripts and set local resources in the webview
        webviewPanel.webview.options = {
            enableScripts: true,
            localResourceRoots: [
                vscode.Uri.joinPath(this.context.extensionUri, "src", "assets"),
                vscode.Uri.joinPath(this.context.extensionUri, "node_modules", "@vscode", "codicons", "dist"),
                vscode.Uri.joinPath(this.context.extensionUri, "webviews", "codex-webviews", "dist")
            ]
        };

        // Get text direction and check if it's a source file
        const textDirection = this.getTextDirection(document);
        const isSourceText = this.isSourceText(document.uri);
        debug("Text direction:", textDirection, "Is source text:", isSourceText);

        // Set up the HTML content for the webview ASAP to avoid blank delays
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            textDirection,
            isSourceText
        );

        // Load bible book map after HTML is set, then send to webview
        await this.loadBibleBookMap(document);

        // Send initial bible book map to webview (scheduled to wait for webview ready)
        if (this.bibleBookMap) {
            const bibleBookMapData = Array.from(this.bibleBookMap.entries());
            this.scheduleWebviewUpdate(document.uri.toString(), () => {
                this.postMessageToWebview(webviewPanel, {
                    type: "setBibleBookMap" as any, // Use type assertion for custom message
                    data: bibleBookMapData,
                });
            });
        }

        // Set up file system watcher (only if document is in a workspace)
        const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
        let watcher: vscode.FileSystemWatcher | undefined;
        let audioWatcher: vscode.FileSystemWatcher | undefined;

        if (workspaceFolder) {
            watcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(
                    workspaceFolder,
                    vscode.workspace.asRelativePath(document.uri)
                )
            );

            // Set up audio file watcher for external changes
            audioWatcher = vscode.workspace.createFileSystemWatcher(
                new vscode.RelativePattern(
                    workspaceFolder,
                    ".project/attachments/**/*.{wav,mp3,m4a,ogg,webm}"
                )
            );
        } else {
            debug("Document is not in a workspace folder, skipping file system watcher setup");
        }

        // Watch for file changes (only if watcher was created)
        // Use debounce to avoid reverting after our own saves
        const SAVE_DEBOUNCE_MS = 2000;
        if (watcher) {
            watcher.onDidChange((uri) => {
                debug("File change detected:", uri.toString());
                if (uri.toString() === document.uri.toString()) {
                    const timeSinceLastSave = Date.now() - document.lastSaveTimestamp;
                    if (!document.isDirty && timeSinceLastSave > SAVE_DEBOUNCE_MS) {
                        // External change detected - safe to revert
                        debug("Document not dirty and not recently saved, reverting");
                        document.revert();
                    } else {
                        debug(`Skipping revert: isDirty=${document.isDirty}, timeSinceLastSave=${timeSinceLastSave}ms`);
                    }
                }
            });
        }

        // Watch for audio file changes and update webview
        if (audioWatcher) {
            const handleAudioFileChange = (uri: vscode.Uri, changeType: string) => {
                debug(`${changeType} audio file detected:`, uri.toString());

                // Extract book and cell info from the file path
                const relativePath = vscode.workspace.asRelativePath(uri);
                const pathParts = relativePath.split('/');
                if (pathParts.length >= 3 && pathParts[0] === '.project' && pathParts[1] === 'attachments') {
                    const bookAbbr = pathParts[2];
                    const fileName = pathParts[pathParts.length - 1];

                    // Parse filename to extract cell information
                    const match = fileName.match(/^(\w+)_(\d+)_(\d+)\./);
                    if (match) {
                        const [, fileBook, chapterStr, verseStr] = match;
                        if (fileBook === bookAbbr) {
                            const cellId = `${fileBook} ${parseInt(chapterStr)}:${parseInt(verseStr)}`;

                            // Update the webview with refreshed audio attachment information
                            updateAudioAttachmentsForCell(webviewPanel, document, cellId);

                            // If this was a deletion and it was the selected audio, clear the selection
                            if (changeType === "Deleted") {
                                try {
                                    // Generate attachment ID from filename
                                    const attachmentId = fileName.replace(/\.[^/.]+$/, ""); // Remove extension

                                    // Check if this attachment is currently selected
                                    const currentSelection = document.getExplicitAudioSelection(cellId);
                                    if (currentSelection === attachmentId) {
                                        // The deleted file was the selected one, clear selection
                                        document.clearAudioSelection(cellId);
                                        debug(`Cleared selectedAudioId for cell ${cellId} due to file deletion`);
                                    }
                                } catch (error) {
                                    debug("Error checking selected audio ID on deletion:", error);
                                }
                            }

                            debug(`Updated audio attachments for cell: ${cellId}`);
                        }
                    }
                }
            };

            audioWatcher.onDidChange((uri) => handleAudioFileChange(uri, "Modified"));
            audioWatcher.onDidCreate((uri) => handleAudioFileChange(uri, "Created"));
            audioWatcher.onDidDelete((uri) => handleAudioFileChange(uri, "Deleted"));
        }

        // Create update function
        const updateWebview = async () => {
            debug("Updating webview");
            const notebookData: CodexNotebookAsJSONData = this.getDocumentAsJson(document);
            const processedData = this.processNotebookData(notebookData, document);

            // Get bundled metadata to avoid separate requests
            const config = vscode.workspace.getConfiguration("codex-project-manager");
            const validationCount = config.get("validationCount", 1);
            const validationCountAudio = config.get("validationCountAudio", 1);
            const authApi = await this.getAuthApi();

            let userInfo;
            try {
                if (authApi?.getAuthStatus()?.isAuthenticated) {
                    userInfo = await authApi?.getUserInfo();
                }
            } catch (error) {
                console.warn("Failed to fetch user info:", error);
            }

            const username = userInfo?.username || "anonymous";

            // Check authentication status
            let isAuthenticated = false;
            try {
                if (authApi) {
                    const authStatus = authApi.getAuthStatus();
                    isAuthenticated = authStatus?.isAuthenticated ?? false;
                }
            } catch (error) {
                console.debug("Could not get authentication status:", error);
            }

            // Fetch user role/access level if authenticated
            let userAccessLevel: number | undefined = undefined;
            try {
                if (isAuthenticated && userInfo?.username) {
                    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                    if (ws) {
                        const { extractProjectIdFromUrl, fetchProjectMembers } = await import("../../utils/remoteHealingManager");
                        const git = await import("isomorphic-git");
                        const fs = await import("fs");
                        const remotes = await git.listRemotes({ fs, dir: ws.uri.fsPath });
                        const origin = remotes.find((r) => r.remote === "origin");
                        
                        if (origin?.url) {
                            const projectId = extractProjectIdFromUrl(origin.url);
                            if (projectId) {
                                const memberList = await fetchProjectMembers(projectId);
                                if (memberList) {
                                    const currentUserMember = memberList.find(
                                        m => m.username === userInfo.username || m.email === userInfo.email
                                    );
                                    if (currentUserMember) {
                                        userAccessLevel = currentUserMember.accessLevel;
                                    }
                                }
                            }
                        }
                    }
                }
            } catch (error) {
                // Silently fail - user role is optional
                debug("Could not fetch user role:", error);
            }

            this.postMessageToWebview(webviewPanel, {
                type: "providerSendsInitialContent",
                content: processedData,
                isSourceText: isSourceText,
                sourceCellMap: document._sourceCellMap,
                username: username,
                validationCount: validationCount,
                validationCountAudio: validationCountAudio,
                isAuthenticated: isAuthenticated,
                userAccessLevel: userAccessLevel,
            });

            // Also send updated metadata plus the autoDownloadAudioOnOpen flag for the project
            try {
                const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                const { getAutoDownloadAudioOnOpen } = await import("../../utils/localProjectSettings");
                const autoFlag = await getAutoDownloadAudioOnOpen(ws?.uri);
                this.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesNotebookMetadataForWebview",
                    content: { ...notebookData.metadata, autoDownloadAudioOnOpen: !!autoFlag },
                });
            } catch {
                this.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesNotebookMetadataForWebview",
                    content: notebookData.metadata,
                });
            }

            // After sending initial content, send refined audio availability with pointer detection
            try {
                const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                if (ws && Array.isArray(notebookData?.cells)) {
                    const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};
                    for (const cell of notebookData.cells as any[]) {
                        const cellId = cell?.metadata?.id;
                        if (!cellId) continue;
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
                                        if (ws && url) {
                                            const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                            const filesAbs = path.join(ws.uri.fsPath, filesRel);
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
                        // Determine provisional state before version gate
                        let state: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
                        if (hasAvailable) state = "available-local";
                        else if (hasAvailablePointer) state = "available-pointer";
                        else if (hasMissing) state = "missing";
                        else if (hasDeleted) state = "deletedOnly";
                        else state = "none";

                        // If Frontier installed version is below minimum, any non-local availability
                        // should present as "available-pointer" (cloud/download) to avoid Play UI.
                        if (state !== "available-local") {
                            try {
                                const { getFrontierVersionStatus } = await import("../../projectManager/utils/versionChecks");
                                const status = await getFrontierVersionStatus();
                                if (!status.ok) {
                                    if (state !== "missing" && state !== "deletedOnly" && state !== "none") {
                                        state = "available-pointer"; // normalize to non-playable
                                    }
                                }
                            } catch {
                                // On failure to check, leave state unchanged
                            }
                        }

                        availability[cellId] = state as any;
                    }
                    if (Object.keys(availability).length > 0) {
                        this.postMessageToWebview(webviewPanel, {
                            type: "providerSendsAudioAttachments",
                            attachments: availability as any,
                        });
                    }
                }
            } catch (e) {
                debug("Failed to compute refined audio availability", e);
            }
        };

        // Function to update audio attachments for a specific cell when files change externally
        const updateAudioAttachmentsForCell = async (webviewPanel: vscode.WebviewPanel, document: CodexCellDocument, cellId: string) => {
            debug("Updating audio attachments for cell:", cellId);

            try {
                const documentText = document.getText();
                let notebookData: any = {};
                if (documentText.trim().length > 0) {
                    notebookData = JSON.parse(documentText);
                }

                const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
                const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};

                // Only update the specific cell that changed
                const cell = cells.find((cell: any) => cell?.metadata?.id === cellId);
                if (cell) {
                    let hasAvailable = false;
                    let hasAvailablePointer = false;
                    let hasMissing = false;
                    let hasDeleted = false;
                    const atts = cell?.metadata?.attachments || {};
                    for (const key of Object.keys(atts)) {
                        const att: any = atts[key];
                        if (att && att.type === "audio") {
                            if (att.isDeleted) hasDeleted = true;
                            else if (att.isMissing) hasMissing = true;
                            else {
                                try {
                                    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                                    const url = String(att.url || "");
                                    if (ws && url) {
                                        const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                        const abs = path.join(ws.uri.fsPath, filesRel);
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

                    // Determine provisional state, then apply version gate
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

                    // Send targeted update for this specific cell
                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioAttachments",
                        attachments: availability
                    });

                    debug("Sent audio attachment update for cell:", cellId, availability[cellId]);
                }
            } catch (error) {
                debug("Error updating audio attachments for cell:", cellId, error);
            }
        };

        // Set up navigation functions
        const navigateToSection = (cellId: string) => {
            debug("Navigating to section:", cellId);
            safePostMessageToPanel(webviewPanel, {
                type: "jumpToSection",
                content: cellId,
            });
        };
        const openCellByIdImpl = (cellId: string, text: string) => {
            debug("Opening cell by ID:", cellId, text);
            safePostMessageToPanel(webviewPanel, {
                type: "openCellById",
                cellId: cellId,
                text: text,
            });
        };
        const jumpToCellListenerDispose = workspaceStoreListener("cellToJumpTo", (value) => {
            debug("Jump to cell event received:", value);
            navigateToSection(value);
        });

        // Set up document change listeners
        const listeners: vscode.Disposable[] = [];
        listeners.push(viewStateDisposable);

        listeners.push(
            document.onDidChangeForVsCodeAndWebview((e) => {
                debug("Document changed for VS Code and webview");

                // Check if this is a validation update
                if (e.edits && e.edits.length > 0 && e.edits[0].type === "validation") {
                    // Broadcast the validation update to all webviews for this document
                    const validationUpdate = {
                        type: "providerUpdatesValidationState",
                        content: {
                            cellId: e.edits[0].cellId,
                            validatedBy: e.edits[0].validatedBy,
                        },
                    };

                    // Send to all webviews that have this document open
                    this.webviewPanels.forEach((panel, docUri) => {
                        if (docUri === document.uri.toString()) {
                            safePostMessageToPanel(panel, validationUpdate);
                        }
                    });

                    // Still update the current webview with the full content
                    updateWebview();
                } else if (e.edits && e.edits.length > 0 && e.edits[0].type === "audioValidation") {
                    const selectedAudioId = document.getExplicitAudioSelection(e.edits[0].cellId) ?? undefined;
                    // Broadcast the audio validation update to all webviews for this document
                    const audioValidationUpdate = {
                        type: "providerUpdatesAudioValidationState",
                        content: {
                            cellId: e.edits[0].cellId,
                            validatedBy: e.edits[0].validatedBy,
                            selectedAudioId,
                        },
                    };

                    // Send to all webviews that have this document open
                    this.webviewPanels.forEach((panel, docUri) => {
                        if (docUri === document.uri.toString()) {
                            safePostMessageToPanel(panel, audioValidationUpdate);
                        }
                    });

                    // Still update the current webview with the full content
                    updateWebview();
                } else {
                    // For non-validation updates, just update the webview as normal
                    updateWebview();
                }

                // Update file status when document changes
                this.updateFileStatus("dirty");

                this._onDidChangeCustomDocument.fire({ document });
            })
        );

        listeners.push(
            document.onDidChangeForWebview((e) => {
                debug("Document changed for webview only");
                updateWebview();
            })
        );

        // Clean up on panel close
        webviewPanel.onDidDispose(() => {
            debug("Webview panel disposed");
            if (this.commitTimer) {
                clearTimeout(this.commitTimer);
            }
            if (this.autocompleteCancellation) {
                try { this.autocompleteCancellation.cancel(); } catch { /* noop */ }
                this.autocompleteCancellation.dispose();
                this.autocompleteCancellation = undefined;
            }
            if (this.singleCellQueueCancellation) {
                try { this.singleCellQueueCancellation.cancel(); } catch { /* noop */ }
                this.singleCellQueueCancellation.dispose();
                this.singleCellQueueCancellation = undefined;
            }
            // Dispose of the state store listener
            if (this.stateStoreListener) {
                this.stateStoreListener();
                this.stateStoreListener = undefined;
            }
            const docUri = document.uri.toString();
            this.webviewPanels.delete(docUri);
            this.webviewReadyState.delete(docUri);
            this.pendingWebviewUpdates.delete(docUri);
            jumpToCellListenerDispose();
            listeners.forEach((l) => l.dispose());
            if (watcher) {
                watcher.dispose();
            }
            if (audioWatcher) {
                audioWatcher.dispose();
            }
        });

        // Handle messages from webview
        const onMessageDisposable = webviewPanel.webview.onDidReceiveMessage(async (e: EditorPostMessages | GlobalMessage) => {
            debug("Received message from webview:", e);

            // Check for webview-ready signal
            if ((e as any).command === 'webviewReady') {
                this.markWebviewReady(document.uri.toString());
                return;
            }

            if ("destination" in e) {
                debug("Handling global message");
                GlobalProvider.getInstance().handleMessage(e as GlobalMessage);
                handleGlobalMessage(this, e as GlobalMessage);
                return;
            }
            handleMessages(e, webviewPanel, document, updateWebview, this);
        });
        listeners.push(onMessageDisposable);

        // Schedule initial update - will execute when webview signals ready
        debug("Scheduling initial webview update");
        this.scheduleWebviewUpdate(document.uri.toString(), () => {
            debug("Executing initial webview update");
            updateWebview();
        });

        // Fallback timeout in case webview-ready message is missed (shouldn't happen normally)
        setTimeout(() => {
            if (!this.webviewReadyState.get(document.uri.toString())) {
                debug("Webview ready timeout expired, forcing initial update");
                this.markWebviewReady(document.uri.toString());
            }
        }, 5000); // 5 second fallback

        // Send initial correction editor mode state (scheduled to wait for webview ready)
        this.scheduleWebviewUpdate(document.uri.toString(), () => {
            this.postMessageToWebview(webviewPanel, {
                type: "correctionEditorModeChanged",
                enabled: this.isCorrectionEditorMode,
            });
        });

        // No longer sending separate audio attachments status; attachments are included with initial content

        // Watch for configuration changes
        const configListenerDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            debug("Configuration changed");
            if (e.affectsConfiguration("codex-editor-extension.textDirection")) {
                debug("Text direction configuration changed");
                this.updateTextDirection(webviewPanel, document);
            }
        });
        listeners.push(configListenerDisposable);

        // Clean up webview panel from our tracking when it's disposed
        const disposeListener = webviewPanel.onDidDispose(() => {
            const docUri = document.uri.toString();
            this.webviewPanels.delete(docUri);
            this.webviewReadyState.delete(docUri);
            this.pendingWebviewUpdates.delete(docUri);
        });
        listeners.push(disposeListener);
    }

    public async receiveMessage(message: any, updateWebview?: () => void) {
        debug("Cell Provider received message:", message);
        // NOTE: do not use this method to handled messages within the provider. This has access to the global context and can get crossed with other providers

        // Handle global messages first - these don't require an active panel
        if ("destination" in message) {
            debug("Global message detected");
            handleGlobalMessage(this, message as GlobalMessage);
            return;
        }

        // For non-global messages, we need an active panel
        const activePanel = Array.from(this.webviewPanels.values()).find((panel) => panel.active);
        if (!activePanel || !this.currentDocument) {
            debug("No active panel or currentDocument is not initialized");
            return;
        }

        handleMessages(
            message as EditorPostMessages,
            activePanel,
            this.currentDocument,
            updateWebview ?? (() => { }),
            this
        );
    }

    private async executeGitCommit(document: CodexCellDocument): Promise<void> {
        debug("Executing git commit for:", document.uri.toString());
        // Use the SyncManager for immediate sync
        const syncManager = SyncManager.getInstance();
        await syncManager.executeSync(
            `changes to ${vscode.workspace.asRelativePath(document.uri).split(/[/\\]/).pop()}`,
            true,
            undefined,
            true // Manual sync
        );
    }
    public postMessage(message: GlobalMessage) {
        debug("Posting message:", message);
        if (this.webviewPanels.size > 0) {
            this.webviewPanels.forEach((panel) => safePostMessageToPanel(panel, message));
        } else {
            console.error("No active webview panels");
        }
    }

    public postMessageToWebviews(message: any) {
        debug("Posting direct message to webviews:", message);
        if (this.webviewPanels.size > 0) {
            this.webviewPanels.forEach((panel) => {
                panel.webview.postMessage(message);
            });
        } else {
            console.error("No active webview panels");
        }
    }

    private scheduleCommit(document: CodexCellDocument) {
        debug("Scheduling commit for:", document.uri.toString());
        // Use the SyncManager instead of direct timer
        const syncManager = SyncManager.getInstance();
        syncManager.scheduleSyncOperation(
            `changes to ${vscode.workspace.asRelativePath(document.uri).split(/[/\\]/).pop()}`
        );
    }

    public async saveCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        debug("Saving custom document:", document.uri.toString(),);

        try {
            // Set status to syncing
            this.updateFileStatus("syncing");

            // Save the document
            await document.save(cancellation);
            debug("Document save completed, isDirty should be false:", document.isDirty);

            // Get the SyncManager singleton
            const syncManager = SyncManager.getInstance();

            // Schedule the sync operation
            const fileName = document.uri.path.split("/").pop() || "document";
            syncManager.scheduleSyncOperation(`changes to ${fileName}`);

            // Update the file status based on source control (will check if still dirty)
            setTimeout(() => this.updateFileStatus(), 500);

        } catch (error) {
            console.error("Error saving document:", error);
            // If save fails, set status to dirty
            this.updateFileStatus("dirty");
            throw error;
        }
    }

    public async saveCustomDocumentAs(
        document: CodexCellDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        debug("Saving custom document as:", destination.toString());
        await document.saveAs(destination, cancellation);
        this.scheduleCommit(document); // Schedule commit instead of immediate commit
    }

    public async revertCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        debug("Reverting custom document:", document.uri.toString());
        await document.revert(cancellation);
        this.scheduleCommit(document); // Schedule commit instead of immediate commit
    }

    public async backupCustomDocument(
        document: CodexCellDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        debug("Backing up custom document to:", context.destination.toString());
        return document.backup(context.destination, cancellation);
    }

    public getCachedChapter(uri: string): number {
        const key = `chapter-cache-${uri}`;
        return this.context.workspaceState.get(key, 1); // Default to chapter 1
    }

    public async updateCachedChapter(uri: string, chapter: number) {
        const key = `chapter-cache-${uri}`;
        await this.context.workspaceState.update(key, chapter);
    }

    // Preferred editor tab helpers (workspace-scoped)
    public getPreferredEditorTab(): "source" | "backtranslation" | "footnotes" | "timestamps" | "audio" {
        const key = `codex-editor-preferred-tab`;
        return this.context.workspaceState.get(
            key,
            "source"
        ) as "source" | "backtranslation" | "footnotes" | "timestamps" | "audio";
    }

    public async updatePreferredEditorTab(
        tab: "source" | "backtranslation" | "footnotes" | "timestamps" | "audio"
    ) {
        const key = `codex-editor-preferred-tab`;
        await this.context.workspaceState.update(key, tab);
    }

    private getHtmlForWebview(
        webview: vscode.Webview,
        document: CodexCellDocument,
        textDirection: string,
        isSourceText: boolean
    ): string {
        debug("Getting HTML for webview");
        const styleResetUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "reset.css")
        );
        const styleResetUriWithBuster = `${styleResetUri.toString()}?id=${encodeURIComponent(document.uri.toString())}`;
        // Note: vscode.css was removed in favor of Tailwind CSS in individual webviews
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );
        const codiconsUriWithBuster = `${codiconsUri.toString()}?id=${encodeURIComponent(document.uri.toString())}`;
        const scriptUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "webviews",
                "codex-webviews",
                "dist",
                "CodexCellEditor",
                "index.js"
            )
        );
        // Force a unique URL to avoid SW caching across panels
        const scriptUriWithBuster = `${scriptUri.toString()}?id=${encodeURIComponent(document.uri.toString())}`;

        const notebookData = this.getDocumentAsJson(document);
        const videoPath = notebookData.metadata?.videoUrl;
        let videoUri = null;

        // FIXME: when switching from a remote/youtube video to a local video, you need to close the webview and re-open it
        if (videoPath) {
            debug("Processing video path:", videoPath);
            if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
                // If it's a web URL, use it directly
                videoUri = videoPath;
            } else if (videoPath.startsWith("file://")) {
                // If it's a file URI, convert it to a webview URI
                videoUri = webview.asWebviewUri(vscode.Uri.parse(videoPath)).toString();
            } else {
                // If it's a relative path, join it with the workspace URI
                const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (workspaceUri) {
                    // FIXME: if we don't add the video path, then you can use videos from anywhere on your machine
                    const fullPath = vscode.Uri.joinPath(workspaceUri, videoPath);
                    videoUri = webview.asWebviewUri(fullPath).toString();
                }
            }
            debug("Processed video URI:", videoUri);
        }

        const nonce = getNonce();

        const cachedChapter = this.getCachedChapter(document.uri.toString());

        return /*html*/ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}' 'strict-dynamic' https://www.youtube.com https://static.cloudflareinsights.com; frame-src https://www.youtube.com; worker-src ${webview.cspSource} blob:; connect-src https://*.vscode-cdn.net https://*.frontierrnd.com wss://*.frontierrnd.com https://languagetool.org/api/ https://*.workers.dev data: wss://ryderwishart--whisper-websocket-transcription-websocket-transcribe.modal.run wss://*.modal.run; img-src 'self' data: ${webview.cspSource} https:; font-src ${webview.cspSource} data:; media-src ${webview.cspSource} https: blob: data:;">
                <link href="${styleResetUriWithBuster}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUriWithBuster}" rel="stylesheet" nonce="${nonce}" />
                <title>Codex Cell Editor</title>
                
                <script nonce="${nonce}">
                    window.initialData = {
                        isSourceText: ${isSourceText},
                        videoUrl: ${videoUri ? `"${videoUri}"` : "null"},
                        sourceCellMap: ${JSON.stringify(document._sourceCellMap)},
                        metadata: ${JSON.stringify(notebookData.metadata)},
                        userInfo: ${JSON.stringify(this.userInfo)},
                        cachedChapter: ${cachedChapter},
                        cellsPerPage: ${this.CELLS_PER_PAGE},
                        isCorrectionEditorMode: ${this.isCorrectionEditorMode}
                    };
                </script>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUriWithBuster}"></script>
                
                <style>
                    .floating-apply-validations-button {
                        position: fixed;
                        top: 90px;
                        right: 30px;
                        display: flex;
                        align-items: center;
                        background-color: var(--vscode-button-background);
                        color: var(--vscode-button-foreground);
                        padding: 8px 16px;
                        border-radius: 4px;
                        cursor: pointer;
                        box-shadow: 0 2px 8px rgba(0, 0, 0, 0.3);
                        z-index: 1000;
                        font-size: 12px;
                        transition: background-color 0.2s;
                    }
                    .floating-apply-validations-button:hover {
                        background-color: var(--vscode-button-hoverBackground);
                    }
                    .floating-apply-validations-button.applying {
                        cursor: default;
                        opacity: 0.8;
                    }
                    .floating-apply-validations-button .validation-count {
                        background-color: #f5a623; /* Use the same consistent orange color */
                        color: var(--vscode-button-background);
                        border-radius: 50%;
                        width: 20px;
                        height: 20px;
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin-right: 8px;
                        font-weight: bold;
                    }
                    .floating-apply-validations-button .codicon {
                        margin-right: 8px;
                    }
                    .floating-apply-validations-button .close-button {
                        display: flex;
                        align-items: center;
                        justify-content: center;
                        margin-left: 8px;
                        padding: 2px;
                        border-radius: 3px;
                        cursor: pointer;
                    }
                    .floating-apply-validations-button .close-button:hover {
                        background-color: rgba(255, 255, 255, 0.2);
                    }
                    .floating-apply-validations-button .close-button .codicon {
                        margin-right: 0;
                        font-size: 14px;
                    }
                    .spin {
                        animation: spin 1.5s linear infinite;
                    }
                    @keyframes spin {
                        from { transform: rotate(0deg); }
                        to { transform: rotate(360deg); }
                    }
                </style>
            </body>
            </html>`;
    }

    private getDocumentAsJson(document: CodexCellDocument): any {
        debug("Getting document as JSON");
        const text = document.getText();
        if (text.trim().length === 0) {
            debug("Document is empty");
            return {};
        }

        try {
            const json = JSON.parse(text);
            debug("Successfully parsed document as JSON");
            return json;
        } catch {
            throw new Error("Could not get document as json. Content is not valid json");
        }
    }

    private getTextDirection(document: CodexCellDocument): string {
        debug("Getting text direction");
        const notebookData = this.getDocumentAsJson(document);
        debug("Text direction from metadata:", notebookData.metadata?.textDirection);
        return notebookData.metadata?.textDirection || "ltr";
    }

    private isSourceText(uri: vscode.Uri | string): boolean {
        const path = typeof uri === "string" ? uri : uri.path;
        return path.toLowerCase().endsWith(".source");
    }

    private isMatchingFilePair(currentUri: vscode.Uri | string, otherUri: vscode.Uri | string): boolean {
        const currentPath = typeof currentUri === "string" ? currentUri : currentUri.path;
        const otherPath = typeof otherUri === "string" ? otherUri : otherUri.path;
        // Remove extensions before comparing
        const currentPathWithoutExt = currentPath.toLowerCase().replace(/\.[^/.]+$/, '');
        const otherPathWithoutExt = otherPath.toLowerCase().replace(/\.[^/.]+$/, '');
        return currentPathWithoutExt === otherPathWithoutExt;
    }

    private isCodexFile(uri: vscode.Uri | string): boolean {
        const path = typeof uri === "string" ? uri : uri.path;
        return path.toLowerCase().endsWith(".codex");
    }

    private updateTextDirection(
        webviewPanel: vscode.WebviewPanel,
        document: CodexCellDocument
    ): void {
        debug("Updating text direction");
        const textDirection = this.getTextDirection(document);
        this.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesTextDirection",
            textDirection: textDirection as "ltr" | "rtl",
        });
    }

    public async performAutocompleteChapter(
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        currentChapterTranslationUnits: QuillCellContent[]
    ) {
        debug("Starting chapter autocompletion");

        // Create a new cancellation token source for this autocomplete operation
        if (this.autocompleteCancellation) {
            this.autocompleteCancellation.dispose();
        }
        this.autocompleteCancellation = new vscode.CancellationTokenSource();

        try {
            // Calculate cells to process (filter out paratext and range cells)
            const cellsToProcess = currentChapterTranslationUnits.filter(
                (cell) =>
                    cell.cellType !== CodexCellTypes.PARATEXT &&
                    cell.cellContent?.trim() !== "<range>"
            );
            const totalCells = cellsToProcess.length;
            const cellIds = cellsToProcess.map((cell) => cell.cellMarkers[0]);

            // Update state in the provider first
            this.autocompletionState = {
                isProcessing: true,
                totalCells,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: cellIds,
                progress: 0.01, // Start with a tiny bit of progress
            };

            // Send state to webview
            this.broadcastAutocompletionState();

            // Determine if LLM is ready (API key or auth token). We still run transcriptions even if not ready.
            let llmReady = true;
            try {
                llmReady = await this.isLLMReady();
                if (!llmReady) {
                    vscode.window.showWarningMessage(
                        "LLM not configured. Will transcribe sources but skip AI predictions."
                    );
                }
            } catch {
                // If readiness check fails, assume not ready
                llmReady = false;
                vscode.window.showWarningMessage(
                    "LLM check failed. Will transcribe sources but skip AI predictions."
                );
            }

            // Enqueue all cells for processing - they will be processed one by one
            for (const cell of cellsToProcess) {
                const cellId = cell.cellMarkers[0];
                if (!cellId) {
                    console.error("Cell ID is undefined, skipping cell");
                    continue;
                }

                // Before enqueuing, ensure the source cell is transcribed (if needed)
                try {
                    await this.ensureSourceTranscribedIfNeeded(cellId, document, 40000);
                } catch (e) {
                    // Non-fatal: proceed to enqueue translation regardless
                    console.warn(`Preflight transcription check failed for ${cellId}; continuing`, e);
                }

                // Only enqueue translation if LLM is ready
                if (llmReady) {
                    this.enqueueTranslation(cellId, document, true)
                        .then(() => {
                            // Cell processed successfully
                        })
                        .catch((error) => {
                            const isCancellationError = error instanceof vscode.CancellationError ||
                                (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'));
                            const isIntentionalCancellation = error instanceof Error && error.message.includes("Translation cancelled");
                            if (!isCancellationError && !isIntentionalCancellation) {
                                console.error(`Error autocompleting cell ${cellId}:`, error);
                            }
                        });
                }
            }

            // Instead of waiting for all promises to complete, monitor the queue status
            const checkQueueStatus = () => {
                const remainingCells = this.translationQueue.filter((req) =>
                    cellIds.includes(req.cellId)
                ).length;

                // Update state directly based on remaining cells
                this.autocompletionState.completedCells = totalCells - remainingCells;
                this.autocompletionState.progress = Math.min(
                    0.99,
                    this.autocompletionState.completedCells / totalCells
                );
                this.broadcastAutocompletionState();

                // Continue checking until complete or cancelled
                if (
                    remainingCells > 0 &&
                    !this.autocompleteCancellation?.token.isCancellationRequested
                ) {
                    setTimeout(checkQueueStatus, 500);
                } else {
                    // All cells processed or operation cancelled
                    this.autocompletionState.progress = 1.0;
                    this.broadcastAutocompletionState();

                    // After a short delay, reset state and clean up cancellation token
                    setTimeout(() => {
                        this.autocompletionState = {
                            isProcessing: false,
                            totalCells: 0,
                            completedCells: 0,
                            currentCellId: undefined,
                            cellsToProcess: [],
                            progress: 0,
                        };
                        this.broadcastAutocompletionState();

                        // Clean up cancellation token when autocompletion is actually complete
                        if (this.autocompleteCancellation) {
                            this.autocompleteCancellation.dispose();
                            this.autocompleteCancellation = undefined;
                            debug("Autocompletion cancellation token disposed after completion");
                        }
                    }, 1500);
                }
            };

            // Start monitoring
            checkQueueStatus();
        } catch (error) {
            // If there's an error during setup, clean up the cancellation token
            console.error("Error in performAutocompleteChapter:", error);
            if (this.autocompleteCancellation) {
                this.autocompleteCancellation.dispose();
                this.autocompleteCancellation = undefined;
            }
            throw error;
        }
    }

    // Minimal helper: ensure the matching source cell has text by triggering
    // a targeted transcription in the source editor, then polling for up to timeoutMs.
    private async ensureSourceTranscribedIfNeeded(
        cellId: string,
        document: CodexCellDocument,
        timeoutMs: number = 40000
    ): Promise<void> {
        try {
            // Quick cancellation check
            if (this.autocompleteCancellation?.token.isCancellationRequested) return;

            // Check if the source cell already has any text content
            const src = await vscode.commands.executeCommand(
                "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                cellId
            ) as { cellId: string; content: string; } | null;

            const hasText = !!src && !!src.content && src.content.replace(/<[^>]*>/g, "").trim() !== "";
            if (hasText) return; // Nothing to do

            // Open the corresponding source document
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (!workspaceFolder) return;

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

            try {
                await vscode.commands.executeCommand(
                    "vscode.openWith",
                    sourcePath,
                    "codex.cellEditor",
                    { viewColumn: vscode.ViewColumn.One }
                );
                // Wait for source webview to be ready
                await this.waitForWebviewReady(sourcePath.toString(), 3000);
            } catch (e) {
                console.warn("Failed to open source editor for transcription preflight", e);
                // Continue; we may already have a panel open
            }

            // Find the source panel
            const sourcePanel = this.getWebviewPanels().get(sourcePath.toString());
            if (sourcePanel) {
                // Ask the webview to transcribe the specific cell if audio is available
                safePostMessageToPanel(sourcePanel, {
                    type: "startBatchTranscription",
                    content: { count: 1, cellId },
                } as any);
            } else {
                // If no panel is found, there's nothing more we can do
                return;
            }

            // Poll for source text availability up to timeoutMs, respecting cancellation
            const start = Date.now();
            while (Date.now() - start < timeoutMs) {
                if (this.autocompleteCancellation?.token.isCancellationRequested) return;

                const check = await vscode.commands.executeCommand(
                    "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                    cellId
                ) as { cellId: string; content: string; } | null;
                const nowHasText = !!check && !!check.content && check.content.replace(/<[^>]*>/g, "").trim() !== "";
                if (nowHasText) return;

                await new Promise((r) => setTimeout(r, 400));
            }
            // Timeout hit; proceed without blocking
            console.warn(`Transcription preflight timed out after ${timeoutMs}ms for cell ${cellId}`);
        } catch (e) {
            console.warn("ensureSourceTranscribedIfNeeded encountered an error", e);
        }
    }

    // Check if LLM appears ready (either an API key is set or an auth token is available)
    public async isLLMReady(): Promise<boolean> {
        try {
            const config = vscode.workspace.getConfiguration("codex-editor-extension");
            const apiKey = (config.get("api_key") as string) || "";
            if (apiKey && apiKey.trim().length > 0) return true;

            try {
                const frontierApi = getAuthApi();
                if (frontierApi) {
                    const token = await frontierApi.authProvider.getToken();
                    if (token && token.trim().length > 0) return true;
                }
            } catch {
                // ignore auth API failures; treat as not ready
            }
        } catch {
            // ignore; treat as not ready
        }
        return false;
    }

    // New method to broadcast the current autocompletion state to all webviews
    private broadcastAutocompletionState(): void {
        const {
            isProcessing,
            totalCells,
            completedCells,
            currentCellId,
            cellsToProcess,
            progress,
        } = this.autocompletionState;

        this.webviewPanels.forEach((panel) => {
            safePostMessageToPanel(panel, {
                type: "providerAutocompletionState",
                state: {
                    isProcessing,
                    totalCells,
                    completedCells,
                    currentCellId,
                    cellsToProcess,
                    progress,
                },
            });
        });
    }

    public cancelAutocompleteChapter(): boolean {
        if (this.autocompleteCancellation) {
            debug("Cancelling chapter autocompletion");
            this.autocompleteCancellation.cancel();

            // Immediately clear all batch translation requests from the queue
            if (this.translationQueue.length > 0 && this.autocompletionState.isProcessing) {
                // Get current cell IDs in the batch
                const batchCellIds = this.autocompletionState.cellsToProcess;

                // Keep the current processing cell if any, but only if it's not actively processing
                // If the queue is actively processing, we want to let the cancellation token handle it
                const shouldKeepCurrentRequest = this.isProcessingQueue ? false : true;
                const currentRequest = shouldKeepCurrentRequest && this.translationQueue.length > 0 ?
                    this.translationQueue[0] : null;

                // Filter out all batch requests
                const remainingRequests = this.translationQueue.filter((req, index) => {
                    // If we're keeping the current request and this is the first item
                    if (index === 0 && shouldKeepCurrentRequest && currentRequest) {
                        return !batchCellIds.includes(req.cellId);
                    }

                    // Reject all batch requests with intentional cancellation (info level, not error)
                    if (batchCellIds.includes(req.cellId)) {
                        req.reject(new Error("Translation cancelled"));
                        return false;
                    }

                    // Keep all non-batch requests
                    return true;
                });

                // Update the queue
                this.translationQueue = remainingRequests;

                debug(`Queue updated after cancellation. Remaining requests: ${remainingRequests.length}`);
            }

            // Reset autocompletion state
            this.autocompletionState = {
                isProcessing: false,
                totalCells: 0,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: [],
                progress: 0,
            };
            this.broadcastAutocompletionState();

            // Dispose of the cancellation token since we're manually cancelling
            this.autocompleteCancellation.dispose();
            this.autocompleteCancellation = undefined;

            debug("Chapter autocompletion cancelled successfully");
            return true;
        }
        debug("No active autocompletion to cancel");
        return false;
    }

    // New method to set single cell translation state
    public startSingleCellTranslation(cellId: string): void {
        this.singleCellTranslationState = {
            isProcessing: true,
            cellId,
            progress: 0,
        };
        this.broadcastSingleCellTranslationState();
    }

    // Unified method to handle all single cell translation state changes
    public updateSingleCellTranslation(progress: number, errorMessage?: string): void {
        if (!this.singleCellTranslationState.isProcessing || !this.singleCellTranslationState.cellId) {
            return;
        }

        if (errorMessage) {
            // Handle error case
            const cellId = this.singleCellTranslationState.cellId;
            this.singleCellTranslationState = {
                isProcessing: false,
                cellId: undefined,
                progress: 0,
            };
            this.webviewPanels.forEach((panel) => {
                safePostMessageToPanel(panel, {
                    type: "singleCellTranslationFailed",
                    cellId,
                    error: errorMessage,
                });
            });
        } else if (progress >= 1.0) {
            // Handle completion
            this.singleCellTranslationState = {
                isProcessing: false,
                cellId: undefined,
                progress: 0,
            };
            this.broadcastSingleCellTranslationState();
        } else {
            // Handle progress update
            this.singleCellTranslationState.progress = progress;
            this.broadcastSingleCellTranslationState();
        }
    }

    // New method to broadcast single cell translation state
    private broadcastSingleCellTranslationState(): void {
        if (!this.singleCellTranslationState.cellId) {
            return;
        }

        const { isProcessing, cellId, progress } = this.singleCellTranslationState;

        this.webviewPanels.forEach((panel) => {
            if (isProcessing) {
                if (progress === 0) {
                    // Starting
                    safePostMessageToPanel(panel, {
                        type: "singleCellTranslationStarted",
                        cellId,
                    });
                } else if (progress < 1) {
                    // In progress
                    safePostMessageToPanel(panel, {
                        type: "singleCellTranslationProgress",
                        cellId,
                        progress,
                    });
                } else {
                    // Completed
                    safePostMessageToPanel(panel, {
                        type: "singleCellTranslationCompleted",
                        cellId,
                    });
                }
            } else {
                // Not processing (completed/stopped)
                safePostMessageToPanel(panel, {
                    type: "singleCellTranslationCompleted",
                    cellId,
                });
            }
        });
    }

    // New method to broadcast single cell queue state (robust pattern)
    private broadcastSingleCellQueueState(): void {
        const { isProcessing, totalCells, completedCells, currentCellId, cellsToProcess, progress } =
            this.singleCellQueueState;

        this.webviewPanels.forEach((panel) => {
            safePostMessageToPanel(panel, {
                type: "providerSingleCellQueueState",
                state: {
                    isProcessing,
                    totalCells,
                    completedCells,
                    currentCellId,
                    cellsToProcess,
                    progress,
                },
            });
        });
    }

    // New method to start single cell queue processing (robust pattern)
    public async performSingleCellQueue(
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        cellIds: string[],
        shouldUpdateValue: boolean,
    ) {

        // Create a new cancellation token source for this operation
        if (this.singleCellQueueCancellation) {
            this.singleCellQueueCancellation.dispose();
        }
        this.singleCellQueueCancellation = new vscode.CancellationTokenSource();

        try {
            const totalCells = cellIds.length;

            // Update state in the provider first
            this.singleCellQueueState = {
                isProcessing: true,
                totalCells,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: cellIds,
                progress: 0.01, // Start with a tiny bit of progress
            };

            // Send state to webview
            this.broadcastSingleCellQueueState();

            // Enqueue all cells for processing - they will be processed one by one
            for (const cellId of cellIds) {
                if (!cellId) {
                    console.error("Cell ID is undefined, skipping cell");
                    continue;
                }

                // Add to the unified queue - no need to wait for completion here
                this.enqueueTranslation(cellId, document, shouldUpdateValue)
                    .then(() => {
                        // Cell has been processed successfully
                        // The queue processing will update progress automatically
                    })
                    .catch((error) => {
                        // Just log errors - the queue processing will update progress
                        console.error(`Error processing single cell ${cellId}:`, error);
                    });
            }

            // Instead of waiting for all promises to complete, monitor the queue status
            const checkQueueStatus = () => {
                // Use the current state to get all cells (including dynamically added ones)
                const currentCellIds = this.singleCellQueueState.cellsToProcess;
                const remainingCells = this.translationQueue.filter((req) =>
                    currentCellIds.includes(req.cellId)
                ).length;

                // Update state directly based on remaining cells and current total
                const currentTotalCells = this.singleCellQueueState.totalCells;
                this.singleCellQueueState.completedCells = currentTotalCells - remainingCells;
                this.singleCellQueueState.progress = Math.min(
                    0.99,
                    this.singleCellQueueState.completedCells / currentTotalCells
                );
                this.broadcastSingleCellQueueState();

                // Continue checking until complete or cancelled
                if (
                    remainingCells > 0 &&
                    !this.singleCellQueueCancellation?.token.isCancellationRequested
                ) {
                    setTimeout(checkQueueStatus, 500);
                } else {
                    // All cells processed or operation cancelled
                    this.singleCellQueueState.progress = 1.0;
                    this.broadcastSingleCellQueueState();

                    // After a short delay, reset state and clean up cancellation token
                    setTimeout(() => {
                        this.singleCellQueueState = {
                            isProcessing: false,
                            totalCells: 0,
                            completedCells: 0,
                            currentCellId: undefined,
                            cellsToProcess: [],
                            progress: 0,
                        };
                        this.broadcastSingleCellQueueState();

                        // Clean up cancellation token when processing is actually complete
                        if (this.singleCellQueueCancellation) {
                            this.singleCellQueueCancellation.dispose();
                            this.singleCellQueueCancellation = undefined;
                        }
                    }, 1500);
                }
            };

            // Start monitoring
            checkQueueStatus();
        } catch (error) {
            // If there's an error during setup, clean up the cancellation token
            console.error("Error in performSingleCellQueue:", error);
            if (this.singleCellQueueCancellation) {
                this.singleCellQueueCancellation.dispose();
                this.singleCellQueueCancellation = undefined;
            }
            throw error;
        }
    }

    // New method to add a cell to the single cell queue (accumulate like autocomplete chapter)
    public async addCellToSingleCellQueue(
        cellId: string,
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        shouldUpdateValue: boolean = false
    ): Promise<void> {

        // Check if we already have a single cell queue running
        if (this.singleCellQueueState.isProcessing) {
            // Add to existing queue if not already there
            if (!this.singleCellQueueState.cellsToProcess.includes(cellId)) {
                this.singleCellQueueState.cellsToProcess.push(cellId);
                this.singleCellQueueState.totalCells = this.singleCellQueueState.cellsToProcess.length;

                // Broadcast updated state
                this.broadcastSingleCellQueueState();

                // Add to the unified translation queue
                this.enqueueTranslation(cellId, document, shouldUpdateValue)
                    .then(() => {
                        // Cell processed successfully
                    })
                    .catch((error) => {
                        // Check if this is a cancellation error
                        const isCancellationError = error instanceof vscode.CancellationError ||
                            (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'));
                        const isIntentionalCancellation = error instanceof Error && error.message.includes("Translation cancelled");

                        if (!isCancellationError && !isIntentionalCancellation) {
                            console.error(`Error processing single cell ${cellId}:`, error);
                        }
                    });
            }
        } else {
            // Start a new single cell queue with this cell
            await this.performSingleCellQueue(document, webviewPanel, [cellId], shouldUpdateValue);
        }
    }

    // New method to cancel single cell queue processing
    public cancelSingleCellQueue(): boolean {
        if (this.singleCellQueueCancellation) {
            this.singleCellQueueCancellation.cancel();

            // Immediately clear all single cell queue requests from the queue
            if (this.translationQueue.length > 0 && this.singleCellQueueState.isProcessing) {
                // Get current cell IDs in the queue
                const queueCellIds = this.singleCellQueueState.cellsToProcess;

                // Keep the current processing cell if any, but only if it's not actively processing
                const shouldKeepCurrentRequest = this.isProcessingQueue ? false : true;
                const currentRequest = shouldKeepCurrentRequest && this.translationQueue.length > 0 ?
                    this.translationQueue[0] : null;

                // Filter out all single cell queue requests
                const remainingRequests = this.translationQueue.filter((req, index) => {
                    // If we're keeping the current request and this is the first item
                    if (index === 0 && shouldKeepCurrentRequest && currentRequest) {
                        return !queueCellIds.includes(req.cellId);
                    }

                    // Reject all queue requests with intentional cancellation (info level, not error)
                    if (queueCellIds.includes(req.cellId)) {
                        req.reject(new Error("Translation cancelled"));
                        return false;
                    }

                    // Keep all non-queue requests
                    return true;
                });

                // Update the queue
                this.translationQueue = remainingRequests;
            }

            // Reset single cell queue state
            this.singleCellQueueState = {
                isProcessing: false,
                totalCells: 0,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: [],
                progress: 0,
            };
            this.broadcastSingleCellQueueState();

            // Dispose of the cancellation token since we're manually cancelling
            this.singleCellQueueCancellation.dispose();
            this.singleCellQueueCancellation = undefined;

            return true;
        }
        return false;
    }

    private processNotebookData(notebook: CodexNotebookAsJSONData, document?: CodexCellDocument) {
        debug("Processing notebook data", notebook);
        const translationUnits: QuillCellContent[] = notebook.cells.map((cell) => ({
            cellMarkers: [cell.metadata?.id],
            cellContent: cell.value,
            cellType: cell.metadata?.type,
            editHistory: cell.metadata?.edits,
            // Prefer nested data for timestamps, but fall back to legacy top-level fields if needed
            timestamps: cell.metadata?.data,
            cellLabel: cell.metadata?.cellLabel,
            merged: cell.metadata?.data?.merged,
            deleted: cell.metadata?.data?.deleted,
            attachments: cell.metadata?.attachments,
            metadata: {
                selectedAudioId: cell.metadata?.selectedAudioId,
                selectionTimestamp: cell.metadata?.selectionTimestamp,
                isLocked: cell.metadata?.isLocked,
            },
        }));
        debug("Translation units:", translationUnits);

        // Use the passed document if available, otherwise fall back to currentDocument
        const docToCheck = document || this.currentDocument;
        const isSourceText = this.isSourceText(docToCheck?.uri.toString() ?? "");
        const processedData = this.mergeRangesAndProcess(translationUnits, this.isCorrectionEditorMode, isSourceText ?? false);
        debug("Notebook data processed", processedData);
        return processedData;
    }

    private mergeRangesAndProcess(translationUnits: QuillCellContent[], isCorrectionEditorMode: boolean, isSourceText: boolean) {
        debug("Merging ranges and processing translation units");
        const isSourceAndCorrectionEditorMode = isSourceText && isCorrectionEditorMode;
        const translationUnitsWithMergedRanges: QuillCellContent[] = [];

        translationUnits.forEach((cell, index) => {
            const rangeMarker = "<range>";
            if (cell.cellContent?.trim() === rangeMarker) {
                return;
            }
            if (cell.merged && !isSourceAndCorrectionEditorMode) {
                return;
            }

            if (cell.deleted) {
                return;
            }

            let forwardIndex = 1;
            const cellMarkers = [...cell.cellMarkers];
            let nextCell = translationUnits[index + forwardIndex];

            while (nextCell?.cellContent?.trim() === rangeMarker) {
                cellMarkers.push(...nextCell.cellMarkers);
                forwardIndex++;
                nextCell = translationUnits[index + forwardIndex];
            }
            // Check if cell content is an empty span and convert to empty string
            const processedCellContent =
                cell.cellContent?.trim() === "<span></span>" ? "" : cell.cellContent;

            translationUnitsWithMergedRanges.push({
                cellMarkers,
                cellContent: processedCellContent,
                cellType: cell.cellType,
                editHistory: cell.editHistory,
                timestamps: cell.timestamps,
                cellLabel: cell.cellLabel,
                merged: cell.merged,
                attachments: cell.attachments,
                metadata: cell.metadata,
            });
        });

        debug("Range merging completed", { translationUnitsWithMergedRanges });
        return translationUnitsWithMergedRanges;
    }

    public postMessageToWebview(webviewPanel: vscode.WebviewPanel, message: EditorReceiveMessages) {
        try {
            // Use safePostMessageToPanel wrapper to ensure we don't break webview with invalid messages
            safePostMessageToPanel(webviewPanel, message);
        } catch (error) {
            console.error("Failed to post message to webview:", error);
        }
    }

    public async refreshWebview(webviewPanel: vscode.WebviewPanel, document: CodexCellDocument) {
        debug("Refreshing webview");
        const notebookData = this.getDocumentAsJson(document);
        const processedData = this.processNotebookData(notebookData, document);
        const isSourceText = this.isSourceText(document.uri);
        const videoUrl = this.getVideoUrl(notebookData.metadata?.videoUrl, webviewPanel);

        // Reset webview ready state since we're resetting the HTML
        this.resetWebviewReadyState(document.uri.toString());

        // Prevent overlapping refreshes which can race SW/iframe creation
        const docKey = document.uri.toString();
        if (this.refreshInFlight.has(docKey)) {
            // Debounce: remember that another refresh was requested
            this.pendingRefresh.add(docKey);
            debug("Refresh already in-flight, queuing another once complete");
            return;
        }
        this.refreshInFlight.add(docKey);

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            this.getTextDirection(document),
            isSourceText
        );

        // Get bundled metadata to avoid separate requests
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCount = config.get("validationCount", 1);
        const validationCountAudio = config.get("validationCountAudio", 1);
        const authApi = await this.getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const username = userInfo?.username || "anonymous";

        // Schedule updates to wait for webview ready signal
        this.scheduleWebviewUpdate(document.uri.toString(), () => {
            this.postMessageToWebview(webviewPanel, {
                type: "providerSendsInitialContent",
                content: processedData,
                isSourceText: isSourceText,
                sourceCellMap: document._sourceCellMap,
                username: username,
                validationCount: validationCount,
                validationCountAudio: validationCountAudio,
            });

            this.postMessageToWebview(webviewPanel, {
                type: "providerUpdatesNotebookMetadataForWebview",
                content: notebookData.metadata,
            });

            // Audio attachment availability is derived in the webview from QuillCellContent.attachments

            if (videoUrl) {
                this.postMessageToWebview(webviewPanel, {
                    type: "updateVideoUrlInWebview",
                    content: videoUrl,
                });
            }
        });

        debug("Webview refresh scheduled");

        // Release in-flight lock after a tick and run any queued refresh once
        setTimeout(() => {
            this.refreshInFlight.delete(docKey);
            if (this.pendingRefresh.has(docKey)) {
                this.pendingRefresh.delete(docKey);
                debug("Running queued refresh after previous in-flight completed");
                // Fire and forget; next call will set in-flight again
                this.refreshWebview(webviewPanel, document);
            }
        }, 0);
    }

    // Removed: sendAudioAttachmentsStatus; audio availability is computed client-side from content

    private getVideoUrl(
        videoPath: string | undefined,
        webviewPanel: vscode.WebviewPanel
    ): string | null {
        debug("Getting video URL for path:", videoPath);
        if (!videoPath) return null;

        try {
            if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
                return videoPath;
            } else if (videoPath.startsWith("file://")) {
                return webviewPanel.webview.asWebviewUri(vscode.Uri.parse(videoPath)).toString();
            } else {
                const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
                if (workspaceUri) {
                    const fullPath = vscode.Uri.joinPath(workspaceUri, videoPath);
                    return webviewPanel.webview.asWebviewUri(fullPath).toString();
                }
            }
        } catch (err) {
            console.error("Error processing video URL:", err);
        }
        debug("No valid video URL found");
        return null;
    }

    public updateCellIdState(cellId: string, uri: string) {
        debug("Updating cell ID state:", { cellId, uri, stateStore: this.stateStore });

        // Handle both setting and clearing highlights
        if (uri) {
            const valueIsCodexFile = this.isCodexFile(uri);
            if (valueIsCodexFile) {
                // Send highlight/clear messages to source files when a codex file is active
                for (const [panelUri, panel] of this.webviewPanels.entries()) {
                    const isSourceFile = this.isSourceText(panelUri);
                    // copy this to update target with merged cells
                    if (isSourceFile) {
                        if (cellId) {
                            // Set highlight
                            debug("Sending highlight message to source file:", panelUri, "cellId:", cellId);
                            safePostMessageToPanel(panel, {
                                type: "highlightCell",
                                cellId: cellId,
                            });
                        } else {
                            // Clear highlight
                            debug("Clearing highlight in source file:", panelUri);
                            safePostMessageToPanel(panel, {
                                type: "highlightCell",
                                cellId: null,
                            });
                        }
                    }
                }
            }
        }

        if (!this.stateStore) {
            console.warn("State store not initialized when trying to update cell ID");
            return;
        }
        this.stateStore.updateStoreState({
            key: "cellId",
            value: {
                cellId,
                uri,
                timestamp: new Date().toISOString(),
            },
        });
    }

    public async mergeMatchingCellsInTargetFile(cellIdOfCellToMerge: string, cellIdOfTargetCell: string, uri: string, workspaceFolder: vscode.WorkspaceFolder) {
        debug("Merging matching cells in target file:", { cellIdOfCellToMerge, cellIdOfTargetCell, uri });

        try {
            // 1. Construct target file path
            const normalizedPath = uri.replace(/\\/g, "/");
            const baseFileName = path.basename(normalizedPath);
            const targetFileName = baseFileName.replace(".source", ".codex");

            // 2. Open or find the target document if it is not already open
            const targetPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target", targetFileName);
            const sourcePath = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts", baseFileName);


            // Open the source file in the left-most group (ViewColumn.One)
            await vscode.commands.executeCommand(
                "vscode.openWith",
                sourcePath,
                "codex.cellEditor",
                { viewColumn: vscode.ViewColumn.One }
            );

            // Wait for source webview to be ready before opening target
            const sourceReady = await this.waitForWebviewReady(sourcePath.toString(), 3000);
            if (!sourceReady) {
                debug("Source webview not ready, opening target anyway");
            }

            // Open the codex file in the right-most group (ViewColumn.Two)
            await vscode.commands.executeCommand(
                "vscode.openWith",
                targetPath,
                "codex.cellEditor",
                { viewColumn: vscode.ViewColumn.Two }
            );
            // Find the target document instance
            let targetDocument: CodexCellDocument | undefined;

            // Check if the target document is already open in our webview panels
            const targetDocumentUri = targetPath.toString();
            for (const [panelUri, panel] of this.webviewPanels.entries()) {
                if (this.isMatchingFilePair(targetDocumentUri, panelUri)) {
                    // Try to get the document from the provider's current document or create it
                    targetDocument = await this.openCustomDocument(
                        vscode.Uri.parse(panelUri),
                        {},
                        new vscode.CancellationTokenSource().token
                    );
                    break;
                }
            }

            if (!targetDocument) {
                // If not found in panels, create a new document instance
                targetDocument = await this.openCustomDocument(
                    targetPath,
                    {},
                    new vscode.CancellationTokenSource().token
                );
            }

            // 3. Get the content from both cells
            const currentCellContent = this.currentDocument?.getCellContent(cellIdOfCellToMerge);
            const targetCellContent = targetDocument.getCellContent(cellIdOfTargetCell);

            if (!currentCellContent || !targetCellContent) {
                throw new Error("Could not find one or both cells for merge operation");
            }

            // 4. Use the existing mergeCellWithPrevious command
            const targetPanel = this.webviewPanels.get(targetDocumentUri);
            if (!targetPanel) {
                throw new Error("Could not find target webview panel");
            }

            // Create a merge event to reuse existing handler
            const mergeEvent: EditorPostMessages = {
                command: "mergeCellWithPrevious" as const,
                content: {
                    currentCellId: cellIdOfCellToMerge,
                    previousCellId: cellIdOfTargetCell,
                    currentContent: currentCellContent.cellContent || "",
                    previousContent: targetCellContent.cellContent || ""
                }
            };

            // Call the existing merge handler directly
            await handleMessages(
                mergeEvent,
                targetPanel,
                targetDocument,
                async () => await this.refreshWebview(targetPanel, targetDocument),
                this
            );

            vscode.window.showInformationMessage(
                `Successfully merged cells in ${targetFileName}`
            );

        } catch (error) {
            console.error("Error merging cells in target file:", error);
            vscode.window.showErrorMessage(
                `Failed to merge target cells: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async unmergeMatchingCellsInTargetFile(cellIdToUnmerge: string, uri: string, workspaceFolder: vscode.WorkspaceFolder) {
        debug("Unmerging matching cells in target file:", { cellIdToUnmerge, uri });

        try {
            // 1. Construct target file path - handle both directions
            const normalizedPath = uri.replace(/\\/g, "/");
            const baseFileName = path.basename(normalizedPath);

            let targetPath: vscode.Uri;
            let targetFileName: string;
            let isSourceToTarget: boolean;

            if (baseFileName.endsWith(".source")) {
                // Source file -> Target file (.source -> .codex)
                targetFileName = baseFileName.replace(".source", ".codex");
                targetPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target", targetFileName);
                isSourceToTarget = true;
            } else if (baseFileName.endsWith(".codex")) {
                // Target file -> Source file (.codex -> .source)
                targetFileName = baseFileName.replace(".codex", ".source");
                targetPath = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "sourceTexts", targetFileName);
                isSourceToTarget = false;
            } else {
                throw new Error(`Unsupported file type for unmerge operation: ${baseFileName}`);
            }

            // 2. Open the target file
            await vscode.commands.executeCommand(
                "vscode.openWith",
                targetPath,
                "codex.cellEditor",
                { viewColumn: isSourceToTarget ? vscode.ViewColumn.Two : vscode.ViewColumn.One }
            );

            // Find the target document instance
            let targetDocument: CodexCellDocument | undefined;

            // Check if the target document is already open in our webview panels
            const targetDocumentUri = targetPath.toString();
            for (const [panelUri, panel] of this.webviewPanels.entries()) {
                if (this.isMatchingFilePair(targetDocumentUri, panelUri)) {
                    // Try to get the document from the provider's current document or create it
                    targetDocument = await this.openCustomDocument(
                        vscode.Uri.parse(panelUri),
                        {},
                        new vscode.CancellationTokenSource().token
                    );
                    break;
                }
            }

            if (!targetDocument) {
                // If not found in panels, create a new document instance
                targetDocument = await this.openCustomDocument(
                    targetPath,
                    {},
                    new vscode.CancellationTokenSource().token
                );
            }

            // 3. Remove the merge flag from the corresponding cell in the target file and record edit
            const targetCellData = targetDocument.getCellData(cellIdToUnmerge) || {};

            // Remove the merged flag by setting it to false
            targetDocument.updateCellData(cellIdToUnmerge, {
                ...targetCellData,
                merged: false
            });

            // Append edit history entry for merged=false on the target cell
            try {
                const cell = (targetDocument as any).getCell(cellIdToUnmerge);
                if (cell) {
                    cell.metadata.edits = cell.metadata.edits || [];
                    cell.metadata.edits.push({
                        editMap: ["metadata", "data", "merged"],
                        value: false,
                        timestamp: Date.now(),
                        type: "user-edit",
                        author: "anonymous",
                        validatedBy: []
                    });
                }
            } catch (e) {
                console.warn("Failed to append merged=false edit on target during unmerge", e);
            }

            // Save the target document
            await targetDocument.save(new vscode.CancellationTokenSource().token);

            debug(`Successfully unmerged cell ${cellIdToUnmerge} in ${isSourceToTarget ? 'target' : 'source'} file ${targetFileName}`);

            // Refresh the target webview if it's open
            const targetPanel = this.webviewPanels.get(targetDocumentUri);
            if (targetPanel) {
                await this.refreshWebview(targetPanel, targetDocument);
            }

            vscode.window.showInformationMessage(
                `Successfully unmerged cell in both files`
            );

        } catch (error) {
            console.error("Error unmerging cell in target file:", error);
            vscode.window.showErrorMessage(
                `Failed to unmerge corresponding cell: ${error instanceof Error ? error.message : String(error)}`
            );
        }
    }

    public async getAuthApi() {
        return getAuthApi();
    }

    /**
     * Refreshes the validation state for all open documents
     * This ensures all webviews show the correct validation status when validation requirements change
     */
    private refreshValidationStateForAllDocuments() {
        // Keep track of processed documents to avoid duplicates
        const processedDocuments = new Set<string>();

        // Get the current validation count
        const config = vscode.workspace.getConfiguration("codex-project-manager");

        // For each document URI in the webview panels map
        this.webviewPanels.forEach((panel, docUri) => {
            // Skip if already processed
            if (processedDocuments.has(docUri)) return;
            processedDocuments.add(docUri);

            // Validation count now bundled with initial content, no separate send needed

            // Try to find the document
            // The document might be the current document
            const doc =
                this.currentDocument?.uri.toString() === docUri ? this.currentDocument : undefined;

            if (doc) {
                try {
                    // Access the document's internal data
                    // Since we might not have direct access to cells, use a simple approach:
                    // Just refresh all cells by getting all cell IDs with validations
                    const allCellIds = doc.getAllCellIds();

                    // For each cell, broadcast its current validation state to all webviews for this document
                    allCellIds.forEach((cellId: string) => {
                        const validatedBy = doc.getCellValidatedBy(cellId);
                        const audioValidatedBy = doc.getCellAudioValidatedBy(cellId);

                        // Only send updates for cells that have validations
                        if (validatedBy && validatedBy.length > 0) {
                            // Post validation state update to all panels for this document
                            this.webviewPanels.forEach((panel, uri) => {
                                if (uri === docUri) {
                                    this.postMessageToWebview(panel, {
                                        type: "providerUpdatesValidationState" as any,
                                        content: {
                                            cellId,
                                            validatedBy,
                                        },
                                    });
                                }
                            });
                        }

                        // Only send updates for cells that have audio validations
                        if (audioValidatedBy && audioValidatedBy.length > 0) {
                            const selectedAudioId = doc.getExplicitAudioSelection(cellId) ?? undefined;

                            // Post audio validation state update to all panels for this document
                            this.webviewPanels.forEach((panel, uri) => {
                                if (uri === docUri) {
                                    this.postMessageToWebview(panel, {
                                        type: "providerUpdatesAudioValidationState" as any,
                                        content: {
                                            cellId,
                                            validatedBy: audioValidatedBy,
                                            selectedAudioId,
                                        },
                                    });
                                }
                            });
                        }
                    });
                } catch (error) {
                    console.error("Error refreshing validation state:", error);
                }
            }
        });
    }

    /**
     * Updates the validation count in all open editor webviews
     * This ensures the validation indicators reflect the current required validation count
     */
    private updateValidationIndicatorsForAllDocuments() {
        // Get the current configuration
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const validationCount = config.get("validationCount", 1);

        debug(
            `Updating validation indicators for all documents with validation count: ${validationCount}`
        );

        // Validation count now bundled with initial content, only send on actual config changes

        // Also refresh the validation state to ensure displays are consistent
        this.refreshValidationStateForAllDocuments();
    }

    // Marks a cell as complete in our internal state tracking
    public markCellComplete(cellId: string) {
        debug(`Marking cell ${cellId} as complete`);

        // Only update state for single cell translations
        // (Batch progress is now handled by the queue monitor)
        if (
            this.singleCellTranslationState.isProcessing &&
            this.singleCellTranslationState.cellId === cellId
        ) {
            this.updateSingleCellTranslation(1.0);

            // Use a short timeout to reset the state after completion
            setTimeout(() => this.updateSingleCellTranslation(1.0), 1500);
        }
    }

    // Add a new method to enqueue translation requests
    public enqueueTranslation(
        cellId: string,
        document: CodexCellDocument,
        shouldUpdateValue: boolean = false
    ): Promise<any> {
        debug(`Enqueueing translation for cell ${cellId}`);

        // Create a new promise for this request
        return new Promise((resolve, reject) => {
            // Add the request to the queue
            this.translationQueue.push({
                cellId,
                document,
                shouldUpdateValue,
                validationRequest: false,
                shouldValidate: false,
                resolve,
                reject,
            });

            // Start processing the queue if it's not already in progress
            if (!this.isProcessingQueue) {
                this.processTranslationQueue();
            }
        });
    }

    // Modify the processTranslationQueue method to handle validation requests
    private async processTranslationQueue(): Promise<void> {
        if (this.isProcessingQueue || this.translationQueue.length === 0) {
            return;
        }

        debug("Started processing translation queue");
        this.isProcessingQueue = true;

        try {
            while (this.translationQueue.length > 0) {
                // Check if autocomplete has been cancelled before processing each item
                if (this.autocompleteCancellation?.token.isCancellationRequested) {
                    debug("Autocomplete cancellation detected, stopping queue processing");
                    break;
                }

                const request = this.translationQueue[0];

                // Handle audio validation request first if that's what it is
                if (request.audioValidationRequest) {
                    try {
                        debug(`Processing audio validation for cell ${request.cellId}`);

                        // Start audio validation with UI notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "audioValidationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: true,
                                    },
                                });
                            }
                        });

                        // Perform the audio validation
                        await request.document.validateCellAudio(
                            request.cellId,
                            request.shouldValidate
                        );

                        // Send completion notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "audioValidationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: false,
                                    },
                                });
                            }
                        });

                        // Remove the processed request from the queue and resolve
                        this.translationQueue.shift();
                        request.resolve(true);
                    } catch (error) {
                        debug(`Error processing audio validation for cell ${request.cellId}:`, error);

                        // Send audio validation error notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "audioValidationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: false, // Mark as complete even on error
                                        error:
                                            error instanceof Error ? error.message : String(error),
                                    },
                                });
                            }
                        });

                        // Remove from queue and reject the promise
                        this.translationQueue.shift();
                        request.reject(error);
                    }
                    continue;
                }

                // Handle validation request if that's what it is
                if (request.validationRequest) {
                    try {
                        debug(`Processing validation for cell ${request.cellId}`);

                        // Start validation with UI notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "validationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: true,
                                    },
                                });
                            }
                        });

                        // Perform the validation
                        await request.document.validateCellContent(
                            request.cellId,
                            request.shouldValidate
                        );

                        // Send completion notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "validationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: false,
                                    },
                                });
                            }
                        });

                        // Remove the processed request from the queue and resolve
                        this.translationQueue.shift();
                        request.resolve(true);
                    } catch (error) {
                        debug(`Error processing validation for cell ${request.cellId}:`, error);

                        // Send validation error notification
                        this.webviewPanels.forEach((panel, docUri) => {
                            if (docUri === request.document.uri.toString()) {
                                this.postMessageToWebview(panel, {
                                    type: "validationInProgress" as any,
                                    content: {
                                        cellId: request.cellId,
                                        inProgress: false, // Mark as complete even on error
                                        error:
                                            error instanceof Error ? error.message : String(error),
                                    },
                                });
                            }
                        });

                        // Remove from queue and reject the promise
                        this.translationQueue.shift();
                        request.reject(error);
                    }
                    continue;
                }

                // Update the current cell being processed in the provider state
                if (this.autocompletionState.isProcessing) {
                    this.autocompletionState.currentCellId = request.cellId;
                    this.broadcastAutocompletionState();
                } else if (this.singleCellQueueState.isProcessing) {
                    this.singleCellQueueState.currentCellId = request.cellId;
                    this.broadcastSingleCellQueueState();
                } else {
                    this.startSingleCellTranslation(request.cellId);
                }

                try {
                    debug(`Processing translation for cell ${request.cellId}`);

                    // Check again for cancellation before starting LLM completion
                    if (this.autocompleteCancellation?.token.isCancellationRequested) {
                        debug("Autocomplete cancellation detected before LLM completion, rejecting request");
                        this.translationQueue.shift();
                        request.reject(new Error("Translation cancelled"));
                        continue;
                    }

                    // Start the actual translation process
                    const result = await this.performLLMCompletionInternal(
                        request.cellId,
                        request.document,
                        request.shouldUpdateValue
                    );

                    // Remove the processed request from the queue before resolving
                    this.translationQueue.shift();

                    // Update state and resolve the promise - ONLY for successful completions
                    this.markCellComplete(request.cellId);

                    // Send explicit success message to frontend
                    this.webviewPanels.forEach((panel) => {
                        this.postMessageToWebview(panel, {
                            type: "cellTranslationCompleted",
                            cellId: request.cellId,
                            success: true,
                        } as any);
                    });

                    // Send LLM completion response for single cell translations (non-batch)
                    if (!this.autocompletionState.isProcessing && this.singleCellQueueState.isProcessing) {
                        this.webviewPanels.forEach((panel) => {
                            this.postMessageToWebview(panel, {
                                type: "providerSendsLLMCompletionResponse",
                                content: {
                                    completion: result || "",
                                    cellId: request.cellId,
                                },
                            });
                        });
                    }

                    request.resolve(result);

                    // Process next item immediately without delay - both for individual and batch translations
                } catch (error) {
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    const isCancellationError = error instanceof vscode.CancellationError ||
                        (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'));
                    const isIntentionalCancellation = errorMessage.includes("Translation cancelled");

                    if (!isCancellationError && !isIntentionalCancellation) {
                        console.error(`[Translation] Error processing translation for cell ${request.cellId}:`, error);
                    }

                    // Remove the failed request from the queue before rejecting
                    this.translationQueue.shift();

                    // Send explicit cancellation/error message to frontend - DON'T mark as complete
                    this.webviewPanels.forEach((panel) => {
                        this.postMessageToWebview(panel, {
                            type: "cellTranslationCompleted",
                            cellId: request.cellId,
                            success: false,
                            cancelled: isCancellationError || isIntentionalCancellation,
                            error: !isCancellationError && !isIntentionalCancellation ? errorMessage : undefined,
                        } as any);
                    });

                    // Update single cell translation state for UI feedback
                    if (!this.autocompletionState.isProcessing) {
                        this.updateSingleCellTranslation(
                            0, error instanceof Error ? error.message : String(error)
                        );
                    }

                    request.reject(error);

                    // Process next item immediately without delay - both for individual and batch translations
                }
            }

            // After all translations are done and the queue is empty, trigger a reindex
            // but only if we're not in an autocompletion process (which will handle its own reindexing)
            // if (!this.autocompletionState.isProcessing) {
            //     debug("Translation queue empty, triggering reindexing");
            //     try {
            //         // We don't await this to avoid blocking the queue processing completion
            //         vscode.commands.executeCommand("codex-editor-extension.forceReindex");
            //     } catch (error) {
            //         console.error("Error triggering reindex after translations:", error);
            //     }
            // }
        } finally {
            this.isProcessingQueue = false;
            debug("Finished processing translation queue");
        }
    }

    // The internal implementation of LLM completion
    private async performLLMCompletionInternal(
        currentCellId: string,
        currentDocument: CodexCellDocument,
        shouldUpdateValue = false
    ) {
        // Prevent LLM completion on source files
        if (this.isSourceText(currentDocument?.uri)) {
            throw new Error("Cannot perform LLM completion on source files");
        }
        if (!currentDocument) {
            throw new Error("No document available for LLM completion");
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Generating Translation",
                cancellable: false,
            },
            async (progress) => {
                try {
                    // Check for cancellation at the start
                    if (this.autocompleteCancellation?.token.isCancellationRequested) {
                        throw new Error("Translation cancelled");
                    }

                    // Find the webview panel for this document
                    const webviewPanel = this.webviewPanels.get(currentDocument.uri.toString());

                    progress.report({
                        message: "Fetching completion configuration...",
                        increment: 20,
                    });

                    // Update progress in state
                    this.updateSingleCellTranslation(0.2);

                    // Check for cancellation before fetching config
                    if (this.autocompleteCancellation?.token.isCancellationRequested) {
                        throw new Error("Translation cancelled");
                    }

                    // Fetch completion configuration
                    const completionConfig = await fetchCompletionConfig();
                    const notebookReader = new CodexNotebookReader(currentDocument.uri);

                    progress.report({
                        message: "Generating translation with LLM...",
                        increment: 30,
                    });

                    // Update progress in state
                    this.updateSingleCellTranslation(0.5);

                    // Check for cancellation before starting LLM completion
                    if (this.autocompleteCancellation?.token.isCancellationRequested) {
                        throw new Error("Translation cancelled");
                    }

                    // Use the existing cancellation token if available, otherwise create a new one
                    const cancellationToken = this.autocompleteCancellation?.token ||
                        this.singleCellQueueCancellation?.token ||
                        new vscode.CancellationTokenSource().token;

                    // Perform LLM completion (always returns AB-style result)
                    const completionResult = await llmCompletion(
                        notebookReader,
                        currentCellId,
                        completionConfig,
                        cancellationToken
                    );

                    // Check for cancellation before updating document - this is crucial to prevent cell population
                    if (this.autocompleteCancellation?.token.isCancellationRequested ||
                        this.singleCellQueueCancellation?.token.isCancellationRequested) {
                        throw new Error("Translation cancelled");
                    }

                    // If multiple variants are present, send to the webview for selection
                    if (completionResult && Array.isArray((completionResult as any).variants) && (completionResult as any).variants.length > 1) {
                        const { variants, testId, testName, names } = completionResult as any;

                        // If variants are identical (ignoring whitespace), treat as single completion
                        try {
                            const normalize = (s: string) => (s || "").replace(/\s+/g, " ").trim();
                            const allIdentical = variants.every((v: string) => normalize(v) === normalize(variants[0]));
                            if (allIdentical) {
                                const singleCompletion = variants[0] ?? "";
                                progress.report({ message: "Updating document...", increment: 40 });
                                this.updateSingleCellTranslation(0.9);
                                currentDocument.updateCellContent(
                                    currentCellId,
                                    singleCompletion,
                                    EditType.LLM_GENERATION,
                                    shouldUpdateValue
                                );
                                this.updateSingleCellTranslation(1.0);
                                debug("LLM completion result (identical variants)", { completion: singleCompletion?.slice?.(0, 80) });
                                return singleCompletion;
                            }
                        } catch (e) {
                            debug("Error comparing variants for identity; proceeding with A/B UI", { error: e });
                        }

                        // Win rates are tracked in cloud analytics, not shown in UI

                        if (webviewPanel) {
                            const abProb = (vscode.workspace.getConfiguration("codex-editor-extension").get("abTestingProbability") as number) ?? 0;
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerSendsABTestVariants",
                                content: {
                                    variants,
                                    cellId: currentCellId,
                                    testId: testId || `${currentCellId}-${Date.now()}`,
                                    testName,
                                    names,
                                    abProbability: Math.max(0, Math.min(1, abProb)),
                                },
                            } as any);
                        }

                        // Mark single cell translation as complete so UI progress/spinners stop
                        this.updateSingleCellTranslation(1.0);

                        // Do not update the cell value now; the frontend will apply the chosen variant
                        // Return an empty string for consistency with callers expecting a string
                        debug("LLM completion A/B variants sent", { cellId: currentCellId, variantsCount: variants?.length });
                        return "";
                    }

                    // Otherwise, handle as a single completion using the first variant
                    const singleCompletion = (completionResult as any)?.variants?.[0] ?? "";

                    progress.report({ message: "Updating document...", increment: 40 });

                    // Update progress in state
                    this.updateSingleCellTranslation(0.9);

                    // Update content and metadata atomically - only if not cancelled
                    currentDocument.updateCellContent(
                        currentCellId,
                        singleCompletion,
                        EditType.LLM_GENERATION,
                        shouldUpdateValue
                    );

                    // If this was a preview-only update, persist the edit to disk immediately so edit history is saved
                    if (!shouldUpdateValue) {
                        try {
                            await this.saveCustomDocument(currentDocument, new vscode.CancellationTokenSource().token);
                        } catch (e) {
                            console.warn("Failed to auto-save preview edit; will remain dirty until manual save.", e);
                        }
                    }

                    // Update progress in state
                    this.updateSingleCellTranslation(1.0);

                    debug("LLM completion result", { completion: singleCompletion?.slice?.(0, 80) });
                    return singleCompletion;
                } catch (error: any) {
                    // Check if this is a cancellation error
                    if (error instanceof vscode.CancellationError ||
                        (error instanceof Error && (error.message.includes('Canceled') || error.name === 'AbortError'))) {
                        console.info(`[performLLMCompletionInternal] Translation cancelled for cell ${currentCellId}`);
                        throw error; // Re-throw cancellation errors without wrapping
                    }

                    console.error("Error in performLLMCompletionInternal:", error);
                    throw error;
                }
            }
        );
    }

    // Add a method to clear the translation queue
    public clearTranslationQueue(): void {
        debug("Clearing translation queue");

        // If there's a request currently being processed, let it finish
        if (this.translationQueue.length > 0) {
            const currentRequest = this.translationQueue[0]; // Keep the first request

            // Reject all queued requests except the current one
            for (let i = 1; i < this.translationQueue.length; i++) {
                const request = this.translationQueue[i];
                request.reject(new Error("Translation cancelled by user"));
            }

            // Reset the queue with just the current request
            this.translationQueue = currentRequest ? [currentRequest] : [];
        }
    }

    // Add a method to queue a validation
    public queueValidation(
        cellId: string,
        document: CodexCellDocument,
        shouldValidate: boolean,
        isPending: boolean
    ): void {
        debug(
            `Queueing validation for cell ${cellId}, validate: ${shouldValidate}, pending: ${isPending}`
        );

        // If setting to pending, add to the queue
        if (isPending) {
            this.pendingValidations.set(cellId, {
                cellId,
                document,
                shouldValidate,
            });
        } else {
            // If removing from pending, delete from the queue
            this.pendingValidations.delete(cellId);
        }

        // Notify webviews of pending validation status updates
        this.updatePendingValidationsUI();
    }

    // Method to check if there are pending validations
    public hasPendingValidations(): boolean {
        return this.pendingValidations.size > 0;
    }

    // Method to get count of pending validations
    public getPendingValidationsCount(): number {
        return this.pendingValidations.size;
    }

    // Method to update UI with pending validations status
    private updatePendingValidationsUI(): void {
        // Tell all webviews to update the apply validation button
        this.webviewPanels.forEach((panel) => {
            this.postMessageToWebview(panel, {
                type: "pendingValidationsUpdate" as any,
                content: {
                    count: this.pendingValidations.size,
                    hasPending: this.hasPendingValidations(),
                },
            });
        });
    }

    // Method to apply all pending validations
    public async applyPendingValidations(): Promise<void> {
        debug(`Applying ${this.pendingValidations.size} pending validations`);

        if (this.pendingValidations.size === 0) {
            return;
        }

        // Create a new cancellation token source for this batch
        const cancelTokenSource = new vscode.CancellationTokenSource();

        // Start progress indicator
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Applying validations",
                cancellable: true,
            },
            async (progress, token) => {
                // Link our cancellation token with the progress cancellation
                token.onCancellationRequested(() => {
                    cancelTokenSource.cancel();
                });

                // Convert pending validations to an array
                const validationsToProcess = Array.from(this.pendingValidations.values());
                const totalValidations = validationsToProcess.length;

                // Create a list of cell IDs to clear pending state
                const cellIdsToUpdate: string[] = validationsToProcess.map((v) => v.cellId);

                try {
                    // Group validations by document to avoid repeated saves
                    const validationsByDocument = new Map<
                        string,
                        {
                            document: CodexCellDocument;
                            validations: { cellId: string; shouldValidate: boolean; }[];
                        }
                    >();

                    // First group validations by document
                    validationsToProcess.forEach((validation) => {
                        const docUri = validation.document.uri.toString();
                        if (!validationsByDocument.has(docUri)) {
                            validationsByDocument.set(docUri, {
                                document: validation.document,
                                validations: [],
                            });
                        }
                        validationsByDocument.get(docUri)!.validations.push({
                            cellId: validation.cellId,
                            shouldValidate: validation.shouldValidate,
                        });
                    });

                    // Now process each document's validations
                    const allDocuments = Array.from(validationsByDocument.values());
                    let processedCount = 0;

                    for (const docEntry of allDocuments) {
                        const { document, validations } = docEntry;

                        // Process all validations for this document
                        for (const validation of validations) {
                            // Check if cancelled
                            if (cancelTokenSource.token.isCancellationRequested) {
                                debug("Validation batch was cancelled");
                                break;
                            }

                            processedCount++;

                            // Update progress
                            progress.report({
                                message: `Processing ${processedCount} of ${totalValidations}`,
                                increment: 100 / totalValidations,
                            });

                            // Process this validation but don't save document yet
                            // Just update the document in memory
                            try {
                                // Send validation in progress notification
                                this.webviewPanels.forEach((panel, docUri) => {
                                    if (docUri === document.uri.toString()) {
                                        this.postMessageToWebview(panel, {
                                            type: "validationInProgress" as any,
                                            content: {
                                                cellId: validation.cellId,
                                                inProgress: true,
                                            },
                                        });
                                    }
                                });

                                // Process validation but don't save
                                await document.validateCellContent(
                                    validation.cellId,
                                    validation.shouldValidate
                                );

                                // Get validated entries for UI update
                                const validatedEntries = document.getCellValidatedBy(
                                    validation.cellId
                                );

                                // Update UI with validation result
                                this.webviewPanels.forEach((panel, docUri) => {
                                    if (docUri === document.uri.toString()) {
                                        // Send validation complete notification
                                        this.postMessageToWebview(panel, {
                                            type: "validationInProgress" as any,
                                            content: {
                                                cellId: validation.cellId,
                                                inProgress: false,
                                            },
                                        });

                                        // Send validation state update
                                        this.postMessageToWebview(panel, {
                                            type: "providerUpdatesValidationState" as any,
                                            content: {
                                                cellId: validation.cellId,
                                                validatedBy: validatedEntries,
                                            },
                                        });

                                        // Also send audio validation state update for consistency
                                        const audioValidatedEntries = document.getCellAudioValidatedBy(
                                            validation.cellId
                                        );
                                        if (audioValidatedEntries && audioValidatedEntries.length > 0) {
                                            this.postMessageToWebview(panel, {
                                                type: "providerUpdatesAudioValidationState" as any,
                                                content: {
                                                    cellId: validation.cellId,
                                                    validatedBy: audioValidatedEntries,
                                                },
                                            });
                                        }
                                    }
                                });
                            } catch (error) {
                                debug(
                                    `Error processing validation for cell ${validation.cellId}:`,
                                    error
                                );

                                // Send validation error notification
                                this.webviewPanels.forEach((panel, docUri) => {
                                    if (docUri === document.uri.toString()) {
                                        this.postMessageToWebview(panel, {
                                            type: "validationInProgress" as any,
                                            content: {
                                                cellId: validation.cellId,
                                                inProgress: false,
                                                error:
                                                    error instanceof Error
                                                        ? error.message
                                                        : String(error),
                                            },
                                        });
                                    }
                                });
                            }
                        }

                        // After processing all validations for this document, save it once
                        if (!cancelTokenSource.token.isCancellationRequested && document.isDirty) {
                            debug(
                                `Saving document ${document.uri.toString()} after batch validation`
                            );
                            await document.save(new vscode.CancellationTokenSource().token);
                        }
                    }

                    // Only clear the pending validations after all have been processed
                    if (!cancelTokenSource.token.isCancellationRequested) {
                        // Clear all pending validations
                        this.pendingValidations.clear();

                        // Notify webviews that pending state should be cleared
                        this.webviewPanels.forEach((panel) => {
                            this.postMessageToWebview(panel, {
                                type: "pendingValidationCleared" as any,
                                content: {
                                    cellIds: cellIdsToUpdate,
                                },
                            });

                            // Also send a specific message to indicate validation application is complete
                            this.postMessageToWebview(panel, {
                                type: "validationsApplied" as any,
                            });
                        });

                        // Update UI
                        this.updatePendingValidationsUI();

                        // Show success notification
                        vscode.window.showInformationMessage(
                            `Successfully processed ${totalValidations} validations`
                        );
                    } else {
                        // If the operation was cancelled, also notify webviews
                        this.webviewPanels.forEach((panel) => {
                            this.postMessageToWebview(panel, {
                                type: "validationsApplied" as any,
                            });
                        });
                    }
                } catch (error) {
                    debug("Error applying validations batch:", error);
                    vscode.window.showErrorMessage(
                        `Error applying validations: ${error instanceof Error ? error.message : String(error)}`
                    );

                    // Notify webviews of completion even on error
                    this.webviewPanels.forEach((panel) => {
                        this.postMessageToWebview(panel, {
                            type: "validationsApplied" as any,
                        });
                    });
                } finally {
                    cancelTokenSource.dispose();
                }
            }
        );
    }

    // Add method to enqueue a validation
    public enqueueValidation(
        cellId: string,
        document: CodexCellDocument,
        shouldValidate: boolean
    ): Promise<any> {
        debug(`Enqueueing validation for cell ${cellId}, validate: ${shouldValidate}`);

        // Create a new promise for this request
        return new Promise((resolve, reject) => {
            // Add the request to the queue with a special validation type
            this.translationQueue.push({
                cellId,
                document,
                shouldUpdateValue: false,
                validationRequest: true, // Flag to identify validation requests
                shouldValidate,
                resolve,
                reject,
            });

            // Start processing the queue if it's not already in progress
            if (!this.isProcessingQueue) {
                this.processTranslationQueue();
            }
        });
    }

    // Add method to enqueue a validation
    public enqueueAudioValidation(
        cellId: string,
        document: CodexCellDocument,
        shouldValidate: boolean
    ): Promise<any> {
        debug(`Enqueueing audio validation for cell ${cellId}, validate: ${shouldValidate}`);

        // Create a new promise for this request
        return new Promise((resolve, reject) => {
            // Add the request to the queue with a special validation type
            this.translationQueue.push({
                cellId,
                document,
                shouldUpdateValue: false,
                audioValidationRequest: true, // Flag to identify validation requests
                shouldValidate,
                resolve,
                reject,
            });

            // Start processing the queue if it's not already in progress
            if (!this.isProcessingQueue) {
                this.processTranslationQueue();
            }
        });
    }

    // Add a method to clear all pending validations without applying them
    public clearPendingValidations(): void {
        debug(`Clearing ${this.pendingValidations.size} pending validations without applying them`);

        if (this.pendingValidations.size === 0) {
            return;
        }

        // Get a list of cell IDs that have pending validations
        const cellIdsToUpdate: string[] = Array.from(this.pendingValidations.values()).map(
            (v) => v.cellId
        );

        // Clear the pending validations map
        this.pendingValidations.clear();

        // Notify webviews that pending state should be cleared
        this.webviewPanels.forEach((panel) => {
            this.postMessageToWebview(panel, {
                type: "pendingValidationCleared" as any,
                content: {
                    cellIds: cellIdsToUpdate,
                },
            });
        });

        // Update UI
        this.updatePendingValidationsUI();

        // Show info notification
        vscode.window.showInformationMessage("Pending validations cleared");
    }

    // Add a method to expose webviewPanels in a controlled way
    public getWebviewPanels(): Map<string, vscode.WebviewPanel> {
        return this.webviewPanels;
    }

    // Add method to load bible book map
    private async loadBibleBookMap(document: CodexCellDocument): Promise<void> {
        debug("Loading bible book map");
        const bookData: any[] = bibleData; // Use bundled defaults only; display names come from metadata

        // Create the map
        this.bibleBookMap = new Map<string, { name: string;[key: string]: any; }>();
        bookData.forEach((book) => {
            if (book.abbr) {
                // Ensure abbreviation exists
                this.bibleBookMap?.set(book.abbr, book);
            }
        });
        debug("Bible book map created with size:", this.bibleBookMap.size);
    }

    /**
     * Updates the file status and broadcasts it to all webviews
     * @param status The file status to update to
     */
    public updateFileStatus(status?: "dirty" | "syncing" | "synced" | "none") {
        // Find all webview panels associated with the current document
        if (this.currentDocument) {
            const docUri = this.currentDocument.uri;
            const panel = this.webviewPanels.get(docUri.toString());

            if (panel) {
                // If status is provided, use it directly (for explicit status updates)
                if (status) {
                    this.postMessageToWebview(panel, {
                        type: "updateFileStatus",
                        status,
                    });
                    return;
                }

                // Otherwise, determine status from document state
                try {
                    // Check if the document is dirty in the editor
                    const isDirty = this.currentDocument.isDirty || vscode.workspace.textDocuments.some(
                        (doc) => doc.uri.toString() === docUri.toString() && doc.isDirty
                    );

                    const determinedStatus = isDirty ? "dirty" : "synced";

                    this.postMessageToWebview(panel, {
                        type: "updateFileStatus",
                        status: determinedStatus,
                    });
                } catch (error) {
                    console.error("Error determining file status:", error);
                    // Don't update status on error to prevent potential loops
                }
            }
        }
    }

    /**
     * Triggers an immediate sync of the current document
     */
    public triggerSync(): void {
        if (this.currentDocument) {
            try {
                // Set status to syncing
                this.updateFileStatus("syncing");

                // Get the SyncManager singleton
                const syncManager = SyncManager.getInstance();

                // Get the filename for the commit message
                const fileName = this.currentDocument.uri.path.split("/").pop() || "document";

                // Execute sync immediately rather than scheduling
                syncManager
                    .executeSync(`manual sync for ${fileName}`, true, undefined, true)
                    .then(() => {
                        // FIXED: Don't automatically call updateFileStatus here
                        // Let the sync completion handle status updates
                        debug("Manual sync completed for:", fileName);
                    })
                    .catch((error) => {
                        console.error("Error during manual sync:", error);
                        // Only update to dirty on actual error
                        this.updateFileStatus("dirty");
                    });
            } catch (error) {
                console.error("Error triggering sync:", error);
                this.updateFileStatus("dirty");
            }
        }
    }

    /**
     * Toggles the correction editor mode and notifies all webviews
     */
    public async toggleCorrectionEditorMode(): Promise<void> {
        this.isCorrectionEditorMode = !this.isCorrectionEditorMode;
        debug("Correction editor mode toggled:", this.isCorrectionEditorMode);

        // Removed bulk preservation of original content to avoid mass edits on toggle

        // Broadcast the change to all webviews
        this.webviewPanels.forEach((panel) => {
            this.postMessageToWebview(panel, {
                type: "correctionEditorModeChanged",
                enabled: this.isCorrectionEditorMode,
            });
        });

        // Refresh all webviews to show/hide merged cells appropriately
        for (const [docUri, panel] of this.webviewPanels) {
            if (this.currentDocument && docUri === this.currentDocument.uri.toString()) {
                await this.refreshWebview(panel, this.currentDocument);
            }
        }
    }

    /**
     * Preserves original content in edit history for cells that don't have any edits
     * This ensures that when users start editing in correction mode, the original content is preserved
     */
    private preserveOriginalContentInEditHistory(): void {
        // Intentionally no-op: original bulk initializer removed to prevent mass edits.
        return;
    }

    /**
     * Checks if there are any child cells in the target file for the specified parent cell IDs
     * @param parentCellIds Array of parent cell IDs to check for children
     * @param workspaceFolder The workspace folder to look in
     * @returns Promise<string[]> Array of child cell IDs found, empty if none
     */
    public async checkForChildCellsInTarget(parentCellIds: string[], workspaceFolder: vscode.WorkspaceFolder): Promise<string[]> {
        debug("Checking for child cells in target file:", { parentCellIds });

        try {
            // Get the current document info to construct target path
            if (!this.currentDocument) {
                throw new Error("No current document available");
            }

            const normalizedPath = this.currentDocument.uri.toString().replace(/\\/g, "/");
            const baseFileName = path.basename(normalizedPath);

            // Source file -> Target file
            const targetFileName = baseFileName.replace(".source", ".codex");
            const targetPath = vscode.Uri.joinPath(workspaceFolder.uri, "files", "target", targetFileName);

            // Try to open or find the target document
            let targetDocument: CodexCellDocument | undefined;

            // Check if target document is already open
            const targetDocumentUri = targetPath.toString();
            for (const [panelUri, panel] of this.webviewPanels.entries()) {
                if (this.isMatchingFilePair(targetDocumentUri, panelUri)) {
                    targetDocument = await this.openCustomDocument(
                        vscode.Uri.parse(panelUri),
                        {},
                        new vscode.CancellationTokenSource().token
                    );
                    break;
                }
            }

            if (!targetDocument) {
                // Try to create a document instance
                try {
                    targetDocument = await this.openCustomDocument(
                        targetPath,
                        {},
                        new vscode.CancellationTokenSource().token
                    );
                } catch (error) {
                    // Target file might not exist yet
                    debug("Target file not found, no child cells to check");
                    return [];
                }
            }

            // Get all cell IDs from the target document
            const allTargetCellIds = targetDocument.getAllCellIds();
            const childCellIds: string[] = [];

            // Check each cell ID to see if it's a child of any parent cell
            for (const cellId of allTargetCellIds) {
                const cellIdParts = cellId.split(":");

                // Child cells have more than 2 segments
                if (cellIdParts.length > 2) {
                    // Get the parent ID (first 2 segments)
                    const parentId = cellIdParts.slice(0, 2).join(":");

                    // Check if this parent ID is in our list of cells being merged
                    if (parentCellIds.includes(parentId)) {
                        childCellIds.push(cellId);
                    }
                }
            }

            debug(`Found ${childCellIds.length} child cells in target:`, childCellIds);
            return childCellIds;

        } catch (error) {
            console.error("Error checking for child cells in target:", error);
            // Return empty array on error - safer to proceed than block
            return [];
        }
    }

    /**
     * Refreshes audio attachments for all open webviews after sync operations.
     * This ensures that audio availability is updated even if file watchers didn't trigger during sync.
     */
    public async refreshAudioAttachmentsAfterSync(): Promise<void> {
        debug("Refreshing audio attachments after sync for all webviews");

        for (const [documentUri, webviewPanel] of this.webviewPanels.entries()) {
            try {
                // Get the document from the workspace
                const uri = vscode.Uri.parse(documentUri);
                const document = await vscode.workspace.openTextDocument(uri) as any;
                if (!document || !webviewPanel) continue;

                // Get all cells with audio attachments
                const documentText = document.getText();
                if (documentText.trim().length === 0) continue;

                let notebookData: any = {};
                try {
                    notebookData = JSON.parse(documentText);
                } catch {
                    debug("Could not parse document for audio refresh:", documentUri);
                    continue;
                }

                const cells = Array.isArray(notebookData?.cells) ? notebookData.cells : [];
                const availability: { [cellId: string]: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none"; } = {};

                // Check audio availability for all cells
                for (const cell of cells) {
                    const cellId = cell?.metadata?.id;
                    if (!cellId) continue;

                    let hasAvailable = false; let hasAvailablePointer = false;
                    let hasMissing = false;
                    let hasDeleted = false;
                    const atts = cell?.metadata?.attachments || {};

                    for (const key of Object.keys(atts)) {
                        const att: any = atts[key];
                        if (att && att.type === "audio") {
                            if (att.isDeleted) hasDeleted = true;
                            else if (att.isMissing) hasMissing = true;
                            else {
                                try {
                                    const ws = vscode.workspace.getWorkspaceFolder(document.uri);
                                    const url = String(att.url || "");
                                    if (ws && url) {
                                        const filesRel = url.startsWith(".project/") ? url : url.replace(/^\.?\/?/, "");
                                        const abs = path.join(ws.uri.fsPath, filesRel);
                                        const { isPointerFile } = await import("../../utils/lfsHelpers");
                                        const res = await isPointerFile(abs).catch(() => false);
                                        if (res) hasAvailablePointer = true; else hasAvailable = true;
                                    } else {
                                        hasAvailable = true;
                                    }
                                } catch {
                                    hasAvailable = true;
                                }
                            }
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

                // Send updated audio attachments to webview
                if (Object.keys(availability).length > 0) {
                    safePostMessageToPanel(webviewPanel, {
                        type: "providerSendsAudioAttachments",
                        attachments: availability
                    });

                    debug(`Refreshed audio attachments for ${Object.keys(availability).length} cells in ${documentUri}`);
                }

            } catch (error) {
                console.error("Error refreshing audio attachments for document:", documentUri, error);
            }
        }

        debug("Completed audio attachment refresh after sync");
    }

    public async updateCellContentDirect(
        uri: string,
        cellId: string,
        newContent: string,
        retainValidations = false
    ): Promise<boolean> {
        try {
            const documentUri = vscode.Uri.parse(uri);

            // Use document model for proper undo support
            // Open/get the document instance (VS Code manages lifecycle)
            const document = await this.openCustomDocument(
                documentUri,
                {},
                new vscode.CancellationTokenSource().token
            );

            // Verify cell exists in document
            const existingCell = document.getCellContent(cellId);
            if (!existingCell) {
                console.warn(`Cell ${cellId} not found in document ${uri}`);
                return false;
            }

            // Ensure author is set correctly before creating edit
            await document.refreshAuthor();

            // Use document's updateCellContent method which properly tracks changes for undo
            // This marks the document dirty and fires change events that VS Code tracks
            // For search/replace operations, always skip auto-validation (validation is handled by retainValidations logic)
            await document.updateCellContent(cellId, newContent, EditType.USER_EDIT, true, retainValidations, true);

            // Fire custom document change event so VS Code can track for undo/redo
            this._onDidChangeCustomDocument.fire({ document });

            // Save the document (VS Code will auto-save, but we ensure it's saved for immediate persistence)
            // Use a cancellation token that won't cancel immediately
            const cancellationToken = new vscode.CancellationTokenSource().token;
            await this.saveCustomDocument(document, cancellationToken);

            // Refresh webview if open
            const webviewPanel = this.webviewPanels.get(documentUri.toString());
            if (webviewPanel) {
                await this.refreshWebview(webviewPanel, document);
            }

            return true;
        } catch (error) {
            console.error("Error updating cell content:", error);
            return false;
        }
    }
}
