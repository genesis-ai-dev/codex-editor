export interface ProcessedImage {
    src: string;
    alt?: string;
    title?: string;
    width?: number;
    height?: number;
    originalData?: ArrayBuffer;
}

export interface ProcessedCell {
    id: string;
    content: string;
    images: ProcessedImage[];
    metadata?: Record<string, any>;
}

export interface ProcessedNotebook {
    name: string;
    cells: ProcessedCell[];
    metadata: {
        id: string;
        originalFileName: string;
        importerType: string;
        createdAt: string;
        [key: string]: any;
    };
}

export interface NotebookPair {
    source: ProcessedNotebook;
    codex: ProcessedNotebook;
}

export interface ImportProgress {
    stage: string;
    message: string;
    progress?: number; // 0-100
}

export interface ImportResult {
    success: boolean;
    notebookPair?: NotebookPair;
    error?: string;
    warnings?: string[];
    metadata?: Record<string, any>;
}

export interface FileValidationResult {
    // FIXME: this has to go - we want to handle this in the 'routes'
    isValid: boolean;
    fileType?: string;
    errors: string[];
    warnings: string[];
    metadata?: Record<string, any>;
}

// Core plugin interface - all importers must implement these functions
export interface ImporterPlugin {
    // Metadata about the plugin
    name: string;
    supportedExtensions: string[];
    supportedMimeTypes: string[];
    description: string;

    // Core functions
    validateFile: (file: File) => Promise<FileValidationResult>;
    parseFile: (file: File, onProgress?: (progress: ImportProgress) => void) => Promise<ImportResult>;

    // Optional functions for specialized behavior
    extractImages?: (file: File) => Promise<ProcessedImage[]>;
    preprocess?: (file: File) => Promise<File>;
    postprocess?: (result: ImportResult) => Promise<ImportResult>;
}

export interface ImporterRegistry {
    [key: string]: ImporterPlugin;
}

// Utility types for plugin development
export type ProgressCallback = (progress: ImportProgress) => void;
export type ValidationFunction = (file: File) => Promise<FileValidationResult>;
export type ParsingFunction = (file: File, onProgress?: ProgressCallback) => Promise<ImportResult>; 