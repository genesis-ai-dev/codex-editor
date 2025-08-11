/**
 * Base class for translation pair search algorithms
 * Provides a common interface for different search strategies
 */

import { TranslationPair } from "../../../../../types";
import { SQLiteIndexManager } from "../indexes/sqliteIndex";

export interface SearchResult {
    cellId: string;
    sourceContent: string;
    targetContent: string;
    rawSourceContent?: string;
    rawTargetContent?: string;
    uri: string;
    line: number;
    score: number;
}

export interface SearchOptions {
    /** Number of results to return */
    limit: number;
    /** Only return validated translation pairs */
    onlyValidated: boolean;
    /** Return raw content instead of processed content */
    returnRawContent: boolean;
    /** Minimum similarity score threshold */
    minScore?: number;
    /** Additional context for search refinement */
    context?: {
        precedingCells?: string[];
        currentCellId?: string;
        sourceLanguage?: string;
        targetLanguage?: string;
    };
}

export abstract class BaseSearchAlgorithm {
    protected indexManager: SQLiteIndexManager;
    
    constructor(indexManager: SQLiteIndexManager) {
        this.indexManager = indexManager;
    }

    /**
     * Search for translation pairs similar to the given query
     * @param query - The source text to find similar translations for
     * @param options - Search configuration options
     * @returns Array of translation pairs ranked by relevance
     */
    abstract search(query: string, options: SearchOptions): Promise<TranslationPair[]>;

    /**
     * Get the name/identifier of this search algorithm
     */
    abstract getName(): string;

    /**
     * Get a description of how this algorithm works
     */
    abstract getDescription(): string;

    /**
     * Convert raw search results to TranslationPair format
     * This is a common utility method that implementations can use
     */
    protected convertToTranslationPairs(
        results: SearchResult[], 
        options: SearchOptions
    ): TranslationPair[] {
        const translationPairs: TranslationPair[] = [];
        const seenCellIds = new Set<string>();

        for (const result of results) {
            // Skip duplicates
            if (seenCellIds.has(result.cellId)) continue;
            seenCellIds.add(result.cellId);

            // Apply minimum score filter if specified
            if (options.minScore && result.score < options.minScore) continue;

            // Verify we have actual content
            const sourceContent = options.returnRawContent ? 
                (result.rawSourceContent || result.sourceContent) : 
                result.sourceContent;
            const targetContent = options.returnRawContent ? 
                (result.rawTargetContent || result.targetContent) : 
                result.targetContent;

            if (sourceContent?.trim() && targetContent?.trim()) {
                translationPairs.push({
                    cellId: result.cellId,
                    sourceCell: {
                        cellId: result.cellId,
                        content: sourceContent,
                        uri: result.uri || "",
                        line: result.line || 0,
                    },
                    targetCell: {
                        cellId: result.cellId,
                        content: targetContent,
                        uri: result.uri || "",
                        line: result.line || 0,
                    }
                });
            }
        }

        return translationPairs.slice(0, options.limit);
    }

    /**
     * Validate search options and apply defaults
     */
    protected validateOptions(options: Partial<SearchOptions>): SearchOptions {
        return {
            limit: options.limit || 30,
            onlyValidated: options.onlyValidated || false,
            returnRawContent: options.returnRawContent || false,
            minScore: options.minScore,
            context: options.context
        };
    }

    /**
     * Clean and normalize query text
     */
    protected cleanQuery(query: string): string {
        return query
            .replace(/<[^>]*?>/g, '') // Remove HTML tags
            .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
            .replace(/\s+/g, ' ') // Normalize whitespace
            .trim();
    }
}
