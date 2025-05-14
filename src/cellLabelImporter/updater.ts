import * as vscode from "vscode";
import { CellLabelData, CellMetadata, FileData } from "./types";
import { CodexContentSerializer } from "../serializer";

/**
 * Update cell labels in both source and target files
 */
export async function updateCellLabels(labels: CellLabelData[]): Promise<void> {
    // Use the dynamic import to avoid TS errors
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/miniIndex/indexes/fileReaders"
    );
    const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();

    // Create a map for quick lookup of cell IDs
    const labelsMap = new Map<string, string>();
    labels.forEach((label) => {
        if (label.cellId && label.newLabel) {
            labelsMap.set(label.cellId, label.newLabel);
        }
    });

    // Update labels in source files
    for (const file of sourceFiles) {
        let fileModified = false;

        for (const cell of file.cells) {
            if (cell.metadata?.id && labelsMap.has(cell.metadata.id)) {
                (cell.metadata as CellMetadata).cellLabel = labelsMap.get(cell.metadata.id);
                fileModified = true;
            }
        }

        if (fileModified) {
            await saveNotebookFile(file);
        }
    }

    // Update labels in target files
    for (const file of targetFiles) {
        let fileModified = false;

        for (const cell of file.cells) {
            if (cell.metadata?.id && labelsMap.has(cell.metadata.id)) {
                (cell.metadata as CellMetadata).cellLabel = labelsMap.get(cell.metadata.id);
                fileModified = true;
            }
        }

        if (fileModified) {
            await saveNotebookFile(file);
        }
    }
}

/**
 * Save the modified notebook file
 */
async function saveNotebookFile(file: FileData): Promise<void> {
    try {
        // Create a serializer
        const serializer = new CodexContentSerializer();

        // Convert file data back to notebook format
        const notebookData = {
            cells: file.cells.map((cell) => ({
                kind: 2, // Assuming all cells are "text" type
                value: cell.value,
                languageId: "scripture",
                metadata: cell.metadata,
            })),
        };

        // Serialize the notebook with a proper cancellation token
        const cancellationToken = new vscode.CancellationTokenSource().token;
        const content = await serializer.serializeNotebook(notebookData, cancellationToken);

        // Write the file
        await vscode.workspace.fs.writeFile(file.uri, content);
    } catch (error) {
        console.error(`Failed to save notebook file: ${file.uri.toString()}`, error);
        throw new Error(
            `Failed to save notebook file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}
