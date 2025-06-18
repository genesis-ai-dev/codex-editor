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
import { Upload, Play, CheckCircle, XCircle, ArrowLeft, Eye, Clock } from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { subtitlesImporter } from "./index";

// Use the real parser functions from the subtitle importer
const { validateFile, parseFile } = subtitlesImporter;

export const SubtitlesImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
}) => {
    const [file, setFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | null>(null);
    const [previewContent, setPreviewContent] = useState<string>("");
    const [subtitleStats, setSubtitleStats] = useState<{
        totalCues: number;
        duration: string;
        format: string;
    } | null>(null);

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);
            setSubtitleStats(null);

            // Show preview and analyze file
            try {
                const text = await selectedFile.text();
                setPreviewContent(text.substring(0, 500));

                // Basic analysis for subtitle files
                const isVTT = text.startsWith("WEBVTT");
                const isSRT =
                    /^\d+\s*\n\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/m.test(text);

                let cueCount = 0;
                let format = "Unknown";

                if (isVTT) {
                    format = "WebVTT";
                    cueCount = (text.match(/\n\n\d{2}:\d{2}:\d{2}\.\d{3}/g) || []).length;
                } else if (isSRT) {
                    format = "SRT";
                    cueCount = (text.match(/^\d+\s*$/gm) || []).length;
                }

                // Extract duration from last timestamp
                const timeMatches = text.match(/\d{2}:\d{2}:\d{2}[,.]\d{3}/g);
                const duration = timeMatches ? timeMatches[timeMatches.length - 1] : "Unknown";

                setSubtitleStats({
                    totalCues: cueCount,
                    duration,
                    format,
                });
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
                message: "Validating subtitle file...",
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

            // Automatically complete after showing success briefly
            setTimeout(() => {
                onComplete(importResult.notebookPair!);
            }, 1500);
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

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Play className="h-6 w-6" />
                    Import Subtitle Files
                </h1>
                <Button variant="ghost" onClick={handleCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            <Card>
                <CardHeader>
                    <CardTitle>Select Subtitle File</CardTitle>
                    <CardDescription>
                        Import subtitle files (VTT/SRT) with timestamp-based cells for media
                        synchronization. Perfect for video transcriptions and timed content.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.vtt</Badge>
                        <Badge variant="outline">.srt</Badge>
                        <Badge variant="outline">WebVTT</Badge>
                        <Badge variant="outline">SubRip</Badge>
                    </div>

                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".vtt,.srt"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="subtitle-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="subtitle-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select a subtitle file or drag and drop
                            </span>
                        </label>
                    </div>

                    {file && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Play className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{file.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {(file.size / 1024).toFixed(1)} KB
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
                                            Import
                                        </>
                                    )}
                                </Button>
                            </div>

                            {subtitleStats && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <Clock className="h-4 w-4" />
                                            Subtitle Analysis
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="grid grid-cols-3 gap-4 text-sm">
                                        <div>
                                            <p className="font-medium text-muted-foreground">
                                                Format
                                            </p>
                                            <p className="text-lg">{subtitleStats.format}</p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-muted-foreground">
                                                Total Cues
                                            </p>
                                            <p className="text-lg">{subtitleStats.totalCues}</p>
                                        </div>
                                        <div>
                                            <p className="font-medium text-muted-foreground">
                                                Duration
                                            </p>
                                            <p className="text-lg">{subtitleStats.duration}</p>
                                        </div>
                                    </CardContent>
                                </Card>
                            )}

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
                                Successfully imported! Created {result.source.cells.length} timed
                                cells.
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
