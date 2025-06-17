import {
    ImportProgress,
    ProcessedNotebook,
    ProcessedCell,
    NotebookPair
} from '../types/common';

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
    metadata?: Record<string, any>
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
    splitStrategy: 'paragraphs' | 'lines' | 'sections' = 'paragraphs'
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