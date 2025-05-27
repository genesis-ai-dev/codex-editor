import { Database } from 'sql.js';
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
        CREATE VIRTUAL TABLE IF NOT EXISTS prefix_match_fts USING fts5(
            id UNINDEXED,
            resource_type UNINDEXED,
            content,
            normalized_content,
            words,
            content='prefix_match_index',
            content_rowid='rowid',
            prefix='2,3,4,5,6,7,8,9,10'
        );
    `);
    
    // Create triggers to keep FTS5 in sync
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS prefix_match_fts_insert AFTER INSERT ON prefix_match_index BEGIN
            INSERT INTO prefix_match_fts(rowid, id, resource_type, content, normalized_content, words)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.words);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS prefix_match_fts_delete AFTER DELETE ON prefix_match_index BEGIN
            INSERT INTO prefix_match_fts(prefix_match_fts, rowid, id, resource_type, content, normalized_content, words)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.words);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS prefix_match_fts_update AFTER UPDATE ON prefix_match_index BEGIN
            INSERT INTO prefix_match_fts(prefix_match_fts, rowid, id, resource_type, content, normalized_content, words)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.words);
            INSERT INTO prefix_match_fts(rowid, id, resource_type, content, normalized_content, words)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.words);
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
    
    const normalizedQuery = mergedConfig.caseSensitive ? query : query.toLowerCase();
    
    let sql = `
        WITH prefix_matches AS (
            -- Exact prefix matches
            SELECT 
                i.id, i.resource_type, i.content, i.normalized_content,
                'exact_prefix' as match_type,
                0 as match_position,
                ? as match_length,
                prefix_score(?, i.content, 'exact_prefix', 0, ?, ?) as score
            FROM prefix_match_index i
            WHERE ${mergedConfig.caseSensitive ? 'i.content' : 'i.normalized_content'} LIKE ? || '%'
            ${resourceType ? 'AND i.resource_type = ?' : ''}
            
            UNION ALL
            
            -- Word boundary prefix matches
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
            
            UNION ALL
            
            -- FTS5 prefix matches
            SELECT 
                i.id, i.resource_type, i.content, i.normalized_content,
                'partial_prefix' as match_type,
                0 as match_position,
                ? as match_length,
                prefix_score(?, i.content, 'partial_prefix', 0, ?, ?) as score
            FROM prefix_match_index i
            JOIN prefix_match_fts fts ON i.rowid = fts.rowid
            WHERE fts.content MATCH ? || '*'
            ${resourceType ? 'AND i.resource_type = ?' : ''}
    `;
    
    if (mergedConfig.enableFuzzyPrefix) {
        sql += `
            UNION ALL
            
            -- Fuzzy prefix matches
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
    }
    
    sql += `
        )
        SELECT DISTINCT id, resource_type, content, match_type, match_position, match_length, score
        FROM prefix_matches
        WHERE score > 0
        ORDER BY score DESC, match_position ASC, length(content) ASC
        LIMIT ?
    `;
    
    const stmt = db.prepare(sql);
    const params: any[] = [];
    
    // Exact prefix match parameters
    params.push(query.length, normalizedQuery, query.length, configJson, normalizedQuery);
    if (resourceType) params.push(resourceType);
    
    // Word boundary prefix match parameters
    params.push(normalizedQuery, normalizedQuery, query.length, normalizedQuery, normalizedQuery, normalizedQuery, query.length, configJson, normalizedQuery, normalizedQuery);
    if (resourceType) params.push(resourceType);
    
    // FTS5 prefix match parameters
    params.push(query.length, normalizedQuery, query.length, configJson, normalizedQuery);
    if (resourceType) params.push(resourceType);
    
    // Fuzzy prefix match parameters (if enabled)
    if (mergedConfig.enableFuzzyPrefix) {
        params.push(query.length, normalizedQuery, query.length, configJson, normalizedQuery, mergedConfig.fuzzyThreshold);
        if (resourceType) params.push(resourceType);
    }
    
    // Final parameters
    params.push(Math.min(limit, mergedConfig.maxResults));
    
    const results: PrefixMatchResult[] = [];
    try {
        stmt.bind(params);
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const result: PrefixMatchResult = {
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                matchType: row.match_type as any,
                matchPosition: row.match_position as number,
                matchLength: row.match_length as number,
                metadata: { resourceType: row.resource_type }
            };
            
            if (mergedConfig.enableHighlighting) {
                result.highlightedContent = highlightPrefixMatch(
                    result.content,
                    query,
                    result.matchPosition,
                    result.matchLength
                );
            }
            
            results.push(result);
        }
    } finally {
        stmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('performPrefixSearch', 'sqlite', elapsedTime);
    console.log(`Prefix search for "${query}" found ${results.length} results in ${elapsedTime.toFixed(2)}ms`);
    
    return results;
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