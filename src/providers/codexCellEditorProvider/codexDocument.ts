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
    EditMapValueType,
    MilestoneIndex,
    MilestoneInfo,
    CustomCellMetaData,
} from "../../../types";
import { EditMapUtils, deduplicateFileMetadataEdits } from "../../utils/editMapUtils";
import { CodexCellTypes, EditType } from "../../../types/enums";
import { getAuthApi } from "@/extension";
import { randomUUID } from "crypto";
import { CodexContentSerializer } from "../../serializer";
import { debounce } from "lodash";
import { getSQLiteIndexManager } from "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";
import { getCellValueData, cellHasAudioUsingAttachments, computeValidationStats, computeProgressPercents, shouldExcludeCellFromProgress, shouldExcludeQuillCellFromProgress, countActiveValidations, hasTextContent } from "../../../sharedUtils";
import { extractParentCellIdFromParatext, convertCellToQuillContent } from "./utils/cellUtils";
import { formatJsonForNotebookFile, normalizeNotebookFileText } from "../../utils/notebookFileFormattingUtils";
import { atomicWriteUriText, readExistingFileOrThrow } from "../../utils/notebookSafeSaveUtils";

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

    // Track when we last saved to prevent file watcher from reverting our own saves
    private _lastSaveTimestamp: number = 0;

    // Cache for immediate indexing optimization
    private _cachedFileId: number | null = null;
    private _indexManager = getSQLiteIndexManager();

    // Track cell IDs that have been modified since last save to avoid re-indexing ALL cells.
    // Only cells in this set will be synced to the database on save.
    private _dirtyCellIds: Set<string> = new Set();

    // Pending index operations that failed because the index manager was unavailable.
    // These are replayed when the index manager becomes available again, ensuring
    // no cell edits are silently dropped during project swap or initialization.
    private _pendingIndexOps: Array<{
        cellId: string;
        content: string;
        editType: EditType;
    }> = [];

    // Cache for milestone index to avoid rebuilding on every call
    private _cachedMilestoneIndex: MilestoneIndex | null = null;
    private _cachedMilestoneIndexCellsPerPage: number | null = null;
    private _cachedMilestoneIndexCellCount: number = 0;
    private _lastUpdatedMilestoneIndexCellCount: number = 0;

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

            // Initialize metadata.edits array if it doesn't exist (backward compatibility)
            if (!this._documentData.metadata.edits) {
                this._documentData.metadata.edits = [];
            }
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
                    // Initialize edits array if it doesn't exist
                    if (!this._documentData.metadata.edits) {
                        this._documentData.metadata.edits = [];
                    }
                }
            });
        } else {
            // Initialize edits array if it doesn't exist (backward compatibility)
            if (!this._documentData.metadata.edits) {
                this._documentData.metadata.edits = [];
            }
        }

        // Populate sourceCellMap directly from SQLite index for reliability
        const documentDataRef = this._documentData;
        (async () => {
            try {
                await this.populateSourceCellMapFromIndex(documentDataRef?.metadata?.sourceFsPath);
            } catch (err) {
                console.warn("Failed to initialize sourceCellMap from SQLite index:", err);
            }
        })();

        // No forced type conversion - rely on proper initialization
    }

    /**
     * Populate the in-memory source cell map from the SQLite index, optionally scoped by source file path
     */
    public async populateSourceCellMapFromIndex(sourceFilePath?: string): Promise<void> {
        try {
            if (!this._indexManager) {
                this._indexManager = getSQLiteIndexManager();
            }

            if (this._indexManager) {
                this._sourceCellMap = await this._indexManager.getSourceCellsMapForFile(
                    sourceFilePath || this._documentData?.metadata?.sourceFsPath
                );
            }
        } catch (error) {
            console.warn("populateSourceCellMapFromIndex failed:", error);
        }
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

    public get lastSaveTimestamp(): number {
        return this._lastSaveTimestamp;
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

    // Public method to refresh author info before edits
    public async refreshAuthor(): Promise<void> {
        await this.initializeUserInfo();
    }

    // Methods to manipulate the document data
    public async updateCellContent(
        cellId: string,
        newContent: string,
        editType: EditType,
        shouldUpdateValue = true,
        retainValidations = false,
        skipAutoValidation = false
    ) {
        debug("trace 124 updateCellContent", cellId, newContent, editType, shouldUpdateValue);

        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            console.warn("Could not find cell to update", { cellId });
            return; // Graceful no-op to avoid unhandled rejections in CI
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Update milestone value in cache if updating a milestone cell value
        // Only invalidate cache if structure actually changed (e.g., milestone deleted/added)
        if (cellToUpdate.metadata?.type === CodexCellTypes.MILESTONE && shouldUpdateValue) {
            // Try to update the cached milestone value directly (more efficient)
            const updated = this.updateMilestoneValueInCache(indexOfCellToUpdate, newContent);
            if (!updated) {
                // Cache doesn't exist or milestone not found - invalidate to force rebuild
                this.invalidateMilestoneIndexCache();
            }
            // If updated successfully, cache remains valid with updated value
        }

        // Block updates to locked cells (except for system operations like unlocking)
        // Allow LLM_GENERATION previews (shouldUpdateValue=false) but block actual content updates
        if (cellToUpdate.metadata?.isLocked && editType === EditType.USER_EDIT && shouldUpdateValue) {
            console.warn(`Attempted to update locked cell ${cellId}. Operation blocked.`);
            return;
        }


        // Special case: for non-persisting LLM previews, do not update the cell value
        // but DO record an LLM_GENERATION edit in metadata so history/auditing is preserved
        if (editType === EditType.LLM_GENERATION && !shouldUpdateValue) {
            debug("trace 124 LLM_GENERATION and !shouldUpdateValue", cellId, newContent, editType, shouldUpdateValue);
            // Ensure edit history array exists
            if (!cellToUpdate.metadata.edits) {
                cellToUpdate.metadata.edits = [];
            }

            const currentTimestamp = Date.now();

            const previewEdit = {
                editMap: EditMapUtils.value(),
                value: newContent,
                timestamp: currentTimestamp,
                type: editType,
                author: this._author,
                validatedBy: [],
                preview: true,
            };
            cellToUpdate.metadata.edits.push(previewEdit);

            debug("trace 124 cellToUpdate", { cellToUpdate });

            // Mark dirty so edits are persisted on the next explicit save, but do not notify or save automatically.
            // This avoids side effects (e.g., merge logic using edit history) from updating the stored value.
            // If the UI needs to reflect the preview, it should use a separate webview-only channel.
            this._isDirty = true;
            this._dirtyCellIds.add(cellId);
            // Notify both VS Code and the webview that edits changed, so the provider can mark dirty and VS Code can autosave
            this._onDidChangeForVsCodeAndWebview.fire({
                edits: [{ cellId, newContent, editType }],
            });
            this._onDidChangeForWebview.fire({
                edits: [{ cellId, newContent, editType }],
            });
            return;
        }

        // Prepare edit history array and capture previous value before any updates
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }
        const previousValue = cellToUpdate.value;
        const currentTimestamp = Date.now();

        // If editing a source file's value for the first time, ensure an INITIAL_IMPORT exists
        if (cellToUpdate.metadata.edits.length === 0 && !!previousValue) {

            cellToUpdate.metadata.edits.push({
                editMap: EditMapUtils.value(),
                value: previousValue,
                timestamp: currentTimestamp - 1000,
                type: EditType.INITIAL_IMPORT,
                author: this._author,
                validatedBy: [],
            });
        }

        // Update cell content and metadata in memory
        if (shouldUpdateValue) {
            cellToUpdate.value = newContent;
        }

        // Determine validations for the new edit
        let validatedBy: ValidationEntry[] = [];

        if (editType === EditType.USER_EDIT) {
            if (retainValidations) {
                // Retain validations from only the current user if they exist (for search/replace operations)
                // Find the edit corresponding to the previous value (same pattern as validateCellContent)
                const previousEdits = cellToUpdate.metadata.edits || [];
                let targetEdit: any = null;
                for (let i = previousEdits.length - 1; i >= 0; i--) {
                    const e = previousEdits[i];
                    // Identify value edits using EditMapUtils and also match the exact value
                    const isValueEdit = EditMapUtils.isValue
                        ? EditMapUtils.isValue(e.editMap)
                        : EditMapUtils.equals(e.editMap, EditMapUtils.value());
                    if (isValueEdit && e.value === previousValue) {
                        targetEdit = e;
                        break;
                    }
                }

                // If we found an edit matching the previous value, check if current user had validated it
                // If so, create a new validation entry for the new edit (not copy the old one)
                if (targetEdit && targetEdit.validatedBy && targetEdit.validatedBy.length > 0) {
                    const hadCurrentUserValidation = targetEdit.validatedBy.some(
                        (v: ValidationEntry) =>
                            v &&
                            !v.isDeleted &&
                            v.username &&
                            v.username.toLowerCase() === (this._author || "").toLowerCase()
                    );
                    if (hadCurrentUserValidation) {
                        // Create a new validation entry for the new edit
                        validatedBy = [
                            {
                                username: this._author,
                                creationTimestamp: currentTimestamp,
                                updatedTimestamp: currentTimestamp,
                                isDeleted: false,
                            },
                        ];
                    }
                }
            } else {
                // Default behavior: auto-validate USER_EDIT with the author
                // (This is the original behavior for regular edits)
                // Skip auto-validation only if explicitly requested (e.g., for search/replace operations)
                if (!skipAutoValidation) {
                    validatedBy = [
                        {
                            username: this._author,
                            creationTimestamp: currentTimestamp,
                            updatedTimestamp: currentTimestamp,
                            isDeleted: false,
                        },
                    ];
                }
            }
        }

        cellToUpdate.metadata.edits.push({
            editMap: EditMapUtils.value(),
            value: newContent, // TypeScript infers: string
            timestamp: currentTimestamp,
            type: editType,
            author: this._author,
            validatedBy,
        });

        // Record the edit 
        // not being used ???
        this._edits.push({
            type: "updateCellContent",
            cellId,
            newContent,
            editType,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, newContent, editType }],
        });

        // IMMEDIATE INDEXING: Add the cell to the database immediately after translation
        // Fire and forget for non-blocking, but allow await when needed
        if ((editType === EditType.LLM_GENERATION && shouldUpdateValue) || editType === EditType.USER_EDIT) {
            Promise.resolve(this.addCellToIndexImmediately(cellId, newContent, editType)).catch(error => {
                console.error(`[CodexDocument] Async error in immediate indexing for cell ${cellId}:`, error);
            });
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

        // Step 2: Remove suggestion markup and other unwanted elements
        // (The spell-check regex strips legacy elements with "spell-check" CSS classes)
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

    // Public method to ensure a cell is indexed (useful for waiting after transcription)
    public async ensureCellIndexed(cellId: string, timeoutMs: number = 5000): Promise<boolean> {
        if (!this._indexManager) {
            this._indexManager = getSQLiteIndexManager();
            if (!this._indexManager) return false;
        }

        const start = Date.now();
        while (Date.now() - start < timeoutMs) {
            try {
                const result = await vscode.commands.executeCommand(
                    "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                    cellId
                ) as { cellId: string; content: string; } | null;

                if (result && result.content && result.content.replace(/<[^>]*>/g, "").trim() !== "") {
                    return true;
                }
            } catch {
                // Index command not available
                return false;
            }
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        return false;
    }

    /**
     * Try to acquire the index manager and flush any pending operations that were
     * queued while the index manager was unavailable (e.g. during project swap or
     * initialization). Returns the index manager if available, or null.
     */
    private async acquireIndexManagerAndFlush(): Promise<typeof this._indexManager> {
        if (!this._indexManager) {
            this._indexManager = getSQLiteIndexManager();
        }
        if (this._indexManager && this._pendingIndexOps.length > 0) {
            // Drain the queue — take a snapshot so new ops during flush are queued separately
            const ops = [...this._pendingIndexOps];
            this._pendingIndexOps = [];
            debug(`[CodexDocument] Replaying ${ops.length} pending index operations`);
            for (const op of ops) {
                try {
                    await this.addCellToIndexImmediately(op.cellId, op.content, op.editType);
                } catch (err) {
                    console.warn(`[CodexDocument] Failed to replay pending index op for cell ${op.cellId}:`, err);
                    // Don't re-queue — the cell will be picked up on the next full save via _dirtyCellIds
                }
            }
        }
        return this._indexManager;
    }

    // TRUE IMMEDIATE INDEXING - No delays, immediate searchability
    private async addCellToIndexImmediately(
        cellId: string,
        content: string,
        editType: EditType
    ): Promise<void> {
        try {
            // Refresh index manager reference if it's not available
            if (!this._indexManager) {
                this._indexManager = getSQLiteIndexManager();
                if (!this._indexManager) {
                    // Queue the operation so it's replayed when the index manager becomes available,
                    // rather than silently dropping the update.
                    this._pendingIndexOps.push({ cellId, content, editType });
                    this._dirtyCellIds.add(cellId);
                    console.warn(`[CodexDocument] Index manager not available — queued indexing for cell ${cellId} (${this._pendingIndexOps.length} pending)`);
                    return;
                }
            }

            // Prepare data outside the transaction (no DB access needed)
            let logicalLinePosition: number | null = null;
            const cellIndex = this._documentData.cells.findIndex(cell => cell.metadata?.id === cellId);

            let currentCell: any = null;
            if (cellIndex >= 0) {
                currentCell = this._documentData.cells[cellIndex];
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
                }
                // Paratext cells get lineNumber = null
            }

            // Sanitize content for search while preserving raw content with HTML
            const sanitizedContent = this.sanitizeContent(content);

            // Merge cell metadata with edit information
            // This ensures the database receives full cell metadata (including type) for proper indexing
            const fullMetadata = currentCell?.metadata
                ? { ...currentCell.metadata, editType, lastUpdated: Date.now() }
                : { editType, lastUpdated: Date.now() };

            // Wrap file upsert + cell upsert + FTS sync in a single transaction
            // so a crash or concurrent write can't leave partial state.
            const indexManager = this._indexManager;
            await indexManager.runInTransaction(async () => {
                // Use cached file ID or get it once.
                // Use upsertFileSync (not upsertFile) to avoid disk I/O while
                // holding the transaction lock — upsertFile reads the file from
                // disk, which would block all other DB operations.
                let fileId = this._cachedFileId;
                if (!fileId) {
                    const fileType = this.uri.toString().includes(".source") ? "source" : "codex";
                    fileId = await indexManager.upsertFileSync(
                        this.uri.toString(),
                        fileType,
                        Date.now()
                    );
                    this._cachedFileId = fileId;
                }

                // IMMEDIATE AI KNOWLEDGE UPDATE with FTS synchronization
                await indexManager.upsertCellWithFTSSync(
                    cellId,
                    fileId,
                    this.getContentType(),
                    sanitizedContent,  // Sanitized content for search
                    logicalLinePosition ?? undefined, // Convert null to undefined for method signature compatibility
                    fullMetadata,  // Pass full cell metadata including type (e.g., MILESTONE)
                    content           // Raw content with HTML tags
                );
            });

            debug(`[CodexDocument] ✅ Cell ${cellId} immediately indexed and searchable at logical line ${logicalLinePosition}`);

        } catch (error) {
            console.error(`[CodexDocument] Error indexing cell ${cellId}:`, error);
            throw error;
        }
    }

    public replaceDuplicateCells(content: QuillCellContent) {
        const targetCellId = content.cellMarkers?.[0];
        if (!targetCellId) {
            console.warn(
                "[CodexDocument] replaceDuplicateCells called without a valid cell id. Aborting to avoid accidental mass-deletes."
            );
            return;
        }
        let indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
            return cell.metadata?.id === targetCellId;
        });
        const cellMarkerOfCellBeforeNewCell =
            indexOfCellToDelete === 0
                ? null
                : this._documentData.cells[indexOfCellToDelete - 1].metadata?.id;
        while (indexOfCellToDelete !== -1) {
            this._documentData.cells.splice(indexOfCellToDelete, 1);
            indexOfCellToDelete = this._documentData.cells.findIndex((cell) => {
                return cell.metadata?.id === targetCellId;
            });
        }

        // Invalidate milestone index cache since cells have been removed
        // (addCell will also invalidate, but we do it here too for clarity)
        this.invalidateMilestoneIndexCache();

        this.addCell(
            targetCellId,
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
    /**
     * Returns document data suitable for serialization to disk.
     * Strips display-mode-related metadata so it is not persisted.
     */
    private getDocumentDataForSerialization(): CodexNotebookAsJSONData {
        const metadata = { ...this._documentData.metadata };
        delete (metadata as unknown as Record<string, unknown>).cellDisplayMode;
        return { ...this._documentData, metadata };
    }

    public async save(cancellation: vscode.CancellationToken): Promise<void> {
        const ourContent = formatJsonForNotebookFile(this.getDocumentDataForSerialization());

        // If a file exists but can't be read, we must not overwrite (this can permanently nuke data).
        const existing = await readExistingFileOrThrow(this.uri);

        if (existing.kind === "missing") {
            // Initial write when file does not yet exist
            await atomicWriteUriText(this.uri, ourContent);
        } else {
            const { resolveCodexCustomMerge } = await import("../../projectManager/utils/merge/resolvers");
            const mergedContent = await resolveCodexCustomMerge(ourContent, existing.content);

            // Safety: never write empty/invalid JSON to disk
            let candidate =
                typeof mergedContent === "string" && mergedContent.trim().length > 0
                    ? mergedContent
                    : ourContent;

            candidate = normalizeNotebookFileText(candidate);

            try {
                const parsed = JSON.parse(candidate) as CodexNotebookAsJSONData;
                if (parsed.metadata && "cellDisplayMode" in parsed.metadata) {
                    const meta = { ...parsed.metadata };
                    delete (meta as unknown as Record<string, unknown>).cellDisplayMode;
                    candidate = formatJsonForNotebookFile({ ...parsed, metadata: meta });
                }
            } catch {
                candidate = normalizeNotebookFileText(ourContent);
            }

            await atomicWriteUriText(this.uri, candidate);
        }

        // Record save timestamp to prevent file watcher from reverting our own save
        this._lastSaveTimestamp = Date.now();

        // Sync only modified cells to the database (not all 1000+ cells)
        await this.syncDirtyCellsToDatabase();

        this._edits = []; // Clear edits after saving
        this._isDirty = false; // Reset dirty flag
    }


    public async saveAs(
        targetResource: vscode.Uri,
        cancellation: vscode.CancellationToken,
        backup: boolean = false
    ): Promise<void> {
        const text = formatJsonForNotebookFile(this.getDocumentDataForSerialization());
        await atomicWriteUriText(targetResource, text);

        // Sync only modified cells for non-backup saves
        if (!backup) {
            // Record save timestamp to prevent file watcher from reverting our own save
            this._lastSaveTimestamp = Date.now();
            await this.syncDirtyCellsToDatabase();
            this._isDirty = false; // Reset dirty flag
        }
    }


    public async revert(cancellation?: vscode.CancellationToken): Promise<void> {
        const diskContent = await vscode.workspace.fs.readFile(this.uri);
        this._documentData = JSON.parse(diskContent.toString());
        // Invalidate milestone index cache since document was reverted from disk
        this.invalidateMilestoneIndexCache();
        this._edits = [];
        this._isDirty = false; // Reset dirty flag
        this._dirtyCellIds.clear(); // Discard stale dirty IDs — document is back to saved state
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
        return formatJsonForNotebookFile(this.getDocumentDataForSerialization());
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
            data: cell.metadata.data,
            attachments: cell.metadata.attachments || {},
            metadata: {
                isLocked: cell.metadata.isLocked,
            },
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

        // Block timestamp updates to locked cells
        if (cellToUpdate.metadata?.isLocked) {
            console.warn(`Attempted to update timestamps of locked cell ${cellId}. Operation blocked.`);
            return;
        }

        // Capture previous values before updating so comparisons are correct
        const previousStartTime = cellToUpdate.metadata.data?.startTime;
        const previousEndTime = cellToUpdate.metadata.data?.endTime;

        // Add edit to cell's edit history
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }
        const currentTimestamp = Date.now();

        // Only add edit if startTime is different from previous value
        if (timestamps.startTime !== undefined && timestamps.startTime !== previousStartTime) {
            // Ensure initial import exists for startTime
            const hasInitialStart = (cellToUpdate.metadata.edits || []).some((e) =>
                e.type === EditType.INITIAL_IMPORT && EditMapUtils.equals(e.editMap, EditMapUtils.dataStartTime())
            );
            if (!hasInitialStart && previousStartTime !== undefined) {
                cellToUpdate.metadata.edits.push({
                    editMap: EditMapUtils.dataStartTime(),
                    value: previousStartTime,
                    timestamp: currentTimestamp - 1000,
                    type: EditType.INITIAL_IMPORT,
                    author: this._author,
                    validatedBy: [],
                });
            }
            const startTimeEditMap = EditMapUtils.dataStartTime();
            cellToUpdate.metadata.edits.push({
                editMap: startTimeEditMap,
                value: timestamps.startTime,
                timestamp: currentTimestamp,
                type: EditType.USER_EDIT,
                author: this._author,
                validatedBy: [
                    {
                        username: this._author,
                        creationTimestamp: currentTimestamp,
                        updatedTimestamp: currentTimestamp,
                        isDeleted: false,
                    },
                ],
            });
        }

        // Only add edit if endTime is different from previous value
        if (timestamps.endTime !== undefined && timestamps.endTime !== previousEndTime) {
            // Ensure initial import exists for endTime
            const hasInitialEnd = (cellToUpdate.metadata.edits || []).some((e) =>
                e.type === EditType.INITIAL_IMPORT && EditMapUtils.equals(e.editMap, EditMapUtils.dataEndTime())
            );
            if (!hasInitialEnd && previousEndTime !== undefined) {
                cellToUpdate.metadata.edits.push({
                    editMap: EditMapUtils.dataEndTime(),
                    value: previousEndTime,
                    timestamp: currentTimestamp - 1000,
                    type: EditType.INITIAL_IMPORT,
                    author: this._author,
                    validatedBy: [],
                });
            }
            const endTimeEditMap = EditMapUtils.dataEndTime();
            cellToUpdate.metadata.edits.push({
                editMap: endTimeEditMap,
                value: timestamps.endTime,
                timestamp: currentTimestamp,
                type: EditType.USER_EDIT,
                author: this._author,
                validatedBy: [
                    {
                        username: this._author,
                        creationTimestamp: currentTimestamp,
                        updatedTimestamp: currentTimestamp,
                        isDeleted: false,
                    },
                ],
            });
        }

        // Now apply the timestamp updates to the document data
        cellToUpdate.metadata.data = {
            ...cellToUpdate.metadata.data,
            ...timestamps,
        };

        // Record the edit
        this._edits.push({
            type: "updateCellTimestamps",
            cellId,
            timestamps,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, timestamps }],
        });
    }

    public deleteCell(cellId: string) {
        // Backward-compat: hard deletes are no longer allowed. Perform a soft delete instead.
        this.softDeleteCell(cellId);
    }

    /**
     * Soft-deletes a cell by setting metadata.data.deleted = true
     * The cell remains in the document but will be hidden in the UI and preserved for merges
     */
    public softDeleteCell(cellId: string) {
        const indexOfCellToSoftDelete = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToSoftDelete === -1) {
            throw new Error("Could not find cell to soft delete");
        }

        const cellToSoftDelete = this._documentData.cells[indexOfCellToSoftDelete];

        if (!cellToSoftDelete.metadata) {
            cellToSoftDelete.metadata = {
                id: cellId,
                type: CodexCellTypes.TEXT,
                edits: [],
                data: {},
            };
        }

        if (!cellToSoftDelete.metadata.data) {
            cellToSoftDelete.metadata.data = {};
        }

        // Set deleted flag
        (cellToSoftDelete.metadata.data).deleted = true;

        // Invalidate milestone index cache if this is a milestone cell or if cells structure changed
        if (cellToSoftDelete.metadata.type === CodexCellTypes.MILESTONE) {
            this.invalidateMilestoneIndexCache();
        }

        // Ensure edits array exists and record a deletion edit for merge/audit trails
        if (!cellToSoftDelete.metadata.edits) {
            cellToSoftDelete.metadata.edits = [];
        }
        const currentTimestamp = Date.now();
        cellToSoftDelete.metadata.edits.push({
            editMap: EditMapUtils.dataDeleted(),
            value: true,
            timestamp: currentTimestamp,
            type: EditType.USER_EDIT,
            author: this._author,
            validatedBy: [
                {
                    username: this._author,
                    creationTimestamp: currentTimestamp,
                    updatedTimestamp: currentTimestamp,
                    isDeleted: false,
                },
            ],
        });

        // Record the edit
        this._edits.push({
            type: "softDeleteCell",
            cellId,
        });

        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, deleted: true }],
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

        // For child cells, ensure parentId is set in metadata so they can be associated with their parent cell
        const cellMetadata: CustomCellMetaData = {
            id: newCellId,
            type: cellType,
            cellLabel: content?.cellLabel,
            edits: content?.editHistory || [],
            data: data,
        };

        if (referenceCellId) {
            cellMetadata.parentId = referenceCellId;
        }

        // Add new cell at the determined position
        this._documentData.cells.splice(insertIndex, 0, {
            value: content?.cellContent || "",
            languageId: "html",
            kind: vscode.NotebookCellKind.Code,
            metadata: cellMetadata,
        });

        // Invalidate milestone index cache since cells have changed
        this.invalidateMilestoneIndexCache();

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
        this._dirtyCellIds.add(newCellId);
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

        // Initialize edits array if it doesn't exist
        if (!this._documentData.metadata.edits) {
            this._documentData.metadata.edits = [];
        }

        const oldMetadata = { ...this._documentData.metadata };
        const currentTimestamp = Date.now();

        // Track which fields are editable (exclude system fields like id, sourceFsPath, etc.)
        // Note: autoDownloadAudioOnOpen is excluded as it's a project-level setting stored in localProjectSettings.json,
        // not a file-level metadata field
        const editableFields = [
            "videoUrl",
            "textDirection",
            "lineNumbersEnabled",
            "fontSize",
            "showInlineBacktranslations",
            "fileDisplayName",
            "audioOnly",
            "corpusMarker",
        ] as const;

        // Compare old vs new values and create edit history entries for each changed field
        for (const field of editableFields) {
            const oldValue = oldMetadata[field];
            const newValue = newMetadata[field];

            // Skip if field wasn't provided in newMetadata or value hasn't changed
            if (newValue === undefined || oldValue === newValue) {
                continue;
            }

            // Determine editMap based on field name
            let editMap: readonly string[];
            switch (field) {
                case "videoUrl":
                    editMap = EditMapUtils.metadataVideoUrl();
                    break;
                case "textDirection":
                    editMap = EditMapUtils.metadataTextDirection();
                    break;
                case "lineNumbersEnabled":
                    editMap = EditMapUtils.metadataLineNumbersEnabled();
                    break;
                case "fontSize":
                    editMap = EditMapUtils.metadataFontSize();
                    break;
                case "showInlineBacktranslations":
                    editMap = EditMapUtils.metadataShowInlineBacktranslations();
                    break;
                case "fileDisplayName":
                    editMap = EditMapUtils.metadataFileDisplayName();
                    break;
                case "audioOnly":
                    editMap = EditMapUtils.metadataAudioOnly();
                    break;
                case "corpusMarker":
                    editMap = EditMapUtils.metadataCorpusMarker();
                    break;
                default:
                    editMap = EditMapUtils.metadataField(field);
            }

            // Add edit history entry with new structure
            this._documentData.metadata.edits.push({
                editMap,
                value: newValue,
                timestamp: currentTimestamp,
                type: EditType.USER_EDIT,
                author: this._author,
            });
        }

        // Deduplicate edits before saving
        this._documentData.metadata.edits = deduplicateFileMetadataEdits(this._documentData.metadata.edits);

        // Save the edits array before applying metadata updates (in case newMetadata contains edits field)
        const savedEdits = this._documentData.metadata.edits;

        // Apply the metadata updates
        this._documentData.metadata = { ...this._documentData.metadata, ...newMetadata };
        delete (this._documentData.metadata as unknown as Record<string, unknown>).cellDisplayMode;
        // Restore the edits array (it was updated above with new edits)
        this._documentData.metadata.edits = savedEdits;

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

    /**
     * Invalidates the cached milestone index when cells are modified.
     * Call this whenever cells are added, removed, or their types/metadata change.
     */
    private invalidateMilestoneIndexCache(): void {
        this._cachedMilestoneIndex = null;
        this._cachedMilestoneIndexCellsPerPage = null;
        this._cachedMilestoneIndexCellCount = 0;
        this._lastUpdatedMilestoneIndexCellCount = 0;
    }

    /**
     * Updates a milestone value in the cached milestone index without rebuilding.
     * This is more efficient than invalidating and rebuilding when only the value changes.
     * 
     * @param cellIndex The index of the milestone cell in the cells array
     * @param newValue The new milestone value
     * @returns true if the milestone was found and updated, false otherwise
     */
    private updateMilestoneValueInCache(cellIndex: number, newValue: string): boolean {
        if (!this._cachedMilestoneIndex || !this._cachedMilestoneIndex.milestones) {
            return false;
        }

        // Find the milestone that matches this cellIndex
        const milestone = this._cachedMilestoneIndex.milestones.find(
            (m) => m.cellIndex === cellIndex
        );

        if (milestone) {
            milestone.value = newValue;
            return true;
        }

        return false;
    }

    /**
     * Builds a milestone index from the document cells.
     * This index is cached and reused until cells are modified.
     * 
     * @param cellsPerPage Number of cells per page for sub-pagination within milestones
     * @returns MilestoneIndex containing milestone information and pagination settings
     */
    public buildMilestoneIndex(cellsPerPage: number = 50): MilestoneIndex {
        const cells = this._documentData.cells || [];
        const currentCellCount = cells.length;

        // Check if we can use the cached index
        if (
            this._cachedMilestoneIndex !== null &&
            this._cachedMilestoneIndexCellsPerPage === cellsPerPage &&
            this._cachedMilestoneIndexCellCount === currentCellCount
        ) {
            return this._cachedMilestoneIndex;
        }

        // Build the milestone index
        const milestones: MilestoneInfo[] = [];
        let totalContentCells = 0;
        let currentMilestoneIndex = -1; // Track which milestone we're currently in
        let currentMilestoneCellCount = 0; // Count cells for current milestone

        // Single pass: find milestones, count content cells, assign milestoneIndex, and build milestone info
        for (let i = 0; i < cells.length; i++) {
            const cell = cells[i];
            const cellType = cell.metadata?.type;

            // Track milestone cells (excluding deleted ones)
            if (cellType === CodexCellTypes.MILESTONE) {
                if (cell.metadata?.data?.deleted !== true) {
                    // If we have a previous milestone, finalize it before starting a new one
                    if (currentMilestoneIndex >= 0) {
                        milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
                    }

                    // Start a new milestone
                    currentMilestoneIndex++;
                    currentMilestoneCellCount = 0;
                    milestones.push({
                        index: currentMilestoneIndex,
                        cellIndex: i,
                        value: cell.value || String(currentMilestoneIndex + 1),
                        cellCount: 0, // Will be set when we finalize this milestone
                    });
                }
            }

            // Process content cells (excluding milestones and paratext)
            if (cellType !== CodexCellTypes.MILESTONE && cellType !== "paratext") {
                totalContentCells++;

                // Only assign milestoneIndex if we've encountered at least one milestone
                if (currentMilestoneIndex >= 0) {
                    // Assign milestoneIndex to this cell
                    // Ensure data object exists
                    if (!cell.metadata) {
                        cell.metadata = {} as CustomCellMetaData;
                    }
                    if (!cell.metadata.data) {
                        cell.metadata.data = {} as any;
                    }
                    (cell.metadata.data as any).milestoneIndex = currentMilestoneIndex;
                    currentMilestoneCellCount++;
                }
            }

            // Assign milestoneIndex to Paratext cells for footnote numbering (but don't count them)
            // Paratext cells need milestoneIndex to maintain sequential footnote numbering across cell types
            if (cellType === "paratext") {
                // Only assign milestoneIndex if we've encountered at least one milestone
                if (currentMilestoneIndex >= 0) {
                    // Assign milestoneIndex to this Paratext cell
                    // Ensure data object exists
                    if (!cell.metadata) {
                        cell.metadata = {} as CustomCellMetaData;
                    }
                    if (!cell.metadata.data) {
                        cell.metadata.data = {} as any;
                    }
                    (cell.metadata.data as any).milestoneIndex = currentMilestoneIndex;
                }
            }
        }

        // Finalize the last milestone's cell count
        if (currentMilestoneIndex >= 0) {
            milestones[currentMilestoneIndex].cellCount = currentMilestoneCellCount;
        }

        // Edge case: No milestone cells found - create a virtual milestone at index 0
        if (milestones.length === 0) {
            // Assign milestoneIndex 0 to all non-milestone cells (including paratext for footnote numbering)
            for (let i = 0; i < cells.length; i++) {
                const cell = cells[i];
                if (cell.metadata?.type !== CodexCellTypes.MILESTONE) {
                    // Ensure data object exists
                    if (!cell.metadata) {
                        cell.metadata = {} as CustomCellMetaData;
                    }
                    if (!cell.metadata.data) {
                        cell.metadata.data = {} as any;
                    }
                    (cell.metadata.data as any).milestoneIndex = 0;
                }
            }

            const result: MilestoneIndex = {
                milestones: [{
                    index: 0,
                    cellIndex: 0,
                    value: "1",
                    cellCount: totalContentCells,
                }],
                totalCells: totalContentCells,
                cellsPerPage,
            };

            // Cache the result
            this._cachedMilestoneIndex = result;
            this._cachedMilestoneIndexCellsPerPage = cellsPerPage;
            this._cachedMilestoneIndexCellCount = currentCellCount;

            return result;
        }

        const result: MilestoneIndex = {
            milestones,
            totalCells: totalContentCells,
            cellsPerPage,
        };

        // Cache the result
        this._cachedMilestoneIndex = result;
        this._cachedMilestoneIndexCellsPerPage = cellsPerPage;
        this._cachedMilestoneIndexCellCount = currentCellCount;

        return result;
    }

    /**
     * Updates the database with milestone indices for all cells.
     * This should be called after buildMilestoneIndex() to persist the milestone indices.
     */
    public async updateCellMilestoneIndices(): Promise<void> {
        if (!this._indexManager) {
            this._indexManager = getSQLiteIndexManager();
            if (!this._indexManager) {
                console.warn(`[CodexDocument] Index manager not available for milestone index update`);
                return;
            }
        }

        const cells = this._documentData.cells || [];
        const currentCellCount = cells.length;

        // Optimization: Skip update if milestone indices haven't changed
        // If cache is valid and cell count matches last update, indices haven't changed
        if (
            this._cachedMilestoneIndex !== null &&
            this._cachedMilestoneIndexCellCount === currentCellCount &&
            this._lastUpdatedMilestoneIndexCellCount === currentCellCount
        ) {
            // Milestone indices haven't changed, skip database update
            return;
        }

        const contentType = this.getContentType();
        const indexManager = this._indexManager;

        // Use targeted UPDATE statement instead of full upserts
        const db = indexManager.database;
        if (!db) {
            console.warn(`[CodexDocument] Database not available for milestone index update`);
            return;
        }

        await indexManager.runInTransaction(async () => {
            // Get file ID inside the transaction for atomicity.
            // Use upsertFileSync (not upsertFile) to avoid disk I/O while
            // holding the transaction lock — consistent with addCellToIndexImmediately
            // and syncDirtyCellsToDatabase.
            let fileId = this._cachedFileId;
            if (!fileId) {
                fileId = await indexManager.upsertFileSync(
                    this.uri.toString(),
                    contentType === "source" ? "source" : "codex",
                    Date.now()
                );
                this._cachedFileId = fileId;
            }

            // Update milestone_index for all cells
            for (const cell of cells) {
                const cellId = cell.metadata?.id;
                if (!cellId) continue;

                const milestoneIndex = cell.metadata?.data?.milestoneIndex;

                // Execute UPDATE statement
                await db.run(`
                    UPDATE cells 
                    SET milestone_index = ?
                    WHERE cell_id = ?
                `, [
                    milestoneIndex !== undefined ? milestoneIndex : null,
                    cellId
                ]);
            }
        });

        // Track that we've updated for this cell count
        this._lastUpdatedMilestoneIndexCellCount = currentCellCount;
    }

    /**
     * Finds the milestone index that a given cell belongs to.
     * Uses O(1) lookup from cell.data.milestoneIndex.
     * @param cellId The ID of the cell to find the milestone for
     * @returns The milestone index (0-based), or null if not found
     */
    public findMilestoneIndexForCell(cellId: string): number | null {
        const cells = this._documentData.cells || [];

        // Find the cell by ID
        const cell = cells.find((cell) => cell.metadata?.id === cellId);
        if (!cell) {
            return null;
        }

        // Return milestoneIndex from cell data (O(1) lookup)
        return cell.metadata?.data?.milestoneIndex ?? null;
    }

    /**
     * Finds the subsection index that a given cell belongs to within its milestone.
     * @param cellId The ID of the cell to find the subsection for
     * @param cellsPerPage Number of cells per page for sub-pagination (default: 50)
     * @returns An object with milestoneIndex and subsectionIndex, or null if not found
     */
    public findMilestoneAndSubsectionForCell(cellId: string, cellsPerPage: number = 50): { milestoneIndex: number; subsectionIndex: number; } | null {
        const cells = this._documentData.cells || [];

        // Normalize cellId by trimming whitespace
        const normalizedCellId = cellId?.trim();

        // Find the index of the cell in the cells array
        // Match by metadata.id (trimmed for consistency)
        const cellIndex = cells.findIndex((cell) => {
            const cellMetadataId = cell.metadata?.id?.trim();
            return cellMetadataId === normalizedCellId;
        });

        if (cellIndex === -1) {
            return null;
        }

        // Build milestone index to get milestone information
        const milestoneInfo = this.buildMilestoneIndex(cellsPerPage);

        // Find which milestone this cell belongs to
        for (let i = 0; i < milestoneInfo.milestones.length; i++) {
            const milestone = milestoneInfo.milestones[i];
            const nextMilestone = milestoneInfo.milestones[i + 1];
            const startCellIndex = milestone.cellIndex;
            const endCellIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

            if (cellIndex >= startCellIndex && cellIndex < endCellIndex) {
                // Build root index for each content cell in this milestone (matches getCellsForMilestone root-based pagination)
                const cellIdToRootIndex = new Map<string, number>();
                let rootIndex = 0;
                for (let j = startCellIndex; j < endCellIndex; j++) {
                    const c = cells[j];
                    if (
                        c.metadata?.type !== CodexCellTypes.MILESTONE &&
                        c.metadata?.type !== CodexCellTypes.PARATEXT
                    ) {
                        const id = c.metadata?.id;
                        const parentId = c.metadata?.parentId ?? (c.metadata?.data as { parentId?: string; } | undefined)?.parentId;
                        if (id) {
                            if (!parentId) {
                                cellIdToRootIndex.set(id, rootIndex);
                                rootIndex++;
                            } else {
                                const parentRootIndex = cellIdToRootIndex.get(parentId);
                                if (parentRootIndex !== undefined) {
                                    cellIdToRootIndex.set(id, parentRootIndex);
                                }
                            }
                        }
                    }
                }

                const cell = cells[cellIndex];
                const cellId = cell.metadata?.id;
                // Paratext cells use their parent's root index; content cells use their own
                let cellRootIndex: number | undefined = cellId != null ? cellIdToRootIndex.get(cellId) : undefined;
                if (cellRootIndex === undefined && cell.metadata?.type === CodexCellTypes.PARATEXT) {
                    const parentId = cell.metadata?.parentId ?? (cell.metadata?.data as { parentId?: string; } | undefined)?.parentId;
                    cellRootIndex = parentId != null ? cellIdToRootIndex.get(parentId) : undefined;
                }
                const subsectionIndex =
                    cellRootIndex !== undefined
                        ? Math.max(0, Math.floor(cellRootIndex / cellsPerPage))
                        : 0;

                return { milestoneIndex: i, subsectionIndex };
            }
        }

        // If cell is before first milestone, return milestone 0, subsection 0
        return { milestoneIndex: 0, subsectionIndex: 0 };
    }

    /**
     * Calculates progress for all milestones in the document.
     * 
     * @param minimumValidationsRequired Minimum number of validations required for text (default: 1)
     * @param minimumAudioValidationsRequired Minimum number of validations required for audio (default: 1)
     * @returns Record mapping milestone number (1-based) to progress percentages
     */
    public calculateMilestoneProgress(
        minimumValidationsRequired: number = 1,
        minimumAudioValidationsRequired: number = 1
    ): Record<number, {
        percentTranslationsCompleted: number;
        percentAudioTranslationsCompleted: number;
        percentFullyValidatedTranslations: number;
        percentAudioValidatedTranslations: number;
        percentTextValidatedTranslations: number;
    }> {
        const progress: Record<number, {
            percentTranslationsCompleted: number;
            percentAudioTranslationsCompleted: number;
            percentFullyValidatedTranslations: number;
            percentAudioValidatedTranslations: number;
            percentTextValidatedTranslations: number;
        }> = {};

        const cells = this._documentData.cells || [];
        const milestoneIndex = this.buildMilestoneIndex();

        // Calculate progress for each milestone
        for (let i = 0; i < milestoneIndex.milestones.length; i++) {
            const milestone = milestoneIndex.milestones[i];
            const nextMilestone = milestoneIndex.milestones[i + 1];

            // Get cell range for this milestone
            const startIndex = milestone.cellIndex;
            const endIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

            // Collect cells for this milestone (excluding milestone, paratext, and merged cells)
            const cellsForMilestone: QuillCellContent[] = [];
            for (let j = startIndex; j < endIndex; j++) {
                const cell = cells[j];
                if (shouldExcludeCellFromProgress(cell)) {
                    continue;
                }
                // Convert to QuillCellContent format
                const quillContent = convertCellToQuillContent(cell);
                cellsForMilestone.push(quillContent);
            }

            // Only root content cells count for progress (exclude paratext/child again for validation)
            const progressCells = cellsForMilestone.filter(
                (c) => !shouldExcludeQuillCellFromProgress(c)
            );
            const totalCells = progressCells.length;
            if (totalCells === 0) {
                // Milestone number is 1-based (i + 1)
                progress[i + 1] = {
                    percentTranslationsCompleted: 0,
                    percentAudioTranslationsCompleted: 0,
                    percentFullyValidatedTranslations: 0,
                    percentAudioValidatedTranslations: 0,
                    percentTextValidatedTranslations: 0,
                };
                continue;
            }

            // Count cells with content (translated)
            const cellsWithValues = progressCells.filter(
                (cell) =>
                    cell.cellContent &&
                    cell.cellContent.trim().length > 0 &&
                    cell.cellContent !== "<span></span>"
            ).length;

            // Count cells with audio
            const cellsWithAudioValues = progressCells.filter((cell) =>
                cellHasAudioUsingAttachments(
                    cell.attachments,
                    cell.metadata?.selectedAudioId
                )
            ).length;

            // Calculate validation data (only from root content cells)
            const cellWithValidatedData = progressCells.map((cell) => getCellValueData(cell));

            const { validatedCells, audioValidatedCells, fullyValidatedCells } =
                computeValidationStats(
                    cellWithValidatedData,
                    minimumValidationsRequired,
                    minimumAudioValidationsRequired
                );

            // Calculate progress percentages
            const progressPercentages = computeProgressPercents(
                totalCells,
                cellsWithValues,
                cellsWithAudioValues,
                validatedCells,
                audioValidatedCells,
                fullyValidatedCells
            );

            // Milestone number is 1-based (i + 1)
            progress[i + 1] = progressPercentages;
        }

        return progress;
    }

    /**
     * Calculates progress for all subsections (pages) within a milestone.
     * This is efficient as it only processes the cells needed for each subsection.
     * 
     * @param milestoneIndex The index of the milestone (0-based)
     * @param cellsPerPage Number of cells per page
     * @param minimumValidationsRequired Minimum validations required for text
     * @param minimumAudioValidationsRequired Minimum validations required for audio
     * @returns Record mapping subsection index (0-based) to progress percentages
     */
    public calculateSubsectionProgress(
        milestoneIndex: number,
        cellsPerPage: number = 50,
        minimumValidationsRequired: number = 1,
        minimumAudioValidationsRequired: number = 1
    ): Record<number, {
        percentTranslationsCompleted: number;
        percentAudioTranslationsCompleted: number;
        percentFullyValidatedTranslations: number;
        percentAudioValidatedTranslations: number;
        percentTextValidatedTranslations: number;
        textValidationLevels?: number[];
        audioValidationLevels?: number[];
        requiredTextValidations?: number;
        requiredAudioValidations?: number;
    }> {
        const progress: Record<number, {
            percentTranslationsCompleted: number;
            percentAudioTranslationsCompleted: number;
            percentFullyValidatedTranslations: number;
            percentAudioValidatedTranslations: number;
            percentTextValidatedTranslations: number;
            textValidationLevels?: number[];
            audioValidationLevels?: number[];
            requiredTextValidations?: number;
            requiredAudioValidations?: number;
        }> = {};

        const cells = this._documentData.cells || [];
        const milestoneInfo = this.buildMilestoneIndex(cellsPerPage);

        // Validate milestone index
        if (milestoneIndex < 0 || milestoneIndex >= milestoneInfo.milestones.length) {
            return progress;
        }

        const milestone = milestoneInfo.milestones[milestoneIndex];
        const nextMilestone = milestoneInfo.milestones[milestoneIndex + 1];

        // Get cell range for this milestone
        const startCellIndex = milestone.cellIndex;
        const endCellIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

        // Collect content cells for this milestone (excluding milestone, paratext, and merged cells)
        const contentCells: QuillCellContent[] = [];
        for (let i = startCellIndex; i < endCellIndex; i++) {
            const cell = cells[i];
            if (shouldExcludeCellFromProgress(cell)) {
                continue;
            }
            // Convert to QuillCellContent format
            const quillContent = convertCellToQuillContent(cell);
            contentCells.push(quillContent);
        }

        // Use root-based subsections to match getCellsForMilestone pagination
        const getContentCellParentId = (c: QuillCellContent) =>
            (c.metadata?.parentId as string | undefined) ?? (c.data?.parentId as string | undefined);
        const rootContentCells = contentCells.filter((c) => !getContentCellParentId(c));
        const totalSubsections = Math.ceil(rootContentCells.length / cellsPerPage);

        // Calculate progress for each subsection
        for (let subsectionIdx = 0; subsectionIdx < totalSubsections; subsectionIdx++) {
            const startRootIndex = subsectionIdx * cellsPerPage;
            const endRootIndex = Math.min(
                startRootIndex + cellsPerPage,
                rootContentCells.length
            );
            const rootsOnSubsection = rootContentCells.slice(startRootIndex, endRootIndex);
            const contentCellIdsForSubsection = new Set(
                rootsOnSubsection.map((c) => c.cellMarkers[0])
            );
            let addedDescendant: boolean;
            do {
                addedDescendant = false;
                for (const contentCell of contentCells) {
                    const parentId = getContentCellParentId(contentCell);
                    const cellId = contentCell.cellMarkers[0];
                    if (
                        parentId &&
                        contentCellIdsForSubsection.has(parentId) &&
                        cellId &&
                        !contentCellIdsForSubsection.has(cellId)
                    ) {
                        contentCellIdsForSubsection.add(cellId);
                        addedDescendant = true;
                    }
                }
            } while (addedDescendant);
            const subsectionCells = contentCells.filter((c) =>
                contentCellIdsForSubsection.has(c.cellMarkers[0])
            );

            // Only root content cells count for progress (exclude paratext/child for validation)
            const progressCells = subsectionCells.filter(
                (c) => !shouldExcludeQuillCellFromProgress(c)
            );
            const totalCells = progressCells.length;
            if (totalCells === 0) {
                progress[subsectionIdx] = {
                    percentTranslationsCompleted: 0,
                    percentAudioTranslationsCompleted: 0,
                    percentFullyValidatedTranslations: 0,
                    percentAudioValidatedTranslations: 0,
                    percentTextValidatedTranslations: 0,
                    textValidationLevels: [],
                    audioValidationLevels: [],
                    requiredTextValidations: minimumValidationsRequired,
                    requiredAudioValidations: minimumAudioValidationsRequired,
                };
                continue;
            }

            // Count cells with content (translated)
            const cellsWithValues = progressCells.filter(
                (cell) =>
                    cell.cellContent &&
                    cell.cellContent.trim().length > 0 &&
                    cell.cellContent !== "<span></span>"
            ).length;

            // Count cells with audio
            const cellsWithAudioValues = progressCells.filter((cell) =>
                cellHasAudioUsingAttachments(
                    cell.attachments,
                    cell.metadata?.selectedAudioId
                )
            ).length;

            // Calculate validation data (only from root content cells)
            const cellWithValidatedData = progressCells.map((cell) => getCellValueData(cell));

            const { validatedCells, audioValidatedCells, fullyValidatedCells } =
                computeValidationStats(
                    cellWithValidatedData,
                    minimumValidationsRequired,
                    minimumAudioValidationsRequired
                );

            // Compute per-level validation percentages for text and audio.
            // For text, only count validations on cells with actual content (same rule as computeValidationStats).
            const countNonDeleted = (arr: any[] | undefined) => (arr || []).filter((v: any) => !v.isDeleted).length;
            const textValidationCounts = cellWithValidatedData.map((c) =>
                hasTextContent(c.cellContent) ? countActiveValidations(c.validatedBy) : 0
            );
            const audioValidationCounts = cellWithValidatedData.map((c) => countNonDeleted(c.audioValidatedBy));

            const computeLevelPercents = (counts: number[], maxLevel: number) => {
                const levels: number[] = [];
                const total = totalCells > 0 ? totalCells : 1;
                for (let k = 1; k <= Math.max(0, maxLevel); k++) {
                    const satisfied = counts.filter((n) => n >= k).length;
                    levels.push((satisfied / total) * 100);
                }
                return levels;
            };

            const textValidationLevels = computeLevelPercents(textValidationCounts, minimumValidationsRequired);
            const audioValidationLevels = computeLevelPercents(audioValidationCounts, minimumAudioValidationsRequired);

            // Calculate progress percentages
            const progressPercentages = computeProgressPercents(
                totalCells,
                cellsWithValues,
                cellsWithAudioValues,
                validatedCells,
                audioValidatedCells,
                fullyValidatedCells
            );

            progress[subsectionIdx] = {
                ...progressPercentages,
                textValidationLevels,
                audioValidationLevels,
                requiredTextValidations: minimumValidationsRequired,
                requiredAudioValidations: minimumAudioValidationsRequired,
            };
        }

        return progress;
    }

    /**
     * Gets cells for a specific milestone and optional subsection.
     * Used for lazy loading cells on-demand.
     *
     * Pagination is by root content cells only (cells without parentId). Each page shows
     * N roots plus all their descendant content cells and paratext, so adding a child
     * (e.g. to cell 44) does not bump the last root (e.g. cell 50) to the next page.
     * Paratext cells appear on the same page as their associated content cell (including
     * paratext on child content cells).
     * 
     * @param milestoneIndex The index of the milestone (0-based)
     * @param subsectionIndex Optional subsection index for sub-pagination within milestone
     * @param cellsPerPage Number of cells per page
     * @returns Array of cells for the requested milestone/subsection
     */
    public getCellsForMilestone(
        milestoneIndex: number,
        subsectionIndex: number = 0,
        cellsPerPage: number = 50
    ): QuillCellContent[] {
        const cells = this._documentData.cells || [];
        const milestoneInfo = this.buildMilestoneIndex(cellsPerPage);

        // Validate milestone index
        if (milestoneIndex < 0 || milestoneIndex >= milestoneInfo.milestones.length) {
            console.warn(`Invalid milestone index: ${milestoneIndex}`);
            return [];
        }

        const milestone = milestoneInfo.milestones[milestoneIndex];
        const nextMilestone = milestoneInfo.milestones[milestoneIndex + 1];

        // Get all cells in this milestone section
        const startCellIndex = milestone.cellIndex;
        const endCellIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

        // Convert all cells in milestone range to QuillCellContent format
        // and separate into content cells and paratext cells
        const allCellsInMilestone: QuillCellContent[] = [];
        const paratextCells: QuillCellContent[] = [];
        const contentCells: QuillCellContent[] = [];

        for (let i = startCellIndex; i < endCellIndex; i++) {
            const cell = cells[i];

            // Skip milestone cells - they're not displayed
            if (cell.metadata?.type === CodexCellTypes.MILESTONE) {
                continue;
            }

            const quillContent = convertCellToQuillContent(cell);
            allCellsInMilestone.push(quillContent);

            // Separate paratext cells from content cells
            if (cell.metadata?.type === CodexCellTypes.PARATEXT) {
                paratextCells.push(quillContent);
            } else {
                contentCells.push(quillContent);
            }
        }

        // Helper: get parentId from a content cell (QuillCellContent)
        const getContentCellParentId = (cell: QuillCellContent): string | undefined =>
            (cell.metadata?.parentId as string | undefined) ??
            (cell.data?.parentId as string | undefined);

        // Paginate by root content cells only, so adding a child (e.g. to cell 44) does not bump
        // the last root (e.g. cell 50) to the next page. Each page shows N roots + all their descendants.
        const rootContentCells = contentCells.filter((c) => !getContentCellParentId(c));
        const totalSubsections = Math.ceil(rootContentCells.length / cellsPerPage);
        const validSubsectionIndex = Math.min(
            Math.max(0, subsectionIndex),
            Math.max(0, totalSubsections - 1)
        );

        const startRootIndex = validSubsectionIndex * cellsPerPage;
        const endRootIndex = Math.min(
            startRootIndex + cellsPerPage,
            rootContentCells.length
        );
        const rootsOnPage = rootContentCells.slice(startRootIndex, endRootIndex);

        // Include roots on this page and all their descendant content cells (children, grandchildren, etc.)
        const contentCellIdsForPage = new Set(
            rootsOnPage.map((cell) => cell.cellMarkers[0])
        );
        let addedDescendant: boolean;
        do {
            addedDescendant = false;
            for (const contentCell of contentCells) {
                const parentId = getContentCellParentId(contentCell);
                const cellId = contentCell.cellMarkers[0];
                if (
                    parentId &&
                    contentCellIdsForPage.has(parentId) &&
                    cellId &&
                    !contentCellIdsForPage.has(cellId)
                ) {
                    contentCellIdsForPage.add(cellId);
                    addedDescendant = true;
                }
            }
        } while (addedDescendant);

        // Build a map of parent cell ID -> paratext cells
        const paratextCellsByParent = new Map<string, QuillCellContent[]>();
        for (const paratextCell of paratextCells) {
            // Check metadata.parentId first (where parentId is stored for paratext cells)
            const cellMetadata = paratextCell.metadata || {};
            let parentId = cellMetadata.parentId as string | undefined;

            if (!parentId) {
                // Fall back to checking data.parentId (for backward compatibility with old data)
                const cellData = paratextCell.data;
                parentId = cellData?.parentId as string | undefined;
            }

            if (!parentId) {
                // Legacy: try to extract from ID format (for backward compatibility during migration)
                const extractedParentId = extractParentCellIdFromParatext(paratextCell.cellMarkers[0], cellMetadata);
                parentId = extractedParentId || undefined;
            }

            if (parentId) {
                if (!paratextCellsByParent.has(parentId)) {
                    paratextCellsByParent.set(parentId, []);
                }
                paratextCellsByParent.get(parentId)!.push(paratextCell);
            }
        }

        // Build a set of all cell IDs that should be included in the result
        // This includes content cells on the current page and their associated paratext cells
        const cellsToInclude = new Set<string>(contentCellIdsForPage);

        // Add paratext cells associated with content cells on the current page
        // (contentCellIdsForPage includes roots + descendants, so paratext of child cells is included)
        for (const contentCellId of contentCellIdsForPage) {
            const associatedParatextCells = paratextCellsByParent.get(contentCellId) || [];
            for (const paratextCell of associatedParatextCells) {
                cellsToInclude.add(paratextCell.cellMarkers[0]);
            }
        }

        // Filter allCellsInMilestone to only include cells that should be on this page
        // This maintains the original order while ensuring paratext cells and child content cells appear with their parent
        const result = allCellsInMilestone.filter(cell =>
            cellsToInclude.has(cell.cellMarkers[0])
        );

        return result;
    }

    /**
     * Gets all cells in a milestone (without pagination).
     * Used for calculating footnote offsets across pages.
     * 
     * @param milestoneIndex The index of the milestone (0-based)
     * @returns Array of all cells in the milestone
     */
    public getAllCellsForMilestone(milestoneIndex: number): QuillCellContent[] {
        const cells = this._documentData.cells || [];
        const milestoneInfo = this.buildMilestoneIndex(50); // Use default cellsPerPage for milestone info

        // Validate milestone index
        if (milestoneIndex < 0 || milestoneIndex >= milestoneInfo.milestones.length) {
            console.warn(`Invalid milestone index: ${milestoneIndex}`);
            return [];
        }

        const milestone = milestoneInfo.milestones[milestoneIndex];
        const nextMilestone = milestoneInfo.milestones[milestoneIndex + 1];

        // Get all cells in this milestone section
        const startCellIndex = milestone.cellIndex;
        const endCellIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

        // Convert all cells in milestone range to QuillCellContent format
        const allCellsInMilestone: QuillCellContent[] = [];

        for (let i = startCellIndex; i < endCellIndex; i++) {
            const cell = cells[i];

            // Skip milestone cells - they're not displayed
            if (cell.metadata?.type === CodexCellTypes.MILESTONE) {
                continue;
            }

            const quillContent = convertCellToQuillContent(cell);
            allCellsInMilestone.push(quillContent);
        }

        return allCellsInMilestone;
    }

    /**
     * Gets the total number of subsections for a milestone.
     * Uses root content cell count (excluding child content cells) so page count matches
     * root-based pagination in getCellsForMilestone.
     *
     * @param milestoneIndex The index of the milestone (0-based)
     * @param cellsPerPage Number of cells per page
     * @returns Number of subsections (pages) for this milestone
     */
    public getSubsectionCountForMilestone(milestoneIndex: number, cellsPerPage: number = 50): number {
        const cells = this._documentData.cells || [];
        const milestoneInfo = this.buildMilestoneIndex(cellsPerPage);

        if (milestoneIndex < 0 || milestoneIndex >= milestoneInfo.milestones.length) {
            return 0;
        }

        const milestone = milestoneInfo.milestones[milestoneIndex];
        const nextMilestone = milestoneInfo.milestones[milestoneIndex + 1];
        const startCellIndex = milestone.cellIndex;
        const endCellIndex = nextMilestone ? nextMilestone.cellIndex : cells.length;

        let rootContentCount = 0;
        for (let i = startCellIndex; i < endCellIndex; i++) {
            const cell = cells[i];
            if (
                cell.metadata?.type !== CodexCellTypes.MILESTONE &&
                cell.metadata?.type !== CodexCellTypes.PARATEXT
            ) {
                const parentId = cell.metadata?.parentId ?? (cell.metadata?.data as { parentId?: string; } | undefined)?.parentId;
                if (!parentId) {
                    rootContentCount++;
                }
            }
        }
        return Math.ceil(rootContentCount / cellsPerPage) || 1;
    }

    public updateCellLabel(cellId: string, newLabel: string) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Block label updates to locked cells
        if (cellToUpdate.metadata?.isLocked) {
            console.warn(`Attempted to update label of locked cell ${cellId}. Operation blocked.`);
            return;
        }

        // Update cell label in memory
        cellToUpdate.metadata.cellLabel = newLabel;

        // Add edit to cell's edit history
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }
        const currentTimestamp = Date.now();
        cellToUpdate.metadata.edits.push({
            editMap: EditMapUtils.cellLabel(),
            value: newLabel, // TypeScript infers: string
            timestamp: currentTimestamp,
            type: EditType.USER_EDIT,
            author: this._author,
            validatedBy: [
                {
                    username: this._author,
                    creationTimestamp: currentTimestamp,
                    updatedTimestamp: currentTimestamp,
                    isDeleted: false,
                },
            ],
        });

        // Record the edit
        this._edits.push({
            type: "updateCellLabel",
            cellId,
            newLabel,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, newLabel }],
        });
    }

    public updateCellIsLocked(cellId: string, isLocked: boolean) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to update");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Only persist isLocked when meaningful:
        // - If locking: store `true`
        // - If unlocking: store `false` only if the cell was previously locked at least once
        //   (otherwise omit the field entirely to avoid noisy metadata)
        const lockEditMap = EditMapUtils.isLocked();
        const edits = cellToUpdate.metadata?.edits || [];
        const wasEverLocked =
            cellToUpdate.metadata?.isLocked === true ||
            edits.some((e: any) => {
                const map = e?.editMap;
                const mapMatches =
                    Array.isArray(map) &&
                    map.length === lockEditMap.length &&
                    map.every((v: any, i: number) => v === (lockEditMap as any)[i]);
                return mapMatches && e?.value === true;
            });

        // If asked to "unlock" a cell that was never locked, treat as a no-op and
        // also remove any legacy `isLocked: false` field if present.
        if (!isLocked && !wasEverLocked) {
            delete (cellToUpdate.metadata as any).isLocked;
            return;
        }

        if (isLocked) {
            cellToUpdate.metadata.isLocked = true;
        } else if (wasEverLocked) {
            cellToUpdate.metadata.isLocked = false;
        } else {
            // Never locked → keep field absent
            delete (cellToUpdate.metadata as any).isLocked;
        }

        // Add edit to cell's edit history
        if (!cellToUpdate.metadata.edits) {
            cellToUpdate.metadata.edits = [];
        }
        const currentTimestamp = Date.now();
        cellToUpdate.metadata.edits.push({
            editMap: lockEditMap,
            value: isLocked, // TypeScript infers: boolean
            timestamp: currentTimestamp,
            type: EditType.USER_EDIT,
            author: this._author,
            validatedBy: [
                {
                    username: this._author,
                    creationTimestamp: currentTimestamp,
                    updatedTimestamp: currentTimestamp,
                    isDeleted: false,
                },
            ],
        });

        // Record the edit
        this._edits.push({
            type: "updateCellIsLocked",
            cellId,
            isLocked,
        });

        // Set dirty flag and notify listeners about the change
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: [{ cellId, isLocked }],
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
            // repair the edit history by adding an llm generation with author unknown, and then a user edit with validation
            const currentTimestamp = Date.now();
            cellToUpdate.metadata.edits = [
                {
                    editMap: EditMapUtils.value(),
                    value: cellToUpdate.value,
                    timestamp: currentTimestamp,
                    type: EditType.LLM_GENERATION,
                    author: "unknown",
                    validatedBy: [],
                },
                {
                    editMap: EditMapUtils.value(),
                    value: cellToUpdate.value,
                    timestamp: currentTimestamp,
                    type: EditType.USER_EDIT,
                    author: this._author,
                    validatedBy: [],
                },
            ];
        }

        // Find the correct edit corresponding to the CURRENT VALUE of the cell
        // We must NOT validate metadata-only edits (e.g., label/timestamp). Validate the value edit
        // whose value matches the current cell value.
        let targetEditIndex = -1;
        for (let i = cellToUpdate.metadata.edits.length - 1; i >= 0; i--) {
            const e = cellToUpdate.metadata.edits[i];
            // Identify value edits using EditMapUtils and also match the exact value
            const isValueEdit = EditMapUtils.isValue
                ? EditMapUtils.isValue(e.editMap)
                : EditMapUtils.equals(e.editMap, EditMapUtils.value());
            if (isValueEdit && e.value === cellToUpdate.value) {
                targetEditIndex = i;
                break;
            }
        }

        // If we didn't find a value edit that matches current value, create one so validation history is consistent
        if (targetEditIndex === -1) {
            const currentTimestamp = Date.now();
            cellToUpdate.metadata.edits.push({
                editMap: EditMapUtils.value(),
                value: cellToUpdate.value,
                timestamp: currentTimestamp,
                type: EditType.USER_EDIT,
                author: this._author,
                validatedBy: [],
            } as any);
            targetEditIndex = cellToUpdate.metadata.edits.length - 1;
        }

        const latestEdit = cellToUpdate.metadata.edits[targetEditIndex];

        // Initialize validation arrays if they don't exist
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

        // Invalidate milestone index cache since validation changes affect progress calculations
        // The milestone structure doesn't change, but progress needs to be recalculated
        this.invalidateMilestoneIndexCache();

        // Mark document as dirty
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);

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
        debug(`[CodexDocument] 🔍 Validation change for cell ${cellId}:`, {
            validate,
            username,
            validationCount: latestEdit.validatedBy.filter(entry => this.isValidValidationEntry(entry) && !entry.isDeleted).length,
            cellHasContent: !!(cellToUpdate.value && cellToUpdate.value.trim()),
            editsCount: cellToUpdate.metadata.edits.length
        });

        // Database update will happen automatically when document is saved
    }

    // Method to validate a cell's audio by a user
    public async validateCellAudio(cellId: string, validate: boolean = true) {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error("Could not find cell to validate audio");
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Get the current audio attachment for this cell
        const currentAttachment = this.getCurrentAttachment(cellId, "audio");
        if (!currentAttachment) {
            throw new Error("No audio attachment found for cell to validate");
        }

        const { attachmentId, attachment } = currentAttachment;

        // Initialize validation array if it doesn't exist
        if (!attachment.validatedBy) {
            attachment.validatedBy = [];
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
            console.error("Could not get user info in validateCellAudio", e);
        }

        // Find existing audio validation entry for this user
        const existingEntryIndex = attachment.validatedBy.findIndex(
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
                attachment.validatedBy.push(newValidationEntry);
            } else {
                // User already has an entry, update it
                attachment.validatedBy[existingEntryIndex].updatedTimestamp = currentTimestamp;
                attachment.validatedBy[existingEntryIndex].isDeleted = false;
            }
        } else {
            if (existingEntryIndex !== -1) {
                // User is in the array, mark as deleted
                attachment.validatedBy[existingEntryIndex].updatedTimestamp = currentTimestamp;
                attachment.validatedBy[existingEntryIndex].isDeleted = true;
            }
            // If user is not in the array, do nothing when unvalidating
        }

        // Final check: ensure the validatedBy array only contains valid ValidationEntry objects
        attachment.validatedBy = attachment.validatedBy.filter((entry: any) =>
            this.isValidValidationEntry(entry)
        );

        // Update the attachment in the cell metadata
        if (!cellToUpdate.metadata.attachments) {
            cellToUpdate.metadata.attachments = {};
        }
        cellToUpdate.metadata.attachments[attachmentId] = attachment;

        // Mark document as dirty
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);

        // Notify listeners that the document has changed
        this._onDidChangeForVsCodeAndWebview.fire({
            content: JSON.stringify({
                cellId,
                type: "audioValidation",
                validatedBy: attachment.validatedBy,
            }),
            edits: [
                {
                    cellId,
                    type: "audioValidation",
                    validatedBy: attachment.validatedBy,
                },
            ],
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
                    if (cell.metadata?.id) {
                        this._dirtyCellIds.add(cell.metadata.id);
                    }
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

    public getCellAudioValidatedBy(cellId: string): ValidationEntry[] {
        const currentAttachment = this.getCurrentAttachment(cellId, "audio");

        if (!currentAttachment || !Array.isArray(currentAttachment.attachment?.validatedBy)) {
            return [];
        }

        return currentAttachment.attachment.validatedBy.filter((entry: any) =>
            this.isValidValidationEntry(entry)
        );
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

    /**
     * Gets a cell by its index position in the cells array.
     * @param index The 0-based index of the cell in the cells array
     * @returns The cell at the specified index, or undefined if index is out of bounds
     */
    public getCellByIndex(index: number): CustomNotebookCellData | undefined {
        const cells = this._documentData.cells || [];
        if (index < 0 || index >= cells.length) {
            return undefined;
        }
        return cells[index];
    }

    public updateCellData(cellId: string, newData: any): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to update data`);
        }

        const cellToUpdate = this._documentData.cells[indexOfCellToUpdate];

        // Block data updates to locked cells
        if (cellToUpdate.metadata?.isLocked) {
            console.warn(`Attempted to update data of locked cell ${cellId}. Operation blocked.`);
            return;
        }

        // Check if this is a milestone cell and if we're modifying data that affects milestone index
        const isMilestoneCell = cellToUpdate.metadata?.type === CodexCellTypes.MILESTONE;
        const isModifyingDeletedFlag = 'deleted' in newData;
        const shouldInvalidateCache = isMilestoneCell && isModifyingDeletedFlag;

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

        // Invalidate milestone index cache if milestone cell's deleted flag was modified
        if (shouldInvalidateCache) {
            this.invalidateMilestoneIndexCache();
        }

        this._isDirty = true;
        this._dirtyCellIds.add(cellId);

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
    public updateCellAttachment(
        cellId: string,
        attachmentId: string,
        attachmentData: { url: string; type: string; createdAt: number; updatedAt: number; isDeleted: boolean; metadata?: Record<string, any>; createdBy?: string; }
    ): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to update attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Block attachment updates to locked cells
        if (cell.metadata?.isLocked) {
            console.warn(`Attempted to update attachment of locked cell ${cellId}. Operation blocked.`);
            return;
        }

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

        // Auto-select new audio recordings (overrides any existing selection)
        if (attachmentData.type === "audio" && cell.metadata) {
            cell.metadata.selectedAudioId = attachmentId;
            cell.metadata.selectionTimestamp = Date.now();
        }

        // Record the edit
        this._edits.push({
            type: "updateCellAttachment",
            cellId,
            attachmentId,
            attachmentData,
        });

        // Mark as dirty and notify listeners
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
    }

    /**
     * Soft deletes an attachment by setting isDeleted to true
     * @param cellId The ID of the cell to update
     * @param attachmentId The unique ID of the attachment to soft delete
     */
    public softDeleteCellAttachment(cellId: string, attachmentId: string): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to soft delete attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Check if attachments exist
        if (!cell.metadata?.attachments || !cell.metadata.attachments[attachmentId]) {
            console.warn(`Attachment ${attachmentId} not found in cell ${cellId}`);
            return;
        }

        // Soft delete the attachment by setting isDeleted to true and updating timestamp
        const attachment = cell.metadata.attachments[attachmentId];
        attachment.isDeleted = true;
        attachment.updatedAt = Date.now();

        // If we're deleting the selected audio, clear the selection (fall back to automatic)
        if (attachment.type === "audio" && cell.metadata?.selectedAudioId === attachmentId) {
            delete cell.metadata.selectedAudioId;
            delete cell.metadata.selectionTimestamp;
        }

        // Record the edit
        this._edits.push({
            type: "softDeleteCellAttachment",
            cellId,
            attachmentId,
        });

        // Mark as dirty and notify both VS Code and webview so the change is persisted
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });

        // Audio attachment changes don't affect AI learning (only text content and validation data matter)
    }

    /**
     * Gets the current attachment for a cell (either explicitly selected or latest non-deleted)
     * @param cellId The ID of the cell
     * @param attachmentType The type of attachment (e.g., "audio")
     * @returns The current attachment or null if none found
     */
    public getCurrentAttachment(cellId: string, attachmentType: string): { attachmentId: string; attachment: any; } | null {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );

        if (!cell?.metadata?.attachments) {
            return null;
        }

        // STEP 1: Check for explicit selection first
        if (cell.metadata?.selectedAudioId && attachmentType === "audio") {
            const selectedAttachment = cell.metadata.attachments?.[cell.metadata.selectedAudioId];

            // Validate selection is still valid
            if (selectedAttachment &&
                selectedAttachment.type === attachmentType &&
                !selectedAttachment.isDeleted) {
                return {
                    attachmentId: cell.metadata.selectedAudioId,
                    attachment: selectedAttachment
                };
            }

            // Selection is invalid - we'll clean it up later, but don't modify state during read operation
            // Note: Invalid selection cleanup is deferred to avoid modifying document during initialization
        }

        // STEP 2: Fall back to latest non-deleted (automatic behavior)
        const attachments = Object.entries(cell.metadata.attachments)
            .filter(([_, attachment]: [string, any]) =>
                attachment &&
                attachment.type === attachmentType &&
                !attachment.isDeleted
            )
            .sort(([_, a]: [string, any], [__, b]: [string, any]) =>
                (b.updatedAt || 0) - (a.updatedAt || 0)
            );

        if (attachments.length === 0) {
            return null;
        }

        const [attachmentId, attachment] = attachments[0];
        return { attachmentId, attachment };
    }

    /**
     * Gets all attachments (including deleted ones) for a cell, sorted by timestamp
     * @param cellId The ID of the cell
     * @param attachmentType The type of attachment (e.g., "audio")
     * @returns Array of attachment history entries
     */
    public getAttachmentHistory(cellId: string, attachmentType: string): Array<{ attachmentId: string; attachment: any; }> {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );

        if (!cell?.metadata?.attachments) {
            return [];
        }

        try {
            // Get all attachments of the specified type, sorted by createdAt (newest first)
            return Object.entries(cell.metadata.attachments)
                .filter(([_, attachment]: [string, any]) =>
                    attachment && attachment.type === attachmentType
                )
                .sort(([_, a]: [string, any], [__, b]: [string, any]) =>
                    (b.createdAt || 0) - (a.createdAt || 0)
                )
                .map(([attachmentId, attachment]) => ({ attachmentId, attachment }));
        } catch (error) {
            console.error(`Error getting attachment history for ${cellId}:`, error);
            return [];
        }
    }

    /**
     * Restores a soft-deleted attachment
     * @param cellId The ID of the cell
     * @param attachmentId The unique ID of the attachment to restore
     */
    public restoreCellAttachment(cellId: string, attachmentId: string): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to restore attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Check if attachments exist
        if (!cell.metadata?.attachments || !cell.metadata.attachments[attachmentId]) {
            console.warn(`Attachment ${attachmentId} not found in cell ${cellId}`);
            return;
        }

        // Restore the attachment by setting isDeleted to false and updating timestamp
        const attachment = cell.metadata.attachments[attachmentId];
        attachment.isDeleted = false;
        attachment.updatedAt = Date.now();

        // Record the edit
        this._edits.push({
            type: "restoreCellAttachment",
            cellId,
            attachmentId,
        });

        // Mark as dirty and notify VS Code (so the file is persisted) and the webview
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });

        // Audio attachment changes don't affect AI learning (only text content and validation data matter)
    }

    /**
     * Explicitly selects an audio attachment for a cell
     * @param cellId The ID of the cell
     * @param audioId The unique ID of the audio attachment to select
     */
    public selectAudioAttachment(cellId: string, audioId: string): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to select audio attachment`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        // Validate the attachment exists and is audio
        if (!cell.metadata?.attachments || !cell.metadata.attachments[audioId]) {
            throw new Error(`Audio attachment ${audioId} not found in cell ${cellId}`);
        }

        const attachment = cell.metadata.attachments[audioId];
        if (attachment.type !== "audio") {
            throw new Error(`Attachment ${audioId} is not an audio attachment`);
        }

        if (attachment.isDeleted) {
            throw new Error(`Cannot select deleted audio attachment ${audioId}`);
        }

        // Set the explicit selection with timestamp
        cell.metadata.selectedAudioId = audioId;
        cell.metadata.selectionTimestamp = Date.now();

        // Record the edit
        this._edits.push({
            type: "selectAudioAttachment",
            cellId,
            audioId,
        });

        // Mark as dirty and notify VS Code (so the file is persisted) and the webview
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });

        // Audio attachment changes don't affect AI learning (only text content and validation data matter)
    }

    /**
     * Clears the explicit audio selection for a cell (falls back to automatic behavior)
     * @param cellId The ID of the cell
     */
    public clearAudioSelection(cellId: string): void {
        const indexOfCellToUpdate = this._documentData.cells.findIndex(
            (cell) => cell.metadata?.id === cellId
        );

        if (indexOfCellToUpdate === -1) {
            throw new Error(`Could not find cell ${cellId} to clear audio selection`);
        }

        const cell = this._documentData.cells[indexOfCellToUpdate];

        if (!cell.metadata?.selectedAudioId) {
            return; // Nothing to clear
        }

        delete cell.metadata.selectedAudioId;
        delete cell.metadata.selectionTimestamp;

        // Record the edit
        this._edits.push({
            type: "clearAudioSelection",
            cellId,
        });

        // Mark as dirty and notify listeners
        this._isDirty = true;
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
    }

    /**
     * Gets the explicitly selected audio ID for a cell (null if using automatic selection)
     * @param cellId The ID of the cell
     * @returns The explicitly selected audio ID or null
     */
    public getExplicitAudioSelection(cellId: string): string | null {
        const cell = this._documentData.cells.find(
            (cell) => cell.metadata?.id === cellId
        );

        return cell?.metadata?.selectedAudioId ?? null;
    }

    /**
     * Cleans up invalid audio selections for all cells (safe to call during document operations)
     * This is separated from getCurrentAttachment to avoid modifying state during read operations
     */
    public cleanupInvalidAudioSelections(): void {
        try {
            let hasChanges = false;

            for (const cell of this._documentData.cells) {
                if (!cell.metadata?.selectedAudioId || !cell.metadata.attachments) {
                    continue;
                }

                const selectedAttachment = cell.metadata.attachments[cell.metadata.selectedAudioId];

                // Check if selection is invalid (deleted, wrong type, or missing)
                if (!selectedAttachment ||
                    selectedAttachment.type !== "audio" ||
                    selectedAttachment.isDeleted) {

                    delete cell.metadata.selectedAudioId;
                    delete cell.metadata.selectionTimestamp;
                    hasChanges = true;
                    if (cell.metadata?.id) {
                        this._dirtyCellIds.add(cell.metadata.id);
                    }
                }
            }

            if (hasChanges) {
                this._isDirty = true;
                this._onDidChangeForVsCodeAndWebview.fire({
                    edits: this._edits,
                });
            }
        } catch (error) {
            console.error("Error cleaning up invalid audio selections:", error);
        }
    }

    /**
     * Removes an attachment from a cell's metadata (hard delete - use softDeleteCellAttachment instead)
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
        this._dirtyCellIds.add(cellId);
        this._onDidChangeForVsCodeAndWebview.fire({
            edits: this._edits,
        });
    }

    /**
     * Determines if this document is a source or target file based on the URI
     */
    private getContentType(): "source" | "target" {
        const uriString = this.uri.toString();
        return uriString.includes(".source") ? "source" : "target";
    }


    // Sync only dirty (modified) cells to the database on save.
    // Previously this synced ALL cells on every save, causing ~390MB of disk writes
    // for a single character edit (1,596 cells × full FTS5 upsert each).
    // Now it only syncs cells that were actually modified since the last save.
    private async syncDirtyCellsToDatabase(): Promise<void> {
        try {
            // Snapshot and clear the dirty set immediately so edits during sync
            // are captured in the next save cycle
            const dirtyIds = new Set(this._dirtyCellIds);
            this._dirtyCellIds.clear();

            if (dirtyIds.size === 0) {
                debug(`[CodexDocument] No dirty cells to sync — skipping database update`);
                return;
            }

            // Try to acquire index manager and flush any pending ops from earlier failures
            const indexManager = await this.acquireIndexManagerAndFlush();
            if (!indexManager) {
                // Re-add dirty IDs so they aren't lost — they'll be retried on the next save
                for (const id of dirtyIds) {
                    this._dirtyCellIds.add(id);
                }
                console.warn(`[CodexDocument] Index manager not available for AI learning — ${dirtyIds.size} dirty cells re-queued`);
                return;
            }

            let syncedCells = 0;
            let syncedValidations = 0;

            // Wrap all DB writes (file upsert + cell upserts + FTS syncs)
            // in a single transaction so a crash or concurrent write can't
            // leave partial state in the database.
            await indexManager.runInTransaction(async () => {
                // Get file ID (inside the transaction so it's atomic with cell writes).
                // Use upsertFileSync (not upsertFile) to avoid disk I/O while
                // holding the transaction lock.
                let fileId = this._cachedFileId;
                if (!fileId) {
                    fileId = await indexManager.upsertFileSync(
                        this.uri.toString(),
                        "codex",
                        Date.now()
                    );
                    this._cachedFileId = fileId;
                }

                // Only process cells that were modified since the last save
                for (const cell of this._documentData.cells!) {
                    const cellId = cell.metadata?.id;

                    if (!cellId || !dirtyIds.has(cellId)) {
                        continue;
                    }

                    const hasContent = !!(cell.value && cell.value.trim() !== '');

                    const activeAudioValidators = (cell.metadata?.attachments &&
                        Object.values(cell.metadata.attachments).flatMap((attachment: any) => {
                            if (
                                !attachment ||
                                attachment.type !== "audio" ||
                                attachment.isDeleted ||
                                !Array.isArray(attachment.validatedBy)
                            ) {
                                return [];
                            }
                            return attachment.validatedBy.filter((entry: any) =>
                                entry &&
                                !entry.isDeleted &&
                                typeof entry.username === "string" &&
                                entry.username.trim().length > 0
                            );
                        })) || [];

                    const hasAudioValidation = activeAudioValidators.length > 0;

                    if (!hasContent && !hasAudioValidation) {
                        continue;
                    }

                    try {
                        // Calculate logical line position only when we have textual content
                        let logicalLinePosition: number | null = null;
                        if (hasContent) {
                            const cellIndex = this._documentData.cells!.findIndex((c) => c.metadata?.id === cellId);

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
                        }

                        // Prepare metadata for database - this will handle validation extraction
                        const cellMetadata = {
                            edits: cell.metadata?.edits || [],
                            attachments: cell.metadata?.attachments || {},
                            selectedAudioId: cell.metadata?.selectedAudioId,
                            selectionTimestamp: cell.metadata?.selectionTimestamp,
                            type: cell.metadata?.type || null,
                            lastUpdated: Date.now(),
                        };

                        // Check if this cell has text validation data for logging
                        const edits = cell.metadata?.edits;
                        const lastEdit = edits && edits.length > 0 ? edits[edits.length - 1] : null;
                        const hasTextValidation = lastEdit?.validatedBy && lastEdit.validatedBy.length > 0;

                        if (hasTextValidation && lastEdit?.validatedBy) {
                            syncedValidations++;
                        }

                        if (hasAudioValidation) {
                            syncedValidations++;
                        }

                        // Sanitize content for search
                        const sanitizedContent = hasContent ? this.sanitizeContent(cell.value) : "";

                        const rawContentForSync = hasContent
                            ? cell.value ?? ""
                            : JSON.stringify({
                                audioOnlyValidation: true,
                                attachments: cell.metadata?.attachments ?? {},
                            });

                        await indexManager.upsertCellWithFTSSync(
                            cellId,
                            fileId,
                            this.getContentType(),
                            sanitizedContent,
                            hasContent ? logicalLinePosition ?? undefined : undefined,
                            cellMetadata,
                            rawContentForSync
                        );

                        syncedCells++;
                    } catch (error) {
                        console.error(`[CodexDocument] Error during AI learning for cell ${cellId}:`, error);
                        // Re-add the failed cell so it is retried on the next save
                        this._dirtyCellIds.add(cellId);
                    }
                }
            });

            debug(`[CodexDocument] AI knowledge updated: synced ${syncedCells} dirty cells (of ${dirtyIds.size} marked), ${syncedValidations} with validation data`);

        } catch (error) {
            console.error(`[CodexDocument] Error during AI learning:`, error);
        }
    }
}
