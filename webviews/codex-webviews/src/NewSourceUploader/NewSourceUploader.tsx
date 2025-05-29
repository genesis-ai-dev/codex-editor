import React, { useState, useCallback, useEffect } from "react";
import { Upload, FileText, CheckCircle, XCircle, Clock, RotateCcw, Download } from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import mammoth from "mammoth";
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
        selectedFile: null,
        isUploading: false,
        progress: [],
        result: null,
        error: null,
    });

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (!file) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                result: null,
                error: null,
                progress: [],
            }));
            return;
        }

        // Check if file is DOCX
        if (!file.name.toLowerCase().endsWith(".docx")) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                result: null,
                error: "Only DOCX files are supported",
                progress: [],
            }));
            return;
        }

        setUploadState((prev) => ({
            ...prev,
            selectedFile: file,
            result: null,
            error: null,
            progress: [],
        }));
    }, []);

    const handleUpload = useCallback(async () => {
        if (!uploadState.selectedFile) return;

        setUploadState((prev) => ({ ...prev, isUploading: true, error: null }));

        try {
            // Update progress: Reading file
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "Reading DOCX file...",
                        status: "processing",
                    },
                ],
            }));

            const arrayBuffer = await readFileAsArrayBuffer(uploadState.selectedFile);

            // Update progress: Converting to HTML
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "DOCX file read successfully",
                        status: "success",
                    },
                    {
                        stage: "Converting to HTML",
                        message: "Converting DOCX to HTML using mammoth.js...",
                        status: "processing",
                    },
                ],
            }));

            // Convert DOCX to HTML using mammoth.js
            const result = await mammoth.convertToHtml({ arrayBuffer });
            console.log({ result });
            const htmlContent = result.value;
            const messages = result.messages;

            // Count words in the HTML content
            const textContent = htmlContent
                .replace(/<[^>]*>/g, " ")
                .replace(/\s+/g, " ")
                .trim();
            const wordCount = textContent
                .split(" ")
                .filter((word: string) => word.length > 0).length;

            // Update progress: Conversion complete
            setUploadState((prev) => ({
                ...prev,
                progress: [
                    {
                        stage: "Reading File",
                        message: "DOCX file read successfully",
                        status: "success",
                    },
                    {
                        stage: "Converting to HTML",
                        message: `Conversion complete. ${wordCount} words processed.`,
                        status: "success",
                    },
                ],
            }));

            // Send the result to the extension
            vscode.postMessage({
                command: "uploadFile",
                fileData: {
                    name: uploadState.selectedFile.name,
                    content: arrayBuffer,
                    type:
                        uploadState.selectedFile.type ||
                        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                },
            });

            // Set the result in state for preview
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                result: {
                    success: true,
                    message: `Successfully converted ${uploadState.selectedFile?.name} to HTML`,
                    htmlContent,
                    fileName: uploadState.selectedFile?.name,
                    wordCount,
                },
            }));

            // Log any conversion messages/warnings
            if (messages.length > 0) {
                console.log("Mammoth conversion messages:", messages);
            }
        } catch (error) {
            setUploadState((prev) => ({
                ...prev,
                isUploading: false,
                error: `Failed to convert file: ${
                    error instanceof Error ? error.message : "Unknown error"
                }`,
            }));
        }
    }, [uploadState.selectedFile]);

    const handleReset = useCallback(() => {
        setUploadState({
            selectedFile: null,
            isUploading: false,
            progress: [],
            result: null,
            error: null,
        });
        vscode.postMessage({ command: "reset" });
    }, []);

    const handleDownloadHtml = useCallback(() => {
        if (!uploadState.result?.htmlContent || !uploadState.result?.fileName) return;

        const blob = new Blob([uploadState.result.htmlContent], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = uploadState.result.fileName.replace(".docx", ".html");
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [uploadState.result]);

    const readFileAsArrayBuffer = (file: File): Promise<ArrayBuffer> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (e) => {
                const result = e.target?.result;
                if (result instanceof ArrayBuffer) {
                    resolve(result);
                } else {
                    reject(new Error("Failed to read file as ArrayBuffer"));
                }
            };
            reader.onerror = reject;
            reader.readAsArrayBuffer(file);
        });
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
        type:
            file.type || "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
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
                    DOCX to HTML Converter
                </h1>
                <p className="text-muted-foreground">
                    Upload a DOCX file to convert it to clean HTML using mammoth.js
                </p>
            </div>

            {/* File Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Select DOCX File
                    </CardTitle>
                    <CardDescription>Choose a DOCX file to convert to HTML format</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid w-full max-w-sm items-center gap-1.5">
                        <input
                            type="file"
                            accept=".docx"
                            onChange={handleFileSelect}
                            className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={uploadState.isUploading}
                        />
                    </div>

                    {uploadState.selectedFile && (
                        <Card className="bg-muted/50">
                            <CardContent className="pt-6">
                                <div className="space-y-4">
                                    <div className="flex items-center justify-between">
                                        <span className="font-medium">Selected File:</span>
                                        <Badge variant="outline">DOCX</Badge>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4 text-sm p-2 rounded border">
                                        <div>
                                            <span className="font-medium">File:</span>{" "}
                                            {uploadState.selectedFile.name}
                                        </div>
                                        <div>
                                            <span className="font-medium">Size:</span>{" "}
                                            {formatFileSize(uploadState.selectedFile.size)}
                                        </div>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    <div className="flex gap-2">
                        <Button
                            onClick={handleUpload}
                            disabled={!uploadState.selectedFile || uploadState.isUploading}
                            className="flex items-center gap-2"
                        >
                            {uploadState.isUploading ? (
                                <>
                                    <RotateCcw className="h-4 w-4 animate-spin" />
                                    Converting...
                                </>
                            ) : (
                                <>
                                    <Upload className="h-4 w-4" />
                                    Convert to HTML
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
                            <span>Conversion Progress</span>
                            <Badge variant="outline">
                                {completedSteps}/{totalSteps} completed
                            </Badge>
                        </CardTitle>
                        <CardDescription>
                            Track the progress of your DOCX to HTML conversion
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
                            Conversion {uploadState.result.success ? "Complete" : "Failed"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="p-4 rounded-lg bg-muted">
                            <p className="font-medium">Status:</p>
                            <p className="text-sm text-muted-foreground">
                                {uploadState.result.message}
                            </p>
                            {uploadState.result.wordCount && (
                                <p className="text-sm text-muted-foreground mt-2">
                                    Word count: {uploadState.result.wordCount}
                                </p>
                            )}
                        </div>

                        {uploadState.result.success && uploadState.result.htmlContent && (
                            <>
                                <div className="flex gap-2">
                                    <Button
                                        onClick={handleDownloadHtml}
                                        variant="outline"
                                        className="flex items-center gap-2"
                                    >
                                        <Download className="h-4 w-4" />
                                        Download HTML
                                    </Button>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium">HTML Preview:</h4>
                                    <div className="p-4 rounded-lg bg-muted max-h-60 overflow-y-auto">
                                        <div
                                            className="prose prose-sm max-w-none"
                                            dangerouslySetInnerHTML={{
                                                __html: uploadState.result.htmlContent,
                                            }}
                                        />
                                    </div>
                                </div>

                                <div className="space-y-2">
                                    <h4 className="font-medium">Raw HTML:</h4>
                                    <div className="p-4 rounded-lg bg-muted font-mono text-sm max-h-60 overflow-y-auto">
                                        <pre className="whitespace-pre-wrap">
                                            {uploadState.result.htmlContent}
                                        </pre>
                                    </div>
                                </div>
                            </>
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

            {/* Information Section */}
            <Card>
                <CardHeader>
                    <CardTitle>About DOCX to HTML Conversion</CardTitle>
                    <CardDescription>
                        Information about the conversion process using mammoth.js
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <Badge variant="outline">DOCX</Badge>
                                <span className="text-sm font-medium">Microsoft Word Document</span>
                            </div>
                            <p className="text-sm text-muted-foreground">
                                Converts DOCX files to clean, semantic HTML while preserving
                                formatting
                            </p>
                        </div>
                        <div className="p-4 rounded-lg bg-muted">
                            <p className="text-sm text-muted-foreground">
                                <strong>Features:</strong> Preserves text formatting, paragraphs,
                                lists, tables, and basic styling. Images and complex layouts may
                                require manual adjustment.
                            </p>
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default NewSourceUploader;
