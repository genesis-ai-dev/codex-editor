import {
    ImportProgress,
    ProcessedNotebook,
    ProcessedCell,
    NotebookPair
} from '../types/common';
import type { CustomNotebookCellData } from 'types';
import { CodexCellTypes } from 'types/enums';
import { v4 as uuidv4 } from 'uuid';

/**
 * Creates a progress update object
 */
export const createProgress = (
    stage: string,
    message: string,
    progress?: number
): ImportProgress => ({
    stage,
    message,
    progress,
});

// Removed deprecated generateCellId - plugins should handle their own ID generation

/**
 * Creates a standardized cell ID following the format: {documentId} {sectionId}:{cellId}
 */
export const createStandardCellId = (
    documentName: string,
    sectionId: number,
    cellId: number
): string => {
    const cleanDocName = documentName
        .replace(/\.[^/.]+$/, '') // Remove extension
        .replace(/\s+/g, '') // Remove spaces
        .replace(/[^a-zA-Z0-9-_]/g, ''); // Remove special characters except hyphens and underscores

    return `${cleanDocName} ${sectionId}:${cellId}`;
};

/**
 * Parses a standard cell ID back into its components
 */
export const parseStandardCellId = (cellId: string): {
    documentId: string;
    sectionId: number;
    cellId: number;
} | null => {
    const match = cellId.match(/^(.+)\s(\d+):(\d+)$/);
    if (!match) return null;

    return {
        documentId: match[1],
        sectionId: parseInt(match[2], 10),
        cellId: parseInt(match[3], 10),
    };
};

/**
 * Creates a processed cell with consistent structure
 */
export const createProcessedCell = (
    id: string,
    content: string,
    metadata?: CustomNotebookCellData['metadata']
): ProcessedCell => ({
    id,
    content,
    images: [], // Will be populated by image processing
    metadata,
});

// Removed createSourceNotebook, createCodexNotebook, createNotebookPair
// These functions are now implemented directly in each plugin for better modularity

/**
 * Validates file extension against supported extensions
 */
export const validateFileExtension = (
    fileName: string,
    supportedExtensions: string[]
): boolean => {
    const extension = fileName.split('.').pop()?.toLowerCase();
    return extension ? supportedExtensions.includes(extension) : false;
};

/**
 * Sanitizes filename for use as notebook name
 */
export const sanitizeFileName = (fileName: string): string => {
    return fileName
        .replace(/\.[^/.]+$/, '') // Remove extension
        .replace(/[^a-zA-Z0-9-_]/g, '-') // Replace special chars with hyphens
        .replace(/-+/g, '-') // Collapse multiple hyphens
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
};

/**
 * Splits content into logical segments for cell creation
 */
export const splitContentIntoSegments = (
    content: string,
    splitStrategy: 'paragraphs' | 'lines' | 'sections' | 'sentences' = 'paragraphs'
): string[] => {
    switch (splitStrategy) {
        case 'paragraphs':
            return content
                .split(/\n\s*\n/)
                .map(p => p.trim())
                .filter(p => p.length > 0);

        case 'lines':
            return content
                .split(/\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);

        case 'sections':
            // Split on headings or double line breaks
            return content
                .split(/(?=^#{1,6}\s)|(?=^.+\n={3,})|(?=^.+\n-{3,})|\n\s*\n\s*\n/m)
                .map(section => section.trim())
                .filter(section => section.length > 0);

        case 'sentences':
            // Split on sentence boundaries while preserving abbreviations
            // Matches: . ! ? followed by space/newline/end, but not abbreviations like Dr. Mr. etc.
            return content
                .split(/(?<=[.!?])\s+(?=[A-Z])|(?<=[.!?])[\r\n]+/)
                .map(sentence => sentence.trim())
                .filter(sentence => sentence.length > 0);

        default:
            return [content];
    }
};

/**
 * Estimates processing time based on file size and type
 */
export const estimateProcessingTime = (
    fileSize: number,
    fileType: string
): number => {
    // Base time in seconds
    const baseTime = 1;

    // Size factor (MB)
    const sizeFactor = fileSize / (1024 * 1024);

    // Type complexity multiplier
    const typeMultiplier = getTypeComplexity(fileType);

    return Math.ceil(baseTime + (sizeFactor * typeMultiplier));
};

/**
 * Gets complexity multiplier for different file types
 */
const getTypeComplexity = (fileType: string): number => {
    switch (fileType.toLowerCase()) {
        case 'docx':
            return 3; // Complex parsing with mammoth
        case 'pdf':
            return 4; // Most complex
        case 'md':
        case 'markdown':
            return 1; // Simple
        case 'txt':
            return 0.5; // Very simple
        default:
            return 2; // Default complexity
    }
};

/**
 * Extracts chapter number from a cell ID
 * Pattern: anything followed by space, then number, colon, number
 * e.g., "GEN 1:1", "Book Name 2:5", "filename 1:1"
 */
function extractChapterFromCellId(cellId: string): string | null {
    if (!cellId) return null;
    const match = cellId.match(/\s+(\d+):(\d+)(?::|$)/);
    if (match) {
        return match[1]; // Return the chapter number (first number)
    }
    return null;
}

/**
 * Creates a milestone cell with the given chapter number
 * @param chapterNumber - The chapter number for the milestone
 * @param uuid - Optional UUID to use. If not provided, a new UUID will be generated.
 */
function createMilestoneCell(chapterNumber: string, uuid?: string): ProcessedCell {
    const cellUuid = uuid || uuidv4();
    const cellLabel = `Chapter ${chapterNumber}`;

    return createProcessedCell(cellUuid, cellLabel, {
        type: CodexCellTypes.MILESTONE,
        id: cellUuid,
        edits: [],
    });
}

/**
 * Adds milestone cells to a notebook pair.
 * Milestone cells are inserted:
 * 1. At the very beginning of each notebook (for the first chapter)
 * 2. Before the first occurrence of each new chapter number
 */
export function addMilestoneCellsToNotebookPair(notebookPair: NotebookPair): NotebookPair {
    const sourceCells = notebookPair.source.cells || [];
    const codexCells = notebookPair.codex.cells || [];

    if (sourceCells.length === 0) {
        return notebookPair;
    }

    // Extract chapter numbers from cell IDs
    const seenChapters = new Set<string>();
    let firstChapterNumber: string | null = null;

    // First pass: find the first chapter number from any cell
    for (const cell of sourceCells) {
        const chapter = extractChapterFromCellId(cell.id);
        if (chapter) {
            firstChapterNumber = chapter;
            break;
        }
    }

    // If no chapter numbers found, return unchanged
    if (!firstChapterNumber) {
        return notebookPair;
    }

    // Build new cell arrays with milestone cells
    const newSourceCells: ProcessedCell[] = [];
    const newCodexCells: ProcessedCell[] = [];

    // Map to store UUIDs for each chapter to ensure consistency across source and codex
    const chapterUuids = new Map<string, string>();

    // Generate UUID for first chapter and store it
    const firstChapterUuid = uuidv4();
    chapterUuids.set(firstChapterNumber, firstChapterUuid);

    // Insert first milestone cell at the beginning (using same UUID for both)
    newSourceCells.push(createMilestoneCell(firstChapterNumber, firstChapterUuid));
    newCodexCells.push(createMilestoneCell(firstChapterNumber, firstChapterUuid));
    seenChapters.add(firstChapterNumber);

    // Process all cells and insert milestone cells before new chapters
    for (let i = 0; i < sourceCells.length; i++) {
        const sourceCell = sourceCells[i];
        const codexCell = codexCells[i] || sourceCell; // Fallback to source cell if codex cell missing

        const chapter = extractChapterFromCellId(sourceCell.id);
        if (chapter && !seenChapters.has(chapter)) {
            // Generate UUID for this chapter and store it
            const chapterUuid = uuidv4();
            chapterUuids.set(chapter, chapterUuid);

            // Insert a milestone cell before this new chapter (using same UUID for both)
            newSourceCells.push(createMilestoneCell(chapter, chapterUuid));
            newCodexCells.push(createMilestoneCell(chapter, chapterUuid));
            seenChapters.add(chapter);
        }

        newSourceCells.push(sourceCell);
        newCodexCells.push(codexCell);
    }

    return {
        source: {
            ...notebookPair.source,
            cells: newSourceCells,
        },
        codex: {
            ...notebookPair.codex,
            cells: newCodexCells,
        },
    };
} 