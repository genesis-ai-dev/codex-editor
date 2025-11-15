import { FileImporterType } from 'types/index';

export interface CellIdGenerationOptions {
    importerType: FileImporterType;
    filename: string;
    cellIndex: number;
    fileUniqueId?: string; // Store in notebook metadata on first import
}

/**
 * Generates a unique cell ID for any importer type
 * Format: {importerType}-{fileUniqueId}-{sequentialIndex}
 * Example: "spreadsheet-a3f9b2c1x7-000001"
 * 
 * For Bible content, chapter/verse info is stored in metadata, not in the ID
 */
export function generateUniqueCellId(options: CellIdGenerationOptions): string {
    const { importerType, filename, cellIndex, fileUniqueId } = options;

    // Generate or reuse file unique ID (should be stored in notebook metadata)
    const fileId = fileUniqueId || generateFileUniqueId(filename);

    // Zero-pad the cell index to ensure consistent length and sorting
    // 6 digits supports up to 999,999 cells per file
    const paddedIndex = cellIndex.toString().padStart(6, '0');

    return `${importerType}-${fileId}-${paddedIndex}`;
}

/**
 * Generates a unique file identifier (10 characters)
 * This should be stored in notebook metadata and reused for all cells from that file
 */
export function generateFileUniqueId(filename: string): string {
    const uniqueKey = `${filename}-${Date.now()}-${Math.random()}`;
    const hash = simpleHash(uniqueKey);
    return hash.toString(36).substring(0, 10).padStart(10, '0');
}

function simpleHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash);
}

/**
 * Parses a unique cell ID back into its components
 * Returns null if the ID doesn't match the new format
 */
export function parseUniqueCellId(cellId: string): {
    importerType: string;
    fileUniqueId: string;
    cellIndex: number;
} | null {
    const match = cellId.match(/^([a-z-]+)-([a-z0-9]{10})-(\d{6})$/);
    if (!match) return null;

    return {
        importerType: match[1],
        fileUniqueId: match[2],
        cellIndex: parseInt(match[3], 10),
    };
}

/**
 * Legacy parser for backward compatibility
 * Attempts to parse old format: {documentId} {sectionId}:{cellId}
 */
export function parseLegacyCellId(cellId: string): {
    documentId: string;
    sectionId: number;
    cellId: number;
} | null {
    const match = cellId.match(/^(.+)\s(\d+):(\d+)$/);
    if (!match) return null;

    return {
        documentId: match[1],
        sectionId: parseInt(match[2], 10),
        cellId: parseInt(match[3], 10),
    };
}

