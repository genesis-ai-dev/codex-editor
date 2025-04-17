import { PreviewContent } from "../../../../types";
import { DownloadBibleTransaction } from "../../../../src/transactions/DownloadBibleTransaction";

// Add ImportType type
export type ImportType = "source" | "translation" | "bible-download" | "translation-pairs";

// Update WorkflowStep to include the new initial step
export type WorkflowStep =
    | "type-select"
    | "select"
    | "preview-download"
    | "preview"
    | "processing"
    | "complete";

export type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface ProcessingStage {
    label: string;
    description: string;
    status: ProcessingStatus;
}

export interface ProcessingStages {
    [key: string]: ProcessingStage;
}

// Add specific Bible download stages
export interface BibleDownloadStages extends ProcessingStages {
    validation: ProcessingStage;
    download: ProcessingStage;
    splitting: ProcessingStage;
    notebooks: ProcessingStage;
    metadata: ProcessingStage;
    commit: ProcessingStage;
}

// Add Bible download specific state
export interface BibleDownloadState {
    language: string;
    translationId?: string;
    status: "idle" | "downloading" | "complete" | "error";
    progress?: {
        stage: keyof BibleDownloadStages;
        message: string;
        increment: number;
    };
}

export interface MultiPreviewItem {
    id: string; // Unique ID for each preview
    fileName: string;
    fileSize: number;
    isValid: boolean;
    isRejected?: boolean;
    preview: PreviewContent;
    sourceId?: string; // Optional sourceId for translation previews
}

export interface CodexFile {
    id: string;
    name: string;
    path: string;
}

export interface TranslationAssociation {
    file: File;
    codexId: string;
}

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    selectedFiles: string[];
    fileObjects: File[];
    fileHeaders?: string[];
    fileContent?: string;
    dataPreview?: string[][];
    translationAssociations: Array<{ file: File; codexId: string }>;
    availableCodexFiles?: Array<{ id: string; name: string; path: string }>;
    error?: string;
    preview?: PreviewContent;
    previews: Array<{
        id: string;
        fileName: string;
        fileSize: number;
        fileType: string;
        preview: PreviewContent;
        isValid?: boolean;
        isRejected?: boolean;
    }>;
    progress?: {
        message: string;
        increment: number;
    };
    processingStages: Record<
        string,
        {
            label: string;
            description: string;
            status: ProcessingStatus;
        }
    >;
    bibleDownload?: BibleDownloadState;
    currentTransaction?: any;
    columnMapping?: {
        sourceColumn: string;
        targetColumn?: string;
        idColumn?: string;
        metadataColumns: string[];
        hasHeaders: boolean;
    };
    parseConfig?: {
        delimiter: string;
        hasHeaders: boolean;
        totalRows: number;
    };
}

export interface ImportProgress {
    message: string;
    increment: number;
}
