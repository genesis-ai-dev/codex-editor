import React, { useState, useCallback, useMemo, useEffect } from "react";
import { ImporterComponentProps } from "../../types/plugin";
import { NotebookPair, ImportProgress, ProcessedCell } from "../../types/common";
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
    Sparkles,
    CheckCircle,
    XCircle,
    ArrowLeft,
    Eye,
    Settings,
    PlusIcon,
    InfoIcon,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { Label } from "../../../components/ui/label";
import { Input } from "../../../components/ui/input";
import { Slider } from "../../../components/ui/slider";
import { ScrollArea } from "../../../components/ui/scroll-area";
import {
    Tooltip,
    TooltipContent,
    TooltipProvider,
    TooltipTrigger,
} from "../../../components/ui/tooltip";

const PREVIEW_CHAR_LIMIT = 5000;
const DEFAULT_CHUNK_SIZE = 500;
const DEFAULT_CHUNK_OVERLAP = 0;
const DEFAULT_SEPARATORS = ["\n\n", "\n", ". ", "? ", "! ", "; ", ", ", " ", ""];

interface Chunk {
    text: string;
    start: number;
    end: number;
}

// Recursive text splitter implementation based on Langchain's approach
function splitTextRecursive(
    text: string,
    separators: string[],
    chunkSize: number,
    chunkOverlap: number = 0,
    currentOffset: number = 0
): Chunk[] {
    if (text.length === 0) return [];

    if (text.length <= chunkSize) {
        return [{ text, start: currentOffset, end: currentOffset + text.length }];
    }

    let bestSeparator: string | null = null;
    let bestSeparatorIndex = -1;

    // Find the best separator
    for (let i = 0; i < separators.length; i++) {
        const sep = separators[i];
        if (sep === "") {
            // Character split is last resort
            if (bestSeparator === null) {
                bestSeparator = "";
                bestSeparatorIndex = i;
            }
        } else if (text.includes(sep)) {
            bestSeparator = sep;
            bestSeparatorIndex = i;
            break;
        }
    }

    const chunks: Chunk[] = [];

    if (bestSeparator !== null) {
        const remainingSeparators = separators.slice(bestSeparatorIndex + 1);
        const parts = bestSeparator === "" ? text.split("") : text.split(bestSeparator);

        let partOffset = 0;
        let currentChunk = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const potentialChunk = currentChunk + (currentChunk ? bestSeparator : "") + part;

            if (potentialChunk.length <= chunkSize || currentChunk === "") {
                currentChunk = potentialChunk;
            } else {
                // Current chunk is full, process it
                if (currentChunk.length > 0) {
                    const chunkResults =
                        currentChunk.length > chunkSize
                            ? splitTextRecursive(
                                  currentChunk,
                                  remainingSeparators,
                                  chunkSize,
                                  chunkOverlap,
                                  currentOffset + partOffset - currentChunk.length
                              )
                            : [
                                  {
                                      text: currentChunk,
                                      start: currentOffset + partOffset - currentChunk.length,
                                      end: currentOffset + partOffset,
                                  },
                              ];

                    chunks.push(...chunkResults);
                }

                // Start new chunk with overlap if specified
                if (chunkOverlap > 0 && currentChunk.length > chunkOverlap) {
                    currentChunk =
                        currentChunk.slice(-chunkOverlap) +
                        (bestSeparator !== "" ? bestSeparator : "") +
                        part;
                } else {
                    currentChunk = part;
                }
            }

            partOffset += part.length;
            if (bestSeparator !== "" && i < parts.length - 1) {
                partOffset += bestSeparator.length;
            }
        }

        // Process remaining chunk
        if (currentChunk.length > 0) {
            const chunkResults =
                currentChunk.length > chunkSize
                    ? splitTextRecursive(
                          currentChunk,
                          remainingSeparators,
                          chunkSize,
                          chunkOverlap,
                          currentOffset + partOffset - currentChunk.length
                      )
                    : [
                          {
                              text: currentChunk,
                              start: currentOffset + partOffset - currentChunk.length,
                              end: currentOffset + partOffset,
                          },
                      ];

            chunks.push(...chunkResults);
        }
    } else {
        // No separators work, hard split
        for (let i = 0; i < text.length; i += chunkSize) {
            const subText = text.substring(i, Math.min(text.length, i + chunkSize));
            chunks.push({
                text: subText,
                start: currentOffset + i,
                end: currentOffset + i + subText.length,
            });
        }
    }

    return chunks.filter((c) => c.text.length > 0);
}

export const RecursiveTextSplitterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
}) => {
    const [file, setFile] = useState<File | null>(null);
    const [fileContent, setFileContent] = useState<string>("");
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);

    // Splitter configuration
    const [chunkSize, setChunkSize] = useState<number>(DEFAULT_CHUNK_SIZE);
    const [chunkOverlap, setChunkOverlap] = useState<number>(DEFAULT_CHUNK_OVERLAP);
    const [separators, setSeparators] = useState<string[]>(DEFAULT_SEPARATORS);
    const [newSeparator, setNewSeparator] = useState<string>("");

    // Preview and chunks
    const previewContent = useMemo(
        () => fileContent.substring(0, PREVIEW_CHAR_LIMIT),
        [fileContent]
    );

    const processedChunks = useMemo(() => {
        if (!fileContent || chunkSize <= 0) return [];
        return splitTextRecursive(fileContent, separators, chunkSize, chunkOverlap);
    }, [fileContent, separators, chunkSize, chunkOverlap]);

    // Ensure empty string separator is last
    useEffect(() => {
        setSeparators((currentSeparators) => {
            const hasEmpty = currentSeparators.includes("");
            if (!hasEmpty) return currentSeparators;
            const others = currentSeparators.filter((s) => s !== "");
            return [...others, ""];
        });
    }, []);

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (selectedFile) {
            setFile(selectedFile);
            setIsDirty(true);
            setError(null);
            setProgress([]);

            try {
                const text = await selectedFile.text();
                setFileContent(text);
            } catch (err) {
                setError("Could not read file content");
                console.error("File read error:", err);
            }
        }
    }, []);

    const handleAddSeparator = useCallback(() => {
        if (newSeparator && !separators.includes(newSeparator)) {
            setSeparators([...separators, newSeparator]);
            setNewSeparator("");
            setIsDirty(true);
        } else if (newSeparator === "" && !separators.includes("")) {
            setSeparators([...separators, ""]);
            setNewSeparator("");
            setIsDirty(true);
        }
    }, [newSeparator, separators]);

    const handleRemoveSeparator = useCallback(
        (sepToRemove: string) => {
            setSeparators(separators.filter((s) => s !== sepToRemove));
            setIsDirty(true);
        },
        [separators]
    );

    const handleImport = async () => {
        if (!file || !fileContent) return;

        setIsProcessing(true);
        setError(null);
        setProgress([]);

        try {
            // Progress tracking
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            onProgress({
                stage: "Processing",
                message: "Analyzing and creating sections...",
                progress: 30,
            });

            const chunks = splitTextRecursive(fileContent, separators, chunkSize, chunkOverlap);

            onProgress({
                stage: "Creating",
                message: `Creating ${chunks.length} cells...`,
                progress: 70,
            });
            // Create notebook cells
            const cleanFileName = file.name.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
            const sourceCells = chunks.map((chunk, index) => ({
                id: `${cleanFileName} 1:${index + 1}`,
                content: chunk.text,
                metadata: {
                    type: "text" as const,
                    chunkIndex: index,
                    chunkSize: chunk.text.length,
                    startOffset: chunk.start,
                    endOffset: chunk.end,
                },
                images: [],
            }));

            const codexCells: ProcessedCell[] = chunks.map((chunk, index) => ({
                id: `${cleanFileName} 1:${index + 1}`,
                content: "", // Empty for user translation
                metadata: {
                    type: "text" as const,
                    chunkIndex: index,
                },
                images: [],
            }));

            const notebookPair: NotebookPair = {
                source: {
                    name: cleanFileName,
                    cells: sourceCells,
                    metadata: {
                        id: `source-${Date.now()}`,
                        originalFileName: file.name,
                        importerType: "smart-import",
                        createdAt: new Date().toISOString(),
                    },
                },
                codex: {
                    name: cleanFileName,
                    cells: codexCells,
                    metadata: {
                        id: `codex-${Date.now()}`,
                        originalFileName: file.name,
                        importerType: "smart-import",
                        createdAt: new Date().toISOString(),
                    },
                },
            };

            onProgress({
                stage: "Complete",
                message: "Text splitting complete!",
                progress: 100,
            });

            setIsDirty(false);

            // Auto-complete after brief delay
            setTimeout(() => {
                onComplete(notebookPair);
            }, 1000);
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

    // Chunk colors for visualization
    const chunkColors = [
        "bg-sky-200/70 dark:bg-sky-700/70",
        "bg-lime-200/70 dark:bg-lime-700/70",
        "bg-orange-200/70 dark:bg-orange-700/70",
        "bg-fuchsia-200/70 dark:bg-fuchsia-700/70",
        "bg-yellow-200/70 dark:bg-yellow-700/70",
        "bg-teal-200/70 dark:bg-teal-700/70",
    ];

    const highlightedPreview = useMemo(() => {
        const segments: { text: string; style?: string; isChunk: boolean }[] = [];
        let lastIndex = 0;

        processedChunks.forEach((chunk, chunkIndex) => {
            const displayStart = Math.max(0, chunk.start);
            const displayEnd = Math.min(previewContent.length, chunk.end);

            if (displayStart < displayEnd) {
                if (displayStart > lastIndex) {
                    segments.push({
                        text: previewContent.substring(lastIndex, displayStart),
                        isChunk: false,
                    });
                }
                segments.push({
                    text: previewContent.substring(displayStart, displayEnd),
                    style: chunkColors[chunkIndex % chunkColors.length],
                    isChunk: true,
                });
                lastIndex = displayEnd;
            }
        });

        if (lastIndex < previewContent.length) {
            segments.push({
                text: previewContent.substring(lastIndex, previewContent.length),
                isChunk: false,
            });
        }
        return segments;
    }, [previewContent, processedChunks, chunkColors]);

    return (
        <TooltipProvider>
            <div className="flex flex-col lg:flex-row gap-6 p-4 lg:p-6 min-h-screen bg-muted/20">
                {/* Left Panel: Controls & File Selection */}
                <div className="lg:w-1/2 space-y-6">
                    <div className="flex items-center justify-between">
                        <h1 className="text-2xl font-bold flex items-center gap-2">
                            <Sparkles className="h-6 w-6" />
                            Smart Import
                        </h1>
                        <Button
                            variant="ghost"
                            onClick={handleCancel}
                            className="flex items-center gap-2"
                        >
                            <ArrowLeft className="h-4 w-4" />
                            Back to Home
                        </Button>
                    </div>

                    <Card>
                        <CardHeader>
                            <CardTitle>Select Your File</CardTitle>
                            <CardDescription>
                                Smart Import intelligently understands your content and creates
                                meaningful sections automatically. Works with any text
                                file—documents, code, markdown, and more.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="space-y-4">
                            <div className="flex flex-wrap gap-2 mb-4">
                                <Badge variant="outline">.txt</Badge>
                                <Badge variant="outline">.md</Badge>
                                <Badge variant="outline">.json</Badge>
                                <Badge variant="outline">.csv</Badge>
                                <Badge variant="outline">+many more</Badge>
                            </div>

                            <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                                <input
                                    type="file"
                                    accept=".txt,.text,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,text/*"
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
                                        Click to select a text file or drag and drop
                                    </span>
                                </label>
                            </div>

                            {file && (
                                <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                    <div className="flex items-center gap-3">
                                        <Sparkles className="h-5 w-5 text-muted-foreground" />
                                        <div>
                                            <p className="font-medium">{file.name}</p>
                                            <p className="text-sm text-muted-foreground">
                                                {(file.size / 1024).toFixed(1)} KB •{" "}
                                                {fileContent.length} characters
                                            </p>
                                        </div>
                                    </div>
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {file && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Settings className="h-4 w-4" />
                                    Import Settings
                                </CardTitle>
                            </CardHeader>
                            <CardContent className="space-y-6">
                                <div>
                                    <Label
                                        htmlFor="chunkSize"
                                        className="block text-sm font-medium mb-1"
                                    >
                                        Section Size:{" "}
                                        <span className="font-semibold">{chunkSize}</span>{" "}
                                        characters
                                    </Label>
                                    <Slider
                                        id="chunkSize"
                                        min={50}
                                        max={2000}
                                        step={50}
                                        value={[chunkSize]}
                                        onValueChange={(value) => {
                                            setChunkSize(value[0]);
                                            setIsDirty(true);
                                        }}
                                    />
                                </div>

                                <div>
                                    <Label
                                        htmlFor="chunkOverlap"
                                        className="block text-sm font-medium mb-1"
                                    >
                                        Chunk Overlap:{" "}
                                        <span className="font-semibold">{chunkOverlap}</span>{" "}
                                        characters
                                    </Label>
                                    <Slider
                                        id="chunkOverlap"
                                        min={0}
                                        max={Math.min(200, chunkSize / 2)}
                                        step={10}
                                        value={[chunkOverlap]}
                                        onValueChange={(value) => {
                                            setChunkOverlap(value[0]);
                                            setIsDirty(true);
                                        }}
                                    />
                                </div>

                                <div>
                                    <Label className="block text-sm font-medium mb-1">
                                        Separators (in order of preference)
                                    </Label>
                                    <div className="flex flex-wrap gap-2 mb-2">
                                        {separators.map((sep, index) => (
                                            <Badge
                                                key={index}
                                                variant="secondary"
                                                className="text-sm pl-2 pr-1 py-0.5"
                                            >
                                                {sep === ""
                                                    ? '"" (Char Split)'
                                                    : sep.replace(/\n/g, "\\n")}
                                                <button
                                                    onClick={() => handleRemoveSeparator(sep)}
                                                    className="ml-1 p-0.5 rounded-full hover:bg-destructive/20"
                                                    aria-label={`Remove separator ${sep}`}
                                                >
                                                    <XCircle className="h-3 w-3" />
                                                </button>
                                            </Badge>
                                        ))}
                                    </div>
                                    <div className="flex gap-2">
                                        <Input
                                            type="text"
                                            value={newSeparator.replace(/\n/g, "\\n")}
                                            onChange={(e) =>
                                                setNewSeparator(
                                                    e.target.value.replace(/\\n/g, "\n")
                                                )
                                            }
                                            placeholder='Add separator (e.g., "\\n\\n", ". ")'
                                            className="flex-grow"
                                        />
                                        <Button
                                            onClick={handleAddSeparator}
                                            variant="outline"
                                            size="icon"
                                            aria-label="Add separator"
                                        >
                                            <PlusIcon className="h-4 w-4" />
                                        </Button>
                                    </div>
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Use <kbd>\n</kbd> for newline. Empty string{" "}
                                        <kbd>&quot;&quot;</kbd> enables character-level splitting as
                                        fallback.
                                    </p>
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {file && (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-sm flex items-center gap-2">
                                    <Eye className="h-4 w-4" />
                                    Text Preview (First {PREVIEW_CHAR_LIMIT} chars)
                                    <Tooltip>
                                        <TooltipTrigger asChild>
                                            <InfoIcon className="h-4 w-4 text-muted-foreground cursor-help" />
                                        </TooltipTrigger>
                                        <TooltipContent>
                                            <p>
                                                Highlighted segments show how text will be split
                                                into sections
                                            </p>
                                        </TooltipContent>
                                    </Tooltip>
                                </CardTitle>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-64 border rounded-md p-3 bg-background">
                                    <pre className="whitespace-pre-wrap break-words text-sm leading-relaxed">
                                        {highlightedPreview.map((segment, index) => (
                                            <span
                                                key={index}
                                                className={segment.isChunk ? segment.style : ""}
                                            >
                                                {segment.text}
                                            </span>
                                        ))}
                                        {fileContent.length > PREVIEW_CHAR_LIMIT && (
                                            <span className="text-muted-foreground">
                                                ... ({fileContent.length - PREVIEW_CHAR_LIMIT} more
                                                characters)
                                            </span>
                                        )}
                                    </pre>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    )}

                    {file && (
                        <Button
                            onClick={handleImport}
                            disabled={isProcessing || processedChunks.length === 0}
                            className="w-full flex items-center gap-2"
                        >
                            {isProcessing ? (
                                <>Processing...</>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    Import with {processedChunks.length} Sections
                                </>
                            )}
                        </Button>
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
                </div>

                {/* Right Panel: Split Sections */}
                {file && (
                    <div className="lg:w-1/2">
                        <Card className="sticky top-4">
                            <CardHeader>
                                <CardTitle>Generated Sections</CardTitle>
                                <CardDescription>
                                    Total Sections:{" "}
                                    <span className="font-semibold">{processedChunks.length}</span>
                                    {processedChunks.length > 0 && (
                                        <>
                                            {" • "}Average Size:{" "}
                                            <span className="font-semibold">
                                                {Math.round(
                                                    processedChunks.reduce(
                                                        (sum, chunk) => sum + chunk.text.length,
                                                        0
                                                    ) / processedChunks.length
                                                )}
                                            </span>{" "}
                                            chars
                                        </>
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[calc(100vh-12rem)]">
                                    {processedChunks.length === 0 && (
                                        <p className="text-muted-foreground text-center py-8">
                                            No sections generated. Select a file to get started.
                                        </p>
                                    )}
                                    <div className="space-y-3">
                                        {processedChunks.slice(0, 50).map((chunk, index) => (
                                            <div
                                                key={index}
                                                className={`p-3 border rounded-md text-sm ${chunkColors[
                                                    index % chunkColors.length
                                                ]?.replace(
                                                    "/70",
                                                    "/30"
                                                )} transition-all hover:shadow-md`}
                                            >
                                                <div className="flex justify-between items-center mb-1">
                                                    <span className="font-medium text-xs text-muted-foreground">
                                                        Chunk {index + 1}
                                                    </span>
                                                    <Badge variant="outline" className="text-xs">
                                                        {chunk.text.length} chars
                                                    </Badge>
                                                </div>
                                                <pre className="whitespace-pre-wrap break-words text-xs leading-normal">
                                                    {chunk.text.length > 200
                                                        ? chunk.text.substring(0, 200) + "..."
                                                        : chunk.text}
                                                </pre>
                                            </div>
                                        ))}
                                        {processedChunks.length > 50 && (
                                            <div className="text-center text-sm text-muted-foreground py-4">
                                                ... showing first 50 of {processedChunks.length}{" "}
                                                sections
                                            </div>
                                        )}
                                    </div>
                                </ScrollArea>
                            </CardContent>
                        </Card>
                    </div>
                )}
            </div>
        </TooltipProvider>
    );
};
