import React, { useState, useCallback, useEffect } from "react";
import {
    Upload,
    FileText,
    CheckCircle,
    XCircle,
    Clock,
    RotateCcw,
    AlertTriangle,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Progress } from "../components/ui/progress";
import { Badge } from "../components/ui/badge";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { cn } from "../lib/utils";
import {
    getAvailableImporters,
    getImporterByExtension,
    isFileTypeSupported,
    getSupportedExtensions,
} from "./importers/registry";
import { ImporterPlugin, WorkflowState, ImportProgress, ImportResult } from "./types/common";
import "./App.css";
import "../tailwind.css";

// Add type definitions for VS Code API
interface VSCodeApi {
    postMessage: (message: any) => void;
    setState: (state: any) => void;
    getState: () => any;
}

// Get the VSCode API that was set up in the HTML
const vscode: VSCodeApi = (window as any).vscodeApi;

interface FileImportButton {
    id: string;
    label: string;
    icon: string;
    description: string;
    extensions: string[];
    enabled: boolean;
    plugin?: ImporterPlugin;
}

interface UploadState {
    selectedFile: File | null;
    currentImporter: ImporterPlugin | null;
    workflowState: WorkflowState;
    progress: ImportProgress[];
    result: ImportResult | null;
    error: string | null;
}

const NewSourceUploader: React.FC = () => {
    const [uploadState, setUploadState] = useState<UploadState>({
        selectedFile: null,
        currentImporter: null,
        workflowState: "idle",
        progress: [],
        result: null,
        error: null,
    });

    // Define available import types
    const importButtons: FileImportButton[] = [
        {
            id: "docx",
            label: "DOCX Documents",
            icon: "file-text",
            description: "Import Microsoft Word DOCX files with rich formatting and images",
            extensions: ["docx"],
            enabled: true,
        },
        {
            id: "markdown",
            label: "Markdown Files",
            icon: "markdown",
            description: "Import Markdown files with section-based splitting",
            extensions: ["md", "markdown"],
            enabled: true,
        },
        {
            id: "ebible",
            label: "eBible Corpus",
            icon: "book",
            description: "Import eBible corpus files in TSV, CSV, or text format",
            extensions: ["tsv", "csv", "txt"],
            enabled: true,
        },
        {
            id: "usfm",
            label: "USFM Files",
            icon: "file-code",
            description: "Import Unified Standard Format Marker biblical text files",
            extensions: ["usfm", "sfm"],
            enabled: false,
        },
        {
            id: "paratext",
            label: "Paratext Projects",
            icon: "database",
            description: "Import Paratext translation projects",
            extensions: ["xml", "ptx"],
            enabled: false,
        },
        {
            id: "obs",
            label: "Open Bible Stories",
            icon: "book-open",
            description:
                "Import Open Bible Stories markdown files with images and story structure from unfoldingWord",
            extensions: ["md", "zip"],
            enabled: false,
        },
        {
            id: "subtitles",
            label: "Subtitle Files",
            icon: "captions",
            description: "Import VTT, SRT, or other subtitle files",
            extensions: ["vtt", "srt", "ass"],
            enabled: false,
        },
    ];

    // Get available importers and update button availability
    const availableImporters = getAvailableImporters();
    const updatedButtons = importButtons.map((button) => {
        const hasPlugin = availableImporters.some((importer) =>
            importer.supportedExtensions.some((ext) => button.extensions.includes(ext))
        );
        return {
            ...button,
            enabled: hasPlugin,
            plugin: hasPlugin
                ? availableImporters.find((importer) =>
                      importer.supportedExtensions.some((ext) => button.extensions.includes(ext))
                  )
                : undefined,
        };
    });

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (!file) {
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                currentImporter: null,
                result: null,
                error: null,
                progress: [],
                workflowState: "idle",
            }));
            return;
        }

        // Check if file type is supported
        const importer = getImporterByExtension(file.name);
        if (!importer) {
            const supportedExts = getSupportedExtensions().join(", ");
            setUploadState((prev) => ({
                ...prev,
                selectedFile: null,
                currentImporter: null,
                error: `Unsupported file type. Supported extensions: ${supportedExts}`,
                workflowState: "error",
            }));
            return;
        }

        setUploadState((prev) => ({
            ...prev,
            selectedFile: file,
            currentImporter: importer,
            result: null,
            error: null,
            progress: [],
            workflowState: "idle",
        }));
    }, []);

    const handleUpload = useCallback(async () => {
        if (!uploadState.selectedFile || !uploadState.currentImporter) return;

        setUploadState((prev) => ({ ...prev, workflowState: "validating", error: null }));

        try {
            const progressCallback = (progress: ImportProgress) => {
                setUploadState((prev) => ({
                    ...prev,
                    progress: [
                        ...prev.progress.filter((p) => p.stage !== progress.stage),
                        progress,
                    ],
                    workflowState: progress.status,
                }));
            };

            // Step 1: Validate file
            progressCallback({
                stage: "File Validation",
                message: "Validating file...",
                status: "validating",
                progress: 10,
            });

            const validation = await uploadState.currentImporter.validateFile(
                uploadState.selectedFile
            );

            if (!validation.isValid) {
                throw new Error(`Validation failed: ${validation.errors.join(", ")}`);
            }

            progressCallback({
                stage: "File Validation",
                message: "File validated successfully",
                status: "complete",
                progress: 20,
            });

            // Step 2: Parse file
            const result = await uploadState.currentImporter.parseFile(
                uploadState.selectedFile,
                progressCallback
            );

            if (!result.success) {
                throw new Error(result.error || "Unknown parsing error");
            }

            // Step 3: Send to backend
            if (result.notebookPair) {
                vscode.postMessage({
                    command: "uploadFile",
                    fileData: {
                        name: uploadState.selectedFile.name,
                        importerType: uploadState.currentImporter.name,
                        notebookPair: result.notebookPair,
                        metadata: result.metadata,
                    },
                });
            }

            setUploadState((prev) => ({
                ...prev,
                result,
                workflowState: "complete",
            }));
        } catch (error) {
            setUploadState((prev) => ({
                ...prev,
                error: error instanceof Error ? error.message : "Unknown error occurred",
                workflowState: "error",
            }));
        }
    }, [uploadState.selectedFile, uploadState.currentImporter]);

    const handleReset = useCallback(() => {
        setUploadState({
            selectedFile: null,
            currentImporter: null,
            workflowState: "idle",
            progress: [],
            result: null,
            error: null,
        });
        vscode.postMessage({ command: "reset" });
    }, []);

    const handleButtonClick = (button: FileImportButton) => {
        if (!button.enabled) return;

        // Special handling for OBS repository download
        if (button.id === "obs") {
            // Show options: Upload File or Download from Repository
            handleObsImportOptions();
            return;
        }

        // Create a file input for the specific extensions
        const input = document.createElement("input");
        input.type = "file";
        input.accept = button.extensions.map((ext) => `.${ext}`).join(",");
        input.addEventListener("change", (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files[0]) {
                const syntheticEvent = {
                    target: { files: target.files },
                    currentTarget: target,
                } as any;
                handleFileSelect(syntheticEvent);
            }
        });
        input.click();
    };

    const handleObsImportOptions = () => {
        // Create a modal-like selection for OBS import options
        const optionContainer = document.createElement("div");
        optionContainer.style.cssText = `
            position: fixed;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            background: rgba(0, 0, 0, 0.5);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 1000;
        `;

        const optionDialog = document.createElement("div");
        optionDialog.style.cssText = `
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-widget-border);
            border-radius: 4px;
            padding: 20px;
            max-width: 400px;
            width: 90%;
        `;

        optionDialog.innerHTML = `
            <h3 style="margin: 0 0 16px 0; color: var(--vscode-editor-foreground);">
                Open Bible Stories Import Options
            </h3>
            <p style="margin: 0 0 20px 0; color: var(--vscode-descriptionForeground); font-size: 14px;">
                Choose how you want to import Open Bible Stories content:
            </p>
            <div style="display: flex; flex-direction: column; gap: 12px;">
                <button id="obs-upload-file" style="
                    padding: 12px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: left;
                ">
                    <strong>📁 Upload File</strong><br>
                    <small>Upload individual .md story files</small>
                </button>
                <button id="obs-download-repo" style="
                    padding: 12px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: 4px;
                    cursor: pointer;
                    text-align: left;
                ">
                    <strong>🌐 Download from Repository</strong><br>
                    <small>Download all 50 stories from git.door43.org</small>
                </button>
                <button id="obs-cancel" style="
                    padding: 8px 12px;
                    background: transparent;
                    color: var(--vscode-button-foreground);
                    border: 1px solid var(--vscode-widget-border);
                    border-radius: 4px;
                    cursor: pointer;
                ">
                    Cancel
                </button>
            </div>
        `;

        optionContainer.appendChild(optionDialog);
        document.body.appendChild(optionContainer);

        // Handle button clicks
        document.getElementById("obs-upload-file")?.addEventListener("click", () => {
            document.body.removeChild(optionContainer);
            // Trigger file upload
            const input = document.createElement("input");
            input.type = "file";
            input.accept = ".md,.zip";
            input.addEventListener("change", (e) => {
                const target = e.target as HTMLInputElement;
                if (target.files && target.files[0]) {
                    const syntheticEvent = {
                        target: { files: target.files },
                        currentTarget: target,
                    } as any;
                    handleFileSelect(syntheticEvent);
                }
            });
            input.click();
        });

        document.getElementById("obs-download-repo")?.addEventListener("click", () => {
            document.body.removeChild(optionContainer);
            // Trigger repository download by creating a special file object
            handleObsRepositoryDownload();
        });

        document.getElementById("obs-cancel")?.addEventListener("click", () => {
            document.body.removeChild(optionContainer);
        });

        // Close on outside click
        optionContainer.addEventListener("click", (e) => {
            if (e.target === optionContainer) {
                document.body.removeChild(optionContainer);
            }
        });
    };

    const handleObsRepositoryDownload = () => {
        // Create a special file object to indicate repository download
        const repositoryFile = new File(["repository-download"], "obs-repository-download.md", {
            type: "text/markdown",
        });

        // Find the OBS importer
        const obsImporter = getImporterByExtension("obs-repository-download.md");
        if (!obsImporter) {
            setUploadState((prev) => ({
                ...prev,
                error: "OBS importer not available",
                workflowState: "error",
            }));
            return;
        }

        setUploadState((prev) => ({
            ...prev,
            selectedFile: repositoryFile,
            currentImporter: obsImporter,
            result: null,
            error: null,
            progress: [],
            workflowState: "idle",
        }));
    };

    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    const getStatusIcon = (status: WorkflowState) => {
        switch (status) {
            case "complete":
                return <CheckCircle className="h-4 w-4 text-green-500" />;
            case "error":
                return <XCircle className="h-4 w-4 text-red-500" />;
            case "validating":
            case "parsing":
            case "processing":
                return <RotateCcw className="h-4 w-4 text-blue-500 animate-spin" />;
            default:
                return <Clock className="h-4 w-4 text-gray-400" />;
        }
    };

    const getStatusBadgeVariant = (status: WorkflowState) => {
        switch (status) {
            case "complete":
                return "default" as const;
            case "error":
                return "destructive" as const;
            case "validating":
            case "parsing":
            case "processing":
                return "secondary" as const;
            default:
                return "secondary" as const;
        }
    };

    // Handle messages from the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;

            switch (message.command) {
                case "uploadResult":
                    setUploadState((prev) => ({
                        ...prev,
                        workflowState: message.result?.success ? "complete" : "error",
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
                        workflowState: "error",
                        error: message.error || "Unknown error occurred",
                    }));
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const completedSteps = uploadState.progress.filter((p) => p.status === "complete").length;
    const totalSteps = uploadState.progress.length;
    const progressPercentage = totalSteps > 0 ? (completedSteps / totalSteps) * 100 : 0;

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            {/* Header */}
            <div className="text-center space-y-2">
                <h1 className="text-3xl font-bold flex items-center justify-center gap-2">
                    <Upload className="h-8 w-8" />
                    Source File Importer
                </h1>
                <p className="text-muted-foreground">
                    Import various file types into Codex translation notebooks
                </p>
            </div>

            {/* Import Type Selection */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <FileText className="h-5 w-5" />
                        Select Import Type
                    </CardTitle>
                    <CardDescription>Choose the type of file you want to import</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                        {updatedButtons.map((button) => (
                            <Tooltip key={button.id}>
                                <TooltipTrigger asChild>
                                    <Button
                                        variant={button.enabled ? "outline" : "ghost"}
                                        onClick={() => handleButtonClick(button)}
                                        disabled={!button.enabled}
                                        className={cn(
                                            "group relative p-4 h-auto text-left justify-start",
                                            button.enabled
                                                ? "hover:bg-primary/5 hover:border-primary/20"
                                                : "opacity-50 cursor-not-allowed"
                                        )}
                                    >
                                        <div className="flex flex-col gap-3 w-full">
                                            <div className="flex items-center gap-3">
                                                <div
                                                    className={cn(
                                                        "flex items-center justify-center w-10 h-10 rounded-md transition-colors",
                                                        button.enabled
                                                            ? "bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary"
                                                            : "bg-muted/50 text-muted-foreground/50"
                                                    )}
                                                >
                                                    <i
                                                        className={`codicon codicon-${button.icon} text-lg`}
                                                    />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <h3 className="font-medium text-sm leading-tight">
                                                        {button.label}
                                                    </h3>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {button.extensions
                                                            .slice(0, 3)
                                                            .map((ext) => (
                                                                <Badge
                                                                    key={ext}
                                                                    variant="secondary"
                                                                    className="text-xs"
                                                                >
                                                                    .{ext}
                                                                </Badge>
                                                            ))}
                                                        {button.extensions.length > 3 && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                +{button.extensions.length - 3}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                {!button.enabled && (
                                                    <AlertTriangle className="h-4 w-4 text-muted-foreground/50" />
                                                )}
                                            </div>
                                        </div>
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <div className="max-w-xs">
                                        <p className="font-medium">{button.label}</p>
                                        <p className="text-sm text-muted-foreground mt-1">
                                            {button.description}
                                        </p>
                                        <p className="text-xs text-muted-foreground mt-2">
                                            Extensions: {button.extensions.join(", ")}
                                        </p>
                                        {!button.enabled && (
                                            <p className="text-xs text-amber-600 mt-1">
                                                Plugin not yet implemented
                                            </p>
                                        )}
                                    </div>
                                </TooltipContent>
                            </Tooltip>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Selected File */}
            {uploadState.selectedFile && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>
                                {uploadState.selectedFile.name === "obs-repository-download.md"
                                    ? "Repository Download"
                                    : "Selected File"}
                            </span>
                            <Badge variant="outline">
                                {uploadState.currentImporter?.name || "Unknown"}
                            </Badge>
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-4 p-4 rounded-lg border bg-muted/50">
                            {uploadState.selectedFile.name === "obs-repository-download.md" ? (
                                <div className="h-8 w-8 text-muted-foreground flex items-center justify-center">
                                    🌐
                                </div>
                            ) : (
                                <FileText className="h-8 w-8 text-muted-foreground" />
                            )}
                            <div className="flex-1 space-y-1">
                                <p className="font-medium">
                                    {uploadState.selectedFile.name === "obs-repository-download.md"
                                        ? "Open Bible Stories - Complete Repository"
                                        : uploadState.selectedFile.name}
                                </p>
                                <p className="text-sm text-muted-foreground">
                                    {uploadState.selectedFile.name === "obs-repository-download.md"
                                        ? "All 50 stories from git.door43.org"
                                        : formatFileSize(uploadState.selectedFile.size)}
                                </p>
                            </div>
                            <div className="flex gap-2">
                                <Button
                                    onClick={handleUpload}
                                    disabled={uploadState.workflowState === "processing"}
                                    className="flex items-center gap-2"
                                >
                                    {uploadState.workflowState === "processing" ? (
                                        <>
                                            <RotateCcw className="h-4 w-4 animate-spin" />
                                            Processing...
                                        </>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4" />
                                            Import File
                                        </>
                                    )}
                                </Button>
                                <Button onClick={handleReset} variant="outline">
                                    Reset
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Progress Section */}
            {uploadState.progress.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span>Import Progress</span>
                            <Badge variant={getStatusBadgeVariant(uploadState.workflowState)}>
                                {uploadState.workflowState}
                            </Badge>
                        </CardTitle>
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
                                        {item.progress !== undefined && (
                                            <Progress
                                                value={item.progress}
                                                className="w-full h-2"
                                            />
                                        )}
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
                            Import {uploadState.result.success ? "Complete" : "Failed"}
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {uploadState.result.success && uploadState.result.notebookPair && (
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                <div className="p-4 rounded-lg bg-muted">
                                    <h4 className="font-medium text-sm mb-2">Source Notebook</h4>
                                    <p className="text-sm text-muted-foreground">
                                        {uploadState.result.notebookPair.source.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {uploadState.result.notebookPair.source.cells.length} cells
                                    </p>
                                </div>
                                <div className="p-4 rounded-lg bg-muted">
                                    <h4 className="font-medium text-sm mb-2">Codex Notebook</h4>
                                    <p className="text-sm text-muted-foreground">
                                        {uploadState.result.notebookPair.codex.name}
                                    </p>
                                    <p className="text-xs text-muted-foreground">
                                        {uploadState.result.notebookPair.codex.cells.length} cells
                                        (ready for translation)
                                    </p>
                                </div>
                            </div>
                        )}

                        {uploadState.result.metadata && (
                            <div className="p-4 rounded-lg bg-muted">
                                <h4 className="font-medium text-sm mb-2">Import Metadata</h4>
                                <pre className="text-xs text-muted-foreground whitespace-pre-wrap">
                                    {JSON.stringify(uploadState.result.metadata, null, 2)}
                                </pre>
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
        </div>
    );
};

export default NewSourceUploader;
