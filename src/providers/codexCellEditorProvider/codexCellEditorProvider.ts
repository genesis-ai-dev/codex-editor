import * as vscode from "vscode";
import { initializeStateStore } from "../../stateStore";
import { fetchCompletionConfig } from "../translationSuggestions/inlineCompletionsProvider";
import { CodexNotebookReader } from "../../serializer";
import { workspaceStoreListener } from "../../utils/workspaceEventListener";
import { llmCompletion } from "../translationSuggestions/llmCompletion";
import { CodexCellTypes, EditType } from "../../../types/enums";
import {
    QuillCellContent,
    CodexNotebookAsJSONData,
    EditorPostMessages,
    EditorReceiveMessages,
    SpellCheckResponse,
    CustomNotebookCellData,
    Timestamps,
    CustomNotebookMetadata,
} from "../../../types";
import { NotebookMetadataManager } from "../../utils/notebookMetadataManager";
import path from "path";
import { getWorkSpaceUri } from "../../utils";

function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

class CodexCellDocument implements vscode.CustomDocument {
    uri: vscode.Uri;
    private _documentData: CodexNotebookAsJSONData;
    public _sourceCellMap: { [k: string]: { content: string; versions: string[] } } = {};
    private _edits: Array<any>;
    private _isDirty: boolean = false;

    private _onDidDispose = new vscode.EventEmitter<void>();
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeDocument = new vscode.EventEmitter<{
        readonly content?: string;
        readonly edits: any[];
    }>();
    public readonly onDidChangeContent = this._onDidChangeDocument.event;

    constructor(uri: vscode.Uri, initialContent: string) {
        this.uri = uri;
        this._documentData = initialContent.trim().length === 0 ? {} : JSON.parse(initialContent);
        if (!this._documentData.metadata) {
            const metadata = NotebookMetadataManager.getInstance();
            metadata.loadMetadata().then(() => {
                const matchingMetadata = metadata
                    .getAllMetadata()
                    ?.find(
                        (m: CustomNotebookMetadata) =>
                            m.codexFsPath === this.uri.fsPath || m.sourceFsPath === this.uri.fsPath
                    );
                if (matchingMetadata) {
                    this._documentData.metadata = matchingMetadata;
                }
            });
        }
        this._edits = [];
        initializeStateStore().then(async ({ getStoreState }) => {
            const sourceCellMap = await getStoreState("sourceCellMap");
            console.log("sourceCellMap", sourceCellMap);
            if (sourceCellMap) {
                this._sourceCellMap = sourceCellMap;
            }
        });
    }

    dispose(): void {
        this._onDidDispose.fire();
        this._onDidDispose.dispose();
        this._onDidChangeDocument.dispose();
    }

    static async create(
        uri: vscode.Uri,
        backupId: string | undefined,
        token: vscode.CancellationToken
    ): Promise<CodexCellDocument> {
        const dataFile = backupId ? vscode.Uri.parse(backupId) : uri;
        const fileData = await vscode.workspace.fs.readFile(dataFile);

        // Properly decode the Uint8Array to a string
        const decoder = new TextDecoder("utf-8");
        const initialContent = decoder.decode(fileData);

        return new CodexCellDocument(uri, initialContent);
    }

    private static async readFile(uri: vscode.Uri): Promise<string> {
        const fileData = await vscode.workspace.fs.readFile(uri);
        const decoder = new TextDecoder("utf-8");
        return decoder.decode(fileData);
    }

    public get isDirty(): boolean {
        return this._isDirty;
    }

    // Methods to manipulate the document data
    public updateCellContent(cellId: string, newContent: string, editType: EditType) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Update cell content and metadata in memory
        cellToUpdate.value = newContent;
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }
        cellToUpdate.metadata.edits.push({
            cellValue: newContent,
            timestamp: Date.now(),
            type: editType,
        });

        // Record the edit
        this._edits.push({
            type: "updateCellContent",
            cellId,
            newContent,
            editType,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ cellId, newContent, editType }],
        });
    }
    public replaceDuplicateCells(content: QuillCellContent) {
        console.log(`Searching for cell with ID: ${content.cellMarkers[0]}`);
        let indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
            console.log(`Checking cell:`, { cell });
            return cell.metadata?.id === content.cellMarkers[0];
        });
        console.log(`Found cell at index: ${indexOfCellToDelete}`);
        const cellMarkerOfCellBeforeNewCell =
            indexOfCellToDelete === 0
                ? null
                : this._documentData.cells[indexOfCellToDelete - 1].metadata?.id;
        while (indexOfCellToDelete !== -1) {
            this._documentData.cells.splice(indexOfCellToDelete, 1);
            console.log(`Searching for next cell with ID 2: ${content.cellMarkers[0]}`);
            indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
                console.log(`Checking cell 2:`, { cell });
                return cell.metadata?.id === content.cellMarkers[0];
            });
            console.log(`Found next cell at index 2: ${indexOfCellToDelete}`);
        }

        this.addCell(
            content.cellMarkers[0],
            cellMarkerOfCellBeforeNewCell,
            content.cellType,
            {
                endTime: content.timestamps?.endTime,
                startTime: content.timestamps?.startTime,
            },
            content
        );
    }

    public async save(cancellation: vscode.CancellationToken): Promise<void> {
        const text = JSON.stringify(this._documentData, null, 2);
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(text));
        this._edits = []; // Clear edits after saving
        this._isDirty = false; // Reset dirty flag
    }

    public async saveAs(
        targetResource: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        const text = JSON.stringify(this._documentData, null, 2);
        await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(text));
        this._isDirty = false; // Reset dirty flag
    }

    public async revert(cancellation: vscode.CancellationToken): Promise<void> {
        const diskContent = await vscode.workspace.fs.readFile(this.uri);
        this._documentData = JSON.parse(diskContent.toString());
        this._edits = [];
        this._isDirty = false; // Reset dirty flag
        this._onDidChangeDocument.fire({
            content: this.getText(),
            edits: [],
        });
    }

    public async backup(
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation);
        return {
            id: destination.toString(),
            delete: () => vscode.workspace.fs.delete(destination),
        };
    }

    public getText(): string {
        return JSON.stringify(this._documentData, null, 2);
    }

    // Additional methods for other edit operations...

    // For example, updating cell timestamps
    public updateCellTimestamps(cellId: string, timestamps: Timestamps) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];
        cellToUpdate.metadata.data = timestamps;

        // Record the edit
        this._edits.push({
            type: "updateCellTimestamps",
            cellId,
            timestamps,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ cellId, timestamps }],
        });
    }

    public deleteCell(cellId: string) {
        const indexOfCellToDelete = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToDelete === -1) {
            throw new Error("Could not find cell to delete");
        }
        this._documentData.cells.splice(indexOfCellToDelete, 1);

        // Record the edit
        this._edits.push({
            type: "deleteCell",
            cellId,
        });

        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ cellId }],
        });
    }
    // Method to add a new cell
    public addCell(
        newCellId: string,
        cellIdOfCellBeforeNewCell: string | null,
        cellType: CodexCellTypes,
        data: CustomNotebookCellData["metadata"]["data"],
        content?: QuillCellContent
    ) {
        let insertIndex: number;

        if (cellIdOfCellBeforeNewCell === null) {
            // If cellIdOfCellBeforeNewCell is null, insert at the beginning
            insertIndex = 0;
        } else {
            const indexOfParentCell = this._documentData.cells.findIndex(
                (cell) => cell.metadata?.id === cellIdOfCellBeforeNewCell
            );

            if (indexOfParentCell === -1) {
                throw new Error("Could not find cell to insert after");
            }

            insertIndex = indexOfParentCell + 1;
        }

        // Add new cell at the determined position
        this._documentData.cells.splice(insertIndex, 0, {
            value: content?.cellContent || "",
            languageId: "html",
            kind: vscode.NotebookCellKind.Code,
            metadata: {
                id: newCellId,
                type: cellType,
                cellLabel: content?.cellLabel,
                edits: content?.editHistory || [],
                data: data,
            },
        });

        // Record the edit
        this._edits.push({
            type: "addCell",
            newCellId,
            cellIdOfCellBeforeNewCell,
            cellType,
            data,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ newCellId, cellIdOfCellBeforeNewCell, cellType, data }],
        });
    }

    // Method to update notebook metadata
    public updateNotebookMetadata(newMetadata: Partial<CustomNotebookMetadata>) {
        if (!this._documentData.metadata) {
            // Initialize metadata if it doesn't exist
            this._documentData.metadata = {} as CustomNotebookMetadata;
        }
        this._documentData.metadata = { ...this._documentData.metadata, ...newMetadata };

        // Record the edit
        this._edits.push({
            type: "updateNotebookMetadata",
            newMetadata,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ metadata: newMetadata }],
        });
    }

    public getNotebookMetadata(): CustomNotebookMetadata {
        return this._documentData.metadata;
    }

    public updateCellLabel(cellId: string, newLabel: string) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Update cell label in memory
        cellToUpdate.metadata.cellLabel = newLabel;

        // Record the edit
        this._edits.push({
            type: "updateCellLabel",
            cellId,
            newLabel,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeDocument.fire({
            edits: [{ cellId, newLabel }],
        });
    }
}

export class CodexCellEditorProvider implements vscode.CustomEditorProvider<CodexCellDocument> {
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
        return providerRegistration;
    }

    private static readonly viewType = "codex.cellEditor";

    constructor(private readonly context: vscode.ExtensionContext) {}

    private readonly _onDidChangeCustomDocument = new vscode.EventEmitter<
        vscode.CustomDocumentContentChangeEvent<CodexCellDocument>
    >();
    public readonly onDidChangeCustomDocument = this._onDidChangeCustomDocument.event;

    public async openCustomDocument(
        uri: vscode.Uri,
        openContext: { backupId?: string },
        _token: vscode.CancellationToken
    ): Promise<CodexCellDocument> {
        const document = await CodexCellDocument.create(uri, openContext.backupId, _token);

        return document;
    }

    public async resolveCustomEditor(
        document: CodexCellDocument,
        webviewPanel: vscode.WebviewPanel,
        _token: vscode.CancellationToken
    ): Promise<void> {
        webviewPanel.webview.options = {
            enableScripts: true,
        };
        const textDirection = this.getTextDirection();
        const isSourceText = document.uri.fsPath.endsWith(".source");

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            textDirection,
            isSourceText
        );

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

        const navigateToSection = (cellId: string) => {
            webviewPanel.webview.postMessage({
                type: "jumpToSection",
                content: cellId,
            });
        };

        const jumpToCellListenerDispose = workspaceStoreListener("cellToJumpTo", (value) => {
            navigateToSection(value);
        });

        const listeners: vscode.Disposable[] = [];

        listeners.push(
            document.onDidChangeContent((e) => {
                // Update the webview when the document changes
                updateWebview();

                // Fire the event to let VS Code know the document has changed
                this._onDidChangeCustomDocument.fire({ document });
            })
        );

        webviewPanel.onDidDispose(() => {
            jumpToCellListenerDispose();
            listeners.forEach((l) => l.dispose());
        });

        webviewPanel.webview.onDidReceiveMessage(async (e: EditorPostMessages) => {
            try {
                console.log("message received (codexCellEditorProvider.ts): ", { e });
                switch (e.command) {
                    case "addWord": {
                        console.log("addWord message received", { e });
                        try {
                            const result = await vscode.commands.executeCommand(
                                "spellcheck.addWord",
                                e.words
                            );
                            console.log("spellcheck.addWord command result:", result);
                            webviewPanel.webview.postMessage({
                                type: "wordAdded",
                                content: e.words,
                            });
                        } catch (error) {
                            console.error("Error adding word:", error);
                            vscode.window.showErrorMessage(`Failed to add word to dictionary:`);
                        }
                        return;
                    }
                    case "from-quill-spellcheck-getSpellCheckResponse": {
                        console.log(
                            "from-quill-spellcheck-getSpellCheckResponse message received",
                            { e }
                        );
                        try {
                            const response = await vscode.commands.executeCommand(
                                "translators-copilot.spellCheckText",
                                e.content.cellContent,
                                e.content.cellChanged
                            );
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerSendsSpellCheckResponse",
                                content: response as SpellCheckResponse,
                            });
                        } catch (error) {
                            console.error("Error during spell check:", error);
                            vscode.window.showErrorMessage("Spell check failed.");
                        }
                        return;
                    }
                    case "saveHtml":
                        console.log("saveHtml message received", { e });
                        try {
                            document.updateCellContent(
                                e.content.cellMarkers[0],
                                e.content.cellContent,
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
                        console.log("setVerseRef message received", { e });
                        try {
                            await initializeStateStore().then(({ updateStoreState }) => {
                                updateStoreState({
                                    key: "cellId",
                                    value: {
                                        cellId: e.content.currentLineId,
                                        uri: document.uri.toString(),
                                    },
                                });
                            });
                        } catch (error) {
                            console.error("Error setting current ID to global state:", error);
                            vscode.window.showErrorMessage(
                                "Failed to set current ID in global state."
                            );
                        }
                        return;
                    case "llmCompletion": {
                        try {
                            const completionResult = await this.performLLMCompletion(
                                document,
                                e.content.currentLineId
                            );
                            console.log("completionResult", {
                                completionResult,
                            });
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerSendsLLMCompletionResponse",
                                content: {
                                    completion: completionResult,
                                },
                            });
                        } catch (error) {
                            console.error("Error during LLM completion:", error);
                            vscode.window.showErrorMessage("LLM completion failed.");
                        }
                        return;
                    }
                    case "requestAutocompleteChapter": {
                        console.log("requestAutocompleteChapter message received", { e });
                        try {
                            await this.performAutocompleteChapter(
                                document,
                                webviewPanel,
                                e.content as QuillCellContent[]
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
                                textDirection: e.direction,
                            };
                            await document.updateNotebookMetadata(updatedMetadata);
                            await document.save(new vscode.CancellationTokenSource().token);
                            console.log("Text direction updated successfully.");
                            this.postMessageToWebview(webviewPanel, {
                                type: "providerUpdatesNotebookMetadataForWebview",
                                content: await document.getNotebookMetadata(),
                            });
                        } catch (error) {
                            console.error("Error updating notebook metadata:", error);
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

                            await vscode.commands.executeCommand(
                                "codexNotebookTreeView.openSourceFile",
                                { sourceFileUri: sourceUri }
                            );
                            this.postMessageToWebview(webviewPanel, {
                                type: "jumpToSection",
                                content: e.content.chapterNumber.toString(),
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
                                e.content.newCellId,
                                e.content.cellIdOfCellBeforeNewCell,
                                e.content.cellType,
                                e.content.data
                            );
                        } catch (error) {
                            console.error("Error making child:", error);
                            vscode.window.showErrorMessage("Failed to make child.");
                        }
                        return;
                    }
                    case "deleteCell": {
                        console.log("deleteCell message received", { e });
                        try {
                            document.deleteCell(e.content.cellId);
                        } catch (error) {
                            console.error("Error deleting cell:", error);
                            vscode.window.showErrorMessage("Failed to delete cell.");
                        }
                        return;
                    }
                    case "updateCellTimestamps": {
                        console.log("updateCellTimestamps message received", { e });
                        try {
                            document.updateCellTimestamps(e.content.cellId, e.content.timestamps);
                        } catch (error) {
                            console.error("Error updating cell timestamps:", error);
                            vscode.window.showErrorMessage("Failed to update cell timestamps.");
                        }
                        return;
                    }
                    case "updateCellLabel": {
                        console.log("updateCellLabel message received", { e });
                        try {
                            document.updateCellLabel(e.content.cellId, e.content.cellLabel);
                        } catch (error) {
                            console.error("Error updating cell label:", error);
                            vscode.window.showErrorMessage("Failed to update cell label.");
                        }
                        return;
                    }
                    case "updateNotebookMetadata": {
                        console.log("updateNotebookMetadata message received", { e });
                        try {
                            const newMetadata = e.content;
                            await document.updateNotebookMetadata(newMetadata);
                            await document.save(new vscode.CancellationTokenSource().token);
                            vscode.window.showInformationMessage(
                                "Notebook metadata updated successfully."
                            );

                            // Refresh the entire webview to ensure all data is up-to-date
                            this.refreshWebview(webviewPanel, document);
                        } catch (error) {
                            console.error("Error updating notebook metadata:", error);
                            vscode.window.showErrorMessage("Failed to update notebook metadata.");
                        }
                        return;
                    }
                    case "pickVideoFile": {
                        console.log("pickVideoFile message received", { e });
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
                                this.refreshWebview(webviewPanel, document);
                            }
                        } catch (error) {
                            console.error("Error picking video file:", error);
                            vscode.window.showErrorMessage("Failed to pick video file.");
                        }
                        return;
                    }
                    case "replaceDuplicateCells": {
                        console.log("replaceDuplicateCells message received", { e });
                        try {
                            document.replaceDuplicateCells(e.content);
                        } catch (error) {
                            console.error("Error replacing duplicate cells:", error);
                            vscode.window.showErrorMessage("Failed to replace duplicate cells.");
                        }
                        return;
                    }
                    case "saveTimeBlocks": {
                        console.log("saveTimeBlocks message received", { e });
                        try {
                            e.content.forEach((cell) => {
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
                }
            } catch (error) {
                console.error("Unexpected error in message handler:", error);
                vscode.window.showErrorMessage("An unexpected error occurred.");
            }
        });

        updateWebview();

        vscode.workspace.onDidChangeConfiguration((e) => {
            if (e.affectsConfiguration("translators-copilot.textDirection")) {
                this.updateTextDirection(webviewPanel);
            }
        });
    }

    public async saveCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.save(cancellation);
    }

    public async saveCustomDocumentAs(
        document: CodexCellDocument,
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.saveAs(destination, cancellation);
    }

    public async revertCustomDocument(
        document: CodexCellDocument,
        cancellation: vscode.CancellationToken
    ): Promise<void> {
        await document.revert(cancellation);
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
                        metadata: ${JSON.stringify(notebookData.metadata)}
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

    private getTextDirection(): string {
        return vscode.workspace.getConfiguration("translators-copilot").get("textDirection", "ltr");
    }

    private updateTextDirection(webviewPanel: vscode.WebviewPanel): void {
        const textDirection = this.getTextDirection();
        this.postMessageToWebview(webviewPanel, {
            type: "providerUpdatesTextDirection",
            textDirection: textDirection as "ltr" | "rtl",
        });
    }

    private async performLLMCompletion(document: CodexCellDocument, currentCellId: string) {
        try {
            // Fetch completion configuration
            const completionConfig = await fetchCompletionConfig();
            const notebookReader = new CodexNotebookReader(document.uri);
            // Perform LLM completion
            const result = await llmCompletion(
                notebookReader,
                currentCellId,
                completionConfig,
                new vscode.CancellationTokenSource().token
            );

            // Update content and metadata atomically
            document.updateCellContent(currentCellId, result, EditType.LLM_GENERATION);

            console.log("LLM completion result", { result });
            return result;
        } catch (error: any) {
            console.error("Error in performLLMCompletion:", error);
            vscode.window.showErrorMessage(`LLM completion failed: ${error.message}`);
            throw error;
        }
    }

    private async performAutocompleteChapter(
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
                await this.performLLMCompletion(document, cellId);

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

    private postMessageToWebview(
        webviewPanel: vscode.WebviewPanel,
        message: EditorReceiveMessages
    ) {
        webviewPanel.webview.postMessage(message);
    }

    private refreshWebview(webviewPanel: vscode.WebviewPanel, document: CodexCellDocument) {
        const notebookData = this.getDocumentAsJson(document);
        const processedData = this.processNotebookData(notebookData);
        const isSourceText = document.uri.fsPath.endsWith(".source");
        const videoUrl = this.getVideoUrl(notebookData.metadata?.videoUrl, webviewPanel);

        webviewPanel.webview.html = this.getHtmlForWebview(
            webviewPanel.webview,
            document,
            this.getTextDirection(),
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
}
