import * as vscode from 'vscode';
import { Database } from 'sql.js';
import { trackFeatureUsage } from '../telemetry/featureUsage';
import * as sqlCellLabel from '../sqldb/cellLabelDb';
import { FileData } from '../activationHelpers/contextAware/miniIndex/indexes/fileReaders';
import { SourceCellVersions } from '../../types';

// Re-export types for compatibility
export interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
}

export interface CellMetadata {
    type?: string;
    id?: string;
    edits?: Array<{
        cellValue: string;
        timestamp: number;
        type: string;
        author?: string;
    }>;
    cellLabel?: string;
}

// Helper function to get the database instance
function getDatabase(): Database | null {
    return (global as any).db || null;
}

// Direct SQLite implementation for creating source text index with cell labels
export async function createSourceTextIndexWithLabels(
    sourceFiles: FileData[],
    metadataManager: any,
    force: boolean = false
): Promise<void> {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        throw new Error('SQLite database not available');
    }
    
    console.log('Using SQLite implementation for createSourceTextIndexWithLabels');
    
    await sqlCellLabel.createCellLabelIndex(db, sourceFiles, [], force);
    await sqlCellLabel.saveCellLabelDb(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('createSourceTextIndexWithLabels', 'sqlite', elapsedTime);
    console.log(`createSourceTextIndexWithLabels using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for searching source cells by time
export function searchSourceCellsByTime(
    startTimeSeconds: number,
    threshold: number = 0.5
): { cellId: string; currentLabel?: string }[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for searchSourceCellsByTime');
    
    const results = sqlCellLabel.searchSourceCellsByTime(db, startTimeSeconds, threshold);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('searchSourceCellsByTime', 'sqlite', elapsedTime);
    console.log(`searchSourceCellsByTime using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting cell by cell ID
export function getCellByCellId(
    cellId: string
): { cellId: string; content: string; currentLabel?: string } | null {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return null;
    }
    
    console.log('Using SQLite implementation for getCellByCellId');
    
    const result = sqlCellLabel.getCellByCellId(db, cellId);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getCellByCellId', 'sqlite', elapsedTime);
    console.log(`getCellByCellId using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return result;
}

// Direct SQLite implementation for updating cell labels
export async function updateCellLabels(
    labels: CellLabelData[]
): Promise<void> {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        throw new Error('SQLite database not available');
    }
    
    console.log('Using SQLite implementation for updateCellLabels');
    
    sqlCellLabel.updateCellLabels(db, labels);
    await sqlCellLabel.saveCellLabelDb(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('updateCellLabels', 'sqlite', elapsedTime);
    console.log(`updateCellLabels using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for searching cells by content
export function searchCellsByContent(
    query: string,
    limit: number = 15
): SourceCellVersions[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for searchCellsByContent');
    
    const results = sqlCellLabel.searchCellsByContent(db, query, limit);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('searchCellsByContent', 'sqlite', elapsedTime);
    console.log(`searchCellsByContent using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting all cells with labels
export function getAllCellsWithLabels(): SourceCellVersions[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for getAllCellsWithLabels');
    
    const results = sqlCellLabel.getAllCellsWithLabels(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getAllCellsWithLabels', 'sqlite', elapsedTime);
    console.log(`getAllCellsWithLabels using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
} 