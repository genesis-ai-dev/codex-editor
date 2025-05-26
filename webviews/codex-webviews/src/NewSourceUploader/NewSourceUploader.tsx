import React, { useState, useCallback, useEffect } from "react";
import { Upload, FileText, CheckCircle, XCircle, Clock, RotateCcw } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import {
    FileUploadResult,
    UploadProgress,
    NewSourceUploaderPostMessages,
    NewSourceUploaderResponseMessages,
    FileInfo,
    UploadState,
} from "./types";
import "./App.css";
import "../tailwind.css";

interface VSCodeApi {
    postMessage: (message: NewSourceUploaderPostMessages) => void;
    setState: (state: any) => void;
    getState: () => any;
}

// Get the VSCode API that was set up in the HTML
const vscode: VSCodeApi = (window as any).vscodeApi;

const NewSourceUploader: React.FC = () => {
    const [uploadState, setUploadState] = useState<UploadState>({
        selectedFiles: [],
        isUploading: false,
        progress: [],
        result: null,
        error: null,
    });

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);

        if (files.length === 0) {
            setUploadState((prev) => ({
                ...prev,
                selectedFiles: [],
                result: null,
                error: null,
                progress: [],
            }));
            return;
        }

        // Check if all files have the same type
        const firstFileType = getFileTypeFromName(files[0].name);
        const allSameType = files.every((file) => getFileTypeFromName(file.name) === firstFileType);

        if (!allSameType) {
            setUploadState((prev) => ({
                ...prev,
                selectedFiles: [],
                result: null,
                error: "All files must be of the same type (CSV, TSV, or TXT)",
                progress: [],
            }));
            return;
        }

        setUploadState((prev) => ({
            ...prev,
            selectedFiles: files,
            result: null,
            error: null,
            progress: [],
        }));
    }, []);

    const handleUpload = useCallback(async () => {
        if (uploadState.selectedFiles.length === 0) return;

        setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));

        try {
            const filesData = await Promise.all(
                uploadState.selectedFiles.map(async (file) => {
                    const content = await readFileAsText(file);
                    return {
                        name: file.name,
                        content,
                        type: file.type || getFileTypeFromName(file.name),
                    };
                })
            );

            vscode.postMessage({
                command: "uploadFiles",
                filesData,
            });
        } catch (error) {
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                error: `Failed to read files: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`,
            }));
        }
    }, [uploadState.selectedFiles]);

    const handleReset = useCallback(() => {
        setUploadState({
            selectedFiles: [],
            isUploading: false,
            progress: [],
            result: null,
            error: null,
        });
        vscode.postMessage({ command: "reset" });
    }, []);

    const readFileAsText = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => resolve(e.target?.result?.toString() || "");
            reader.onerror = reject;
            reader.readAsText(file);
        });
    };

    const getFileTypeFromName = (fileName: string): string => {
        const extension = fileName.split(".").pop()?.toLowerCase();
        switch (extension) {
            case "csv":
                return "text/csv";
            case "tsv":
                return "text/tab-separated-values";
            case "txt":
                return "text/plain";
            default:
                return "text/plain";
        }
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getFileInfo = (file: File): FileInfo => ({
        name: file.name,
        size: file.size,
        type: file.type || getFileTypeFromName(file.name),
        lastModified: file.lastModified,
    });

    const getStatusIcon = (status: UploadProgress["status"]) => {
        switch (status) {
            case "success":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "error":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "processing":
                return <RotateCcw className="h-4 w-4 text-blue-500 animate-spin" />;
            default:
                return <Clock className="h-4 w-4 text-gray-400" />;
        }
    };

    const getStatusBadgeVariant = (status: UploadProgress["status"]) => {
        switch (status) {
            case "success":
                return "success" as const;
            case "error":
                return "destructive" as const;
            case "processing":
                return "processing" as const;
            default:
                return "secondary" as const;
        }
    };

    // Handle messages from the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent<NewSourceUploaderResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
                case "uploadResult":
                    setUploadState((prev) => ({
                        ...prev,
                        isUploading: false,
                        result: message.result || null,
                    }));
                    break;

                case "progressUpdate":
                    setUploadState((prev) => ({
                        ...prev,
                        progress: message.progress || [],
                    }));
                    break;

                case "error":
                    setUploadState((prev) => ({
                        ...prev,
                        isUploading: false,
                        error: message.error || "Unknown error occurred",
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const completedSteps = uploadState.progress.filter((p) => p.status === "success").length;
    const totalSteps = uploadState.progress.length;
    const progressPercentage = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
                    <Upload className="h-8 w-8" />
                    New Source Uploader
                </h1>
                <p className="text-muted-foreground">
                    Upload multiple files of the same type (CSV, TSV, or TXT) to create source and
                    translation notebooks
                </p>
            </div>

            {/* File Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Select File
                    </CardTitle>
                    <CardDescription>
                        Choose multiple files of the same type to upload and process into Codex
                        notebooks
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <input
                            type="file"
                            accept=".csv,.tsv,.txt"
                            multiple
                            onChange={handleFileSelect}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={uploadState.isUploading}
                        />
                    </div>

                    {uploadState.selectedFiles.length > 0 && (
                        <Card className="bg-muted/50">
                            <CardContent className="pt-6">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">Selected Files:</span>
                                        <Badge variant="outline">
                                            {uploadState.selectedFiles.length} files
                                        </Badge>
                                    </div>
                                    <div className="space-y-2 max-h-40 overflow-y-auto">
                                        {uploadState.selectedFiles.map((file, index) => (
                                            <div
                                                key={index}
                                                className="grid grid-cols-2 gap-4 text-sm p-2 rounded border"
                                            >
                                                <div>
                                                    <span className="font-medium">File:</span>{" "}
                                                    {file.name}
                                                </div>
                                                <div>
                                                    <span className="font-medium">Size:</span>{" "}
                                                    {formatFileSize(file.size)}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm pt-2 border-t">
                                        <div>
                                            <span className="font-medium">File Type:</span>{" "}
                                            {getFileTypeFromName(
                                                uploadState.selectedFiles[0].name
                                            ).toUpperCase()}
                                        </div>
                                        <div>
                                            <span className="font-medium">Total Size:</span>{" "}
                                            {formatFileSize(
                                                uploadState.selectedFiles.reduce(
                                                    (sum, file) => sum + file.size,
                                                    0
                                                )
                                            )}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={handleUpload}
                            disabled={
                                uploadState.selectedFiles.length === 0 || uploadState.isUploading
                            }
                            className="flex items-center gap-2"
                        >
                            {uploadState.isUploading ? (
                                <>
                                    <RotateCcw className="h-4 w-4 animate-spin" />
                                    Processing...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4" />
                                    Upload Files
                                </>
                            )}
                        </Button>

                        {(uploadState.result || uploadState.error) && (
                            <Button onClick={handleReset} variant="outline">
                                Reset
                            </Button>
                        )}
                    </div>
                </CardContent>
            </Card>

            {/* Progress Section */}
            {uploadState.progress.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>Processing Progress</span>
                            <Badge variant="outline">
                                {completedSteps}/{totalSteps} completed
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            Track the progress of your file upload and processing
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <Progress value={progressPercentage} className="w-full" />

                        <div className="space-y-3">
                            {uploadState.progress.map((item, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-3 p-3 rounded-lg border bg-card"
                                >
                                    {getStatusIcon(item.status)}
                                    <div className="flex-1 space-y-1">
                                        <div className="flex items-center justify-between">
                                            <span className="font-medium">{item.stage}</span>
                                            <Badge variant={getStatusBadgeVariant(item.status)}>
                                                {item.status}
                                            </Badge>
                                        </div>
                                        <p className="text-sm text-muted-foreground">
                                            {item.message}
                                        </p>
                                    </div>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Results Section */}
            {uploadState.result && (
                <Card
                    className={uploadState.result.success ? "border-green-200" : "border-red-200"}
                >
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            {uploadState.result.success ? (
                                <CheckCircle className="h-5 w-5 text-green-500" />
                            ) : (
                                <XCircle className="h-5 w-5 text-red-500" />
                            )}
                            Upload {uploadState.result.success ? "Complete" : "Failed"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 rounded-lg bg-muted">
                            <p className="font-medium">Status:</p>
                            <p className="text-sm text-muted-foreground">
                                {uploadState.result.message}
                            </p>
                        </div>

                        {uploadState.result.preview && (
                            <div className="space-y-2">
                                <h4 className="font-medium">Preview:</h4>
                                <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                    <pre className="whitespace-pre-wrap">
                                        {uploadState.result.preview}
                                    </pre>
                                </div>
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Error Section */}
            {uploadState.error && (
                <Card className="border-red-200">
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2 text-red-600">
                            <XCircle className="h-5 w-5" />
                            Error
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="p-4 rounded-lg bg-red-50 border border-red-200">
                            <p className="text-red-800">{uploadState.error}</p>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Supported Formats */}
            <Card>
                <CardHeader>
                    <CardTitle>Supported File Types</CardTitle>
                    <CardDescription>
                        Information about the file formats that can be uploaded
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid gap-4 md:grid-cols-3">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">CSV</Badge>
                                <span className="text-sm font-medium">Comma-separated values</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Automatic column detection for translation pairs
                            </p>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">TSV</Badge>
                                <span className="text-sm font-medium">Tab-separated values</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Automatic column detection for translation pairs
                            </p>
                        </div>
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">TXT</Badge>
                                <span className="text-sm font-medium">Plain text files</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Split by paragraphs or lines
                            </p>
                        </div>
                    </div>
                    <div className="mt-4 p-4 rounded-lg bg-muted">
                        <p className="text-sm text-muted-foreground">
                            <strong>Note:</strong> The uploader automatically detects source,
                            target, and ID columns for translation pairs.
                        </p>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewSourceUploader;
