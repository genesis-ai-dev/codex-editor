import { PreviewContent } from "../../../../types";

// Add ImportType type
export type ImportType = "source" | "translation";

// Update WorkflowStep to include the new initial step
export type WorkflowStep = 
    | "type-select"
    | "select"
    | "preview"
    | "processing"
    | "complete";

export type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType | null;
    selectedFile: File | null;
    selectedSourceId?: string;
    preview?: PreviewContent;
    error?: string | null;
    processingStages: ProcessingStages;
    progress?: ImportProgress;
    availableSourceFiles?: Array<{
        id: string;
        name: string;
        path: string;
    }>;
}

export interface ImportProgress {
    message: string;
    increment: number;
}

export interface ProcessingStages {
    [key: string]: {
        label: string;
        description: string;
        status: ProcessingStatus;
    };
}
