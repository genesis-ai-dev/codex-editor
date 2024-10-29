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

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    selectedFile: string | null;
    selectedSourceId?: string;
    preview?: PreviewContent | BiblePreviewData;
    error?: string | null;
    processingStages: ProcessingStages;
    progress?: {
        message: string;
        increment: number;
    };
    availableCodexFiles?: Array<{
        id: string;
        name: string;
        path: string;
    }>;
    bibleDownload?: {
        language: string;
        status: "downloading" | "complete" | "error";
    };
    currentTransaction?: DownloadBibleTransaction;
}

export interface ImportProgress {
    message: string;
    increment: number;
}
