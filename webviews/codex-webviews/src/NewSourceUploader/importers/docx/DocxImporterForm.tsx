import React, { useState, useCallback } from "react";
import { ImporterComponentProps } from "../../types/plugin";
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
import { Upload, FileText, CheckCircle, XCircle, ArrowLeft, Info } from "lucide-react";
import { validateFile, parseFile } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";
import { AlignedCell, CellAligner, sequentialCellAligner } from "../../types/plugin";

export const DocxImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onComplete, onCancel, wizardContext, onTranslationComplete, alignContent } = props;

    // Check if this is a translation import
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | NotebookPair[] | null>(null);

    // Translation import specific state
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<any[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setSelectedFiles(files);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);
        }
    }, []);

    const handleImport = async () => {
        if (selectedFiles.length === 0) return;

        setIsProcessing(true);
        setError(null);
        setProgress([]);

        try {
            // Progress callback
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            // Process multiple files
            const results: NotebookPair[] = [];

            for (let i = 0; i < selectedFiles.length; i++) {
                const file = selectedFiles[i];

                // Validate file
                onProgress({
                    stage: "Validation",
                    message: `Validating ${file.name} (${i + 1}/${selectedFiles.length})...`,
                    progress: 10 + (i * 80) / selectedFiles.length,
                });

                const validation = await validateFile(file);
                if (!validation.isValid) {
                    throw new Error(`${file.name}: ${validation.errors.join(", ")}`);
                }

                // Parse file
                const importResult = await parseFile(file, onProgress);

                if (!importResult.success || !importResult.notebookPair) {
                    throw new Error(importResult.error || `Failed to parse ${file.name}`);
                }

                results.push(importResult.notebookPair);
            }

            const finalResult = results.length === 1 ? results[0] : results;
            setResult(finalResult);
            setIsDirty(false);

            if (isTranslationImport) {
                // For translation imports, use first file only (multi-file translation imports need special UI)
                const primaryNotebook = Array.isArray(finalResult) ? finalResult[0] : finalResult;
                setIsAligning(true);

                try {
                    // Convert notebook to imported content
                    const importedContent = notebookToImportedContent(primaryNotebook);
                    setImportedContent(importedContent);

                    // Use sequential alignment by default for DOCX (no meaningful IDs)
                    const aligned = await alignContent!(
                        importedContent,
                        selectedSource!.path,
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
                setTimeout(() => {
                    try {
                        if (onComplete) {
                            console.log("[DOCX IMPORTER] Calling onComplete with notebook pair");
                            onComplete(finalResult);
                        } else {
                            throw new Error("onComplete callback not provided for source import");
                        }
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to complete import");
                    }
                }, 1500);
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
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <FileText className="h-6 w-6" />
                        Import DOCX Document
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

            {/* DOCX Large File Warning */}
            <Alert className="border-amber-200 bg-amber-50">
                <Info className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                    <div className="space-y-2">
                        <div className="font-medium">Important Note</div>
                        <div className="text-sm">
                            Very large DOCX files may cause performance issues or processing delays.
                            Complex documents with many images, tables, or formatting may require
                            significant memory and processing time. For best results, consider splitting
                            large documents into smaller files when possible.
                        </div>
                    </div>
                </AlertDescription>
            </Alert>

            <Card>
                <CardHeader>
                    <CardTitle>Select DOCX File</CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? "Import a DOCX translation that will be aligned with existing cells. Content will be inserted sequentially into empty cells."
                            : "Import Microsoft Word documents with formatting, images, and structure preserved"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".docx"
                            multiple
                            onChange={handleFileSelect}
                            className="hidden"
                            id="docx-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="docx-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select a DOCX file or drag and drop
                            </span>
                        </label>
                    </div>

                    {selectedFiles.length > 0 && (
                        <div className="space-y-2">
                            <div className="text-sm font-medium">
                                Selected Files ({selectedFiles.length})
                            </div>
                            <div className="max-h-32 overflow-y-auto space-y-1">
                                {selectedFiles.map((file, index) => (
                                    <div
                                        key={index}
                                        className="flex items-center gap-2 p-2 bg-muted/50 rounded text-sm"
                                    >
                                        <FileText className="h-4 w-4 text-muted-foreground" />
                                        <span className="flex-1">{file.name}</span>
                                        <span className="text-muted-foreground">
                                            {(file.size / 1024 / 1024).toFixed(2)} MB
                                        </span>
                                    </div>
                                ))}
                            </div>
                            <Button
                                onClick={handleImport}
                                disabled={isProcessing || isAligning}
                                className="w-full flex items-center gap-2"
                            >
                                {isProcessing ? (
                                    <>Processing...</>
                                ) : isAligning ? (
                                    <>Aligning...</>
                                ) : (
                                    <>
                                        <Upload className="h-4 w-4" />
                                        Import {selectedFiles.length} File
                                        {selectedFiles.length !== 1 ? "s" : ""}
                                    </>
                                )}
                            </Button>
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

                    {result && (
                        <Alert>
                            <CheckCircle className="h-4 w-4 text-green-600" />
                            <AlertDescription>
                                {Array.isArray(result)
                                    ? `Successfully imported ${
                                          result.length
                                      } notebooks with ${result.reduce(
                                          (total, nb) => total + nb.source.cells.length,
                                          0
                                      )} total cells.`
                                    : `Successfully imported! Created ${result.source.cells.length} cells.`}
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
