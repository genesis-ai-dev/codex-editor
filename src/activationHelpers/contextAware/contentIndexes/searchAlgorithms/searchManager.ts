/**
 * Search Manager - handles algorithm selection and provides unified interface
 */

import * as vscode from "vscode";
import { TranslationPair } from "../../../../../types";
import { SQLiteIndexManager } from "../indexes/sqliteIndex";
import { BaseSearchAlgorithm, SearchOptions } from "./base";
import { FTS5SearchAlgorithm } from "./fts5Search";

export type SearchAlgorithmType = "fts5-bm25" | "custom";

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
        if (algorithm instanceof FTS5SearchAlgorithm) {
            return await algorithm.searchWithWordOverlapFilter(query, options);
        } else {
            // For other algorithms, use standard search
            return await this.searchTranslationPairs(query, {
                ...options,
                limit: initialLimit // Let the algorithm handle its own filtering
            });
        }
    }
}
