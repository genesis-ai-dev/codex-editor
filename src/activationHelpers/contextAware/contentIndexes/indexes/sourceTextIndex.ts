import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceCellVersions } from "../../../../../types";
import { FileData } from "./fileReaders";
import { NotebookMetadataManager } from "../../../../utils/notebookMetadataManager";
import { initializeStateStore } from "../../../../stateStore";
import { SQLiteIndexManager } from "./sqliteIndex";

// Type that can be either MiniSearch or SQLiteIndexManager
type IndexType = MiniSearch<SourceCellVersions> | SQLiteIndexManager;

export async function createSourceTextIndex(
    sourceTextIndex: IndexType,
    sourceFiles: FileData[],
    metadataManager: NotebookMetadataManager,
    force: boolean = false
): Promise<IndexType> {
    const cellMap = new Map<string, { content: string; versions: string[]; notebookId: string }>();

    // Filter for all .source files
    const allSourceFiles = sourceFiles.filter((file) => file.uri.fsPath.endsWith(".source"));

    if (allSourceFiles.length === 0) {
        console.error("No .source files found");
        return sourceTextIndex;
    }

    for (const sourceFile of allSourceFiles) {
        const version = sourceFile.id; // Use the notebook ID as the version

        for (const cell of sourceFile.cells) {
            if (cell.metadata?.type === "text" && cell.metadata?.id && cell.value.trim() !== "") {
                const cellId = cell.metadata.id;
                if (cellMap.has(cellId)) {
                    const existingCell = cellMap.get(cellId)!;
                    existingCell.versions.push(version);
                } else {
                    cellMap.set(cellId, {
                        content: cell.value,
                        versions: [version],
                        notebookId: sourceFile.id,
                    });
                }
            }
        }
    }

    // Update the index with all cells from all .source files
    for (const [cellId, { content, versions, notebookId }] of cellMap.entries()) {
        if (sourceTextIndex instanceof SQLiteIndexManager) {
            // For SQLiteIndexManager, use the add method
            await sourceTextIndex.add({
                cellId,
                content,
                versions,
                notebookId,
            });
        } else {
            // For MiniSearch
            const existingDoc = (sourceTextIndex as MiniSearch<SourceCellVersions>).getStoredFields(
                cellId
            );
            if (
                !existingDoc ||
                existingDoc.content !== content ||
                !versions.every((v) => (existingDoc.versions as string[]).includes(v))
            ) {
                if (existingDoc) {
                    (sourceTextIndex as MiniSearch<SourceCellVersions>).remove(cellId as any);
                }
                (sourceTextIndex as MiniSearch<SourceCellVersions>).add({
                    cellId,
                    content,
                    versions,
                    notebookId,
                });
            }
        }
    }

    console.log(
        `Source texts index updated with ${sourceTextIndex.documentCount} cells from ${allSourceFiles.length} source files`
    );

    initializeStateStore().then(({ updateStoreState }) => {
        // Update cellId
        const cellMapObject = Object.fromEntries(cellMap);
        updateStoreState({ key: "sourceCellMap", value: cellMapObject });
    });

    return sourceTextIndex;
}
