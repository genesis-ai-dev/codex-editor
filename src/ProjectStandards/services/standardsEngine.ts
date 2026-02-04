import * as vscode from "vscode";
import { ProjectStandard, StandardViolation } from "../../../types";
import { getSQLiteIndexManager } from "../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager";
import {
    getCompiledRegex,
    stripHtml,
    findAllMatches,
    clearRegexFromCache,
    validateRegex,
} from "../utils/regexUtils";
import { isStandardTypeSupported } from "./standardsStorage";
import { callLLM, fetchCompletionConfig, CompletionConfig } from "../../utils/llmUtils";
import { debounce } from "lodash";

// Cache for violation results per standard
const violationCache = new Map<string, {
    violations: StandardViolation[];
    scannedAt: number;
    regexPattern: string;
}>();

// Maximum time to keep cached violations (5 minutes)
const CACHE_TTL_MS = 5 * 60 * 1000;

// Chunk size for processing cells to avoid blocking UI
const CHUNK_SIZE = 500;

// ============================================
// Cost Control Configuration
// ============================================

/**
 * Configuration for controlling processing costs.
 * IMPORTANT: Batch LLM processing is DISABLED by default to prevent runaway costs.
 */
interface CostControlConfig {
    /** Maximum number of cells to scan. Default: 1000 (recent cells only) */
    maxCellsToScan: number;
    /** Whether batch LLM processing is enabled. Default: false (DISABLED) */
    enableBatchLLMProcessing: boolean;
    /** Maximum LLM calls per minute (rate limiting). Default: 5 */
    maxLLMCallsPerMinute: number;
    /** Cooldown between LLM calls in ms. Default: 2000 */
    llmCooldownMs: number;
}

const DEFAULT_COST_CONTROL: CostControlConfig = {
    maxCellsToScan: 1000, // Only scan recent 1000 cells by default
    enableBatchLLMProcessing: false, // DISABLED - batch LLM is costly
    maxLLMCallsPerMinute: 5, // Rate limit LLM calls
    llmCooldownMs: 2000, // 2 second cooldown between LLM calls
};

// Current cost control configuration (can be updated at runtime)
let costControlConfig: CostControlConfig = { ...DEFAULT_COST_CONTROL };

// Track LLM call timestamps for rate limiting
const llmCallTimestamps: number[] = [];

/**
 * Update cost control configuration.
 */
export function setCostControlConfig(config: Partial<CostControlConfig>): void {
    costControlConfig = { ...costControlConfig, ...config };
    console.log("[StandardsEngine] Cost control config updated:", costControlConfig);
}

/**
 * Get current cost control configuration.
 */
export function getCostControlConfig(): CostControlConfig {
    return { ...costControlConfig };
}

/**
 * Check if we can make an LLM call (rate limiting).
 * Returns true if allowed, false if rate limited.
 */
function canMakeLLMCall(): boolean {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;

    // Remove timestamps older than 1 minute
    while (llmCallTimestamps.length > 0 && llmCallTimestamps[0] < oneMinuteAgo) {
        llmCallTimestamps.shift();
    }

    // Check if we're under the rate limit
    return llmCallTimestamps.length < costControlConfig.maxLLMCallsPerMinute;
}

/**
 * Record an LLM call for rate limiting.
 */
function recordLLMCall(): void {
    llmCallTimestamps.push(Date.now());
}

/**
 * Wait for LLM cooldown period.
 */
async function waitForLLMCooldown(): Promise<void> {
    const lastCall = llmCallTimestamps[llmCallTimestamps.length - 1];
    if (lastCall) {
        const elapsed = Date.now() - lastCall;
        if (elapsed < costControlConfig.llmCooldownMs) {
            await new Promise(resolve => setTimeout(resolve, costControlConfig.llmCooldownMs - elapsed));
        }
    }
}

/**
 * Guard function to prevent batch LLM processing.
 * IMPORTANT: This is a safety measure. Batch LLM is DISABLED by default.
 * 
 * @throws Error if batch processing is disabled and attempting to process multiple items
 */
function guardBatchLLMProcessing(itemCount: number, operationName: string): void {
    if (itemCount > 1 && !costControlConfig.enableBatchLLMProcessing) {
        throw new Error(
            `[COST GUARD] Batch LLM processing is disabled. ` +
            `Operation "${operationName}" attempted to process ${itemCount} items. ` +
            `Enable batch processing explicitly if needed: setCostControlConfig({ enableBatchLLMProcessing: true })`
        );
    }
}

/**
 * Get statistics about current cost control state.
 * Useful for debugging and monitoring.
 */
export function getCostControlStats(): {
    config: CostControlConfig;
    llmCallsInLastMinute: number;
    canMakeLLMCall: boolean;
    cellsScannedLimit: number;
} {
    const now = Date.now();
    const oneMinuteAgo = now - 60000;
    const recentCalls = llmCallTimestamps.filter(ts => ts > oneMinuteAgo).length;

    return {
        config: { ...costControlConfig },
        llmCallsInLastMinute: recentCalls,
        canMakeLLMCall: canMakeLLMCall(),
        cellsScannedLimit: costControlConfig.maxCellsToScan,
    };
}

/**
 * Cell data returned from SQLite index.
 */
interface IndexedCell {
    cellId: string;
    cell_id: string;
    content: string;
    rawContent?: string;
    cell_type: "source" | "target";
    uri?: string;
    file_path?: string;
    line?: number;
    word_count?: number;
}

/**
 * Get target cells from the SQLite index.
 * Respects maxCellsToScan limit for cost control.
 * 
 * @param limit - Override the default cell limit (optional)
 */
async function getTargetCells(limit?: number): Promise<IndexedCell[]> {
    const indexManager = getSQLiteIndexManager();

    if (!indexManager) {
        console.warn("[StandardsEngine] SQLite index manager not available");
        return [];
    }

    const cellLimit = limit ?? costControlConfig.maxCellsToScan;

    try {
        // Use searchGreekText with empty query to get cells
        // Pass 'target' as cellType to filter to target cells only
        // Limit to maxCellsToScan for cost control
        const cells = await indexManager.searchGreekText("", "target", cellLimit);

        // Only log limit warning if we're using a reasonable limit (not scanning all)
        if (cellLimit < 100000 && cells.length >= cellLimit) {
            console.log(`[StandardsEngine] Cell limit reached (${cellLimit}). Scanning recent cells only.`);
        }

        return cells as IndexedCell[];
    } catch (error) {
        console.error("[StandardsEngine] Error fetching target cells:", error);
        return [];
    }
}


/**
 * Scan a single standard against all target cells.
 * Returns all violations found.
 * 
 * @param standard - The standard to scan for
 * @param onProgress - Optional progress callback
 * @param maxCellsToScan - Maximum cells to scan (default: uses cost control config)
 */
export async function scanForViolations(
    standard: ProjectStandard,
    onProgress?: (processed: number, total: number) => void,
    maxCellsToScan?: number
): Promise<StandardViolation[]> {
    // Only process regex-pattern standards in Phase 1
    if (!isStandardTypeSupported(standard.standardType)) {
        console.warn(`[StandardsEngine] Standard type '${standard.standardType}' not supported in Phase 1`);
        return [];
    }

    if (!standard.enabled) {
        return [];
    }

    if (!standard.regexPattern || standard.regexPattern.trim() === "") {
        return [];
    }

    // Validate regex pattern
    const validation = validateRegex(standard.regexPattern);
    if (!validation.valid) {
        console.error(`[StandardsEngine] Invalid regex for standard ${standard.id}: ${validation.error}`);
        return [];
    }

    // Check cache
    const cached = violationCache.get(standard.id);
    if (
        cached &&
        cached.regexPattern === standard.regexPattern &&
        Date.now() - cached.scannedAt < CACHE_TTL_MS
    ) {
        return cached.violations;
    }

    // Clear old cache entry if regex changed
    if (cached && cached.regexPattern !== standard.regexPattern) {
        clearRegexFromCache(cached.regexPattern);
        violationCache.delete(standard.id);
    }

    // Clean the pattern first
    const cleanedPattern = cleanRegexResponse(standard.regexPattern);

    // Use smart search: try to find cells containing the pattern text first
    let cells: IndexedCell[] = [];
    const indexManager = getSQLiteIndexManager();
    const cellLimit = maxCellsToScan ?? costControlConfig.maxCellsToScan;

    if (indexManager && cleanedPattern) {
        // Try to extract a simple search term from the pattern
        const searchTermMatch = cleanedPattern.match(/\\b(.+?)\\b/);
        const simpleSearchTerm = searchTermMatch ? searchTermMatch[1].replace(/\\/g, '') : null;

        if (simpleSearchTerm && simpleSearchTerm.length > 2) {
            // Search for cells containing this term first (more likely to match)
            try {
                const searchResults = await indexManager.searchGreekText(simpleSearchTerm, "target", Math.min(cellLimit, 5000));
                cells = searchResults as IndexedCell[];
                console.log(`[StandardsEngine] Found ${cells.length} cells containing "${simpleSearchTerm}" for standard "${standard.description}"`);
            } catch (error) {
                console.warn(`[StandardsEngine] Search failed, falling back to all cells:`, error);
            }
        }

        // If we didn't find enough cells or search failed, get more cells
        if (cells.length < cellLimit) {
            const additionalCells = await getTargetCells(cellLimit);
            // Merge and deduplicate by cell_id
            const existingIds = new Set(cells.map(c => c.cellId || c.cell_id));
            const newCells = additionalCells.filter(c => !existingIds.has(c.cellId || c.cell_id));
            cells = [...cells, ...newCells].slice(0, cellLimit);
        }
    } else {
        // Fallback to regular method
        cells = await getTargetCells(cellLimit);
    }

    // Use cleaned pattern for matching
    const standardWithCleanedPattern = { ...standard, regexPattern: cleanedPattern };
    const violations: StandardViolation[] = [];
    const total = cells.length;

    // Process cells in chunks to avoid blocking
    for (let i = 0; i < cells.length; i += CHUNK_SIZE) {
        const chunk = cells.slice(i, i + CHUNK_SIZE);

        for (const cell of chunk) {
            const cellViolations = checkCellForViolations(standardWithCleanedPattern, cell);
            violations.push(...cellViolations);
        }

        // Report progress
        if (onProgress) {
            onProgress(Math.min(i + CHUNK_SIZE, total), total);
        }

        // Yield to event loop to keep UI responsive
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    // Update cache
    violationCache.set(standard.id, {
        violations,
        scannedAt: Date.now(),
        regexPattern: standard.regexPattern,
    });

    return violations;
}

/**
 * Check a single cell for violations against a standard.
 */
function checkCellForViolations(
    standard: ProjectStandard,
    cell: IndexedCell
): StandardViolation[] {
    const content = cell.content || cell.rawContent || "";

    if (!content || content.trim() === "") {
        return [];
    }

    // Strip HTML before matching
    const cleanContent = stripHtml(content);

    if (!cleanContent || cleanContent.trim() === "") {
        return [];
    }

    const matches = findAllMatches(standard.regexPattern, cleanContent, false);

    return matches.map((match) => ({
        cellId: cell.cellId || cell.cell_id,
        fileUri: cell.uri || cell.file_path || "",
        cellValue: content,
        matchText: match.match,
        lineNumber: cell.line,
    }));
}

/**
 * Get violation count for a standard without returning full details.
 * More efficient when you only need the count.
 */
export async function getViolationCount(standard: ProjectStandard): Promise<number> {
    const violations = await scanForViolations(standard);
    return violations.length;
}

/**
 * Scan all standards and return violation counts.
 * Returns a map of standardId -> violation count.
 * 
 * @param standards - Array of standards to scan
 * @param onProgress - Optional progress callback
 * @param maxCellsToScan - Maximum cells to scan (default: unlimited for full scan)
 */
export async function scanAllStandards(
    standards: ProjectStandard[],
    onProgress?: (processed: number, total: number, currentStandard: string) => void,
    maxCellsToScan: number = Number.MAX_SAFE_INTEGER
): Promise<Map<string, StandardViolation[]>> {
    const results = new Map<string, StandardViolation[]>();

    // Filter to only enabled, supported standards
    const enabledStandards = standards.filter(
        (s) => s.enabled && isStandardTypeSupported(s.standardType)
    );

    if (enabledStandards.length === 0) {
        console.log("[StandardsEngine] No enabled standards to scan");
        return results;
    }

    const totalStandards = enabledStandards.length;

    // For each standard, use smart search to find relevant cells
    // This is more efficient than scanning all cells for all standards
    for (let i = 0; i < enabledStandards.length; i++) {
        const standard = enabledStandards[i];

        if (onProgress) {
            onProgress(i, totalStandards, standard.description);
        }

        // Use scanForViolations which includes smart search
        // This will search for cells containing the pattern text first
        const violations = await scanForViolations(standard, undefined, maxCellsToScan);
        console.log(`[StandardsEngine] Standard "${standard.description}" (${standard.id}): found ${violations.length} violations`);
        results.set(standard.id, violations);

        // Yield to event loop
        await new Promise((resolve) => setTimeout(resolve, 0));
    }

    if (onProgress) {
        onProgress(totalStandards, totalStandards, "Complete");
    }

    return results;
}

/**
 * Scan a standard against a pre-fetched list of cells.
 * Used internally for efficient batch scanning.
 */
async function scanStandardAgainstCells(
    standard: ProjectStandard,
    cells: IndexedCell[]
): Promise<StandardViolation[]> {
    if (!standard.regexPattern || standard.regexPattern.trim() === "") {
        return [];
    }

    // Clean the pattern in case it's a regex literal (should already be cleaned, but be safe)
    const cleanedPattern = cleanRegexResponse(standard.regexPattern);

    const validation = validateRegex(cleanedPattern);
    if (!validation.valid) {
        console.error(`[StandardsEngine] Invalid regex for standard ${standard.id}: ${validation.error}`);
        return [];
    }

    // Use cleaned pattern for matching
    const standardWithCleanedPattern = { ...standard, regexPattern: cleanedPattern };
    const violations: StandardViolation[] = [];

    for (const cell of cells) {
        const cellViolations = checkCellForViolations(standardWithCleanedPattern, cell);
        violations.push(...cellViolations);
    }

    // Update cache
    violationCache.set(standard.id, {
        violations,
        scannedAt: Date.now(),
        regexPattern: standard.regexPattern,
    });

    return violations;
}

/**
 * Get violation counts for all standards.
 * Returns a record of standardId -> count.
 */
export async function getViolationCounts(
    standards: ProjectStandard[]
): Promise<Record<string, number>> {
    const allViolations = await scanAllStandards(standards);
    const counts: Record<string, number> = {};

    for (const [standardId, violations] of allViolations) {
        counts[standardId] = violations.length;
    }

    return counts;
}

/**
 * Clear violation cache for a specific standard.
 * Call this when a standard is updated.
 */
export function clearViolationCache(standardId: string): void {
    const cached = violationCache.get(standardId);
    if (cached) {
        clearRegexFromCache(cached.regexPattern);
    }
    violationCache.delete(standardId);
}

/**
 * Clear all violation caches.
 */
export function clearAllViolationCaches(): void {
    violationCache.clear();
}

/**
 * Test a regex pattern against sample cells.
 * Returns first N matches for preview purposes.
 * 
 * @param pattern - The regex pattern to test (can be a pattern string or regex literal like /pattern/gi)
 * @param maxResults - Maximum number of matches to return (default: 10)
 * @param maxCellsToScan - Maximum number of cells to scan (default: 5000 for testing)
 */
export async function testRegexPattern(
    pattern: string,
    maxResults: number = 10,
    maxCellsToScan: number = 5000
): Promise<{ matches: StandardViolation[]; totalCount: number; }> {
    // Clean the pattern if it's a regex literal (e.g., /pattern/gi -> pattern)
    const cleanedPattern = cleanRegexResponse(pattern);

    const validation = validateRegex(cleanedPattern);
    if (!validation.valid) {
        throw new Error(`Invalid regex: ${validation.error}`);
    }

    // For testing, try to extract a search term from the pattern to find relevant cells first
    // This helps when testing - we search for cells containing likely matches
    let cells: IndexedCell[] = [];
    const indexManager = getSQLiteIndexManager();

    if (indexManager) {
        // Try to extract a simple search term from the pattern (remove word boundaries, etc.)
        // For patterns like \bGod\b, extract "God" for searching
        const searchTermMatch = cleanedPattern.match(/\\b(.+?)\\b/);
        const simpleSearchTerm = searchTermMatch ? searchTermMatch[1].replace(/\\/g, '') : null;

        if (simpleSearchTerm && simpleSearchTerm.length > 2) {
            // Search for cells containing this term first (more likely to match)
            try {
                const searchResults = await indexManager.searchGreekText(simpleSearchTerm, "target", Math.min(maxCellsToScan, 1000));
                cells = searchResults as IndexedCell[];
                console.log(`[StandardsEngine] Found ${cells.length} cells containing "${simpleSearchTerm}"`);
            } catch (error) {
                console.warn(`[StandardsEngine] Search failed, falling back to all cells:`, error);
            }
        }

        // If we didn't find enough cells or search failed, get more cells
        if (cells.length < 100) {
            const additionalCells = await getTargetCells(maxCellsToScan);
            // Merge and deduplicate by cell_id
            const existingIds = new Set(cells.map(c => c.cellId || c.cell_id));
            const newCells = additionalCells.filter(c => !existingIds.has(c.cellId || c.cell_id));
            cells = [...cells, ...newCells].slice(0, maxCellsToScan);
        }
    } else {
        // Fallback to regular method
        cells = await getTargetCells(maxCellsToScan);
    }

    console.log(`[StandardsEngine] Testing pattern "${cleanedPattern}" against ${cells.length} cells`);

    const matches: StandardViolation[] = [];
    let totalCount = 0;

    for (const cell of cells) {
        const content = cell.content || cell.rawContent || "";
        if (!content) continue;

        const cleanContent = stripHtml(content);
        const cellMatches = findAllMatches(cleanedPattern, cleanContent, false);

        // Debug: log first few cells and any cells that match
        if (cells.indexOf(cell) < 5 || cellMatches.length > 0) {
            console.log(`[StandardsEngine] Cell ${cell.cellId || cell.cell_id}:`, {
                hasContent: !!content,
                contentPreview: content.substring(0, 150),
                cleanContentPreview: cleanContent.substring(0, 150),
                matches: cellMatches.length,
                matchTexts: cellMatches.map(m => m.match),
            });
        }

        totalCount += cellMatches.length;

        if (matches.length < maxResults) {
            for (const match of cellMatches) {
                if (matches.length >= maxResults) break;

                matches.push({
                    cellId: cell.cellId || cell.cell_id,
                    fileUri: cell.uri || cell.file_path || "",
                    cellValue: content,
                    matchText: match.match,
                    lineNumber: cell.line,
                });
            }
        }
    }

    return { matches, totalCount };
}

/**
 * Debounced scan function to prevent rapid re-scanning.
 * Use this when scanning in response to user input.
 */
export const debouncedScan = debounce(
    async (
        standard: ProjectStandard,
        callback: (violations: StandardViolation[]) => void
    ) => {
        const violations = await scanForViolations(standard);
        callback(violations);
    },
    500
);

/**
 * Get cache statistics for debugging.
 */
export function getCacheStats(): {
    cacheSize: number;
    cachedStandards: string[];
} {
    return {
        cacheSize: violationCache.size,
        cachedStandards: Array.from(violationCache.keys()),
    };
}

// ============================================
// LLM Integration for Regex Generation
// ============================================

/**
 * Generate a regex pattern from example violations using LLM.
 * Returns the generated pattern or throws an error.
 * 
 * NOTE: This is a single LLM call per user action (not batched).
 * Rate limited to prevent excessive API costs.
 */
export async function generateRegexFromExamples(
    description: string,
    examples: string[],
    cancellationToken?: vscode.CancellationToken
): Promise<string> {
    if (!description || description.trim() === "") {
        throw new Error("Description is required for regex generation");
    }

    if (!examples || examples.length === 0) {
        throw new Error("At least one example is required for regex generation");
    }

    // Rate limiting check
    if (!canMakeLLMCall()) {
        throw new Error("Rate limit exceeded. Please wait a moment before generating another regex.");
    }

    // Wait for cooldown if needed
    await waitForLLMCooldown();

    const config = await fetchCompletionConfig();

    const prompt = buildRegexGenerationPrompt(description, examples);

    try {
        // Record this LLM call for rate limiting
        recordLLMCall();

        const response = await callLLM(
            [
                {
                    role: "system",
                    content: `You are an expert at creating JavaScript regular expressions. Your task is to create a regex pattern that matches the given examples. Follow these rules:
1. Return ONLY the regex pattern, without forward slashes or flags
2. The pattern will be used with 'gi' flags (global, case-insensitive)
3. Use word boundaries (\\b) to match whole words when appropriate
4. Keep the pattern as simple as possible while matching all examples
5. Do not include any explanation, just the pattern`,
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            config,
            cancellationToken
        );

        // Clean up the response - extract just the regex pattern
        const cleanedPattern = cleanRegexResponse(response);

        // Validate the generated pattern
        const validation = validateRegex(cleanedPattern);
        if (!validation.valid) {
            throw new Error(`Generated invalid regex: ${validation.error}`);
        }

        // Test that the pattern matches at least one example
        const matchesAny = examples.some((example) => {
            try {
                const regex = new RegExp(cleanedPattern, "gi");
                return regex.test(example);
            } catch {
                return false;
            }
        });

        if (!matchesAny) {
            console.warn(
                "[StandardsEngine] Generated pattern doesn't match any examples, but returning anyway"
            );
        }

        return cleanedPattern;
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            throw error;
        }
        console.error("[StandardsEngine] Error generating regex:", error);
        throw new Error(`Failed to generate regex: ${(error as Error).message}`);
    }
}

/**
 * Build the prompt for regex generation.
 */
function buildRegexGenerationPrompt(description: string, examples: string[]): string {
    const examplesList = examples
        .map((ex, i) => `${i + 1}. "${ex}"`)
        .join("\n");

    return `Create a JavaScript regex pattern that matches the following examples.

Description of what to match: ${description}

Examples that should be matched:
${examplesList}

Return ONLY the regex pattern (without forward slashes or flags).`;
}

/**
 * Clean up LLM response or user input to extract just the regex pattern.
 * Handles regex literals like /pattern/gi, markdown code blocks, quotes, etc.
 */
export function cleanRegexResponse(response: string): string {
    let cleaned = response.trim();

    // Remove markdown code blocks if present
    cleaned = cleaned.replace(/```(?:regex|javascript|js)?\n?([\s\S]*?)\n?```/gi, "$1");

    // Remove common prefixes
    cleaned = cleaned.replace(/^(?:pattern|regex|the pattern is|here is the pattern)[:;]?\s*/i, "");

    // Remove forward slashes and flags if present (e.g., /pattern/gi)
    const regexLiteralMatch = cleaned.match(/^\/(.+)\/[gimsuvy]*$/);
    if (regexLiteralMatch) {
        cleaned = regexLiteralMatch[1];
    }

    // Remove quotes if wrapped
    cleaned = cleaned.replace(/^["'`](.+)["'`]$/, "$1");

    // Trim whitespace
    cleaned = cleaned.trim();

    // If multi-line, take just the first non-empty line
    const lines = cleaned.split("\n").filter((line) => line.trim());
    if (lines.length > 0) {
        cleaned = lines[0].trim();
    }

    return cleaned;
}

/**
 * Suggest improvements to an existing regex pattern using LLM.
 * 
 * NOTE: This is a single LLM call per user action (not batched).
 * Rate limited to prevent excessive API costs.
 */
export async function improveRegexPattern(
    currentPattern: string,
    description: string,
    falsePositives?: string[],
    missedExamples?: string[],
    cancellationToken?: vscode.CancellationToken
): Promise<string> {
    // Rate limiting check
    if (!canMakeLLMCall()) {
        throw new Error("Rate limit exceeded. Please wait a moment before making another request.");
    }

    // Wait for cooldown if needed
    await waitForLLMCooldown();

    const config = await fetchCompletionConfig();

    let prompt = `Improve this JavaScript regex pattern.

Current pattern: ${currentPattern}
Description: ${description}`;

    if (falsePositives && falsePositives.length > 0) {
        prompt += `\n\nFalse positives (should NOT match):
${falsePositives.map((fp, i) => `${i + 1}. "${fp}"`).join("\n")}`;
    }

    if (missedExamples && missedExamples.length > 0) {
        prompt += `\n\nMissed examples (SHOULD match):
${missedExamples.map((me, i) => `${i + 1}. "${me}"`).join("\n")}`;
    }

    prompt += "\n\nReturn ONLY the improved regex pattern (without forward slashes or flags).";

    try {
        // Record this LLM call for rate limiting
        recordLLMCall();

        const response = await callLLM(
            [
                {
                    role: "system",
                    content: `You are an expert at creating JavaScript regular expressions. Improve the given pattern based on the feedback. Return ONLY the pattern, no explanation.`,
                },
                {
                    role: "user",
                    content: prompt,
                },
            ],
            config,
            cancellationToken
        );

        const cleanedPattern = cleanRegexResponse(response);

        const validation = validateRegex(cleanedPattern);
        if (!validation.valid) {
            throw new Error(`Generated invalid regex: ${validation.error}`);
        }

        return cleanedPattern;
    } catch (error) {
        if (error instanceof vscode.CancellationError) {
            throw error;
        }
        throw new Error(`Failed to improve regex: ${(error as Error).message}`);
    }
}
