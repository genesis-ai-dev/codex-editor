/**
 * Search Manager - handles algorithm selection and provides unified interface
 */

import * as vscode from "vscode";
import { TranslationPair } from "../../../../../types";
import { SQLiteIndexManager } from "../indexes/sqliteIndex";
import { BaseSearchAlgorithm, SearchOptions } from "./base";
import { ContextBranchingSearchAlgorithm } from "./contextBranchingSearch";

export type SearchAlgorithmType = "sbs" | "custom";

export class SearchManager {
    private algorithms: Map<SearchAlgorithmType, BaseSearchAlgorithm> = new Map();
    private defaultAlgorithm: SearchAlgorithmType = "sbs";

    constructor(private indexManager: SQLiteIndexManager) {
        this.registerDefaultAlgorithms();
    }

    /**
     * Register the built-in search algorithms
     */
    private registerDefaultAlgorithms(): void {
        // SBS (Smart Branched Search) is the default and recommended algorithm
        this.algorithms.set("sbs", new ContextBranchingSearchAlgorithm(this.indexManager));
        // "custom" also uses SBS by default, but can be overridden via registerAlgorithm
        this.algorithms.set("custom", new ContextBranchingSearchAlgorithm(this.indexManager));
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
        const configured = config.get<string>("searchAlgorithm");
        // Handle legacy fts5-bm25 setting by defaulting to sbs
        if (configured === "fts5-bm25") {
            return "sbs";
        }
        return (configured as SearchAlgorithmType) || this.defaultAlgorithm;
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
    private getAlgorithmByType(type: SearchAlgorithmType | string): BaseSearchAlgorithm {
        // Handle legacy fts5-bm25 requests by using sbs
        const normalizedType = type === "fts5-bm25" ? "sbs" : type;
        const algorithm = this.algorithms.get(normalizedType as SearchAlgorithmType);
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
            limit: options.limit || 15,
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
        algorithmType: SearchAlgorithmType | string,
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
     */
    async getTranslationPairsFromSourceCellQuery(
        query: string,
        k: number = 5,
        onlyValidated: boolean = false
    ): Promise<TranslationPair[]> {
        const options: Partial<SearchOptions> = {
            limit: k,
            onlyValidated,
            returnRawContent: false
        };

        const algorithm = this.getCurrentAlgorithm();
        const algorithmName = algorithm.getName();
        console.log(`[SearchManager] Using algorithm: ${algorithmName} for query: "${query}" (limit: ${k}, onlyValidated: ${onlyValidated})`);

        const results = await this.searchTranslationPairs(query, options);
        console.log(`[SearchManager] Search returned ${results.length} results`);
        return results;
    }

    /**
     * Backward compatibility method with explicit algorithm selection
     * Note: fts5-bm25 requests are now handled by SBS
     */
    async getTranslationPairsFromSourceCellQueryWithAlgorithm(
        algorithmType: SearchAlgorithmType | string,
        query: string,
        k: number = 5,
        onlyValidated: boolean = false
    ): Promise<TranslationPair[]> {
        const options: Partial<SearchOptions> = {
            limit: k,
            onlyValidated,
            returnRawContent: false
        };

        const algorithm = this.getAlgorithmByType(algorithmType);
        const algorithmName = algorithm.getName();
        console.log(`[SearchManager] (forced) Using algorithm: ${algorithmName} for query: "${query}" (limit: ${k}, onlyValidated: ${onlyValidated})`);

        const results = await this.searchWithAlgorithm(algorithmType, query, options);
        return results;
    }
}
