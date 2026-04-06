import React, { useState, useCallback, useRef } from "react";
import { Button } from "../../components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import { Progress } from "../../components/ui/progress";
import { Alert, AlertDescription } from "../../components/ui/alert";
import { Badge } from "../../components/ui/badge";
import {
    Upload,
    CheckCircle,
    XCircle,
    Eye,
    BarChart3,
    AlertCircle,
} from "lucide-react";
import { ImporterComponentProps, CellAligner, AlignedCell } from "../types/plugin";
import { NotebookPair, ImportProgress } from "../types/common";
import EnforceStructureCheckbox from "./EnforceStructureCheckbox";
import {
    handleImportCompletion,
    notebookToImportedContent,
} from "../importers/common/translationHelper";
import { notifyImportStarted, notifyImportEnded } from "../utils/importProgress";
import { AlignmentPreview } from "./AlignmentPreview";

export interface FileAnalysisStat {
    label: string;
    value: string | number;
}

export interface UnifiedImporterFormProps {
    title: string;
    description: string;
    icon: React.ComponentType<{ className?: string }>;
    accept: string;
    extensionBadges?: string[];
    multipleFiles?: boolean;

    /**
     * Called when files are selected. Returns analysis stats.
     * If not provided, a default analysis with file size is shown.
     */
    analyzeFiles?: (files: File[]) => Promise<FileAnalysisStat[]>;

    /**
     * Called when "Finish Import" is clicked. Should validate, parse,
     * and return NotebookPair(s).
     */
    processFiles: (
        files: File[],
        onProgress: (progress: ImportProgress) => void
    ) => Promise<NotebookPair | NotebookPair[]>;

    importerProps: ImporterComponentProps;

    cellAligner?: CellAligner;

    /**
     * If true, shows a text preview of the file (first 500 chars).
     * Defaults to true for text files.
     */
    showPreview?: boolean;

    /**
     * When set, called for source imports instead of {@link handleImportCompletion}
     * (e.g. spreadsheet import with writeNotebooksWithAttachments).
     */
    onSourceImportComplete?: (
        result: NotebookPair | NotebookPair[]
    ) => void | Promise<void>;

    /** Show the "Round-trip enforce structure" checkbox. When checked, sets enforceHtmlStructure on notebook metadata. */
    showEnforceStructure?: boolean;

    /**
     * Called when files are selected. Returns warning strings to display
     * above the import button (e.g. timestamp corruption warnings).
     */
    analyzeWarnings?: (files: File[]) => Promise<string[]>;
}

export const UnifiedImporterForm: React.FC<UnifiedImporterFormProps> = ({
    title,
    description,
    icon: Icon,
    accept,
    extensionBadges,
    multipleFiles = false,
    analyzeFiles,
    processFiles,
    importerProps,
    cellAligner,
    showPreview = true,
    onSourceImportComplete,
    showEnforceStructure = false,
    analyzeWarnings,
}) => {
    const [files, setFiles] = useState<File[]>([]);
    const [enforceStructure, setEnforceStructure] = useState(false);
    const [previewContent, setPreviewContent] = useState<string>("");
    const [fileWarnings, setFileWarnings] = useState<string[]>([]);
    const [analysisStats, setAnalysisStats] = useState<FileAnalysisStat[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | NotebookPair[] | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<any[]>([]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const { wizardContext, onTranslationComplete, alignContent } = importerProps;
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        !!wizardContext?.selectedSource &&
        !!onTranslationComplete &&
        !!alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback(
        async (e: React.ChangeEvent<HTMLInputElement>) => {
            const selectedFiles = e.target.files;
            if (!selectedFiles || selectedFiles.length === 0) return;

            const fileArray = Array.from(selectedFiles);
            setFiles(fileArray);
            setError(null);
            setProgress([]);
            setResult(null);
            setAlignedCells(null);
            setImportedContent([]);

            // Read preview from first file (skip binary / zip — avoids loading huge archives)
            if (showPreview) {
                const first = fileArray[0];
                const lower = first.name.toLowerCase();
                const skipBinaryPreview =
                    lower.endsWith(".zip") || lower.endsWith(".gz") || lower.endsWith(".br");
                if (skipBinaryPreview) {
                    setPreviewContent("");
                } else {
                    try {
                        const text = await first.text();
                        setPreviewContent(text.substring(0, 500));
                    } catch {
                        setPreviewContent("");
                    }
                }
            }

            // Run analysis
            if (analyzeFiles) {
                try {
                    const stats = await analyzeFiles(fileArray);
                    setAnalysisStats(stats);
                } catch {
                    setAnalysisStats([]);
                }
            } else {
                const defaultStats: FileAnalysisStat[] = [
                    {
                        label: multipleFiles ? "Files" : "File",
                        value: multipleFiles ? fileArray.length : fileArray[0].name,
                    },
                    {
                        label: "Size",
                        value: `${(fileArray.reduce((sum, f) => sum + f.size, 0) / 1024).toFixed(1)} KB`,
                    },
                ];
                setAnalysisStats(defaultStats);
            }

            // Run file-level warnings (e.g. timestamp corruption)
            if (analyzeWarnings) {
                try {
                    const warnings = await analyzeWarnings(fileArray);
                    setFileWarnings(warnings);
                } catch {
                    setFileWarnings([]);
                }
            } else {
                setFileWarnings([]);
            }
        },
        [analyzeFiles, analyzeWarnings, showPreview, multipleFiles]
    );

    const applyEnforceStructure = useCallback(
        (result: NotebookPair | NotebookPair[]): NotebookPair | NotebookPair[] => {
            if (!enforceStructure) return result;
            const applyToPair = (pair: NotebookPair): NotebookPair => ({
                ...pair,
                source: { ...pair.source, metadata: { ...pair.source.metadata, enforceHtmlStructure: true } },
                codex: { ...pair.codex, metadata: { ...pair.codex.metadata, enforceHtmlStructure: true } },
            });
            return Array.isArray(result) ? result.map(applyToPair) : applyToPair(result);
        },
        [enforceStructure]
    );

    const handleImport = useCallback(async () => {
        if (files.length === 0) return;

        notifyImportStarted();
        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

        try {
            const onProgress = (p: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((item) => item.stage !== p.stage),
                    p,
                ]);
            };

            const rawResult = await processFiles(files, onProgress);
            const notebookResult = applyEnforceStructure(rawResult);
            setResult(notebookResult);

            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning content with target cells...",
                    progress: 80,
                });

                setIsAligning(true);
                const primaryNotebook = Array.isArray(notebookResult)
                    ? notebookResult[0]
                    : notebookResult;
                const content = notebookToImportedContent(primaryNotebook);
                setImportedContent(content);

                const aligned = await alignContent(
                    content,
                    selectedSource.path,
                    cellAligner
                );
                setAlignedCells(aligned);
                setIsAligning(false);

                onProgress({
                    stage: "Complete",
                    message: "Alignment complete - review and confirm",
                    progress: 100,
                });
            } else {
                setTimeout(async () => {
                    try {
                        if (onSourceImportComplete) {
                            await onSourceImportComplete(notebookResult);
                        } else {
                            await handleImportCompletion(
                                notebookResult,
                                importerProps
                            );
                        }
                    } catch (err) {
                        setError(
                            err instanceof Error ? err.message : "Failed to complete import"
                        );
                        notifyImportEnded();
                    }
                }, 1500);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
            notifyImportEnded();
        } finally {
            setIsProcessing(false);
        }
    }, [
        files,
        processFiles,
        isTranslationImport,
        alignContent,
        selectedSource,
        cellAligner,
        importerProps,
        onSourceImportComplete,
        applyEnforceStructure,
    ]);

    const handleConfirmAlignment = useCallback(() => {
        if (!alignedCells || !selectedSource || !onTranslationComplete) return;
        onTranslationComplete(alignedCells, selectedSource.path);
    }, [alignedCells, selectedSource, onTranslationComplete]);

    const handleRetryAlignment = useCallback(
        async (aligner: CellAligner) => {
            if (!result || !alignContent || !selectedSource) return;
            setIsRetrying(true);
            try {
                const primaryNotebook = Array.isArray(result) ? result[0] : result;
                const content = notebookToImportedContent(primaryNotebook);
                setImportedContent(content);
                const aligned = await alignContent(content, selectedSource.path, aligner);
                setAlignedCells(aligned);
            } catch (err) {
                setError(
                    err instanceof Error ? err.message : "Retry alignment failed"
                );
            } finally {
                setIsRetrying(false);
            }
        },
        [result, alignContent, selectedSource]
    );

    const totalProgress =
        progress.length > 0
            ? Math.round(
                  progress.reduce((sum, p) => sum + (p.progress || 0), 0) /
                      progress.length
              )
            : 0;

    const totalCells = result
        ? Array.isArray(result)
            ? result.reduce((sum, r) => sum + r.source.cells.length, 0)
            : result.source.cells.length
        : 0;

    // Show alignment preview for translation imports
    if (alignedCells && isTranslationImport && result) {
        const primaryNotebook = Array.isArray(result) ? result[0] : result;
        return (
            <AlignmentPreview
                alignedCells={alignedCells}
                importedContent={importedContent}
                targetCells={[]}
                sourceCells={primaryNotebook.source.cells}
                selectedSourceName={selectedSource?.name}
                onConfirm={handleConfirmAlignment}
                onCancel={importerProps.onCancel}
                onRetryAlignment={handleRetryAlignment}
                isRetrying={isRetrying}
            />
        );
    }

    const hasFiles = files.length > 0;
    const isReady = hasFiles && !isProcessing && !isAligning;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Icon className="h-6 w-6" />
                    {title} {isTranslationImport && "(Translation)"}
                </h1>
            </div>

            {isTranslationImport && selectedSource && (
                <Alert>
                    <Icon className="h-4 w-4" />
                    <AlertDescription>
                        Importing translation for: <strong>{selectedSource.name}</strong>
                    </AlertDescription>
                </Alert>
            )}

            {/* Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Select File</CardTitle>
                    <CardDescription>{description}</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {extensionBadges && extensionBadges.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                            {extensionBadges.map((ext) => (
                                <Badge key={ext} variant="outline">
                                    {ext}
                                </Badge>
                            ))}
                        </div>
                    )}

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept={accept}
                        multiple={multipleFiles}
                        onChange={handleFileSelect}
                        className="hidden"
                        id="unified-file-input"
                        disabled={isProcessing || isAligning}
                    />
                    <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing || isAligning}
                        className="w-full h-16 text-base gap-3"
                    >
                        <Upload className="h-5 w-5" />
                        {hasFiles
                            ? multipleFiles
                                ? `${files.length} file(s) selected — Click to change`
                                : `${files[0].name} — Click to change`
                            : multipleFiles
                              ? "Choose Files"
                              : "Choose File"}
                    </Button>

                    {/* File info after selection */}
                    {hasFiles && (
                        <div className="text-sm text-muted-foreground">
                            {files.map((f) => (
                                <span key={f.name} className="mr-4">
                                    {f.name}{" "}
                                    <span className="text-xs">
                                        ({(f.size / 1024).toFixed(1)} KB)
                                    </span>
                                </span>
                            ))}
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* Enforce HTML Structure Checkbox */}
            {showEnforceStructure && hasFiles && (
                <EnforceStructureCheckbox
                    checked={enforceStructure}
                    onCheckedChange={setEnforceStructure}
                />
            )}

            {/* File Analysis */}
            {hasFiles && analysisStats.length > 0 && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            File Analysis
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div
                            className={`grid gap-4 text-sm ${
                                analysisStats.length <= 3
                                    ? `grid-cols-${analysisStats.length}`
                                    : "grid-cols-3"
                            }`}
                        >
                            {analysisStats.map((stat) => (
                                <div key={stat.label}>
                                    <p className="font-medium text-muted-foreground">
                                        {stat.label}
                                    </p>
                                    <p className="text-lg">{stat.value}</p>
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* File Warnings */}
            {hasFiles && fileWarnings.length > 0 && (
                <Alert className="border-yellow-500 bg-yellow-50 dark:bg-yellow-950">
                    <AlertCircle className="h-4 w-4 !text-yellow-600 dark:!text-yellow-400" />
                    <AlertDescription className="text-yellow-800 dark:text-yellow-200">
                        {fileWarnings.map((warning, index) => (
                            <p key={index}>{warning}</p>
                        ))}
                    </AlertDescription>
                </Alert>
            )}

            {/* File Preview */}
            {hasFiles && showPreview && previewContent && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <Eye className="h-4 w-4" />
                            File Preview
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <pre className="text-xs bg-muted p-3 rounded whitespace-pre-wrap max-h-32 overflow-y-auto">
                            {previewContent}
                            {previewContent.length >= 500 && "..."}
                        </pre>
                    </CardContent>
                </Card>
            )}

            {/* Progress */}
            {progress.length > 0 && (
                <div className="space-y-3">
                    <Progress value={totalProgress} className="w-full" />
                    {progress.map((item, index) => (
                        <div key={index} className="text-sm text-muted-foreground">
                            {item.stage}: {item.message}
                        </div>
                    ))}
                </div>
            )}

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Success message for source imports */}
            {result && !isTranslationImport && (
                <Alert>
                    <CheckCircle className="h-4 w-4 text-green-600" />
                    <AlertDescription>
                        Successfully imported! Created {totalCells} cells
                        {Array.isArray(result) && result.length > 1
                            ? ` across ${result.length} notebooks`
                            : ""}
                        .
                    </AlertDescription>
                </Alert>
            )}

            {/* Finish Import Button */}
            <Button
                onClick={handleImport}
                disabled={!isReady}
                className="w-full h-12 text-base"
                variant={isReady ? "default" : "secondary"}
            >
                {isProcessing || isAligning
                    ? "Processing..."
                    : "Finish Import"}
            </Button>
        </div>
    );
};
