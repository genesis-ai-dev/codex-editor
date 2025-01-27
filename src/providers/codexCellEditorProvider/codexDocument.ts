import * as vscode from "vscode";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../../utils/notebookMetadataManager";
import { initializeStateStore } from "../../stateStore";
import {
    QuillCellContent,
    CodexNotebookAsJSONData,
    CustomNotebookCellData,
    Timestamps,
    CustomNotebookMetadata,
} from "../../../types";
import { CodexCellTypes, EditType } from "../../../types/enums";

export class CodexCellDocument implements vscode.CustomDocument {
    uri: vscode.Uri;
    private _documentData: CodexNotebookAsJSONData;
    public _sourceCellMap: { [k: string]: { content: string; versions: string[] } } = {};
    private _edits: Array<any>;
    private _isDirty: boolean = false;

    private _onDidDispose = new vscode.EventEmitter<void>();
    public readonly onDidDispose = this._onDidDispose.event;

    private readonly _onDidChangeForVsCodeAndWebview = new vscode.EventEmitter<{
        readonly content?: string;
        readonly edits: any[];
    }>();
    public readonly onDidChangeForVsCodeAndWebview = this._onDidChangeForVsCodeAndWebview.event;

    private readonly _onDidChangeForWebview = new vscode.EventEmitter<{
        readonly content?: string;
        readonly edits: any[];
    }>();
    public readonly onDidChangeForWebview = this._onDidChangeForWebview.event;

    constructor(uri: vscode.Uri, initialContent: string) {
        this.uri = uri;
        this._documentData = initialContent.trim().length === 0 ? {} : JSON.parse(initialContent);
        if (!this._documentData.metadata) {
            const metadata = getNotebookMetadataManager();
            metadata.initialize();
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
        this._onDidChangeForVsCodeAndWebview.dispose();
        this._onDidChangeForWebview.dispose();
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

        // Normalize content by removing HTML entities and tags for comparison
        const normalizeContent = (content: string) => {
            return content
                .replace(/<[^>]*>/g, "") // Remove HTML tags
                .replace(/&amp;|&lt;|&gt;|&quot;|&#39;/g, "") // Remove common HTML entities
                .replace(/&nbsp; ?/g, " ") // Remove &nbsp;
                .replace(/&#\d+;/g, "") // Remove numeric HTML entities
                .replace(/&[a-zA-Z]+;/g, "") // Remove other named HTML entities
                .trim();
        };

        // For user edits, only add the edit if content has actually changed
        if (
            editType === EditType.USER_EDIT &&
            normalizeContent(cellToUpdate.value) === normalizeContent(newContent)
        ) {
            return; // Skip adding edit if normalized content hasn't changed
        }

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
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, newContent, editType }],
        });
    }
    public replaceDuplicateCells(content: QuillCellContent) {
        let indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
            return cell.metadata?.id === content.cellMarkers[0];
        });
        const cellMarkerOfCellBeforeNewCell =
            indexOfCellToDelete === 0
                ? null
                : this._documentData.cells[indexOfCellToDelete - 1].metadata?.id;
        while (indexOfCellToDelete !== -1) {
            this._documentData.cells.splice(indexOfCellToDelete, 1);
            indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
                return cell.metadata?.id === content.cellMarkers[0];
            });
        }

        this.addCell(
            content.cellMarkers[0],
            cellMarkerOfCellBeforeNewCell,
            "below",
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
        cancellation: vscode.CancellationToken,
        backup: boolean = false
    ): Promise<void> {
        const text = JSON.stringify(this._documentData, null, 2);
        await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(text));
        if (!backup) this._isDirty = false; // Reset dirty flag
    }

    public async revert(cancellation?: vscode.CancellationToken): Promise<void> {
        const diskContent = await vscode.workspace.fs.readFile(this.uri);
        this._documentData = JSON.parse(diskContent.toString());
        this._edits = [];
        this._isDirty = false; // Reset dirty flag
        this._onDidChangeForWebview.fire({
            content: this.getText(),
            edits: [],
        });
    }

    public async backup(
        destination: vscode.Uri,
        cancellation: vscode.CancellationToken
    ): Promise<vscode.CustomDocumentBackup> {
        await this.saveAs(destination, cancellation, true);
        return {
            id: destination.toString(),
            delete: () => vscode.workspace.fs.delete(destination),
        };
    }

    public getText(): string {
        return JSON.stringify(this._documentData, null, 2);
    }

    public getCellContent(cellId: string): QuillCellContent | undefined {
        const cell = this._documentData.cells?.find((cell) => cell.metadata?.id === cellId);
        if (!cell) {
            return undefined;
        }
        return {
            cellMarkers: [cell.metadata.id],
            cellContent: cell.value,
            cellType: cell.metadata.type,
            editHistory: cell.metadata.edits || [],
            timestamps: cell.metadata.data,
            cellLabel: cell.metadata.cellLabel,
        };
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
        this._onDidChangeForVsCodeAndWebview.fire({
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
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId }],
        });
    }
    // Method to add a new cell
    public addCell(
        newCellId: string,
        referenceCellId: string | null,
        direction: "above" | "below",
        cellType: CodexCellTypes,
        data: CustomNotebookCellData["metadata"]["data"],
        content?: QuillCellContent
    ) {
        let insertIndex: number;

        if (referenceCellId === null) {
            // If referenceCellId is null, insert at the beginning
            insertIndex = 0;
        } else {
            const indexOfReferenceCell = this._documentData.cells.findIndex(
                (cell) => cell.metadata?.id === referenceCellId
            );

            if (indexOfReferenceCell === -1) {
                throw new Error("Could not find cell to insert after");
            }

            insertIndex = direction === "above" ? indexOfReferenceCell : indexOfReferenceCell + 1;
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
            referenceCellId,
            cellType,
            data,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ newCellId, referenceCellId, cellType, data }],
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
        this._onDidChangeForVsCodeAndWebview.fire({
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
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, newLabel }],
        });
    }

    public updateUri(newUri: vscode.Uri): void {
        Object.defineProperty(this, "uri", {
            value: newUri,
            writable: true,
            configurable: true,
        });
    }
}
