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
import { Upload, FileText, CheckCircle, XCircle, ArrowLeft } from "lucide-react";
import { validateFile, parseFile } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";
import { AlignedCell, CellAligner, sequentialCellAligner } from "../../types/plugin";

export const DocxImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, wizardContext, onTranslationComplete, alignContent } = props;

    // Check if this is a translation import
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const [file, setFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | null>(null);

    // Translation import specific state
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<any[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);
        }
    }, []);

    const handleImport = async () => {
        if (!file) return;

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

            // Validate file
            onProgress({
                stage: "Validation",
                message: "Validating DOCX file...",
                progress: 10,
            });

            const validation = await validateFile(file);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(", "));
            }

            // Parse file
            const importResult = await parseFile(file, onProgress);

            if (!importResult.success || !importResult.notebookPair) {
                throw new Error(importResult.error || "Failed to parse file");
            }

            setResult(importResult.notebookPair);
            setIsDirty(false);

            if (isTranslationImport) {
                // For translation imports, perform alignment and show preview
                setIsAligning(true);

                try {
                    // Convert notebook to imported content
                    const importedContent = notebookToImportedContent(importResult.notebookPair);
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
                setTimeout(async () => {
                    try {
                        await handleImportCompletion(importResult.notebookPair!, props);
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
                sourceCells={result?.source.cells || []}
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

                    {file && (
                        <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                            <div className="flex items-center gap-3">
                                <FileText className="h-5 w-5 text-muted-foreground" />
                                <div>
                                    <p className="font-medium">{file.name}</p>
                                    <p className="text-sm text-muted-foreground">
                                        {(file.size / 1024 / 1024).toFixed(2)} MB
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
                                        Import
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
                                Successfully imported! Created {result.source.cells.length} cells.
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
