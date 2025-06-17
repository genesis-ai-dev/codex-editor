export interface FileUploadResult {
    success: boolean;
    message: string;
    htmlContent?: string;
    formattedHtml?: string | null;
    fileName?: string;
    wordCount?: number;
    parsedHtml?: any;
    parseError?: string | null;
}

export interface UploadProgress {
    stage: string;
    message: string;
    status: "pending" | "processing" | "success" | "error";
}

export interface NewSourceUploaderPostMessages {
    command: "uploadFile" | "getProgress" | "reset";
    fileData?: {
        name: string;
        importerType: string;
        notebookPair: any; // Will be typed properly when integrated with backend
        metadata?: any;
    };
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
    selectedFile: File | null;
    isUploading: boolean;
    progress: UploadProgress[];
    result: FileUploadResult | null;
    error: string | null;
}
