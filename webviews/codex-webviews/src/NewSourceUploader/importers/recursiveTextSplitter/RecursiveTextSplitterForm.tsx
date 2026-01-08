import React, { useState, useCallback, useMemo, useEffect } from "react";
import { ImporterComponentProps } from "../../types/plugin";
import { NotebookPair, ImportProgress, ProcessedCell } from "../../types/common";
import { v4 as uuidv4 } from "uuid";
import { Button } from "../../../components/ui/button";
import { parseJsonIntelligently, mightBeJson } from "./jsonParser";
import { addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
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

// Smart text splitter that respects document structure while targeting optimal section sizes
function splitTextSmart(
    text: string,
    separators: string[],
    targetSize: number,
    chunkOverlap: number = 0,
    currentOffset: number = 0
): Chunk[] {
    if (text.length === 0) return [];

    // If text is reasonably close to target size, keep it as one section
    if (text.length <= targetSize * 1.5) {
        return [{ text, start: currentOffset, end: currentOffset + text.length }];
    }

    // Find all separator positions for each separator type
    const separatorPositions: Map<string, number[]> = new Map();

    for (const sep of separators) {
        if (sep === "") continue; // Skip character split for now

        const positions: number[] = [];
        let pos = 0;
        while ((pos = text.indexOf(sep, pos)) !== -1) {
            positions.push(pos);
            pos += sep.length;
        }
        if (positions.length > 0) {
            separatorPositions.set(sep, positions);
        }
    }

    // Try to find optimal split points using higher-priority separators first
    for (const [sep, positions] of separatorPositions) {
        const chunks = tryOptimalSplit(text, sep, positions, targetSize, currentOffset);
        if (chunks && isGoodSplit(chunks, targetSize)) {
            return applyOverlap(chunks, chunkOverlap);
        }
    }

    // If no good split found with separators, fall back to recursive split
    return splitTextRecursiveFallback(text, separators, targetSize, chunkOverlap, currentOffset);
}

// Try to create optimal chunks using a specific separator
function tryOptimalSplit(
    text: string,
    separator: string,
    positions: number[],
    targetSize: number,
    offset: number
): Chunk[] | null {
    if (positions.length === 0) return null;

    const chunks: Chunk[] = [];
    const lastEnd = 0;

    // Add text length to positions for easier calculation
    const boundaries = [0, ...positions.map((p) => p + separator.length), text.length];

    let i = 0;
    while (i < boundaries.length - 1) {
        let bestEnd = i + 1;
        let bestScore = Infinity;

        // Look ahead to find the best ending position
        for (let j = i + 1; j < boundaries.length; j++) {
            const chunkSize = boundaries[j] - boundaries[i];

            // Skip if way too large (more than 2x target)
            if (chunkSize > targetSize * 2) break;

            // Calculate score (how far from target size)
            const score = Math.abs(chunkSize - targetSize);

            // Prefer chunks closer to target size
            if (score < bestScore) {
                bestScore = score;
                bestEnd = j;
            }

            // If we've exceeded target size by 50%, probably best to stop here
            if (chunkSize > targetSize * 1.5) break;
        }

        // Create chunk
        const chunkStart = boundaries[i];
        const chunkEnd = boundaries[bestEnd];
        const chunkText = text.substring(chunkStart, chunkEnd).trim();

        if (chunkText.length > 0) {
            chunks.push({
                text: chunkText,
                start: offset + chunkStart,
                end: offset + chunkEnd,
            });
        }

        i = bestEnd;
    }

    return chunks.length > 0 ? chunks : null;
}

// Check if a split is good (reasonable variance in chunk sizes)
function isGoodSplit(chunks: Chunk[], targetSize: number): boolean {
    if (chunks.length === 0) return false;

    const sizes = chunks.map((c) => c.text.length);
    const avgSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    // Check if average is within reasonable range of target
    if (avgSize < targetSize * 0.5 || avgSize > targetSize * 2) return false;

    // Check if any chunk is way too small or too large
    const minSize = Math.min(...sizes);
    const maxSize = Math.max(...sizes);

    // Allow more flexibility for good semantic splits
    return minSize > targetSize * 0.2 && maxSize < targetSize * 3;
}

// Apply overlap to chunks if specified
function applyOverlap(chunks: Chunk[], overlap: number): Chunk[] {
    if (overlap <= 0 || chunks.length <= 1) return chunks;

    const overlappedChunks: Chunk[] = [];

    for (let i = 0; i < chunks.length; i++) {
        let text = chunks[i].text;
        let start = chunks[i].start;
        const end = chunks[i].end;

        // Add overlap from previous chunk
        if (i > 0) {
            const prevText = chunks[i - 1].text;
            const overlapText = prevText.slice(-overlap);
            text = overlapText + text;
            start = Math.max(chunks[i - 1].end - overlap, chunks[i - 1].start);
        }

        overlappedChunks.push({ text, start, end });
    }

    return overlappedChunks;
}

// Fallback to recursive splitting when optimal splitting doesn't work
function splitTextRecursiveFallback(
    text: string,
    separators: string[],
    chunkSize: number,
    chunkOverlap: number,
    currentOffset: number
): Chunk[] {
    if (text.length === 0) return [];
    if (text.length <= chunkSize) {
        return [{ text, start: currentOffset, end: currentOffset + text.length }];
    }

    // Find first available separator
    let bestSeparator: string | null = null;
    for (const sep of separators) {
        if (sep === "" || text.includes(sep)) {
            bestSeparator = sep;
            break;
        }
    }

    if (!bestSeparator) bestSeparator = "";

    const chunks: Chunk[] = [];

    if (bestSeparator === "") {
        // Character-level split as last resort
        for (let i = 0; i < text.length; i += chunkSize - chunkOverlap) {
            const end = Math.min(i + chunkSize, text.length);
            chunks.push({
                text: text.substring(i, end),
                start: currentOffset + i,
                end: currentOffset + end,
            });
        }
    } else {
        // Split by separator and recursively process
        const parts = text.split(bestSeparator);
        let currentPos = 0;
        let currentChunk = "";

        for (let i = 0; i < parts.length; i++) {
            const part = parts[i];
            const potentialChunk = currentChunk + (currentChunk ? bestSeparator : "") + part;

            if (potentialChunk.length <= chunkSize || !currentChunk) {
                currentChunk = potentialChunk;
            } else {
                // Save current chunk
                if (currentChunk) {
                    chunks.push({
                        text: currentChunk,
                        start: currentOffset + currentPos - currentChunk.length,
                        end: currentOffset + currentPos,
                    });
                }
                currentChunk = part;
            }

            currentPos += part.length;
            if (i < parts.length - 1) currentPos += bestSeparator.length;
        }

        // Don't forget the last chunk
        if (currentChunk) {
            chunks.push({
                text: currentChunk,
                start: currentOffset + text.length - currentChunk.length,
                end: currentOffset + text.length,
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

    // Check if this is JSON content
    const isJsonContent = useMemo(() => {
        return file && (file.name.toLowerCase().endsWith(".json") || mightBeJson(fileContent));
    }, [file, fileContent]);

    // Get JSON preview cells if applicable
    const jsonPreviewCells = useMemo(() => {
        if (!isJsonContent || !fileContent) return null;
        const cleanFileName = file?.name.replace(/\.[^/.]+$/, "").replace(/\s+/g, "") || "json";
        return parseJsonIntelligently(fileContent, cleanFileName);
    }, [isJsonContent, fileContent, file]);

    const processedChunks = useMemo(() => {
        if (!fileContent || chunkSize <= 0) return [];
        // Don't process chunks for JSON files in preview
        if (isJsonContent && jsonPreviewCells) return [];
        return splitTextSmart(fileContent, separators, chunkSize, chunkOverlap);
    }, [fileContent, separators, chunkSize, chunkOverlap, isJsonContent, jsonPreviewCells]);

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

            const cleanFileName = file.name.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
            let sourceCells: ProcessedCell[];
            let codexCells: ProcessedCell[];

            // Check if this is JSON content
            const isJsonFile =
                file.name.toLowerCase().endsWith(".json") || mightBeJson(fileContent);

            if (isJsonFile) {
                onProgress({
                    stage: "Processing",
                    message: "Parsing JSON structure...",
                    progress: 30,
                });

                const jsonCells = parseJsonIntelligently(fileContent, cleanFileName);

                if (jsonCells) {
                    // Successfully parsed as JSON
                    sourceCells = jsonCells;

                    onProgress({
                        stage: "Creating",
                        message: `Creating ${jsonCells.length} sections from JSON...`,
                        progress: 70,
                    });

                    // Create empty codex cells matching the source
                    codexCells = jsonCells.map((cell) => ({
                        ...cell,
                        content: "", // Empty for user translation
                        metadata: {
                            ...cell.metadata,
                            sourceId: cell.id,
                        },
                    }));
                } else {
                    // Failed to parse as JSON, fall back to text splitting
                    onProgress({
                        stage: "Processing",
                        message: "Invalid JSON, using smart text analysis...",
                        progress: 30,
                    });

                    const chunks = splitTextSmart(fileContent, separators, chunkSize, chunkOverlap);

                    sourceCells = chunks.map((chunk: Chunk, index: number): ProcessedCell => {
                        const legacyId = `${cleanFileName} 1:${index + 1}`;
                        const id = uuidv4();
                        return {
                            id,
                            content: chunk.text,
                            metadata: {
                                type: "text" as const,
                                chunkIndex: index,
                                chunkSize: chunk.text.length,
                                startOffset: chunk.start,
                                endOffset: chunk.end,
                                data: {
                                    originalText: chunk.text,
                                    globalReferences: [legacyId],
                                },
                            },
                            images: [],
                        };
                    });

                    codexCells = sourceCells.map(
                        (cell): ProcessedCell => ({
                            id: cell.id,
                            content: "", // Empty for user translation
                            metadata: {
                                ...(cell.metadata || {}),
                            },
                            images: [],
                        })
                    );
                }
            } else {
                // Regular text file
                onProgress({
                    stage: "Processing",
                    message: "Analyzing and creating sections...",
                    progress: 30,
                });

                const chunks = splitTextSmart(fileContent, separators, chunkSize, chunkOverlap);

                onProgress({
                    stage: "Creating",
                    message: `Creating ${chunks.length} sections...`,
                    progress: 70,
                });

                sourceCells = chunks.map((chunk: Chunk, index: number): ProcessedCell => {
                    const legacyId = `${cleanFileName} 1:${index + 1}`;
                    const id = uuidv4();
                    return {
                        id,
                        content: chunk.text,
                        metadata: {
                            type: "text" as const,
                            chunkIndex: index,
                            chunkSize: chunk.text.length,
                            startOffset: chunk.start,
                            endOffset: chunk.end,
                            data: {
                                originalText: chunk.text,
                                globalReferences: [legacyId],
                            },
                        },
                        images: [],
                    };
                });

                codexCells = sourceCells.map(
                    (cell): ProcessedCell => ({
                        id: cell.id,
                        content: "", // Empty for user translation
                        metadata: {
                            ...(cell.metadata || {}),
                        },
                        images: [],
                    })
                );
            }

            const notebookPair: NotebookPair = {
                source: {
                    name: cleanFileName,
                    cells: sourceCells,
                    metadata: {
                        id: `source-${Date.now()}`,
                        originalFileName: file.name,
                        importerType: "smart-segmenter",
                        createdAt: new Date().toISOString(),
                        importContext: {
                            importerType: "smart-segmenter",
                            fileName: file.name,
                            originalFileName: file.name,
                            fileSize: file.size,
                            importTimestamp: new Date().toISOString(),
                        },
                    },
                },
                codex: {
                    name: cleanFileName,
                    cells: codexCells,
                    metadata: {
                        id: `codex-${Date.now()}`,
                        originalFileName: file.name,
                        importerType: "smart-segmenter",
                        createdAt: new Date().toISOString(),
                        importContext: {
                            importerType: "smart-segmenter",
                            fileName: file.name,
                            originalFileName: file.name,
                            fileSize: file.size,
                            importTimestamp: new Date().toISOString(),
                        },
                    },
                },
            };

            // Add milestone cells to the notebook pair
            const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

            onProgress({
                stage: "Complete",
                message: "Text splitting complete!",
                progress: 100,
            });

            setIsDirty(false);

            // Auto-complete after brief delay
            setTimeout(() => {
                onComplete?.(notebookPairWithMilestones);
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
    const chunkColors = useMemo(
        () => [
            "bg-sky-200/70 dark:bg-sky-700/70",
            "bg-lime-200/70 dark:bg-lime-700/70",
            "bg-orange-200/70 dark:bg-orange-700/70",
            "bg-fuchsia-200/70 dark:bg-fuchsia-700/70",
            "bg-yellow-200/70 dark:bg-yellow-700/70",
            "bg-teal-200/70 dark:bg-teal-700/70",
        ],
        []
    );

    const highlightedPreview = useMemo(() => {
        const segments: { text: string; style?: string; isChunk: boolean }[] = [];
        let lastIndex = 0;

        processedChunks.forEach((chunk: Chunk, chunkIndex: number) => {
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
                            Smart Segmenter
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
                                Smart Segmenter intelligently understands your content and creates
                                meaningful sections automatically. Works with many text
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
                                    accept=".txt,.text,.md,.markdown,.csv,.tsv,.json,.log,.xml,.html,.css,.js,.ts,.py,.java,.cpp,.c,.h,.yml,.yaml,.ini,.conf,.config,.sh,.bash,.zsh,.fish,.ps1,.bat,.cmd,.r,.R,.sql,.rb,.php,.swift,.kt,.scala,.go,.rs,.m,.mm,.tex,.bib,text/*,application/json"
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
                                        Click to select a file
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
                                                {isJsonContent && " • JSON detected"}
                                            </p>
                                        </div>
                                    </div>
                                    {isJsonContent && jsonPreviewCells && (
                                        <Badge variant="secondary" className="text-xs">
                                            {jsonPreviewCells.length} section
                                            {jsonPreviewCells.length > 1 ? "s" : ""}
                                        </Badge>
                                    )}
                                </div>
                            )}
                        </CardContent>
                    </Card>

                    {file && !isJsonContent && (
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
                                        Target Section Size:{" "}
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
                                        Section Overlap:{" "}
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
                                    <p className="text-xs text-muted-foreground mt-1">
                                        Smart Segmenter finds natural boundaries in your text.
                                        Sections may vary in size to respect paragraphs, sentences,
                                        and document structure.
                                    </p>
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
                            disabled={Boolean(
                                isProcessing ||
                                    (!isJsonContent && processedChunks.length === 0) ||
                                    (isJsonContent && !jsonPreviewCells)
                            )}
                            className="w-full flex items-center gap-2"
                        >
                            {isProcessing ? (
                                <>Processing...</>
                            ) : (
                                <>
                                    <Sparkles className="h-4 w-4" />
                                    {isJsonContent && jsonPreviewCells
                                        ? `Import ${jsonPreviewCells.length} JSON Section${
                                              jsonPreviewCells.length > 1 ? "s" : ""
                                          }`
                                        : `Import with ${processedChunks.length} Sections`}
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
                                    {isJsonContent && jsonPreviewCells ? (
                                        <>
                                            JSON Structure:{" "}
                                            <span className="font-semibold">
                                                {jsonPreviewCells.length}
                                            </span>{" "}
                                            section{jsonPreviewCells.length > 1 ? "s" : ""} detected
                                        </>
                                    ) : (
                                        <>
                                            Total Sections:{" "}
                                            <span className="font-semibold">
                                                {processedChunks.length}
                                            </span>
                                            {processedChunks.length > 0 && (
                                                <>
                                                    {" • "}Average Size:{" "}
                                                    <span className="font-semibold">
                                                        {Math.round(
                                                            processedChunks.reduce(
                                                                (sum: number, chunk: Chunk) =>
                                                                    sum + chunk.text.length,
                                                                0
                                                            ) / processedChunks.length
                                                        )}
                                                    </span>{" "}
                                                    chars
                                                </>
                                            )}
                                        </>
                                    )}
                                </CardDescription>
                            </CardHeader>
                            <CardContent>
                                <ScrollArea className="h-[calc(100vh-12rem)]">
                                    {!isJsonContent && processedChunks.length === 0 && (
                                        <p className="text-muted-foreground text-center py-8">
                                            No sections generated. Select a file to get started.
                                        </p>
                                    )}
                                    <div className="space-y-3">
                                        {isJsonContent && jsonPreviewCells
                                            ? // JSON preview
                                              jsonPreviewCells.slice(0, 50).map((cell, index) => (
                                                  <div
                                                      key={index}
                                                      className="p-3 border rounded-md text-sm bg-blue-50/30 dark:bg-blue-900/30 transition-all hover:shadow-md"
                                                  >
                                                      <div className="flex justify-between items-center mb-1">
                                                          <span className="font-medium text-xs text-muted-foreground">
                                                              {cell.id}
                                                          </span>
                                                          <Badge
                                                              variant="outline"
                                                              className="text-xs"
                                                          >
                                                              {cell.metadata?.type || "json"}
                                                          </Badge>
                                                      </div>
                                                      {cell.metadata?.title && (
                                                          <h4 className="font-semibold mb-1">
                                                              {cell.metadata.title}
                                                          </h4>
                                                      )}
                                                      <pre className="whitespace-pre-wrap break-words text-xs leading-normal">
                                                          {cell.content.length > 200
                                                              ? cell.content.substring(0, 200) +
                                                                "..."
                                                              : cell.content}
                                                      </pre>
                                                  </div>
                                              ))
                                            : // Regular text preview
                                              processedChunks.slice(0, 50).map((chunk, index) => (
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
                                                              Section {index + 1}
                                                          </span>
                                                          <Badge
                                                              variant="outline"
                                                              className="text-xs"
                                                          >
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
                                        {(isJsonContent
                                            ? jsonPreviewCells?.length || 0
                                            : processedChunks.length) > 50 && (
                                            <div className="text-center text-sm text-muted-foreground py-4">
                                                ... showing first 50 of{" "}
                                                {isJsonContent
                                                    ? jsonPreviewCells?.length
                                                    : processedChunks.length}{" "}
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
