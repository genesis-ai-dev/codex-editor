import * as vscode from "vscode";
import * as path from "path";
import { ConflictResolutionStrategy, ConflictFile, SmartEdit } from "./types";
import { determineStrategy } from "./strategies";
import { getAuthApi } from "../../../extension";
import { NotebookCommentThread, NotebookComment } from "../../../../types";
import { CommentsMigrator } from "../../../utils/commentsMigrationUtils";
import { CodexCell } from "@/utils/codexNotebookUtils";
import { CodexCellTypes, EditType } from "../../../../types/enums";
import { EditHistory, ValidationEntry } from "../../../../types/index.d";

const DEBUG_MODE = false;
function debugLog(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Resolvers]", ...args);
    }
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
    return threads.some(thread =>
        thread.comments && thread.comments.some((comment: any) =>
            typeof comment.timestamp !== 'number' || typeof comment.id === 'number'
        )
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
    debugLog("Parsing notebook content");
    if (!ourContent) {
        debugLog("No our content, returning their content");
        return theirContent;
    }
    if (!theirContent) {
        debugLog("No their content, returning our content");
        return ourContent;
    }
    const ourNotebook = JSON.parse(ourContent);
    const theirNotebook = JSON.parse(theirContent);
    const ourCells: CodexCell[] = ourNotebook.cells;
    const theirCells: CodexCell[] = theirNotebook.cells;

    debugLog(
        `Processing ${ourCells.length} cells from our version and ${theirCells.length} cells from their version`
    );

    // Map to track cells by ID for quick lookup
    const theirCellsMap = new Map<string, CodexCell>(); // FIXME: this causes unknown cells to show up at the end of the notebook because we are making a mpa not array
    theirCells.forEach((cell) => {
        if (cell.metadata?.id) {
            theirCellsMap.set(cell.metadata.id, cell);
            debugLog(`Mapped their cell with ID: ${cell.metadata.id}`);
        }
    });

    const resultCells: CodexCell[] = [];

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
            // Merge edit histories
            const mergedEdits = [
                ...(ourCell.metadata?.edits || []),
                ...(theirCell.metadata?.edits || []),
            ].sort((a, b) => a.timestamp - b.timestamp);

            debugLog(`Combined ${mergedEdits.length} edits for cell ${cellId}`);

            // Remove duplicates based on timestamp and cellValue, while merging validatedBy entries
            const editMap = new Map<string, EditHistory>();

            // First pass: Group edits by timestamp and cellValue
            mergedEdits.forEach((edit) => {
                const key = `${edit.timestamp}:${edit.cellValue}`;
                if (!editMap.has(key)) {
                    editMap.set(key, edit);
                } else {
                    // Merge validatedBy arrays if both exist
                    const existingEdit = editMap.get(key)!;

                    // Initialize validatedBy arrays if they don't exist
                    if (!existingEdit.validatedBy) existingEdit.validatedBy = [];
                    if (!edit.validatedBy) edit.validatedBy = [];

                    // Combine validation entries
                    if (edit.validatedBy.length > 0) {
                        edit.validatedBy.forEach((entry: any) => {
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
                                    // Skip invalid entries that are neither strings nor ValidationEntry objects
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
                                // User already has an entry
                                const existingEntryItem =
                                    existingEdit.validatedBy![existingEntryIndex];

                                // If existing entry is a string, replace it with the object
                                if (typeof existingEntryItem === "string") {
                                    existingEdit.validatedBy![existingEntryIndex] = validationEntry;
                                } else {
                                    // Both are objects, update if the new one is more recent
                                    if (
                                        validationEntry.updatedTimestamp >
                                        existingEntryItem.updatedTimestamp
                                    ) {
                                        existingEdit.validatedBy![existingEntryIndex] = {
                                            ...validationEntry,
                                            // Keep the original creation timestamp
                                            creationTimestamp: existingEntryItem.creationTimestamp,
                                        };
                                    }
                                }
                            }
                        });
                    }

                    // After merging, ensure the validatedBy array only contains ValidationEntry objects
                    if (existingEdit.validatedBy && existingEdit.validatedBy.length > 0) {
                        existingEdit.validatedBy = existingEdit.validatedBy.filter(
                            (entry) => typeof entry !== "string"
                        );
                    }
                }
            });

            // Convert map back to array
            const uniqueEdits = Array.from(editMap.values());

            debugLog(`Filtered to ${uniqueEdits.length} unique edits for cell ${cellId}`);

            // Sort edits by timestamp to ensure most recent is last
            uniqueEdits.sort((a, b) => a.timestamp - b.timestamp);
            debugLog({ uniqueEdits });
            const latestEdit = uniqueEdits[uniqueEdits.length - 1];

            debugLog({ latestEdit });

            //! NOTE: the following logic is a bit convoluted, but there may be
            // a case where there is an LLM-generated edit that is the most recent edit,
            // and it does not have a user edit confirming it.
            // in this case, we want to take the user edit, because it is more reliable.
            // so we need to find the user edit that confirms the LLM edit, or else take the
            // user edit.
            // This seems like an anti-pattern because we are storing the cell value in two
            // places, which results in cache-invalidation-type issues, but this also provides
            // us with really rich data in the edit history, which is crucial for tracking
            // the effectiveness of the LLM-generated edits.

            //! get the last time we set our current cell value
            const ourEditsThatMatchCurrentValue = ourCell.metadata?.edits
                ?.filter((edit) => edit.cellValue === ourCell?.value)
                .sort((a, b) => a.timestamp - b.timestamp);
            const editThatBelongsToOurCellValue =
                ourEditsThatMatchCurrentValue?.[ourEditsThatMatchCurrentValue.length - 1];

            //! get the last time they set our current cell value
            const theirEditsThatMatchCurrentValue = theirCell.metadata?.edits
                ?.filter((theirEdit) => theirEdit.cellValue === theirCell?.value)
                .sort((a, b) => a.timestamp - b.timestamp);
            const editThatBelongsToTheirCellValue =
                theirEditsThatMatchCurrentValue?.[theirEditsThatMatchCurrentValue.length - 1];

            //! we want to know which edit is responsible for the current respectivre cell value, and
            // then take the most recent of the two
            const mostRecentOfTheirAndOurEdits = [
                editThatBelongsToTheirCellValue,
                editThatBelongsToOurCellValue,
            ].sort((a, b) => (a?.timestamp ?? 0) - (b?.timestamp ?? 0))[1];

            debugLog({ editThatBelongsToOurCellValue, editThatBelongsToTheirCellValue });

            // A fallback value is needed because sometimes edit history can be lost but one of the files has a cell value.
            // We default our own but if ours is an empty string we use their cell value
            const fallbackValue = ourCell.value || theirCell.value;
            // Ensure the latest edit is in the history
            let finalValue = mostRecentOfTheirAndOurEdits?.cellValue ?? fallbackValue; // Nullish coalescing to keep empty strings from being overwritten
            if (
                (ourCell.metadata?.edits?.length || 0) === 0 &&
                (theirCell.metadata?.edits?.length || 0) > 0
            ) {
                finalValue = theirCell.value;
            }
            const finalEdits = [...uniqueEdits];
            debugLog({ finalValue, finalEdits });

            // Sort one final time to ensure the new edit is properly placed
            finalEdits.sort((a, b) => a.timestamp - b.timestamp);

            // Ensure all edits have properly formatted validatedBy arrays (no strings)
            finalEdits.forEach((edit) => {
                if (edit.validatedBy) {
                    // Convert any remaining string entries to ValidationEntry objects
                    const validatedBy = edit.validatedBy
                        .map((entry) => {
                            if (!isValidValidationEntry(entry)) {
                                // Handle string entries
                                if (typeof entry === "string") {
                                    const currentTimestamp = Date.now();
                                    return {
                                        username: entry,
                                        creationTimestamp: currentTimestamp,
                                        updatedTimestamp: currentTimestamp,
                                        isDeleted: false,
                                    };
                                }
                                // Skip invalid entries
                                return null;
                            }
                            return entry;
                        })
                        .filter((entry) => entry !== null) as ValidationEntry[];

                    // Deduplicate by username (keep newest)
                    const usernameMap = new Map<string, ValidationEntry>();
                    validatedBy.forEach((entry) => {
                        const existingEntry = usernameMap.get(entry.username);
                        if (
                            !existingEntry ||
                            entry.updatedTimestamp > existingEntry.updatedTimestamp
                        ) {
                            usernameMap.set(entry.username, entry);
                        }
                    });

                    // Replace with deduplicated array
                    edit.validatedBy = Array.from(usernameMap.values());
                }
            });


            // temporary fix: we need to store all mutable fields in the edit history, not the cell metadata
            // Determine which cellLabel to use - prefer the longer one
            let cellLabelToUse = ourCell.metadata?.cellLabel;
            if (theirCell.metadata?.cellLabel && ourCell.metadata?.cellLabel) {
                // Both have cellLabels, use the longer one
                cellLabelToUse = theirCell.metadata.cellLabel.length > ourCell.metadata.cellLabel.length
                    ? theirCell.metadata.cellLabel
                    : ourCell.metadata.cellLabel;
            } else if (theirCell.metadata?.cellLabel) {
                // Only their cell has a cellLabel
                cellLabelToUse = theirCell.metadata.cellLabel;
            }
            // If only our cell has a cellLabel or neither has one, we'll use ours (which might be undefined)

            // Create merged cell with combined history
            const mergedCell: CodexCell = {
                ...ourCell,
                value: finalValue,
                metadata: {
                    ...{ ...theirCell.metadata, ...ourCell.metadata, }, // Fixme: this needs to be triangulated based on the last common commit
                    data: { ...theirCell.metadata?.data, ...ourCell.metadata?.data, },
                    cellLabel: cellLabelToUse,
                    id: cellId,
                    edits: finalEdits,
                    type: ourCell.metadata?.type || CodexCellTypes.TEXT,
                },
            };

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
async function resolveCommentThreadsConflict(
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
    ourThreads.forEach((thread) => {
        let migratedThread = { ...thread };

        // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
        // Remove legacy uri field if it exists
        delete (migratedThread as any).uri;

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
    });

    // Merge their threads, combining comments when thread IDs match
    theirThreads.forEach((theirThread) => {
        const existingThread = threadMap.get(theirThread.id);

        // Migrate their thread if needed
        let migratedTheirThread = { ...theirThread };

        // ============= MIGRATION CLEANUP (TODO: Remove after all users updated) =============
        // Remove legacy uri field if it exists
        delete (migratedTheirThread as any).uri;

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

            // Always use the merged comments array
            mergedThread.comments = Array.from(allComments.values())
                .sort((a, b) => a.timestamp - b.timestamp);

            // Update the thread in the map
            threadMap.set(mergedThread.id, mergedThread);
            debugLog(`Merged thread ${mergedThread.id} with ${mergedThread.comments.length} total comments`);
        }
    });

    const mergedThreads = Array.from(threadMap.values());
    return CommentsMigrator.formatCommentsForStorage(mergedThreads);
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

