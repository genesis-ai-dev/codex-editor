import { Database } from 'sql.js-fts5';
import { trackFeatureUsage } from '../telemetry/featureUsage';

// Interface for prefix matching results
export interface PrefixMatchResult {
    id: string;
    content: string;
    score: number;
    matchType: 'exact_prefix' | 'word_prefix' | 'partial_prefix' | 'fuzzy_prefix';
    matchPosition: number;
    matchLength: number;
    highlightedContent?: string;
    metadata?: any;
}

// Interface for prefix matching configuration
export interface PrefixMatchConfig {
    caseSensitive: boolean;
    wordBoundary: boolean;
    minPrefixLength: number;
    maxResults: number;
    enableFuzzyPrefix: boolean;
    fuzzyThreshold: number;
    boostExactPrefix: number;
    boostWordPrefix: number;
    enableHighlighting: boolean;
}

// Default prefix matching configuration
const DEFAULT_CONFIG: PrefixMatchConfig = {
    caseSensitive: false,
    wordBoundary: true,
    minPrefixLength: 1,
    maxResults: 100,
    enableFuzzyPrefix: true,
    fuzzyThreshold: 0.8,
    boostExactPrefix: 2.0,
    boostWordPrefix: 1.5,
    enableHighlighting: true,
};

/**
 * Initialize the prefix matching database tables and functions
 */
export function initializePrefixMatchingDb(db: Database): void {
    console.log('Initializing prefix matching database...');
    
    // Create prefix matching index table
    db.exec(`
        CREATE TABLE IF NOT EXISTS prefix_match_index (
            id TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL,
            content TEXT NOT NULL,
            normalized_content TEXT NOT NULL,
            words TEXT NOT NULL,
            word_positions TEXT NOT NULL,
            content_length INTEGER,
            word_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create FTS5 virtual table for prefix search
    db.exec(`
        DROP TABLE IF EXISTS prefix_match_fts;
        DROP TRIGGER IF EXISTS prefix_match_fts_insert;
        DROP TRIGGER IF EXISTS prefix_match_fts_delete;
        DROP TRIGGER IF EXISTS prefix_match_fts_update;
    `);
    
    db.exec(`
        CREATE VIRTUAL TABLE prefix_match_fts USING fts5(
            id UNINDEXED,
            resource_type UNINDEXED,
            content,
            normalized_content,
            words,
            prefix='2,3,4,5,6,7,8,9,10'
        );
    `);
    
    // Create triggers to keep FTS5 in sync
    db.exec(`
        CREATE TRIGGER prefix_match_fts_insert AFTER INSERT ON prefix_match_index BEGIN
            INSERT INTO prefix_match_fts(id, resource_type, content, normalized_content, words)
            VALUES (new.id, new.resource_type, new.content, new.normalized_content, new.words);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER prefix_match_fts_delete AFTER DELETE ON prefix_match_index BEGIN
            DELETE FROM prefix_match_fts WHERE rowid = old.rowid;
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER prefix_match_fts_update AFTER UPDATE ON prefix_match_index BEGIN
            DELETE FROM prefix_match_fts WHERE rowid = old.rowid;
            INSERT INTO prefix_match_fts(id, resource_type, content, normalized_content, words)
            VALUES (new.id, new.resource_type, new.content, new.normalized_content, new.words);
        END;
    `);
    
    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_prefix_match_resource_type ON prefix_match_index(resource_type);
        CREATE INDEX IF NOT EXISTS idx_prefix_match_normalized ON prefix_match_index(normalized_content);
        CREATE INDEX IF NOT EXISTS idx_prefix_match_content_length ON prefix_match_index(content_length);
        CREATE INDEX IF NOT EXISTS idx_prefix_match_word_count ON prefix_match_index(word_count);
    `);
    
    // Register custom SQL functions for prefix matching
    registerPrefixMatchingFunctions(db);
    
    console.log('Prefix matching database initialized successfully');
}

// Function to populate FTS5 from existing main table data
export function populatePrefixMatchingFTS5FromMainTable(db: Database): void {
    console.log("Populating prefix matching FTS5 table from main table data...");
    
    try {
        // First check if the main table exists
        const tableExistsStmt = db.prepare(`
            SELECT name FROM sqlite_master 
            WHERE type='table' AND name='prefix_match_index'
        `);
        tableExistsStmt.step();
        const tableExists = tableExistsStmt.getAsObject();
        tableExistsStmt.free();
        
        if (!tableExists || !tableExists.name) {
            console.log("Prefix matching index table does not exist, skipping FTS5 population");
            return;
        }
        
        // Check if the main table has data
        const checkStmt = db.prepare("SELECT COUNT(*) as count FROM prefix_match_index");
        checkStmt.step();
        const mainTableCount = checkStmt.getAsObject().count as number;
        checkStmt.free();
        
        if (mainTableCount === 0) {
            console.log("Prefix matching index table is empty, skipping FTS5 population");
            return;
        }
        
        // Clear existing FTS5 data
        db.exec("DELETE FROM prefix_match_fts");
        
        // Insert all existing data into FTS5
        db.exec(`
            INSERT INTO prefix_match_fts(id, resource_type, content, normalized_content)
            SELECT id, resource_type, content, normalized_content 
            FROM prefix_match_index
        `);
        
        const countStmt = db.prepare("SELECT COUNT(*) as count FROM prefix_match_fts");
        countStmt.step();
        const count = countStmt.getAsObject().count as number;
        countStmt.free();
        
        console.log(`Prefix matching FTS5 table populated with ${count} entries`);
    } catch (error) {
        console.error("Error populating prefix matching FTS5 table:", error);
        // Don't throw the error, just log it to prevent breaking the entire rebuild process
        console.log("Continuing with empty prefix matching FTS5 table");
    }
}

/**
 * Register custom SQL functions for prefix matching algorithms
 */
function registerPrefixMatchingFunctions(db: Database): void {
    // Prefix match scoring function
    db.create_function('prefix_score', (
        query: string,
        content: string,
        matchType: string,
        position: number,
        length: number,
        config: string
    ): number => {
        const cfg: PrefixMatchConfig = JSON.parse(config || '{}');
        const mergedConfig = { ...DEFAULT_CONFIG, ...cfg };
        
        let baseScore = 0;
        
        switch (matchType) {
            case 'exact_prefix':
                baseScore = 1.0 * mergedConfig.boostExactPrefix;
                break;
            case 'word_prefix':
                baseScore = 0.9 * mergedConfig.boostWordPrefix;
                break;
            case 'partial_prefix':
                baseScore = 0.7;
                break;
            case 'fuzzy_prefix':
                baseScore = 0.5;
                break;
            default:
                baseScore = 0.1;
        }
        
        // Apply position bonus (earlier matches score higher)
        const positionBonus = Math.max(0, 1 - (position / content.length));
        
        // Apply length bonus (longer matches score higher)
        const lengthBonus = Math.min(1, length / query.length);
        
        // Apply content length penalty for very long content
        const contentLengthPenalty = content.length > 1000 ? 0.8 : 1.0;
        
        return Math.max(0, baseScore * (1 + positionBonus * 0.3) * lengthBonus * contentLengthPenalty);
    });
    
    // Word boundary detection function
    db.create_function('is_word_boundary', (content: string, position: number): boolean => {
        if (position === 0) return true;
        if (position >= content.length) return true;
        
        const prevChar = content[position - 1];
        const currChar = content[position];
        
        const isWordChar = (char: string) => /[a-zA-Z0-9_]/.test(char);
        
        return !isWordChar(prevChar) && isWordChar(currChar);
    });
    
    // Fuzzy prefix matching function
    db.create_function('fuzzy_prefix_match', (query: string, content: string, threshold: number): number => {
        if (!query || !content) return 0;
        
        const queryLower = query.toLowerCase();
        const contentLower = content.toLowerCase();
        
        // Check for exact prefix match first
        if (contentLower.startsWith(queryLower)) {
            return 1.0;
        }
        
        // Check for fuzzy prefix match using character similarity
        const minLength = Math.min(query.length, content.length);
        let matches = 0;
        
        for (let i = 0; i < minLength; i++) {
            if (queryLower[i] === contentLower[i]) {
                matches++;
            } else {
                break; // Stop at first mismatch for prefix
            }
        }
        
        const similarity = matches / query.length;
        return similarity >= threshold ? similarity : 0;
    });
    
    // Highlight matches function
    db.create_function('highlight_prefix_match', (
        content: string,
        query: string,
        position: number,
        length: number
    ): string => {
        if (!content || !query || position < 0 || length <= 0) return content;
        
        const before = content.substring(0, position);
        const match = content.substring(position, position + length);
        const after = content.substring(position + length);
        
        return `${before}<mark>${match}</mark>${after}`;
    });
}

/**
 * Add or update content in the prefix matching index
 */
export function addToPrefixMatchIndex(
    db: Database,
    id: string,
    resourceType: string,
    content: string
): void {
    const startTime = performance.now();
    
    const normalizedContent = content.toLowerCase().trim();
    const words = extractWords(content);
    const wordPositions = extractWordPositions(content);
    const contentLength = content.length;
    const wordCount = words.length;
    
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO prefix_match_index (
            id, resource_type, content, normalized_content, words, word_positions, content_length, word_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run([
        id,
        resourceType,
        content,
        normalizedContent,
        words.join(' '),
        JSON.stringify(wordPositions),
        contentLength,
        wordCount
    ]);
    stmt.free();
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('addToPrefixMatchIndex', 'sqlite', elapsedTime);
}

/**
 * Remove content from the prefix matching index
 */
export function removeFromPrefixMatchIndex(db: Database, id: string): void {
    const stmt = db.prepare('DELETE FROM prefix_match_index WHERE id = ?');
    stmt.run([id]);
    stmt.free();
}

/**
 * Perform advanced prefix matching search
 */
export function performPrefixSearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    config: Partial<PrefixMatchConfig> = {}
): PrefixMatchResult[] {
    const startTime = performance.now();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const configJson = JSON.stringify(mergedConfig);
    
    if (query.length < mergedConfig.minPrefixLength) {
        return [];
    }
    
    // First check if the FTS5 table has any data
    const countStmt = db.prepare("SELECT COUNT(*) as count FROM prefix_match_fts");
    countStmt.step();
    const ftsCount = countStmt.getAsObject().count as number;
    countStmt.free();
    
    if (ftsCount === 0) {
        console.warn("Prefix matching FTS5 table is empty, populating it...");
        try {
            populatePrefixMatchingFTS5FromMainTable(db);
        } catch (rebuildError) {
            console.error("Failed to populate prefix matching FTS5 table:", rebuildError);
            // Fall back to non-FTS search immediately
            return performPrefixSearchFallback(db, query, resourceType, limit, mergedConfig);
        }
    }
    
    const normalizedQuery = mergedConfig.caseSensitive ? query : query.toLowerCase();
    
    try {
        // Collect results from different strategies
        const allResults: PrefixMatchResult[] = [];
        
        // Strategy 1: Exact prefix matches
        const exactSql = `
            SELECT 
                i.id, i.resource_type, i.content, i.normalized_content,
                'exact_prefix' as match_type,
                0 as match_position,
                ? as match_length,
                prefix_score(?, i.content, 'exact_prefix', 0, ?, ?) as score
            FROM prefix_match_index i
            WHERE ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ? || '%'
            ${resourceType ? 'AND i.resource_type = ?' : ''}
        `;
        
        const exactParams = [query.length, normalizedQuery, query.length, configJson, normalizedQuery];
        if (resourceType) exactParams.push(resourceType);
        
        const exactStmt = db.prepare(exactSql);
        exactStmt.bind(exactParams);
        
        while (exactStmt.step()) {
            const row = exactStmt.getAsObject();
            allResults.push({
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                matchType: row.match_type as any,
                matchPosition: row.match_position as number,
                matchLength: row.match_length as number,
                metadata: { resourceType: row.resource_type }
            });
        }
        exactStmt.free();
        
        // Strategy 2: Word boundary prefix matches
        const wordSql = `
            SELECT 
                i.id, i.resource_type, i.content, i.normalized_content,
                'word_prefix' as match_type,
                CASE 
                    WHEN ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ? || '%' THEN 0
                    ELSE INSTR(${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'}, ' ' || ? || '%') - 1
                END as match_position,
                ? as match_length,
                prefix_score(?, i.content, 'word_prefix', 
                    CASE 
                        WHEN ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ? || '%' THEN 0
                        ELSE INSTR(${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'}, ' ' || ? || '%') - 1
                    END, ?, ?) as score
            FROM prefix_match_index i
            WHERE (${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ' ' || ? || '%'
                   OR ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ? || '%')
            ${resourceType ? 'AND i.resource_type = ?' : ''}
        `;
        
        const wordParams = [normalizedQuery, normalizedQuery, query.length, normalizedQuery, normalizedQuery, normalizedQuery, query.length, configJson, normalizedQuery, normalizedQuery];
        if (resourceType) wordParams.push(resourceType);
        
        const wordStmt = db.prepare(wordSql);
        wordStmt.bind(wordParams);
        
        while (wordStmt.step()) {
            const row = wordStmt.getAsObject();
            allResults.push({
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                matchType: row.match_type as any,
                matchPosition: row.match_position as number,
                matchLength: row.match_length as number,
                metadata: { resourceType: row.resource_type }
            });
        }
        wordStmt.free();
        
        // Strategy 3: FTS5 prefix matches (using two-step approach)
        if (allResults.length < limit) {
            // Step 1: Query FTS5 table directly to get matching IDs
            const ftsStmt = db.prepare(`
                SELECT id FROM prefix_match_fts 
                WHERE content MATCH ? || '*'
                ORDER BY bm25(prefix_match_fts)
                LIMIT ?
            `);
            
            ftsStmt.bind([normalizedQuery, limit - allResults.length]);
            
            const matchingIds: string[] = [];
            while (ftsStmt.step()) {
                const row = ftsStmt.getAsObject();
                matchingIds.push(row["id"] as string);
            }
            ftsStmt.free();
            
            if (matchingIds.length > 0) {
                // Step 2: Get full data from main table using the IDs
                const placeholders = matchingIds.map(() => '?').join(',');
                let ftsSql = `
                    SELECT 
                        id, resource_type, content, normalized_content,
                        'partial_prefix' as match_type,
                        0 as match_position,
                        ? as match_length,
                        prefix_score(?, content, 'partial_prefix', 0, ?, ?) as score
                    FROM prefix_match_index
                    WHERE id IN (${placeholders})
                `;
                
                const ftsParams = [query.length, normalizedQuery, query.length, configJson, ...matchingIds];
                
                if (resourceType) {
                    ftsSql += ` AND resource_type = ?`;
                    ftsParams.push(resourceType);
                }
                
                const ftsMainStmt = db.prepare(ftsSql);
                ftsMainStmt.bind(ftsParams);
                
                while (ftsMainStmt.step()) {
                    const row = ftsMainStmt.getAsObject();
                    allResults.push({
                        id: row.id as string,
                        content: row.content as string,
                        score: row.score as number,
                        matchType: row.match_type as any,
                        matchPosition: row.match_position as number,
                        matchLength: row.match_length as number,
                        metadata: { resourceType: row.resource_type }
                    });
                }
                ftsMainStmt.free();
            }
        }
        
        // Strategy 4: Fuzzy prefix matches (if enabled)
        if (mergedConfig.enableFuzzyPrefix && allResults.length < limit) {
            const fuzzySql = `
                SELECT 
                    i.id, i.resource_type, i.content, i.normalized_content,
                    'fuzzy_prefix' as match_type,
                    0 as match_position,
                    ? as match_length,
                    prefix_score(?, i.content, 'fuzzy_prefix', 0, ?, ?) as score
                FROM prefix_match_index i
                WHERE fuzzy_prefix_match(?, ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'}, ?) > 0
                ${resourceType ? 'AND i.resource_type = ?' : ''}
            `;
            
            const fuzzyParams = [query.length, normalizedQuery, query.length, configJson, normalizedQuery, mergedConfig.fuzzyThreshold];
            if (resourceType) fuzzyParams.push(resourceType);
            
            const fuzzyStmt = db.prepare(fuzzySql);
            fuzzyStmt.bind(fuzzyParams);
            
            while (fuzzyStmt.step()) {
                const row = fuzzyStmt.getAsObject();
                allResults.push({
                    id: row.id as string,
                    content: row.content as string,
                    score: row.score as number,
                    matchType: row.match_type as any,
                    matchPosition: row.match_position as number,
                    matchLength: row.match_length as number,
                    metadata: { resourceType: row.resource_type }
                });
            }
            fuzzyStmt.free();
        }
        
        // Deduplicate and sort results
        const resultMap = new Map<string, PrefixMatchResult>();
        for (const result of allResults) {
            if (result.score > 0) {
                const existing = resultMap.get(result.id);
                if (!existing || result.score > existing.score) {
                    resultMap.set(result.id, result);
                }
            }
        }
        
        const finalResults = Array.from(resultMap.values())
            .sort((a, b) => {
                if (b.score !== a.score) return b.score - a.score;
                if (a.matchPosition !== b.matchPosition) return a.matchPosition - b.matchPosition;
                return a.content.length - b.content.length;
            })
            .slice(0, Math.min(limit, mergedConfig.maxResults));
        
        // Add highlighting if enabled
        if (mergedConfig.enableHighlighting) {
            for (const result of finalResults) {
                result.highlightedContent = highlightPrefixMatch(
                    result.content,
                    query,
                    result.matchPosition,
                    result.matchLength
                );
            }
        }
        
        const elapsedTime = performance.now() - startTime;
        trackFeatureUsage('performPrefixSearch', 'sqlite', elapsedTime);
        console.log(`Prefix search for "${query}" found ${finalResults.length} results in ${elapsedTime.toFixed(2)}ms`);
        
        return finalResults;
        
    } catch (error) {
        console.error("Error in performPrefixSearch:", error);
        // Fallback to non-FTS search if FTS fails
        return performPrefixSearchFallback(db, query, resourceType, limit, mergedConfig);
    }
}

// Fallback search function for prefix matching
function performPrefixSearchFallback(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    config: PrefixMatchConfig = DEFAULT_CONFIG
): PrefixMatchResult[] {
    const normalizedQuery = config.caseSensitive ? query : query.toLowerCase();
    const configJson = JSON.stringify(config);
    
    let fallbackSql = `
        SELECT 
            id, resource_type, content, normalized_content,
            'exact_prefix' as match_type,
            0 as match_position,
            ? as match_length,
            prefix_score(?, content, 'exact_prefix', 0, ?, ?) as score
        FROM prefix_match_index
        WHERE ${config.caseSensitive ? 'content' : 'normalized_content'} LIKE ? || '%'
    `;
    
    const fallbackParams = [query.length, normalizedQuery, query.length, configJson, normalizedQuery];
    
    if (resourceType) {
        fallbackSql += ` AND resource_type = ?`;
        fallbackParams.push(resourceType);
    }
    
    fallbackSql += ` ORDER BY score DESC, content_length ASC LIMIT ?`;
    fallbackParams.push(limit);
    
    const fallbackStmt = db.prepare(fallbackSql);
    
    try {
        fallbackStmt.bind(fallbackParams);
        const results: PrefixMatchResult[] = [];
        while (fallbackStmt.step()) {
            const row = fallbackStmt.getAsObject();
            results.push({
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                matchType: row.match_type as any,
                matchPosition: row.match_position as number,
                matchLength: row.match_length as number,
                metadata: { resourceType: row.resource_type }
            });
        }
        return results.filter(result => result.score > 0);
    } finally {
        fallbackStmt.free();
    }
}

/**
 * Perform word-boundary prefix search
 */
export function performWordPrefixSearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    caseSensitive: boolean = false
): PrefixMatchResult[] {
    const config: Partial<PrefixMatchConfig> = {
        caseSensitive,
        wordBoundary: true,
        enableFuzzyPrefix: false,
        boostWordPrefix: 2.0,
    };
    
    return performPrefixSearch(db, query, resourceType, limit, config);
}

/**
 * Perform exact prefix search
 */
export function performExactPrefixSearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    caseSensitive: boolean = false
): PrefixMatchResult[] {
    const startTime = performance.now();
    
    const normalizedQuery = caseSensitive ? query : query.toLowerCase();
    
    const sql = `
        SELECT 
            id, resource_type, content,
            'exact_prefix' as match_type,
            0 as match_position,
            ? as match_length,
            1.0 as score
        FROM prefix_match_index
        WHERE ${caseSensitive ? 'content' : 'normalized_content'} LIKE ? || '%'
        ${resourceType ? 'AND resource_type = ?' : ''}
        ORDER BY content_length ASC, content ASC
        LIMIT ?
    `;
    
    const params = [query.length, normalizedQuery];
    if (resourceType) params.push(resourceType);
    params.push(limit);
    
    const stmt = db.prepare(sql);
    const results: PrefixMatchResult[] = [];
    
    try {
        stmt.bind(params);
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            results.push({
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                matchType: row.match_type as any,
                matchPosition: row.match_position as number,
                matchLength: row.match_length as number,
                highlightedContent: highlightPrefixMatch(row.content as string, query, 0, query.length),
                metadata: { resourceType: row.resource_type }
            });
        }
    } finally {
        stmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('performExactPrefixSearch', 'sqlite', elapsedTime);
    
    return results;
}

/**
 * Get prefix matching statistics
 */
export function getPrefixMatchingStats(db: Database): {
    totalRecords: number;
    recordsByType: { [key: string]: number };
    avgContentLength: number;
    avgWordCount: number;
    indexSize: number;
} {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM prefix_match_index');
    const totalResult = totalStmt.get() as any;
    totalStmt.free();
    
    const typeStmt = db.prepare(`
        SELECT resource_type, COUNT(*) as count 
        FROM prefix_match_index 
        GROUP BY resource_type
    `);
    
    const recordsByType: { [key: string]: number } = {};
    try {
        while (typeStmt.step()) {
            const row = typeStmt.getAsObject();
            recordsByType[row.resource_type as string] = row.count as number;
        }
    } finally {
        typeStmt.free();
    }
    
    const avgStmt = db.prepare(`
        SELECT 
            AVG(content_length) as avg_content_length,
            AVG(word_count) as avg_word_count
        FROM prefix_match_index
    `);
    const avgResult = avgStmt.get() as any;
    avgStmt.free();
    
    // Calculate approximate index size
    const sizeStmt = db.prepare(`
        SELECT 
            SUM(LENGTH(content) + LENGTH(normalized_content) + LENGTH(words) + LENGTH(word_positions)) as index_size
        FROM prefix_match_index
    `);
    const sizeResult = sizeStmt.get() as any;
    sizeStmt.free();
    
    return {
        totalRecords: totalResult.count,
        recordsByType,
        avgContentLength: Math.round(avgResult.avg_content_length || 0),
        avgWordCount: Math.round(avgResult.avg_word_count || 0),
        indexSize: sizeResult.index_size || 0,
    };
}

/**
 * Bulk index content for prefix matching
 */
export function bulkIndexForPrefixMatching(
    db: Database,
    records: Array<{ id: string; resourceType: string; content: string }>
): void {
    const startTime = performance.now();
    
    db.exec('BEGIN TRANSACTION');
    
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO prefix_match_index (
                id, resource_type, content, normalized_content, words, word_positions, content_length, word_count, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        for (const record of records) {
            const normalizedContent = record.content.toLowerCase().trim();
            const words = extractWords(record.content);
            const wordPositions = extractWordPositions(record.content);
            const contentLength = record.content.length;
            const wordCount = words.length;
            
            stmt.run([
                record.id,
                record.resourceType,
                record.content,
                normalizedContent,
                words.join(' '),
                JSON.stringify(wordPositions),
                contentLength,
                wordCount
            ]);
        }
        
        stmt.free();
        db.exec('COMMIT');
        
        const elapsedTime = performance.now() - startTime;
        trackFeatureUsage('bulkIndexForPrefixMatching', 'sqlite', elapsedTime);
        console.log(`Bulk indexed ${records.length} records for prefix matching in ${elapsedTime.toFixed(2)}ms`);
        
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

/**
 * Clear prefix matching index for a specific resource type
 */
export function clearPrefixMatchingIndex(db: Database, resourceType?: string): void {
    if (resourceType) {
        const stmt = db.prepare('DELETE FROM prefix_match_index WHERE resource_type = ?');
        stmt.run([resourceType]);
        stmt.free();
    } else {
        db.exec('DELETE FROM prefix_match_index');
    }
}

// Helper functions

function extractWords(text: string): string[] {
    if (!text) return [];
    
    // Extract words using regex, preserving word boundaries
    const words = text.toLowerCase().match(/\b\w+\b/g) || [];
    return words;
}

function extractWordPositions(text: string): Array<{ word: string; position: number; length: number }> {
    if (!text) return [];
    
    const positions: Array<{ word: string; position: number; length: number }> = [];
    const regex = /\b\w+\b/g;
    let match;
    
    while ((match = regex.exec(text)) !== null) {
        positions.push({
            word: match[0].toLowerCase(),
            position: match.index,
            length: match[0].length
        });
    }
    
    return positions;
}

function highlightPrefixMatch(content: string, query: string, position: number, length: number): string {
    if (!content || !query || position < 0 || length <= 0) return content;
    
    const before = content.substring(0, position);
    const match = content.substring(position, position + length);
    const after = content.substring(position + length);
    
    return `${before}<mark>${match}</mark>${after}`;
}

/**
 * Save prefix matching database state
 */
export function savePrefixMatchingDb(db: Database): void {
    db.exec('PRAGMA optimize');
    console.log('Prefix matching database state saved');
} 