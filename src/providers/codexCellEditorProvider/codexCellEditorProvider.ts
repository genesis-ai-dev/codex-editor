import * as vscode from "vscode";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";
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
} from "../../../types";
import { CodexCellDocument } from "./codexDocument";
import {
    handleGlobalMessage,
    handleMessages,
    performLLMCompletion,
} from "./codexCellEditorMessagehandling";
import { GlobalProvider } from "../../globalProvider";
import { getAuthApi } from "@/extension";
import { initializeStateStore } from "../../stateStore";
import { SyncManager } from "../../projectManager/syncManager";

import bibleData from "../../../webviews/codex-webviews/src/assets/bible-books-lookup.json";

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
    updateStoreState: (update: { key: "cellId"; value: CellIdGlobalState }) => void;
}

function getNonce(): string {
    debug("Generating nonce");
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    debug("Generated nonce:", text);
    return text;
}

export class CodexCellEditorProvider implements vscode.CustomEditorProvider<CodexCellDocument> {
    public currentDocument: CodexCellDocument | undefined;
    private webviewPanels: Map<string, vscode.WebviewPanel> = new Map();
    private userInfo: { username: string; email: string } | undefined;
    private stateStore: StateStore | undefined;
    private stateStoreListener: (() => void) | undefined;
    private commitTimer: NodeJS.Timeout | number | undefined;
    private autocompleteCancellation: vscode.CancellationTokenSource | undefined;

    // Translation queue system
    private translationQueue: {
        cellId: string;
        document: CodexCellDocument;
        shouldUpdateValue: boolean;
        validationRequest?: boolean;
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

    // Single cell translation state
    public singleCellTranslationState: {
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    } = {
        isProcessing: false,
        cellId: undefined,
        progress: 0,
    };

    // private readonly COMMIT_DELAY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
    private readonly COMMIT_DELAY_MS = 5 * 1000; // 5 seconds in milliseconds

    // Add a property to track pending validations
    private pendingValidations: Map<
        string,
        { cellId: string; document: CodexCellDocument; shouldValidate: boolean }
    > = new Map();

    // Class property to track if we've registered the command already
    public syncChapterCommandRegistered = false;

    // Add bibleBookMap state to the provider
    private bibleBookMap: Map<string, { name: string; [key: string]: any }> | undefined;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
        debug("Registering CodexCellEditorProvider");
        const provider = new CodexCellEditorProvider(context);
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
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("codex-project-manager.validationCount")) {
                // Notify all webviews about the configuration change
                this.webviewPanels.forEach((panel) => {
                    this.postMessageToWebview(panel, {
                        type: "configurationChanged",
                    });
                });

                // Force a refresh of validation state for all open documents
                this.refreshValidationStateForAllDocuments();
            }
        });

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
                                    panel.webview.postMessage({
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
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<CodexCellDocument> {
        debug("Opening custom document:", uri.toString());
        const document = await CodexCellDocument.create(uri, openContext.backupId, _token);
        debug("Document created successfully");
        return document;
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
        webviewPanel.onDidChangeViewState((e) => {
            debug("Webview panel state changed, active:", e.webviewPanel.active);
            if (e.webviewPanel.active) {
                // Only update references without refreshing
                this.currentDocument = document;
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

        // Enable scripts in the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Get text direction and check if it's a source file
        const textDirection = this.getTextDirection(document);
        const isSourceText = this.isSourceText(document.uri);
        debug("Text direction:", textDirection, "Is source text:", isSourceText);

        // Load bible book map
        await this.loadBibleBookMap(document);

        // Set up the HTML content for the webview
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            textDirection,
            isSourceText
        );

        // Send initial bible book map to webview
        if (this.bibleBookMap) {
            this.postMessageToWebview(webviewPanel, {
                type: "setBibleBookMap" as any, // Use type assertion for custom message
                data: Array.from(this.bibleBookMap.entries()),
            });
        }

        // Set up file system watcher
        const watcher = vscode.workspace.createFileSystemWatcher(
            new vscode.RelativePattern(
                vscode.workspace.getWorkspaceFolder(document.uri)!,
                vscode.workspace.asRelativePath(document.uri)
            )
        );

        // Watch for file changes
        watcher.onDidChange((uri) => {
            debug("File change detected:", uri.toString());
            if (uri.toString() === document.uri.toString()) {
                if (!document.isDirty) {
                    debug("Document not dirty, reverting");
                    document.revert(); // Reload the document if it isn't dirty
                }
            }
        });

        // Create update function
        const updateWebview = () => {
            debug("Updating webview");
            const notebookData: vscode.NotebookData = this.getDocumentAsJson(document);
            const processedData = this.processNotebookData(notebookData);

            this.postMessageToWebview(webviewPanel, {
                type: "providerSendsInitialContent",
                content: processedData,
                isSourceText: isSourceText,
                sourceCellMap: document._sourceCellMap,
            });
        };

        // Set up navigation functions
        const navigateToSection = (cellId: string) => {
            debug("Navigating to section:", cellId);
            webviewPanel.webview.postMessage({
                type: "jumpToSection",
                content: cellId,
            });
        };
        const openCellByIdImpl = (cellId: string, text: string) => {
            debug("Opening cell by ID:", cellId, text);
            webviewPanel.webview.postMessage({
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
                            panel.webview.postMessage(validationUpdate);
                        }
                    });

                    // Still update the current webview with the full content
                    updateWebview();
                } else {
                    // For non-validation updates, just update the webview as normal
                    updateWebview();
                }

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
            // Dispose of the state store listener
            if (this.stateStoreListener) {
                this.stateStoreListener();
                this.stateStoreListener = undefined;
            }
            this.webviewPanels.delete(document.uri.toString());
            jumpToCellListenerDispose();
            listeners.forEach((l) => l.dispose());
            watcher.dispose();
        });

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (e: EditorPostMessages | GlobalMessage) => {
            debug("Received message from webview:", e);
            if ("destination" in e) {
                debug("Handling global message");
                GlobalProvider.getInstance().handleMessage(e as GlobalMessage);
                handleGlobalMessage(this, e as GlobalMessage);
                return;
            }
            handleMessages(e, webviewPanel, document, updateWebview, this);
        });

        // Initial update
        debug("Performing initial webview update");
        updateWebview();

        // Watch for configuration changes
        const configListenerDisposable = vscode.workspace.onDidChangeConfiguration((e) => {
            debug("Configuration changed");
            if (e.affectsConfiguration("translators-copilot.textDirection")) {
                debug("Text direction configuration changed");
                this.updateTextDirection(webviewPanel, document);
            }
        });
        listeners.push(configListenerDisposable);
    }

    public async receiveMessage(message: any, updateWebview?: () => void) {
        debug("Cell Provider received message:", message);
        // NOTE: do not use this method to handled messages within the provider. This has access to the global context and can get crossed with other providers
        // Find the active panel
        const activePanel = Array.from(this.webviewPanels.values()).find((panel) => panel.active);
        if (!activePanel || !this.currentDocument) {
            debug("No active panel or currentDocument is not initialized");
            return;
        }

        if ("destination" in message) {
            debug("Global message detected");
            handleGlobalMessage(this, message as GlobalMessage);
            return;
        }
        handleMessages(
            message as EditorPostMessages,
            activePanel,
            this.currentDocument,
            updateWebview ?? (() => {}),
            this
        );
    }

    private async executeGitCommit(document: CodexCellDocument): Promise<void> {
        debug("Executing git commit for:", document.uri.toString());
        // Use the SyncManager for immediate sync
        const syncManager = SyncManager.getInstance();
        await syncManager.executeSync(
            `changes to ${vscode.workspace.asRelativePath(document.uri).split(/[/\\]/).pop()}`
        );
    }
    public postMessage(message: GlobalMessage) {
        debug("Posting message:", message);
        if (this.webviewPanels.size > 0) {
            this.webviewPanels.forEach((panel) => panel.webview.postMessage(message));
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
        debug("Saving custom document:", document.uri.toString());

        try {
            // Set status to syncing
            this.updateFileStatus("syncing");

            // Save the document
            await document.save(cancellation);

            // Get the SyncManager singleton
            const syncManager = SyncManager.getInstance();

            // Schedule the sync operation
            const fileName = document.uri.path.split('/').pop() || "document";
            syncManager.scheduleSyncOperation(`changes to ${fileName}`);

            // Update the file status based on source control (will check if still dirty)
            setTimeout(() => this.updateFileStatus(), 500);
        } catch (error) {
            console.error("Error saving document:", error);
            // If save fails, check status
            this.updateFileStatus();
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
        const styleVSCodeUri = webview.asWebviewUri(
            vscode.Uri.joinPath(this.context.extensionUri, "src", "assets", "vscode.css")
        );
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this.context.extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );
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
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${
                    webview.cspSource
                } 'unsafe-inline'; script-src 'nonce-${nonce}' https://www.youtube.com; frame-src https://www.youtube.com; worker-src ${
                    webview.cspSource
                }; connect-src https://languagetool.org/api/; img-src ${
                    webview.cspSource
                } https:; font-src ${webview.cspSource}; media-src ${
                    webview.cspSource
                } https: blob:;">
                <link href="${styleResetUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${styleVSCodeUri}" rel="stylesheet" nonce="${nonce}">
                <link href="${codiconsUri}" rel="stylesheet" nonce="${nonce}" />
                <title>Codex Cell Editor</title>
                
                <script nonce="${nonce}">
                    window.initialData = {
                        isSourceText: ${isSourceText},
                        videoUrl: ${videoUri ? `"${videoUri}"` : "null"},
                        sourceCellMap: ${JSON.stringify(document._sourceCellMap)},
                        metadata: ${JSON.stringify(notebookData.metadata)},
                        userInfo: ${JSON.stringify(this.userInfo)},
                        cachedChapter: ${cachedChapter}
                    };
                </script>
            </head>
            <body>
                <div id="root"></div>
                <script nonce="${nonce}" src="${scriptUri}"></script>
                
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
        const path = typeof uri === 'string' ? uri : uri.path;
        return path.toLowerCase().endsWith(".source");
    }

    private isCodexFile(uri: vscode.Uri | string): boolean {
        const path = typeof uri === 'string' ? uri : uri.path;
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

            // Enqueue all cells for processing - they will be processed one by one
            for (const cell of cellsToProcess) {
                const cellId = cell.cellMarkers[0];
                if (!cellId) {
                    console.error("Cell ID is undefined, skipping cell");
                    continue;
                }

                // Add to the unified queue - no need to wait for completion here
                this.enqueueTranslation(cellId, document, true)
                    .then(() => {
                        // Cell has been processed successfully
                        // The queue processing will update progress automatically
                    })
                    .catch((error) => {
                        // Just log errors - the queue processing will update progress
                        console.error(`Error autocompleting cell ${cellId}:`, error);
                    });
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

                    // After a short delay, reset state
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
                    }, 1500);
                }
            };

            // Start monitoring
            checkQueueStatus();
        } finally {
            // Clean up cancellation token when method exits
            // Note: This doesn't mean processing is complete
            setTimeout(() => {
                if (this.autocompleteCancellation) {
                    this.autocompleteCancellation.dispose();
                    this.autocompleteCancellation = undefined;
                }
            }, 2000);
        }
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
            panel.webview.postMessage({
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

                // Keep the current processing cell if any
                const currentRequest = this.isProcessingQueue ? this.translationQueue[0] : null;

                // Filter out all batch requests except the current one
                const remainingRequests = this.translationQueue.filter((req, index) => {
                    // Keep the current request (first in queue) if it's actively processing
                    if (index === 0 && this.isProcessingQueue) {
                        return true;
                    }

                    // Reject all other batch requests
                    if (batchCellIds.includes(req.cellId)) {
                        req.reject(new Error("Translation cancelled"));
                        return false;
                    }

                    // Keep all non-batch requests
                    return true;
                });

                // Update the queue
                this.translationQueue = remainingRequests;
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

            return true;
        }
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

    // New method to update single cell translation progress
    public updateSingleCellTranslationProgress(progress: number): void {
        if (
            this.singleCellTranslationState.isProcessing &&
            this.singleCellTranslationState.cellId
        ) {
            this.singleCellTranslationState.progress = progress;
            this.broadcastSingleCellTranslationState();
        }
    }

    // New method to complete single cell translation
    public completeSingleCellTranslation(): void {
        if (this.singleCellTranslationState.isProcessing) {
            this.singleCellTranslationState = {
                isProcessing: false,
                cellId: undefined,
                progress: 0,
            };
            this.broadcastSingleCellTranslationState();
        }
    }

    // New method to handle single cell translation error
    public failSingleCellTranslation(errorMessage: string): void {
        const cellId = this.singleCellTranslationState.cellId;
        this.singleCellTranslationState = {
            isProcessing: false,
            cellId: undefined,
            progress: 0,
        };

        if (cellId) {
            // Notify webviews that the translation failed
            this.webviewPanels.forEach((panel) => {
                panel.webview.postMessage({
                    type: "singleCellTranslationFailed",
                    cellId,
                    error: errorMessage,
                });
            });
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
                    panel.webview.postMessage({
                        type: "singleCellTranslationStarted",
                        cellId,
                    });
                } else if (progress < 1) {
                    // In progress
                    panel.webview.postMessage({
                        type: "singleCellTranslationProgress",
                        cellId,
                        progress,
                    });
                } else {
                    // Completed
                    panel.webview.postMessage({
                        type: "singleCellTranslationCompleted",
                        cellId,
                    });
                }
            } else {
                // Not processing (completed/stopped)
                panel.webview.postMessage({
                    type: "singleCellTranslationCompleted",
                    cellId,
                });
            }
        });
    }

    private processNotebookData(notebook: vscode.NotebookData) {
        debug("Processing notebook data");
        const translationUnits: QuillCellContent[] = notebook.cells.map((cell) => ({
            cellMarkers: [cell.metadata?.id],
            cellContent: cell.value,
            cellType: cell.metadata?.type,
            editHistory: cell.metadata?.edits,
            timestamps: cell.metadata?.data, // FIXME: add strong types because this is where the timestamps are and it's not clear
            cellLabel: cell.metadata?.cellLabel,
        }));

        const processedData = this.mergeRangesAndProcess(translationUnits);
        debug("Notebook data processed");
        return processedData;
    }

    private mergeRangesAndProcess(translationUnits: QuillCellContent[]) {
        debug("Merging ranges and processing translation units");
        const translationUnitsWithMergedRanges: QuillCellContent[] = [];

        translationUnits.forEach((verse, index) => {
            const rangeMarker = "<range>";
            if (verse.cellContent?.trim() === rangeMarker) {
                return;
            }

            let forwardIndex = 1;
            const cellMarkers = [...verse.cellMarkers];
            let nextCell = translationUnits[index + forwardIndex];

            while (nextCell?.cellContent?.trim() === rangeMarker) {
                cellMarkers.push(...nextCell.cellMarkers);
                forwardIndex++;
                nextCell = translationUnits[index + forwardIndex];
            }
            // Check if cell content is an empty span and convert to empty string
            const processedCellContent =
                verse.cellContent?.trim() === "<span></span>" ? "" : verse.cellContent;

            translationUnitsWithMergedRanges.push({
                cellMarkers,
                cellContent: processedCellContent,
                cellType: verse.cellType,
                editHistory: verse.editHistory,
                timestamps: verse.timestamps,
                cellLabel: verse.cellLabel,
            });
        });

        debug("Range merging completed");
        return translationUnitsWithMergedRanges;
    }

    public postMessageToWebview(webviewPanel: vscode.WebviewPanel, message: EditorReceiveMessages) {
        debug("Posting message to webview:", message.type);
        webviewPanel.webview.postMessage(message);
    }

    public refreshWebview(webviewPanel: vscode.WebviewPanel, document: CodexCellDocument) {
        debug("Refreshing webview");
        const notebookData = this.getDocumentAsJson(document);
        const processedData = this.processNotebookData(notebookData);
        const isSourceText = this.isSourceText(document.uri);
        const videoUrl = this.getVideoUrl(notebookData.metadata?.videoUrl, webviewPanel);

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            this.getTextDirection(document),
            isSourceText
        );

        this.postMessageToWebview(webviewPanel, {
            type: "providerSendsInitialContent",
            content: processedData,
            isSourceText: isSourceText,
            sourceCellMap: document._sourceCellMap,
        });

        this.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesNotebookMetadataForWebview",
            content: notebookData.metadata,
        });

        if (videoUrl) {
            this.postMessageToWebview(webviewPanel, {
                type: "updateVideoUrlInWebview",
                content: videoUrl,
            });
        }
        debug("Webview refresh completed");
    }

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
        if (cellId && uri) {
            // Only send highlight messages to source files when a codex file is active
            const valueIsCodexFile = this.isCodexFile(uri);
            if (valueIsCodexFile) {
                debug("Processing codex file highlight");
                for (const [panelUri, panel] of this.webviewPanels.entries()) {
                    const isSourceFile = this.isSourceText(panelUri);
                    debug("Sending highlight message to source file:", panelUri, "cellId:", cellId);
                    if (isSourceFile) {
                        panel.webview.postMessage({
                            type: "highlightCell",
                            cellId: cellId,
                        });
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
        const validationCount = config.get("validationCount", 1);

        // For each document URI in the webview panels map
        this.webviewPanels.forEach((panel, docUri) => {
            // Skip if already processed
            if (processedDocuments.has(docUri)) return;
            processedDocuments.add(docUri);

            // Send the current validation count to each panel
            this.postMessageToWebview(panel, {
                type: "validationCount",
                content: validationCount,
            });

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

                        // Only send updates for cells that have validations
                        if (validatedBy && validatedBy.length > 0) {
                            // Post validation state update to all panels for this document
                            this.webviewPanels.forEach((webviewPanel, panelUri) => {
                                if (panelUri === docUri) {
                                    // Use type assertion to allow sending the validation state message
                                    this.postMessageToWebview(webviewPanel, {
                                        type: "providerUpdatesValidationState" as any,
                                        content: {
                                            cellId,
                                            validatedBy,
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

        // Send to all webviews
        this.webviewPanels.forEach((panel) => {
            this.postMessageToWebview(panel, {
                type: "validationCount",
                content: validationCount,
            });
        });

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
            this.updateSingleCellTranslationProgress(1.0);

            // Use a short timeout to reset the state after completion
            setTimeout(() => this.completeSingleCellTranslation(), 1500);
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
                const request = this.translationQueue[0];

                // Handle validation request first if that's what it is
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
                } else {
                    this.startSingleCellTranslation(request.cellId);
                }

                try {
                    debug(`Processing translation for cell ${request.cellId}`);

                    // Start the actual translation process
                    const result = await this.performLLMCompletionInternal(
                        request.cellId,
                        request.document,
                        request.shouldUpdateValue
                    );

                    // Remove the processed request from the queue before resolving
                    this.translationQueue.shift();

                    // Update state and resolve the promise
                    this.markCellComplete(request.cellId);

                    request.resolve(result);

                    // Process next item immediately without delay - both for individual and batch translations
                } catch (error) {
                    debug(`Error processing translation for cell ${request.cellId}:`, error);

                    // Remove the failed request from the queue before rejecting
                    this.translationQueue.shift();

                    // Update state and reject the promise
                    this.markCellComplete(request.cellId);
                    if (!this.autocompletionState.isProcessing) {
                        this.failSingleCellTranslation(
                            error instanceof Error ? error.message : String(error)
                        );
                    }

                    request.reject(error);

                    // Process next item immediately without delay - both for individual and batch translations
                }
            }
            
            // After all translations are done and the queue is empty, trigger a reindex
            // but only if we're not in an autocompletion process (which will handle its own reindexing)
            if (!this.autocompletionState.isProcessing) {
                debug("Translation queue empty, triggering reindexing");
                try {
                    // We don't await this to avoid blocking the queue processing completion
                    vscode.commands.executeCommand("translators-copilot.forceReindex");
                } catch (error) {
                    console.error("Error triggering reindex after translations:", error);
                }
            }
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
                    // Find the webview panel for this document
                    const webviewPanel = this.webviewPanels.get(currentDocument.uri.toString());

                    progress.report({
                        message: "Fetching completion configuration...",
                        increment: 20,
                    });

                    // Update progress in state
                    this.updateSingleCellTranslationProgress(0.2);

                    // Fetch completion configuration
                    const completionConfig = await fetchCompletionConfig();
                    const notebookReader = new CodexNotebookReader(currentDocument.uri);

                    progress.report({
                        message: "Generating translation with LLM...",
                        increment: 30,
                    });

                    // Update progress in state
                    this.updateSingleCellTranslationProgress(0.5);

                    // Perform LLM completion
                    const result = await llmCompletion(
                        notebookReader,
                        currentCellId,
                        completionConfig,
                        new vscode.CancellationTokenSource().token
                    );

                    progress.report({ message: "Updating document...", increment: 40 });

                    // Update progress in state
                    this.updateSingleCellTranslationProgress(0.9);

                    // Update content and metadata atomically
                    currentDocument.updateCellContent(
                        currentCellId,
                        result,
                        EditType.LLM_GENERATION,
                        shouldUpdateValue
                    );

                    // Update progress in state
                    this.updateSingleCellTranslationProgress(1.0);

                    debug("LLM completion result", { result });
                    return result;
                } catch (error: any) {
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
                            validations: { cellId: string; shouldValidate: boolean }[];
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
        let bookData: any[] = bibleData; // Default data
        try {
            const workspaceFolder = vscode.workspace.getWorkspaceFolder(document.uri);
            if (workspaceFolder) {
                const localizedPath = vscode.Uri.joinPath(workspaceFolder.uri, "localized-books.json");
                try {
                    await vscode.workspace.fs.stat(localizedPath);
                    console.log("Navigation: Found localized-books.json, loading...");
                    const content = await vscode.workspace.fs.readFile(localizedPath);
                    const raw = new TextDecoder().decode(content);
                    bookData = JSON.parse(raw);
                    console.log("Navigation: Localized books loaded successfully");
                } catch (err) {
                    // File doesn't exist, use default data
                    console.log("Navigation: Using default bible book data");
                }
            }
        } catch (err) {
            console.error("Error loading localized-books.json:", err);
            // Fallback to default if error occurs
            bookData = bibleData;
        }

        // Create the map
        this.bibleBookMap = new Map<string, { name: string; [key: string]: any }>();
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

                // Otherwise, determine status from VS Code's source control
                try {
                    const scm = vscode.scm.createSourceControl("git", "Git");
                    const gitExt = vscode.extensions.getExtension("vscode.git")?.exports;

                    if (gitExt) {
                        // Get the repository that contains this file
                        const api = gitExt.getAPI(1);
                        const repos = api.repositories;

                        if (repos.length > 0) {
                            // Find the repository that contains this file
                            const repo = repos.find((r: any) =>
                                docUri.toString().startsWith(r.rootUri.toString())
                            );

                            if (repo) {
                                // Check if the file is dirty in the source control
                                const fileStatus = repo.state.workingTreeChanges.find(
                                    (change: any) => change.uri.toString() === docUri.toString()
                                );

                                if (fileStatus) {
                                    // The file has uncommitted changes
                                    this.postMessageToWebview(panel, {
                                        type: "updateFileStatus",
                                        status: "dirty",
                                    });
                                } else {
                                    // The file is in sync with the repository
                                    this.postMessageToWebview(panel, {
                                        type: "updateFileStatus",
                                        status: "synced",
                                    });
                                }
                                return;
                            }
                        }
                    }

                    // Default to checking if the document is dirty in the editor
                    const isDirty = vscode.workspace.textDocuments.some(
                        (doc) => doc.uri.toString() === docUri.toString() && doc.isDirty
                    );

                    this.postMessageToWebview(panel, {
                        type: "updateFileStatus",
                        status: isDirty ? "dirty" : "synced",
                    });
                } catch (error) {
                    console.error("Error determining file status:", error);
                    // In case of error, don't update the status
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
                const fileName = this.currentDocument.uri.path.split('/').pop() || "document";

                // Execute sync immediately rather than scheduling
                syncManager
                    .executeSync(`manual sync for ${fileName}`)
                    .then(() => {
                        // Update status after sync completes
                        setTimeout(() => this.updateFileStatus(), 500);
                    })
                    .catch((error) => {
                        console.error("Error during manual sync:", error);
                        this.updateFileStatus();
                    });
            } catch (error) {
                console.error("Error triggering sync:", error);
                this.updateFileStatus();
            }
        }
    }
}
