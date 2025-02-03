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
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

export class CodexCellEditorProvider implements vscode.CustomEditorProvider<CodexCellDocument> {
    public currentDocument: CodexCellDocument | undefined;
    private webviewPanels: Map<string, vscode.WebviewPanel> = new Map();
    private userInfo: { username: string; email: string } | undefined;
    private stateStore: StateStore | undefined;

    public static register(context: vscode.ExtensionContext): vscode.Disposable {
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
        GlobalProvider.getInstance().registerProvider("codex-cell-editor", provider);
        return providerRegistration;
    }

    private static readonly viewType = "codex.cellEditor";

    constructor(private readonly context: vscode.ExtensionContext) {
        this.initializeStateStore();
    }

    private async initializeStateStore() {
        try {
            const { storeListener, updateStoreState } = await initializeStateStore();
            this.stateStore = { storeListener, updateStoreState };

            // Set up listener for cell ID changes
            this.stateStore.storeListener("cellId", (value: CellIdGlobalState | undefined) => {
                if (value?.cellId && value?.uri) {
                    // Only send highlight messages to source files when a codex file is active
                    const valueIsCodexFile = value.uri.endsWith(".codex");
                    if (valueIsCodexFile) {
                        for (const [panelUri, panel] of this.webviewPanels.entries()) {
                            const isSourceFile = panelUri.endsWith(".source");
                            if (isSourceFile) {
                                panel.webview.postMessage({
                                    type: "highlightCell",
                                    cellId: value.cellId,
                                });
                            }
                        }
                    }
                }
            });
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
        console.log("openCustomDocument called for:", uri.toString());
        const document = await CodexCellDocument.create(uri, openContext.backupId, _token);
        return document;
    }

    public async resolveCustomEditor(
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        console.log("resolveCustomEditor called for:", document.uri.toString());

        // Store the webview panel with its document URI as the key
        this.webviewPanels.set(document.uri.toString(), webviewPanel);

        // Listen for when this editor becomes active
        webviewPanel.onDidChangeViewState((e) => {
            if (e.webviewPanel.active) {
                // Only update references without refreshing
                this.currentDocument = document;
            }
        });

        // Initial setup
        this.currentDocument = document;
        const authApi = await getAuthApi();
        this.userInfo = await authApi?.getUserInfo();

        // Enable scripts in the webview
        webviewPanel.webview.options = {
            enableScripts: true,
        };

        // Get text direction and check if it's a source file
        const textDirection = this.getTextDirection(document);
        const isSourceText = document.uri.fsPath.endsWith(".source");

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
            if (uri.toString() === document.uri.toString()) {
                if (!document.isDirty) {
                    document.revert(); // Reload the document if it isn't dirty
                }
            }
        });

        // Create update function
        const updateWebview = () => {
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
            webviewPanel.webview.postMessage({
                type: "jumpToSection",
                content: cellId,
            });
        };
        const openCellByIdImpl = (cellId: string, text: string) => {
            console.log("openCellById (implemented)", cellId, text);
            webviewPanel.webview.postMessage({
                type: "openCellById",
                cellId: cellId,
                text: text,
            });
        };
        const jumpToCellListenerDispose = workspaceStoreListener("cellToJumpTo", (value) => {
            navigateToSection(value);
        });

        // Set up document change listeners
        const listeners: vscode.Disposable[] = [];

        listeners.push(
            document.onDidChangeForVsCodeAndWebview((e) => {
                updateWebview();
                this._onDidChangeCustomDocument.fire({ document });
            })
        );

        listeners.push(
            document.onDidChangeForWebview((e) => {
                updateWebview();
            })
        );

        // Clean up on panel close
        webviewPanel.onDidDispose(() => {
            this.webviewPanels.delete(document.uri.toString());
            jumpToCellListenerDispose();
            listeners.forEach((l) => l.dispose());
            watcher.dispose();
        });

        // Handle messages from webview
        webviewPanel.webview.onDidReceiveMessage(async (e: EditorPostMessages | GlobalMessage) => {
            if ("destination" in e) {
                console.log("handling global message", { e });
                GlobalProvider.getInstance().handleMessage(e);
                handleGlobalMessage(this, e as GlobalMessage);
                return;
            }
            handleMessages(e, webviewPanel, document, updateWebview, this);
        });

        // Initial update
        updateWebview();

        // Watch for configuration changes
        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("translators-copilot.textDirection")) {
                this.updateTextDirection(webviewPanel, document);
            }
        });
    }

    public async saveCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.save(cancellation);
        await this.executeGitCommit(document);
    }

    private async executeGitCommit(document: CodexCellDocument): Promise<void> {
        await vscode.commands.executeCommand(
            "extension.manualCommit",
            `changes to ${vscode.workspace.asRelativePath(document.uri).split(/[/\\]/).pop()}`
        );
    }
    public postMessage(message: GlobalMessage) {
        console.log("postMessage", { message });
        if (this.webviewPanels.size > 0) {
            this.webviewPanels.forEach((panel) => panel.webview.postMessage(message));
        } else {
            console.error("No active webview panels");
        }
    }

    public async saveCustomDocumentAs(
        document: CodexCellDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
        await this.executeGitCommit(document);
    }

    public async revertCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.revert(cancellation);
        await this.executeGitCommit(document);
    }

    public async backupCustomDocument(
        document: CodexCellDocument,
        context: vscode.CustomDocumentBackupContext,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        return document.backup(context.destination, cancellation);
    }

    private getHtmlForWebview(
        webview: vscode.Webview,
        document: CodexCellDocument,
        textDirection: string,
        isSourceText: boolean
    ): string {
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
        }

        const nonce = getNonce();

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
                        userInfo: ${JSON.stringify(this.userInfo)}
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
        const text = document.getText();
        if (text.trim().length === 0) {
            return {};
        }

        try {
            return JSON.parse(text);
        } catch {
            throw new Error("Could not get document as json. Content is not valid json");
        }
    }

    private getTextDirection(document: CodexCellDocument): string {
        const notebookData = this.getDocumentAsJson(document);
        console.log("getTextDirection", notebookData.metadata?.textDirection);
        return notebookData.metadata?.textDirection || "ltr";
    }

    private updateTextDirection(
        webviewPanel: vscode.WebviewPanel,
        document: CodexCellDocument
    ): void {
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
        for (let i = 0; i < currentChapterTranslationUnits.length; i++) {
            const cell = currentChapterTranslationUnits[i];

            if (cell.cellType === CodexCellTypes.PARATEXT) continue;
            if (cell.cellContent?.trim() === "<range>") continue;
            if (cell.cellContent?.trim()) continue;

            const cellId = cell.cellMarkers[0];
            if (!cellId) {
                throw new Error("Cell ID is undefined");
            }

            try {
                // Perform LLM completion for the current cell
                if (this.currentDocument) {
                    await performLLMCompletion(cellId, this.currentDocument);
                }

                // Send an update to the webview
                this.postMessageToWebview(webviewPanel, {
                    type: "providerUpdatesCell",
                    content: {
                        cellId: cellId,
                        progress: (i + 1) / currentChapterTranslationUnits.length,
                    },
                });

                // Optionally, add a small delay if needed
                // await new Promise((resolve) => setTimeout(resolve, 1000));
            } catch (error) {
                console.error(`Error autocompleting cell ${cellId}:`, error);
                vscode.window.showErrorMessage(`Failed to autocomplete cell ${cellId}`);
            }

            const debounceTimeToAllowIndexesToSettle = 1000;
            await new Promise((resolve) => setTimeout(resolve, debounceTimeToAllowIndexesToSettle));
        }

        // Send a final update to indicate completion
        this.postMessageToWebview(webviewPanel, {
            type: "providerCompletesChapterAutocompletion",
        });
    }

    private processNotebookData(notebook: vscode.NotebookData) {
        const translationUnits: QuillCellContent[] = notebook.cells.map((cell) => ({
            cellMarkers: [cell.metadata?.id],
            cellContent: cell.value,
            cellType: cell.metadata?.type,
            editHistory: cell.metadata?.edits,
            timestamps: cell.metadata?.data, // FIXME: add strong types because this is where the timestamps are and it's not clear
            cellLabel: cell.metadata?.cellLabel,
        }));

        const processedData = this.mergeRangesAndProcess(translationUnits);

        return processedData;
    }

    private mergeRangesAndProcess(translationUnits: QuillCellContent[]) {
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

        return translationUnitsWithMergedRanges;
    }

    public postMessageToWebview(webviewPanel: vscode.WebviewPanel, message: EditorReceiveMessages) {
        webviewPanel.webview.postMessage(message);
    }

    public refreshWebview(webviewPanel: vscode.WebviewPanel, document: CodexCellDocument) {
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
    }

    private getVideoUrl(
        videoPath: string | undefined,
        webviewPanel: vscode.WebviewPanel
    ): string | null {
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
        return null;
    }

    public updateCellIdState(cellId: string, uri: string) {
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
}
