import { SourcePreview } from "../../../../types";

// Add ImportType type
export type ImportType = "source" | "translation" | null;

// Update WorkflowStep to include the new initial step
export type WorkflowStep = "type-select" | "select" | "preview" | "processing" | "complete";

export type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface WorkflowState {
    step: WorkflowStep;
    importType: ImportType;
    selectedFile: File | null;
    availableSourceFiles?: Array<{
        id: string;
        name: string;
        path: string;
    }>;
    preview?: {
        original: {
            preview: string;
            validationResults: Array<{
                isValid: boolean;
                errors: Array<{ message: string }>;
            }>;
        };
        transformed: {
            books: Array<{
                name: string;
                versesCount: number;
                chaptersCount: number;
            }>;
            sourceNotebooks: Array<{
                name: string;
                cells: Array<{
                    value: string;
                    metadata: {
                        id: string;
                        type: string;
                    };
                }>;
            }>;
            codexNotebooks: Array<{
                name: string;
                cells: Array<{
                    metadata: {
                        id: string;
                        type: string;
                    };
                }>;
            }>;
            validationResults: Array<{
                isValid: boolean;
                errors: Array<{ message: string }>;
            }>;
        };
    };
    processingStages: {
        [key: string]: {
            label: string;
            description: string;
            status: ProcessingStatus;
        };
    };
    progress?: {
        message: string;
        increment: number;
    };
    error?: string;
}

export interface ImportProgress {
    message: string;
    increment: number;
}
