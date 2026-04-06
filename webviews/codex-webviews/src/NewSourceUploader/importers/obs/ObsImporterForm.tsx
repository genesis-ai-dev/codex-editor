import React, { useState, useCallback } from "react";
import {
    UnifiedImporterForm,
    type FileAnalysisStat,
} from "../../components/UnifiedImporterForm";
import {
    ImporterComponentProps,
    AlignedCell,
    CellAligner,
    ImportedContent,
    sequentialCellAligner,
} from "../../types/plugin";
import { NotebookPair, ImportProgress } from "../../types/common";
import { Button } from "../../../components/ui/button";
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
    BookOpen,
    Globe,
} from "lucide-react";
import { obsImporter } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { notifyImportStarted, notifyImportEnded } from "../../utils/importProgress";
import { AlignmentPreview } from "../../components/AlignmentPreview";

function detectObsFormat(file: File): string {
    const n = file.name.toLowerCase();
    if (n.endsWith(".zip")) {
        return "ZIP archive";
    }
    if (n.endsWith(".md")) {
        return "Markdown";
    }
    return "Unknown";
}

async function analyzeObsFiles(files: File[]): Promise<FileAnalysisStat[]> {
    if (files.length === 0) {
        return [];
    }
    const totalBytes = files.reduce((sum, f) => sum + f.size, 0);
    const nameLabel = files.length === 1 ? "File name" : "File names";
    const nameValue =
        files.length === 1
            ? files[0].name
            : files.map((f) => f.name).join(", ");
    const formatSummary =
        files.length === 1
            ? detectObsFormat(files[0])
            : files.map((f) => `${f.name}: ${detectObsFormat(f)}`).join("; ");
    return [
        { label: nameLabel, value: nameValue },
        { label: "Total size", value: `${(totalBytes / 1024).toFixed(1)} KB` },
        { label: "Detected format", value: formatSummary },
    ];
}

export const ObsImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [activeTab, setActiveTab] = useState<"upload" | "download">("download");
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | NotebookPair[] | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const processUploadFiles = useCallback(
        async (
            files: File[],
            onProgress: (progress: ImportProgress) => void
        ): Promise<NotebookPair | NotebookPair[]> => {
            const results: NotebookPair[] = [];
            for (const file of files) {
                const importResult = await obsImporter.parseFile(file, onProgress);
                if (importResult.success) {
                    if (importResult.notebookPairs) {
                        results.push(...importResult.notebookPairs);
                    } else if (importResult.notebookPair) {
                        results.push(importResult.notebookPair);
                    } else {
                        throw new Error(`No notebook pairs returned from ${file.name}`);
                    }
                } else {
                    throw new Error(importResult.error || `Failed to process ${file.name}`);
                }
            }
            return results.length === 1 ? results[0] : results;
        },
        []
    );

    const handleRepositoryDownload = useCallback(async () => {
        notifyImportStarted();
        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

        try {
            const onProgress = (p: ImportProgress) => {
                setProgress((prev) => [...prev.filter((x) => x.stage !== p.stage), p]);
            };

            const repositoryFile = new File(["repository-download"], "obs-repository-download.md", {
                type: "text/markdown",
            });

            const importResult = await obsImporter.parseFile(repositoryFile, onProgress);

            if (importResult.success) {
                let notebookResult: NotebookPair | NotebookPair[];
                if (importResult.notebookPairs) {
                    notebookResult = importResult.notebookPairs;
                } else if (importResult.notebookPair) {
                    notebookResult = importResult.notebookPair;
                } else {
                    throw new Error("No notebook pairs returned from repository download");
                }

                setResult(notebookResult);

                if (isTranslationImport && alignContent && selectedSource) {
                    onProgress({
                        stage: "Alignment",
                        message: "Aligning OBS content with target cells...",
                        progress: 80,
                    });

                    setIsAligning(true);

                    try {
                        const primaryNotebook = Array.isArray(notebookResult)
                            ? notebookResult[0]
                            : notebookResult;
                        const content = notebookToImportedContent(primaryNotebook);
                        setImportedContent(content);

                        const aligned = await alignContent(
                            content,
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
                throw new Error(importResult.error || "Download failed");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
            notifyImportEnded();
        } finally {
            setIsProcessing(false);
        }
    }, [isTranslationImport, alignContent, selectedSource]);

    const handleComplete = useCallback(async () => {
        if (result) {
            try {
                await handleImportCompletion(result, props);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to complete import");
                notifyImportEnded();
            }
        }
    }, [result, props]);

    const handleConfirmAlignment = () => {
        if (!alignedCells || !selectedSource || !onTranslationComplete) return;
        onTranslationComplete(alignedCells, selectedSource.path);
    };

    const handleRetryAlignment = async (aligner: CellAligner) => {
        if (!alignContent || !selectedSource || !importedContent.length) return;

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

    const isDownloadComplete = result !== null && activeTab === "download";
    const currentStage = progress.length > 0 ? progress[progress.length - 1] : null;

    if (alignedCells && isTranslationImport) {
        return (
            <AlignmentPreview
                alignedCells={alignedCells}
                importedContent={importedContent}
                targetCells={[]}
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
            <div className="flex items-center gap-4">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <BookOpen className="h-6 w-6" />
                        Open Bible Stories Importer {isTranslationImport && "(Translation)"}
                    </h1>
                    <p className="text-muted-foreground">
                        {isTranslationImport && selectedSource
                            ? `Importing OBS translation for: ${selectedSource.name}`
                            : "Import OBS content from individual files or download all stories"}
                    </p>
                </div>
            </div>

            <Tabs
                value={activeTab}
                onValueChange={(value) => setActiveTab(value as "upload" | "download")}
            >
                <TabsList className="grid w-full grid-cols-2">
                    <TabsTrigger value="download" className="flex items-center gap-2">
                        <Globe className="h-4 w-4" />
                        Download All
                    </TabsTrigger>
                    <TabsTrigger value="upload" className="flex items-center gap-2">
                        <Upload className="h-4 w-4" />
                        Upload Files
                    </TabsTrigger>
                </TabsList>

                <TabsContent value="download" className="space-y-6">
                    <Card>
                        <CardHeader>
                            <CardTitle className="flex items-center gap-2">
                                <Download className="h-5 w-5" />
                                Download All Stories
                            </CardTitle>
                            <CardDescription>
                                Download all 50 Open Bible Stories from unfoldingWord
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="bg-muted p-4 rounded-lg space-y-2">
                                <div className="flex items-center gap-2">
                                    <ExternalLink className="h-4 w-4 text-muted-foreground" />
                                    <span className="font-medium">Source</span>
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

                            <p className="text-sm text-muted-foreground">
                                This will download and process all 50 Open Bible Stories with their
                                accompanying images. Each story will be created as a separate
                                notebook pair.
                            </p>

                            <Button
                                onClick={handleRepositoryDownload}
                                disabled={isProcessing || isDownloadComplete}
                                variant="outline"
                                className="gap-2"
                            >
                                {isProcessing ? (
                                    <>Downloading...</>
                                ) : isDownloadComplete ? (
                                    <>
                                        <CheckCircle className="h-4 w-4" />
                                        Downloaded
                                    </>
                                ) : (
                                    <>
                                        <Download className="h-4 w-4" />
                                        Download All Stories
                                    </>
                                )}
                            </Button>
                        </CardContent>
                    </Card>

                    {/* Progress */}
                    {isProcessing && (
                        <div className="space-y-3">
                            <Progress value={progressPercentage} className="w-full" />
                            {currentStage && (
                                <div className="text-sm text-muted-foreground">
                                    {currentStage.stage}: {currentStage.message}{" "}
                                    <span className="text-xs">({progressPercentage}%)</span>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Error */}
                    {error && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* File Analysis (after download) */}
                    {isDownloadComplete && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <CheckCircle className="h-4 w-4 text-green-500" />
                                    File Analysis
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-3">
                                <div className="grid grid-cols-2 gap-3 text-sm">
                                    <div>
                                        <span className="font-medium text-muted-foreground">Stories</span>
                                        <p>{Array.isArray(result) ? result.length : 1}</p>
                                    </div>
                                    <div>
                                        <span className="font-medium text-muted-foreground">Total Cells</span>
                                        <p>
                                            {Array.isArray(result)
                                                ? result.reduce((sum, pair) => sum + pair.source.cells.length, 0).toLocaleString()
                                                : result?.source.cells.length.toLocaleString() ?? 0}
                                        </p>
                                    </div>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Finish Import */}
                    <Button
                        onClick={handleComplete}
                        disabled={!isDownloadComplete}
                        className="w-full h-12 text-base"
                        variant={isDownloadComplete ? "default" : "secondary"}
                    >
                        Finish Import
                    </Button>
                </TabsContent>

                <TabsContent value="upload" className="space-y-4">
                    <UnifiedImporterForm
                        title="Open Bible Stories Importer"
                        description="Upload individual OBS markdown files or zip archives containing multiple stories. Images in markdown are converted for display in the editor."
                        icon={BookOpen}
                        accept=".md,.zip"
                        extensionBadges={[".md", ".zip"]}
                        multipleFiles
                        analyzeFiles={analyzeObsFiles}
                        processFiles={processUploadFiles}
                        importerProps={props}
                        cellAligner={sequentialCellAligner}
                        showPreview
                    />
                </TabsContent>
            </Tabs>
        </div>
    );
};
