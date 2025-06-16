import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../../../types";
import { searchTranslationPairs } from "./translationPairsIndex";
import { SQLiteIndexManager } from "./sqliteIndex";

type IndexType = SQLiteIndexManager;

export function searchTargetCellsByQuery(
    translationPairsIndex: IndexType,
    query: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    return translationPairsIndex
        .search(query, {
            fields: ["targetContent"],
            combineWith: "OR",
            prefix: true,
            fuzzy: fuzziness,
            boost: { targetContent: 2, cellId: 1 },
        })
        .slice(0, k);
}

export async function getSourceCellByCellIdFromAllSourceCells(
    sourceTextIndex: IndexType,
    cellId: string
): Promise<SourceCellVersions | null> {
    // Handle SQLiteIndexManager
    if (sourceTextIndex instanceof SQLiteIndexManager) {
        const result = await sourceTextIndex.getById(cellId);
        if (result) {
            return {
                cellId: result.cellId,
                content: result.content,
                versions: result.versions || [],
                notebookId: result.notebookId || "",
            };
        }
    }
    return null;
}

export async function getTargetCellByCellId(translationPairsIndex: IndexType, cellId: string) {
    const results = await translationPairsIndex.search(cellId);
    const result = results.find((result: any) => result.cellId === cellId);
    return result ? result : null;
}

export async function getTranslationPairFromProject(
    translationPairsIndex: IndexType,
    sourceTextIndex: IndexType,
    cellId: string,
    options?: { isParallelPassagesWebview?: boolean; }
): Promise<TranslationPair | null> {
    const isParallelPassagesWebview = options?.isParallelPassagesWebview || false;

    // Use the SQLite-specific method to get translation pair if available
    if (translationPairsIndex instanceof SQLiteIndexManager) {
        const translationPair = await translationPairsIndex.getTranslationPair(cellId);
        if (translationPair) {
            // For search passages webview, use raw content if available for proper HTML display
            const sourceContent = isParallelPassagesWebview && translationPair.rawSourceContent
                ? translationPair.rawSourceContent
                : translationPair.sourceContent;
            const targetContent = isParallelPassagesWebview && translationPair.rawTargetContent
                ? translationPair.rawTargetContent
                : translationPair.targetContent;

            return {
                cellId,
                sourceCell: {
                    cellId: translationPair.cellId,
                    content: sourceContent,
                    uri: translationPair.uri,
                    line: translationPair.line,
                },
                targetCell: {
                    cellId: translationPair.cellId,
                    content: targetContent,
                    uri: translationPair.uri,
                    line: translationPair.line,
                },
            };
        }
    }

    // Fallback: search for the cellId in all fields to find any matching content
    const searchResults = await translationPairsIndex.search(cellId, {
        fields: ["cellId", "sourceContent", "targetContent"],
        combineWith: "OR",
        filter: (result: any) => result.cellId === cellId,
        isParallelPassagesWebview, // Pass through for raw content handling
    });

    // Look for both source and target content in the results
    let sourceContent = "";
    let targetContent = "";
    let uri = "";
    let line = 0;

    for (const result of searchResults) {
        if (result.cellId === cellId) {
            if (result.sourceContent) {
                // For search passages webview, prefer raw content if available
                sourceContent = isParallelPassagesWebview && result.rawContent
                    ? result.rawContent
                    : result.sourceContent;
                uri = result.uri || uri;
                line = result.line || line;
            }
            if (result.targetContent) {
                // For search passages webview, prefer raw content if available
                targetContent = isParallelPassagesWebview && result.rawTargetContent
                    ? result.rawTargetContent
                    : result.targetContent;
                uri = result.uri || uri;
                line = result.line || line;
            }
        }
    }

    // If we found either source or target content, return the pair
    if (sourceContent || targetContent) {
        return {
            cellId,
            sourceCell: {
                cellId,
                content: sourceContent,
                uri,
                line,
            },
            targetCell: {
                cellId,
                content: targetContent,
                uri,
                line,
            },
        };
    }

    // If no complete pair is found, look for an incomplete pair in the sourceTextIndex
    let sourceOnlyResult: SourceCellVersions | null = null;

    if (sourceTextIndex instanceof SQLiteIndexManager) {
        sourceOnlyResult = await sourceTextIndex.getById(cellId);
    }

    if (sourceOnlyResult) {
        return {
            cellId,
            sourceCell: {
                cellId: sourceOnlyResult.cellId,
                content: sourceOnlyResult.content,
                notebookId: sourceOnlyResult.notebookId,
            },
            targetCell: {
                cellId: sourceOnlyResult.cellId,
                content: "",
                notebookId: "",
            },
        };
    }

    return null;
}

export async function getTranslationPairsFromSourceCellQuery(
    translationPairsIndex: IndexType,
    query: string,
    k: number = 5
): Promise<TranslationPair[]> {
    console.log(`[getTranslationPairsFromSourceCellQuery] Searching for: "${query.substring(0, 100)}..." with k=${k}`);

    // Use the special Greek text search method
    let results = await translationPairsIndex.searchGreekText(query, 'source', k * 3);

    console.log(`[getTranslationPairsFromSourceCellQuery] Greek text search returned ${results.length} results`);

    // If we don't have enough results, try the regular search with fuzzy matching
    if (results.length < k) {
        console.log(`[getTranslationPairsFromSourceCellQuery] Trying fuzzy search...`);
        results = translationPairsIndex.search(query, {
            fields: ["sourceContent"],
            combineWith: "OR",
            prefix: false,
            fuzzy: 0.4,
            boost: { sourceContent: 2 }
        });
        console.log(`[getTranslationPairsFromSourceCellQuery] Fuzzy search returned ${results.length} results`);
    }

    // If we still don't have results, get some recent source cells as fallback
    if (results.length === 0) {
        console.log(`[getTranslationPairsFromSourceCellQuery] No results found, getting recent source cells`);
        // Get recent source cells
        results = await translationPairsIndex.searchGreekText('', 'source', k * 2);
        console.log(`[getTranslationPairsFromSourceCellQuery] Fallback query returned ${results.length} results`);
    }

    // Now for each result, get the complete translation pair
    const translationPairs: TranslationPair[] = [];
    const seenCellIds = new Set<string>();

    for (const searchResult of results) {
        const cellId = searchResult.cellId || searchResult.cell_id;

        // Skip duplicates
        if (seenCellIds.has(cellId)) continue;
        seenCellIds.add(cellId);

        // For SQLite results, we might already have the translation pair data
        if (searchResult.sourceContent && searchResult.targetContent !== undefined) {
            // Only include if we have both source AND target content
            if (searchResult.sourceContent.trim() && searchResult.targetContent.trim()) {
                translationPairs.push({
                    cellId: cellId,
                    sourceCell: {
                        cellId: cellId,
                        content: searchResult.sourceContent || searchResult.content || "",
                        uri: searchResult.uri || "",
                        line: searchResult.line || 0,
                    },
                    targetCell: {
                        cellId: cellId,
                        content: searchResult.targetContent || "",
                        uri: searchResult.uri || "",
                        line: searchResult.line || 0,
                    }
                });
            }
        } else {
            // Otherwise, fetch the complete translation pair
            const translationPair = await translationPairsIndex.getTranslationPair(cellId);

            // Only include if we have BOTH source and target content
            if (translationPair &&
                translationPair.sourceContent.trim() &&
                translationPair.targetContent.trim()) {

                translationPairs.push({
                    cellId: cellId,
                    sourceCell: {
                        cellId: cellId,
                        content: translationPair.sourceContent || searchResult.content || "",
                        uri: translationPair.uri || searchResult.uri || "",
                        line: translationPair.line || searchResult.line || 0,
                    },
                    targetCell: {
                        cellId: cellId,
                        content: translationPair.targetContent || "",
                        uri: translationPair.uri || searchResult.uri || "",
                        line: translationPair.line || searchResult.line || 0,
                    }
                });
            } else {
                console.log(`[getTranslationPairsFromSourceCellQuery] Skipping ${cellId} - incomplete translation pair (source: ${!!translationPair?.sourceContent}, target: ${!!translationPair?.targetContent})`);
            }
        }

        // Stop when we have enough results
        if (translationPairs.length >= k) break;
    }

    console.log(`[getTranslationPairsFromSourceCellQuery] Returning ${translationPairs.length} complete translation pairs (filtered out incomplete pairs)`);
    return translationPairs;
}

export function handleTextSelection(translationPairsIndex: IndexType, selectedText: string) {
    return searchTargetCellsByQuery(translationPairsIndex, selectedText);
}

export function searchParallelCells(
    translationPairsIndex: IndexType,
    sourceTextIndex: IndexType,
    query: string,
    k: number = 15
): TranslationPair[] {
    // Search only for complete translation pairs
    return searchTranslationPairs(translationPairsIndex as any, query, false, k);
}

export function searchSimilarCellIds(
    translationPairsIndex: IndexType,
    cellId: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    // Parse the input cellId into book and chapter
    const match = cellId.match(/^(\w+)\s*(\d+)/);
    if (!match) {
        return translationPairsIndex
            .search(cellId, {
                fields: ["cellId"],
                combineWith: "OR",
                prefix: true,
                fuzzy: fuzziness,
                boost: { cellId: 2 },
            })
            .slice(0, k)
            .map((result: any) => ({
                cellId: result.cellId,
                score: result.score,
            }));
    }

    // Search for exact book+chapter prefix (e.g., "GEN 2")
    const bookChapterPrefix = match[0];
    return translationPairsIndex
        .search(bookChapterPrefix, {
            fields: ["cellId"],
            prefix: true,
            combineWith: "AND",
        })
        .slice(0, k)
        .map((result: any) => ({
            cellId: result.cellId,
            score: result.score,
        }));
}

export async function findNextUntranslatedSourceCell(
    sourceTextIndex: IndexType,
    translationPairsIndex: IndexType,
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string; } | null> {
    // Search for similar source cells
    const searchResults = await sourceTextIndex.search(query, {
        boost: { content: 2 },
        fuzzy: 0.2,
    });

    // Filter out the current cell and cells that already have translations
    for (const result of searchResults) {
        if (result.cellId !== currentCellId) {
            const translationResults = await translationPairsIndex.search(result.cellId, {
                fields: ["cellId"],
                combineWith: "AND",
            });
            const hasTranslation = translationResults.length > 0;

            if (!hasTranslation) {
                return {
                    cellId: result.cellId,
                    content: result.content,
                };
            }
        }
    }

    return null; // No untranslated cell found
}

export function searchAllCells(
    translationPairsIndex: IndexType,
    sourceTextIndex: IndexType,
    query: string,
    k: number = 15,
    includeIncomplete: boolean = true,
    options?: any
): TranslationPair[] {
    // Search translation pairs with boosted weights for complete pairs and target content
    const translationPairs = searchTranslationPairs(
        translationPairsIndex as any,
        query,
        includeIncomplete,
        k,
        { completeBoost: 1.5, targetContentBoost: 1.2, ...options }
    );

    let combinedResults: TranslationPair[] = translationPairs;

    if (includeIncomplete) {
        // If we're including incomplete pairs, also search source-only cells
        const sourceOnlyCells = sourceTextIndex
            .search(query, {
                fields: ["content"],
                combineWith: "OR",
                prefix: true,
                fuzzy: 0.2,
                boost: { content: 2 },
                ...options // Pass through options including isParallelPassagesWebview
            })
            .map((result: any) => ({
                cellId: result.cellId,
                sourceCell: {
                    cellId: result.cellId,
                    content: result.content,
                    versions: result.versions,
                    notebookId: result.notebookId,
                },
                targetCell: {
                    cellId: result.cellId,
                    content: "",
                    versions: [],
                    notebookId: "",
                },
                score: result.score,
            }));

        combinedResults = [...translationPairs, ...sourceOnlyCells];
    }

    // Remove duplicates based on cellId
    const uniqueResults = combinedResults.filter(
        (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
    );

    // Sort results by relevance (assuming higher score means more relevant)
    uniqueResults.sort((a, b) => {
        const scoreA = "score" in a ? (a.score as number) : 0;
        const scoreB = "score" in b ? (b.score as number) : 0;
        return scoreB - scoreA;
    });

    return uniqueResults.slice(0, k);
}

export { searchTranslationPairs }; 