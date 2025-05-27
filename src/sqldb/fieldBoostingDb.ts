import { Database } from 'sql.js';
import { trackFeatureUsage } from '../telemetry/featureUsage';

// Interface for field boosting results
export interface FieldBoostResult {
    id: string;
    content: string;
    score: number;
    fieldMatches: { [field: string]: number };
    boostedScore: number;
    matchedFields: string[];
    highlightedContent?: string;
    metadata?: any;
}

// Interface for field boosting configuration
export interface FieldBoostConfig {
    fieldBoosts: { [field: string]: number };
    combineWith: 'AND' | 'OR';
    normalizeScores: boolean;
    minScore: number;
    maxResults: number;
    enableHighlighting: boolean;
    caseSensitive: boolean;
    fuzzy: boolean;
    fuzziness: number;
    prefix: boolean;
}

// Default field boosting configuration
const DEFAULT_CONFIG: FieldBoostConfig = {
    fieldBoosts: {},
    combineWith: 'OR',
    normalizeScores: true,
    minScore: 0.1,
    maxResults: 100,
    enableHighlighting: true,
    caseSensitive: false,
    fuzzy: false,
    fuzziness: 0.2,
    prefix: false,
};

/**
 * Initialize the field boosting database tables and functions
 */
export function initializeFieldBoostingDb(db: Database): void {
    console.log('Initializing field boosting database...');
    
    // Create field boosting index table
    db.exec(`
        CREATE TABLE IF NOT EXISTS field_boost_index (
            id TEXT PRIMARY KEY,
            resource_type TEXT NOT NULL,
            content TEXT NOT NULL,
            normalized_content TEXT NOT NULL,
            field_data TEXT NOT NULL,
            field_names TEXT NOT NULL,
            content_length INTEGER,
            field_count INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Create FTS5 virtual table for field-aware search
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS field_boost_fts USING fts5(
            id UNINDEXED,
            resource_type UNINDEXED,
            content,
            normalized_content,
            field_data,
            field_names,
            content='field_boost_index',
            content_rowid='rowid'
        );
    `);
    
    // Create field-specific search tables for optimized field queries
    db.exec(`
        CREATE TABLE IF NOT EXISTS field_specific_index (
            id TEXT NOT NULL,
            resource_type TEXT NOT NULL,
            field_name TEXT NOT NULL,
            field_value TEXT NOT NULL,
            normalized_value TEXT NOT NULL,
            field_position INTEGER,
            field_length INTEGER,
            PRIMARY KEY (id, field_name)
        );
    `);
    
    // Create FTS5 virtual table for field-specific search
    db.exec(`
        CREATE VIRTUAL TABLE IF NOT EXISTS field_specific_fts USING fts5(
            id UNINDEXED,
            resource_type UNINDEXED,
            field_name UNINDEXED,
            field_value,
            normalized_value,
            content='field_specific_index',
            content_rowid='rowid'
        );
    `);
    
    // Create triggers to keep FTS5 in sync
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_boost_fts_insert AFTER INSERT ON field_boost_index BEGIN
            INSERT INTO field_boost_fts(rowid, id, resource_type, content, normalized_content, field_data, field_names)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.field_data, new.field_names);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_boost_fts_delete AFTER DELETE ON field_boost_index BEGIN
            INSERT INTO field_boost_fts(field_boost_fts, rowid, id, resource_type, content, normalized_content, field_data, field_names)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.field_data, old.field_names);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_boost_fts_update AFTER UPDATE ON field_boost_index BEGIN
            INSERT INTO field_boost_fts(field_boost_fts, rowid, id, resource_type, content, normalized_content, field_data, field_names)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.content, old.normalized_content, old.field_data, old.field_names);
            INSERT INTO field_boost_fts(rowid, id, resource_type, content, normalized_content, field_data, field_names)
            VALUES (new.rowid, new.id, new.resource_type, new.content, new.normalized_content, new.field_data, new.field_names);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_specific_fts_insert AFTER INSERT ON field_specific_index BEGIN
            INSERT INTO field_specific_fts(rowid, id, resource_type, field_name, field_value, normalized_value)
            VALUES (new.rowid, new.id, new.resource_type, new.field_name, new.field_value, new.normalized_value);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_specific_fts_delete AFTER DELETE ON field_specific_index BEGIN
            INSERT INTO field_specific_fts(field_specific_fts, rowid, id, resource_type, field_name, field_value, normalized_value)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.field_name, old.field_value, old.normalized_value);
        END;
    `);
    
    db.exec(`
        CREATE TRIGGER IF NOT EXISTS field_specific_fts_update AFTER UPDATE ON field_specific_index BEGIN
            INSERT INTO field_specific_fts(field_specific_fts, rowid, id, resource_type, field_name, field_value, normalized_value)
            VALUES ('delete', old.rowid, old.id, old.resource_type, old.field_name, old.field_value, old.normalized_value);
            INSERT INTO field_specific_fts(rowid, id, resource_type, field_name, field_value, normalized_value)
            VALUES (new.rowid, new.id, new.resource_type, new.field_name, new.field_value, new.normalized_value);
        END;
    `);
    
    // Create indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_field_boost_resource_type ON field_boost_index(resource_type);
        CREATE INDEX IF NOT EXISTS idx_field_boost_content_length ON field_boost_index(content_length);
        CREATE INDEX IF NOT EXISTS idx_field_boost_field_count ON field_boost_index(field_count);
        CREATE INDEX IF NOT EXISTS idx_field_specific_resource_type ON field_specific_index(resource_type);
        CREATE INDEX IF NOT EXISTS idx_field_specific_field_name ON field_specific_index(field_name);
        CREATE INDEX IF NOT EXISTS idx_field_specific_composite ON field_specific_index(resource_type, field_name);
    `);
    
    // Register custom SQL functions for field boosting algorithms
    registerFieldBoostingFunctions(db);
    
    console.log('Field boosting database initialized successfully');
}

/**
 * Register custom SQL functions for field boosting algorithms
 */
function registerFieldBoostingFunctions(db: Database): void {
    // Field boost scoring function
    db.create_function('field_boost_score', (
        query: string,
        fieldData: string,
        fieldBoosts: string,
        combineWith: string,
        normalizeScores: boolean
    ): number => {
        try {
            const fields = JSON.parse(fieldData);
            const boosts = JSON.parse(fieldBoosts);
            
            let totalScore = 0;
            let matchedFields = 0;
            const queryLower = query.toLowerCase();
            
            for (const [fieldName, fieldValue] of Object.entries(fields)) {
                if (typeof fieldValue !== 'string') continue;
                
                const fieldValueLower = fieldValue.toLowerCase();
                const boost = boosts[fieldName] || 1.0;
                
                // Calculate field match score
                let fieldScore = 0;
                
                // Exact match
                if (fieldValueLower === queryLower) {
                    fieldScore = 1.0;
                } 
                // Contains match
                else if (fieldValueLower.includes(queryLower)) {
                    const position = fieldValueLower.indexOf(queryLower);
                    const positionBonus = Math.max(0, 1 - (position / fieldValue.length));
                    const lengthBonus = queryLower.length / fieldValue.length;
                    fieldScore = 0.8 * (1 + positionBonus * 0.3) * lengthBonus;
                }
                // Prefix match
                else if (fieldValueLower.startsWith(queryLower)) {
                    fieldScore = 0.9 * (queryLower.length / fieldValue.length);
                }
                
                if (fieldScore > 0) {
                    const boostedScore = fieldScore * boost;
                    
                    if (combineWith === 'AND') {
                        totalScore = matchedFields === 0 ? boostedScore : Math.min(totalScore, boostedScore);
                    } else {
                        totalScore += boostedScore;
                    }
                    matchedFields++;
                }
            }
            
            // For AND combination, require at least one match
            if (combineWith === 'AND' && matchedFields === 0) {
                return 0;
            }
            
            // Normalize scores if requested
            if (normalizeScores && matchedFields > 0) {
                totalScore = combineWith === 'OR' ? totalScore / matchedFields : totalScore;
            }
            
            return Math.max(0, totalScore);
        } catch (error) {
            console.error('Error in field_boost_score:', error);
            return 0;
        }
    });
    
    // Field match detection function
    db.create_function('get_matched_fields', (
        query: string,
        fieldData: string,
        minScore: number
    ): string => {
        try {
            const fields = JSON.parse(fieldData);
            const matchedFields: string[] = [];
            const queryLower = query.toLowerCase();
            
            for (const [fieldName, fieldValue] of Object.entries(fields)) {
                if (typeof fieldValue !== 'string') continue;
                
                const fieldValueLower = fieldValue.toLowerCase();
                
                // Check if field matches with minimum score
                if (fieldValueLower.includes(queryLower) || 
                    fieldValueLower.startsWith(queryLower) ||
                    fieldValueLower === queryLower) {
                    matchedFields.push(fieldName);
                }
            }
            
            return JSON.stringify(matchedFields);
        } catch (error) {
            console.error('Error in get_matched_fields:', error);
            return '[]';
        }
    });
    
    // Field-specific fuzzy matching function
    db.create_function('fuzzy_field_match', (
        query: string,
        fieldValue: string,
        fuzziness: number
    ): number => {
        if (!query || !fieldValue) return 0;
        
        const queryLower = query.toLowerCase();
        const fieldLower = fieldValue.toLowerCase();
        
        // Exact match
        if (queryLower === fieldLower) return 1.0;
        
        // Calculate Levenshtein distance for fuzzy matching
        const distance = levenshteinDistance(queryLower, fieldLower);
        const maxLength = Math.max(queryLower.length, fieldLower.length);
        const similarity = 1 - (distance / maxLength);
        
        return similarity >= fuzziness ? similarity : 0;
    });
    
    // Highlight field matches function
    db.create_function('highlight_field_matches', (
        content: string,
        query: string,
        fieldData: string
    ): string => {
        try {
            const fields = JSON.parse(fieldData);
            let highlightedContent = content;
            const queryLower = query.toLowerCase();
            
            for (const [fieldName, fieldValue] of Object.entries(fields)) {
                if (typeof fieldValue !== 'string') continue;
                
                const fieldValueLower = fieldValue.toLowerCase();
                if (fieldValueLower.includes(queryLower)) {
                    const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
                    highlightedContent = highlightedContent.replace(regex, '<mark>$1</mark>');
                }
            }
            
            return highlightedContent;
        } catch (error) {
            console.error('Error in highlight_field_matches:', error);
            return content;
        }
    });
}

/**
 * Add or update content in the field boosting index
 */
export function addToFieldBoostIndex(
    db: Database,
    id: string,
    resourceType: string,
    content: string,
    fields: { [key: string]: any }
): void {
    const startTime = performance.now();
    
    const normalizedContent = content.toLowerCase().trim();
    const fieldData = JSON.stringify(fields);
    const fieldNames = Object.keys(fields).join(' ');
    const contentLength = content.length;
    const fieldCount = Object.keys(fields).length;
    
    // Insert into main index
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO field_boost_index (
            id, resource_type, content, normalized_content, field_data, field_names, content_length, field_count, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
    `);
    
    stmt.run([
        id,
        resourceType,
        content,
        normalizedContent,
        fieldData,
        fieldNames,
        contentLength,
        fieldCount
    ]);
    stmt.free();
    
    // Insert field-specific entries
    const fieldStmt = db.prepare(`
        INSERT OR REPLACE INTO field_specific_index (
            id, resource_type, field_name, field_value, normalized_value, field_position, field_length
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    let position = 0;
    for (const [fieldName, fieldValue] of Object.entries(fields)) {
        if (fieldValue != null) {
            const valueStr = String(fieldValue);
            const normalizedValue = valueStr.toLowerCase().trim();
            
            fieldStmt.run([
                id,
                resourceType,
                fieldName,
                valueStr,
                normalizedValue,
                position,
                valueStr.length
            ]);
            position++;
        }
    }
    fieldStmt.free();
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('addToFieldBoostIndex', 'sqlite', elapsedTime);
}

/**
 * Remove content from the field boosting index
 */
export function removeFromFieldBoostIndex(db: Database, id: string): void {
    const stmt1 = db.prepare('DELETE FROM field_boost_index WHERE id = ?');
    stmt1.run([id]);
    stmt1.free();
    
    const stmt2 = db.prepare('DELETE FROM field_specific_index WHERE id = ?');
    stmt2.run([id]);
    stmt2.free();
}

/**
 * Perform advanced field boosting search
 */
export function performFieldBoostSearch(
    db: Database,
    query: string,
    resourceType?: string,
    limit: number = 50,
    config: Partial<FieldBoostConfig> = {}
): FieldBoostResult[] {
    const startTime = performance.now();
    const mergedConfig = { ...DEFAULT_CONFIG, ...config };
    const fieldBoostsJson = JSON.stringify(mergedConfig.fieldBoosts);
    
    if (!query.trim()) {
        return [];
    }
    
    const normalizedQuery = mergedConfig.caseSensitive ? query : query.toLowerCase();
    
    let sql = `
        WITH field_matches AS (
            SELECT 
                i.id, i.resource_type, i.content, i.field_data,
                field_boost_score(?, i.field_data, ?, ?, ?) as base_score,
                get_matched_fields(?, i.field_data, ?) as matched_fields
            FROM field_boost_index i
            WHERE 1=1
            ${resourceType ? 'AND i.resource_type = ?' : ''}
        ),
        scored_results AS (
            SELECT 
                id, resource_type, content, field_data, matched_fields,
                base_score,
                base_score as boosted_score
            FROM field_matches
            WHERE base_score >= ?
        )
        SELECT 
            id, resource_type, content, field_data, matched_fields, base_score, boosted_score
        FROM scored_results
        ORDER BY boosted_score DESC, length(content) ASC
        LIMIT ?
    `;
    
    const stmt = db.prepare(sql);
    const params: any[] = [
        normalizedQuery,
        fieldBoostsJson,
        mergedConfig.combineWith,
        mergedConfig.normalizeScores,
        normalizedQuery,
        mergedConfig.minScore
    ];
    
    if (resourceType) params.push(resourceType);
    params.push(mergedConfig.minScore);
    params.push(Math.min(limit, mergedConfig.maxResults));
    
    const results: FieldBoostResult[] = [];
    try {
        stmt.bind(params);
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const fieldData = JSON.parse(row.field_data as string);
            const matchedFields = JSON.parse(row.matched_fields as string);
            
            // Calculate field-specific match scores
            const fieldMatches: { [field: string]: number } = {};
            for (const fieldName of matchedFields) {
                if (fieldData[fieldName]) {
                    const fieldValue = String(fieldData[fieldName]).toLowerCase();
                    const queryLower = normalizedQuery.toLowerCase();
                    
                    if (fieldValue.includes(queryLower)) {
                        const position = fieldValue.indexOf(queryLower);
                        const positionBonus = Math.max(0, 1 - (position / fieldValue.length));
                        const lengthBonus = queryLower.length / fieldValue.length;
                        fieldMatches[fieldName] = 0.8 * (1 + positionBonus * 0.3) * lengthBonus;
                    }
                }
            }
            
            const result: FieldBoostResult = {
                id: row.id as string,
                content: row.content as string,
                score: row.base_score as number,
                fieldMatches,
                boostedScore: row.boosted_score as number,
                matchedFields,
                metadata: { resourceType: row.resource_type }
            };
            
            if (mergedConfig.enableHighlighting) {
                result.highlightedContent = highlightFieldMatches(
                    result.content,
                    query,
                    fieldData
                );
            }
            
            results.push(result);
        }
    } finally {
        stmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('performFieldBoostSearch', 'sqlite', elapsedTime);
    console.log(`Field boost search for "${query}" found ${results.length} results in ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

/**
 * Perform field-specific search with boosting
 */
export function performFieldSpecificSearch(
    db: Database,
    query: string,
    fieldName: string,
    boost: number = 1.0,
    resourceType?: string,
    limit: number = 50,
    fuzzy: boolean = false,
    fuzziness: number = 0.2
): FieldBoostResult[] {
    const startTime = performance.now();
    
    const normalizedQuery = query.toLowerCase();
    
    let sql = `
        SELECT 
            fsi.id, fsi.resource_type, fbi.content, fbi.field_data,
            CASE 
                WHEN fsi.normalized_value = ? THEN 1.0 * ?
                WHEN fsi.normalized_value LIKE ? || '%' THEN 0.9 * ?
                WHEN fsi.normalized_value LIKE '%' || ? || '%' THEN 0.7 * ?
                ${fuzzy ? 'WHEN fuzzy_field_match(?, fsi.field_value, ?) > 0 THEN fuzzy_field_match(?, fsi.field_value, ?) * ? * 0.5' : ''}
                ELSE 0
            END as score
        FROM field_specific_index fsi
        JOIN field_boost_index fbi ON fsi.id = fbi.id
        WHERE fsi.field_name = ?
        ${resourceType ? 'AND fsi.resource_type = ?' : ''}
        AND (
            fsi.normalized_value = ? OR
            fsi.normalized_value LIKE ? || '%' OR
            fsi.normalized_value LIKE '%' || ? || '%'
            ${fuzzy ? 'OR fuzzy_field_match(?, fsi.field_value, ?) > 0' : ''}
        )
        ORDER BY score DESC, length(fsi.field_value) ASC
        LIMIT ?
    `;
    
    const stmt = db.prepare(sql);
    const params: any[] = [
        normalizedQuery, boost,  // exact match
        normalizedQuery, boost,  // prefix match
        normalizedQuery, boost   // contains match
    ];
    
    if (fuzzy) {
        params.push(normalizedQuery, fuzziness, normalizedQuery, fuzziness, boost);
    }
    
    params.push(fieldName);
    if (resourceType) params.push(resourceType);
    
    params.push(normalizedQuery, normalizedQuery, normalizedQuery);
    if (fuzzy) {
        params.push(normalizedQuery, fuzziness);
    }
    params.push(limit);
    
    const results: FieldBoostResult[] = [];
    try {
        stmt.bind(params);
        
        while (stmt.step()) {
            const row = stmt.getAsObject();
            const fieldData = JSON.parse(row.field_data as string);
            
            const result: FieldBoostResult = {
                id: row.id as string,
                content: row.content as string,
                score: row.score as number,
                fieldMatches: { [fieldName]: row.score as number },
                boostedScore: row.score as number,
                matchedFields: [fieldName],
                metadata: { resourceType: row.resource_type }
            };
            
            result.highlightedContent = highlightFieldMatches(
                result.content,
                query,
                fieldData
            );
            
            results.push(result);
        }
    } finally {
        stmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('performFieldSpecificSearch', 'sqlite', elapsedTime);
    
    return results;
}

/**
 * Get field boosting statistics
 */
export function getFieldBoostingStats(db: Database): {
    totalRecords: number;
    recordsByType: { [key: string]: number };
    fieldsByType: { [key: string]: string[] };
    avgContentLength: number;
    avgFieldCount: number;
    indexSize: number;
} {
    const totalStmt = db.prepare('SELECT COUNT(*) as count FROM field_boost_index');
    const totalResult = totalStmt.get() as any;
    totalStmt.free();
    
    const typeStmt = db.prepare(`
        SELECT resource_type, COUNT(*) as count 
        FROM field_boost_index 
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
    
    const fieldsStmt = db.prepare(`
        SELECT resource_type, field_name
        FROM field_specific_index
        GROUP BY resource_type, field_name
        ORDER BY resource_type, field_name
    `);
    
    const fieldsByType: { [key: string]: string[] } = {};
    try {
        while (fieldsStmt.step()) {
            const row = fieldsStmt.getAsObject();
            const resourceType = row.resource_type as string;
            const fieldName = row.field_name as string;
            
            if (!fieldsByType[resourceType]) {
                fieldsByType[resourceType] = [];
            }
            fieldsByType[resourceType].push(fieldName);
        }
    } finally {
        fieldsStmt.free();
    }
    
    const avgStmt = db.prepare(`
        SELECT 
            AVG(content_length) as avg_content_length,
            AVG(field_count) as avg_field_count
        FROM field_boost_index
    `);
    const avgResult = avgStmt.get() as any;
    avgStmt.free();
    
    // Calculate approximate index size
    const sizeStmt = db.prepare(`
        SELECT 
            SUM(LENGTH(content) + LENGTH(field_data) + LENGTH(field_names)) as index_size
        FROM field_boost_index
    `);
    const sizeResult = sizeStmt.get() as any;
    sizeStmt.free();
    
    return {
        totalRecords: totalResult.count,
        recordsByType,
        fieldsByType,
        avgContentLength: Math.round(avgResult.avg_content_length || 0),
        avgFieldCount: Math.round(avgResult.avg_field_count || 0),
        indexSize: sizeResult.index_size || 0,
    };
}

/**
 * Bulk index content for field boosting
 */
export function bulkIndexForFieldBoosting(
    db: Database,
    records: Array<{ id: string; resourceType: string; content: string; fields: { [key: string]: any } }>
): void {
    const startTime = performance.now();
    
    db.exec('BEGIN TRANSACTION');
    
    try {
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO field_boost_index (
                id, resource_type, content, normalized_content, field_data, field_names, content_length, field_count, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        const fieldStmt = db.prepare(`
            INSERT OR REPLACE INTO field_specific_index (
                id, resource_type, field_name, field_value, normalized_value, field_position, field_length
            ) VALUES (?, ?, ?, ?, ?, ?, ?)
        `);
        
        for (const record of records) {
            const normalizedContent = record.content.toLowerCase().trim();
            const fieldData = JSON.stringify(record.fields);
            const fieldNames = Object.keys(record.fields).join(' ');
            const contentLength = record.content.length;
            const fieldCount = Object.keys(record.fields).length;
            
            stmt.run([
                record.id,
                record.resourceType,
                record.content,
                normalizedContent,
                fieldData,
                fieldNames,
                contentLength,
                fieldCount
            ]);
            
            // Insert field-specific entries
            let position = 0;
            for (const [fieldName, fieldValue] of Object.entries(record.fields)) {
                if (fieldValue != null) {
                    const valueStr = String(fieldValue);
                    const normalizedValue = valueStr.toLowerCase().trim();
                    
                    fieldStmt.run([
                        record.id,
                        record.resourceType,
                        fieldName,
                        valueStr,
                        normalizedValue,
                        position,
                        valueStr.length
                    ]);
                    position++;
                }
            }
        }
        
        stmt.free();
        fieldStmt.free();
        db.exec('COMMIT');
        
        const elapsedTime = performance.now() - startTime;
        trackFeatureUsage('bulkIndexForFieldBoosting', 'sqlite', elapsedTime);
        console.log(`Bulk indexed ${records.length} records for field boosting in ${elapsedTime.toFixed(2)}ms`);
        
    } catch (error) {
        db.exec('ROLLBACK');
        throw error;
    }
}

/**
 * Clear field boosting index for a specific resource type
 */
export function clearFieldBoostingIndex(db: Database, resourceType?: string): void {
    if (resourceType) {
        const stmt1 = db.prepare('DELETE FROM field_boost_index WHERE resource_type = ?');
        stmt1.run([resourceType]);
        stmt1.free();
        
        const stmt2 = db.prepare('DELETE FROM field_specific_index WHERE resource_type = ?');
        stmt2.run([resourceType]);
        stmt2.free();
    } else {
        db.exec('DELETE FROM field_boost_index');
        db.exec('DELETE FROM field_specific_index');
    }
}

// Helper functions

function levenshteinDistance(str1: string, str2: string): number {
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
}

function escapeRegex(string: string): string {
    return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function highlightFieldMatches(content: string, query: string, fieldData: { [key: string]: any }): string {
    try {
        let highlightedContent = content;
        const queryLower = query.toLowerCase();
        
        for (const [fieldName, fieldValue] of Object.entries(fieldData)) {
            if (typeof fieldValue !== 'string') continue;
            
            const fieldValueLower = fieldValue.toLowerCase();
            if (fieldValueLower.includes(queryLower)) {
                const regex = new RegExp(`(${escapeRegex(query)})`, 'gi');
                highlightedContent = highlightedContent.replace(regex, '<mark>$1</mark>');
            }
        }
        
        return highlightedContent;
    } catch (error) {
        console.error('Error in highlightFieldMatches:', error);
        return content;
    }
}

/**
 * Save field boosting database state
 */
export function saveFieldBoostingDb(db: Database): void {
    db.exec('PRAGMA optimize');
    console.log('Field boosting database state saved');
} 