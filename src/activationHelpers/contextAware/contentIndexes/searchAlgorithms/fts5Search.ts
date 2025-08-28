/**
 * FTS5-based search algorithm - implements the current search behavior
 * Uses SQLite FTS5 full-text search with BM25 scoring
 */

import { TranslationPair } from "../../../../../types";
import { BaseSearchAlgorithm, SearchOptions, SearchResult } from "./base";

export class FTS5SearchAlgorithm extends BaseSearchAlgorithm {
    
    getName(): string {
        return "fts5-bm25";
    }

    getDescription(): string {
        return "SQLite FTS5 full-text search with BM25 scoring. Searches both source and target content using word-based matching.";
    }

    async search(query: string, options: Partial<SearchOptions> = {}): Promise<TranslationPair[]> {
        const searchOptions = this.validateOptions(options);
        const cleanQuery = this.cleanQuery(query);

        // Use existing SQLite method with validation support
        const results = await this.searchWithFTS5(cleanQuery, searchOptions);
        
        return this.convertToTranslationPairs(results, searchOptions);
    }

    /**
     * Perform FTS5 search - wrapper around existing SQLite functionality
     */
    private async searchWithFTS5(query: string, options: SearchOptions): Promise<SearchResult[]> {
        try {
            // Use the existing SQLite method - request more candidates for better diversity
            const sqliteResults = await this.indexManager.searchCompleteTranslationPairsWithValidation(
                query,
                Math.max(options.limit * 10, 50), // Request more for filtering and diversity
                options.returnRawContent,
                options.onlyValidated
            );

            // Convert SQLite results to our SearchResult format
            return sqliteResults.map(result => ({
                cellId: result.cell_id || result.cellId,
                sourceContent: result.source_content || result.sourceContent || "",
                targetContent: result.target_content || result.targetContent || "",
                rawSourceContent: result.raw_source_content || result.rawSourceContent,
                rawTargetContent: result.raw_target_content || result.rawTargetContent,
                uri: result.uri || "",
                line: result.line || 0,
                score: result.score || 0
            }));

        } catch (error) {
            console.error(`[FTS5SearchAlgorithm] Search failed: ${error}`);
            return [];
        }
    }

    /**
     * Enhanced search that includes word overlap filtering (current behavior)
     */
    async searchWithWordOverlapFilter(
        query: string, 
        options: Partial<SearchOptions> = {}
    ): Promise<TranslationPair[]> {
        const searchOptions = this.validateOptions(options);
        const results = await this.search(query, {
            ...searchOptions,
            limit: searchOptions.limit * 6 // Get more for filtering
        });

        // Apply word overlap filtering (current algorithm behavior)
        const filteredResults = this.filterByWordOverlap(query, results, searchOptions);
        
        return filteredResults.slice(0, searchOptions.limit);
    }

    /**
     * Filter results by word overlap - replicates current tokenization logic
     */
    private filterByWordOverlap(
        query: string, 
        results: TranslationPair[], 
        options: SearchOptions
    ): TranslationPair[] {
        if (!query.trim()) return results;

        // Simple tokenization (matches current nlpUtils tokenization)
        const queryTokens = this.tokenizeText(query);
        
        return results.filter(pair => {
            // Skip current cell if provided in context
            if (options.context?.currentCellId === pair.cellId) {
                return false;
            }

            const sourceTokens = this.tokenizeText(pair.sourceCell.content || "");
            const targetTokens = this.tokenizeText(pair.targetCell.content || "");
            
            // Check for word overlap in source content (primary relevance)
            const sourceOverlap = queryTokens.some(token => sourceTokens.includes(token));
            
            // Also check for semantic similarity in target content (secondary relevance)
            const targetOverlap = queryTokens.some(token => targetTokens.includes(token));
            
            // Return true if there's overlap in either source or target content
            return sourceOverlap || targetOverlap;
        });
    }

    /**
     * Simple tokenization matching current behavior
     */
    private tokenizeText(text: string): string[] {
        return text
            .toLowerCase()
            .replace(/[^\w\s]/g, ' ') // Replace punctuation with spaces
            .split(/\s+/)
            .filter(token => token.length > 0);
    }
}
