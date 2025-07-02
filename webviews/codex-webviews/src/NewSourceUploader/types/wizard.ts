import { ExistingFile } from './plugin';

/**
 * Basic file info (name and path only, no detailed metadata)
 */
export interface BasicFileInfo {
    name: string;
    path: string;
}

/**
 * Detailed file info (includes metadata, cell count, etc.)
 */
export interface DetailedFileInfo {
    name: string;
    path: string;
    type: string;
    cellCount: number;
    metadata?: any;
}

/**
 * Represents a translation pair between source and target files
 */
export interface TranslationPair {
    sourceFile: BasicFileInfo;
    targetFile: BasicFileInfo;
}

/**
 * Project inventory containing all files and translation pairs
 */
export interface ProjectInventory {
    sourceFiles: BasicFileInfo[];
    targetFiles: BasicFileInfo[];
    translationPairs: TranslationPair[];
}

/**
 * Wizard step types
 */
export type WizardStep =
    | 'intent-selection'      // Choose source or target
    | 'source-import'        // Import source files
    | 'target-selection'     // Select source file for target
    | 'target-import'        // Import target files
    | 'success';             // Success screen

/**
 * User's import intent
 */
export type ImportIntent = 'source' | 'target';

/**
 * Wizard state management
 */
export interface WizardState {
    currentStep: WizardStep;
    selectedIntent: ImportIntent | null;
    selectedSourceForTarget?: BasicFileInfo;
    selectedSourceDetails?: DetailedFileInfo;
    selectedPlugin?: string;
    projectInventory: ProjectInventory;
    isLoadingInventory: boolean;
    isLoadingFileDetails: boolean;
    fileDetailsError?: string;
}

/**
 * Props for wizard context in importer components
 */
export interface WizardContext {
    intent: ImportIntent;
    selectedSource?: BasicFileInfo;
    selectedSourceDetails?: DetailedFileInfo;
    projectInventory: ProjectInventory;
}

/**
 * Message types for file details requests
 */
export interface FetchFileDetailsMessage {
    command: 'fetchFileDetails';
    filePath: string;
}

export interface FileDetailsResponseMessage {
    command: 'fileDetails';
    filePath: string;
    details: DetailedFileInfo;
}

export interface FileDetailsErrorMessage {
    command: 'fileDetailsError';
    filePath: string;
    error: string;
}

/**
 * Message types for fetching target file content for translation imports
 */
export interface FetchTargetFileMessage {
    command: 'fetchTargetFile';
    sourceFilePath: string;
}

export interface TargetFileResponseMessage {
    command: 'targetFileContent';
    sourceFilePath: string;
    targetFilePath: string;
    targetCells: any[];
}

export interface TargetFileErrorMessage {
    command: 'targetFileError';
    sourceFilePath: string;
    error: string;
}