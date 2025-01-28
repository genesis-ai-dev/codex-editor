import * as vscode from "vscode";
import * as path from "path";
import { ConflictResolutionStrategy, ConflictFile, SmartEdit } from "./types";
import { determineStrategy } from "./strategies";
import { getAuthApi } from "../../../extension";
import { NotebookCommentThread } from "../../../../types/index";
import { NotebookComment } from "../../../../types/index";
import { CodexCell } from "@/utils/codexNotebookUtils";
import { CodexCellTypes, EditType } from "../../../../types/enums";

const DEBUG_MODE = true;
const debug = DEBUG_MODE ? console.log : () => {};

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
        debug("Strategy:", strategy);
        let resolvedContent: string;

        switch (strategy) {
            case ConflictResolutionStrategy.IGNORE:
                debug("Ignoring conflict for:", conflict.filepath);
                resolvedContent = conflict.ours; // Keep our version
                break;

            case ConflictResolutionStrategy.SOURCE:
            case ConflictResolutionStrategy.OVERRIDE: {
                debug("Resolving conflict for:", conflict.filepath);
                // TODO: Compare content timestamps if embedded in the content
                // For now, default to our version
                resolvedContent = conflict.ours;
                break;
            }

            case ConflictResolutionStrategy.JSONL: {
                debug("Resolving JSONL conflict for:", conflict.filepath);
                // Parse and merge JSONL content
                const ourLines = conflict.ours.split("\n").filter(Boolean);
                const theirLines = conflict.theirs.split("\n").filter(Boolean);

                // Combine and deduplicate
                const allLines = new Set([...ourLines, ...theirLines]);
                resolvedContent = Array.from(allLines).join("\n");
                break;
            }

            case ConflictResolutionStrategy.ARRAY: {
                debug("Resolving array conflict for:", conflict.filepath);
                // Special handling for notebook comment thread arrays
                resolvedContent = await resolveCommentThreadsConflict(
                    conflict.ours,
                    conflict.theirs
                );
                break;
            }

            // SPECIAL = "special", // Merge based on timestamps/rules
            case ConflictResolutionStrategy.SPECIAL: {
                debug("Resolving special conflict for:", conflict.filepath);
                resolvedContent = await resolveSmartEditsConflict(conflict.ours, conflict.theirs);
                break;
            }

            // CODEX_CUSTOM_MERGE = "codex", // Special merge process for cell arrays
            case ConflictResolutionStrategy.CODEX_CUSTOM_MERGE: {
                debug("Resolving codex custom merge for:", conflict.filepath);
                resolvedContent = await resolveCodexCustomMerge(conflict.ours, conflict.theirs);
                debug("Successfully merged codex content");
                break;
            }

            default:
                resolvedContent = conflict.ours; // Default to our version
        }

        // Write resolved content back to the actual file
        const targetPath = vscode.Uri.file(path.join(workspaceDir, conflict.filepath));
        debug("Writing resolved content to:", targetPath.fsPath);
        await vscode.workspace.fs.writeFile(targetPath, Buffer.from(resolvedContent));
        debug("Successfully wrote content for:", conflict.filepath);

        return conflict.filepath;
    } catch (e) {
        console.error(`Error resolving conflict for ${conflict.filepath}:`, e);
        vscode.window.showErrorMessage(`Failed to resolve conflict in ${conflict.filepath}`);
        return undefined;
    }
}

/**
 * Resolves conflicts in Codex notebook cell arrays.
 * - note, resolving metadata distinctions does not have an obvious solution.
 * I suspect this is not going to be an issue, since we hardly use the metadata.
 * - we simply take 'our' version of the metadata.
 */
async function resolveCodexCustomMerge(ourContent: string, theirContent: string): Promise<string> {
    const ourNotebook = JSON.parse(ourContent);
    const theirNotebook = JSON.parse(theirContent);
    const ourCells: CodexCell[] = ourNotebook.cells;
    const theirCells: CodexCell[] = theirNotebook.cells;

    // Map to track cells by ID for quick lookup
    const theirCellsMap = new Map<string, CodexCell>();
    theirCells.forEach((cell) => {
        if (cell.metadata?.id) {
            theirCellsMap.set(cell.metadata.id, cell);
        }
    });

    const resultCells: CodexCell[] = [];

    // Process our cells in order
    ourCells.forEach((ourCell) => {
        const cellId = ourCell.metadata?.id;
        if (!cellId) return;

        const theirCell = theirCellsMap.get(cellId);
        if (theirCell) {
            // Merge edit histories
            const mergedEdits = [
                ...(ourCell.metadata?.edits || []),
                ...(theirCell.metadata?.edits || []),
            ].sort((a, b) => a.timestamp - b.timestamp);

            // Remove duplicates based on timestamp and cellValue
            const uniqueEdits = mergedEdits.filter(
                (edit, index, self) =>
                    index ===
                    self.findIndex(
                        (e) => e.timestamp === edit.timestamp && e.cellValue === edit.cellValue
                    )
            );

            // Get the latest user edit's value, or latest edit if no user edits exist
            // i.e., we will take the latest llm generation if there are no user edits
            const latestEdit =
                uniqueEdits.reverse().find((edit) => edit.type === EditType.USER_EDIT) ||
                uniqueEdits[uniqueEdits.length - 1];

            // Create merged cell with combined history
            const mergedCell: CodexCell = {
                ...ourCell,
                value: latestEdit?.cellValue || ourCell.value,
                metadata: {
                    ...ourCell.metadata,
                    id: cellId, // We already checked cellId exists above
                    edits: uniqueEdits,
                    type: ourCell.metadata?.type || CodexCellTypes.TEXT, // Fix type error by ensuring type is set
                },
            };

            resultCells.push(mergedCell);
            theirCellsMap.delete(cellId);
        } else {
            // No conflict, just add our cell
            resultCells.push(ourCell);
        }
    });

    // Add any new cells from their version
    theirCellsMap.forEach((cell) => {
        resultCells.push(cell);
    });

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

/**
 * Main function to resolve all conflict files
 */
export async function resolveConflictFiles(
    conflicts: ConflictFile[],
    workspaceDir: string
): Promise<string[]> {
    console.log("RYDER**** Starting conflict resolution with:", { conflicts, workspaceDir });

    // Validate inputs
    if (!Array.isArray(conflicts)) {
        console.error("Expected conflicts to be an array, got:", conflicts);
        return [];
    }

    if (conflicts.length === 0) {
        console.warn("No conflicts to resolve");
        return [];
    }

    const resolvedFiles: string[] = [];

    for (const conflict of conflicts) {
        // Validate conflict object structure
        if (!isValidConflict(conflict)) {
            console.error("Invalid conflict object:", conflict);
            continue;
        }

        // Check if file exists before trying to resolve
        const filePath = vscode.Uri.joinPath(vscode.Uri.file(workspaceDir), conflict.filepath);
        try {
            await vscode.workspace.fs.stat(filePath);
        } catch {
            console.log(`Skipping conflict resolution for deleted file: ${conflict.filepath}`);
            continue;
        }

        const resolvedFile = await resolveConflictFile(conflict, workspaceDir);
        if (resolvedFile) {
            resolvedFiles.push(resolvedFile);
        }
    }

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
