import { Database } from "sql.js";
import * as vscode from "vscode";
import { getWorkSpaceUri } from "../utils";

export interface IndexMetadata {
    indexName: string;
    lastBuiltAt: number;
    lastSourceModified: number;
    sourceFileCount: number;
    indexSize: number;
    buildTimeMs: number;
}

export interface FreshnessCheckResult {
    needsRebuild: boolean;
    reason: string;
    lastBuiltAt?: number;
    latestFileModified?: number;
    sourceFileChanges?: number;
}

/**
 * Initialize the index freshness tracking database
 */
export function initializeIndexFreshnessDb(db: Database): void {
    console.log('Initializing index freshness tracking database...');
    
    try {
        // Index metadata table to track when indexes were last built
        db.exec(`
            CREATE TABLE IF NOT EXISTS index_metadata (
                index_name TEXT PRIMARY KEY,
                last_built_at INTEGER NOT NULL,
                last_source_modified INTEGER NOT NULL,
                source_file_count INTEGER NOT NULL,
                index_size INTEGER NOT NULL,
                build_time_ms REAL NOT NULL,
                source_files_hash TEXT,
                created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Source file tracking table to detect file changes
        db.exec(`
            CREATE TABLE IF NOT EXISTS source_file_tracking (
                file_path TEXT PRIMARY KEY,
                last_modified INTEGER NOT NULL,
                file_size INTEGER NOT NULL,
                file_hash TEXT,
                last_checked_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            )
        `);
        
        // Freshness check results cache
        db.exec(`
            CREATE TABLE IF NOT EXISTS freshness_check_cache (
                index_name TEXT PRIMARY KEY,
                needs_rebuild INTEGER NOT NULL,
                check_reason TEXT NOT NULL,
                check_timestamp INTEGER NOT NULL,
                cache_valid_until INTEGER NOT NULL
            )
        `);
        
        // Create indexes for performance
        db.exec(`
            CREATE INDEX IF NOT EXISTS idx_index_metadata_last_built ON index_metadata(last_built_at);
            CREATE INDEX IF NOT EXISTS idx_source_file_tracking_modified ON source_file_tracking(last_modified);
            CREATE INDEX IF NOT EXISTS idx_freshness_cache_valid ON freshness_check_cache(cache_valid_until);
        `);
        
        // Verify the tables were created successfully
        const tables = ['index_metadata', 'source_file_tracking', 'freshness_check_cache'];
        for (const tableName of tables) {
            const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
            stmt.bind([tableName]);
            const exists = stmt.step();
            stmt.free();
            
            if (!exists) {
                throw new Error(`Failed to create table: ${tableName}`);
            }
        }
        
        console.log('Index freshness tracking database initialized successfully');
    } catch (error) {
        console.error('Error initializing index freshness tracking database:', error);
        throw new Error(`Failed to initialize index freshness database: ${error}`);
    }
}

/**
 * Record that an index was built
 */
export async function recordIndexBuild(
    db: Database,
    indexName: string,
    buildTimeMs: number,
    sourceFiles?: vscode.Uri[]
): Promise<void> {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='index_metadata'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('index_metadata table does not exist, skipping record build');
            return;
        }
        
        const now = Date.now();
        let sourceFileCount = 0;
        let latestSourceModified = 0;
        let sourceFilesHash = '';
        
        if (sourceFiles) {
            sourceFileCount = sourceFiles.length;
            
            // Calculate hash of source file paths and modification times
            const fileInfos: string[] = [];
            for (const file of sourceFiles) {
                try {
                    const stat = await vscode.workspace.fs.stat(file);
                    latestSourceModified = Math.max(latestSourceModified, stat.mtime);
                    fileInfos.push(`${file.fsPath}:${stat.mtime}:${stat.size}`);
                    
                    // Update source file tracking
                    updateSourceFileTracking(db, file.fsPath, stat.mtime, stat.size);
                } catch (error) {
                    console.warn(`Could not stat file ${file.fsPath}:`, error);
                }
            }
            
            // Simple hash of file info strings
            sourceFilesHash = createSimpleHash(fileInfos.join('|'));
        }
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO index_metadata (
                index_name, last_built_at, last_source_modified, source_file_count,
                index_size, build_time_ms, source_files_hash, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        `);
        
        // Get estimated index size from database
        const indexSize = getEstimatedIndexSize(db, indexName);
        
        stmt.bind([
            indexName,
            now,
            latestSourceModified,
            sourceFileCount,
            indexSize,
            buildTimeMs,
            sourceFilesHash
        ]);
        
        stmt.step();
        stmt.free();
        
        // Clear cache for this index
        clearFreshnessCache(db, indexName);
        
        console.log(`Recorded index build for ${indexName}: ${buildTimeMs.toFixed(2)}ms, ${sourceFileCount} files`);
    } catch (error) {
        console.error('Error recording index build:', error);
        // Don't throw - this is optional functionality
    }
}

/**
 * Check if an index needs to be rebuilt
 */
export async function checkIndexFreshness(
    db: Database,
    indexName: string,
    sourceFiles?: vscode.Uri[]
): Promise<FreshnessCheckResult> {
    const now = Date.now();
    const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes cache
    
    // Check cache first
    const cachedResult = getCachedFreshnessCheck(db, indexName);
    if (cachedResult && cachedResult.cacheValidUntil > now) {
        return {
            needsRebuild: cachedResult.needsRebuild,
            reason: `${cachedResult.reason} (cached)`,
            lastBuiltAt: cachedResult.lastBuiltAt
        };
    }
    
    // Get index metadata
    const metadata = getIndexMetadata(db, indexName);
    if (!metadata) {
        const result: FreshnessCheckResult = {
            needsRebuild: true,
            reason: 'Index has never been built'
        };
        cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
        return result;
    }
    
    // Check if source files have been provided for comparison
    if (!sourceFiles || sourceFiles.length === 0) {
        // If no source files provided, assume index is fresh (for basic checks)
        const result: FreshnessCheckResult = {
            needsRebuild: false,
            reason: 'No source files provided, assuming fresh',
            lastBuiltAt: metadata.lastBuiltAt
        };
        cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
        return result;
    }
    
    // Check if source file count changed
    if (sourceFiles.length !== metadata.sourceFileCount) {
        const result: FreshnessCheckResult = {
            needsRebuild: true,
            reason: `Source file count changed: ${metadata.sourceFileCount} → ${sourceFiles.length}`,
            lastBuiltAt: metadata.lastBuiltAt,
            sourceFileChanges: Math.abs(sourceFiles.length - metadata.sourceFileCount)
        };
        cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
        return result;
    }
    
    // Check file modification times
    let latestFileModified = 0;
    let modifiedFileCount = 0;
    
    for (const file of sourceFiles) {
        try {
            const stat = await vscode.workspace.fs.stat(file);
            latestFileModified = Math.max(latestFileModified, stat.mtime);
            
            // Check if this specific file was modified since index was built
            if (stat.mtime > metadata.lastBuiltAt) {
                modifiedFileCount++;
            }
        } catch (error) {
            // File might have been deleted, which means we need to rebuild
            const result: FreshnessCheckResult = {
                needsRebuild: true,
                reason: `Source file no longer accessible: ${file.fsPath}`,
                lastBuiltAt: metadata.lastBuiltAt
            };
            cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
            return result;
        }
    }
    
    // If any files were modified after the index was built, rebuild is needed
    if (modifiedFileCount > 0) {
        const result: FreshnessCheckResult = {
            needsRebuild: true,
            reason: `${modifiedFileCount} source files modified since last build`,
            lastBuiltAt: metadata.lastBuiltAt,
            latestFileModified,
            sourceFileChanges: modifiedFileCount
        };
        cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
        return result;
    }
    
    // Index is fresh!
    const result: FreshnessCheckResult = {
        needsRebuild: false,
        reason: 'All source files are older than index build time',
        lastBuiltAt: metadata.lastBuiltAt,
        latestFileModified
    };
    cacheFreshnessCheck(db, indexName, result, now + CACHE_DURATION);
    return result;
}

/**
 * Get all index metadata
 */
export function getAllIndexMetadata(db: Database): IndexMetadata[] {
    const stmt = db.prepare(`
        SELECT index_name, last_built_at, last_source_modified, source_file_count,
               index_size, build_time_ms
        FROM index_metadata
        ORDER BY last_built_at DESC
    `);
    
    const results: IndexMetadata[] = [];
    while (stmt.step()) {
        const row = stmt.getAsObject();
        results.push({
            indexName: row.index_name as string,
            lastBuiltAt: row.last_built_at as number,
            lastSourceModified: row.last_source_modified as number,
            sourceFileCount: row.source_file_count as number,
            indexSize: row.index_size as number,
            buildTimeMs: row.build_time_ms as number
        });
    }
    stmt.free();
    
    return results;
}

/**
 * Force invalidate an index (mark it as needing rebuild)
 */
export function invalidateIndex(db: Database, indexName: string): void {
    const stmt = db.prepare(`
        UPDATE index_metadata 
        SET last_built_at = 0, updated_at = CURRENT_TIMESTAMP 
        WHERE index_name = ?
    `);
    stmt.bind([indexName]);
    stmt.step();
    stmt.free();
    
    clearFreshnessCache(db, indexName);
    console.log(`Invalidated index: ${indexName}`);
}

/**
 * Clean up old tracking data
 */
export function cleanupIndexTracking(db: Database, olderThanDays: number = 30): number {
    const cutoffTime = Date.now() - (olderThanDays * 24 * 60 * 60 * 1000);
    
    // Clean old cache entries
    const cacheStmt = db.prepare(`
        DELETE FROM freshness_check_cache 
        WHERE cache_valid_until < ?
    `);
    cacheStmt.bind([Date.now()]);
    cacheStmt.step();
    const cacheDeleted = db.getRowsModified();
    cacheStmt.free();
    
    // Clean old source file tracking
    const fileStmt = db.prepare(`
        DELETE FROM source_file_tracking 
        WHERE last_checked_at < datetime(?, 'unixepoch')
    `);
    fileStmt.bind([cutoffTime / 1000]);
    fileStmt.step();
    const filesDeleted = db.getRowsModified();
    fileStmt.free();
    
    console.log(`Cleaned up ${cacheDeleted} cache entries and ${filesDeleted} old file tracking records`);
    return cacheDeleted + filesDeleted;
}

// Helper functions

function updateSourceFileTracking(db: Database, filePath: string, mtime: number, size: number): void {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='source_file_tracking'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('source_file_tracking table does not exist, skipping file tracking');
            return;
        }
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO source_file_tracking (
                file_path, last_modified, file_size, last_checked_at
            ) VALUES (?, ?, ?, CURRENT_TIMESTAMP)
        `);
        stmt.bind([filePath, mtime, size]);
        stmt.step();
        stmt.free();
    } catch (error) {
        console.error('Error updating source file tracking:', error);
        // Don't throw - this is optional functionality
    }
}

function getIndexMetadata(db: Database, indexName: string): IndexMetadata | null {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='index_metadata'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('index_metadata table does not exist, returning null');
            return null;
        }
        
        const stmt = db.prepare(`
            SELECT index_name, last_built_at, last_source_modified, source_file_count,
                   index_size, build_time_ms
            FROM index_metadata 
            WHERE index_name = ?
        `);
        stmt.bind([indexName]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return {
                indexName: row.index_name as string,
                lastBuiltAt: row.last_built_at as number,
                lastSourceModified: row.last_source_modified as number,
                sourceFileCount: row.source_file_count as number,
                indexSize: row.index_size as number,
                buildTimeMs: row.build_time_ms as number
            };
        }
        
        stmt.free();
        return null;
    } catch (error) {
        console.error('Error getting index metadata:', error);
        return null;
    }
}

function getCachedFreshnessCheck(db: Database, indexName: string): any {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='freshness_check_cache'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('freshness_check_cache table does not exist, returning null');
            return null;
        }
        
        const stmt = db.prepare(`
            SELECT needs_rebuild, check_reason, check_timestamp, cache_valid_until
            FROM freshness_check_cache 
            WHERE index_name = ?
        `);
        stmt.bind([indexName]);
        
        if (stmt.step()) {
            const row = stmt.getAsObject();
            stmt.free();
            return {
                needsRebuild: Boolean(row.needs_rebuild),
                reason: row.check_reason as string,
                lastBuiltAt: row.check_timestamp as number,
                cacheValidUntil: row.cache_valid_until as number
            };
        }
        
        stmt.free();
        return null;
    } catch (error) {
        console.error('Error getting cached freshness check:', error);
        return null;
    }
}

function cacheFreshnessCheck(
    db: Database, 
    indexName: string, 
    result: FreshnessCheckResult, 
    validUntil: number
): void {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='freshness_check_cache'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('freshness_check_cache table does not exist, skipping cache');
            return;
        }
        
        const stmt = db.prepare(`
            INSERT OR REPLACE INTO freshness_check_cache (
                index_name, needs_rebuild, check_reason, check_timestamp, cache_valid_until
            ) VALUES (?, ?, ?, ?, ?)
        `);
        stmt.bind([
            indexName,
            result.needsRebuild ? 1 : 0,
            result.reason,
            result.lastBuiltAt || Date.now(),
            validUntil
        ]);
        stmt.step();
        stmt.free();
    } catch (error) {
        console.error('Error caching freshness check:', error);
        // Don't throw - caching is optional
    }
}

function clearFreshnessCache(db: Database, indexName: string): void {
    try {
        // Check if the table exists
        const tableCheckStmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='freshness_check_cache'");
        const tableExists = tableCheckStmt.step();
        tableCheckStmt.free();
        
        if (!tableExists) {
            console.warn('freshness_check_cache table does not exist, skipping cache clear');
            return;
        }
        
        const stmt = db.prepare(`DELETE FROM freshness_check_cache WHERE index_name = ?`);
        stmt.bind([indexName]);
        stmt.step();
        stmt.free();
    } catch (error) {
        console.error('Error clearing freshness cache:', error);
        // Don't throw - cache clearing is optional
    }
}

function getEstimatedIndexSize(db: Database, indexName: string): number {
    try {
        // Try to estimate size based on the index name
        let tableName = '';
        switch (indexName) {
            case 'translation_pairs':
                tableName = 'translation_pairs';
                break;
            case 'source_text':
                tableName = 'source_text';
                break;
            case 'dynamic_table':
                tableName = 'table_records';
                break;
            case 'zero_draft':
                tableName = 'zero_draft_records';
                break;
            case 'verse_ref':
                tableName = 'verse_refs';
                break;
            case 'cell_label':
                tableName = 'cell_labels';
                break;
            default:
                return 0;
        }
        
        const stmt = db.prepare(`SELECT COUNT(*) as count FROM ${tableName}`);
        stmt.step();
        const result = stmt.getAsObject();
        stmt.free();
        return result.count as number;
    } catch (error) {
        return 0;
    }
}

function createSimpleHash(input: string): string {
    let hash = 0;
    if (input.length === 0) return hash.toString();
    
    for (let i = 0; i < input.length; i++) {
        const char = input.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32-bit integer
    }
    
    return Math.abs(hash).toString(36);
}

/**
 * Ensure freshness tables exist - emergency fallback function
 */
export function ensureFreshnessTablesExist(db: Database): boolean {
    try {
        // Check if all required tables exist
        const requiredTables = ['index_metadata', 'source_file_tracking', 'freshness_check_cache'];
        const missingTables: string[] = [];
        
        for (const tableName of requiredTables) {
            const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
            stmt.bind([tableName]);
            const exists = stmt.step();
            stmt.free();
            
            if (!exists) {
                missingTables.push(tableName);
            }
        }
        
        if (missingTables.length > 0) {
            console.warn(`Missing freshness tables: ${missingTables.join(', ')}. Force-creating them.`);
            
            // Force re-initialization
            initializeIndexFreshnessDb(db);
            
            // Verify they were created
            for (const tableName of missingTables) {
                const stmt = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?");
                stmt.bind([tableName]);
                const exists = stmt.step();
                stmt.free();
                
                if (!exists) {
                    console.error(`Failed to create table: ${tableName}`);
                    return false;
                }
            }
            
            console.log('All missing freshness tables have been created successfully');
        }
        
        return true;
    } catch (error) {
        console.error('Error ensuring freshness tables exist:', error);
        return false;
    }
}

/**
 * Save the index freshness database to disk
 */
export function saveIndexFreshnessDb(db: Database): void {
    // The database is already in memory and will be saved with the main database
    // This function exists for consistency with other database modules
    console.log("Index freshness tracking data updated in memory database");
} 