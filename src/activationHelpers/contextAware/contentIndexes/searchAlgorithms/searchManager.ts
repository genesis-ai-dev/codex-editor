/**
 * Search Manager - handles algorithm selection and provides unified interface
 */

import * as vscode from "vscode";
import { TranslationPair } from "../../../../../types";
import { SQLiteIndexManager } from "../indexes/sqliteIndex";
import { BaseSearchAlgorithm, SearchOptions } from "./base";
import { FTS5SearchAlgorithm } from "./fts5Search";
import { ContextBranchingSearchAlgorithm } from "./contextBranchingSearch";

export type SearchAlgorithmType = "fts5-bm25" | "custom" | "sbs";

export class SearchManager {
    private algorithms: Map<SearchAlgorithmType, BaseSearchAlgorithm> = new Map();
    private defaultAlgorithm: SearchAlgorithmType = "fts5-bm25";

    constructor(private indexManager: SQLiteIndexManager) {
        this.registerDefaultAlgorithms();
    }

    /**
     * Register the built-in search algorithms
     */
    private registerDefaultAlgorithms(): void {
        this.algorithms.set("fts5-bm25", new FTS5SearchAlgorithm(this.indexManager));
        // Register additional algorithms
        this.algorithms.set("custom", new ContextBranchingSearchAlgorithm(this.indexManager));
        this.algorithms.set("sbs", new ContextBranchingSearchAlgorithm(this.indexManager));
    }

    /**
     * Register a custom search algorithm
     */
    registerAlgorithm(type: SearchAlgorithmType, algorithm: BaseSearchAlgorithm): void {
        this.algorithms.set(type, algorithm);
    }

    /**
     * Get the currently configured search algorithm
     */
    private getCurrentAlgorithmType(): SearchAlgorithmType {
        const config = vscode.workspace.getConfiguration("codex-editor-extension");
        return config.get("searchAlgorithm") || this.defaultAlgorithm;
    }

    /**
     * Get the current search algorithm instance
     */
    private getCurrentAlgorithm(): BaseSearchAlgorithm {
        const algorithmType = this.getCurrentAlgorithmType();
        const algorithm = this.algorithms.get(algorithmType);
        
        if (!algorithm) {
            console.warn(`[SearchManager] Algorithm '${algorithmType}' not found, falling back to default`);
            return this.algorithms.get(this.defaultAlgorithm)!;
        }
        
        return algorithm;
    }

    /**
     * Get a specific algorithm instance by type, with safe fallback
     */
    private getAlgorithmByType(type: SearchAlgorithmType): BaseSearchAlgorithm {
        const algorithm = this.algorithms.get(type);
        if (!algorithm) {
            console.warn(`[SearchManager] Requested algorithm '${type}' not found, falling back to default`);
            return this.algorithms.get(this.defaultAlgorithm)!;
        }
        return algorithm;
    }

    /**
     * Validate and fill in default values for search options
     */
    private validateSearchOptions(options: Partial<SearchOptions>): SearchOptions {
        return {
            limit: options.limit || 30,
            onlyValidated: options.onlyValidated || false,
            returnRawContent: options.returnRawContent || false,
            minScore: options.minScore,
            context: options.context
        };
    }

    /**
     * Search for translation pairs using the current algorithm
     */
    async searchTranslationPairs(
        query: string,
        options: Partial<SearchOptions> = {}
    ): Promise<TranslationPair[]> {
        const algorithm = this.getCurrentAlgorithm();
        
        try {
            // Validate options before passing to algorithm
            const validatedOptions = this.validateSearchOptions(options);
            return await algorithm.search(query, validatedOptions);
        } catch (error) {
            console.error(`[SearchManager] Search failed with algorithm '${algorithm.getName()}':`, error);
            
            // Fallback to default algorithm if current one fails
            if (algorithm.getName() !== this.defaultAlgorithm) {
                console.log(`[SearchManager] Falling back to default algorithm`);
                const defaultAlgorithm = this.algorithms.get(this.defaultAlgorithm)!;
                const validatedOptions = this.validateSearchOptions(options);
                return await defaultAlgorithm.search(query, validatedOptions);
            }
            
            throw error;
        }
    }

    /**
     * Force running search with a specific algorithm, ignoring configuration
     */
    async searchWithAlgorithm(
        algorithmType: SearchAlgorithmType,
        query: string,
        options: Partial<SearchOptions> = {}
    ): Promise<TranslationPair[]> {
        const algorithm = this.getAlgorithmByType(algorithmType);
        try {
            const validatedOptions = this.validateSearchOptions(options);
            return await algorithm.search(query, validatedOptions);
        } catch (error) {
            console.error(`[SearchManager] Forced search failed with algorithm '${algorithm.getName()}':`, error);
            // Fallback to default algorithm
            const fallback = this.algorithms.get(this.defaultAlgorithm)!;
            const validatedOptions = this.validateSearchOptions(options);
            return await fallback.search(query, validatedOptions);
        }
    }

    /**
     * Get list of available algorithms
     */
    getAvailableAlgorithms(): Array<{ type: SearchAlgorithmType; name: string; description: string }> {
        return Array.from(this.algorithms.entries()).map(([type, algorithm]) => ({
            type,
            name: algorithm.getName(),
            description: algorithm.getDescription()
        }));
    }

    /**
     * Backward compatibility method - maintains the existing interface
     * This replaces the current getTranslationPairsFromSourceCellQuery function
     */
    async getTranslationPairsFromSourceCellQuery(
        query: string,
        k: number = 5,
        onlyValidated: boolean = false
    ): Promise<TranslationPair[]> {
        // Request more results for filtering (current behavior)
        const initialLimit = Math.max(k * 6, 30);
        
        const options: Partial<SearchOptions> = {
            limit: k, // Final limit
            onlyValidated,
            returnRawContent: false
        };

        // For FTS5 algorithm, use the word overlap filtering method to maintain current behavior
        const algorithm = this.getCurrentAlgorithm();
        const algorithmName = algorithm.getName();
        console.log(`[SearchManager] Using algorithm: ${algorithmName} for query: "${query}" (limit: ${k}, onlyValidated: ${onlyValidated})`);
        
        if (algorithm instanceof FTS5SearchAlgorithm) {
            console.log(`[SearchManager] Using FTS5 searchWithWordOverlapFilter method`);
            const results = await algorithm.searchWithWordOverlapFilter(query, options);
            console.log(`[SearchManager] FTS5 search returned ${results.length} results`);
            return results;
        } else {
            console.log(`[SearchManager] Using standard search for algorithm: ${algorithmName}`);
            // For other algorithms, use standard search
            const results = await this.searchTranslationPairs(query, {
                ...options,
                limit: initialLimit // Let the algorithm handle its own filtering
            });
            console.log(`[SearchManager] Standard search returned ${results.length} results`);
            return results;
        }
    }

    /**
     * Backward compatibility method with explicit algorithm selection
     */
    async getTranslationPairsFromSourceCellQueryWithAlgorithm(
        algorithmType: SearchAlgorithmType,
        query: string,
        k: number = 5,
        onlyValidated: boolean = false
    ): Promise<TranslationPair[]> {
        const initialLimit = Math.max(k * 6, 30);
        const options: Partial<SearchOptions> = {
            limit: k,
            onlyValidated,
            returnRawContent: false
        };

        const algorithm = this.getAlgorithmByType(algorithmType);
        const algorithmName = algorithm.getName();
        console.log(`[SearchManager] (forced) Using algorithm: ${algorithmName} for query: "${query}" (limit: ${k}, onlyValidated: ${onlyValidated})`);

        if (algorithmName === "fts5-bm25") {
            // Prefer overlap filtering behavior for FTS5
            try {
                const fts5 = this.getAlgorithmByType("fts5-bm25") as any;
                if (typeof fts5.searchWithWordOverlapFilter === "function") {
                    return await fts5.searchWithWordOverlapFilter(query, options);
                }
            } catch (err) {
                console.warn(`[SearchManager] FTS5 overlap filtering unavailable, falling back to standard search`, err);
            }
        }

        // For other algorithms, do a standard search with larger initial limit
        const results = await this.searchWithAlgorithm(algorithmType, query, { ...options, limit: initialLimit });
        return results;
    }
}
