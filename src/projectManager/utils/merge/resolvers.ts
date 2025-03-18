import * as vscode from "vscode";
import * as path from "path";
import { ConflictResolutionStrategy, ConflictFile, SmartEdit } from "./types";
import { determineStrategy } from "./strategies";
import { getAuthApi } from "../../../extension";
import { NotebookCommentThread, NotebookComment } from "../../../../types";
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

            // Create merged cell with combined history
            const mergedCell: CodexCell = {
                ...ourCell,
                value: finalValue,
                metadata: {
                    ...ourCell.metadata,
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

    // Create a map to store merged threads by ID
    const threadMap = new Map<string, NotebookCommentThread>();

    // Process our threads first
    ourThreads.forEach((thread) => {
        threadMap.set(thread.id, { ...thread });
    });

    // Merge their threads, combining comments when thread IDs match
    theirThreads.forEach((theirThread) => {
        const existingThread = threadMap.get(theirThread.id);

        if (!existingThread) {
            // New thread, just add it
            threadMap.set(theirThread.id, { ...theirThread });
        } else {
            // Merge comments for existing thread
            const allComments = new Map<number, NotebookComment>();

            // Add our comments
            existingThread.comments.forEach((comment) => {
                allComments.set(comment.id, { ...comment });
            });

            // Add/merge their comments
            theirThread.comments.forEach((comment) => {
                if (!allComments.has(comment.id)) {
                    allComments.set(comment.id, { ...comment });
                }
                // If comment exists, keep existing one (first writer wins)
            });

            // Update thread with merged comments
            existingThread.comments = Array.from(allComments.values()).sort((a, b) => a.id - b.id); // Maintain comment order
        }
    });

    const mergedThreads = Array.from(threadMap.values());
    return JSON.stringify(mergedThreads, null, 2);
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

    // Only call completeMerge if we actually resolved something
    const authApi = getAuthApi();
    if (authApi && resolvedFiles.length > 0) {
        try {
            await authApi.completeMerge(resolvedFiles);
        } catch (e) {
            console.error("Failed to complete merge:", e);
            vscode.window.showErrorMessage("Failed to complete merge after resolving conflicts");
        }
    }

    return resolvedFiles;
}

function isValidConflict(conflict: any): conflict is ConflictFile {
    return (
        conflict &&
        typeof conflict.filepath === "string" &&
        typeof conflict.ours === "string" &&
        typeof conflict.theirs === "string" &&
        typeof conflict.base === "string"
    );
}
