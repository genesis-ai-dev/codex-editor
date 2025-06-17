import {
    WorkflowState,
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
    status: WorkflowState,
    progress?: number
): ImportProgress => ({
    stage,
    message,
    status,
    progress,
});

/**
 * Generates a unique cell ID
 */
export const generateCellId = (prefix: string, index: number): string => {
    return `${prefix}-${Date.now()}-${index}`;
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

/**
 * Creates a source notebook from processed cells
 */
export const createSourceNotebook = (
    fileName: string,
    cells: ProcessedCell[],
    importerType: string,
    additionalMetadata?: Record<string, any>
): ProcessedNotebook => {
    const baseName = fileName.replace(/\.[^/.]+$/, ''); // Remove extension

    return {
        name: `${baseName}.source`,
        cells,
        metadata: {
            id: `source-${Date.now()}`,
            originalFileName: fileName,
            importerType,
            createdAt: new Date().toISOString(),
            ...additionalMetadata,
        },
    };
};

/**
 * Creates a codex notebook from source cells (empty for translation, preserving images)
 */
export const createCodexNotebook = (
    sourceNotebook: ProcessedNotebook
): ProcessedNotebook => {
    const codexCells = sourceNotebook.cells.map(sourceCell => ({
        id: sourceCell.id,
        content: sourceCell.images.length > 0
            ? sourceCell.images.map(img => `<img src="${img.src}"${img.alt ? ` alt="${img.alt}"` : ''} />`).join('\n')
            : '', // Empty for translation, preserve images
        images: sourceCell.images, // Keep images in codex
        metadata: sourceCell.metadata,
    }));

    const baseName = sourceNotebook.metadata.originalFileName.replace(/\.[^/.]+$/, '');

    return {
        name: `${baseName}.codex`,
        cells: codexCells,
        metadata: {
            ...sourceNotebook.metadata,
            id: `codex-${Date.now()}`,
        },
    };
};

/**
 * Creates a complete notebook pair from source cells
 */
export const createNotebookPair = (
    fileName: string,
    cells: ProcessedCell[],
    importerType: string,
    additionalMetadata?: Record<string, any>
): NotebookPair => {
    const sourceNotebook = createSourceNotebook(
        fileName,
        cells,
        importerType,
        additionalMetadata
    );

    const codexNotebook = createCodexNotebook(sourceNotebook);

    return {
        source: sourceNotebook,
        codex: codexNotebook,
    };
};

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