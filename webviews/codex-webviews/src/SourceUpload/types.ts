import { PreviewContent } from "../../../../types";

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
    selectedFile: File | null;
    selectedSourceId?: string;
    preview?: PreviewContent;
    error?: string | null;
    processingStages: ProcessingStages;
    progress?: ImportProgress;
    availableCodexFiles?: Array<{
        id: string;
        name: string;
        path: string;
    }>;
    bibleDownload?: {
        language: string;
        status: "pending" | "downloading" | "complete" | "error";
        progress?: {
            message: string;
            increment: number;
        };
    };
}

export interface ImportProgress {
    message: string;
    increment: number;
}
