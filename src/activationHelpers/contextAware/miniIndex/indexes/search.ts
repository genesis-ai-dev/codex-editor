import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { SourceCellVersions, TranslationPair } from "../../../../../types";

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
    k: number = 5
): TranslationPair[] {
    console.log("Searching for parallel cells with query:", query);

    // Search target cells
    const targetResults = translationPairsIndex.search(query, {
        fields: ["targetContent"],
        combineWith: "OR",
        prefix: true,
        fuzzy: 0.2,
        boost: { targetContent: 2, cellId: 1 },
    });

    console.log("Raw target search results:", JSON.stringify(targetResults.map(r => ({cellId: r.cellId})), null, 2));

    const translationPairs: TranslationPair[] = targetResults.slice(0, k).map((result) => {
        console.log("Processing result:", JSON.stringify(result, null, 2));

        // Get source content from sourceTextIndex
        const sourceResult = sourceTextIndex.getStoredFields(result.cellId);
        const sourceContent = sourceResult ? sourceResult.content : "";

        // Retrieve the stored fields for the target cell
        const storedFields = translationPairsIndex.getStoredFields(result.id);

        if (!storedFields) {
            console.warn(`No stored fields found for result with id: ${result.id}`);
            return null;
        }

        return {
            cellId: result.cellId,
            sourceCell: {
                cellId: result.cellId,
                content: sourceContent as string,
                uri: storedFields.uri,
                line: storedFields.line,
            },
            targetCell: {
                cellId: result.cellId,
                content: storedFields.targetContent as string,
                uri: storedFields.uri,
                line: storedFields.line,
            },
        } as TranslationPair;
    }).filter((pair): pair is NonNullable<TranslationPair> => pair !== null);

    console.log("Processed translation pairs:", JSON.stringify(translationPairs, null, 2));

    return translationPairs;
}
