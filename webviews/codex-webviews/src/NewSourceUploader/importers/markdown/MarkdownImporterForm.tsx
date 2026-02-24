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
import { Upload, FileText, CheckCircle, XCircle, ArrowLeft, Eye, Hash } from "lucide-react";
import { FileDropzone } from "../../components/FileDropzone";
import { Badge } from "../../../components/ui/badge";
import { markdownImporter } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { notifyImportStarted, notifyImportEnded } from "../../utils/importProgress";
import { AlignmentPreview } from "../../components/AlignmentPreview";
import { AlignedCell, CellAligner, sequentialCellAligner } from "../../types/plugin";

// Use the real parser functions from the Markdown importer
const { validateFile, parseFile } = markdownImporter;

export const MarkdownImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, wizardContext, onTranslationComplete, alignContent } = props;

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
    const [previewContent, setPreviewContent] = useState<string>("");

    // Translation import specific state
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<any[]>([]);

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            setSelectedFiles(files);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);

            // Show preview of first file's first 500 characters
            try {
                const text = await files[0].text();
                setPreviewContent(text.substring(0, 500));
            } catch (err) {
                console.warn("Could not preview file:", err);
            }
        }
    }, []);

    const handleImport = async () => {
        if (selectedFiles.length === 0) return;

        notifyImportStarted();
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
                    progress: 10 + (i * 70) / selectedFiles.length,
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

                    // Use sequential alignment by default for Markdown (no meaningful IDs)
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
                        await handleImportCompletion(finalResult, props);
                    } catch (err) {
                        setError(err instanceof Error ? err.message : "Failed to complete import");
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
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="h-6 w-6" />
                    Import Markdown Document
                </h1>
                <Button variant="ghost" onClick={handleCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select Markdown File</CardTitle>
                    <CardDescription>
                        Import Markdown documents with formatting, images, links, and structure
                        preserved. Supports GitHub Flavored Markdown (GFM).
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.md</Badge>
                        <Badge variant="outline">.markdown</Badge>
                        <Badge variant="outline">.mdown</Badge>
                        <Badge variant="outline">.mkd</Badge>
                    </div>

                    <FileDropzone
                        accept=".md,.markdown,.mdown,.mkd,.mdx"
                        multiple
                        disabled={isProcessing}
                        onFiles={(files) => {
                            const event = {
                                target: { files },
                            } as unknown as React.ChangeEvent<HTMLInputElement>;
                            handleFileSelect(event);
                        }}
                        label="Click to select Markdown files"
                    />

                    {selectedFiles.length > 0 && (
                        <div className="space-y-4">
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
                                                {(file.size / 1024).toFixed(1)} KB
                                            </span>
                                        </div>
                                    ))}
                                </div>
                                <Button
                                    onClick={handleImport}
                                    disabled={isProcessing}
                                    className="w-full flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>Processing...</>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4" />
                                            Import {selectedFiles.length} File
                                            {selectedFiles.length !== 1 ? "s" : ""}
                                        </>
                                    )}
                                </Button>
                            </div>

                            {previewContent && (
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
