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
    ValidationEntry
} from "../../../types";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { getAuthApi } from "@/extension";
import { randomUUID } from "crypto";

/**
 * Type guard to check if an object is a ValidationEntry
 */
function isValidationEntry(obj: any): obj is ValidationEntry {
    return obj && typeof obj === 'object' 
        && 'username' in obj
        && 'creationTimestamp' in obj
        && 'updatedTimestamp' in obj
        && 'isDeleted' in obj;
}

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
        
        // Force type conversion for any cells with string[] validatedBy arrays
        if (this._documentData.cells) {
            for (const cell of this._documentData.cells) {
                if (cell.metadata?.edits) {
                    for (const edit of cell.metadata.edits) {
                        if (edit.validatedBy && typeof edit.validatedBy[0] === 'string') {
                            edit.validatedBy = edit.validatedBy as unknown as ValidationEntry[];
                        }
                    }
                }
            }
        }
        
        // Initialize validatedBy arrays for backward compatibility
        this.initializeValidatedByArrays();
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
    public async updateCellContent(
        cellId: string,
        newContent: string,
        editType: EditType,
        shouldUpdateValue = true
    ) {
        // Prevent updates to source files
        if (this.uri.fsPath.endsWith(".source")) {
            console.warn(
                "Attempted to update content in a source file. This operation is not allowed."
            );
            return;
        }

        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // For user edits, only add the edit if content has actually changed
        if (editType === EditType.USER_EDIT && cellToUpdate.value === newContent) {
            return; // Skip adding edit if normalized content hasn't changed
        }

        // Update cell content and metadata in memory
        if (shouldUpdateValue) {
            cellToUpdate.value = newContent;
        }
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }

        const authApi = await getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const author = userInfo?.username || "anonymous";
        const currentTimestamp = Date.now();

        // Initialize validatedBy array based on edit type with proper ValidationEntry objects
        // For user edits, the author is automatically added to validatedBy
        // For LLM generations, validatedBy starts empty and must be explicitly validated
        const validatedBy: ValidationEntry[] = editType === EditType.USER_EDIT 
            ? [{ 
                username: author, 
                creationTimestamp: currentTimestamp, 
                updatedTimestamp: currentTimestamp, 
                isDeleted: false 
              }] 
            : [];

        cellToUpdate.metadata.edits.push({
            cellValue: newContent,
            timestamp: currentTimestamp,
            type: editType,
            author,
            validatedBy,
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

    // Method to validate a cell's content by a user
    public async validateCellContent(cellId: string, validate: boolean = true) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to validate");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];
        
        if (!cellToUpdate.metadata.edits || cellToUpdate.metadata.edits.length === 0) {
            console.warn("No edits found for cell to validate");
            return;
        }

        // Get the latest edit
        const latestEdit = cellToUpdate.metadata.edits[cellToUpdate.metadata.edits.length - 1];
        
        // Initialize validatedBy array if it doesn't exist
        if (!latestEdit.validatedBy) {
            latestEdit.validatedBy = [] as ValidationEntry[];
        }
        // Ensure validatedBy is treated as ValidationEntry[]
        else if (latestEdit.validatedBy.length > 0 && typeof latestEdit.validatedBy[0] === 'string') {
            // Convert old string array to ValidationEntry array
            const oldValidatedBy = latestEdit.validatedBy as unknown as string[];
            const currentTime = Date.now();
            
            // Create new array with ValidationEntry objects
            const newValidatedBy: ValidationEntry[] = oldValidatedBy.map(username => ({
                username,
                creationTimestamp: currentTime,
                updatedTimestamp: currentTime,
                isDeleted: false
            }));
            
            // Replace old array with new one
            latestEdit.validatedBy = newValidatedBy;
        }

        const authApi = await getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        const username = userInfo?.username || "anonymous";
        const currentTimestamp = Date.now();

        // Find existing validation entry for this user
        const existingEntryIndex = latestEdit.validatedBy.findIndex(
            (entry: ValidationEntry) => entry.username === username
        );

        if (validate) {
            if (existingEntryIndex === -1) {
                // User is not in the array, add a new entry
                const newValidationEntry: ValidationEntry = {
                    username,
                    creationTimestamp: currentTimestamp, 
                    updatedTimestamp: currentTimestamp,
                    isDeleted: false
                };
                latestEdit.validatedBy.push(newValidationEntry);
            } else {
                // User already has an entry, update it
                latestEdit.validatedBy[existingEntryIndex].updatedTimestamp = currentTimestamp;
                latestEdit.validatedBy[existingEntryIndex].isDeleted = false;
            }
        } else {
            if (existingEntryIndex !== -1) {
                // User is in the array, mark as deleted
                latestEdit.validatedBy[existingEntryIndex].updatedTimestamp = currentTimestamp;
                latestEdit.validatedBy[existingEntryIndex].isDeleted = true;
            }
            // If user is not in the array, do nothing when unvalidating
        }

        // Mark document as dirty
        this._isDirty = true;
        
        // Notify listeners that the document has changed
        this._onDidChangeForVsCodeAndWebview.fire({
            content: JSON.stringify({
                cellId,
                type: "validation",
                validatedBy: latestEdit.validatedBy
            }),
            edits: [{
                cellId,
                type: "validation",
                validatedBy: latestEdit.validatedBy
            }]
        });
    }

    /**
     * Initialize validatedBy arrays for backward compatibility with older projects
     */
    private initializeValidatedByArrays() {
        if (!this._documentData || !this._documentData.cells) {
            return;
        }
        
        const currentTimestamp = Date.now();
        
        // Loop through all cells
        for (const cell of this._documentData.cells) {
            if (cell.metadata && cell.metadata.edits && Array.isArray(cell.metadata.edits)) {
                // Loop through all edits in the cell
                for (const edit of cell.metadata.edits) {
                    // Initialize validatedBy array if it doesn't exist
                    if (!edit.validatedBy) {
                        edit.validatedBy = [];
                    } 
                    // Check if we have an old format (string array) and convert it to the new format
                    else if (edit.validatedBy.length > 0 && typeof edit.validatedBy[0] === 'string') {
                        // Convert string array to ValidationEntry array
                        const oldValidatedBy = edit.validatedBy as unknown as string[];
                        
                        // Create new array with ValidationEntry objects
                        const newValidatedBy: ValidationEntry[] = oldValidatedBy.map(username => ({
                            username,
                            creationTimestamp: currentTimestamp,
                            updatedTimestamp: currentTimestamp,
                            isDeleted: false
                        }));
                        
                        // Replace old array with new one
                        edit.validatedBy = newValidatedBy;
                    }
                }
            }
        }
    }

    /**
     * Returns the count of active validations (where isDeleted is false)
     * for the most recent edit of a specific cell
     */
    public getValidationCount(cellId: string): number {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );
        
        if (!cell || !cell.metadata.edits || cell.metadata.edits.length === 0) {
            return 0;
        }
        
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];
        
        if (!latestEdit.validatedBy) {
            return 0;
        }
        
        // Count only validations where isDeleted is false
        return latestEdit.validatedBy.filter(entry => !entry.isDeleted).length;
    }
    
    /**
     * Returns whether a specific user has validated a cell
     */
    public isValidatedByUser(cellId: string, username: string): boolean {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );
        
        if (!cell || !cell.metadata.edits || cell.metadata.edits.length === 0) {
            return false;
        }
        
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];
        
        if (!latestEdit.validatedBy) {
            return false;
        }
        
        // Check if the user has an active validation (isDeleted = false)
        const userEntry = latestEdit.validatedBy.find(entry => entry.username === username);
        return userEntry ? !userEntry.isDeleted : false;
    }

    /**
     * Returns the validatedBy array for the latest edit of a specific cell
     */
    public getCellValidatedBy(cellId: string): ValidationEntry[] {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );
        
        if (!cell || !cell.metadata.edits || cell.metadata.edits.length === 0) {
            return [];
        }
        
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];
        
        if (!latestEdit.validatedBy) {
            return [];
        }
        
        return latestEdit.validatedBy;
    }

    /**
     * Returns all cell IDs in the document
     * @returns An array of cell IDs
     */
    public getAllCellIds(): string[] {
        return this._documentData.cells
            .filter(cell => cell.metadata?.id)
            .map(cell => cell.metadata?.id);
    }
}
