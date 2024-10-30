import { BiblePreviewData, PreviewContent } from "../../../../types";
import { DownloadBibleTransaction } from "../../../../src/transactions/DownloadBibleTransaction";

// Add ImportType type
export type ImportType = "source" | "translation" | "bible-download";

// Update WorkflowStep to include the new initial step
export type WorkflowStep = "type-select" | "select" | "preview" | "processing" | "complete";

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
    translationId: string;
    status: "idle" | "downloading" | "complete" | "error";
    progress?: {
        stage: keyof BibleDownloadStages;
        message: string;
        increment: number;
    };
}

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    selectedFile: string | null;
    fileObject: File | null;
    selectedSourceId?: string;
    preview?: PreviewContent | BiblePreviewData;
    error?: string | null;
    processingStages: ProcessingStages | BibleDownloadStages;
    progress?: {
        message: string;
        increment: number;
    };
    availableCodexFiles?: Array<{
        id: string;
        name: string;
        path: string;
    }>;
    bibleDownload?: BibleDownloadState;
    currentTransaction?: DownloadBibleTransaction;
}

export interface ImportProgress {
    message: string;
    increment: number;
}
