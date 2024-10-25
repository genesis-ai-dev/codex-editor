import { SourcePreview } from "../../../../types";

export type WorkflowStep = "select" | "preview" | "processing" | "complete";

export type ProcessingStatus = "pending" | "active" | "complete" | "error";

export interface WorkflowState {
    step: WorkflowStep;
    selectedFile: File | null;
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
