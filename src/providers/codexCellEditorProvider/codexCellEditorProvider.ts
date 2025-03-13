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

const DEBUG_MODE = false;

const debug = function (...args: any[]) {
    if (DEBUG_MODE) {
        console.log("[CodexCellEditorProvider]", ...args);
    }
};

export class CodexCellEditorProvider implements vscode.CustomEditorProvider<CodexCellDocument> {
    public currentDocument: CodexCellDocument | undefined;
    private webviewPanels: Map<string, vscode.WebviewPanel> = new Map();
    private userInfo: { username: string; email: string } | undefined;
    private stateStore: StateStore | undefined;
    private stateStoreListener: (() => void) | undefined;
    private commitTimer: NodeJS.Timeout | number | undefined;
    private autocompleteCancellation: vscode.CancellationTokenSource | undefined;
    
    // New state for autocompletion process
    private autocompletionState: {
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
        progress: 0
    };
    
    // Single cell translation state
    private singleCellTranslationState: {
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    } = {
        isProcessing: false,
        cellId: undefined,
        progress: 0
    };
    
    // private readonly COMMIT_DELAY_MS = 5 * 60 * 1000; // 5 minutes in milliseconds
    private readonly COMMIT_DELAY_MS = 5 * 1000; // 5 seconds in milliseconds

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

    constructor(private readonly context: vscode.ExtensionContext) {
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
            vscode.commands.registerCommand("codex-editor-extension.updateValidationIndicators", () => {
                // Send validation count to all webviews
                this.updateValidationIndicatorsForAllDocuments();
            })
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
                        const valueIsCodexFile = value.uri.endsWith(".codex");
                        if (valueIsCodexFile) {
                            debug("Processing codex file highlight");
                            for (const [panelUri, panel] of this.webviewPanels.entries()) {
                                const isSourceFile = panelUri.endsWith(".source");
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
        const authApi = await this.getAuthApi();
        this.userInfo = await authApi?.getUserInfo();
        debug("User info retrieved:", this.userInfo);

        // Enable scripts in the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Get text direction and check if it's a source file
        const textDirection = this.getTextDirection(document);
        const isSourceText = document.uri.fsPath.endsWith(".source");
        debug("Text direction:", textDirection, "Is source text:", isSourceText);

        // Set up the HTML content for the webview
        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            textDirection,
            isSourceText
        );

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
                GlobalProvider.getInstance().handleMessage(e);
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
        await vscode.commands.executeCommand(
            "extension.manualCommit",
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
        // Clear any existing timer
        if (this.commitTimer) {
            clearTimeout(this.commitTimer);
        }

        // Set new timer
        this.commitTimer = setTimeout(async () => {
            debug("Executing scheduled commit");
            await this.executeGitCommit(document);
        }, this.COMMIT_DELAY_MS);
    }

    public async saveCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        debug("Saving custom document:", document.uri.toString());
        await document.save(cancellation);
        this.scheduleCommit(document); // Schedule commit instead of immediate commit
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
                cell => cell.cellType !== CodexCellTypes.PARATEXT && cell.cellContent?.trim() !== "<range>"
            );
            const totalCells = cellsToProcess.length;
            const cellIds = cellsToProcess.map(cell => cell.cellMarkers[0]);
            
            // Update state in the provider first
            this.autocompletionState = {
                isProcessing: true,
                totalCells,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: cellIds,
                progress: 0.01 // Start with a tiny bit of progress
            };
            
            // Send state to webview
            this.broadcastAutocompletionState();
            
            // Process each cell
            for (let i = 0; i < cellsToProcess.length; i++) {
                // Check if cancelled
                if (this.autocompleteCancellation?.token.isCancellationRequested) {
                    debug("Autocomplete operation cancelled");
                    break;
                }
                
                const cell = cellsToProcess[i];
                const cellId = cell.cellMarkers[0];
                if (!cellId) {
                    throw new Error("Cell ID is undefined");
                }

                try {
                    // Update current cell in provider state
                    this.autocompletionState.currentCellId = cellId;
                    this.autocompletionState.progress = (i / totalCells) + (0.5 / totalCells);
                    this.broadcastAutocompletionState();
                    
                    // Perform LLM completion
                    if (document) {
                        await performLLMCompletion(cellId, document, true);
                    }
                    
                    // Update completion status in provider state
                    this.autocompletionState.completedCells++;
                    this.autocompletionState.cellsToProcess = this.autocompletionState.cellsToProcess.filter(id => id !== cellId);
                    this.autocompletionState.progress = (i + 1) / totalCells;
                    this.broadcastAutocompletionState();
                    
                    // Add a small delay between cells
                    await new Promise((resolve) => setTimeout(resolve, 250));
                } catch (error) {
                    console.error(`Error autocompleting cell ${cellId}:`, error);
                    vscode.window.showErrorMessage(`Failed to autocomplete cell ${cellId}`);
                    
                    // Count errors as "completed" to maintain progress
                    this.autocompletionState.completedCells++;
                    this.autocompletionState.cellsToProcess = this.autocompletionState.cellsToProcess.filter(id => id !== cellId);
                    this.autocompletionState.progress = (i + 1) / totalCells;
                    this.broadcastAutocompletionState();
                }
            }
            
            // Mark completion in provider state
            this.autocompletionState.progress = 1.0;
            this.broadcastAutocompletionState();
            
            // After a short delay, reset state
            await new Promise(resolve => setTimeout(resolve, 1500));
            this.autocompletionState = {
                isProcessing: false,
                totalCells: 0,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: [],
                progress: 0
            };
            this.broadcastAutocompletionState();
            
        } finally {
            // Clean up
            if (this.autocompleteCancellation) {
                this.autocompleteCancellation.dispose();
                this.autocompleteCancellation = undefined;
            }
        }
    }
    
    // New method to broadcast the current autocompletion state to all webviews
    private broadcastAutocompletionState() {
        // Only send to webviews that have the current document open
        this.webviewPanels.forEach((panel, uri) => {
            if (this.currentDocument && uri === this.currentDocument.uri.toString()) {
                this.postMessageToWebview(panel, {
                    type: "providerAutocompletionState",
                    state: this.autocompletionState
                });
            }
        });
    }
    
    public cancelAutocompleteChapter(): boolean {
        if (this.autocompleteCancellation) {
            debug("Cancelling chapter autocompletion");
            this.autocompleteCancellation.cancel();
            
            // Reset state
            this.autocompletionState = {
                isProcessing: false,
                totalCells: 0,
                completedCells: 0,
                currentCellId: undefined,
                cellsToProcess: [],
                progress: 0
            };
            this.broadcastAutocompletionState();
            
            return true;
        }
        return false;
    }
    
    // New method to set single cell translation state
    public async startSingleCellTranslation(cellId: string) {
        this.singleCellTranslationState = {
            isProcessing: true,
            cellId,
            progress: 0.1 // Start with a small amount of progress
        };
        this.broadcastSingleCellTranslationState();
    }
    
    // New method to update single cell translation progress
    public updateSingleCellTranslationProgress(progress: number) {
        if (this.singleCellTranslationState.isProcessing) {
            this.singleCellTranslationState.progress = progress;
            this.broadcastSingleCellTranslationState();
        }
    }
    
    // New method to complete single cell translation
    public completeSingleCellTranslation() {
        this.singleCellTranslationState.progress = 1.0;
        this.broadcastSingleCellTranslationState();
        
        // After a short delay, reset state
        setTimeout(() => {
            this.singleCellTranslationState = {
                isProcessing: false,
                cellId: undefined,
                progress: 0
            };
            this.broadcastSingleCellTranslationState();
        }, 1500);
    }
    
    // New method to handle single cell translation error
    public failSingleCellTranslation(error?: string) {
        this.singleCellTranslationState = {
            isProcessing: false,
            cellId: undefined,
            progress: 0
        };
        this.broadcastSingleCellTranslationState();
        
        if (error) {
            vscode.window.showErrorMessage(`Translation failed: ${error}`);
        }
    }
    
    // New method to broadcast single cell translation state
    private broadcastSingleCellTranslationState() {
        // Only send to webviews that have the current document open
        this.webviewPanels.forEach((panel, uri) => {
            if (this.currentDocument && uri === this.currentDocument.uri.toString()) {
                this.postMessageToWebview(panel, {
                    type: "providerSingleCellTranslationState",
                    state: this.singleCellTranslationState
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

            translationUnitsWithMergedRanges.push({
                cellMarkers,
                cellContent: verse.cellContent,
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
        const isSourceText = document.uri.fsPath.endsWith(".source");
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
        debug("No valid video URL found");
        return null;
    }

    public updateCellIdState(cellId: string, uri: string) {
        debug("Updating cell ID state:", cellId, uri);
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
        
        debug(`Updating validation indicators for all documents with validation count: ${validationCount}`);
        
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
}
