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
import { Upload, Type, CheckCircle, XCircle, ArrowLeft, Eye, Settings } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Label } from "../../../components/ui/label";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";
import { plaintextImporter } from "./index";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";

// Use the real parser functions from the Plaintext importer
const { validateFile, parseFile } = plaintextImporter;

export const PlaintextImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [file, setFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);
    const [previewContent, setPreviewContent] = useState<string>("");

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    // Import options
    const [splitMode, setSplitMode] = useState<"paragraphs" | "lines" | "sections">("paragraphs");
    const [preserveEmptyLines, setPreserveEmptyLines] = useState(false);
    const [autoDetectStructure, setAutoDetectStructure] = useState(true);

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);

            // Show preview of first 500 characters
            try {
                const text = await selectedFile.text();
                setPreviewContent(text.substring(0, 500));
            } catch (err) {
                console.warn("Could not preview file:", err);
            }
        }
    }, []);

    const handleImport = async () => {
        if (!file) return;

        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

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
                message: "Validating text file...",
                progress: 10,
            });

            const validation = await validateFile(file);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(", "));
            }

            // Parse file (the parser automatically determines the best split strategy)
            const importResult = await parseFile(file, onProgress);

            if (!importResult.success || !importResult.notebookPair) {
                throw new Error(importResult.error || "Failed to parse file");
            }

            setResult(importResult.notebookPair);

            // For translation imports, perform alignment
            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning text content with target cells...",
                    progress: 80,
                });

                setIsAligning(true);

                try {
                    // Convert notebook to imported content
                    const importedContent = notebookToImportedContent(importResult.notebookPair);
                    setImportedContent(importedContent);

                    // Use sequential cell aligner for plaintext (no structured IDs)
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
                setIsDirty(false);

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
                        <Type className="h-6 w-6" />
                        Import Plain Text {isTranslationImport && "(Translation)"}
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
                    <CardTitle>Select Text File</CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? "Import plain text translation that will be aligned with existing cells. Content will be inserted sequentially into empty cells."
                            : "Import plain text files with intelligent structure detection. Supports various text formats and splitting options."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.txt</Badge>
                        <Badge variant="outline">.text</Badge>
                        <Badge variant="outline">Any text file</Badge>
                    </div>

                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".txt,.text,text/*"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="text-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="text-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select a text file
                            </span>
                        </label>
                    </div>

                    {file && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Type className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{file.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {(file.size / 1024).toFixed(1)} KB
                                        </p>
                                    </div>
                                </div>
                            </div>

                            {/* Import Options */}
                            <Card>
                                <CardHeader>
                                    <CardTitle className="text-sm flex items-center gap-2">
                                        <Settings className="h-4 w-4" />
                                        Import Options
                                    </CardTitle>
                                </CardHeader>
                                <CardContent className="space-y-4">
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <Label htmlFor="split-mode">Split Mode</Label>
                                            <Select
                                                value={splitMode}
                                                onValueChange={(value: any) => setSplitMode(value)}
                                            >
                                                <SelectTrigger>
                                                    <SelectValue placeholder="Select split mode" />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="paragraphs">
                                                        By Paragraphs
                                                    </SelectItem>
                                                    <SelectItem value="lines">By Lines</SelectItem>
                                                    <SelectItem value="sections">
                                                        By Sections
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            <p className="text-xs text-muted-foreground">
                                                How to split the text into cells
                                            </p>
                                        </div>

                                        <div className="space-y-4">
                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id="auto-detect"
                                                    checked={autoDetectStructure}
                                                    onChange={(e) =>
                                                        setAutoDetectStructure(e.target.checked)
                                                    }
                                                    className="rounded"
                                                />
                                                <Label htmlFor="auto-detect">
                                                    Auto-detect structure
                                                </Label>
                                            </div>

                                            <div className="flex items-center space-x-2">
                                                <input
                                                    type="checkbox"
                                                    id="preserve-empty"
                                                    checked={preserveEmptyLines}
                                                    onChange={(e) =>
                                                        setPreserveEmptyLines(e.target.checked)
                                                    }
                                                    className="rounded"
                                                />
                                                <Label htmlFor="preserve-empty">
                                                    Preserve empty lines
                                                </Label>
                                            </div>
                                        </div>
                                    </div>
                                </CardContent>
                            </Card>

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
                                        Import Text File
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
