import * as vscode from "vscode";
import { Database } from 'sql.js-fts5';
import { SourceCellVersions, TranslationPair } from "../../../../../types";
import * as sqlTranslationPairs from "../../../../sqldb/translationPairsDb";
import * as sqlSourceText from "../../../../sqldb/sourceTextDb";

// Helper function to get the unified index database instance
function getIndexDatabase(): Database | null {
    return (global as any).indexDb || null;
}

export function searchTargetCellsByQuery(
    query: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlTranslationPairs.searchTargetCellsByQuery(db, query, k);
}

export function getSourceCellByCellIdFromAllSourceCells(
    cellId: string
): SourceCellVersions | null {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return null;
    }
    return sqlSourceText.getSourceCellByCellIdFromAllSourceCells(db, cellId);
}

export function getTargetCellByCellId(cellId: string) {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return null;
    }
    return sqlTranslationPairs.getTargetCellByCellId(db, cellId);
}

export function getTranslationPairFromProject(
    cellId: string
): TranslationPair | null {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return null;
    }
    return sqlTranslationPairs.getTranslationPairFromProject(db, cellId);
}

export function getTranslationPairsFromSourceCellQuery(
    query: string,
    k: number = 5
): TranslationPair[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlTranslationPairs.getTranslationPairsFromSourceCellQuery(db, query, k);
}

export function handleTextSelection(selectedText: string) {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    // Use searchTargetCellsByQuery as a replacement for handleTextSelection
    return sqlTranslationPairs.searchTargetCellsByQuery(db, selectedText, 10);
}

export function searchParallelCells(
    query: string,
    k: number = 15
): TranslationPair[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    // Use searchAllCells as a replacement for searchParallelCells
    return sqlTranslationPairs.searchAllCells(db, db, query, k, true);
}

export function searchSimilarCellIds(
    cellId: string,
    k: number = 5,
    fuzziness: number = 0.2
) {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlTranslationPairs.searchSimilarCellIds(db, cellId, k);
}

export async function findNextUntranslatedSourceCell(
    query: string,
    currentCellId: string
): Promise<{ cellId: string; content: string } | null> {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return null;
    }
    return sqlSourceText.findNextUntranslatedSourceCell(db, db, query, currentCellId);
}

// Enhanced untranslated cell lookup functions
export function getAllUntranslatedCells(
    limit: number = 50
): { cellId: string; content: string; notebookId: string }[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlSourceText.getAllUntranslatedCells(db, db, limit);
}

export function getUntranslatedCellsByBook(
    book: string
): { 
    untranslatedCells: { cellId: string; content: string }[];
    totalCells: number;
    translatedCells: number;
    progressPercentage: number;
} {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return {
            untranslatedCells: [],
            totalCells: 0,
            translatedCells: 0,
            progressPercentage: 0
        };
    }
    return sqlSourceText.getUntranslatedCellsByBook(db, db, book);
}

export function getTranslationProgressSummary(): { book: string; totalCells: number; translatedCells: number; progressPercentage: number }[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlSourceText.getTranslationProgressSummary(db, db);
}

export function searchAllCells(
    query: string,
    k: number = 15,
    includeIncomplete: boolean = true
): TranslationPair[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlTranslationPairs.searchAllCells(db, db, query, k, includeIncomplete);
}

export function searchTranslationPairs(
    query: string,
    includeIncomplete: boolean = false,
    k: number = 15,
    options: { completeBoost?: number; targetContentBoost?: number } = {}
): TranslationPair[] {
    const db = getIndexDatabase();
    if (!db) {
        console.error('SQLite database not available');
        return [];
    }
    return sqlTranslationPairs.searchTranslationPairs(db, query, includeIncomplete, k);
}
