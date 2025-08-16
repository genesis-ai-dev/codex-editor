import * as vscode from "vscode";
import { CellLabelData, CellMetadata, FileData } from "./types";
import { CodexContentSerializer } from "../serializer";
import { getNotebookMetadataManager } from "../utils/notebookMetadataManager";

/**
 * Update cell labels in both source and target files
 */
export async function updateCellLabels(labels: CellLabelData[]): Promise<void> {
    // Use the dynamic import to avoid TS errors
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders"
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
            const md: any = cell.metadata || {};
            if (md?.id && labelsMap.has(md.id)) {
                // preserve all existing metadata fields
                const newMd: any = { ...md };
                newMd.cellLabel = labelsMap.get(md.id);
                cell.metadata = newMd;
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
            const md: any = cell.metadata || {};
            if (md?.id && labelsMap.has(md.id)) {
                const newMd: any = { ...md };
                newMd.cellLabel = labelsMap.get(md.id);
                cell.metadata = newMd;
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

        // Read existing notebook to preserve document-level metadata (e.g., videoUrl)
        let existingMetadata: any = {};
        try {
            const existingBytes = await vscode.workspace.fs.readFile(file.uri);
            const parsed = await serializer.deserializeNotebook(
                existingBytes,
                new vscode.CancellationTokenSource().token
            );
            existingMetadata = parsed.metadata || {};
        } catch (e) {
            // If reading fails, continue with empty metadata
            existingMetadata = {};
        }

        // Fallback: fetch metadata from NotebookMetadataManager if file-level metadata missing
        if (!existingMetadata || Object.keys(existingMetadata).length === 0) {
            try {
                const metadataManager = getNotebookMetadataManager();
                await metadataManager.initialize();
                await metadataManager.loadMetadata();
                const byUri = metadataManager.getMetadataByUri(file.uri);
                if (byUri) {
                    existingMetadata = { ...byUri };
                }
            } catch (e) {
                // ignore
            }
        }

        // Convert file data back to notebook format, preserving top-level metadata
        const notebookData = {
            cells: file.cells.map((cell) => ({
                kind: 2,
                value: cell.value,
                languageId: "scripture",
                metadata: cell.metadata,
            })),
            metadata: existingMetadata,
        } as any;

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
