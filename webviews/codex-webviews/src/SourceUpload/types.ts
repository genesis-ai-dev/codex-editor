import { BiblePreviewData, PreviewContent } from "../../../../types";
import { DownloadBibleTransaction } from "../../../../src/transactions/DownloadBibleTransaction";

// Add ImportType type
export type ImportType = "source" | "translation" | "bible-download" | "translation-pairs";

// Update WorkflowStep to include the new initial step
export type WorkflowStep = "type-select" | "select" | "preview-download" | "preview" | "processing" | "complete";

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
    preview: PreviewContent | BiblePreviewData;
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
    fileHeaders?: string[]; // Add this for CSV/TSV headers
    translationAssociations: Array<{ file: File; codexId: string }>;
    previews: Array<{
        id: string;
        fileName: string;
        fileSize: number;
        preview: any;
        isRejected?: boolean;
    }>;
    processingStages: ProcessingStages;
    error?: string;
    progress?: {
        message: string;
        increment: number;
    };
    preview?: any;
    currentTransaction?: any;
    bibleDownload?: BibleDownloadState;
    availableCodexFiles?: Array<{ id: string; name: string; path: string }>;
    columnMapping?: {
        sourceColumn: string;
        targetColumn: string;
        idColumn?: string;
        metadataColumns: string[];
    };
}

export interface ImportProgress {
    message: string;
    increment: number;
}
