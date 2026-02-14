import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../../../types";
import { SQLiteIndexManager } from "./sqliteIndex";

type IndexType = SQLiteIndexManager;

const DEBUG_SEARCH = false;
const debug = (message: string, ...args: any[]) => {
    DEBUG_SEARCH && debug(`[Search] ${message}`, ...args);
};

export function stripHtml(html: string): string {
    let strippedText = html.replace(/<[^>]*>/g, "");
    strippedText = strippedText.replace(/&nbsp; ?/g, " ");
    strippedText = strippedText.replace(/&amp;|&lt;|&gt;|&quot;|&#39;|&#34;/g, "");
    strippedText = strippedText.replace(/&#\d+;/g, "");
    strippedText = strippedText.replace(/&[a-zA-Z]+;/g, "");
    return strippedText.toLowerCase();
}

export function normalizeUri(uri: string): string {
    if (!uri) return "";
    try {
        return vscode.Uri.parse(uri).toString();
    } catch {
        return uri;
    }
}

export async function searchTargetCellsByQuery(
    translationPairsIndex: IndexType,
    query: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    const results = await translationPairsIndex.search(query, {
        fields: ["targetContent"],
        combineWith: "OR",
        prefix: true,
        fuzzy: fuzziness,
        boost: { targetContent: 2, cellId: 1 },
    });
    return results.slice(0, k);
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
    debug(`[getTranslationPairsFromSourceCellQuery] Entry point - query: "${query}", k: ${k}, onlyValidated: ${onlyValidated}`);

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
            debug(`[getTranslationPairsFromSourceCellQuery] Database health check: ${testResults.length} total pairs available`);

            if (testResults.length > 0) {
                debug(`[getTranslationPairsFromSourceCellQuery] Sample database contents:`);
                testResults.slice(0, 2).forEach((result, index) => {
                    debug(`  ${index + 1}. Cell: ${result.cellId || result.cell_id}`);
                    debug(`     Source: "${(result.sourceContent || result.source_content || '').substring(0, 100)}..."`);
                    debug(`     Target: "${(result.targetContent || result.target_content || '').substring(0, 100)}..."`);
                });
            } else {
                console.error(`[getTranslationPairsFromSourceCellQuery] ⚠️  DATABASE IS EMPTY - This explains why no examples are found!`);
            }
        } catch (error) {
            console.error(`[getTranslationPairsFromSourceCellQuery] Database health check failed:`, error);
        }
    }

    // Use direct SQLite search method for reliable results
    debug(`[getTranslationPairsFromSourceCellQuery] Using direct SQLite search method`);

    // Direct SQLite search
    const initialLimit = Math.max(k * 6, 30);
    let results: any[] = [];

    if (translationPairsIndex instanceof SQLiteIndexManager) {
        debug(`[getTranslationPairsFromSourceCellQuery] Using SQLite searchCompleteTranslationPairsWithValidation with limit: ${initialLimit}`);
        // For few-shot examples, search SOURCE only (target is just returned, not searched)
        results = await translationPairsIndex.searchCompleteTranslationPairsWithValidation(query, initialLimit, false, onlyValidated, true);
        debug(`[getTranslationPairsFromSourceCellQuery] SQLite search returned ${results.length} raw results`);
    } else {
        console.warn("[getTranslationPairsFromSourceCellQuery] Non-SQLite index detected, no fallback available");
        return [];
    }

    if (results.length === 0 && translationPairsIndex instanceof SQLiteIndexManager) {
        debug(`[getTranslationPairsFromSourceCellQuery] No results for specific query, trying empty query fallback`);
        // For few-shot examples, search SOURCE only
        results = await translationPairsIndex.searchCompleteTranslationPairsWithValidation('', Math.max(k * 2, 10), false, onlyValidated, true);
        debug(`[getTranslationPairsFromSourceCellQuery] Empty query fallback returned ${results.length} results`);
    }

    const translationPairs: TranslationPair[] = [];
    const seenCellIds = new Set<string>();

    for (const searchResult of results) {
        const cellId = searchResult.cellId || searchResult.cell_id;
        if (seenCellIds.has(cellId)) continue;
        seenCellIds.add(cellId);

        debug(`[getTranslationPairsFromSourceCellQuery] Processing raw result for cellId: ${cellId}`);
        debug(`[getTranslationPairsFromSourceCellQuery] - sourceContent: "${(searchResult.sourceContent || '').substring(0, 50)}..."`);
        debug(`[getTranslationPairsFromSourceCellQuery] - targetContent: "${(searchResult.targetContent || '').substring(0, 50)}..."`);

        if (searchResult.sourceContent && searchResult.targetContent) {
            if (searchResult.sourceContent.trim() && searchResult.targetContent.trim()) {
                debug(`[getTranslationPairsFromSourceCellQuery] ✅ Adding direct result for ${cellId}`);
                translationPairs.push({
                    cellId,
                    sourceCell: { cellId, content: searchResult.sourceContent, uri: searchResult.uri || "", line: searchResult.line || 0 },
                    targetCell: { cellId, content: searchResult.targetContent, uri: searchResult.uri || "", line: searchResult.line || 0 },
                });
            } else {
                debug(`[getTranslationPairsFromSourceCellQuery] ❌ Skipping ${cellId} - empty content after trim`);
            }
        } else {
            debug(`[getTranslationPairsFromSourceCellQuery] 🔄 Fetching translation pair for ${cellId}`);
            const translationPair = await translationPairsIndex.getTranslationPair(cellId);
            if (translationPair && translationPair.sourceContent.trim() && translationPair.targetContent.trim()) {
                debug(`[getTranslationPairsFromSourceCellQuery] ✅ Adding fetched result for ${cellId}`);
                translationPairs.push({
                    cellId,
                    sourceCell: { cellId, content: translationPair.sourceContent, uri: translationPair.uri || "", line: translationPair.line || 0 },
                    targetCell: { cellId, content: translationPair.targetContent, uri: translationPair.uri || "", line: translationPair.line || 0 },
                });
            } else {
                debug(`[getTranslationPairsFromSourceCellQuery] ❌ Skipping ${cellId} - no valid translation pair found`);
            }
        }

        if (translationPairs.length >= initialLimit) break;
    }

    debug(`[getTranslationPairsFromSourceCellQuery] Legacy path final result: ${translationPairs.length} translation pairs`);

    if (translationPairs.length === 0) {
        console.warn(`[getTranslationPairsFromSourceCellQuery] LEGACY FALLBACK ALSO RETURNED ZERO RESULTS!`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] This suggests either:`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 1. Database has no data`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 2. Search query is not finding matches`);
        console.warn(`[getTranslationPairsFromSourceCellQuery] 3. Word overlap filtering is too strict`);
    }

    return translationPairs;
}

export async function handleTextSelection(translationPairsIndex: IndexType, selectedText: string) {
    return await searchTargetCellsByQuery(translationPairsIndex, selectedText);
}


export async function searchSimilarCellIds(
    translationPairsIndex: IndexType,
    cellId: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    // Parse the input cellId into book and chapter
    const match = cellId.match(/^(\w+)\s*(\d+)/);
    if (!match) {
        const results = await translationPairsIndex.search(cellId, {
            fields: ["cellId"],
            combineWith: "OR",
            prefix: true,
            fuzzy: fuzziness,
            boost: { cellId: 2 },
        });
        return results
            .slice(0, k)
            .map((result: any) => ({
                cellId: result.cellId,
                score: result.score,
            }));
    }

    // Search for exact book+chapter prefix (e.g., "GEN 2")
    const bookChapterPrefix = match[0];
    const results = await translationPairsIndex.search(bookChapterPrefix, {
        fields: ["cellId"],
        prefix: true,
        combineWith: "AND",
    });
    return results
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
    const searchScope = options?.searchScope || "both";
    const selectedFiles = options?.selectedFiles || [];
    const isParallelPassagesWebview = options?.isParallelPassagesWebview || false;

    // Helper to check if a pair matches selected files filter
    function matchesSelectedFiles(pair: TranslationPair): boolean {
        if (!selectedFiles || selectedFiles.length === 0) return true;

        const sourceUri = pair.sourceCell?.uri || "";
        const targetUri = pair.targetCell?.uri || "";
        const normalizedSource = normalizeUri(sourceUri);
        const normalizedTarget = normalizeUri(targetUri);

        return selectedFiles.some((selectedUri: string) => {
            const normalizedSelected = normalizeUri(selectedUri);
            return normalizedSource === normalizedSelected || normalizedTarget === normalizedSelected;
        });
    }

    // Helper to verify content contains query
    function contentContainsQuery(content: string | undefined, queryLower: string): boolean {
        if (!content) return false;
        return stripHtml(content).includes(queryLower);
    }

    const queryLower = query.toLowerCase();
    let results: TranslationPair[] = [];

    if (translationPairsIndex instanceof SQLiteIndexManager) {
        // Determine search mode
        const searchSourceOnly = searchScope === "source";
        const searchLimit = k * 2;

        // Search complete pairs first
        const searchResults = await translationPairsIndex.searchCompleteTranslationPairsWithValidation(
            query,
            searchLimit,
            isParallelPassagesWebview,
            false, // onlyValidated
            searchSourceOnly
        );

        // Convert to TranslationPair format
        results = searchResults.map((result) => ({
            cellId: result.cellId || result.cell_id,
            sourceCell: {
                cellId: result.cellId || result.cell_id,
                content: result.sourceContent || result.content || "",
                uri: result.uri || "",
                line: result.line || 0,
            },
            targetCell: {
                cellId: result.cellId || result.cell_id,
                content: result.targetContent || "",
                uri: result.uri || "",
                line: result.line || 0,
            },
        }));

        // Filter out pairs with empty or minimal content (require both source and target)
        results = results.filter((pair) => {
            const sourceText = stripHtml(pair.sourceCell.content || "").trim();
            const targetText = stripHtml(pair.targetCell.content || "").trim();
            return sourceText.length > 3 && targetText.length > 3;
        });

        // Apply search scope content verification - query must appear in relevant content
        if (query.trim()) {
            results = results.filter((pair) => {
                if (searchScope === "source") {
                    return contentContainsQuery(pair.sourceCell.content, queryLower);
                } else if (searchScope === "target") {
                    return contentContainsQuery(pair.targetCell.content, queryLower);
                } else {
                    // "both" - query should appear in either source or target
                    return contentContainsQuery(pair.sourceCell.content, queryLower) ||
                           contentContainsQuery(pair.targetCell.content, queryLower);
                }
            });
        }

        // Add incomplete pairs (source-only cells) if requested
        if (includeIncomplete) {
            const existingIds = new Set(results.map((r) => r.cellId));
            const sourceSearchResults = await sourceTextIndex.search(query, {
                fields: ["content"],
                combineWith: "OR",
                prefix: true,
                fuzzy: 0.2,
                boost: { content: 2 },
            });
            const sourceOnlyCells = sourceSearchResults
                .filter((result: any) => {
                    // Skip if already in results
                    if (existingIds.has(result.cellId)) return false;
                    // Require meaningful source content
                    const sourceText = stripHtml(result.content || "").trim();
                    if (sourceText.length <= 3) return false;
                    // Verify query actually appears in content
                    if (query.trim() && !sourceText.toLowerCase().includes(queryLower)) return false;
                    return true;
                })
                .map((result: any) => ({
                    cellId: result.cellId,
                    sourceCell: {
                        cellId: result.cellId,
                        content: result.content,
                        versions: result.versions,
                        notebookId: result.notebookId,
                        uri: result.uri || "",
                    },
                    targetCell: {
                        cellId: result.cellId,
                        content: "",
                        versions: [],
                        notebookId: "",
                    },
                    score: result.score,
                }));

            results = [...results, ...sourceOnlyCells];
        }
    }

    // Apply file filtering once at the end
    if (selectedFiles.length > 0) {
        results = results.filter(matchesSelectedFiles);
    }

    // Remove duplicates and sort by score
    const seen = new Set<string>();
    results = results.filter((pair) => {
        if (seen.has(pair.cellId)) return false;
        seen.add(pair.cellId);
        return true;
    });

    // Sort by score - BM25 scores are negative (more negative = better match)
    // So we sort ascending to put better matches first
    results.sort((a, b) => {
        const scoreA = "score" in a ? (a.score as number) : 0;
        const scoreB = "score" in b ? (b.score as number) : 0;
        return scoreA - scoreB;
    });

    return results.slice(0, k);
} 