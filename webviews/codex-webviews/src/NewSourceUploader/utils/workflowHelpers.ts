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
 * Extracts chapter number from a cell using priority order:
 * 1. metadata.chapterNumber (Biblica)
 * 2. metadata.chapter (USFM)
 * 3. metadata.data?.chapter (legacy)
 * 4. extractChapterFromCellId (from cellId)
 * 5. milestoneIndex (final fallback, 1-indexed)
 */
function extractChapterFromCell(cell: ProcessedCell, milestoneIndex: number): string {
    // Priority 1: metadata.chapterNumber (Biblica)
    if (cell?.metadata?.chapterNumber !== undefined && cell.metadata.chapterNumber !== null) {
        return String(cell.metadata.chapterNumber);
    }

    // Priority 2: metadata.chapter (USFM)
    if (cell?.metadata?.chapter !== undefined && cell.metadata.chapter !== null) {
        return String(cell.metadata.chapter);
    }

    // Priority 3: metadata.data?.chapter (legacy)
    if (cell?.metadata?.data?.chapter !== undefined && cell.metadata.data.chapter !== null) {
        return String(cell.metadata.data.chapter);
    }

    // Priority 4: Extract from cellId
    if (cell?.id) {
        const chapterFromId = extractChapterFromCellId(cell.id);
        if (chapterFromId) {
            return chapterFromId;
        }
    }

    // Priority 5: Use milestone index (1-indexed)
    return milestoneIndex.toString();
}

/**
 * Creates a milestone cell with chapter number derived from the cell below it.
 * @param cell - The cell below the milestone (first cell of the chapter)
 * @param milestoneIndex - The index of this milestone (1-indexed)
 * @param uuid - Optional UUID to use. If not provided, a new UUID will be generated.
 */
function createMilestoneCell(cell: ProcessedCell, milestoneIndex: number, uuid?: string): ProcessedCell {
    const cellUuid = uuid || uuidv4();
    const chapterNumber = extractChapterFromCell(cell, milestoneIndex);

    return createProcessedCell(cellUuid, chapterNumber, {
        type: CodexCellTypes.MILESTONE,
        id: cellUuid,
        edits: [],
    });
}

/**
 * Determines if an importer type is Bible-type based on importerType metadata
 */
function isBibleTypeImporter(importerType: string | undefined): boolean {
    if (!importerType) {
        return false;
    }

    const bibleTypeImporters = [
        'usfm',
        'paratext',
        'ebibleCorpus',
        'ebible',
        'ebible-download',
        'maculaBible',
        'macula',
        'biblica',
        'obs',
        'pdf', // PDF can contain Bible content
        'indesign', // InDesign can contain Bible content
    ];

    const normalizedType = importerType.toLowerCase().trim();
    return bibleTypeImporters.includes(normalizedType);
}

/**
 * Creates a simple milestone cell with value "1" for non-Bible importers
 */
function createSimpleMilestoneCell(uuid?: string): ProcessedCell {
    const cellUuid = uuid || uuidv4();
    return createProcessedCell(cellUuid, "1", {
        type: CodexCellTypes.MILESTONE,
        id: cellUuid,
        edits: [],
    });
}

/**
 * Adds milestone cells to a notebook pair.
 * For Bible-type importers: Milestone cells are inserted at the beginning and before each new chapter (using chapter numbers).
 * For non-Bible importers: A single milestone cell with value "1" is inserted at the beginning.
 */
export function addMilestoneCellsToNotebookPair(notebookPair: NotebookPair): NotebookPair {
    const sourceCells = notebookPair.source.cells || [];
    const codexCells = notebookPair.codex.cells || [];

    if (sourceCells.length === 0) {
        return notebookPair;
    }

    // Check if this is a Bible-type importer
    const importerType = notebookPair.source.metadata?.importerType;
    const isBibleType = isBibleTypeImporter(importerType);

    // Check if milestone cells already exist (idempotent check)
    const hasMilestoneCells = sourceCells.some(
        (cell) => cell.metadata?.type === CodexCellTypes.MILESTONE
    );
    if (hasMilestoneCells) {
        return notebookPair; // Already has milestone cells
    }

    // For non-Bible importers, create a single milestone cell with value "1"
    if (!isBibleType) {
        const milestoneUuid = uuidv4();
        const milestoneCell = createSimpleMilestoneCell(milestoneUuid);

        return {
            source: {
                ...notebookPair.source,
                cells: [milestoneCell, ...sourceCells],
            },
            codex: {
                ...notebookPair.codex,
                cells: [milestoneCell, ...codexCells],
            },
        };
    }

    // For Bible-type importers, use existing chapter-based logic
    // Build new cell arrays with milestone cells
    const newSourceCells: ProcessedCell[] = [];
    const newCodexCells: ProcessedCell[] = [];

    // Map to store UUIDs for each chapter to ensure consistency across source and codex
    const chapterUuids = new Map<string, string>();

    // Track milestone index (1-indexed)
    let milestoneIndex = 1;

    // Track seen chapters to avoid duplicates
    const seenChapters = new Set<string>();

    // Find first cell for first milestone
    const firstCell = sourceCells[0];
    if (!firstCell) {
        return notebookPair;
    }

    // Generate UUID for first milestone and store it
    const firstMilestoneUuid = uuidv4();
    const firstChapter = extractChapterFromCellId(firstCell.id);
    if (firstChapter) {
        chapterUuids.set(firstChapter, firstMilestoneUuid);
        seenChapters.add(firstChapter);
    }

    // Insert first milestone cell at the beginning (using same UUID for both)
    newSourceCells.push(createMilestoneCell(firstCell, milestoneIndex, firstMilestoneUuid));
    newCodexCells.push(createMilestoneCell(codexCells[0] || firstCell, milestoneIndex, firstMilestoneUuid));
    milestoneIndex++;

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
            newSourceCells.push(createMilestoneCell(sourceCell, milestoneIndex, chapterUuid));
            newCodexCells.push(createMilestoneCell(codexCell, milestoneIndex, chapterUuid));
            milestoneIndex++;
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