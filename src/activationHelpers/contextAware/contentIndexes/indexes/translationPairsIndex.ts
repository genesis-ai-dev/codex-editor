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

// NOTE: Legacy indexing functions removed - replaced by FileSyncManager
// The FileSyncManager provides more efficient and reliable file-level synchronization
// All indexing is now handled through the main SQLite database via FileSyncManager

export async function searchTranslationPairs(
    translationPairsIndex: IndexType,
    query: string,
    includeIncomplete: boolean = false,
    k: number = 15,
    options: { completeBoost?: number; targetContentBoost?: number; isParallelPassagesWebview?: boolean; } = {}
): Promise<TranslationPair[]> {
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

        // Store the result based on which type of content it has
        if (result.sourceContent) {
            cellData.source = result;
        }
        if (result.targetContent) {
            cellData.target = result;
        }
    }

    // For cells where we only found one side of the translation pair,
    // try to get the missing side from the database
    for (const [cellId, cellData] of cellMap.entries()) {
        if (!cellData.source || !cellData.target) {
            // Get the complete translation pair from the database
            const completePair = await (translationPairsIndex as any).getTranslationPair?.(cellId);
            if (completePair) {
                // Fill in missing source content
                if (!cellData.source && completePair.sourceContent) {
                    cellData.source = {
                        cellId,
                        sourceContent: completePair.sourceContent,
                        rawContent: completePair.rawSourceContent,
                        uri: completePair.uri,
                        line: completePair.line,
                        score: cellData.score * 0.9 // Slightly lower score since it wasn't directly matched
                    };
                }

                // Fill in missing target content
                if (!cellData.target && completePair.targetContent) {
                    cellData.target = {
                        cellId,
                        targetContent: completePair.targetContent,
                        rawTargetContent: completePair.rawTargetContent,
                        uri: completePair.uri,
                        line: completePair.line,
                        score: cellData.score * 0.9 // Slightly lower score since it wasn't directly matched
                    };
                }
            }
        }
    }

    // Convert grouped results to TranslationPair objects
    const results: (TranslationPair & { score: number; })[] = [];

    for (const [cellId, cellData] of cellMap.entries()) {
        const sourceResult = cellData.source;
        const targetResult = cellData.target;

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

        // If we're not including incomplete pairs, we need BOTH source and target content
        // This ensures we always return complete translation pairs (both sides)
        if (!includeIncomplete && (!sourceContent.trim() || !targetContent.trim())) {
            continue;
        }

        // If we're including incomplete pairs, we need at least one side
        if (includeIncomplete && !sourceContent.trim() && !targetContent.trim()) {
            continue;
        }

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
    const finalResults = results
        .sort((a, b) => b.score - a.score)
        .slice(0, k)
        .map(({ score, ...pair }) => pair);

    return finalResults;
}
