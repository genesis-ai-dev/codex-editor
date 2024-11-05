import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { verseRefRegex } from "../../../../utils/verseRefUtils";
import { getWorkSpaceUri } from "../../../../utils";
import { FileData } from "./fileReaders";
import { debounce } from "lodash";
import { TranslationPair } from "../../../../../types";
import { NotebookMetadataManager } from "../../../../utils/notebookMetadataManager";

export interface minisearchDoc {
    id: string;
    cellId: string;
    document: string;
    section: string;
    cell: string;
    sourceContent: string;
    targetContent: string;
    uri: string;
    line: number;
}

interface TranslationPairsIndex {
    [cellId: string]: TranslationPair[];
}

export async function createTranslationPairsIndex(
    context: vscode.ExtensionContext,
    translationPairsIndex: MiniSearch<minisearchDoc>,
    sourceFiles: FileData[],
    targetFiles: FileData[],
    metadataManager: NotebookMetadataManager,
    force: boolean = false
): Promise<void> {
    console.time("createTranslationPairsIndex");
    const workspaceFolder = getWorkSpaceUri();
    if (!workspaceFolder) {
        console.warn(
            "Workspace folder not found for Translation Pairs Index. Returning empty index."
        );
        return;
    }

    const index = await indexAllDocuments(sourceFiles, targetFiles, metadataManager);

    translationPairsIndex.removeAll();
    // Update the configuration
    const documents = Object.values(index)
        .flat()
        .map((pair) => ({
            id: `${pair.sourceCell.uri}:${pair.cellId}`,
            cellId: pair.cellId,
            document: pair.cellId.split(" ")[0],
            section: pair.cellId.split(" ")[1].split(":")[0],
            cell: pair.cellId.split(":")[1],
            sourceContent: pair.sourceCell.content || "",
            targetContent: pair.targetCell.content || "",
            uri: pair.sourceCell.uri || "",
            line: pair.sourceCell.line || -1,
        }));

    translationPairsIndex.addAll(documents);

    // Configure index options
    const indexOptions = {
        fields: ["cellId", "document", "section", "sourceContent", "targetContent"],
        storeFields: [
            "id",
            "cellId",
            "document",
            "section",
            "sourceContent",
            "targetContent",
            "uri",
            "line",
        ],
        // ... other options ...
    };

    // Create a new MiniSearch instance with the configured options
    translationPairsIndex = new MiniSearch(indexOptions);

    // Re-add all documents to the new index
    translationPairsIndex.addAll(documents);

    console.log(
        "Translation pairs index created with",
        translationPairsIndex.documentCount,
        "documents"
    );
    console.timeEnd("createTranslationPairsIndex");

    async function indexAllDocuments(
        sourceFiles: FileData[],
        targetFiles: FileData[],
        metadataManager: NotebookMetadataManager
    ): Promise<TranslationPairsIndex> {
        const index: TranslationPairsIndex = {};
        const targetCellsMap = new Map<
            string,
            { content: string; uri: string; notebookId: string }
        >();

        for (const targetFile of targetFiles) {
            for (const cell of targetFile.cells) {
                if (
                    cell.metadata?.type === "text" &&
                    cell.metadata?.id &&
                    cell.value.trim() !== ""
                ) {
                    targetCellsMap.set(cell.metadata.id, {
                        content: cell.value,
                        uri: targetFile.uri.toString(),
                        notebookId: targetFile.id,
                    });
                }
            }
        }

        for (const sourceFile of sourceFiles) {
            for (const sourceCell of sourceFile.cells) {
                if (
                    sourceCell.metadata?.type === "text" &&
                    sourceCell.metadata?.id &&
                    sourceCell.value.trim() !== ""
                ) {
                    const cellId = sourceCell.metadata.id;
                    const targetCell = targetCellsMap.get(cellId);

                    if (targetCell) {
                        if (!index[cellId]) {
                            index[cellId] = [];
                        }
                        index[cellId].push({
                            cellId,
                            sourceCell: {
                                cellId,
                                content: sourceCell.value,
                                uri: sourceFile.uri.toString(),
                                line: -1,
                                notebookId: sourceFile.id,
                            },
                            targetCell: {
                                cellId,
                                content: targetCell.content,
                                uri: targetCell.uri,
                                line: -1,
                                notebookId: targetCell.notebookId,
                            },
                        });
                    }
                }
            }
        }

        return index;
    }

    async function indexDocument(
        document: vscode.TextDocument,
        targetVerseMap: Map<string, { content: string }>,
        translationPairsIndex: MiniSearch<minisearchDoc>
    ): Promise<number> {
        const uri = document.uri.toString();
        let indexedCount = 0;
        const batchSize = 1000;
        let batch: minisearchDoc[] = [];

        const processBatch = () => {
            if (batch.length > 0) {
                try {
                    translationPairsIndex.addAll(batch);
                    indexedCount += batch.length;
                } catch (error) {
                    if (error instanceof Error && error.message.includes("duplicate ID")) {
                        processBatchRecursively(batch);
                    } else {
                        throw error;
                    }
                }
                batch = [];
            }
        };

        const processBatchRecursively = (currentBatch: minisearchDoc[]) => {
            if (currentBatch.length === 0) return;
            const smallerBatch = currentBatch.filter((_, index) => index % 10 === 0);
            try {
                translationPairsIndex.addAll(smallerBatch);
                indexedCount += smallerBatch.length;
            } catch (error) {
                if (error instanceof Error && error.message.includes("duplicate ID")) {
                    for (const doc of smallerBatch) {
                        try {
                            translationPairsIndex.add(doc);
                            indexedCount++;
                        } catch (innerError) {
                            if (
                                innerError instanceof Error &&
                                innerError.message.includes("duplicate ID")
                            ) {
                                console.info(`Skipped duplicate ID: ${doc.id}`);
                            } else {
                                throw innerError;
                            }
                        }
                    }
                } else {
                    throw error;
                }
            }
            processBatchRecursively(currentBatch.filter((_, index) => index % 10 !== 0));
        };

        const lines = document.getText().split("\n");
        for (let i = 0; i < lines.length; i++) {
            const indexedDoc = indexLine(lines[i], i, uri, targetVerseMap);
            if (indexedDoc) {
                batch.push(indexedDoc);
                if (batch.length >= batchSize) {
                    processBatch();
                }
            }
        }

        processBatch();
        return indexedCount;
    }

    function indexLine(
        line: string,
        lineIndex: number,
        uri: string,
        targetVerseMap: Map<string, { content: string }>
    ): minisearchDoc | null {
        const match = line.match(verseRefRegex);
        if (match) {
            const [cellId] = match;
            if (targetVerseMap.has(cellId)) {
                const [document, sectionCell] = cellId.split(" ");
                const [section, cell] = sectionCell.split(":");
                const sourceContent = line.substring(match.index! + match[0].length).trim();
                const targetData = targetVerseMap.get(cellId)!;
                const id = `${uri}:${lineIndex}:${cellId}`;
                return {
                    id,
                    cellId,
                    document,
                    section,
                    cell,
                    sourceContent,
                    targetContent: targetData.content,
                    uri,
                    line: lineIndex,
                };
            }
        }
        return null;
    }

    const debouncedIndexDocument = debounce(async (doc: vscode.TextDocument) => {
        const targetVerseMap = new Map<string, { content: string }>();
        await indexDocument(doc, targetVerseMap, translationPairsIndex);
    }, 3000);

    context.subscriptions.push(
        vscode.workspace.onDidOpenTextDocument(async (doc: vscode.TextDocument) => {
            if (doc.uri.path.endsWith(".codex")) {
                await debouncedIndexDocument(doc);
            }
        }),
        vscode.workspace.onDidCloseTextDocument(async (doc: vscode.TextDocument) => {
            if (doc.uri.path.endsWith(".codex")) {
                await debouncedIndexDocument(doc);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(async (event: vscode.TextDocumentChangeEvent) => {
            const doc = event.document;
            if (doc.uri.path.endsWith(".codex")) {
                await debouncedIndexDocument(doc);
            }
        })
    );
}
