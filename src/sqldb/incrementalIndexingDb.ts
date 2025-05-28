import { Database } from 'sql.js-fts5';
import * as vscode from 'vscode';
import { debounce } from 'lodash';
import { trackFeatureUsage } from '../telemetry/featureUsage';

// Interface for tracking incremental changes
export interface IncrementalChange {
    id: string;
    changeType: 'create' | 'update' | 'delete';
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref';
    resourceId: string;
    filePath: string;
    timestamp: string;
    processed: boolean;
    metadata?: string; // JSON string for additional data
}

// Interface for batch processing status
export interface BatchProcessingStatus {
    id: string;
    batchType: string;
    totalItems: number;
    processedItems: number;
    startTime: string;
    endTime?: string;
    status: 'pending' | 'processing' | 'completed' | 'failed';
    errorMessage?: string;
}

/**
 * Initialize the incremental indexing database tables
 */
export function initializeIncrementalIndexingDb(db: Database): void {
    console.log('Initializing incremental indexing database...');
    
    // Table for tracking incremental changes
    db.exec(`
        CREATE TABLE IF NOT EXISTS incremental_changes (
            id TEXT PRIMARY KEY,
            change_type TEXT NOT NULL CHECK (change_type IN ('create', 'update', 'delete')),
            resource_type TEXT NOT NULL CHECK (resource_type IN ('translation_pair', 'source_text', 'zero_draft', 'dynamic_table', 'verse_ref')),
            resource_id TEXT NOT NULL,
            file_path TEXT NOT NULL,
            timestamp TEXT NOT NULL,
            processed BOOLEAN DEFAULT FALSE,
            metadata TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Table for batch processing status
    db.exec(`
        CREATE TABLE IF NOT EXISTS batch_processing_status (
            id TEXT PRIMARY KEY,
            batch_type TEXT NOT NULL,
            total_items INTEGER NOT NULL,
            processed_items INTEGER DEFAULT 0,
            start_time TEXT NOT NULL,
            end_time TEXT,
            status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
            error_message TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Table for debounce tracking
    db.exec(`
        CREATE TABLE IF NOT EXISTS debounce_tracking (
            resource_type TEXT PRIMARY KEY,
            last_trigger_time TEXT NOT NULL,
            pending_changes INTEGER DEFAULT 0,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        );
    `);
    
    // Indexes for performance
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_incremental_changes_processed ON incremental_changes(processed);
        CREATE INDEX IF NOT EXISTS idx_incremental_changes_resource_type ON incremental_changes(resource_type);
        CREATE INDEX IF NOT EXISTS idx_incremental_changes_timestamp ON incremental_changes(timestamp);
        CREATE INDEX IF NOT EXISTS idx_batch_processing_status ON batch_processing_status(status);
        CREATE INDEX IF NOT EXISTS idx_debounce_tracking_resource ON debounce_tracking(resource_type);
    `);
    
    console.log('Incremental indexing database initialized successfully');
}

/**
 * Record an incremental change
 */
export function recordIncrementalChange(
    db: Database,
    changeType: 'create' | 'update' | 'delete',
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref',
    resourceId: string,
    filePath: string,
    metadata?: any
): void {
    const startTime = performance.now();
    
    const changeId = `${resourceType}_${changeType}_${resourceId}_${Date.now()}`;
    const timestamp = new Date().toISOString();
    const metadataJson = metadata ? JSON.stringify(metadata) : null;
    
    const stmt = db.prepare(`
        INSERT INTO incremental_changes (
            id, change_type, resource_type, resource_id, file_path, timestamp, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    
    stmt.run([changeId, changeType, resourceType, resourceId, filePath, timestamp, metadataJson]);
    stmt.free();
    
    // Update debounce tracking
    updateDebounceTracking(db, resourceType);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('recordIncrementalChange', 'sqlite', elapsedTime);
    
    console.log(`Recorded incremental change: ${changeType} ${resourceType} ${resourceId}`);
}

/**
 * Get pending changes for a specific resource type
 */
export function getPendingChanges(
    db: Database,
    resourceType?: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref',
    limit: number = 1000
): IncrementalChange[] {
    const startTime = performance.now();
    
    let query = `
        SELECT id, change_type, resource_type, resource_id, file_path, timestamp, processed, metadata
        FROM incremental_changes
        WHERE processed = FALSE
    `;
    
    const params: any[] = [];
    
    if (resourceType) {
        query += ` AND resource_type = ?`;
        params.push(resourceType);
    }
    
    query += ` ORDER BY timestamp ASC LIMIT ?`;
    params.push(limit);
    
    const stmt = db.prepare(query);
    
    try {
        stmt.bind(params);
        
        const changes: IncrementalChange[] = [];
        while (stmt.step()) {
            const row = stmt.getAsObject();
            changes.push({
                id: row.id as string,
                changeType: row.change_type as any,
                resourceType: row.resource_type as any,
                resourceId: row.resource_id as string,
                filePath: row.file_path as string,
                timestamp: row.timestamp as string,
                processed: Boolean(row.processed),
                metadata: row.metadata as string,
            });
        }
        
        return changes;
    } finally {
        stmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getPendingChanges', 'sqlite', elapsedTime);
}

/**
 * Mark changes as processed
 */
export function markChangesAsProcessed(db: Database, changeIds: string[]): void {
    if (changeIds.length === 0) return;
    
    const startTime = performance.now();
    
    const placeholders = changeIds.map(() => '?').join(',');
    const stmt = db.prepare(`
        UPDATE incremental_changes 
        SET processed = TRUE 
        WHERE id IN (${placeholders})
    `);
    
    stmt.run(changeIds);
    stmt.free();
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('markChangesAsProcessed', 'sqlite', elapsedTime);
    
    console.log(`Marked ${changeIds.length} changes as processed`);
}

/**
 * Create a batch processing record
 */
export function createBatchProcessingRecord(
    db: Database,
    batchType: string,
    totalItems: number
): string {
    const batchId = `batch_${batchType}_${Date.now()}`;
    const startTime = new Date().toISOString();
    
    const stmt = db.prepare(`
        INSERT INTO batch_processing_status (
            id, batch_type, total_items, start_time, status
        ) VALUES (?, ?, ?, ?, 'pending')
    `);
    
    stmt.run([batchId, batchType, totalItems, startTime]);
    stmt.free();
    
    console.log(`Created batch processing record: ${batchId} with ${totalItems} items`);
    return batchId;
}

/**
 * Update batch processing progress
 */
export function updateBatchProcessingProgress(
    db: Database,
    batchId: string,
    processedItems: number,
    status?: 'pending' | 'processing' | 'completed' | 'failed',
    errorMessage?: string
): void {
    let query = `UPDATE batch_processing_status SET processed_items = ?`;
    const params: any[] = [processedItems];
    
    if (status) {
        query += `, status = ?`;
        params.push(status);
        
        if (status === 'completed' || status === 'failed') {
            query += `, end_time = ?`;
            params.push(new Date().toISOString());
        }
    }
    
    if (errorMessage) {
        query += `, error_message = ?`;
        params.push(errorMessage);
    }
    
    query += ` WHERE id = ?`;
    params.push(batchId);
    
    const stmt = db.prepare(query);
    stmt.run(params);
    stmt.free();
}

/**
 * Update debounce tracking
 */
function updateDebounceTracking(
    db: Database,
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref'
): void {
    const timestamp = new Date().toISOString();
    
    const stmt = db.prepare(`
        INSERT OR REPLACE INTO debounce_tracking (
            resource_type, last_trigger_time, pending_changes, updated_at
        ) VALUES (
            ?, ?, 
            COALESCE((SELECT pending_changes FROM debounce_tracking WHERE resource_type = ?), 0) + 1,
            ?
        )
    `);
    
    stmt.run([resourceType, timestamp, resourceType, timestamp]);
    stmt.free();
}

/**
 * Get debounce status for a resource type
 */
export function getDebounceStatus(
    db: Database,
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref'
): { lastTriggerTime: string; pendingChanges: number } | null {
    const stmt = db.prepare(`
        SELECT last_trigger_time, pending_changes
        FROM debounce_tracking
        WHERE resource_type = ?
    `);
    
    const row = stmt.get([resourceType]) as any;
    stmt.free();
    
    if (!row) return null;
    
    return {
        lastTriggerTime: row.last_trigger_time,
        pendingChanges: row.pending_changes,
    };
}

/**
 * Reset debounce tracking for a resource type
 */
export function resetDebounceTracking(
    db: Database,
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref'
): void {
    const stmt = db.prepare(`
        UPDATE debounce_tracking 
        SET pending_changes = 0, updated_at = CURRENT_TIMESTAMP
        WHERE resource_type = ?
    `);
    
    stmt.run([resourceType]);
    stmt.free();
}

/**
 * Clean up old processed changes (older than specified days)
 */
export function cleanupOldChanges(db: Database, daysToKeep: number = 7): number {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysToKeep);
    const cutoffTimestamp = cutoffDate.toISOString();
    
    const stmt = db.prepare(`
        DELETE FROM incremental_changes
        WHERE processed = TRUE AND timestamp < ?
    `);
    
    const info = stmt.run([cutoffTimestamp]);
    stmt.free();
    
    const changes = (info as any).changes || 0;
    console.log(`Cleaned up ${changes} old processed changes`);
    return changes;
}

/**
 * Get incremental indexing statistics
 */
export function getIncrementalIndexingStats(db: Database): {
    totalChanges: number;
    pendingChanges: number;
    processedChanges: number;
    changesByType: { [key: string]: number };
    recentBatches: BatchProcessingStatus[];
} {
    const startTime = performance.now();
    
    // Total changes
    const totalStmt = db.prepare(`SELECT COUNT(*) as count FROM incremental_changes`);
    const totalResult = totalStmt.get() as any;
    totalStmt.free();
    
    // Pending changes
    const pendingStmt = db.prepare(`SELECT COUNT(*) as count FROM incremental_changes WHERE processed = FALSE`);
    const pendingResult = pendingStmt.get() as any;
    pendingStmt.free();
    
    // Processed changes
    const processedStmt = db.prepare(`SELECT COUNT(*) as count FROM incremental_changes WHERE processed = TRUE`);
    const processedResult = processedStmt.get() as any;
    processedStmt.free();
    
    // Changes by type
    const typeStmt = db.prepare(`
        SELECT resource_type, COUNT(*) as count
        FROM incremental_changes
        GROUP BY resource_type
    `);
    
    const changesByType: { [key: string]: number } = {};
    try {
        while (typeStmt.step()) {
            const row = typeStmt.getAsObject();
            changesByType[row.resource_type as string] = row.count as number;
        }
    } finally {
        typeStmt.free();
    }
    
    // Recent batches
    const batchStmt = db.prepare(`
        SELECT id, batch_type, total_items, processed_items, start_time, end_time, status, error_message
        FROM batch_processing_status
        ORDER BY start_time DESC
        LIMIT 10
    `);
    
    const recentBatches: BatchProcessingStatus[] = [];
    try {
        while (batchStmt.step()) {
            const row = batchStmt.getAsObject();
            recentBatches.push({
                id: row.id as string,
                batchType: row.batch_type as string,
                totalItems: row.total_items as number,
                processedItems: row.processed_items as number,
                startTime: row.start_time as string,
                endTime: row.end_time as string,
                status: row.status as any,
                errorMessage: row.error_message as string,
            });
        }
    } finally {
        batchStmt.free();
    }
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getIncrementalIndexingStats', 'sqlite', elapsedTime);
    
    return {
        totalChanges: totalResult.count,
        pendingChanges: pendingResult.count,
        processedChanges: processedResult.count,
        changesByType,
        recentBatches,
    };
}

/**
 * Process pending changes in batches
 */
export async function processPendingChangesBatch(
    db: Database,
    resourceType: 'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref',
    batchSize: number = 100,
    processor: (changes: IncrementalChange[]) => Promise<void>
): Promise<void> {
    const startTime = performance.now();
    
    const pendingChanges = getPendingChanges(db, resourceType, batchSize);
    if (pendingChanges.length === 0) {
        console.log(`No pending changes for ${resourceType}`);
        return;
    }
    
    const batchId = createBatchProcessingRecord(db, `${resourceType}_incremental`, pendingChanges.length);
    
    try {
        updateBatchProcessingProgress(db, batchId, 0, 'processing');
        
        // Process changes
        await processor(pendingChanges);
        
        // Mark changes as processed
        const changeIds = pendingChanges.map(change => change.id);
        markChangesAsProcessed(db, changeIds);
        
        // Reset debounce tracking
        resetDebounceTracking(db, resourceType);
        
        updateBatchProcessingProgress(db, batchId, pendingChanges.length, 'completed');
        
        const elapsedTime = performance.now() - startTime;
        trackFeatureUsage('processPendingChangesBatch', 'sqlite', elapsedTime);
        
        console.log(`Successfully processed ${pendingChanges.length} ${resourceType} changes in ${elapsedTime.toFixed(2)}ms`);
        
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        updateBatchProcessingProgress(db, batchId, 0, 'failed', errorMessage);
        console.error(`Failed to process ${resourceType} changes:`, error);
        throw error;
    }
}

/**
 * Save incremental indexing database state
 */
export function saveIncrementalIndexingDb(db: Database): void {
    // This function can be used to trigger any necessary cleanup or optimization
    db.exec('PRAGMA optimize');
    console.log('Incremental indexing database state saved');
} 