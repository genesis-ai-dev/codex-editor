import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../../../types";
import { searchTranslationPairs } from "./translationPairsIndex";

export function searchTargetCellsByQuery(
    translationPairsIndex: MiniSearch,
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

export function getSourceCellByCellIdFromAllSourceCells(
    sourceTextIndex: MiniSearch,
    cellId: string
): SourceCellVersions | null {
    const searchResults: SourceCellVersions | null = sourceTextIndex.getStoredFields(
        cellId
    ) as SourceCellVersions | null;

    if (searchResults) {
        return {
            cellId: searchResults?.cellId as string,
            content: searchResults?.content as string,
            versions: searchResults?.versions as string[],
            notebookId: searchResults?.notebookId as string,
        };
    }
    console.log(`No result found for cellId: ${cellId}`);
    return null;
}

export function getTargetCellByCellId(translationPairsIndex: MiniSearch, cellId: string) {
    const results = translationPairsIndex.search(cellId);
    const result = results.find((result) => result.cellId === cellId);
    return result ? result : null;
}

export function getTranslationPairFromProject(
    translationPairsIndex: MiniSearch,
    cellId: string
): TranslationPair | null {
    const result = translationPairsIndex.search(cellId, {
        fields: ["cellId"],
        combineWith: "AND",
        filter: (result) => result.cellId === cellId,
    })[0];

    if (result) {
        return {
            cellId,
            sourceCell: {
                cellId: result.cellId,
                content: result.sourceContent,
                uri: result.uri,
                line: result.line,
            },
            targetCell: {
                cellId: result.cellId,
                content: result.targetContent,
                uri: result.uri,
                line: result.line,
            },
        };
    }
    return null;
}

export function getTranslationPairsFromSourceCellQuery(
    translationPairsIndex: MiniSearch,
    query: string,
    k: number = 5
): TranslationPair[] {
    let results = translationPairsIndex.search(query, {
        fields: ["sourceContent"],
        combineWith: "OR",
        prefix: true,
        fuzzy: 0.2,
        boost: { sourceContent: 2 },
    });

    // If we still don't have enough results, try a more lenient search
    if (results.length < k) {
        results = translationPairsIndex.search(query, {
            fields: ["sourceContent"],
            combineWith: "OR",
            prefix: true,
            fuzzy: 0.4,
            boost: {
                sourceContent: 2,
                cellId: 1,
            },
        });
    }

    // If we still don't have results, get all entries
    if (results.length === 0) {
        results = translationPairsIndex.search("*", {
            fields: ["sourceContent"],
            boost: { cellId: 1 },
        });
    }

    return results.slice(0, k).map((result) => ({
        cellId: result.cellId,
        sourceCell: {
            cellId: result.cellId,
            content: result.sourceContent,
            uri: result.uri,
            line: result.line,
        },
        targetCell: {
            cellId: result.cellId,
            content: result.targetContent,
            uri: result.uri,
            line: result.line,
        },
    }));
}

export function handleTextSelection(translationPairsIndex: MiniSearch, selectedText: string) {
    return searchTargetCellsByQuery(translationPairsIndex, selectedText);
}

export function searchParallelCells(
    translationPairsIndex: MiniSearch,
    sourceTextIndex: MiniSearch,
    query: string,
    k: number = 15
): TranslationPair[] {
    // Search only for complete translation pairs
    return searchTranslationPairs(translationPairsIndex, query, false, k);
}

export function searchSimilarCellIds(
    translationPairsIndex: MiniSearch,
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
            .map((result) => ({
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
        .map((result) => ({
            cellId: result.cellId,
            score: result.score,
        }));
}

export async function findNextUntranslatedSourceCell(
    sourceTextIndex: MiniSearch,
    translationPairsIndex: MiniSearch,
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    // Search for similar source cells
    const searchResults = sourceTextIndex.search(query, {
        boost: { content: 2 },
        fuzzy: 0.2,
    });

    // Filter out the current cell and cells that already have translations
    for (const result of searchResults) {
        if (result.cellId !== currentCellId) {
            const hasTranslation =
                translationPairsIndex.search(result.cellId, {
                    fields: ["cellId"],
                    combineWith: "AND",
                }).length > 0;

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
    translationPairsIndex: MiniSearch,
    sourceTextIndex: MiniSearch,
    query: string,
    k: number = 15,
    includeIncomplete: boolean = true
): TranslationPair[] {
    // Search translation pairs with boosted weights for complete pairs and target content
    const translationPairs = searchTranslationPairs(
        translationPairsIndex,
        query,
        includeIncomplete,
        k,
        { completeBoost: 1.5, targetContentBoost: 1.2 }
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
            })
            .map((result) => ({
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
