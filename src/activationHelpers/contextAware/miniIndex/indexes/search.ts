import MiniSearch from "minisearch";
import * as vscode from "vscode";

import { SourceVerseVersions, TranslationPair } from "../../../../../types";

export function searchTargetVersesByQuery(translationPairsIndex: MiniSearch, query: string, k: number = 5, fuzziness: number = 0.2) {
    return translationPairsIndex.search(query, {
        fields: ['targetContent'],
        combineWith: 'OR',
        prefix: true,
        fuzzy: fuzziness,
        boost: { targetContent: 2, vref: 1 }
    }).slice(0, k);
}

export function getSourceVerseByVrefFromAllSourceVerses(sourceBibleIndex: MiniSearch, vref: string): SourceVerseVersions | null {

    // Directly get the document from the index
    const result = sourceBibleIndex.getStoredFields(vref);

    if (result) {
        return {
            vref: result.vref as string,
            content: result.content as string,
            versions: result.versions as string[],
        };
    }
    return null;
}

export function getTargetVerseByVref(translationPairsIndex: MiniSearch, vref: string) {
    const results = translationPairsIndex.search(vref);
    return results.find(result => result.vref === vref);
}

export function getTranslationPairFromProject(translationPairsIndex: MiniSearch, vref: string): TranslationPair | null {
    const result = translationPairsIndex.search(vref, {
        fields: ['vref'],
        combineWith: 'AND',
        filter: (result) => result.vref === vref
    })[0];

    if (result) {
        return {
            vref,
            sourceVerse: {
                vref: result.vref,
                content: result.sourceContent,
                uri: result.uri,
                line: result.line,
            },
            targetVerse: {
                vref: result.vref,
                content: result.targetContent,
                uri: result.uri,
                line: result.line
            }
        };
    }
    return null;
}

export function getTranslationPairsFromSourceVerseQuery(translationPairsIndex: MiniSearch, query: string, k: number = 5): TranslationPair[] {
    let results = translationPairsIndex.search(query, {
        fields: ['sourceContent'],
        combineWith: 'OR',
        prefix: true,
        fuzzy: 0.2,
        boost: { sourceContent: 2 }
    });

    // If we still don't have enough results, try a more lenient search
    if (results.length < k) {
        results = translationPairsIndex.search(query, {
            fields: ['sourceContent'],
            combineWith: 'OR',
            prefix: true,
            fuzzy: 0.4,
            boost: {
                sourceContent: 2,
                vref: 1
            }
        });
    }

    // If we still don't have results, get all entries
    if (results.length === 0) {
        results = translationPairsIndex.search('*', {
            fields: ['sourceContent'],
            boost: { vref: 1 }
        });
    }

    return results.slice(0, k).map(result => ({
        vref: result.vref,
        sourceVerse: {
            vref: result.vref,
            content: result.sourceContent,
            uri: result.uri,
            line: result.line
        },
        targetVerse: {
            vref: result.vref,
            content: result.targetContent,
            uri: result.uri,
            line: result.line
        }
    }));
}

export function handleTextSelection(translationPairsIndex: MiniSearch, selectedText: string) {
    return searchTargetVersesByQuery(translationPairsIndex, selectedText);
}

// Add this new function
export function searchParallelVerses(translationPairsIndex: MiniSearch, sourceBibleIndex: MiniSearch, query: string, k: number = 5): TranslationPair[] {
    console.log('Searching for parallel verses with query:', query);

    // Search target verses
    const targetResults = translationPairsIndex.search(query, {
        fields: ['targetContent'],
        combineWith: 'OR',
        prefix: true,
        fuzzy: 0.2,
        boost: { targetContent: 2, vref: 1 }
    });

    console.log('Raw target search results:', JSON.stringify(targetResults, null, 2));

    const translationPairs: TranslationPair[] = targetResults.slice(0, k).map(result => {
        console.log('Processing result:', JSON.stringify(result, null, 2));

        // Get source content from sourceBibleIndex
        const sourceResult = sourceBibleIndex.getStoredFields(result.vref);
        const sourceContent = sourceResult ? sourceResult.content : '';

        return {
            vref: result.vref,
            sourceVerse: {
                vref: result.vref,
                content: sourceContent as string,
                uri: result.uri,
                line: result.line
            },
            targetVerse: {
                vref: result.vref,
                content: result.targetContent as string,
                uri: result.uri,
                line: result.line
            }
        };
    });

    console.log('Processed translation pairs:', JSON.stringify(translationPairs, null, 2));

    return translationPairs;
}