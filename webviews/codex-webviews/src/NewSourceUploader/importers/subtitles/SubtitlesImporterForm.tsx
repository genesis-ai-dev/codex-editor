import React, { useState, useCallback } from "react";
import { ImporterComponentProps, AlignedCell, ImportedContent } from "../../types/plugin";
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
import {
    Upload,
    Play,
    CheckCircle,
    XCircle,
    ArrowLeft,
    Eye,
    Clock,
    ArrowRight,
    FileText,
    AlertCircle,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { subtitlesImporter } from "./index";
import { subtitlesImporterPlugin } from "./index.tsx";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { ScrollArea } from "../../../components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../../../components/ui/tabs";

// Use the real parser functions from the subtitle importer
const { validateFile, parseFile } = subtitlesImporter;

export const SubtitlesImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onCancelImport, onTranslationComplete, alignContent, wizardContext } = props;
    const [file, setFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [previewContent, setPreviewContent] = useState<string>("");
    const [subtitleStats, setSubtitleStats] = useState<{
        totalCues: number;
        duration: string;
        format: string;
    } | null>(null);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
            setError(null);
            setProgress([]);
            setResult(null);
            setAlignedCells(null);
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
                    // Count VTT cues by looking for timestamp patterns
                    const vttCueMatches = text.match(
                        /\d{2}:\d{2}:\d{2}\.\d{3}\s*-->\s*\d{2}:\d{2}:\d{2}\.\d{3}/g
                    );
                    cueCount = vttCueMatches ? vttCueMatches.length : 0;
                } else if (isSRT) {
                    format = "SRT";
                    // Count SRT cues by looking for timestamp patterns
                    const srtCueMatches = text.match(
                        /\d{2}:\d{2}:\d{2},\d{3}\s*-->\s*\d{2}:\d{2}:\d{2},\d{3}/g
                    );
                    cueCount = srtCueMatches ? srtCueMatches.length : 0;
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

            // For translation imports, perform alignment
            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning subtitles with target cells...",
                    progress: 80,
                });

                setIsAligning(true);

                try {
                    // Convert notebook to imported content
                    const importedContent = notebookToImportedContent(importResult.notebookPair);

                    // Use the custom subtitle alignment algorithm
                    const aligned = await alignContent(
                        importedContent,
                        selectedSource.path,
                        subtitlesImporterPlugin.cellAligner
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

    const handleCancel = () => {
        // Use the new onCancelImport which provides consistent UX across all plugins
        onCancelImport();
    };

    const totalProgress =
        progress.length > 0
            ? Math.round(progress.reduce((sum, p) => sum + (p.progress || 0), 0) / progress.length)
            : 0;

    // Render alignment preview
    if (alignedCells && isTranslationImport) {
        const matchedCount = alignedCells.filter((c) => c.notebookCell && !c.isParatext).length;
        const paratextCount = alignedCells.filter((c) => c.isParatext).length;
        const additionalOverlapCount = alignedCells.filter((c) => c.isAdditionalOverlap).length;

        return (
            <div className="container mx-auto p-6 max-w-6xl space-y-6">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Play className="h-6 w-6" />
                        Review Subtitle Alignment
                    </h1>
                    <div className="flex gap-2">
                        <Button variant="outline" onClick={onCancelImport}>
                            Cancel Import
                        </Button>
                        <Button
                            onClick={handleConfirmAlignment}
                            className="flex items-center gap-2"
                        >
                            <CheckCircle className="h-4 w-4" />
                            Confirm Import
                        </Button>
                    </div>
                </div>

                <Card>
                    <CardHeader>
                        <CardTitle>Alignment Summary</CardTitle>
                        <CardDescription>
                            Review how the subtitle content will be aligned with existing cells
                        </CardDescription>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-4 mb-6">
                            <div className="text-center p-4 bg-green-50 dark:bg-green-950 rounded-lg">
                                <p className="text-2xl font-bold text-green-600 dark:text-green-400">
                                    {matchedCount}
                                </p>
                                <p className="text-sm text-muted-foreground">Matched Cells</p>
                            </div>
                            <div className="text-center p-4 bg-yellow-50 dark:bg-yellow-950 rounded-lg">
                                <p className="text-2xl font-bold text-yellow-600 dark:text-yellow-400">
                                    {paratextCount}
                                </p>
                                <p className="text-sm text-muted-foreground">Paratext Cells</p>
                            </div>
                            <div className="text-center p-4 bg-blue-50 dark:bg-blue-950 rounded-lg">
                                <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">
                                    {additionalOverlapCount}
                                </p>
                                <p className="text-sm text-muted-foreground">Additional Overlaps</p>
                            </div>
                        </div>

                        <Tabs defaultValue="matched" className="w-full">
                            <TabsList className="grid w-full grid-cols-3">
                                <TabsTrigger value="matched">Matched ({matchedCount})</TabsTrigger>
                                <TabsTrigger value="paratext">
                                    Paratext ({paratextCount})
                                </TabsTrigger>
                                <TabsTrigger value="all">All ({alignedCells.length})</TabsTrigger>
                            </TabsList>

                            <TabsContent value="matched">
                                <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                                    <div className="space-y-2">
                                        {alignedCells
                                            .filter((cell) => cell.notebookCell && !cell.isParatext)
                                            .map((cell, index) => (
                                                <Card key={index} className="p-3">
                                                    <div className="flex items-start gap-3">
                                                        <FileText className="h-4 w-4 text-muted-foreground mt-1" />
                                                        <div className="flex-1 space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <Badge
                                                                    variant="outline"
                                                                    className="text-xs"
                                                                >
                                                                    {cell.importedContent.id}
                                                                </Badge>
                                                                {cell.importedContent.startTime && (
                                                                    <Badge
                                                                        variant="secondary"
                                                                        className="text-xs"
                                                                    >
                                                                        {
                                                                            cell.importedContent
                                                                                .startTime
                                                                        }
                                                                        s -{" "}
                                                                        {
                                                                            cell.importedContent
                                                                                .endTime
                                                                        }
                                                                        s
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-sm text-muted-foreground">
                                                                {cell.notebookCell?.content}
                                                            </p>
                                                            <p className="text-sm">
                                                                {cell.importedContent.content}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </Card>
                                            ))}
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            <TabsContent value="paratext">
                                <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                                    <Alert className="mb-4">
                                        <AlertCircle className="h-4 w-4" />
                                        <AlertDescription>
                                            These subtitles don't overlap with any existing cells
                                            and will be added as paratext.
                                        </AlertDescription>
                                    </Alert>
                                    <div className="space-y-2">
                                        {alignedCells
                                            .filter((cell) => cell.isParatext)
                                            .map((cell, index) => (
                                                <Card
                                                    key={index}
                                                    className="p-3 border-yellow-200 dark:border-yellow-800"
                                                >
                                                    <div className="flex items-start gap-3">
                                                        <AlertCircle className="h-4 w-4 text-yellow-600 dark:text-yellow-400 mt-1" />
                                                        <div className="flex-1 space-y-1">
                                                            <div className="flex items-center gap-2">
                                                                <Badge
                                                                    variant="outline"
                                                                    className="text-xs"
                                                                >
                                                                    {cell.importedContent.id}
                                                                </Badge>
                                                                {cell.importedContent.startTime && (
                                                                    <Badge
                                                                        variant="secondary"
                                                                        className="text-xs"
                                                                    >
                                                                        {
                                                                            cell.importedContent
                                                                                .startTime
                                                                        }
                                                                        s -{" "}
                                                                        {
                                                                            cell.importedContent
                                                                                .endTime
                                                                        }
                                                                        s
                                                                    </Badge>
                                                                )}
                                                            </div>
                                                            <p className="text-sm">
                                                                {cell.importedContent.content}
                                                            </p>
                                                        </div>
                                                    </div>
                                                </Card>
                                            ))}
                                    </div>
                                </ScrollArea>
                            </TabsContent>

                            <TabsContent value="all">
                                <ScrollArea className="h-[400px] w-full rounded-md border p-4">
                                    <div className="space-y-2">
                                        {alignedCells.map((cell, index) => (
                                            <Card
                                                key={index}
                                                className={`p-3 ${
                                                    cell.isParatext
                                                        ? "border-yellow-200 dark:border-yellow-800"
                                                        : cell.isAdditionalOverlap
                                                        ? "border-blue-200 dark:border-blue-800"
                                                        : ""
                                                }`}
                                            >
                                                <div className="flex items-start gap-3">
                                                    <FileText className="h-4 w-4 text-muted-foreground mt-1" />
                                                    <div className="flex-1 space-y-1">
                                                        <div className="flex items-center gap-2">
                                                            <Badge
                                                                variant="outline"
                                                                className="text-xs"
                                                            >
                                                                {cell.importedContent.id}
                                                            </Badge>
                                                            {cell.isParatext && (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="text-xs"
                                                                >
                                                                    Paratext
                                                                </Badge>
                                                            )}
                                                            {cell.isAdditionalOverlap && (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="text-xs"
                                                                >
                                                                    Additional Overlap
                                                                </Badge>
                                                            )}
                                                            {cell.importedContent.startTime && (
                                                                <Badge
                                                                    variant="secondary"
                                                                    className="text-xs"
                                                                >
                                                                    {cell.importedContent.startTime}
                                                                    s -{" "}
                                                                    {cell.importedContent.endTime}s
                                                                </Badge>
                                                            )}
                                                        </div>
                                                        <p className="text-sm">
                                                            {cell.importedContent.content}
                                                        </p>
                                                    </div>
                                                </div>
                                            </Card>
                                        ))}
                                    </div>
                                </ScrollArea>
                            </TabsContent>
                        </Tabs>
                    </CardContent>
                </Card>
            </div>
        );
    }

    // Normal import UI
    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Play className="h-6 w-6" />
                    Import Subtitle Files {isTranslationImport && "(Translation)"}
                </h1>
                <Button
                    variant="ghost"
                    onClick={onCancelImport}
                    className="flex items-center gap-2"
                >
                    <ArrowLeft className="h-4 w-4" />
                    Cancel Import
                </Button>
            </div>

            {isTranslationImport && selectedSource && (
                <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                        Importing translation for: <strong>{selectedSource.name}</strong>
                    </AlertDescription>
                </Alert>
            )}

            <Card>
                <CardHeader>
                    <CardTitle>Select Subtitle File</CardTitle>
                    <CardDescription>
                        Import subtitle files (VTT/SRT) with timestamp-based cells for media
                        synchronization.{" "}
                        {isTranslationImport &&
                            "Subtitles will be aligned using temporal overlap matching."}
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
                            disabled={isProcessing || isAligning}
                        />
                        <label
                            htmlFor="subtitle-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select a subtitle file (VTT/SRT)
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
                                    disabled={isProcessing || isAligning}
                                    className="flex items-center gap-2"
                                >
                                    {isProcessing || isAligning ? (
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

                    {result && !isTranslationImport && (
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
