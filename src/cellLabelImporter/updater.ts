import * as vscode from "vscode";
import { CellLabelData, CellMetadata, FileData } from "./types";
import { CodexContentSerializer } from "../serializer";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";
import { EditMapUtils } from "../utils/editMapUtils";
import { EditType } from "../../types/enums";
import { getAuthApi } from "../extension";

/**
 * Update cell labels in both source and target files
 * Now properly groups labels by their source file to prevent cross-file contamination
 */
export async function updateCellLabels(labels: CellLabelData[]): Promise<void> {

    // Group labels by their source file URI
    const labelsByFile = new Map<string, Map<string, string>>();

    labels.forEach((label) => {
        if (label.cellId && label.newLabel && label.sourceFileUri) {
            // Get or create the map for this file
            if (!labelsByFile.has(label.sourceFileUri)) {
                labelsByFile.set(label.sourceFileUri, new Map<string, string>());
            }
            const fileLabels = labelsByFile.get(label.sourceFileUri)!;
            fileLabels.set(label.cellId, label.newLabel);
        } else if (label.cellId && label.newLabel && !label.sourceFileUri) {
            console.warn(
                `[updateCellLabels] Label for cell ${label.cellId} has no sourceFileUri - skipping to prevent ambiguous updates`
            );
        }
    });

    console.log(
        `[updateCellLabels] Updating ${labelsByFile.size} files with ${labels.length} total labels`
    );

    // Now update each file with a fresh read immediately before write
    for (const [fileUriString, fileLabels] of labelsByFile.entries()) {
        const uri = vscode.Uri.file(fileUriString);
        await saveNotebookFileWithLabels(uri, fileLabels);
    }

    // Also update corresponding target files (codex files)
    await updateCorrespondingTargetFiles(labelsByFile);
}

/**
 * Update corresponding target (codex) files with the same labels
 */
async function updateCorrespondingTargetFiles(
    labelsByFile: Map<string, Map<string, string>>
): Promise<void> {
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders"
    );
    const { targetFiles } = await readSourceAndTargetFiles();

    // Create a map of source URI to target file
    const metadataManager = getNotebookMetadataManager();
    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    for (const [sourceFileUri, fileLabels] of labelsByFile.entries()) {
        // Find the corresponding target file by matching the file ID
        const sourceFileName = sourceFileUri.split(/[/\\]/).pop()?.replace('.source', '');
        const targetFile = targetFiles.find((tf) => {
            const targetFileName = tf.uri.fsPath.split(/[/\\]/).pop()?.replace('.codex', '');
            return targetFileName === sourceFileName;
        });

        if (targetFile) {
            console.log(
                `[updateCellLabels] Updating corresponding target file: ${targetFile.uri.fsPath}`
            );
            await saveNotebookFileWithLabels(targetFile.uri, fileLabels);
        }
    }
}

/**
 * Save notebook file with label updates using fresh file read to avoid race conditions
 * Now also creates proper edit history entries for each label change
 */
async function saveNotebookFileWithLabels(
    uri: vscode.Uri,
    labelsToApply: Map<string, string>
): Promise<void> {
    try {
        const serializer = new CodexContentSerializer();

        // Get current user for edit history
        let currentUser = "anonymous";
        try {
            const authApi = getAuthApi();
            const userInfo = await authApi?.getUserInfo();
            currentUser = userInfo?.username || "anonymous";
        } catch (error) {
            console.warn("[updateCellLabels] Could not get user info, using 'anonymous'");
        }

        // CRITICAL: Read the file fresh immediately before writing to avoid stale data
        const fileBytes = await vscode.workspace.fs.readFile(uri);
        const notebookData = await serializer.deserializeNotebook(
            fileBytes,
            new vscode.CancellationTokenSource().token
        );

        // Preserve existing document-level metadata
        const existingMetadata = notebookData.metadata || {};

        // Apply label updates to the freshly-read cells
        let updateCount = 0;
        let skippedCount = 0;
        const currentTimestamp = Date.now();

        for (const cell of notebookData.cells) {
            const md: any = cell.metadata || {};
            if (md?.id && labelsToApply.has(md.id)) {
                const newLabel = labelsToApply.get(md.id)!;

                // Preserve all existing metadata fields and add/update cellLabel
                cell.metadata = {
                    ...md,
                    cellLabel: newLabel,
                };

                // Initialize edits array if it doesn't exist
                if (!cell.metadata.edits) {
                    cell.metadata.edits = [];
                }

                // Create edit history entry for the label change
                cell.metadata.edits.push({
                    editMap: EditMapUtils.cellLabel(),
                    value: newLabel,
                    timestamp: currentTimestamp,
                    type: EditType.USER_EDIT,
                    author: currentUser,
                    validatedBy: [
                        {
                            username: currentUser,
                            creationTimestamp: currentTimestamp,
                            updatedTimestamp: currentTimestamp,
                            isDeleted: false,
                        },
                    ],
                });

                updateCount++;
            } else if (labelsToApply.size > 0 && md?.id) {
                // Cell exists but no label for it - this is normal
            }
        }

        // Check if some labels couldn't be applied (cells not found in file)
        const appliedCellIds = new Set<string>();
        for (const cell of notebookData.cells) {
            if (cell.metadata?.id) {
                appliedCellIds.add(cell.metadata.id);
            }
        }
        for (const cellId of labelsToApply.keys()) {
            if (!appliedCellIds.has(cellId)) {
                skippedCount++;
                console.warn(
                    `[updateCellLabels] Cell ${cellId} not found in ${uri.fsPath} - label skipped`
                );
            }
        }

        console.log(
            `[updateCellLabels] Applied ${updateCount} label updates to ${uri.fsPath}` +
            (skippedCount > 0 ? ` (${skippedCount} labels skipped - cells not found in this file)` : '')
        );

        // Only write if we actually updated something
        if (updateCount > 0) {
            // Serialize and write atomically
            const cancellationToken = new vscode.CancellationTokenSource().token;
            const content = await serializer.serializeNotebook(notebookData, cancellationToken);
            await vscode.workspace.fs.writeFile(uri, content);
        }
    } catch (error) {
        console.error(`Failed to save notebook file: ${uri.toString()}`, error);
        throw new Error(
            `Failed to save notebook file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
