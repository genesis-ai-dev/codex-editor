import React, { useState, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import {
    ImporterComponentProps,
    AlignedCell,
    CellAligner,
    ImportedContent,
    defaultCellAligner,
} from "../../types/plugin";
import { ImportProgress, ProcessedNotebook, NotebookPair } from "../../types/common";
import { Button } from "../../../components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import {
    Download,
    ExternalLink,
    CheckCircle,
    XCircle,
    BookOpen,
    Loader2,
    Info,
    Languages,
    BarChart3,
} from "lucide-react";

import { notebookToImportedContent } from "../common/translationHelper";
import { getCorpusMarkerForBook, isNewTestamentBook } from "../../utils/corpusUtils";
import { addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
import { notifyImportStarted, notifyImportEnded } from "../../utils/importProgress";
import { createMaculaVerseCellMetadata } from "./cellMetadata";

const bookCodeToName: Record<string, string> = {
    GEN: "Genesis",
    EXO: "Exodus",
    LEV: "Leviticus",
    NUM: "Numbers",
    DEU: "Deuteronomy",
    JOS: "Joshua",
    JDG: "Judges",
    RUT: "Ruth",
    "1SA": "1 Samuel",
    "2SA": "2 Samuel",
    "1KI": "1 Kings",
    "2KI": "2 Kings",
    "1CH": "1 Chronicles",
    "2CH": "2 Chronicles",
    EZR: "Ezra",
    NEH: "Nehemiah",
    EST: "Esther",
    JOB: "Job",
    PSA: "Psalms",
    PRO: "Proverbs",
    ECC: "Ecclesiastes",
    SNG: "Song of Songs",
    ISA: "Isaiah",
    JER: "Jeremiah",
    LAM: "Lamentations",
    EZK: "Ezekiel",
    DAN: "Daniel",
    HOS: "Hosea",
    JOL: "Joel",
    AMO: "Amos",
    OBA: "Obadiah",
    JON: "Jonah",
    MIC: "Micah",
    NAM: "Nahum",
    HAB: "Habakkuk",
    ZEP: "Zephaniah",
    HAG: "Haggai",
    ZEC: "Zechariah",
    MAL: "Malachi",
    MAT: "Matthew",
    MRK: "Mark",
    LUK: "Luke",
    JHN: "John",
    ACT: "Acts",
    ROM: "Romans",
    "1CO": "1 Corinthians",
    "2CO": "2 Corinthians",
    GAL: "Galatians",
    EPH: "Ephesians",
    PHP: "Philippians",
    COL: "Colossians",
    "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians",
    "1TI": "1 Timothy",
    "2TI": "2 Timothy",
    TIT: "Titus",
    PHM: "Philemon",
    HEB: "Hebrews",
    JAS: "James",
    "1PE": "1 Peter",
    "2PE": "2 Peter",
    "1JN": "1 John",
    "2JN": "2 John",
    "3JN": "3 John",
    JUD: "Jude",
    REV: "Revelation",
};

function getFullBookName(bookCode: string): string {
    if (!bookCode) return bookCode;

    const upperCode = bookCode.toUpperCase().trim();

    if (bookCodeToName[upperCode]) {
        return bookCodeToName[upperCode];
    }

    const variations: Record<string, string> = {
        RIM: "ROM",
        ROM: "ROM",
        PHL: "PHP",
        PHP: "PHP",
    };

    const normalizedCode = variations[upperCode] || upperCode;
    if (bookCodeToName[normalizedCode]) {
        return bookCodeToName[normalizedCode];
    }

    const cleanCode = normalizedCode.replace(/[^A-Z0-9]/g, "");

    for (const [code, name] of Object.entries(bookCodeToName)) {
        if (
            code === cleanCode ||
            (cleanCode.length >= 2 && code.startsWith(cleanCode.substring(0, 2))) ||
            (cleanCode.length >= 2 && cleanCode.startsWith(code.substring(0, 2)))
        ) {
            return name;
        }
    }

    console.warn(`[Macula Bible] Unknown book code: "${bookCode}", using as-is`);
    return bookCode;
}

export const MaculaBibleImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const {
        onComplete,
        onCancel,
        onTranslationComplete,
        alignContent,
        wizardContext,
        existingFiles = [],
        downloadResource,
    } = props;

    const [isDownloading, setIsDownloading] = useState(false);
    const [progress, setProgress] = useState<ImportProgress>({
        stage: "idle",
        message: "",
        progress: 0,
    });
    const [error, setError] = useState<string | null>(null);
    const [downloadComplete, setDownloadComplete] = useState(false);
    const [notebooks, setNotebooks] = useState<NotebookPair[]>([]);
    const [alignedContent, setAlignedContent] = useState<AlignedCell[] | null>(null);

    const existingMaculaBible = existingFiles.find(
        (file) =>
            file.metadata?.id === "macula-greek-hebrew" ||
            file.name.toLowerCase().includes("macula") ||
            file.name.toLowerCase().includes("hebrew-greek")
    );

    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;

    const processVersesToNotebooks = useCallback(
        async (verses: { vref: string; text: string }[]) => {
            try {
                setProgress({ stage: "creating", message: "Creating notebooks...", progress: 60 });

                const bookGroups = new Map<string, typeof verses>();
                for (const verse of verses) {
                    const bookCode = verse.vref.split(" ")[0];
                    if (!bookGroups.has(bookCode)) {
                        bookGroups.set(bookCode, []);
                    }
                    bookGroups.get(bookCode)!.push(verse);
                }

                const notebookPairs: NotebookPair[] = [];
                let bookCount = 0;
                const totalBooks = bookGroups.size;

                for (const [bookCode, bookVerses] of bookGroups.entries()) {
                    const fullBookName = getFullBookName(bookCode);

                    const baseCorpusMarker = getCorpusMarkerForBook(bookCode);
                    const isNT = isNewTestamentBook(bookCode);
                    const corpusMarker = baseCorpusMarker
                        ? baseCorpusMarker === "NT"
                            ? "Greek Bible"
                            : "Hebrew Bible"
                        : isNT
                          ? "Greek Bible"
                          : "Hebrew Bible";

                    const languagePrefix = isNT ? "Greek" : "Hebrew";
                    const notebookName = `${languagePrefix} ${fullBookName}`;

                    const sourceNotebook: ProcessedNotebook = {
                        name: bookCode,
                        cells: bookVerses.map((verse) => {
                            const { cellId, metadata } = createMaculaVerseCellMetadata({
                                vref: verse.vref,
                                text: verse.text,
                                fileName: `${bookCode}.macula`,
                            });
                            return {
                                id: cellId,
                                content: verse.text,
                                images: [],
                                metadata: {
                                    ...metadata,
                                    vref: verse.vref,
                                },
                            };
                        }),
                        metadata: {
                            id: uuidv4(),
                            originalFileName: `${fullBookName}.macula`,
                            sourceFile: `${fullBookName}.macula`,
                            importerType: "macula",
                            createdAt: new Date().toISOString(),
                            importContext: {
                                importerType: "macula",
                                fileName: `${fullBookName}.macula`,
                                originalFileName: `${fullBookName}.macula`,
                                importTimestamp: new Date().toISOString(),
                            },
                            corpusMarker,
                            fileDisplayName: notebookName,
                        },
                    };

                    const codexNotebook: ProcessedNotebook = {
                        ...sourceNotebook,
                        name: bookCode,
                        cells: sourceNotebook.cells.map((cell) => ({
                            ...cell,
                            content: "",
                        })),
                        metadata: {
                            ...sourceNotebook.metadata,
                            id: uuidv4(),
                        },
                    };

                    const notebookPair = {
                        source: sourceNotebook,
                        codex: codexNotebook,
                    };

                    const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);
                    notebookPairs.push(notebookPairWithMilestones);

                    bookCount++;
                    setProgress({
                        stage: "creating",
                        message: `Processing book ${bookCount}/${totalBooks}: ${notebookName}`,
                        progress: 60 + (bookCount / totalBooks) * 30,
                    });
                }

                setNotebooks(notebookPairs);
                setProgress({ stage: "complete", message: "Download complete!", progress: 100 });
                setDownloadComplete(true);
                setIsDownloading(false);

                if (isTranslationImport) {
                    await handleTranslationAlignment(notebookPairs);
                }
            } catch (err) {
                console.error("Processing failed:", err);
                setError(err instanceof Error ? err.message : "Unknown error occurred");
                setIsDownloading(false);
            }
        },
        [isTranslationImport]
    );

    const handleDownload = useCallback(async () => {
        if (!downloadResource) {
            setError("Download functionality not available");
            return;
        }

        notifyImportStarted();
        setIsDownloading(true);
        setError(null);
        setProgress({ stage: "downloading", message: "Initializing download...", progress: 0 });

        try {
            const result = await downloadResource("macula-bible", (p) => {
                setProgress(p);
            });

            if (result?.verses) {
                await processVersesToNotebooks(result.verses);
            } else {
                throw new Error("Invalid response from download");
            }
        } catch (err) {
            console.error("Download failed:", err);
            setError(err instanceof Error ? err.message : "Unknown error occurred");
            setIsDownloading(false);
            notifyImportEnded();
        }
    }, [downloadResource, processVersesToNotebooks]);

    const handleTranslationAlignment = async (notebookPairs: NotebookPair[]) => {
        if (!alignContent || !wizardContext?.selectedSource) return;

        try {
            setProgress({
                stage: "aligning",
                message: "Preparing translation alignment...",
                progress: 0,
            });

            const allImportedContent: ImportedContent[] = [];
            for (const pair of notebookPairs) {
                const content = notebookToImportedContent(pair);
                allImportedContent.push(...content);
            }

            setProgress({
                stage: "aligning",
                message: "Aligning content with target...",
                progress: 50,
            });

            const aligned = await alignContent(
                allImportedContent,
                wizardContext.selectedSource.path,
                defaultCellAligner
            );

            setAlignedContent(aligned);
            setProgress({ stage: "complete", message: "Alignment complete!", progress: 100 });
        } catch (err) {
            console.error("Alignment failed:", err);
            setError(`Alignment failed: ${err instanceof Error ? err.message : "Unknown error"}`);
        }
    };

    const handleConfirmAlignment = () => {
        if (alignedContent && wizardContext?.selectedSource && onTranslationComplete) {
            onTranslationComplete(alignedContent, wizardContext.selectedSource.path);
        }
    };

    const handleComplete = () => {
        if (notebooks.length > 0 && onComplete) {
            onComplete(notebooks);
        }
    };

    // Translation alignment review
    if (isTranslationImport && alignedContent) {
        return (
            <div className="container mx-auto p-6 max-w-4xl space-y-6">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Languages className="h-6 w-6" />
                    Translation Ready
                </h1>

                <Alert>
                    <CheckCircle className="h-4 w-4" />
                    <div>
                        <AlertTitle>Alignment Complete</AlertTitle>
                        <AlertDescription>
                            Successfully aligned {alignedContent.length} items from the Macula Bible
                            with {wizardContext?.selectedSource?.name}.
                        </AlertDescription>
                    </div>
                </Alert>

                <Button onClick={handleConfirmAlignment} className="w-full h-12 text-base">
                    Finish Import
                </Button>
            </div>
        );
    }

    const totalCells = notebooks.reduce((sum, pair) => sum + pair.source.cells.length, 0);

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <h1 className="text-2xl font-bold flex items-center gap-2">
                <Languages className="h-6 w-6" />
                Macula Hebrew and Greek Bible
            </h1>

            {isTranslationImport && wizardContext?.selectedSource && (
                <Alert>
                    <Languages className="h-4 w-4" />
                    <AlertDescription>
                        Importing translation for: <strong>{wizardContext.selectedSource.name}</strong>
                    </AlertDescription>
                </Alert>
            )}

            {/* About / Info Card */}
            <Card>
                <CardHeader>
                    <CardTitle>About the Macula Bible</CardTitle>
                    <CardDescription>
                        Download the original language Bible with morphological annotations.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                            <span className="font-medium text-muted-foreground">Languages</span>
                            <p>Hebrew (OT) and Greek (NT)</p>
                        </div>
                        <div>
                            <span className="font-medium text-muted-foreground">Content</span>
                            <p>Both Old and New Testament</p>
                        </div>
                        <div>
                            <span className="font-medium text-muted-foreground">Features</span>
                            <p>Morphological annotations</p>
                        </div>
                        <div>
                            <span className="font-medium text-muted-foreground">Source</span>
                            <p>
                                <a
                                    href="https://github.com/genesis-ai-dev/hebrew-greek-bible"
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                >
                                    Genesis AI Development
                                    <ExternalLink className="h-3 w-3" />
                                </a>
                            </p>
                        </div>
                    </div>

                    {/* Download Button */}
                    <Button
                        onClick={handleDownload}
                        disabled={isDownloading || downloadComplete}
                        variant="outline"
                        className="gap-2"
                    >
                        {isDownloading ? (
                            <>
                                <Loader2 className="h-4 w-4 animate-spin" />
                                Downloading...
                            </>
                        ) : downloadComplete ? (
                            <>
                                <CheckCircle className="h-4 w-4" />
                                Downloaded
                            </>
                        ) : (
                            <>
                                <Download className="h-4 w-4" />
                                Download
                            </>
                        )}
                    </Button>
                </CardContent>
            </Card>

            {/* Existing Bible Warning */}
            {existingMaculaBible && (
                <Alert>
                    <Info className="h-4 w-4" />
                    <div>
                        <AlertTitle>Existing Macula Bible Found</AlertTitle>
                        <AlertDescription>
                            You already have a Macula Bible in your project:{" "}
                            <strong>{existingMaculaBible.name}</strong>.{" "}
                            {isTranslationImport
                                ? "This import will add translations to your existing target files."
                                : "Importing again will create duplicate files."}
                        </AlertDescription>
                    </div>
                </Alert>
            )}

            {/* Progress */}
            {isDownloading && (
                <div className="space-y-3">
                    <Progress value={progress.progress || 0} className="w-full" />
                    <div className="text-sm text-muted-foreground">
                        {progress.message || "Processing..."}{" "}
                        <span className="text-xs">({Math.round(progress.progress || 0)}%)</span>
                    </div>
                </div>
            )}

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* File Analysis (after download) */}
            {downloadComplete && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            File Analysis
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div>
                                <span className="font-medium text-muted-foreground">Books</span>
                                <p>{notebooks.length}</p>
                            </div>
                            <div>
                                <span className="font-medium text-muted-foreground">Total Cells</span>
                                <p>{totalCells.toLocaleString()}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Finish Import */}
            <Button
                onClick={handleComplete}
                disabled={!downloadComplete}
                className="w-full h-12 text-base"
                variant={downloadComplete ? "default" : "secondary"}
            >
                Finish Import
            </Button>
        </div>
    );
};
