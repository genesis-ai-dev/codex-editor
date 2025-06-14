import * as vscode from "vscode";
import { verseRefRegex } from "../../../../utils/verseRefUtils";
import { getWorkSpaceUri } from "../../../../utils";
import { FileData } from "./fileReaders";
import { debounce } from "lodash";
import { TranslationPair } from "../../../../../types";
import { NotebookMetadataManager } from "../../../../utils/notebookMetadataManager";
import { SQLiteIndexManager } from "./sqliteIndex";

export interface searchResult {
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

type IndexType = SQLiteIndexManager;

export async function createTranslationPairsIndex(
    context: vscode.ExtensionContext,
    translationPairsIndex: IndexType,
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

    await translationPairsIndex.removeAll();

    // Prepare documents for indexing
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
            hasTargetContent: !!pair.targetCell.content,
        }));

    await translationPairsIndex.addAll(documents);

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
            { content: string; uri: string; notebookId: string; }
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
        targetVerseMap: Map<string, { content: string; }>,
        translationPairsIndex: IndexType
    ): Promise<number> {
        const uri = document.uri.toString();
        let indexedCount = 0;
        const batchSize = 1000;
        let batch: searchResult[] = [];

        const processBatch = async () => {
            if (batch.length > 0) {
                try {
                    await translationPairsIndex.addAll(batch);
                    indexedCount += batch.length;
                } catch (error) {
                    if (error instanceof Error && error.message.includes("duplicate ID")) {
                        await processBatchRecursively(batch);
                    } else {
                        throw error;
                    }
                }
                batch = [];
            }
        };

        const processBatchRecursively = async (currentBatch: searchResult[]) => {
            if (currentBatch.length === 0) return;
            const smallerBatch = currentBatch.filter((_, index) => index % 10 === 0);
            try {
                await translationPairsIndex.addAll(smallerBatch);
                indexedCount += smallerBatch.length;
            } catch (error) {
                if (error instanceof Error && error.message.includes("duplicate ID")) {
                    for (const doc of smallerBatch) {
                        try {
                            await translationPairsIndex.add(doc);
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
            await processBatchRecursively(currentBatch.filter((_, index) => index % 10 !== 0));
        };

        const lines = document.getText().split("\n");
        for (let i = 0; i < lines.length; i++) {
            const indexedDoc = indexLine(lines[i], i, uri, targetVerseMap);
            if (indexedDoc) {
                batch.push(indexedDoc);
                if (batch.length >= batchSize) {
                    await processBatch();
                }
            }
        }

        await processBatch();
        return indexedCount;
    }

    function indexLine(
        line: string,
        lineIndex: number,
        uri: string,
        targetVerseMap: Map<string, { content: string; }>
    ): searchResult | null {
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
        const targetVerseMap = new Map<string, { content: string; }>();
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

export function searchTranslationPairs(
    translationPairsIndex: IndexType,
    query: string,
    includeIncomplete: boolean = false,
    k: number = 15,
    options: { completeBoost?: number; targetContentBoost?: number; isParallelPassagesWebview?: boolean; } = {}
): TranslationPair[] {
    const { completeBoost = 1, targetContentBoost = 1, isParallelPassagesWebview = false, ...searchOptions } = options;

    const searchResults = translationPairsIndex.search(query, {
        fields: ["sourceContent", "targetContent"],
        combineWith: "OR",
        prefix: true,
        fuzzy: 0.2,
        boost: {
            sourceContent: 2,
            targetContent: 2 * targetContentBoost,
        },
        filter: includeIncomplete ? undefined : (doc: any) => !!doc.targetContent,
        isParallelPassagesWebview,
        ...searchOptions
    });

    const cellMap = new Map<string, { source?: any; target?: any; score: number; }>();

    for (const result of searchResults) {
        const cellId = result.cellId;
        if (!cellMap.has(cellId)) {
            cellMap.set(cellId, { score: result.score });
        }

        const cellData = cellMap.get(cellId)!;

        cellData.score = Math.max(cellData.score, result.score);

        if (result.sourceContent) {
            cellData.source = result;
        }
        if (result.targetContent) {
            cellData.target = result;
        }
    }

    // Convert grouped results to TranslationPair objects
    const results: (TranslationPair & { score: number; })[] = [];

    for (const [cellId, cellData] of cellMap.entries()) {
        const sourceResult = cellData.source;
        const targetResult = cellData.target;

        // Skip if we don't have source content and we're not including incomplete
        if (!sourceResult && !includeIncomplete) {
            continue;
        }

        // Skip if we don't have target content and we're not including incomplete
        if (!targetResult && !includeIncomplete) {
            continue;
        }

        // For search passages webview, prefer raw content if available for proper HTML display
        const sourceContent = sourceResult ? (
            isParallelPassagesWebview && sourceResult.rawContent
                ? sourceResult.rawContent
                : sourceResult.sourceContent || sourceResult.content
        ) : "";

        const targetContent = targetResult ? (
            isParallelPassagesWebview && targetResult.rawTargetContent
                ? targetResult.rawTargetContent
                : targetResult.targetContent
        ) : "";

        const uri = sourceResult?.uri || targetResult?.uri || "";
        const line = sourceResult?.line || targetResult?.line || 0;
        const notebookId = sourceResult?.notebookId || targetResult?.notebookId || "";

        results.push({
            cellId,
            sourceCell: {
                cellId,
                content: sourceContent,
                uri,
                line,
                notebookId,
            },
            targetCell: {
                cellId,
                content: targetContent,
                uri,
                line,
                notebookId,
            },
            score: cellData.score * (targetContent ? completeBoost : 1),
        });
    }

    // Sort by score and remove score property before returning
    return results
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ score, ...pair }) => pair);
}
