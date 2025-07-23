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
    ValidationEntry,
} from "../../../types";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { getAuthApi } from "@/extension";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import { debounce } from "lodash";
import { getSQLiteIndexManager } from "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";

// Define debug function locally
const DEBUG_MODE = false;
function debug(...args: any[]) {
    if (DEBUG_MODE) {
        console.log("[CodexCellDocument]", ...args);
    }
}

/**
 * Type guard to check if a value is a ValidationEntry
 */
function isValidationEntry(value: any): value is ValidationEntry {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.username === "string" &&
        typeof value.creationTimestamp === "number" &&
        typeof value.updatedTimestamp === "number" &&
        typeof value.isDeleted === "boolean"
    );
}

export class CodexCellDocument implements vscode.CustomDocument {
    uri: vscode.Uri;
    private _documentData: CodexNotebookAsJSONData;
    public _sourceCellMap: { [k: string]: { content: string; versions: string[]; }; } = {};
    private _edits: Array<any>;
    private _isDirty: boolean = false;
    private _cachedUserInfo: { username: string; email?: string; } | null = null;
    private _author: string = "anonymous";

    // Cache for immediate indexing optimization
    private _cachedFileId: number | null = null;
    private _indexManager = getSQLiteIndexManager();

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
        debug("Constructing CodexCellDocument", uri.toString());
        this.uri = uri;

        // Initialize user info immediately
        this.initializeUserInfo();

        try {
            this._documentData = JSON.parse(initialContent);
            this._edits = [];
            debug(
                "Constructed CodexCellDocument from json document, cells count: ",
                this._documentData.cells.length
            );

            // Initialize validatedBy arrays to ensure proper format
            this.initializeValidatedByArrays();
        } catch (error) {
            console.error("Error parsing document content:", error);
            this._documentData = {
                cells: [],
                metadata: {
                    id: "",
                    originalName: "",
                    sourceFsPath: undefined,
                    codexFsPath: undefined,
                    navigation: [],
                    sourceCreatedAt: new Date().toISOString(),
                    corpusMarker: "",
                },
            };
            this._edits = [];
        }

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

        initializeStateStore().then(async ({ getStoreState }) => {
            const sourceCellMap = await getStoreState("sourceCellMap");
            console.log("sourceCellMap", sourceCellMap);
            if (sourceCellMap) {
                this._sourceCellMap = sourceCellMap;
            }
        });

        // No forced type conversion - rely on proper initialization
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

    // New private method to initialize user info
    private async initializeUserInfo(): Promise<void> {
        try {
            const authApi = await getAuthApi(); // Assuming getAuthApi() itself doesn't throw easily
            if (authApi) {
                const authStatus = authApi.getAuthStatus();
                if (authStatus.isAuthenticated && authApi.currentUser) {
                    // Prefer immediately available currentUser if populated by the new auth flow
                    this._author = authApi.currentUser.username;
                    this._cachedUserInfo = { username: authApi.currentUser.username };
                    debug("Initialized user info from authApi.currentUser:", this._author);
                    return;
                }
                // If currentUser is not available, or for more detailed info, try getUserInfo
                // The new AuthenticationProvider should handle transient errors for getUserInfo internally
                // and not clear the session unless the token is definitively invalid.
                try {
                    const userInfo = await authApi.getUserInfo(); // This might still fetch GitLab info
                    if (userInfo && userInfo.username) {
                        this._author = userInfo.username;
                        this._cachedUserInfo = {
                            username: userInfo.username,
                            email: userInfo.email,
                        };
                        debug("Initialized user info from authApi.getUserInfo:", this._author);
                    } else {
                        // If userInfo is null/undefined or lacks a username, keep the default "anonymous"
                        debug("getUserInfo returned no user data, _author remains:", this._author);
                    }
                } catch (e) {
                    // Log error but don't let it break initialization. _author remains "anonymous".
                    console.error(
                        "Error calling authApi.getUserInfo() in initializeUserInfo. _author remains:",
                        this._author,
                        e
                    );
                }
            } else {
                debug("AuthAPI not available, _author remains:", this._author);
            }
        } catch (error) {
            // This would catch errors from getAuthApi() itself or unexpected issues.
            console.error(
                "Error fetching user info in initializeUserInfo. _author remains:",
                this._author,
                error
            );
        }
    }

    // Methods to manipulate the document data
    public async updateCellContent(
        cellId: string,
        newContent: string,
        editType: EditType,
        shouldUpdateValue = true
    ) {

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

        const currentTimestamp = Date.now();

        // Use stored author instead of fetching it
        const validatedBy: ValidationEntry[] =
            editType === EditType.USER_EDIT
                ? [
                    {
                        username: this._author,
                        creationTimestamp: currentTimestamp,
                        updatedTimestamp: currentTimestamp,
                        isDeleted: false,
                    },
                ]
                : [];

        cellToUpdate.metadata.edits.push({
            cellValue: newContent,
            timestamp: currentTimestamp,
            type: editType,
            author: this._author,
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

        // IMMEDIATE INDEXING: Add the cell to the database immediately after translation
        if (editType === EditType.LLM_GENERATION || editType === EditType.USER_EDIT) {
            this.addCellToIndexImmediately(cellId, newContent, editType);
        }
    }

    // Helper function to sanitize HTML content using enhanced parsing
    private sanitizeContent(htmlContent: string): string {
        if (!htmlContent) return '';

        let cleanContent = htmlContent;

        // Step 1: Remove footnote sup tags completely (including all nested content)
        // Handle both class-based and data-attribute-based footnotes
        cleanContent = cleanContent
            .replace(/<sup[^>]*class=["']footnote-marker["'][^>]*>[\s\S]*?<\/sup>/gi, '')
            .replace(/<sup[^>]*data-footnote[^>]*>[\s\S]*?<\/sup>/gi, '')
            .replace(/<sup[^>]*>[\s\S]*?<\/sup>/gi, ''); // Remove any remaining sup tags

        // Step 2: Remove spell check markup and other unwanted elements
        cleanContent = cleanContent
            .replace(/<[^>]*class=["'][^"']*spell-check[^"']*["'][^>]*>[\s\S]*?<\/[^>]+>/gi, '')
            .replace(/<script[\s\S]*?<\/script>/gi, '')
            .replace(/<style[\s\S]*?<\/style>/gi, '')
            .replace(/<iframe[\s\S]*?<\/iframe>/gi, '');

        // Step 3: Replace paragraph end tags with spaces to preserve word boundaries
        cleanContent = cleanContent.replace(/<\/p>/gi, ' ');

        // Step 4: Remove all remaining HTML tags
        cleanContent = cleanContent.replace(/<[^>]*>/g, '');

        // Step 5: Clean up HTML entities and normalize whitespace
        cleanContent = cleanContent
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/&#\d+;/g, ' ') // Remove numeric HTML entities
            .replace(/&[a-zA-Z]+;/g, ' ') // Remove named HTML entities
            .replace(/\s+/g, ' ') // Normalize all whitespace to single spaces
            .trim();

        return cleanContent;
    }

    // TRUE IMMEDIATE INDEXING - No delays, immediate searchability
    private addCellToIndexImmediately(
        cellId: string,
        content: string,
        editType: EditType
    ): void {
        // IMMEDIATE execution - no setImmediate() delay
        // Use non-blocking pattern that still executes immediately
        (async () => {
            try {
                // Refresh index manager reference if it's not available
                if (!this._indexManager) {
                    this._indexManager = getSQLiteIndexManager();
                    if (!this._indexManager) {
                        console.warn(`[CodexDocument] Index manager not available for immediate indexing of cell ${cellId}`);
                        return;
                    }
                }

                // Use cached file ID or get it once
                let fileId = this._cachedFileId;
                if (!fileId) {
                    fileId = await this._indexManager.upsertFile(
                        this.uri.toString(),
                        "codex",
                        Date.now()
                    );
                    this._cachedFileId = fileId;
                }

                // Calculate logical line position based on cell structure
                let logicalLinePosition: number | null = null;
                const cellIndex = this._documentData.cells.findIndex(cell => cell.metadata?.id === cellId);

                if (cellIndex >= 0) {
                    const currentCell = this._documentData.cells[cellIndex];
                    const isCurrentCellParatext = currentCell.metadata?.type === "paratext";

                    // Only non-paratext cells get line positions
                    if (!isCurrentCellParatext) {
                        // Count all non-paratext cells before this cell to get logical position (1-indexed)
                        let logicalPosition = 1;
                        for (let i = 0; i < cellIndex; i++) {
                            const cell = this._documentData.cells[i];
                            const isParatext = cell.metadata?.type === "paratext";
                            if (!isParatext) {
                                logicalPosition++;
                            }
                        }
                        logicalLinePosition = logicalPosition;

                        // Since this method is only called when content exists,
                        // we always assign the logical position as the line number
                    }
                    // Paratext cells get lineNumber = null
                }

                // Sanitize content for search while preserving raw content with HTML
                const sanitizedContent = this.sanitizeContent(content);

                // IMMEDIATE AI KNOWLEDGE UPDATE with FTS synchronization
                const result = await this._indexManager.upsertCellWithFTSSync(
                    cellId,
                    fileId,
                    "target",
                    sanitizedContent,  // Sanitized content for search
                    logicalLinePosition ?? undefined, // Convert null to undefined for method signature compatibility
                    { editType, lastUpdated: Date.now() },
                    content           // Raw content with HTML tags
                );

                console.log(`[CodexDocument] ✅ Cell ${cellId} immediately indexed and searchable at logical line ${logicalLinePosition}`);

            } catch (error) {
                console.error(`[CodexDocument] Error indexing cell ${cellId}:`, error);
            }
        })().catch(error => {
            console.error(`[CodexDocument] Async error in immediate indexing for cell ${cellId}:`, error);
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
        const currentFileContent = await this.readCurrentFileContent();
        if (!currentFileContent) {
            throw new Error("Could not read current file content for merge");
        }
        const ourContent = JSON.stringify(this._documentData, null, 2);

        const { resolveCodexCustomMerge } = await import("../../projectManager/utils/merge/resolvers");
        const mergedContent = await resolveCodexCustomMerge(ourContent, currentFileContent);
        await vscode.workspace.fs.writeFile(this.uri, new TextEncoder().encode(mergedContent));


        // IMMEDIATE AI LEARNING - Update all cells with content to ensure validation changes are persisted
        await this.syncAllCellsToDatabase();

        this._edits = []; // Clear edits after saving
        this._isDirty = false; // Reset dirty flag
    }

    /**
     * Reads the current content of the file from disk
     * Returns null if the file doesn't exist or there's an error reading it
     */
    private async readCurrentFileContent(): Promise<string | null> {
        try {
            const fileData = await vscode.workspace.fs.readFile(this.uri);
            const decoder = new TextDecoder("utf-8");
            return decoder.decode(fileData);
        } catch (error) {
            // File might not exist yet (new file) or there might be a read error
            console.log("[CodexDocument] Could not read current file content:", error);
            return null;
        }
    }

    public async saveAs(
        targetResource: vscode.Uri,
        cancellation: vscode.CancellationToken,
        backup: boolean = false
    ): Promise<void> {
        const text = JSON.stringify(this._documentData, null, 2);
        await vscode.workspace.fs.writeFile(targetResource, new TextEncoder().encode(text));

        // IMMEDIATE AI LEARNING for non-backup saves
        if (!backup) {
            await this.syncAllCellsToDatabase();
            this._isDirty = false; // Reset dirty flag
        }
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
        // First check if any validation needs fixing
        this.checkAndFixValidationArray(cellId);

        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to validate");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        if (!cellToUpdate.metadata.edits || cellToUpdate.metadata.edits.length === 0) {
            console.warn("No edits found for cell to validate");
            // repair the edit history by adding an llm generation wit hauthor unknown, and then a user edit with validation
            cellToUpdate.metadata.edits = [
                {
                    author: "unknown",
                    validatedBy: [],
                    timestamp: Date.now(),
                    type: EditType.LLM_GENERATION,
                    cellValue: cellToUpdate.value,
                },
                {
                    author: this._author,
                    validatedBy: [],
                    timestamp: Date.now(),
                    type: EditType.USER_EDIT,
                    cellValue: cellToUpdate.value,
                },
            ];
        }

        // Get the latest edit
        const latestEdit = cellToUpdate.metadata.edits[cellToUpdate.metadata.edits.length - 1];

        // Initialize validatedBy array if it doesn't exist
        if (!latestEdit.validatedBy) {
            latestEdit.validatedBy = [];
        }

        // FIXME: we shouldn't be doing this constantly every time we validate a cell!
        // we should just get the current user once at the top level of the codexCellEditorProvider
        let username = "anonymous";
        const currentTimestamp = Date.now();
        try {
            const authApi = await getAuthApi();
            const userInfo = await authApi?.getUserInfo();
            username = userInfo?.username || "anonymous";
        } catch (e) {
            console.error("Could not get user info in validateCellContent", e);
        }

        // Find existing validation entry for this user
        const existingEntryIndex = latestEdit.validatedBy.findIndex(
            (entry: ValidationEntry) =>
                this.isValidValidationEntry(entry) && entry.username === username
        );

        if (validate) {
            if (existingEntryIndex === -1) {
                // User is not in the array, add a new entry
                const newValidationEntry: ValidationEntry = {
                    username,
                    creationTimestamp: currentTimestamp,
                    updatedTimestamp: currentTimestamp,
                    isDeleted: false,
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

        // Final check: ensure the validatedBy array only contains valid ValidationEntry objects
        latestEdit.validatedBy = latestEdit.validatedBy.filter((entry) =>
            this.isValidValidationEntry(entry)
        );

        // Mark document as dirty
        this._isDirty = true;

        // Notify listeners that the document has changed
        this._onDidChangeForVsCodeAndWebview.fire({
            content: JSON.stringify({
                cellId,
                type: "validation",
                validatedBy: latestEdit.validatedBy,
            }),
            edits: [
                {
                    cellId,
                    type: "validation",
                    validatedBy: latestEdit.validatedBy,
                },
            ],
        });

        // Log validation change for debugging
        console.log(`[CodexDocument] 🔍 Validation change for cell ${cellId}:`, {
            validate,
            username,
            validationCount: latestEdit.validatedBy.filter(entry => this.isValidValidationEntry(entry) && !entry.isDeleted).length,
            cellHasContent: !!(cellToUpdate.value && cellToUpdate.value.trim()),
            editsCount: cellToUpdate.metadata.edits.length
        });

        // Database update will happen automatically when document is saved
    }

    /**
     * Initializes validatedBy arrays in the document to ensure they use the new ValidationEntry format
     * This converts any string entries to ValidationEntry objects and removes any invalid entries
     */
    private initializeValidatedByArrays(): void {
        debug("Initializing validatedBy arrays to use ValidationEntry format");

        if (!this._documentData?.cells) {
            return;
        }

        let changesDetected = false;

        for (const cell of this._documentData.cells) {
            if (!cell.metadata?.edits) {
                continue;
            }

            for (const edit of cell.metadata.edits) {
                if (!edit.validatedBy) {
                    // Initialize an empty array if it doesn't exist
                    edit.validatedBy = [];
                    changesDetected = true;
                    continue;
                }

                // Check if validatedBy array contains entries that need to be converted
                const newValidatedBy: ValidationEntry[] = [];
                let foundInvalidEntries = false;

                // First pass: collect all valid ValidationEntry objects and convert strings
                for (const entry of edit.validatedBy) {
                    if (typeof entry === "string") {
                        debug(
                            `Converting string validation entry "${entry}" to proper ValidationEntry object`
                        );
                        foundInvalidEntries = true;
                        const currentTimestamp = Date.now();
                        newValidatedBy.push({
                            username: entry,
                            creationTimestamp: currentTimestamp,
                            updatedTimestamp: currentTimestamp,
                            isDeleted: false,
                        });
                    } else if (this.isValidValidationEntry(entry)) {
                        // Keep valid ValidationEntry objects
                        newValidatedBy.push(entry);
                    } else {
                        // Skip invalid entries
                        debug(`Skipping invalid validation entry: ${JSON.stringify(entry)}`);
                        foundInvalidEntries = true;
                    }
                }

                // Second pass: deduplicate by username (keep the one with most recent updatedTimestamp)
                const usernameMap = new Map<string, ValidationEntry>();

                for (const entry of newValidatedBy) {
                    const existingEntry = usernameMap.get(entry.username);

                    if (!existingEntry || entry.updatedTimestamp > existingEntry.updatedTimestamp) {
                        usernameMap.set(entry.username, entry);
                    }
                }

                // Replace the array with our clean version if changes were made
                const finalValidatedBy = Array.from(usernameMap.values());

                if (foundInvalidEntries || finalValidatedBy.length !== edit.validatedBy.length) {
                    debug(
                        `Updated validatedBy array for edit in cell ${cell.metadata.id}, found ${edit.validatedBy.length} entries, cleaned to ${finalValidatedBy.length}`
                    );
                    edit.validatedBy = finalValidatedBy;
                    changesDetected = true;
                }
            }
        }

        // Make sure the document gets saved after we've made changes
        if (changesDetected) {
            debug("Changes detected in validatedBy arrays, marking document as dirty");

            // Set validation migration complete flag
            if (!this._documentData.metadata) {
                // Create a minimal valid metadata object if none exists
                this._documentData.metadata = {
                    id: randomUUID(),
                    originalName: "Unknown",
                    sourceFsPath: "",
                    codexFsPath: "",
                    navigation: [],
                    sourceCreatedAt: new Date().toISOString(),
                    corpusMarker: "",
                    validationMigrationComplete: true,
                };
            } else {
                // Just set the flag on existing metadata
                this._documentData.metadata.validationMigrationComplete = true;
            }

            // Mark document as dirty and schedule a save
            this._isDirty = true;

            // Schedule save for next event loop to ensure all changes are applied
            setTimeout(() => {
                debug("Saving document after validation arrays cleanup");
                this.save(new vscode.CancellationTokenSource().token).catch((error) => {
                    console.error("Error saving document after validation migration:", error);
                });
            }, 100); // Slightly longer timeout to ensure all changes are processed
        } else {
            debug("No changes needed in validatedBy arrays");
        }
    }

    /**
     * Checks if a cell's validation array needs fixing and fix it if needed
     * @param cellId The ID of the cell to check
     * @returns True if fixes were applied, false otherwise
     */
    private checkAndFixValidationArray(cellId: string): boolean {
        const cell = this._documentData.cells.find((cell) => cell.metadata?.id === cellId);

        if (!cell || !cell.metadata?.edits || cell.metadata.edits.length === 0) {
            return false;
        }

        // Get the latest edit
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];

        if (!latestEdit.validatedBy) {
            return false;
        }

        // Check if there are any string entries in the validatedBy array
        const hasStringEntries = latestEdit.validatedBy.some((entry) => typeof entry === "string");

        if (hasStringEntries) {
            debug(
                `Found string entries in validatedBy array for cell ${cellId}, running initialization`
            );
            this.initializeValidatedByArrays();
            return true;
        }

        return false;
    }

    /**
     * Returns the count of active validations (where isDeleted is false)
     * for the most recent edit of a specific cell
     */
    public getValidationCount(cellId: string): number {
        // First check if any validation needs fixing
        this.checkAndFixValidationArray(cellId);

        const cell = this._documentData.cells.find((cell) => cell.metadata?.id === cellId);

        if (!cell || !cell.metadata?.edits || cell.metadata.edits.length === 0) {
            return 0;
        }

        // Get the latest edit
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];

        if (!latestEdit.validatedBy) {
            return 0;
        }

        // Only count ValidationEntry objects with isDeleted: false
        return latestEdit.validatedBy.filter(
            (entry) => this.isValidValidationEntry(entry) && !entry.isDeleted
        ).length;
    }

    /**
     * Checks if a cell has been validated by a specific user
     * @param cellId The ID of the cell to check
     * @param username The username to check
     * @returns True if the user has validated the cell, false otherwise
     */
    public isValidatedByUser(cellId: string, username: string): boolean {
        // First check if any validation needs fixing
        this.checkAndFixValidationArray(cellId);

        const cell = this._documentData.cells.find((cell) => cell.metadata?.id === cellId);

        if (!cell || !cell.metadata?.edits || cell.metadata.edits.length === 0) {
            return false;
        }

        // Get the latest edit
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];

        if (!latestEdit.validatedBy) {
            return false;
        }

        // Check for a ValidationEntry object with the username and isDeleted: false
        return latestEdit.validatedBy.some(
            (entry) =>
                this.isValidValidationEntry(entry) &&
                entry.username === username &&
                !entry.isDeleted
        );
    }

    /**
     * Returns the validatedBy array for the most recent edit of a specific cell
     * Filters out any string entries or invalid entries
     * @param cellId The ID of the cell to check
     * @returns The validatedBy array with only valid ValidationEntry objects, or an empty array if no edit or validations exist
     */
    public getCellValidatedBy(cellId: string): ValidationEntry[] {
        // First check if any validation needs fixing
        this.checkAndFixValidationArray(cellId);

        const cell = this._documentData.cells.find((cell) => cell.metadata?.id === cellId);

        if (!cell || !cell.metadata?.edits || cell.metadata.edits.length === 0) {
            return [];
        }

        // Get the latest edit
        const latestEdit = cell.metadata.edits[cell.metadata.edits.length - 1];

        if (!latestEdit.validatedBy) {
            return [];
        }

        // Filter to only include proper ValidationEntry objects
        return latestEdit.validatedBy.filter((entry) => this.isValidValidationEntry(entry));
    }

    /**
     * Returns all cell IDs in the document
     * @returns An array of cell IDs
     */
    public getAllCellIds(): string[] {
        return this._documentData.cells
            .filter((cell) => cell.metadata?.id)
            .map((cell) => cell.metadata?.id);
    }

    /**
     * Helper function to ensure an entry is a valid ValidationEntry
     * Extracted to reduce duplication in validation methods
     */
    private isValidValidationEntry(entry: any): entry is ValidationEntry {
        return (
            entry !== null &&
            typeof entry === "object" &&
            typeof entry.username === "string" &&
            typeof entry.creationTimestamp === "number" &&
            typeof entry.updatedTimestamp === "number" &&
            typeof entry.isDeleted === "boolean"
        );
    }

    /**
     * Gets the count of active validators for a cell
     * This method ensures no string entries are counted
     * @param cellId The ID of the cell to check
     * @returns The count of active validators (ValidationEntry objects with isDeleted:false)
     */
    public getActiveValidatorsCount(cellId: string): number {
        // First check if any validation migration is needed
        const entries = this.getCellValidatedBy(cellId);

        // After getting the validated entries (which filters out strings),
        // count only the ones where isDeleted is false
        return entries.filter((entry) => !entry.isDeleted).length;
    }

    // Add methods to get and update cell data
    public getCellData(cellId: string): CustomNotebookCellData['metadata']['data'] | null {
        const cell = this._documentData.cells.find((cell) => cell.metadata?.id === cellId);
        if (!cell) {
            return null;
        }
        return cell.metadata?.data || {};
    }

    public getCell(cellId: string): CustomNotebookCellData | undefined {
        return this._documentData.cells.find((cell) => cell.metadata?.id === cellId);
    }

    public updateCellData(cellId: string, newData: any): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to update data`);
        }

        // Ensure metadata exists
        if (!this._documentData.cells[indexOfCellToUpdate].metadata) {
            this._documentData.cells[indexOfCellToUpdate].metadata = {
                id: cellId,
                type: CodexCellTypes.TEXT,
                data: {},
                edits: [],
            };
        }

        // Ensure data exists
        if (!this._documentData.cells[indexOfCellToUpdate].metadata.data) {
            this._documentData.cells[indexOfCellToUpdate].metadata.data = {};
        }

        // Update the cell data
        this._documentData.cells[indexOfCellToUpdate].metadata.data = {
            ...this._documentData.cells[indexOfCellToUpdate].metadata.data,
            ...newData,
        };

        this._isDirty = true;

        // Emit change events
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
        this._onDidChangeForWebview.fire({
            edits: this._edits,
        });
    }

    /**
     * Updates or adds an attachment to a cell's metadata
     * @param cellId The ID of the cell to update
     * @param attachmentId The unique ID of the attachment
     * @param attachmentData The attachment data (url and type)
     */
    public updateCellAttachment(cellId: string, attachmentId: string, attachmentData: { url: string; type: string; }): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to update attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Ensure metadata exists
        if (!cell.metadata) {
            cell.metadata = {
                id: cellId,
                type: CodexCellTypes.TEXT,
                edits: [],
                data: {},
            };
        }

        // Ensure attachments object exists
        if (!cell.metadata.attachments) {
            cell.metadata.attachments = {};
        }

        // Add or update the attachment
        cell.metadata.attachments[attachmentId] = attachmentData;

        // Record the edit
        this._edits.push({
            type: "updateCellAttachment",
            cellId,
            attachmentId,
            attachmentData,
        });

        // Mark as dirty and notify listeners
        this._isDirty = true;
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
    }

    /**
     * Removes an attachment from a cell's metadata
     * @param cellId The ID of the cell to update
     * @param attachmentId The unique ID of the attachment to remove
     */
    public removeCellAttachment(cellId: string, attachmentId: string): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to remove attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Check if attachments exist
        if (!cell.metadata?.attachments || !cell.metadata.attachments[attachmentId]) {
            console.warn(`Attachment ${attachmentId} not found in cell ${cellId}`);
            return;
        }

        // Remove the attachment
        delete cell.metadata.attachments[attachmentId];

        // If no attachments left, remove the attachments object
        if (Object.keys(cell.metadata.attachments).length === 0) {
            delete cell.metadata.attachments;
        }

        // Record the edit
        this._edits.push({
            type: "removeCellAttachment",
            cellId,
            attachmentId,
        });

        // Mark as dirty and notify listeners
        this._isDirty = true;
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
    }



    // Add method to sync all cells to database without modifying content
    private async syncAllCellsToDatabase(): Promise<void> {
        try {
            console.log(`[CodexDocument] 🤖 AI learning from your updates...`);

            if (!this._indexManager) {
                this._indexManager = getSQLiteIndexManager();
                if (!this._indexManager) {
                    console.warn(`[CodexDocument] Index manager not available for AI learning`);
                    return;
                }
            }

            // Get file ID
            let fileId = this._cachedFileId;
            if (!fileId) {
                fileId = await this._indexManager.upsertFile(
                    this.uri.toString(),
                    "codex",
                    Date.now()
                );
                this._cachedFileId = fileId;
            }

            let syncedCells = 0;
            let syncedValidations = 0;

            // Process each cell that has content
            for (const cell of this._documentData.cells!) {
                if (cell.value && cell.value.trim() !== '') {
                    // Get cell ID outside try block so it's accessible in catch block
                    const cellId = cell.metadata?.id;

                    // Skip cells without valid metadata or IDs
                    if (!cellId || !this._documentData.cells) {
                        console.warn(`[CodexDocument] Skipping cell without valid ID or cells array`);
                        continue;
                    }

                    try {
                        // Calculate logical line position
                        let logicalLinePosition: number | null = null;
                        const cellIndex = this._documentData.cells!.findIndex(c => c.metadata?.id === cellId);

                        if (cellIndex >= 0) {
                            const isCurrentCellParatext = cell.metadata?.type === "paratext";

                            if (!isCurrentCellParatext) {
                                // Count non-paratext cells before this cell
                                let logicalPosition = 1;
                                for (let i = 0; i < cellIndex; i++) {
                                    const checkCell = this._documentData.cells![i];
                                    const isParatext = checkCell.metadata?.type === "paratext";
                                    if (!isParatext) {
                                        logicalPosition++;
                                    }
                                }
                                logicalLinePosition = logicalPosition;
                            }
                        }

                        // Prepare metadata for database - this will handle validation extraction
                        const cellMetadata = {
                            edits: cell.metadata?.edits || [],
                            type: "ai_learning",
                            lastUpdated: Date.now()
                        };



                        // Check if this cell has validation data for logging
                        const edits = cell.metadata?.edits;
                        const lastEdit = edits && edits.length > 0 ? edits[edits.length - 1] : null;
                        const hasValidationData = lastEdit?.validatedBy && lastEdit.validatedBy.length > 0;

                        if (hasValidationData && lastEdit?.validatedBy) {
                            const activeValidations = lastEdit.validatedBy.filter((v: any) => v && !v.isDeleted);
                            console.log(`[CodexDocument] 🔄 AI learning validation data for cell ${cellId}: ${activeValidations.length} validators`);
                            syncedValidations++;
                        }

                        // Sanitize content for search
                        const sanitizedContent = this.sanitizeContent(cell.value);

                        // Update database with current cell state (this will extract and update validation metadata)
                        await this._indexManager.upsertCellWithFTSSync(
                            cellId || '',
                            fileId,
                            "target",
                            sanitizedContent,
                            logicalLinePosition ?? undefined,
                            cellMetadata,
                            cell.value // raw content with HTML
                        );

                        syncedCells++;

                    } catch (error) {
                        console.error(`[CodexDocument] Error during AI learning for cell ${cellId}:`, error);
                    }
                }
            }

            console.log(`[CodexDocument] ✅ AI knowledge updated: AI learned from ${syncedCells} cells, ${syncedValidations} cells with validation data`);

        } catch (error) {
            console.error(`[CodexDocument] Error during AI learning:`, error);
        }
    }
}
