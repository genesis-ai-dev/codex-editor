import * as vscode from 'vscode';
import { Database } from 'sql.js-fts5';
import { trackFeatureUsage } from '../telemetry/featureUsage';
import * as sqlVerseRef from '../sqldb/verseRefDb';

// Types from the original implementation
interface VrefIndex {
    id: string;
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

interface VrefSearchResult {
    vref: string;
    uri: string;
    position: { line: number; character: number };
}

// Helper function to get the database instance
function getDatabase(): Database | null {
    return (global as any).db as Database || null;
}

// Direct SQLite implementation for indexVerseRefsInSourceText
export async function indexVerseRefsInSourceText(): Promise<void> {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        throw new Error('SQLite database not available');
    }
    
    console.log('Using SQLite implementation for indexVerseRefsInSourceText');
    
    await sqlVerseRef.indexVerseRefsInSourceText(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('indexVerseRefsInSourceText', 'sqlite', elapsedTime);
    console.log(`indexVerseRefsInSourceText using SQLite took ${elapsedTime.toFixed(2)}ms`);
}

// Direct SQLite implementation for searchVerseRefPositionIndex
export function searchVerseRefPositionIndex(
    searchString: string
): VrefSearchResult[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for searchVerseRefPositionIndex');
    
    const results = sqlVerseRef.searchVerseRefPositionIndex(db, searchString);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('searchVerseRefPositionIndex', 'sqlite', elapsedTime);
    console.log(`searchVerseRefPositionIndex using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for searching verse references with FTS
export function searchVerseRefs(
    query: string,
    limit: number = 15
): VrefSearchResult[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for searchVerseRefs');
    
    const results = sqlVerseRef.searchVerseRefs(db, query, limit);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('searchVerseRefs', 'sqlite', elapsedTime);
    console.log(`searchVerseRefs using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting all verse references
export function getAllVerseRefs(): VrefSearchResult[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for getAllVerseRefs');
    
    const results = sqlVerseRef.getAllVerseRefs(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getAllVerseRefs', 'sqlite', elapsedTime);
    console.log(`getAllVerseRefs using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting verse references by URI
export function getVerseRefsByUri(uri: string): VrefSearchResult[] {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    
    console.log('Using SQLite implementation for getVerseRefsByUri');
    
    const results = sqlVerseRef.getVerseRefsByUri(db, uri);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getVerseRefsByUri', 'sqlite', elapsedTime);
    console.log(`getVerseRefsByUri using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return results;
}

// Direct SQLite implementation for getting verse reference count
export function getVerseRefCount(): number {
    const startTime = performance.now();
    const db = getDatabase();
    
    if (!db) {
        console.error('SQLite database not available');
        return 0;
    }
    
    console.log('Using SQLite implementation for getVerseRefCount');
    
    const count = sqlVerseRef.getVerseRefCount(db);
    
    const elapsedTime = performance.now() - startTime;
    trackFeatureUsage('getVerseRefCount', 'sqlite', elapsedTime);
    console.log(`getVerseRefCount using SQLite took ${elapsedTime.toFixed(2)}ms`);
    
    return count;
} 