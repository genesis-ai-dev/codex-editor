import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../../../types";
import { searchTranslationPairs } from "./translationPairsIndex";
import { SQLiteIndexManager } from "./sqliteIndex";
import { SearchManager } from "../searchAlgorithms";

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
    k: number = 5,
    onlyValidated: boolean = false
): Promise<TranslationPair[]> {
    console.log(`[getTranslationPairsFromSourceCellQuery] Entry point - query: "${query}", k: ${k}, onlyValidated: ${onlyValidated}`);
    
    // Check if index is properly initialized
    if (!translationPairsIndex) {
        console.error(`[getTranslationPairsFromSourceCellQuery] Translation pairs index is null/undefined!`);
        return [];
    }
    
    // Quick database health check
    if (translationPairsIndex instanceof SQLiteIndexManager) {
        try {
            // Try a simple query to check if database is responsive
            const testResults = await translationPairsIndex.searchCompleteTranslationPairsWithValidation('', 5, false, false);
            console.log(`[getTranslationPairsFromSourceCellQuery] Database health check: ${testResults.length} total pairs available`);
            
            if (testResults.length > 0) {
                console.log(`[getTranslationPairsFromSourceCellQuery] Sample database contents:`);
                testResults.slice(0, 2).forEach((result, index) => {
                    console.log(`  ${index + 1}. Cell: ${result.cellId || result.cell_id}`);
                    console.log(`     Source: "${(result.sourceContent || result.source_content || '').substring(0, 100)}..."`);
                    console.log(`     Target: "${(result.targetContent || result.target_content || '').substring(0, 100)}..."`);
                });
            } else {
                console.error(`[getTranslationPairsFromSourceCellQuery] ⚠️  DATABASE IS EMPTY - This explains why no examples are found!`);
            }
        } catch (error) {
            console.error(`[getTranslationPairsFromSourceCellQuery] Database health check failed:`, error);
        }
    }
    
    // Use direct legacy method for more reliable results
    // SearchManager algorithm switching can be re-enabled once configuration issues are resolved
    console.log(`[getTranslationPairsFromSourceCellQuery] Using direct SQLite search method`);

    // Direct SQLite search
    const initialLimit = Math.max(k * 6, 30);
    let results: any[] = [];

    if (translationPairsIndex instanceof SQLiteIndexManager) {
        console.log(`[getTranslationPairsFromSourceCellQuery] Using SQLite searchCompleteTranslationPairsWithValidation with limit: ${initialLimit}`);
        results = await translationPairsIndex.searchCompleteTranslationPairsWithValidation(query, initialLimit, false, onlyValidated);
        console.log(`[getTranslationPairsFromSourceCellQuery] SQLite search returned ${results.length} raw results`);
    } else {
        console.warn("[getTranslationPairsFromSourceCellQuery] Non-SQLite index detected, no fallback available");
        return [];
    }

    if (results.length === 0 && translationPairsIndex instanceof SQLiteIndexManager) {
        console.log(`[getTranslationPairsFromSourceCellQuery] No results for specific query, trying empty query fallback`);
        results = await translationPairsIndex.searchCompleteTranslationPairsWithValidation('', Math.max(k * 2, 10), false, onlyValidated);
        console.log(`[getTranslationPairsFromSourceCellQuery] Empty query fallback returned ${results.length} results`);
    }

    const translationPairs: TranslationPair[] = [];
    const seenCellIds = new Set<string>();

    for (const searchResult of results) {
        const cellId = searchResult.cellId || searchResult.cell_id;
        if (seenCellIds.has(cellId)) continue;
        seenCellIds.add(cellId);
        
        console.log(`[getTranslationPairsFromSourceCellQuery] Processing raw result for cellId: ${cellId}`);
        console.log(`[getTranslationPairsFromSourceCellQuery] - sourceContent: "${(searchResult.sourceContent || '').substring(0, 50)}..."`);
        console.log(`[getTranslationPairsFromSourceCellQuery] - targetContent: "${(searchResult.targetContent || '').substring(0, 50)}..."`);

        if (searchResult.sourceContent && searchResult.targetContent) {
            if (searchResult.sourceContent.trim() && searchResult.targetContent.trim()) {
                console.log(`[getTranslationPairsFromSourceCellQuery] ✅ Adding direct result for ${cellId}`);
                translationPairs.push({
                    cellId,
                    sourceCell: { cellId, content: searchResult.sourceContent, uri: searchResult.uri || "", line: searchResult.line || 0 },
                    targetCell: { cellId, content: searchResult.targetContent, uri: searchResult.uri || "", line: searchResult.line || 0 },
                });
            } else {
                console.log(`[getTranslationPairsFromSourceCellQuery] ❌ Skipping ${cellId} - empty content after trim`);
            }
        } else {
            console.log(`[getTranslationPairsFromSourceCellQuery] 🔄 Fetching translation pair for ${cellId}`);
            const translationPair = await translationPairsIndex.getTranslationPair(cellId);
            if (translationPair && translationPair.sourceContent.trim() && translationPair.targetContent.trim()) {
                console.log(`[getTranslationPairsFromSourceCellQuery] ✅ Adding fetched result for ${cellId}`);
                translationPairs.push({
                    cellId,
                    sourceCell: { cellId, content: translationPair.sourceContent, uri: translationPair.uri || "", line: translationPair.line || 0 },
                    targetCell: { cellId, content: translationPair.targetContent, uri: translationPair.uri || "", line: translationPair.line || 0 },
                });
            } else {
                console.log(`[getTranslationPairsFromSourceCellQuery] ❌ Skipping ${cellId} - no valid translation pair found`);
            }
        }

        if (translationPairs.length >= initialLimit) break;
    }

    console.log(`[getTranslationPairsFromSourceCellQuery] Legacy path final result: ${translationPairs.length} translation pairs`);
    
    if (translationPairs.length === 0) {
        console.warn(`[getTranslationPairsFromSourceCellQuery] LEGACY FALLBACK ALSO RETURNED ZERO RESULTS!`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] This suggests either:`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 1. Database has no data`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 2. Search query is not finding matches`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 3. Word overlap filtering is too strict`);
    }
    
    return translationPairs;
}

export function handleTextSelection(translationPairsIndex: IndexType, selectedText: string) {
    return searchTargetCellsByQuery(translationPairsIndex, selectedText);
}

export async function searchParallelCells(
    translationPairsIndex: IndexType,
    sourceTextIndex: IndexType,
    query: string,
    k: number = 15
): Promise<TranslationPair[]> {
    // Search only for complete translation pairs
    return await searchTranslationPairs(translationPairsIndex as any, query, false, k);
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

export async function searchAllCells(
    translationPairsIndex: IndexType,
    sourceTextIndex: IndexType,
    query: string,
    k: number = 15,
    includeIncomplete: boolean = true,
    options?: any
): Promise<TranslationPair[]> {
    // Search translation pairs with boosted weights for complete pairs and target content
    const translationPairs = await searchTranslationPairs(
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