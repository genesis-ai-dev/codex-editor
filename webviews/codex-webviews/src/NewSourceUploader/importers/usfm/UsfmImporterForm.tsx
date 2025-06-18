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
import { Upload, BookOpen, CheckCircle, XCircle, ArrowLeft, Eye, FolderOpen } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
// Temporary mock functions - these should be imported from the actual parser
const validateFile = async (file: File) => ({ isValid: true, errors: [], warnings: [] });
const parseFile = async (file: File, onProgress?: any) => ({
    success: true,
    notebookPair: {
        source: {
            name: file.name.replace(/\.[^/.]+$/, ""),
            cells: [],
            metadata: {
                id: `source-${Date.now()}`,
                originalFileName: file.name,
                importerType: "usfm",
                createdAt: new Date().toISOString(),
            },
        },
        codex: {
            name: file.name.replace(/\.[^/.]+$/, ""),
            cells: [],
            metadata: {
                id: `codex-${Date.now()}`,
                originalFileName: file.name,
                importerType: "usfm",
                createdAt: new Date().toISOString(),
            },
        },
    },
    error: undefined,
});

export const UsfmImporterForm: React.FC<ImporterComponentProps> = ({ onComplete, onCancel }) => {
    const [files, setFiles] = useState<FileList | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [results, setResults] = useState<NotebookPair[]>([]);
    const [previewFiles, setPreviewFiles] = useState<Array<{ name: string; preview: string }>>([]);

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
                    progress: (i / files.length) * 80,
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

            onProgress({
                stage: "Complete",
                message: `Successfully processed ${notebookPairs.length} file(s)`,
                progress: 100,
            });

            setResults(notebookPairs);
            setIsDirty(false);

            // Automatically complete after showing success briefly
            setTimeout(() => {
                onComplete(notebookPairs.length === 1 ? notebookPairs[0] : notebookPairs);
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
        } finally {
            setIsProcessing(false);
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

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <BookOpen className="h-6 w-6" />
                    Import USFM Files
                </h1>
                <Button variant="ghost" onClick={handleCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select USFM Files</CardTitle>
                    <CardDescription>
                        Import Unified Standard Format Marker (USFM) files used for biblical texts.
                        Can import single files or multiple books at once.
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
                            <FolderOpen className="h-12 w-12 text-muted-foreground" />
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
                                    <BookOpen className="h-5 w-5 text-muted-foreground" />
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
                                    disabled={isProcessing}
                                    className="flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>Processing...</>
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
