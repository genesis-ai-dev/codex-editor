import { Database } from 'sql.js-fts5';
import { trackFeatureUsage } from '../telemetry/featureUsage';

// Interface for fuzzy search results
export interface FuzzySearchResult {
    id: string;
    content: string;
    score: number;
    distance: number;
    matchType: 'exact' | 'prefix' | 'fuzzy' | 'phonetic';
    highlightedContent?: string;
    metadata?: any;
}

// Interface for fuzzy search configuration
export interface FuzzySearchConfig {
    maxDistance: number;
    minScore: number;
    enablePhonetic: boolean;
    enableNgram: boolean;
    ngramSize: number;
    boostExactMatch: number;
    boostPrefixMatch: number;
    caseSensitive: boolean;
}

// Default fuzzy search configuration
const DEFAULT_CONFIG: FuzzySearchConfig = {
    maxDistance: 3,
    minScore: 0.1,
    enablePhonetic: true,
    enableNgram: true,
    ngramSize: 3,
    boostExactMatch: 2.0,
    boostPrefixMatch: 1.5,
    caseSensitive: false,
};

/**
 * Initialize the fuzzy search database tables and functions
 */
export function initializeFuzzySearchDb(db: Database): void {
    console.log('Initializing fuzzy search database...');
    
    // Create fuzzy search index table
    db.exec(`
        CREATE TABLE IF NOT EXISTS fuzzy_search_index (
            id TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL,
            content TEXT NOT NULL,
            normalized_content TEXT NOT NULL,
            phonetic_code TEXT,
            ngrams TEXT,
            word_count INTEGER,
            char_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create FTS5 virtual table for content search
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS fuzzy_search_fts USING fts5(
            id UNINDEXED,
            resource_type UNINDEXED,
            content,
            normalized_content,
            phonetic_code,
            ngrams,
            content='fuzzy_search_index',
            content_rowid='rowid'
        );
    `);
    
    // Create triggers to keep FTS5 in sync
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS fuzzy_search_fts_insert AFTER INSERT ON fuzzy_search_index BEGIN
            INSERT INTO fuzzy_search_fts(rowid, id, resource_type, content, normalized_content, phonetic_code, ngrams)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.phonetic_code, new.ngrams);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS fuzzy_search_fts_delete AFTER DELETE ON fuzzy_search_index BEGIN
            INSERT INTO fuzzy_search_fts(fuzzy_search_fts, rowid, id, resource_type, content, normalized_content, phonetic_code, ngrams)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.phonetic_code, old.ngrams);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS fuzzy_search_fts_update AFTER UPDATE ON fuzzy_search_index BEGIN
            INSERT INTO fuzzy_search_fts(fuzzy_search_fts, rowid, id, resource_type, content, normalized_content, phonetic_code, ngrams)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.phonetic_code, old.ngrams);
            INSERT INTO fuzzy_search_fts(rowid, id, resource_type, content, normalized_content, phonetic_code, ngrams)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.phonetic_code, new.ngrams);
        END;
    `);
    
    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_fuzzy_search_resource_type ON fuzzy_search_index(resource_type);
        CREATE INDEX IF NOT EXISTS idx_fuzzy_search_normalized ON fuzzy_search_index(normalized_content);
        CREATE INDEX IF NOT EXISTS idx_fuzzy_search_phonetic ON fuzzy_search_index(phonetic_code);
        CREATE INDEX IF NOT EXISTS idx_fuzzy_search_word_count ON fuzzy_search_index(word_count);
    `);
    
    // Register custom SQL functions for fuzzy matching
    registerFuzzySearchFunctions(db);
    
    console.log('Fuzzy search database initialized successfully');
}

/**
 * Register custom SQL functions for fuzzy search algorithms
 */
function registerFuzzySearchFunctions(db: Database): void {
    // Levenshtein distance function
    db.create_function('levenshtein', (str1: string, str2: string): number => {
        if (!str1 || !str2) return Math.max(str1?.length || 0, str2?.length || 0);
        
        const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));
        
        for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
        for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;
        
        for (let j = 1; j <= str2.length; j++) {
            for (let i = 1; i <= str1.length; i++) {
                const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
                matrix[j][i] = Math.min(
                    matrix[j][i - 1] + 1,     // deletion
                    matrix[j - 1][i] + 1,     // insertion
                    matrix[j - 1][i - 1] + indicator // substitution
                );
            }
        }
        
        return matrix[str2.length][str1.length];
    });
    
    // Jaro-Winkler similarity function
    db.create_function('jaro_winkler', (str1: string, str2: string): number => {
        if (!str1 || !str2) return 0;
        if (str1 === str2) return 1;
        
        const len1 = str1.length;
        const len2 = str2.length;
        const matchWindow = Math.floor(Math.max(len1, len2) / 2) - 1;
        
        const str1Matches = new Array(len1).fill(false);
        const str2Matches = new Array(len2).fill(false);
        
        let matches = 0;
        let transpositions = 0;
        
        // Find matches
        for (let i = 0; i < len1; i++) {
            const start = Math.max(0, i - matchWindow);
            const end = Math.min(i + matchWindow + 1, len2);
            
            for (let j = start; j < end; j++) {
                if (str2Matches[j] || str1[i] !== str2[j]) continue;
                str1Matches[i] = str2Matches[j] = true;
                matches++;
                break;
            }
        }
        
        if (matches === 0) return 0;
        
        // Find transpositions
        let k = 0;
        for (let i = 0; i < len1; i++) {
            if (!str1Matches[i]) continue;
            while (!str2Matches[k]) k++;
            if (str1[i] !== str2[k]) transpositions++;
            k++;
        }
        
        const jaro = (matches / len1 + matches / len2 + (matches - transpositions / 2) / matches) / 3;
        
        // Winkler modification
        let prefix = 0;
        for (let i = 0; i < Math.min(len1, len2, 4); i++) {
            if (str1[i] === str2[i]) prefix++;
            else break;
        }
        
        return jaro + (0.1 * prefix * (1 - jaro));
    });
    
    // Soundex function for phonetic matching
    db.create_function('soundex', (str: string): string => {
        if (!str) return '';
        
        str = str.toUpperCase().replace(/[^A-Z]/g, '');
        if (!str) return '';
        
        const soundexMap: { [key: string]: string } = {
            'B': '1', 'F': '1', 'P': '1', 'V': '1',
            'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
            'D': '3', 'T': '3',
            'L': '4',
            'M': '5', 'N': '5',
            'R': '6'
        };
        
        let soundex = str[0];
        let prevCode = soundexMap[str[0]] || '';
        
        for (let i = 1; i < str.length && soundex.length < 4; i++) {
            const code = soundexMap[str[i]] || '';
            if (code && code !== prevCode) {
                soundex += code;
            }
            if (code) prevCode = code;
        }
        
        return soundex.padEnd(4, '0');
    });
    
    // N-gram generation function
    db.create_function('generate_ngrams', (str: string, n: number = 3): string => {
        if (!str || str.length < n) return str;
        
        const ngrams: string[] = [];
        const normalized = str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
        
        for (let i = 0; i <= normalized.length - n; i++) {
            ngrams.push(normalized.substr(i, n));
        }
        
        return ngrams.join(' ');
    });
    
    // Fuzzy score calculation function
    db.create_function('fuzzy_score', (
        query: string,
        content: string,
        matchType: string,
        distance: number,
        config: string
    ): number => {
        const cfg: FuzzySearchConfig = JSON.parse(config || '{}');
        const mergedConfig = { ...DEFAULT_CONFIG, ...cfg };
        
        let baseScore = 0;
        
        switch (matchType) {
            case 'exact':
                baseScore = 1.0 * mergedConfig.boostExactMatch;
                break;
            case 'prefix':
                baseScore = 0.8 * mergedConfig.boostPrefixMatch;
                break;
            case 'fuzzy':
                const maxLen = Math.max(query.length, content.length);
                baseScore = Math.max(0, (maxLen - distance) / maxLen);
                break;
            case 'phonetic':
                baseScore = 0.6;
                break;
            default:
                baseScore = 0.1;
        }
        
        // Apply length penalty for very different lengths
        const lengthRatio = Math.min(query.length, content.length) / Math.max(query.length, content.length);
        const lengthPenalty = lengthRatio < 0.5 ? 0.5 : 1.0;
        
        return Math.max(0, baseScore * lengthPenalty);
    });
}

/**
 * Add or update content in the fuzzy search index
 */
export function addToFuzzySearchIndex(
    db: Database,
    id: string,
    resourceType: string,
    content: string
): void {
    const startTime = performance.now();
    
    const normalizedContent = content.toLowerCase().trim();
    const phoneticCode = generatePhoneticCode(content);
    const ngrams = generateNgrams(content, 3);
    const wordCount = content.split(/\s+/).length;
    const charCount = content.length;
    
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO fuzzy_search_index 
        (id, resource_type, content, normalized_content, phonetic_code, ngrams, word_count, char_count, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run([id, resourceType, content, normalizedContent, phoneticCode, ngrams, wordCount, charCount]);
    stmt.free();
    
    const endTime = performance.now();
    trackFeatureUsage('fuzzy_search_index_add', 'sqlite', endTime - startTime);
}

/**
 * Helper function to generate phonetic code using Soundex algorithm
 */
function generatePhoneticCode(str: string): string {
    if (!str) return '';
    
    str = str.toUpperCase().replace(/[^A-Z]/g, '');
    if (!str) return '';
    
    const soundexMap: { [key: string]: string } = {
        'B': '1', 'F': '1', 'P': '1', 'V': '1',
        'C': '2', 'G': '2', 'J': '2', 'K': '2', 'Q': '2', 'S': '2', 'X': '2', 'Z': '2',
        'D': '3', 'T': '3',
        'L': '4',
        'M': '5', 'N': '5',
        'R': '6'
    };
    
    let soundex = str[0];
    let prevCode = soundexMap[str[0]] || '';
    
    for (let i = 1; i < str.length && soundex.length < 4; i++) {
        const code = soundexMap[str[i]] || '';
        if (code && code !== prevCode) {
            soundex += code;
        }
        if (code) prevCode = code;
    }
    
    return soundex.padEnd(4, '0');
}

/**
 * Helper function to generate n-grams from text
 */
function generateNgrams(str: string, n: number = 3): string {
    if (!str || str.length < n) return str;
    
    const ngrams: string[] = [];
    const normalized = str.toLowerCase().replace(/[^a-z0-9\s]/g, '');
    
    for (let i = 0; i <= normalized.length - n; i++) {
        ngrams.push(normalized.substr(i, n));
    }
    
    return ngrams.join(' ');
}

/**
 * Perform fuzzy search on the indexed content
 */
export function performFuzzySearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    config: Partial<FuzzySearchConfig> = {}
): FuzzySearchResult[] {
    const startTime = performance.now();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    
    if (!query.trim()) return [];
    
    const normalizedQuery = mergedConfig.caseSensitive ? query : query.toLowerCase();
    const results: FuzzySearchResult[] = [];
    
    // Exact match search
    let exactSql = `
        SELECT id, content, resource_type, 1.0 * ? as score, 0 as distance, 'exact' as match_type
        FROM fuzzy_search_index 
        WHERE ${mergedConfig.caseSensitive ? 'content' : 'normalized_content'} = ?
    `;
    
    const exactParams: any[] = [mergedConfig.boostExactMatch, normalizedQuery];
    
    if (resourceType) {
        exactSql += ` AND resource_type = ?`;
        exactParams.push(resourceType);
    }
    
    exactSql += ` LIMIT ?`;
    exactParams.push(Math.min(limit, 50));
    
    const exactStmt = db.prepare(exactSql);
    exactStmt.bind(exactParams);
    
    while (exactStmt.step()) {
        const row = exactStmt.getAsObject();
        results.push({
            id: row.id as string,
            content: row.content as string,
            score: row.score as number,
            distance: row.distance as number,
            matchType: row.match_type as 'exact' | 'prefix' | 'fuzzy' | 'phonetic'
        });
    }
    exactStmt.free();
    
    // FTS5 search for partial matches
    if (results.length < limit) {
        let ftsSql = `
            SELECT f.id, f.content, f.resource_type, 
                   fuzzy_score(?, f.content, 'fuzzy', levenshtein(?, f.normalized_content), ?) as score,
                   levenshtein(?, f.normalized_content) as distance,
                   'fuzzy' as match_type
            FROM fuzzy_search_fts fts
            JOIN fuzzy_search_index f ON f.rowid = fts.rowid
            WHERE fts.content MATCH ?
        `;
        
        const ftsParams: any[] = [];
        const ftsQuery = normalizedQuery.split(' ').map(term => `"${term}"*`).join(' OR ');
        const configStr = JSON.stringify(mergedConfig);
        
        ftsParams.push(normalizedQuery, normalizedQuery, configStr, normalizedQuery, ftsQuery);
        
        if (resourceType) {
            ftsSql += ` AND f.resource_type = ?`;
            ftsParams.push(resourceType);
        }
        
        ftsSql += ` AND levenshtein(?, f.normalized_content) <= ? ORDER BY score DESC LIMIT ?`;
        ftsParams.push(normalizedQuery, mergedConfig.maxDistance, limit - results.length);
        
        const ftsStmt = db.prepare(ftsSql);
        ftsStmt.bind(ftsParams);
        
        while (ftsStmt.step()) {
            const row = ftsStmt.getAsObject();
            results.push({
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                distance: row.distance as number,
                matchType: row.match_type as 'exact' | 'prefix' | 'fuzzy' | 'phonetic'
            });
        }
        ftsStmt.free();
    }
    
    const endTime = performance.now();
    trackFeatureUsage('fuzzy_search_perform', 'sqlite', endTime - startTime);
    
    return results
        .filter(result => result.score >= mergedConfig.minScore)
        .sort((a, b) => b.score - a.score)
        .slice(0, limit);
}

/**
 * Perform similarity search using Jaro-Winkler algorithm
 */
export function performSimilaritySearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    minSimilarity: number = 0.5
): FuzzySearchResult[] {
    const startTime = performance.now();
    
    if (!query.trim()) return [];
    
    const normalizedQuery = query.toLowerCase();
    
    let sql = `
        SELECT id, content, resource_type,
               jaro_winkler(?, normalized_content) as score,
               0 as distance,
               'fuzzy' as match_type
        FROM fuzzy_search_index 
        WHERE jaro_winkler(?, normalized_content) >= ?
    `;
    
    const params: any[] = [normalizedQuery, normalizedQuery, minSimilarity];
    
    if (resourceType) {
        sql += ` AND resource_type = ?`;
        params.push(resourceType);
    }
    
    sql += ` ORDER BY score DESC LIMIT ?`;
    params.push(Math.min(limit, 50));
    
    const stmt = db.prepare(sql);
    stmt.bind(params);
    
    const results: FuzzySearchResult[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            id: row.id as string,
            content: row.content as string,
            score: row.score as number,
            distance: row.distance as number,
            matchType: row.match_type as 'exact' | 'prefix' | 'fuzzy' | 'phonetic'
        });
    }
    stmt.free();
    
    const endTime = performance.now();
    trackFeatureUsage('similarity_search_perform', 'sqlite', endTime - startTime);
    
    return results;
}

/**
 * Get fuzzy search statistics
 */
export function getFuzzySearchStats(db: Database): any {
    const stmt = db.prepare(`
        SELECT 
            COUNT(*) as total_entries,
            COUNT(DISTINCT resource_type) as resource_types,
            AVG(word_count) as avg_word_count,
            AVG(char_count) as avg_char_count,
            MIN(created_at) as oldest_entry,
            MAX(updated_at) as newest_entry
        FROM fuzzy_search_index
    `);
    
    let result = {};
    if (stmt.step()) {
        result = stmt.getAsObject();
    }
    stmt.free();
    
    return result;
}

/**
 * Clear entries from the fuzzy search index
 */
export function clearFuzzySearchIndex(db: Database, resourceType?: string): void {
    const startTime = performance.now();
    
    if (resourceType) {
        const stmt = db.prepare('DELETE FROM fuzzy_search_index WHERE resource_type = ?');
        stmt.bind([resourceType]);
        stmt.step();
        stmt.free();
    } else {
        db.exec('DELETE FROM fuzzy_search_index');
    }
    
    const endTime = performance.now();
    trackFeatureUsage('fuzzy_search_clear', 'sqlite', endTime - startTime);
}

/**
 * Save fuzzy search database (placeholder for compatibility)
 */
export function saveFuzzySearchDb(db: Database): void {
    // This function exists for compatibility with existing code
    // The database is automatically persisted when using sql.js-fts5
    console.log('Fuzzy search database state saved');
}