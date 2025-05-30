import * as vscode from "vscode";
import { Database } from 'sql.js-fts5';
import { trackFeatureUsage } from '../../../../telemetry/featureUsage';
import * as sqlDynamicTable from '../../../../sqldb/dynamicTableDb';

// Define the structure of table records for compatibility
export interface TableRecord {
    id: string;
    [key: string]: any; // Allow for dynamic keys based on table columns
}

// Helper function to get the unified index database instance
function getIndexDatabase(): Database | null {
    return (global as any).indexDb || null;
}

// Direct SQLite implementation for creating table indexes
export async function createTableIndexes(): Promise<void> {
    const startTime = performance.now();
    const db = (global as any).indexDb;
    
    if (!db) {
        throw new Error('Unified index database not available');
    }

    console.log('Using SQLite implementation for createTableIndexes');
    
    // Create SQLite dynamic table index with force=true to rebuild
    await sqlDynamicTable.createDynamicTableIndex(db, true);
    
    // Save will be handled by the main index creation process
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('createTableIndexes', 'sqlite', elapsedTime);
    console.log(`createTableIndexes using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for updating a single table index
export async function updateTableIndex(filePath: string): Promise<void> {
    const startTime = performance.now();
    const db = (global as any).indexDb;
    
    if (!db) {
        throw new Error('Unified index database not available');
    }

    console.log('Using SQLite implementation for updateTableIndex');
    
    // Record the change for incremental processing
    const { recordIncrementalChange } = await import('../../../../sqldb/incrementalIndexingDb');
    recordIncrementalChange(db, 'update', 'dynamic_table', filePath, filePath);
    
    // For now, just recreate the index for the specific file
    // In a more sophisticated implementation, this could be optimized to only update the specific file
    await sqlDynamicTable.createDynamicTableIndex(db, false);
    
    // Save will be handled by the caller (extension.ts)
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('updateTableIndex', 'sqlite', elapsedTime);
    console.log(`updateTableIndex using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for removing a table index
export async function removeTableIndex(filePath: string): Promise<void> {
    const startTime = performance.now();
    const db = (global as any).indexDb;
    
    if (!db) {
        console.error('Unified index database not available');
        return;
    }
    
    console.log('Using SQLite implementation for removeTableIndex');
    
    sqlDynamicTable.removeTableFile(db, filePath);
    
    // Save will be handled by the caller (extension.ts)
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('removeTableIndex', 'sqlite', elapsedTime);
    console.log(`removeTableIndex using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for searching table records
export function searchTableRecords(
    query: string,
    filePath?: string,
    limit: number = 50
): any[] {
    const startTime = performance.now();
    const db = getIndexDatabase();
    
    if (!db) {
        console.error('Unified index database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for searchTableRecords');
    
    const results = sqlDynamicTable.searchTableRecords(db, query, filePath, limit);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('searchTableRecords', 'sqlite', elapsedTime);
    console.log(`searchTableRecords using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting table metadata
export function getAllTableMetadata(): any[] {
    const startTime = performance.now();
    const db = getIndexDatabase();
    
    if (!db) {
        console.error('Unified index database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for getAllTableMetadata');
    
    const results = sqlDynamicTable.getAllTableMetadata(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getAllTableMetadata', 'sqlite', elapsedTime);
    console.log(`getAllTableMetadata using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
} 