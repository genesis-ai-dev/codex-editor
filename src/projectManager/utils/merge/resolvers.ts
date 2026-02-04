import { CodexCellDocument } from './../../../providers/codexCellEditorProvider/codexDocument';
import * as vscode from "vscode";
import * as path from "path";
import { ConflictResolutionStrategy, ConflictFile } from "./types";
import { determineStrategy } from "./strategies";
import { getAuthApi } from "../../../extension";
import { NotebookCommentThread, NotebookComment, CustomNotebookCellData, CustomNotebookMetadata } from "../../../../types";
import { CommentsMigrator } from "../../../utils/migrations/commentsMigrationUtils";
import { CodexCell } from "@/utils/codexNotebookUtils";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import { EditHistory, ValidationEntry, FileEditHistory, ProjectEditHistory } from "../../../../types/index.d";
import { EditMapUtils, deduplicateFileMetadataEdits } from "../../../utils/editMapUtils";
import { normalizeAttachmentUrl } from "@/utils/pathUtils";
import { formatJsonForNotebookFile } from "../../../utils/notebookFileFormattingUtils";
import {
    buildCellPositionContextMap,
    insertUniqueCellsPreservingRelativePositions,
} from "./utils/positionPreservationUtils";

const DEBUG_MODE = false;
function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Resolvers]", ...args);
    }
}

/**
 * Gets the current user name from git config or VS Code settings
 */
async function getCurrentUserName(): Promise<string> {
    try {
        // Try auth API first
        const authApi = await getAuthApi();
        const userInfo = await authApi?.getUserInfo();
        if (userInfo?.username) {
            return userInfo.username;
        }
    } catch (error) {
        // Silent fallback
    }

    // Fallback
    return "unknown";
}

/**
 * Type guard to check if a value is a ValidationEntry
 */
function isValidValidationEntry(value: any): value is ValidationEntry {
    return (
        value !== null &&
        typeof value === "object" &&
        typeof value.username === "string" &&
        typeof value.creationTimestamp === "number" &&
        typeof value.updatedTimestamp === "number" &&
        typeof value.isDeleted === "boolean"
    );
}

/**
 * Merges two validatedBy arrays into a single list, deduplicated by username and
 * selecting the most recent entry per user. If one side has a string username,
 * it is converted to a ValidationEntry with current timestamps.
 */
function mergeValidatedByLists(
    existing?: any[] | undefined,
    incoming?: any[] | undefined
): ValidationEntry[] | undefined {
    const toEntry = (v: any): ValidationEntry | undefined => {
        if (isValidValidationEntry(v)) return v;
        if (typeof v === "string") {
            const now = Date.now();
            return {
                username: v,
                creationTimestamp: now,
                updatedTimestamp: now,
                isDeleted: false,
            };
        }
        return undefined;
    };

    const existingEntries = (existing || [])
        .map(toEntry)
        .filter((e): e is ValidationEntry => !!e);
    const incomingEntries = (incoming || [])
        .map(toEntry)
        .filter((e): e is ValidationEntry => !!e);

    if (existingEntries.length === 0 && incomingEntries.length === 0) {
        return undefined;
    }

    const byUser = new Map<string, ValidationEntry>();
    const consider = (e: ValidationEntry) => {
        const prev = byUser.get(e.username);
        if (!prev) {
            byUser.set(e.username, e);
            return;
        }
        // Prefer the entry with the latest updatedTimestamp; preserve original creationTimestamp
        if (e.updatedTimestamp > prev.updatedTimestamp) {
            byUser.set(e.username, {
                ...e,
                creationTimestamp: prev.creationTimestamp,
            });
        }
    };

    existingEntries.forEach(consider);
    incomingEntries.forEach(consider);

    // Return stable order by username to minimize diffs
    return Array.from(byUser.values()).sort((a, b) => a.username.localeCompare(b.username));
}

/**
 * Type guard to check if a conflict object is valid
 */
function isValidConflict(conflict: any): conflict is ConflictFile {
    return (
        conflict &&
        typeof conflict.filepath === "string" &&
        typeof conflict.ours === "string" &&
        typeof conflict.theirs === "string" &&
        typeof conflict.base === "string"
    );
}

/**
 * Generates a unique ID for comments
 */
function generateCommentId(): string {
    return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Converts a thread title date string to a timestamp
 * Assumes the date is in the user's local timezone
 */
function threadTitleToTimestamp(threadTitle: string): number | null {
    try {
        // Parse date string like "7/28/2025, 1:34:46 PM"
        const date = new Date(threadTitle);
        if (!isNaN(date.getTime())) {
            return date.getTime();
        }
    } catch (error) {
        debugLog("Failed to parse thread title date:", threadTitle, error);
    }
    return null;
}

/**
 * Migrates old comment format to new format with unique IDs and timestamps
 */
function migrateComment(
    comment: any,
    threadTitle?: string,
    commentIndex: number = 0
): NotebookComment {
    // If already has string ID and timestamp, it's already migrated
    if (typeof comment.id === 'string' && typeof comment.timestamp === 'number') {
        return comment as NotebookComment;
    }

    // Generate new UUID in the same format as modern comments
    const newId = generateCommentId();

    // Calculate timestamp
    let timestamp: number;
    if (comment.timestamp) {
        timestamp = comment.timestamp;
    } else if (threadTitle) {
        const baseTimestamp = threadTitleToTimestamp(threadTitle);
        if (baseTimestamp) {
            // Add 5ms * (index + 1) to space out comments
            timestamp = baseTimestamp + (5 * (commentIndex + 1));
        } else {
            // Fallback to current time minus some offset
            timestamp = Date.now() - (1000 * 60 * 60 * 24) - (5 * (commentIndex + 1));
        }
    } else {
        // Ultimate fallback
        timestamp = Date.now() - (1000 * 60 * 60 * 24) - (5 * (commentIndex + 1));
    }

    return {
        id: newId,
        timestamp,
        body: comment.body,
        mode: comment.mode || 1,
        deleted: comment.deleted || false,
        author: comment.author || { name: "Unknown" }
    };
}

/**
 * Checks if comments need migration (don't have timestamps)
 */
function needsMigration(threads: any[]): boolean {
    // Check if ANY comment is missing a timestamp or has a numeric ID
    // or if thread has old deleted/resolved boolean fields
    return threads.some(thread =>
        ('deleted' in thread) ||
        ('resolved' in thread) ||
        (thread.comments && thread.comments.some((comment: any) =>
            typeof comment.timestamp !== 'number' || typeof comment.id === 'number'
        ))
    );
}

/**
 * Determines if a comment was recently migrated from legacy format
 * Legacy comments have generated UUIDs with timestamp-based IDs and calculated timestamps
 */
function isLegacyComment(comment: any): boolean {
    // Check if it still has numeric ID (definitely legacy)
    if (typeof comment.id === 'number') {
        return true;
    }

    // For timestamp-based IDs, check the relationship between ID timestamp and comment timestamp
    if (typeof comment.id === 'string' && comment.id.includes('-')) {
        const idTimestamp = parseInt(comment.id.split('-')[0]);
        if (!isNaN(idTimestamp)) {
            const timeDiff = Math.abs(comment.timestamp - idTimestamp);

            // Modern comments: ID timestamp = comment timestamp (same moment)
            // Legacy comments: ID timestamp ≠ comment timestamp (calculated during migration)
            return timeDiff >= 100; // Different times = legacy migration
        }
    }

    return false;
}

/**
 * Checks if two comments are duplicates
 */
function areCommentsDuplicate(comment1: NotebookComment, comment2: NotebookComment): boolean {
    return comment1.body === comment2.body &&
        comment1.author.name === comment2.author.name &&
        !comment1.deleted && !comment2.deleted;
}

/**
 * Resolves merge conflicts for a specific file based on its determined strategy
 */
export type ResolveConflictOptions = {
    /**
     * When true (default), re-read the on-disk file to refresh conflict.ours before merging.
     * This is useful for sync, so recent user edits aren't lost.
     *
     * When false, uses the provided conflict.ours as-is (required for heal, where ours is a snapshot).
     */
    refreshOursFromDisk?: boolean;
};

export async function resolveConflictFile(
    conflict: ConflictFile,
    workspaceDir: string,
    options?: ResolveConflictOptions
): Promise<string | undefined> {
    try {
        // No need to read files, we already have the content
        const strategy = determineStrategy(conflict.filepath);
        debugLog("Strategy:", strategy);
        let resolvedContent: string;

        const refreshOursFromDisk = options?.refreshOursFromDisk !== false;
        if (refreshOursFromDisk) {
            // Ensure we have fresh content by re-reading the file
            const normalizedFilepath = conflict.filepath.replace(/\\/g, "/").replace(/^\/+/, "");
            const filePath = vscode.Uri.joinPath(
                vscode.Uri.file(workspaceDir),
                ...normalizedFilepath.split("/")
            );
            try {
                // Note: this is to ensure we have the latest content so recent user edits are not lost
                const latestFileContent = await vscode.workspace.fs.readFile(filePath);
                conflict.ours = Buffer.from(latestFileContent).toString('utf8');
            } catch (error) {
                debugLog(`Could not read fresh content for ${conflict.filepath}, using existing content:`, error);
            }
        }

        switch (strategy) {
            case ConflictResolutionStrategy.IGNORE:
                debugLog("Ignoring conflict for:", conflict.filepath);
                resolvedContent = conflict.ours; // Keep our version
                break;

            case ConflictResolutionStrategy.SOURCE:
            case ConflictResolutionStrategy.OVERRIDE: {
                debugLog("Resolving conflict for:", conflict.filepath);
                // TODO: Compare content timestamps if embedded in the content
                // For now, default to our version
                resolvedContent = conflict.ours;
                break;
            }

            case ConflictResolutionStrategy.JSONL: {
                debugLog("Resolving JSONL conflict for:", conflict.filepath);
                // Parse and merge JSONL content
                const ourLines = conflict.ours.split("\n").filter(Boolean);
                const theirLines = conflict.theirs.split("\n").filter(Boolean);

                // Combine and deduplicate
                const allLines = new Set([...ourLines, ...theirLines]);
                resolvedContent = Array.from(allLines).join("\n");
                break;
            }

            case ConflictResolutionStrategy.ARRAY: {
                debugLog("Resolving array conflict for:", conflict.filepath);
                // Special handling for notebook comment thread arrays
                resolvedContent = await resolveCommentThreadsConflict(
                    conflict.ours,
                    conflict.theirs
                );
                break;
            }

            // SPECIAL = "special", // Merge based on timestamps/rules (currently only metadata.json)
            case ConflictResolutionStrategy.SPECIAL: {
                debugLog("Resolving special conflict for:", conflict.filepath);
                if (conflict.filepath === "metadata.json") {
                    resolvedContent = await resolveMetadataJsonConflict(conflict);
                } else {
                    // Fallback to OVERRIDE for unknown files
                    resolvedContent = conflict.ours;
                }
                break;
            }

            // CODEX_CUSTOM_MERGE = "codex", // Special merge process for cell arrays
            case ConflictResolutionStrategy.CODEX_CUSTOM_MERGE: {
                debugLog("Resolving codex custom merge for:", conflict.filepath);
                resolvedContent = await resolveCodexCustomMerge(conflict.ours, conflict.theirs);
                debugLog("Successfully merged codex content");
                break;
            }

            // JSON_MERGE_3WAY = "json-merge-3way", // 3-way merge for JSON settings
            case ConflictResolutionStrategy.JSON_MERGE_3WAY: {
                debugLog("Resolving JSON 3-way merge for:", conflict.filepath);
                resolvedContent = await resolveSettingsJsonConflict(conflict);
                debugLog("Successfully merged settings.json with 3-way merge");
                break;
            }

            default:
                resolvedContent = conflict.ours; // Default to our version
        }

        // Write resolved content back to the actual file
        const targetPath = vscode.Uri.file(path.join(workspaceDir, conflict.filepath));
        debugLog("Writing resolved content to:", targetPath.fsPath);
        await vscode.workspace.fs.writeFile(targetPath, Buffer.from(resolvedContent));
        debugLog("Successfully wrote content for:", conflict.filepath);

        return conflict.filepath;
    } catch (e) {
        console.error(`Error resolving conflict for ${conflict.filepath}:`, e);
        vscode.window.showErrorMessage(`Failed to resolve conflict in ${conflict.filepath}`);
        return undefined;
    }
}

/**
 * Helper function to check if content contains old format edits that need migration
 */
function needsEditHistoryMigration(content: string): boolean {
    try {
        const notebook = JSON.parse(content);
        const cells: CodexCell[] = notebook.cells || [];

        for (const cell of cells) {
            if (cell.metadata?.edits && cell.metadata.edits.length > 0) {
                for (const edit of cell.metadata.edits) {
                    // Check if this is an old format edit (has cellValue but no editMap)
                    if ((edit as any).cellValue !== undefined && !edit.editMap) {
                        return true;
                    }
                }
            }
        }
        return false;
    } catch (error) {
        debugLog("Error checking for migration need:", error);
        return false;
    }
}

/**
 * Helper function to resolve metadata conflicts using edit history
 * This function determines the latest edit for each metadata field and applies it
 */
function resolveMetadataConflictsUsingEditHistory(
    ourCell: CustomNotebookCellData,
    theirCell: CustomNotebookCellData
): CustomNotebookCellData {
    // Combine all edits from both cells
    const allEdits: EditHistory[] = [
        ...(ourCell.metadata?.edits || []),
        ...(theirCell.metadata?.edits || [])
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Group edits by their editMap path
    const editsByPath = new Map<string, EditHistory[]>();
    for (const edit of allEdits) {
        if (edit.editMap && Array.isArray(edit.editMap)) {
            const pathKey = edit.editMap.join('.');
            if (!editsByPath.has(pathKey)) {
                editsByPath.set(pathKey, []);
            }
            editsByPath.get(pathKey)!.push(edit);
        }
    }

    // Start with our cell as the base
    // Shallow copy is sufficient - attachments are merged separately later
    const resolvedCell = { ...ourCell };

    // For each metadata path, apply the most recent edit
    for (const [pathKey, edits] of editsByPath.entries()) {
        if (edits.length === 0) continue;

        // Find the most recent edit for this path, ignoring preview-only edits
        // Tie-breaker: when timestamps are equal, prefer MIGRATION, then USER_EDIT over INITIAL_IMPORT
        const sorted = edits.sort((a, b) => {
            const timeDiff = b.timestamp - a.timestamp;
            if (timeDiff !== 0) return timeDiff;
            // Same timestamp: prefer MIGRATION, then USER_EDIT over INITIAL_IMPORT
            const aIsMigration = a.type === EditType.MIGRATION;
            const bIsMigration = b.type === EditType.MIGRATION;
            if (aIsMigration !== bIsMigration) return bIsMigration ? 1 : -1;
            const aIsUser = a.type === EditType.USER_EDIT;
            const bIsUser = b.type === EditType.USER_EDIT;
            const aIsInitial = a.type === EditType.INITIAL_IMPORT;
            const bIsInitial = b.type === EditType.INITIAL_IMPORT;
            if (aIsUser !== bIsUser) return bIsUser ? 1 : -1; // b is USER_EDIT comes first
            if (aIsInitial !== bIsInitial) return aIsInitial ? 1 : -1; // push INITIAL_IMPORT later
            return 0;
        });
        let mostRecentEdit = sorted.find((e) => !e.preview);
        const allWerePreviews = !mostRecentEdit;
        if (!mostRecentEdit) {
            // Fallback to raw most recent if all were previews
            mostRecentEdit = sorted[0];
        }

        // Apply the edit to the resolved cell based on the path
        // Special rule: do NOT apply preview-only value edits to the resolved value.
        // Keep the edit in history but leave the cell.value unchanged until a non-preview edit occurs.
        if (allWerePreviews && pathKey === 'value') {
            debugLog(`Skipping application of preview-only value edit for cell ${resolvedCell.metadata?.id}`);
        } else {
            applyEditToCell(resolvedCell, mostRecentEdit);
        }

        debugLog(`Applied most recent edit for ${pathKey}: ${mostRecentEdit.value}`);
    }

    return resolvedCell;
}

/**
 * Helper function to merge validatedBy arrays between duplicate edits
 */
function mergeValidatedByArrays(existingEdit: EditHistory, newEdit: EditHistory): void {
    // Initialize validatedBy arrays if they don't exist
    if (!existingEdit.validatedBy) existingEdit.validatedBy = [];
    if (!newEdit.validatedBy) newEdit.validatedBy = [];

    // Combine validation entries
    if (newEdit.validatedBy.length > 0) {
        newEdit.validatedBy.forEach((entry: any) => {
            // Convert string entries to ValidationEntry objects
            let validationEntry: ValidationEntry;
            if (!isValidValidationEntry(entry)) {
                // Handle string entries
                if (typeof entry === "string") {
                    const currentTimestamp = Date.now();
                    validationEntry = {
                        username: entry,
                        creationTimestamp: currentTimestamp,
                        updatedTimestamp: currentTimestamp,
                        isDeleted: false,
                    };
                } else {
                    // Skip invalid entries
                    return;
                }
            } else {
                validationEntry = entry;
            }

            // Find if this user already has a validation entry
            const existingEntryIndex = existingEdit.validatedBy!.findIndex(
                (existingEntry: any) => {
                    if (typeof existingEntry === "string") {
                        return existingEntry === validationEntry.username;
                    }
                    return (
                        isValidValidationEntry(existingEntry) &&
                        existingEntry.username === validationEntry.username
                    );
                }
            );

            if (existingEntryIndex === -1) {
                // User doesn't have an entry yet, add it
                existingEdit.validatedBy!.push(validationEntry);
            } else {
                // User already has an entry, update if the new one is more recent
                const existingEntryItem = existingEdit.validatedBy![existingEntryIndex];
                if (typeof existingEntryItem === "string") {
                    existingEdit.validatedBy![existingEntryIndex] = validationEntry;
                } else if (
                    validationEntry.updatedTimestamp > existingEntryItem.updatedTimestamp
                ) {
                    existingEdit.validatedBy![existingEntryIndex] = {
                        ...validationEntry,
                        creationTimestamp: existingEntryItem.creationTimestamp,
                    };
                }
            }
        });
    }

    // Ensure the validatedBy array only contains ValidationEntry objects
    if (existingEdit.validatedBy && existingEdit.validatedBy.length > 0) {
        existingEdit.validatedBy = existingEdit.validatedBy!.filter(
            (entry: any) => typeof entry !== "string"
        );
    }
}

/**
 * Helper function to apply an edit to file-level metadata based on its editMap path
 */
function applyEditToMetadata(metadata: CustomNotebookMetadata, edit: FileEditHistory): void {
    if (!edit.editMap || !Array.isArray(edit.editMap)) {
        return;
    }

    const path = edit.editMap;
    const value = edit.value;

    // Ensure metadata exists
    if (!metadata) {
        return;
    }

    try {
        if (path.length === 2 && path[0] === 'metadata') {
            // File-level metadata field edit
            const field = path[1];

            // Apply edit based on field name
            switch (field) {
                case 'videoUrl':
                    metadata.videoUrl = value as string;
                    break;
                case 'textDirection':
                    metadata.textDirection = value as "ltr" | "rtl";
                    break;
                case 'lineNumbersEnabled':
                    metadata.lineNumbersEnabled = value as boolean;
                    break;
                case 'fontSize':
                    metadata.fontSize = value as number;
                    break;
                case 'autoDownloadAudioOnOpen':
                    metadata.autoDownloadAudioOnOpen = value as boolean;
                    break;
                case 'showInlineBacktranslations':
                    metadata.showInlineBacktranslations = value as boolean;
                    break;
                case 'fileDisplayName':
                    metadata.fileDisplayName = value as string;
                    break;
                case 'cellDisplayMode':
                    metadata.cellDisplayMode = value as "inline" | "one-line-per-cell";
                    break;
                case 'audioOnly':
                    metadata.audioOnly = value as boolean;
                    break;
                case 'corpusMarker':
                    metadata.corpusMarker = value as string;
                    break;
                default:
                    // Generic field assignment for other metadata fields
                    (metadata as any)[field] = value;
            }
        }
    } catch (error) {
        debugLog(`Error applying edit to metadata: ${error}`);
    }
}

/**
 * Helper function to resolve conflicts in file-level metadata using edit history
 */
function resolveMetadataConflictsUsingEditHistoryForFile(
    ourMetadata: CustomNotebookMetadata,
    theirMetadata: CustomNotebookMetadata
): CustomNotebookMetadata {
    // Combine all edits from both metadata objects (FileEditHistory type)
    const allEdits: FileEditHistory[] = [
        ...(ourMetadata.edits || []),
        ...(theirMetadata.edits || [])
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Group edits by their editMap path
    const editsByPath = new Map<string, FileEditHistory[]>();
    for (const edit of allEdits) {
        if (edit.editMap && Array.isArray(edit.editMap)) {
            const pathKey = edit.editMap.join('.');
            if (!editsByPath.has(pathKey)) {
                editsByPath.set(pathKey, []);
            }
            editsByPath.get(pathKey)!.push(edit);
        }
    }

    const resolvedMetadata = { ...ourMetadata };

    // For each metadata path, apply the most recent edit
    for (const [pathKey, edits] of editsByPath.entries()) {
        if (edits.length === 0) continue;

        // Find the most recent edit for this path
        // Tie-breaker: when timestamps are equal, prefer MIGRATION, then USER_EDIT over INITIAL_IMPORT
        const sorted = edits.sort((a, b) => {
            const timeDiff = b.timestamp - a.timestamp;
            if (timeDiff !== 0) return timeDiff;
            // Same timestamp: prefer MIGRATION, then USER_EDIT over INITIAL_IMPORT
            const aIsMigration = a.type === EditType.MIGRATION;
            const bIsMigration = b.type === EditType.MIGRATION;
            if (aIsMigration !== bIsMigration) return bIsMigration ? 1 : -1;
            const aIsUser = a.type === EditType.USER_EDIT;
            const bIsUser = b.type === EditType.USER_EDIT;
            const aIsInitial = a.type === EditType.INITIAL_IMPORT;
            const bIsInitial = b.type === EditType.INITIAL_IMPORT;
            if (aIsUser !== bIsUser) return bIsUser ? 1 : -1; // b is USER_EDIT comes first
            if (aIsInitial !== bIsInitial) return aIsInitial ? 1 : -1; // push INITIAL_IMPORT later
            return 0;
        });
        const mostRecentEdit = sorted[0];

        // Apply the edit to the resolved metadata
        applyEditToMetadata(resolvedMetadata, mostRecentEdit);

        debugLog(`Applied most recent edit for ${pathKey}: ${mostRecentEdit.value}`);
    }

    return resolvedMetadata;
}

/**
 * Helper function to apply an edit to a cell based on its editMap path
 */
function applyEditToCell(cell: CustomNotebookCellData, edit: EditHistory): void {
    if (!edit.editMap || !Array.isArray(edit.editMap)) {
        return;
    }

    const path = edit.editMap;
    const value = edit.value;

    // Ensure metadata exists
    if (!cell.metadata) {
        cell.metadata = {
            id: (cell as any).id || '',
            type: CodexCellTypes.TEXT,
            edits: [],
        };
    }

    try {
        if (path.length === 1 && path[0] === 'value') {
            // Direct cell value edit
            cell.value = value as string;
        } else if (path.length >= 2 && path[0] === 'metadata') {
            // Metadata field edit
            if (path.length === 2) {
                // Direct metadata field (e.g., cellLabel)
                const field = path[1];
                if (field === 'cellLabel') {
                    cell.metadata.cellLabel = value as string;
                } else if (field === 'selectedAudioId') {
                    cell.metadata.selectedAudioId = value as string;
                } else if (field === 'selectionTimestamp') {
                    cell.metadata.selectionTimestamp = value as number;
                } else if (field === 'isLocked') {
                    cell.metadata.isLocked = value as boolean;
                }
            } else if (path.length === 3 && path[1] === 'data') {
                // Data field edit (e.g., startTime, endTime)
                const dataField = path[2];
                if (!cell.metadata.data) {
                    cell.metadata.data = {};
                }

                if (dataField === 'startTime') {
                    cell.metadata.data.startTime = value as number;
                } else if (dataField === 'endTime') {
                    cell.metadata.data.endTime = value as number;
                } else if (dataField === 'deleted') {
                    cell.metadata.data.deleted = value as boolean;
                } else {
                    // Generic data field assignment
                    (cell.metadata.data as any)[dataField] = value as any;
                }
            }
        }
    } catch (error) {
        debugLog(`Error applying edit to cell: ${error}`);
    }
}

/**
 * Helper function to migrate old format edits to new format in-place
 */
function migrateEditHistoryInContent(content: string): string {
    try {
        const notebook = JSON.parse(content);
        const cells: CodexCell[] = notebook.cells || [];
        let hasChanges = false;

        for (const cell of cells) {
            if (cell.metadata?.edits && cell.metadata.edits.length > 0) {
                for (const edit of cell.metadata.edits as any) {
                    // Check if this is an old format edit (has cellValue but no editMap)
                    if (edit.cellValue !== undefined && !edit.editMap) {
                        // Migrate old format to new format
                        edit.value = edit.cellValue; // Move cellValue to value
                        edit.editMap = ["value"]; // Set editMap to point to value
                        delete edit.cellValue; // Remove old property
                        hasChanges = true;

                        debugLog(`Migrated edit in cell ${cell.metadata.id}: converted cellValue to value with editMap`);
                    }
                }
            }
        }

        if (hasChanges) {
            debugLog("Edit history migration completed for content");
            return JSON.stringify(notebook, null, 2);
        }

        return content;
    } catch (error) {
        debugLog("Error migrating edit history in content:", error);
        return content;
    }
}

function mergeTwoCellsUsingResolverLogic(
    ourCell: CustomNotebookCellData,
    theirCell: CustomNotebookCellData
): CustomNotebookCellData {
    const cellId = ourCell.metadata?.id || theirCell.metadata?.id;

    // Use the same metadata conflict resolution as in the main resolver
    const mergedCell = resolveMetadataConflictsUsingEditHistory(ourCell, theirCell);

    // Combine all edits from both cells and deduplicate
    const allEdits = [
        ...(ourCell.metadata?.edits || []),
        ...(theirCell.metadata?.edits || [])
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Remove duplicates based on timestamp, editMap and value, while merging validatedBy entries
    const editMap = new Map<string, any>();
    allEdits.forEach((edit) => {
        if (edit.editMap && Array.isArray(edit.editMap)) {
            const editMapKey = edit.editMap.join('.');
            const key = `${edit.timestamp}:${editMapKey}:${edit.value}`;
            if (!editMap.has(key)) {
                editMap.set(key, edit);
            } else {
                const existingEdit = editMap.get(key)!;
                mergeValidatedByArrays(existingEdit, edit);
            }
        }
    });

    const uniqueEdits = Array.from(editMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    if (!mergedCell.metadata) {
        mergedCell.metadata = {
            id: cellId,
            type: CodexCellTypes.TEXT,
            edits: [],
        };
    }
    mergedCell.metadata.edits = uniqueEdits;

    // Merge attachments intelligently
    const mergedAttachments = mergeAttachments(
        ourCell.metadata?.attachments,
        theirCell.metadata?.attachments
    );

    // Resolve selection conflicts
    const { selectedAudioId, selectionTimestamp } = resolveAudioSelection(
        ourCell.metadata,
        theirCell.metadata,
        mergedAttachments
    );

    // Apply attachment and selection data to merged cell
    mergedCell.metadata.attachments = mergedAttachments;
    mergedCell.metadata.selectedAudioId = selectedAudioId;
    mergedCell.metadata.selectionTimestamp = selectionTimestamp;

    // Final safety check: ensure no string entries remain in validatedBy arrays
    if (mergedCell.metadata?.edits) {
        for (const edit of mergedCell.metadata.edits) {
            if (edit.validatedBy) {
                edit.validatedBy = edit.validatedBy.filter(isValidValidationEntry);
            }
        }
    }

    return mergedCell;
}

export function mergeDuplicateCellsUsingResolverLogic(
    duplicateCells: CustomNotebookCellData[]
): CustomNotebookCellData {
    if (duplicateCells.length === 0) {
        throw new Error("mergeDuplicateCellsUsingResolverLogic requires at least one cell");
    }

    let mergedCell = duplicateCells[0];
    for (let i = 1; i < duplicateCells.length; i++) {
        mergedCell = mergeTwoCellsUsingResolverLogic(mergedCell, duplicateCells[i]);
    }

    return mergedCell;
}

/**
 * Custom merge resolution for Codex files
 * Merges cells from two versions of a notebook, preserving edit history and metadata
 *
 * Special handling for validation entries:
 * - Legacy validatedBy arrays may contain string usernames
 * - This function converts any string entries to proper ValidationEntry objects
 * - It ensures all validatedBy arrays only contain valid ValidationEntry objects in the output
 * - String entries with the same username as an object entry are removed to avoid duplicates
 *
 * Position preservation for paratextual cells:
 * - Tracks the previous and next cell IDs for each cell in both versions
 * - When inserting cells unique to "their" version, places them in the correct relative position
 * - Uses neighbor-based positioning: if the previous neighbor exists, insert after it;
 *   if the next neighbor exists, insert before it; otherwise append at end
 *
 * @param ourContent Our version of the notebook JSON content
 * @param theirContent Their version of the notebook JSON content
 * @returns Merged notebook JSON content as a string
 */
export async function resolveCodexCustomMerge(
    ourContent: string,
    theirContent: string
): Promise<string> {
    debugLog({ ourContent: ourContent.slice(0, 1000), theirContent: theirContent.slice(0, 1000) });
    debugLog("Starting resolveCodexCustomMerge");

    // Check if content needs migration and migrate if necessary
    if (!ourContent) {
        debugLog("No our content, returning their content");
        return theirContent;
    }
    if (!theirContent) {
        debugLog("No their content, returning our content");
        return ourContent;
    }

    // Migrate content if needed
    let migratedOurContent = ourContent;
    let migratedTheirContent = theirContent;

    const ourNeedsMigration = needsEditHistoryMigration(ourContent);
    const theirNeedsMigration = needsEditHistoryMigration(theirContent);

    if (ourNeedsMigration) {
        debugLog("Migrating our content edit history format");
        migratedOurContent = migrateEditHistoryInContent(ourContent);
    }

    if (theirNeedsMigration) {
        debugLog("Migrating their content edit history format");
        migratedTheirContent = migrateEditHistoryInContent(theirContent);
    }

    debugLog("Parsing notebook content");
    const ourNotebook = JSON.parse(migratedOurContent);
    const theirNotebook = JSON.parse(migratedTheirContent);
    const ourCells: CustomNotebookCellData[] = ourNotebook.cells;
    const theirCells: CustomNotebookCellData[] = theirNotebook.cells;

    // Extract and merge file-level metadata
    const ourMetadata: CustomNotebookMetadata = ourNotebook.metadata || {};
    const theirMetadata: CustomNotebookMetadata = theirNotebook.metadata || {};

    // Initialize edits arrays if they don't exist
    if (!ourMetadata.edits) {
        ourMetadata.edits = [];
    }
    if (!theirMetadata.edits) {
        theirMetadata.edits = [];
    }

    // Resolve metadata conflicts using edit history
    const mergedMetadata = resolveMetadataConflictsUsingEditHistoryForFile(ourMetadata, theirMetadata);

    // Combine all metadata edits from both branches and deduplicate
    // Similar to cell-level edits deduplication, remove duplicates based on timestamp, editMap and value
    const allMetadataEdits = [
        ...(ourMetadata.edits || []),
        ...(theirMetadata.edits || [])
    ];

    // Deduplicate edits using the same logic as cell-level edits
    mergedMetadata.edits = deduplicateFileMetadataEdits(allMetadataEdits);

    debugLog(`Filtered to ${mergedMetadata.edits.length} unique metadata edits`);

    debugLog(
        `Processing ${ourCells.length} cells from our version and ${theirCells.length} cells from their version`
    );

    // Determine merge author (env override for tests, else best-effort lookup)
    const mergeAuthor = process.env.CODEX_MERGE_USER || await getCurrentUserName();

    // Build position context maps for both cell arrays
    // This tracks what cells came before/after each cell for position-preserving merges
    const theirPositionContextMap = buildCellPositionContextMap(theirCells);
    debugLog(`Built position context map for ${theirPositionContextMap.size} cells from their version`);

    // Map to track cells by ID for quick lookup
    const theirCellsMap = new Map<string, CustomNotebookCellData>();
    theirCells.forEach((cell) => {
        if (cell.metadata?.id) {
            theirCellsMap.set(cell.metadata.id, cell);
            debugLog(`Mapped their cell with ID: ${cell.metadata.id}`);
        }
    });

    const resultCells: CustomNotebookCellData[] = [];

    // Process our cells in order
    ourCells.forEach((ourCell) => {
        const cellId = ourCell.metadata?.id;
        if (!cellId) {
            debugLog("Skipping cell without ID");
            return;
        }

        const theirCell = theirCellsMap.get(cellId);
        if (theirCell) {
            debugLog(`Found matching cell ${cellId} - merging content`);

            // Note: even if both sides soft-delete a cell, we keep it in the merged output
            // so that deletion history and audit information are preserved.

            const mergedCell = mergeDuplicateCellsUsingResolverLogic([ourCell, theirCell]);
            debugLog(`Filtered to ${mergedCell.metadata?.edits?.length ?? 0} unique edits for cell ${cellId}`);
            debugLog(`Pushing merged cell ${cellId} to results`);
            resultCells.push(mergedCell);
            theirCellsMap.delete(cellId);
        } else {
            debugLog(`No conflict for cell ${cellId}, keeping our version`);
            resultCells.push(ourCell);
        }
    });

    // Add any new cells from their version, preserving their relative positions
    // These are cells that only exist in "their" version (e.g., paratextual cells they added)
    if (theirCellsMap.size > 0) {
        debugLog(`Processing ${theirCellsMap.size} unique cells from their version with position preservation`);

        // Keep the original order from "their" side, but place each unique cell near its closest neighbor
        // that exists in our merged base list. This avoids repeated splice/reindex loops (O(n^2) behavior).
        const theirUniqueCellIdSet = new Set<string>(theirCellsMap.keys());
        const theirCellsOriginalOrder = theirCells
            .map((c) => c.metadata?.id)
            .filter((id): id is string => typeof id === "string" && theirUniqueCellIdSet.has(id));

        const mergedWithUnique = insertUniqueCellsPreservingRelativePositions({
            baseCells: resultCells,
            theirUniqueCellIdsInOrder: theirCellsOriginalOrder,
            theirUniqueCellsById: theirCellsMap,
            theirPositionContextMap,
            debugLog,
        });

        // Replace contents in-place for downstream logic that may still reference resultCells
        resultCells.length = 0;
        resultCells.push(...mergedWithUnique);
    }

    debugLog(`Merge complete. Final cell count: ${resultCells.length}`);

    // Final safety check: ensure no string entries remain in any validatedBy arrays
    for (const cell of resultCells) {
        if (cell.metadata?.edits) {
            for (const edit of cell.metadata.edits) {
                if (edit.validatedBy) {
                    // Filter to only include proper ValidationEntry objects
                    edit.validatedBy = edit.validatedBy.filter(isValidValidationEntry);
                }
            }
        }
    }

    // Return the full notebook structure with merged cells and metadata
    // (formatted consistently for `.codex`/`.source` file writes)
    return formatJsonForNotebookFile(
        {
            ...ourNotebook,
            cells: resultCells,
            metadata: mergedMetadata,
        }
    );
}

/**
 * Resolves conflicts in notebook comment thread files
 */
export async function resolveCommentThreadsConflict(
    ourContent: string,
    theirContent: string
): Promise<string> {
    const ourThreads: NotebookCommentThread[] = JSON.parse(ourContent);
    const theirThreads: NotebookCommentThread[] = JSON.parse(theirContent);

    // Check if migration is needed
    const ourNeedsMigration = needsMigration(ourThreads);
    const theirNeedsMigration = needsMigration(theirThreads);

    // Create a map to store merged threads by ID
    const threadMap = new Map<string, NotebookCommentThread>();

    // Process our threads first
    await Promise.all(ourThreads.map(async (thread) => {
        let migratedThread = { ...thread };

        // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
        // Remove legacy uri field if it exists
        delete (migratedThread as any).uri;

        // Ensure we have the event array fields (migrate from boolean if needed)
        if (!('deletionEvent' in migratedThread)) {
            if (typeof (migratedThread as any).deleted === 'boolean') {
                if ((migratedThread as any).deleted && migratedThread.comments && migratedThread.comments.length > 0) {
                    const latestComment = migratedThread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    (migratedThread as any).deletionEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        deleted: true
                    }];
                } else {
                    (migratedThread as any).deletionEvent = [];
                }
                delete (migratedThread as any).deleted; // Remove old boolean field
            } else {
                (migratedThread as any).deletionEvent = [];
            }
        }
        if (!('resolvedEvent' in migratedThread)) {
            if (typeof (migratedThread as any).resolved === 'boolean') {
                if ((migratedThread as any).resolved && migratedThread.comments && migratedThread.comments.length > 0) {
                    const latestComment = migratedThread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    (migratedThread as any).resolvedEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        resolved: true
                    }];
                } else {
                    (migratedThread as any).resolvedEvent = [];
                }
                delete (migratedThread as any).resolved; // Remove old boolean field
            } else {
                (migratedThread as any).resolvedEvent = [];
            }
        }

        // Clean up legacy contextValue from all comments
        if (migratedThread.comments) {
            migratedThread.comments.forEach((comment: any) => {
                delete comment.contextValue;
            });
        }
        // ============= END MIGRATION CLEANUP =============

        // Migrate comments if needed
        if (ourNeedsMigration) {
            migratedThread.comments = thread.comments.map((comment, index) =>
                migrateComment(comment, thread.threadTitle, index)
            );
        }

        // Convert to relative paths
        migratedThread = convertThreadToRelativePaths(migratedThread);

        threadMap.set(migratedThread.id, migratedThread);
    }));

    // Merge their threads, combining comments when thread IDs match
    await Promise.all(theirThreads.map(async (theirThread) => {
        const existingThread = threadMap.get(theirThread.id);

        // Migrate their thread if needed
        let migratedTheirThread = { ...theirThread };

        // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
        // Remove legacy uri field if it exists
        delete (migratedTheirThread as any).uri;

        // Ensure we have the event array fields (migrate from boolean if needed)
        if (!('deletionEvent' in migratedTheirThread)) {
            if (typeof (migratedTheirThread as any).deleted === 'boolean') {
                if ((migratedTheirThread as any).deleted && migratedTheirThread.comments && migratedTheirThread.comments.length > 0) {
                    const latestComment = migratedTheirThread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    (migratedTheirThread as any).deletionEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        deleted: true
                    }];
                } else {
                    (migratedTheirThread as any).deletionEvent = [];
                }
                delete (migratedTheirThread as any).deleted; // Remove old boolean field
            } else {
                (migratedTheirThread as any).deletionEvent = [];
            }
        }
        if (!('resolvedEvent' in migratedTheirThread)) {
            if (typeof (migratedTheirThread as any).resolved === 'boolean') {
                if ((migratedTheirThread as any).resolved && migratedTheirThread.comments && migratedTheirThread.comments.length > 0) {
                    const latestComment = migratedTheirThread.comments.reduce((latest, comment) =>
                        comment.timestamp > latest.timestamp ? comment : latest
                    );
                    (migratedTheirThread as any).resolvedEvent = [{
                        timestamp: latestComment.timestamp + 5,
                        author: { name: latestComment.author.name },
                        resolved: true
                    }];
                } else {
                    (migratedTheirThread as any).resolvedEvent = [];
                }
                delete (migratedTheirThread as any).resolved; // Remove old boolean field
            } else {
                (migratedTheirThread as any).resolvedEvent = [];
            }
        }

        // Clean up legacy contextValue from all comments
        if (migratedTheirThread.comments) {
            migratedTheirThread.comments.forEach((comment: any) => {
                delete comment.contextValue;
            });
        }
        // ============= END MIGRATION CLEANUP =============

        if (theirNeedsMigration) {
            migratedTheirThread.comments = theirThread.comments.map((comment, index) =>
                migrateComment(comment, theirThread.threadTitle, index)
            );
        }

        // Convert to relative paths  
        migratedTheirThread = convertThreadToRelativePaths(migratedTheirThread);

        if (!existingThread) {
            // New thread, just add it
            threadMap.set(migratedTheirThread.id, migratedTheirThread);
        } else {
            // Merge comments for existing thread AND preserve latest thread metadata
            const allComments = new Map<string, NotebookComment>();
            const seenContentSignatures = new Set<string>();

            // Helper function to create content signature for legacy comment deduplication
            const getContentSignature = (comment: any): string => {
                return `${comment.body}|${comment.author?.name || 'Unknown'}`;
            };

            // Add our comments first
            existingThread.comments.forEach((comment) => {
                allComments.set(comment.id, { ...comment });
                // Track content signature for legacy deduplication
                const signature = getContentSignature(comment);
                seenContentSignatures.add(signature);
                debugLog(`Added our comment with ID: ${comment.id}`);
            });

            // Add their comments with proper deduplication
            migratedTheirThread.comments.forEach((comment) => {
                // First check if exact ID already exists (for modern comments)
                if (allComments.has(comment.id)) {
                    debugLog(`Skipping comment with duplicate ID: ${comment.id}`);
                    return;
                }

                // For potential legacy comments, check content signature
                const signature = getContentSignature(comment);
                if (seenContentSignatures.has(signature)) {
                    debugLog(`Skipping comment with duplicate content: ${signature}`);
                    return;
                }

                // Add the comment (unique by both ID and content)
                allComments.set(comment.id, { ...comment });
                seenContentSignatures.add(signature);
                debugLog(`Added their comment with ID: ${comment.id}`);
            });

            // Merge thread metadata - prefer the most recent thread state based on latest comment
            const ourLatestCommentTime = Math.max(...existingThread.comments.map(c => c.timestamp));
            const theirLatestCommentTime = Math.max(...migratedTheirThread.comments.map(c => c.timestamp));

            const mergedThread = theirLatestCommentTime > ourLatestCommentTime
                ? { ...migratedTheirThread } // Use their thread metadata if they have newer comments
                : { ...existingThread };    // Use our thread metadata if we have newer comments

            // Always use the merged comments array - preserve order to minimize git diffs
            mergedThread.comments = Array.from(allComments.values());

            // Helper function to validate event structure
            const validateEvent = (event: any, eventType: string, threadId: string): boolean => {
                const errors: string[] = [];

                // Check for required timestamp
                if (!event.timestamp || typeof event.timestamp !== 'number') {
                    errors.push('missing or invalid timestamp');
                }

                // Check for author structure
                if (!event.author || typeof event.author.name !== 'string') {
                    errors.push('missing or invalid author.name');
                }

                // Check for event-specific properties
                if (eventType === 'deletion' && !('deleted' in event) && !('valid' in event)) {
                    errors.push('missing deleted property');
                }
                if (eventType === 'resolved' && !('resolved' in event) && !('valid' in event)) {
                    errors.push('missing resolved/valid property');
                }

                if (errors.length > 0) {
                    console.warn(`[CommentsMerge] Invalid ${eventType} event in thread ${threadId}: ${errors.join(', ')}`, event);
                    return false;
                }

                return true;
            };

            // Helper function to normalize and deduplicate events based on timestamp, author name, and boolean state
            const deduplicateEvents = (events: any[], eventType: string) => {
                const seen = new Set<string>();
                const originalCount = events.length;

                // First filter out completely invalid events
                const validEvents = events.filter(event => validateEvent(event, eventType, mergedThread.id));

                if (validEvents.length !== originalCount) {
                    debugLog(`Filtered out ${originalCount - validEvents.length} invalid ${eventType} events for thread ${mergedThread.id}`);
                }

                // Then normalize events - convert 'valid' to 'resolved' and ensure required properties exist
                const normalizedEvents = validEvents.map(event => {
                    const normalizedEvent = { ...event };

                    // Handle property normalization for resolved events
                    if (eventType === 'resolved') {
                        // Convert 'valid' to 'resolved' if it exists
                        if ('valid' in normalizedEvent && !('resolved' in normalizedEvent)) {
                            normalizedEvent.resolved = normalizedEvent.valid;
                            delete normalizedEvent.valid;
                        }
                        // Set default resolved state if missing or invalid (safer to default to false)
                        if (!('resolved' in normalizedEvent) || typeof normalizedEvent.resolved !== 'boolean') {
                            normalizedEvent.resolved = false;
                        }
                    }

                    // Handle property normalization for deletion events
                    if (eventType === 'deletion') {
                        // Set default deleted state if missing or invalid (safer to default to false)
                        if (!('deleted' in normalizedEvent) || typeof normalizedEvent.deleted !== 'boolean') {
                            normalizedEvent.deleted = false;
                        }
                    }

                    // Ensure author name exists
                    if (!normalizedEvent.author?.name) {
                        if (!normalizedEvent.author) {
                            normalizedEvent.author = { name: 'unknown' };
                        } else {
                            normalizedEvent.author.name = 'unknown';
                        }
                    }

                    return normalizedEvent;
                });

                const deduplicated = normalizedEvents.filter(event => {
                    // Create unique key from timestamp, author name, and boolean state
                    const booleanState = eventType === 'deletion' ? event.deleted : event.resolved;
                    const key = `${event.timestamp}-${event.author?.name || 'unknown'}-${booleanState}`;
                    if (seen.has(key)) {
                        return false; // Skip duplicate
                    }
                    seen.add(key);
                    return true;
                });

                if (originalCount !== deduplicated.length) {
                    debugLog(`Normalized and deduplicated ${eventType} events for thread ${mergedThread.id}: ${originalCount} → ${deduplicated.length} (removed ${originalCount - deduplicated.length} duplicates)`);
                }

                return deduplicated;
            };

            // Merge event arrays - combine all events from both sides and deduplicate
            const allDeletionEvents = [
                ...(existingThread.deletionEvent || []),
                ...(migratedTheirThread.deletionEvent || [])
            ];
            mergedThread.deletionEvent = deduplicateEvents(allDeletionEvents, 'deletion')
                .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp for consistency

            const allResolvedEvents = [
                ...(existingThread.resolvedEvent || []),
                ...(migratedTheirThread.resolvedEvent || [])
            ];
            mergedThread.resolvedEvent = deduplicateEvents(allResolvedEvents, 'resolved')
                .sort((a, b) => a.timestamp - b.timestamp); // Sort by timestamp for consistency

            // Update the thread in the map
            threadMap.set(mergedThread.id, mergedThread);
            debugLog(`Merged thread ${mergedThread.id} with ${mergedThread.comments.length} total comments`);
        }
    }));

    const mergedThreads = Array.from(threadMap.values());
    return CommentsMigrator.formatCommentsForStorage(mergedThreads);
}



/**
 * Merges audio attachments from two cell versions, preserving all recordings
 * @param ourAttachments Our version of attachments
 * @param theirAttachments Their version of attachments  
 * @returns Merged attachments object
 */
export function mergeAttachments(
    ourAttachments?: { [key: string]: any; },
    theirAttachments?: { [key: string]: any; }
): { [key: string]: any; } | undefined {
    if (!ourAttachments && !theirAttachments) {
        return undefined;
    }

    const merged: { [key: string]: any; } = {};

    // Add all our attachments
    if (ourAttachments) {
        Object.entries(ourAttachments).forEach(([id, attachment]) => {
            const normalized = { ...attachment };
            if (typeof normalized.url === "string") {
                normalized.url = normalizeAttachmentUrl(normalized.url);
            }
            merged[id] = normalized;
        });
    }

    // Add their attachments, resolving conflicts by updatedAt timestamp
    if (theirAttachments) {
        Object.entries(theirAttachments).forEach(([id, theirAttachment]) => {
            if (!merged[id]) {
                // New attachment from their side
                const normalized = { ...theirAttachment };
                if (typeof normalized.url === "string") {
                    normalized.url = normalizeAttachmentUrl(normalized.url);
                }
                merged[id] = normalized;
            } else {
                // Conflict: same attachment ID exists in both versions
                const ourAttachment = merged[id];

                // Decide base attachment by updatedAt, but merge validatedBy arrays from both sides
                // Use explicit number comparison to handle undefined/null cases properly
                const ourUpdatedAt = typeof ourAttachment?.updatedAt === "number" ? ourAttachment.updatedAt : 0;
                const theirUpdatedAt = typeof theirAttachment?.updatedAt === "number" ? theirAttachment.updatedAt : 0;
                const baseIsTheirs = theirUpdatedAt > ourUpdatedAt;
                const base = baseIsTheirs ? { ...theirAttachment } : { ...ourAttachment };
                if (typeof base.url === "string") {
                    base.url = normalizeAttachmentUrl(base.url);
                }

                // Merge validatedBy arrays for audio attachments
                const mergedValidatedBy = mergeValidatedByLists(
                    Array.isArray(ourAttachment?.validatedBy) ? ourAttachment.validatedBy : undefined,
                    Array.isArray(theirAttachment?.validatedBy) ? theirAttachment.validatedBy : undefined
                );
                if (mergedValidatedBy) {
                    base.validatedBy = mergedValidatedBy;
                } else {
                    delete base.validatedBy; // normalize empty
                }

                merged[id] = base;
                debugLog(`Merged attachment ${id} (preserved validatedBy from both sides, used ${baseIsTheirs ? "their" : "our"} version based on updatedAt: ours=${ourUpdatedAt}, theirs=${theirUpdatedAt})`);
            }
        });
    }

    return Object.keys(merged).length > 0 ? merged : undefined;
}

/**
 * Resolves audio selection conflicts using selection timestamps
 * @param ourMetadata Our cell metadata
 * @param theirMetadata Their cell metadata
 * @param mergedAttachments The merged attachments object
 * @returns Resolved selection state
 */
function resolveAudioSelection(
    ourMetadata?: any,
    theirMetadata?: any,
    mergedAttachments?: { [key: string]: any; }
): { selectedAudioId?: string; selectionTimestamp?: number; } {
    const ourSelection = ourMetadata?.selectedAudioId;
    const ourTimestamp = ourMetadata?.selectionTimestamp;
    const theirSelection = theirMetadata?.selectedAudioId;
    const theirTimestamp = theirMetadata?.selectionTimestamp;

    // If neither has a selection, return undefined
    if (!ourSelection && !theirSelection) {
        return {};
    }

    // If only one has a selection, use that one (if valid)
    if (ourSelection && !theirSelection) {
        if (isValidSelection(ourSelection, mergedAttachments)) {
            return { selectedAudioId: ourSelection, selectionTimestamp: ourTimestamp };
        }
        return {};
    }

    if (theirSelection && !ourSelection) {
        if (isValidSelection(theirSelection, mergedAttachments)) {
            return { selectedAudioId: theirSelection, selectionTimestamp: theirTimestamp };
        }
        return {};
    }

    // Both have selections - use the more recent one
    if (ourSelection && theirSelection) {
        const ourTime = ourTimestamp || 0;
        const theirTime = theirTimestamp || 0;

        if (theirTime > ourTime) {
            // Their selection is more recent
            if (isValidSelection(theirSelection, mergedAttachments)) {
                debugLog(`Using their audio selection ${theirSelection} (newer timestamp)`);
                return { selectedAudioId: theirSelection, selectionTimestamp: theirTimestamp };
            }
        } else {
            // Our selection is more recent or same time (prefer ours)
            if (isValidSelection(ourSelection, mergedAttachments)) {
                debugLog(`Keeping our audio selection ${ourSelection} (newer or equal timestamp)`);
                return { selectedAudioId: ourSelection, selectionTimestamp: ourTimestamp };
            }
        }

        // If the preferred selection is invalid, try the other one
        const fallbackSelection = theirTime > ourTime ? ourSelection : theirSelection;
        const fallbackTimestamp = theirTime > ourTime ? ourTimestamp : theirTimestamp;

        if (isValidSelection(fallbackSelection, mergedAttachments)) {
            return { selectedAudioId: fallbackSelection, selectionTimestamp: fallbackTimestamp };
        }
    }

    // No valid selection found
    return {};
}

/**
 * Checks if a selection is valid (attachment exists and isn't deleted)
 * @param selectedId The selected attachment ID
 * @param attachments The attachments object
 * @returns True if selection is valid
 */
function isValidSelection(selectedId: string, attachments?: { [key: string]: any; }): boolean {
    if (!attachments || !selectedId) {
        return false;
    }

    const attachment = attachments[selectedId];
    return attachment &&
        attachment.type === "audio" &&
        !attachment.isDeleted;
}

/**
 * Resolves conflicts in metadata.json, specifically merging the remote healing list
 */
async function resolveMetadataJsonConflict(conflict: ConflictFile): Promise<string> {
    try {
        const base = JSON.parse(conflict.base || "{}");
        const ours = JSON.parse(conflict.ours || "{}");
        const theirs = JSON.parse(conflict.theirs || "{}");

        // First, handle edit history merge if both versions have edits arrays
        let resolvedMetadata: any;
        if (ours.edits && Array.isArray(ours.edits) && theirs.edits && Array.isArray(theirs.edits)) {
            // Use edit history approach
            // Combine all edits from both metadata objects (ProjectEditHistory type)
            const allEdits: ProjectEditHistory[] = [
                ...(ours.edits || []),
                ...(theirs.edits || [])
            ].sort((a, b) => a.timestamp - b.timestamp);

            // Group edits by their editMap path
            const editsByPath = new Map<string, ProjectEditHistory[]>();
            for (const edit of allEdits) {
                if (edit.editMap && Array.isArray(edit.editMap)) {
                    const pathKey = edit.editMap.join('.');
                    if (!editsByPath.has(pathKey)) {
                        editsByPath.set(pathKey, []);
                    }
                    editsByPath.get(pathKey)!.push(edit);
                }
            }

            // Start with our metadata as the base
            resolvedMetadata = JSON.parse(JSON.stringify(ours));

            // Helper function to apply a project metadata edit
            const applyProjectEditToMetadata = (metadata: any, edit: ProjectEditHistory): void => {
                if (!edit.editMap || !Array.isArray(edit.editMap)) {
                    return;
                }

                const path = edit.editMap;
                const value = edit.value;

                try {
                    if (path.length === 1) {
                        // Top-level field (e.g., ["projectName"], ["languages"])
                        const field = path[0];
                        metadata[field] = value;
                    } else if (path.length === 2 && path[0] === "meta") {
                        // Meta field edit (e.g., ["meta", "validationCount"], ["meta", "generator"])
                        if (!metadata.meta) {
                            metadata.meta = {};
                        }
                        if (path[1] === "generator") {
                            // Set entire generator object
                            metadata.meta.generator = value;
                        } else {
                            // Set specific meta field
                            metadata.meta[path[1]] = value;
                        }
                    }
                } catch (error) {
                    debugLog(`Error applying project edit to metadata: ${error}`);
                }
            };

            // For each metadata path, apply the most recent edit
            for (const [pathKey, edits] of editsByPath.entries()) {
                if (edits.length === 0) continue;

                // Find the most recent edit for this path (latest timestamp wins)
                const sorted = edits.sort((a, b) => {
                    const timeDiff = b.timestamp - a.timestamp;
                    if (timeDiff !== 0) return timeDiff;
                    // Same timestamp: prefer MIGRATION, then USER_EDIT over INITIAL_IMPORT
                    const aIsMigration = a.type === EditType.MIGRATION;
                    const bIsMigration = b.type === EditType.MIGRATION;
                    if (aIsMigration !== bIsMigration) return bIsMigration ? 1 : -1;
                    const aIsUser = a.type === EditType.USER_EDIT;
                    const bIsUser = b.type === EditType.USER_EDIT;
                    const aIsInitial = a.type === EditType.INITIAL_IMPORT;
                    const bIsInitial = b.type === EditType.INITIAL_IMPORT;
                    if (aIsUser !== bIsUser) return bIsUser ? 1 : -1; // b is USER_EDIT comes first
                    if (aIsInitial !== bIsInitial) return aIsInitial ? 1 : -1; // push INITIAL_IMPORT later
                    return 0;
                });
                const mostRecentEdit = sorted[0];

                // Apply the edit to the resolved metadata
                applyProjectEditToMetadata(resolvedMetadata, mostRecentEdit);

                debugLog(`Applied most recent edit for ${pathKey}: ${JSON.stringify(mostRecentEdit.value)}`);
            }

            // Combine edits arrays and deduplicate
            resolvedMetadata.edits = deduplicateFileMetadataEdits(allEdits);
        } else {
            // Fallback to starting with ours if no edit history
            resolvedMetadata = JSON.parse(JSON.stringify(ours));
        }

        // 1. Resolve initiateRemoteHealingFor (Complex Merge Logic)
        // Helper to extract healing list
        const getList = (obj: any) => (obj?.meta?.initiateRemoteHealingFor || []) as any[];

        const baseList = getList(base);
        const ourList = getList(ours);
        const theirList = getList(theirs);

        // Map all entries by userToHeal
        const allUsers = new Set<string>();
        const entryMap = new Map<string, { base?: any, ours?: any, theirs?: any; }>();

        // Helper to normalize entry to object (filtering out strings)
        const normalize = (entry: any): any => {
            if (typeof entry === 'string' || entry === null || typeof entry !== 'object') {
                return null;
            }
            return entry;
        };

        // Populate map
        const processList = (list: any[], source: 'base' | 'ours' | 'theirs') => {
            if (!Array.isArray(list)) return;
            for (const item of list) {
                const entry = normalize(item);
                if (!entry || !entry.userToHeal) continue;

                const username = entry.userToHeal;
                allUsers.add(username);
                if (!entryMap.has(username)) {
                    entryMap.set(username, {});
                }
                entryMap.get(username)![source] = entry;
            }
        };

        processList(baseList, 'base');
        processList(ourList, 'ours');
        processList(theirList, 'theirs');

        const mergedHealingList: any[] = [];

        for (const username of allUsers) {
            const { base: baseEntry, ours: ourEntry, theirs: theirEntry } = entryMap.get(username)!;

            // If only one side exists/modified, take it. If both, resolve.
            let finalEntry: any;

            if (!ourEntry && !theirEntry) {
                continue; // Should not happen if in allUsers
            }

            if (!ourEntry && theirEntry) {
                // We deleted it (or it wasn't there), they have it
                if (baseEntry) {
                    // We deleted it. Check if they updated it since base
                    if ((theirEntry.updatedAt || 0) > (baseEntry.updatedAt || 0)) {
                        finalEntry = theirEntry; // They updated it, keep their version
                    } else {
                        // They didn't update (or updated less than our deletion?), so our deletion wins
                        continue;
                    }
                } else {
                    // No base. They added it.
                    finalEntry = theirEntry;
                }
            } else if (ourEntry && !theirEntry) {
                // We have it, they don't
                if (!baseEntry) {
                    finalEntry = ourEntry; // We added it
                } else {
                    // They deleted it. Check if we updated it
                    if ((ourEntry.updatedAt || 0) > (baseEntry.updatedAt || 0)) {
                        finalEntry = ourEntry;
                    } else {
                        continue; // Accept their deletion
                    }
                }
            } else {
                // Both exist.
                // Compare updated timestamps
                if ((ourEntry.updatedAt || 0) >= (theirEntry.updatedAt || 0)) {
                    finalEntry = ourEntry;
                } else {
                    finalEntry = theirEntry;
                }

                // Ensure createdAt is preserved from base or oldest
                const oldestCreated = Math.min(
                    ourEntry.createdAt || Infinity,
                    theirEntry.createdAt || Infinity,
                    baseEntry?.createdAt || Infinity
                );
                if (oldestCreated !== Infinity) {
                    finalEntry.createdAt = oldestCreated;
                }
            }

            if (finalEntry) {
                mergedHealingList.push(finalEntry);
            }
        }

        // 2. Generic 3-Way Merge for the rest of the file
        // This ensures we don't lose other metadata changes from remote
        const mergeObjects = (baseObj: any, ourObj: any, theirObj: any, path: string[] = []): any => {
            // Use local if not object (or array)
            if (typeof ourObj !== 'object' || ourObj === null || Array.isArray(ourObj)) {
                // 3-way merge for leaf values
                const bStr = JSON.stringify(baseObj);
                const oStr = JSON.stringify(ourObj);
                // const tStr = JSON.stringify(theirObj); // Unused but conceptually part of the check

                if (oStr === bStr) {
                    return theirObj !== undefined ? theirObj : ourObj;
                }
                return ourObj; // Local wins on conflict or local change
            }

            const result: any = {};
            const keys = new Set([
                ...Object.keys(baseObj || {}),
                ...Object.keys(ourObj || {}),
                ...Object.keys(theirObj || {})
            ]);

            for (const key of keys) {
                // Skip initiateRemoteHealingFor - already handled above
                if (path.length === 1 && path[0] === 'meta' && key === 'initiateRemoteHealingFor') {
                    continue; // Skip, already merged above
                }

                // Skip edits array - already handled by edit history merge
                if (key === 'edits' && path.length === 0) {
                    continue; // Skip, already merged above
                }

                const bVal = baseObj?.[key];
                const oVal = ourObj?.[key];
                const tVal = theirObj?.[key];

                // Recurse for objects
                const isObj = (v: any) => typeof v === 'object' && v !== null && !Array.isArray(v);

                if (path.length < 5 && (isObj(bVal) || bVal === undefined) && (isObj(oVal) || oVal === undefined) && (isObj(tVal) || tVal === undefined)) {
                    result[key] = mergeObjects(bVal, oVal, tVal, [...path, key]);
                } else {
                    // Leaf merge
                    const bStr = JSON.stringify(bVal);
                    const oStr = JSON.stringify(oVal);
                    // const tStr = JSON.stringify(tVal); // Unused

                    if (oStr === bStr) {
                        result[key] = tVal !== undefined ? tVal : oVal;
                    } else {
                        result[key] = oVal;
                    }
                }
            }
            return result;
        };

        // Apply the merged healing list to resolved metadata
        if (!resolvedMetadata.meta) {
            resolvedMetadata.meta = {};
        }
        resolvedMetadata.meta.initiateRemoteHealingFor = mergedHealingList;

        // Merge other fields (excluding edits and initiateRemoteHealingFor which are already handled)
        const otherFieldsMerged = mergeObjects(base, ours, theirs);

        // Combine: use edit history result as base, then overlay other merged fields
        // But preserve edits and initiateRemoteHealingFor from our specialized merges
        const finalResult = {
            ...otherFieldsMerged,
            edits: resolvedMetadata.edits, // From edit history merge
            meta: {
                ...otherFieldsMerged.meta,
                initiateRemoteHealingFor: mergedHealingList // From specialized merge
            }
        };

        return JSON.stringify(finalResult, null, 4);

    } catch (error) {
        console.error("Error resolving metadata.json conflict:", error);
        return conflict.ours; // Fallback
    }
}

/**
 * Resolves conflicts in .vscode/settings.json using intelligent 3-way merge
 */
async function resolveSettingsJsonConflict(conflict: ConflictFile): Promise<string> {
    // Parse JSON with error handling
    let base: Record<string, any>, ours: Record<string, any>, theirs: Record<string, any>;
    try {
        base = JSON.parse(conflict.base || '{}');
        ours = JSON.parse(conflict.ours || '{}');
        theirs = JSON.parse(conflict.theirs || '{}');
    } catch (error) {
        console.error('[Settings Merge] Invalid JSON detected in conflict:', error);
        console.error('  Base:', conflict.base?.substring(0, 100));
        console.error('  Ours:', conflict.ours?.substring(0, 100));
        console.error('  Theirs:', conflict.theirs?.substring(0, 100));

        // Try to recover by using ours if it's valid
        try {
            ours = JSON.parse(conflict.ours || '{}');
            ours["git.enabled"] = false;
            vscode.window.showErrorMessage(
                'Settings merge failed due to invalid JSON. Using local version.',
                'Show Settings'
            ).then(choice => {
                if (choice === 'Show Settings') {
                    vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
                }
            });
            return JSON.stringify(ours, null, 4);
        } catch {
            // Last resort: return minimal valid JSON
            console.error('[Settings Merge] All JSON versions invalid, returning minimal settings');
            return JSON.stringify({ "git.enabled": false }, null, 4);
        }
    }

    // STAGE 1: FILE-LEVEL CHECK
    // If only one side changed the file, use that side entirely (fast path)
    const weChangedFile = JSON.stringify(base) !== JSON.stringify(ours);
    const theyChangedFile = JSON.stringify(base) !== JSON.stringify(theirs);

    // Helper function to clean up settings before returning
    const cleanupSettings = (settings: Record<string, any>) => {
        settings["git.enabled"] = false;
        return settings;
    };

    if (!weChangedFile && !theyChangedFile) {
        // Neither changed - use base (shouldn't happen in conflicts)
        debugLog('[Settings Merge] No changes detected, using base');
        return JSON.stringify(cleanupSettings(base), null, 4);
    }

    if (weChangedFile && !theyChangedFile) {
        // Only we changed the file
        debugLog('[Settings Merge] Only local changes, using ours entirely');
        return JSON.stringify(cleanupSettings(ours), null, 4);
    }

    if (!weChangedFile && theyChangedFile) {
        // Only they changed the file
        debugLog('[Settings Merge] Only remote changes, using theirs entirely');
        return JSON.stringify(cleanupSettings(theirs), null, 4);
    }

    // STAGE 2: BOTH CHANGED FILE - Complex per-key merge
    debugLog('[Settings Merge] Both sides changed file, performing key-level merge');

    // Merge all keys using 3-way merge logic
    const result: Record<string, any> = {};
    const conflicts: Array<{ key: string, resolution: string; }> = [];

    const allKeys = new Set([
        ...Object.keys(base),
        ...Object.keys(ours),
        ...Object.keys(theirs)
    ]);

    for (const key of allKeys) {
        // Special case: git.enabled always false
        if (key === "git.enabled") {
            result[key] = false;
            continue;
        }

        const baseValue = base[key];
        const ourValue = ours[key];
        const theirValue = theirs[key];

        // Determine if each side changed from base
        const ourChanged = JSON.stringify(ourValue) !== JSON.stringify(baseValue);
        const theirChanged = JSON.stringify(theirValue) !== JSON.stringify(baseValue);

        // Apply 3-way merge decision logic
        if (ourValue === undefined && theirValue === undefined) {
            // Key only in base (both deleted) - skip
            continue;
        }
        else if (ourValue !== undefined && theirValue === undefined && baseValue === undefined) {
            // We added it
            result[key] = ourValue;
        }
        else if (theirValue !== undefined && ourValue === undefined && baseValue === undefined) {
            // They added it
            result[key] = theirValue;
        }
        else if (baseValue !== undefined && ourValue === undefined && theirValue !== undefined) {
            // We deleted, they kept/changed - respect our deletion
            continue;
        }
        else if (baseValue !== undefined && theirValue === undefined && ourValue !== undefined) {
            // They deleted, we kept/changed - respect their deletion
            continue;
        }
        else if (!ourChanged && !theirChanged) {
            // Neither changed from base
            result[key] = ourValue !== undefined ? ourValue : theirValue;
        }
        else if (ourChanged && !theirChanged) {
            // Only we changed from base
            result[key] = ourValue;
        }
        else if (!ourChanged && theirChanged) {
            // Only they changed from base
            result[key] = theirValue;
        }
        else {
            // BOTH CHANGED from base - default to theirs (remote)
            result[key] = theirValue;
            conflicts.push({ key, resolution: 'remote (both changed, defaulting to remote)' });
        }
    }

    // Report conflicts to user
    if (conflicts.length > 0) {
        console.warn(
            `[Settings Merge] Resolved ${conflicts.length} conflict(s):`,
            conflicts
        );

        // Standard conflict notification
        const conflictKeys = conflicts.map(c => c.key).join(', ');
        vscode.window.showInformationMessage(
            `Settings merge: ${conflicts.length} conflict(s) resolved (${conflictKeys}). ` +
            `Check settings if needed.`,
            'Show Settings'
        ).then(choice => {
            if (choice === 'Show Settings') {
                vscode.commands.executeCommand('workbench.action.openWorkspaceSettingsFile');
            }
        });
    }

    // CLEANUP: Always ensure git.enabled is false
    result["git.enabled"] = false;

    return JSON.stringify(result, null, 4);
}

/**
 * Normalizes file URIs by decoding URL-encoded characters
 * Fixes issues like "file:///c%3A/" becoming "file:///C:/"
 */
function normalizeUri(uri: string | undefined): string | undefined {
    if (!uri) return uri;

    try {
        // Decode the URI
        let normalized = decodeURIComponent(uri);

        // Fix Windows drive letters - ensure they're uppercase
        normalized = normalized.replace(/file:\/\/\/([a-z]):/i, (match, driveLetter) => {
            return `file:///${driveLetter.toUpperCase()}:`;
        });

        return normalized;
    } catch (error) {
        // If decoding fails, return the original
        debugLog("Failed to normalize URI:", uri, error);
        return uri;
    }
}

/**
 * Normalizes all URIs in a comment thread
 */
function normalizeThreadUris(thread: NotebookCommentThread): NotebookCommentThread {
    return {
        ...thread,
        cellId: thread.cellId ? {
            ...thread.cellId,
            uri: normalizeUri(thread.cellId.uri) || thread.cellId.uri
        } : thread.cellId
    };
}

/**
 * Converts an absolute file URI to a relative path from the workspace root
 * Example: "file:///Users/work/.codex-projects/comments-merge-a40fcsgjt2f7f301ikxt72/files/target/GEN.codex"
 * becomes: "files/target/GEN.codex"
 */
function convertToRelativePath(uri: string | undefined): string | undefined {
    if (!uri) return uri;

    try {
        // First decode any URL encoding
        const decodedUri = decodeURIComponent(uri);

        // Extract the path from the file:/// URI
        let filePath = decodedUri;
        if (filePath.startsWith('file:///')) {
            filePath = filePath.substring(8);

            // On Windows, we might have a drive letter like C:
            // Remove the drive portion to get to the actual path
            if (/^[a-zA-Z]:/.test(filePath)) {
                filePath = filePath.substring(2);
            }
        }

        // Find the project folder name in the path
        // We look for the pattern /.codex-projects/PROJECT_NAME/ or just /PROJECT_NAME/
        const pathParts = filePath.split('/');

        // Find where .codex-projects appears or where we transition to project content
        let projectStartIndex = -1;
        for (let i = 0; i < pathParts.length; i++) {
            if (pathParts[i] === '.codex-projects' && i + 1 < pathParts.length) {
                // Skip .codex-projects and the project name
                projectStartIndex = i + 2;
                break;
            } else if (pathParts[i] === 'files' || pathParts[i] === '.project') {
                // We found project content, so the previous part was likely the project name
                projectStartIndex = i;
                break;
            }
        }

        if (projectStartIndex > 0 && projectStartIndex < pathParts.length) {
            // Return the relative path from the project root
            return pathParts.slice(projectStartIndex).join('/');
        }

        // If we couldn't parse it properly, return the original
        debugLog("Could not convert to relative path:", uri);
        return uri;
    } catch (error) {
        debugLog("Error converting to relative path:", uri, error);
        return uri;
    }
}

/**
 * Converts all URIs in a comment thread to relative paths
 */
function convertThreadToRelativePaths(thread: NotebookCommentThread): NotebookCommentThread {
    return {
        ...thread,
        cellId: thread.cellId ? {
            ...thread.cellId,
            uri: convertToRelativePath(thread.cellId.uri) || thread.cellId.uri
        } : thread.cellId
    };
}

export type ResolvedFile = {
    filepath: string;
    resolution: "deleted" | "created" | "modified";
};

/**
 * Main function to resolve all conflict files
 */
export async function resolveConflictFiles(
    conflicts: ConflictFile[],
    workspaceDir: string,
    options?: ResolveConflictOptions
): Promise<ResolvedFile[]> {
    debugLog("Starting conflict resolution with:", { conflicts, workspaceDir });

    // Validate inputs
    if (!Array.isArray(conflicts)) {
        console.error("Expected conflicts to be an array, got:", conflicts);
        return [];
    }

    if (conflicts.length === 0) {
        console.warn("No conflicts to resolve");
        return [];
    }

    const resolvedFiles: ResolvedFile[] = [];

    await vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Resolving conflicts...",
            cancellable: false,
        },
        async (progress) => {
            const totalConflicts = conflicts.length;
            let processedConflicts = 0;
            const reportProgress = (): void => {
                progress.report({
                    increment: (1 / totalConflicts) * 100,
                    message: `Processing file ${processedConflicts}/${totalConflicts}`,
                });
            };

            // Ensure all parent directories exist before resolving/writing files.
            // This is critical for heal, where locally-created directories may not exist in a fresh clone.
            try {
                const uniqueDirs = new Set<string>();
                for (const conflict of conflicts) {
                    if (!conflict || conflict.isDeleted) continue;
                    const rel = conflict.filepath.replace(/\\/g, "/").replace(/^\/+/, "");
                    const dir = path.posix.dirname(rel);
                    if (dir && dir !== ".") uniqueDirs.add(dir);
                }

                const sortedDirs = Array.from(uniqueDirs).sort(
                    (a, b) => a.split("/").length - b.split("/").length
                );
                for (const dir of sortedDirs) {
                    const dirUri = vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), ...dir.split("/"));
                    await vscode.workspace.fs.createDirectory(dirUri);
                }
            } catch (e) {
                console.error("Error creating parent directories for conflicts:", e);
                // Continue; individual writes will still attempt and report errors.
            }

            // Process conflicts with limited concurrency to reduce end-to-end delay on large conflict sets.
            // This avoids long sequential runs (and avoids noisy per-conflict console logging).
            const MAX_CONCURRENCY = 4;
            let nextIndex = 0;

            const processOne = async (conflict: ConflictFile): Promise<void> => {
                // Validate conflict object structure
                if (!isValidConflict(conflict)) {
                    console.error("Invalid conflict object:", conflict);
                    return;
                }

                const normalizedFilepath = conflict.filepath.replace(/\\/g, "/").replace(/^\/+/, "");
                const filePath = vscode.Uri.joinPath(
                    vscode.Uri.file(workspaceDir),
                    ...normalizedFilepath.split("/")
                );

                // Handle deleted file
                if (conflict.isDeleted) {
                    debugLog(`Deleting file: ${conflict.filepath}`);
                    try {
                        await vscode.workspace.fs.delete(filePath);
                        resolvedFiles.push({
                            filepath: conflict.filepath,
                            resolution: "deleted",
                        });
                    } catch (e) {
                        console.error(`Error deleting file ${conflict.filepath}:`, e);
                    }
                    return;
                }

                // Handle new file
                if (conflict.isNew) {
                    debugLog(`Creating new file: ${conflict.filepath}`);
                    try {
                        // IMPORTANT:
                        // `isNew` can mean "added on either side", including the case where BOTH sides
                        // created the same path after diverging (merge base missing the file).
                        // In that scenario, simply preferring `ours` will overwrite remote content.
                        const hasBothSides =
                            typeof conflict.ours === "string" &&
                            conflict.ours.length > 0 &&
                            typeof conflict.theirs === "string" &&
                            conflict.theirs.length > 0;

                        const differs = hasBothSides && conflict.ours !== conflict.theirs;

                        if (differs) {
                            // Attempt a real merge using the normal resolver/strategy logic.
                            // If the file already exists on disk, this is effectively a "modified" resolution.
                            // If it doesn't, the resolver will still write the merged content.
                            let existedOnDisk = true;
                            try {
                                await vscode.workspace.fs.stat(filePath);
                            } catch {
                                existedOnDisk = false;
                            }

                            const resolvedPath = await resolveConflictFile(conflict, workspaceDir);
                            if (resolvedPath) {
                                resolvedFiles.push({
                                    filepath: resolvedPath,
                                    resolution: existedOnDisk ? "modified" : "created",
                                });
                            }
                        } else {
                            // Use non-empty content (prefer ours, fallback to theirs)
                            const content = conflict.ours || conflict.theirs;
                            await vscode.workspace.fs.writeFile(filePath, Buffer.from(content));
                            resolvedFiles.push({
                                filepath: conflict.filepath,
                                resolution: "created",
                            });
                        }
                    } catch (e) {
                        console.error(`Error creating new file ${conflict.filepath}:`, e);
                    }
                    return;
                }

                // Handle existing file with conflicts
                try {
                    await vscode.workspace.fs.stat(filePath);
                } catch {
                    debugLog(`Skipping conflict resolution for missing file: ${conflict.filepath}`);
                    return;
                }

                const resolvedFile = await resolveConflictFile(conflict, workspaceDir, options);
                if (resolvedFile) {
                    resolvedFiles.push({
                        filepath: resolvedFile,
                        resolution: "modified",
                    });
                }
            };

            const worker = async (): Promise<void> => {
                while (nextIndex < conflicts.length) {
                    const i = nextIndex++;
                    const conflict = conflicts[i];

                    try {
                        await processOne(conflict);
                    } finally {
                        processedConflicts++;
                        reportProgress();
                    }
                }
            };

            const workerCount = Math.min(MAX_CONCURRENCY, conflicts.length);
            await Promise.all(Array.from({ length: workerCount }, () => worker()));
        }
    );

    return resolvedFiles;
}

