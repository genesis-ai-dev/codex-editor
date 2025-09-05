import { CodexCellDocument } from './../../../providers/codexCellEditorProvider/codexDocument';
import * as vscode from "vscode";
import * as path from "path";
import { ConflictResolutionStrategy, ConflictFile, SmartEdit } from "./types";
import { determineStrategy } from "./strategies";
import { getAuthApi } from "../../../extension";
import { NotebookCommentThread, NotebookComment, CustomNotebookCellData } from "../../../../types";
import { CommentsMigrator } from "../../../utils/commentsMigrationUtils";
import { CodexCell } from "@/utils/codexNotebookUtils";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import { EditHistory, ValidationEntry } from "../../../../types/index.d";
import { EditMapUtils } from "../../../utils/editMapUtils";
import { normalizeAttachmentUrl } from "@/utils/pathUtils";

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
        // Try git username first
        const gitUsername = vscode.workspace.getConfiguration("git").get<string>("username");
        if (gitUsername) return gitUsername;

        // Try VS Code authentication session
        try {
            const session = await vscode.authentication.getSession('github', ['user:email'], { createIfNone: false });
            if (session && session.account) {
                return session.account.label;
            }
        } catch (e) {
            // Auth provider might not be available
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
export async function resolveConflictFile(
    conflict: ConflictFile,
    workspaceDir: string
): Promise<string | undefined> {
    try {
        // No need to read files, we already have the content
        const strategy = determineStrategy(conflict.filepath);
        debugLog("Strategy:", strategy);
        let resolvedContent: string;

        // Ensure we have fresh content by re-reading the file
        const filePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), conflict.filepath);
        try {
            // Note: this is to ensure we have the latest content so recent user edits are not lost
            const latestFileContent = await vscode.workspace.fs.readFile(filePath);
            conflict.ours = Buffer.from(latestFileContent).toString('utf8');
        } catch (error) {
            debugLog(`Could not read fresh content for ${conflict.filepath}, using existing content:`, error);
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

            // SPECIAL = "special", // Merge based on timestamps/rules
            case ConflictResolutionStrategy.SPECIAL: {
                debugLog("Resolving special conflict for:", conflict.filepath);
                resolvedContent = await resolveSmartEditsConflict(conflict.ours, conflict.theirs);
                break;
            }

            // CODEX_CUSTOM_MERGE = "codex", // Special merge process for cell arrays
            case ConflictResolutionStrategy.CODEX_CUSTOM_MERGE: {
                debugLog("Resolving codex custom merge for:", conflict.filepath);
                resolvedContent = await resolveCodexCustomMerge(conflict.ours, conflict.theirs);
                debugLog("Successfully merged codex content");
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
    const allEdits = [
        ...(ourCell.metadata?.edits || []),
        ...(theirCell.metadata?.edits || [])
    ].sort((a, b) => a.timestamp - b.timestamp);

    // Group edits by their editMap path
    const editsByPath = new Map<string, any[]>();
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
    const resolvedCell = { ...ourCell };

    // For each metadata path, apply the most recent edit
    for (const [pathKey, edits] of editsByPath.entries()) {
        if (edits.length === 0) continue;

        // Find the most recent edit for this path
        const mostRecentEdit = edits.sort((a, b) => b.timestamp - a.timestamp)[0];

        // Apply the edit to the resolved cell based on the path
        applyEditToCell(resolvedCell, mostRecentEdit);

        debugLog(`Applied most recent edit for ${pathKey}: ${mostRecentEdit.value}`);
    }

    return resolvedCell;
}

/**
 * Helper function to merge validatedBy arrays between duplicate edits
 */
function mergeValidatedByArrays(existingEdit: any, newEdit: any): void {
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
            const existingEntryIndex = existingEdit.validatedBy.findIndex(
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
                existingEdit.validatedBy.push(validationEntry);
            } else {
                // User already has an entry, update if the new one is more recent
                const existingEntryItem = existingEdit.validatedBy[existingEntryIndex];
                if (typeof existingEntryItem === "string") {
                    existingEdit.validatedBy[existingEntryIndex] = validationEntry;
                } else if (
                    validationEntry.updatedTimestamp > existingEntryItem.updatedTimestamp
                ) {
                    existingEdit.validatedBy[existingEntryIndex] = {
                        ...validationEntry,
                        creationTimestamp: existingEntryItem.creationTimestamp,
                    };
                }
            }
        });
    }

    // Ensure the validatedBy array only contains ValidationEntry objects
    if (existingEdit.validatedBy && existingEdit.validatedBy.length > 0) {
        existingEdit.validatedBy = existingEdit.validatedBy.filter(
            (entry: any) => typeof entry !== "string"
        );
    }
}

/**
 * Helper function to apply an edit to a cell based on its editMap path
 */
function applyEditToCell(cell: CustomNotebookCellData, edit: any): void {
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
            edits: []
        };
    }

    try {
        if (path.length === 1 && path[0] === 'value') {
            // Direct cell value edit
            cell.value = value;
        } else if (path.length >= 2 && path[0] === 'metadata') {
            // Metadata field edit
            if (path.length === 2) {
                // Direct metadata field (e.g., cellLabel)
                const field = path[1];
                if (field === 'cellLabel') {
                    cell.metadata.cellLabel = value;
                } else if (field === 'selectedAudioId') {
                    cell.metadata.selectedAudioId = value;
                } else if (field === 'selectionTimestamp') {
                    cell.metadata.selectionTimestamp = value;
                }
            } else if (path.length === 3 && path[1] === 'data') {
                // Data field edit (e.g., startTime, endTime)
                const dataField = path[2];
                if (!cell.metadata.data) {
                    cell.metadata.data = {};
                }

                if (dataField === 'startTime') {
                    cell.metadata.data.startTime = value;
                } else if (dataField === 'endTime') {
                    cell.metadata.data.endTime = value;
                } else if (dataField === 'deleted') {
                    cell.metadata.data.deleted = value;
                } else {
                    // Generic data field assignment
                    (cell.metadata.data as any)[dataField] = value;
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

    debugLog(
        `Processing ${ourCells.length} cells from our version and ${theirCells.length} cells from their version`
    );

    // Map to track cells by ID for quick lookup
    const theirCellsMap = new Map<string, CustomNotebookCellData>(); // FIXME: this causes unknown cells to show up at the end of the notebook because we are making a mpa not array
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

            // Use the new metadata conflict resolution function
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
                        // Merge validatedBy arrays if both exist
                        const existingEdit = editMap.get(key)!;
                        mergeValidatedByArrays(existingEdit, edit);
                    }
                }
            });

            // Convert map back to array and sort
            const uniqueEdits = Array.from(editMap.values()).sort((a, b) => a.timestamp - b.timestamp);

            debugLog(`Filtered to ${uniqueEdits.length} unique edits for cell ${cellId}`);

            // Update the merged cell with the deduplicated edits
            if (!mergedCell.metadata) {
                mergedCell.metadata = {
                    id: cellId,
                    type: CodexCellTypes.TEXT,
                    edits: []
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

            debugLog(`Pushing merged cell ${cellId} to results`);
            resultCells.push(mergedCell);
            theirCellsMap.delete(cellId);
        } else {
            debugLog(`No conflict for cell ${cellId}, keeping our version`);
            resultCells.push(ourCell);
        }
    });

    // Add any new cells from their version
    theirCellsMap.forEach((cell, id) => {
        debugLog(`Adding their unique cell ${id} to results`);
        resultCells.push(cell);
    });

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

    // Return the full notebook structure with merged cells
    return JSON.stringify(
        {
            ...ourNotebook,
            cells: resultCells,
        },
        null,
        2
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
function mergeAttachments(
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

                // Use the version with the later updatedAt timestamp
                if (theirAttachment.updatedAt > ourAttachment.updatedAt) {
                    const normalized = { ...theirAttachment };
                    if (typeof normalized.url === "string") {
                        normalized.url = normalizeAttachmentUrl(normalized.url);
                    }
                    merged[id] = normalized;
                    debugLog(`Using their version of attachment ${id} (newer timestamp)`);
                } else {
                    debugLog(`Keeping our version of attachment ${id} (newer timestamp)`);
                }
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
 * Resolves conflicts in smart_edits.json files
 */
async function resolveSmartEditsConflict(
    ourContent: string,
    theirContent: string
): Promise<string> {
    // Handle empty content cases
    if (!ourContent.trim()) {
        return theirContent.trim() || "{}";
    }
    if (!theirContent.trim()) {
        return ourContent.trim() || "{}";
    }

    try {
        const ourEdits = JSON.parse(ourContent);
        const theirEdits = JSON.parse(theirContent);

        // Merge the edits, preferring newer versions for same cellIds
        const mergedEdits: Record<string, SmartEdit> = {};

        // Process our edits
        Object.entries(ourEdits).forEach(([cellId, edit]) => {
            mergedEdits[cellId] = edit as SmartEdit;
        });

        // Process their edits, comparing timestamps for conflicts
        Object.entries(theirEdits).forEach(([cellId, theirEdit]) => {
            if (!mergedEdits[cellId]) {
                mergedEdits[cellId] = theirEdit as SmartEdit;
            } else {
                const ourDate = new Date(mergedEdits[cellId].lastUpdatedDate);
                const theirDate = new Date((theirEdit as SmartEdit).lastUpdatedDate);

                if (theirDate > ourDate) {
                    mergedEdits[cellId] = theirEdit as SmartEdit;
                }

                // Merge suggestions arrays and deduplicate
                const allSuggestions = [
                    ...mergedEdits[cellId].suggestions,
                    ...(theirEdit as SmartEdit).suggestions,
                ];

                // Deduplicate suggestions based on oldString+newString combination
                mergedEdits[cellId].suggestions = Array.from(
                    new Map(
                        allSuggestions.map((sugg) => [`${sugg.oldString}:${sugg.newString}`, sugg])
                    ).values()
                );
            }
        });

        return JSON.stringify(mergedEdits, null, 2);
    } catch (error) {
        console.error("Error resolving smart_edits.json conflict:", error);
        return "{}"; // Return empty object if parsing fails
    }
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
    workspaceDir: string
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

            for (const conflict of conflicts) {
                console.log("conflict", { conflict });
                // Validate conflict object structure
                if (!isValidConflict(conflict)) {
                    console.error("Invalid conflict object:", conflict);
                    processedConflicts++;
                    progress.report({
                        increment: (1 / totalConflicts) * 100,
                        message: `Processing file ${processedConflicts}/${totalConflicts}`,
                    });
                    continue;
                }

                const filePath = vscode.Uri.joinPath(
                    vscode.Uri.file(workspaceDir),
                    conflict.filepath
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
                    processedConflicts++;
                    progress.report({
                        increment: (1 / totalConflicts) * 100,
                        message: `Processing file ${processedConflicts}/${totalConflicts}`,
                    });
                    continue;
                }

                // Handle new file
                if (conflict.isNew) {
                    debugLog(`Creating new file: ${conflict.filepath}`);
                    try {
                        // Use non-empty content (prefer ours, fallback to theirs)
                        const content = conflict.ours || conflict.theirs;
                        await vscode.workspace.fs.writeFile(filePath, Buffer.from(content));
                        resolvedFiles.push({
                            filepath: conflict.filepath,
                            resolution: "created",
                        });
                    } catch (e) {
                        console.error(`Error creating new file ${conflict.filepath}:`, e);
                    }
                    processedConflicts++;
                    progress.report({
                        increment: (1 / totalConflicts) * 100,
                        message: `Processing file ${processedConflicts}/${totalConflicts}`,
                    });
                    continue;
                }

                // Handle existing file with conflicts
                try {
                    await vscode.workspace.fs.stat(filePath);
                } catch {
                    debugLog(`Skipping conflict resolution for missing file: ${conflict.filepath}`);
                    processedConflicts++;
                    progress.report({
                        increment: (1 / totalConflicts) * 100,
                        message: `Processing file ${processedConflicts}/${totalConflicts}`,
                    });
                    continue;
                }

                const resolvedFile = await resolveConflictFile(conflict, workspaceDir);
                if (resolvedFile) {
                    resolvedFiles.push({
                        filepath: resolvedFile,
                        resolution: "modified",
                    });
                }
                processedConflicts++;
                progress.report({
                    increment: (1 / totalConflicts) * 100,
                    message: `Processing file ${processedConflicts}/${totalConflicts}`,
                });
            }
        }
    );

    return resolvedFiles;
}

