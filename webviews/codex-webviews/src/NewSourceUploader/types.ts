export interface FileUploadResult {
    success: boolean;
    message: string;
    preview?: string;
    sourceNotebook?: string;
    codexNotebook?: string;
}

export interface UploadProgress {
    stage: string;
    message: string;
    status: "pending" | "processing" | "success" | "error";
}

export interface NewSourceUploaderPostMessages {
    command: "uploadFiles" | "getProgress" | "reset";
    filesData?: {
        name: string;
        content: string;
        type: string;
    }[];
}

export interface NewSourceUploaderResponseMessages {
    command: "uploadResult" | "progressUpdate" | "error";
    result?: FileUploadResult;
    progress?: UploadProgress[];
    error?: string;
}

export interface FileInfo {
    name: string;
    size: number;
    type: string;
    lastModified: number;
}

export interface UploadState {
    selectedFiles: File[];
    isUploading: boolean;
    progress: UploadProgress[];
    result: FileUploadResult | null;
    error: string | null;
}
