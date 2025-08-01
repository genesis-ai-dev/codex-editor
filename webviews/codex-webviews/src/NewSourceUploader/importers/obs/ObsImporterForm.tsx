import React, { useState, useCallback } from "react";
import {
    ImporterComponentProps,
    AlignedCell,
    CellAligner,
    ImportedContent,
    sequentialCellAligner,
} from "../../types/plugin";
import { NotebookPair, ImportProgress } from "../../types/common";
import { Button } from "../../../components/ui/button";
import { Label } from "../../../components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";
import {
    Upload,
    Download,
    ExternalLink,
    CheckCircle,
    XCircle,
    ArrowLeft,
    BookOpen,
    FileText,
    Globe,
} from "lucide-react";
import { obsImporter } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";

export const ObsImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [activeTab, setActiveTab] = useState<"upload" | "download">("download");
    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | NotebookPair[] | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(event.target.files || []);
        setSelectedFiles(files);
        setError(null);
    }, []);

    const handleRepositoryDownload = useCallback(async () => {
        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

        try {
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            // Create a special file object to indicate repository download
            const repositoryFile = new File(["repository-download"], "obs-repository-download.md", {
                type: "text/markdown",
            });

            const result = await obsImporter.parseFile(repositoryFile, onProgress);

            if (result.success) {
                // Handle both single and multiple notebook pairs
                let notebookResult;
                if (result.notebookPairs) {
                    notebookResult = result.notebookPairs;
                } else if (result.notebookPair) {
                    notebookResult = result.notebookPair;
                } else {
                    throw new Error("No notebook pairs returned from repository download");
                }

                setResult(notebookResult);

                // For translation imports, perform alignment
                if (isTranslationImport && alignContent && selectedSource) {
                    onProgress({
                        stage: "Alignment",
                        message: "Aligning OBS content with target cells...",
                        progress: 80,
                    });

                    setIsAligning(true);

                    try {
                        // For multi-file imports, we'll use the first file for now
                        const primaryNotebook = Array.isArray(notebookResult)
                            ? notebookResult[0]
                            : notebookResult;
                        const importedContent = notebookToImportedContent(primaryNotebook);
                        setImportedContent(importedContent);

                        // Use sequential cell aligner for OBS (structured story content)
                        const aligned = await alignContent(
                            importedContent,
                            selectedSource.path,
                            sequentialCellAligner
                        );

                        setAlignedCells(aligned);
                        setIsAligning(false);

                        onProgress({
                            stage: "Complete",
                            message: "Alignment complete - review and confirm",
                            progress: 100,
                        });
                    } catch (err) {
                        setIsAligning(false);
                        throw new Error(
                            `Alignment failed: ${
                                err instanceof Error ? err.message : "Unknown error"
                            }`
                        );
                    }
                }
            } else {
                throw new Error(result.error || "Repository download failed");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
        } finally {
            setIsProcessing(false);
        }
    }, [isTranslationImport, alignContent, selectedSource]);

    const handleFileUpload = useCallback(async () => {
        if (selectedFiles.length === 0) {
            setError("Please select at least one file");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

        try {
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            // Process multiple files if needed
            const results: NotebookPair[] = [];

            for (const file of selectedFiles) {
                const result = await obsImporter.parseFile(file, onProgress);

                if (result.success) {
                    // Handle both single and multiple notebook pairs
                    if (result.notebookPairs) {
                        results.push(...result.notebookPairs);
                    } else if (result.notebookPair) {
                        results.push(result.notebookPair);
                    } else {
                        throw new Error(`No notebook pairs returned from ${file.name}`);
                    }
                } else {
                    throw new Error(result.error || `Failed to process ${file.name}`);
                }
            }

            const notebookResult = results.length === 1 ? results[0] : results;
            setResult(notebookResult);

            // For translation imports, perform alignment
            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning OBS content with target cells...",
                    progress: 80,
                });

                setIsAligning(true);

                try {
                    // For multi-file imports, we'll use the first file for now
                    const primaryNotebook = Array.isArray(notebookResult)
                        ? notebookResult[0]
                        : notebookResult;
                    const importedContent = notebookToImportedContent(primaryNotebook);
                    setImportedContent(importedContent);

                    // Use sequential cell aligner for OBS (structured story content)
                    const aligned = await alignContent(
                        importedContent,
                        selectedSource.path,
                        sequentialCellAligner
                    );

                    setAlignedCells(aligned);
                    setIsAligning(false);

                    onProgress({
                        stage: "Complete",
                        message: "Alignment complete - review and confirm",
                        progress: 100,
                    });
                } catch (err) {
                    setIsAligning(false);
                    throw new Error(
                        `Alignment failed: ${err instanceof Error ? err.message : "Unknown error"}`
                    );
                }
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
        } finally {
            setIsProcessing(false);
        }
    }, [selectedFiles, isTranslationImport, alignContent, selectedSource]);

    const handleComplete = useCallback(async () => {
        if (result) {
            try {
                // Handle both single and array results - pass all notebooks for batch import
                await handleImportCompletion(result, props);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to complete import");
            }
        }
    }, [result, props]);

    const handleConfirmAlignment = () => {
        if (!alignedCells || !selectedSource || !onTranslationComplete) return;
        onTranslationComplete(alignedCells, selectedSource.path);
    };

    const handleRetryAlignment = async (aligner: CellAligner) => {
        if (!alignContent || !selectedSource || !importedContent) return;

        setIsRetrying(true);
        setError(null);

        try {
            const aligned = await alignContent(importedContent, selectedSource.path, aligner);
            setAlignedCells(aligned);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Alignment retry failed");
        } finally {
            setIsRetrying(false);
        }
    };

    const handleCancel = useCallback(() => {
        onCancel();
    }, [onCancel]);

    const progressPercentage =
        progress.length > 0 ? Math.max(...progress.map((p) => p.progress || 0)) : 0;

    const isComplete = result !== null;
    const currentStage = progress.length > 0 ? progress[progress.length - 1] : null;

    // Render alignment preview for translation imports
    if (alignedCells && isTranslationImport) {
        return (
            <AlignmentPreview
                alignedCells={alignedCells}
                importedContent={importedContent}
                targetCells={targetCells}
                sourceCells={
                    Array.isArray(result)
                        ? result[0]?.source.cells || []
                        : result?.source.cells || []
                }
                selectedSourceName={selectedSource?.name}
                onConfirm={handleConfirmAlignment}
                onCancel={handleCancel}
                onRetryAlignment={handleRetryAlignment}
                isRetrying={isRetrying}
            />
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="flex items-center gap-4">
                <Button variant="ghost" size="sm" onClick={handleCancel}>
                    <ArrowLeft className="h-4 w-4 mr-2" />
                    Back
                </Button>
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <BookOpen className="h-6 w-6" />
                        Open Bible Stories Importer {isTranslationImport && "(Translation)"}
                    </h1>
                    <p className="text-muted-foreground">
                        {isTranslationImport && selectedSource
                            ? `Importing OBS translation for: ${selectedSource.name}`
                            : "Import OBS content from individual files or the complete repository"}
                    </p>
                </div>
            </div>

            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {isComplete && (
                <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <AlertDescription>
                        Successfully imported Open Bible Stories content! Ready to create notebooks.
                    </AlertDescription>
                </Alert>
            )}

            <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as "upload" | "download")}
            >
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="download" className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Download Repository
                    </TabsTrigger>
                    <TabsTrigger value="upload" className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Files
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="download" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Download className="h-5 w-5" />
                                Download Complete Repository
                            </CardTitle>
                            <CardDescription>
                                Download all 50 Open Bible Stories from the unfoldingWord repository
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-muted p-4 rounded-lg space-y-2">
                                <div className="flex items-center gap-2">
                                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">Source Repository</span>
                                </div>
                                <p className="text-sm text-muted-foreground">
                                    git.door43.org/unfoldingWord/en_obs
                                </p>
                                <div className="flex gap-2">
                                    <Badge variant="outline">All Stories</Badge>
                                    <Badge variant="outline">With Images</Badge>
                                    <Badge variant="outline">English</Badge>
                                </div>
                            </div>

                            <div className="space-y-2">
                                <p className="text-sm text-muted-foreground">
                                    This will download and process all 50 Open Bible Stories with
                                    their accompanying images. Each story will be created as a
                                    separate notebook pair.
                                </p>
                            </div>

                            {!isProcessing && !isComplete && (
                                <Button onClick={handleRepositoryDownload} className="w-full">
                                    <Download className="h-4 w-4 mr-2" />
                                    Download Complete Repository
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>

                <TabsContent value="upload" className="space-y-4">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <FileText className="h-5 w-5" />
                                Upload OBS Files
                            </CardTitle>
                            <CardDescription>
                                Upload individual OBS markdown files or collections
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="space-y-2">
                                <Label htmlFor="obs-files">Select OBS Files</Label>
                                <input
                                    id="obs-files"
                                    type="file"
                                    accept=".md,.zip"
                                    multiple
                                    onChange={handleFileSelect}
                                    className="w-full text-sm text-muted-foreground
                                        file:mr-4 file:py-2 file:px-4
                                        file:rounded-md file:border-0
                                        file:text-sm file:font-semibold
                                        file:bg-primary file:text-primary-foreground
                                        hover:file:bg-primary/90"
                                />
                            </div>

                            {selectedFiles.length > 0 && (
                                <div className="space-y-2">
                                    <Label>Selected Files ({selectedFiles.length})</Label>
                                    <div className="max-h-32 overflow-y-auto space-y-1">
                                        {selectedFiles.map((file, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center gap-2 p-2 bg-muted rounded text-sm"
                                            >
                                                <FileText className="h-4 w-4 text-muted-foreground" />
                                                <span className="flex-1">{file.name}</span>
                                                <span className="text-muted-foreground">
                                                    {(file.size / 1024).toFixed(1)} KB
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            <div className="bg-muted p-4 rounded-lg space-y-2">
                                <p className="text-sm font-medium">Supported Formats</p>
                                <div className="flex flex-wrap gap-1">
                                    <Badge variant="outline">.md</Badge>
                                    <Badge variant="outline">.zip</Badge>
                                </div>
                                <p className="text-xs text-muted-foreground">
                                    Upload individual story markdown files or zip archives
                                    containing multiple stories.
                                </p>
                            </div>

                            {!isProcessing && !isComplete && selectedFiles.length > 0 && (
                                <Button onClick={handleFileUpload} className="w-full">
                                    <Upload className="h-4 w-4 mr-2" />
                                    Process {selectedFiles.length} File
                                    {selectedFiles.length !== 1 ? "s" : ""}
                                </Button>
                            )}
                        </CardContent>
                    </Card>
                </TabsContent>
            </Tabs>

            {/* Progress Section */}
            {isProcessing && (
                <Card>
                    <CardHeader>
                        <CardTitle>Processing...</CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span>{currentStage?.stage || "Processing"}</span>
                                <span>{progressPercentage}%</span>
                            </div>
                            <Progress value={progressPercentage} className="w-full" />
                            {currentStage && (
                                <p className="text-sm text-muted-foreground">
                                    {currentStage.message}
                                </p>
                            )}
                        </div>

                        {progress.length > 0 && (
                            <div className="space-y-1">
                                {progress.map((p, index) => (
                                    <div key={index} className="flex justify-between text-xs">
                                        <span className="text-muted-foreground">{p.stage}</span>
                                        <CheckCircle className="h-3 w-3 text-green-500" />
                                    </div>
                                ))}
                            </div>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Results Section */}
            {isComplete && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <CheckCircle className="h-5 w-5 text-green-500" />
                            Import Complete
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        {Array.isArray(result) ? (
                            <div>
                                <p className="text-sm text-muted-foreground mb-2">
                                    Successfully processed {result.length} notebook pairs
                                </p>
                                <div className="space-y-1 max-h-32 overflow-y-auto">
                                    {result.map((pair, index) => (
                                        <div key={index} className="text-sm p-2 bg-muted rounded">
                                            {pair.source.name}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        ) : (
                            <p className="text-sm text-muted-foreground">
                                Successfully processed: {result?.source.name}
                            </p>
                        )}

                        <div className="flex gap-2">
                            <Button onClick={handleComplete} className="flex-1">
                                Create Notebooks
                            </Button>
                            <Button variant="outline" onClick={handleCancel}>
                                Cancel
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            )}
        </div>
    );
};
