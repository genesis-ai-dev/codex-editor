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
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Upload, FileText, CheckCircle, XCircle, ArrowLeft, Eye, Hash } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { usfmImporter } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";

// Use the real parser functions from the USFM importer
const { validateFile, parseFile } = usfmImporter;

export const UsfmImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [files, setFiles] = useState<FileList | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<NotebookPair[]>([]);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);
    const [previewFiles, setPreviewFiles] = useState<Array<{ name: string; preview: string }>>([]);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFiles = e.target.files;
        if (selectedFiles && selectedFiles.length > 0) {
            setFiles(selectedFiles);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResults([]);

            // Show preview of first few files
            const previews: Array<{ name: string; preview: string }> = [];
            for (let i = 0; i < Math.min(3, selectedFiles.length); i++) {
                const file = selectedFiles[i];
                try {
                    const text = await file.text();
                    previews.push({
                        name: file.name,
                        preview: text.substring(0, 300),
                    });
                } catch (err) {
                    console.warn("Could not preview file:", file.name, err);
                }
            }
            setPreviewFiles(previews);
        }
    }, []);

    const handleImport = async () => {
        if (!files || files.length === 0) return;

        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setResults([]);
        setAlignedCells(null);

        try {
            const notebookPairs: NotebookPair[] = [];

            // Progress callback
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            // Process each file
            for (let i = 0; i < files.length; i++) {
                const file = files[i];

                onProgress({
                    stage: "Processing",
                    message: `Processing ${file.name} (${i + 1}/${files.length})...`,
                    progress: (i / files.length) * 60,
                });

                // Validate file
                const validation = await validateFile(file);
                if (!validation.isValid) {
                    console.warn(`Skipping invalid file ${file.name}:`, validation.errors);
                    continue;
                }

                // Parse file
                const importResult = await parseFile(file, onProgress);

                if (importResult.success && importResult.notebookPair) {
                    notebookPairs.push(importResult.notebookPair);
                } else {
                    console.warn(`Failed to parse ${file.name}:`, importResult.error);
                }
            }

            if (notebookPairs.length === 0) {
                throw new Error("No valid USFM files could be processed");
            }

            setResults(notebookPairs);

            // For translation imports, perform alignment
            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning USFM content with target cells...",
                    progress: 80,
                });

                setIsAligning(true);

                try {
                    // For multi-file imports, we'll use the first file for now
                    // This could be enhanced to handle multiple files differently
                    const primaryNotebook = notebookPairs[0];
                    const importedContent = notebookToImportedContent(primaryNotebook);
                    setImportedContent(importedContent);

                    // Use sequential cell aligner for USFM (structured content with verse IDs)
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
            } else {
                // For source imports, complete normally
                onProgress({
                    stage: "Complete",
                    message: `Successfully processed ${notebookPairs.length} file(s)`,
                    progress: 100,
                });

                setIsDirty(false);

                setTimeout(async () => {
                    try {
                        // For multi-file imports, pass all notebook pairs for batch import
                        const notebooks =
                            notebookPairs.length === 1 ? notebookPairs[0] : notebookPairs;
                        await handleImportCompletion(notebooks, props);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to complete import");
                    }
                }, 2000);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
        } finally {
            setIsProcessing(false);
        }
    };

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

    const handleCancel = () => {
        if (isDirty && !window.confirm("Cancel import? Any unsaved changes will be lost.")) {
            return;
        }
        onCancel();
    };

    const totalProgress =
        progress.length > 0
            ? Math.round(progress.reduce((sum, p) => sum + (p.progress || 0), 0) / progress.length)
            : 0;

    const totalCells = results.reduce((sum, pair) => sum + pair.source.cells.length, 0);

    // Render alignment preview for translation imports
    if (alignedCells && isTranslationImport) {
        return (
            <AlignmentPreview
                alignedCells={alignedCells}
                importedContent={importedContent}
                targetCells={targetCells}
                sourceCells={results[0]?.source.cells || []}
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
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6" />
                        Import USFM Files {isTranslationImport && "(Translation)"}
                    </h1>
                    {isTranslationImport && selectedSource && (
                        <p className="text-muted-foreground">
                            Importing translation for:{" "}
                            <span className="font-medium">{selectedSource.name}</span>
                        </p>
                    )}
                </div>
                <Button variant="ghost" onClick={handleCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select USFM Files</CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? "Import USFM translation files that will be aligned with existing cells. Content will be matched by verse references or inserted sequentially."
                            : "Import Unified Standard Format Marker (USFM) files used for biblical texts. Can import single files or multiple books at once."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.usfm</Badge>
                        <Badge variant="outline">.sfm</Badge>
                        <Badge variant="outline">.SFM</Badge>
                        <Badge variant="outline">.USFM</Badge>
                    </div>

                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".usfm,.sfm,.SFM,.USFM"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="usfm-file-input"
                            disabled={isProcessing}
                            multiple
                        />
                        <label
                            htmlFor="usfm-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Hash className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select USFM files or drag and drop
                            </span>
                            <span className="text-xs text-muted-foreground">
                                Multiple files supported for batch import
                            </span>
                        </label>
                    </div>

                    {files && files.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <FileText className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">
                                            {files.length} file{files.length > 1 ? "s" : ""}{" "}
                                            selected
                                        </p>
                                        <p className="text-sm text-muted-foreground">
                                            {Array.from(files)
                                                .map((f) => f.name)
                                                .slice(0, 3)
                                                .join(", ")}
                                            {files.length > 3 && ` and ${files.length - 3} more...`}
                                        </p>
                                    </div>
                                </div>
                                <Button
                                    onClick={handleImport}
                                    disabled={isProcessing || isAligning}
                                    className="flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>Processing...</>
                                    ) : isAligning ? (
                                        <>Aligning...</>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4" />
                                            Import {files.length > 1 ? "All" : ""}
                                        </>
                                    )}
                                </Button>
                            </div>

                            {previewFiles.length > 0 && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <Eye className="h-4 w-4" />
                                            File Preview{" "}
                                            {previewFiles.length < files.length &&
                                                `(showing first ${previewFiles.length})`}
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        {previewFiles.map((file, index) => (
                                            <div
                                                key={index}
                                                className="border-l-2 border-primary/20 pl-3"
                                            >
                                                <h4 className="font-medium text-sm">{file.name}</h4>
                                                <pre className="text-xs bg-muted p-2 rounded whitespace-pre-wrap max-h-24 overflow-y-auto mt-1">
                                                    {file.preview}
                                                    {file.preview.length >= 300 && "..."}
                                                </pre>
                                            </div>
                                        ))}
                                    </CardContent>
                                </Card>
                            )}
                        </div>
                    )}

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

                    {error && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {results.length > 0 && (
                        <Alert>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <AlertDescription>
                                Successfully imported {results.length} book
                                {results.length > 1 ? "s" : ""}
                                with {totalCells} total cells!
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
