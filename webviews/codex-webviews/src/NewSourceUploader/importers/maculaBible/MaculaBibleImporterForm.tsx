import React, { useState, useCallback, useEffect } from "react";
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
    ArrowLeft,
    BookOpen,
    Loader2,
    Info,
    Languages,
} from "lucide-react";

import { notebookToImportedContent } from "../common/translationHelper";

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

    // State management
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

    // Check for existing Macula Bible
    const existingMaculaBible = existingFiles.find(
        (file) =>
            file.metadata?.id === "macula-greek-hebrew" ||
            file.name.toLowerCase().includes("macula") ||
            file.name.toLowerCase().includes("hebrew-greek")
    );

    // Determine if this is a translation import
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;

    const processVersesToNotebooks = useCallback(
        async (verses: { vref: string; text: string }[]) => {
            try {
                setProgress({ stage: "creating", message: "Creating notebooks...", progress: 60 });

                // Group verses by book
                const bookGroups = new Map<string, typeof verses>();
                for (const verse of verses) {
                    const bookName = verse.vref.split(" ")[0];
                    if (!bookGroups.has(bookName)) {
                        bookGroups.set(bookName, []);
                    }
                    bookGroups.get(bookName)!.push(verse);
                }

                // Create notebook pairs for each book
                const notebookPairs: NotebookPair[] = [];
                let bookCount = 0;
                const totalBooks = bookGroups.size;

                for (const [bookName, bookVerses] of bookGroups.entries()) {
                    const sourceNotebook: ProcessedNotebook = {
                        name: bookName,
                        cells: bookVerses.map((verse) => ({
                            id: verse.vref,
                            content: verse.text,
                            images: [],
                            metadata: {
                                type: "text",
                                id: verse.vref,
                                cellLabel: verse.vref.split(":")?.[1] || "1",
                            },
                        })),
                        metadata: {
                            id: bookName,
                            originalFileName: `${bookName}.macula`,
                            importerType: "macula-bible",
                            createdAt: new Date().toISOString(),
                            corpusMarker:
                                bookName.startsWith("MAT") ||
                                bookName.startsWith("MRK") ||
                                bookName.startsWith("LUK") ||
                                bookName.startsWith("JHN") ||
                                bookName.startsWith("ACT") ||
                                bookName.startsWith("ROM") ||
                                bookName.startsWith("1CO") ||
                                bookName.startsWith("2CO") ||
                                bookName.startsWith("GAL") ||
                                bookName.startsWith("EPH") ||
                                bookName.startsWith("PHP") ||
                                bookName.startsWith("COL") ||
                                bookName.startsWith("1TH") ||
                                bookName.startsWith("2TH") ||
                                bookName.startsWith("1TI") ||
                                bookName.startsWith("2TI") ||
                                bookName.startsWith("TIT") ||
                                bookName.startsWith("PHM") ||
                                bookName.startsWith("HEB") ||
                                bookName.startsWith("JAS") ||
                                bookName.startsWith("1PE") ||
                                bookName.startsWith("2PE") ||
                                bookName.startsWith("1JN") ||
                                bookName.startsWith("2JN") ||
                                bookName.startsWith("3JN") ||
                                bookName.startsWith("JUD") ||
                                bookName.startsWith("REV")
                                    ? "New Testament"
                                    : "Old Testament",
                        },
                    };

                    const codexNotebook: ProcessedNotebook = {
                        ...sourceNotebook,
                        cells: sourceNotebook.cells.map((cell) => ({
                            ...cell,
                            content: "", // Empty for codex
                        })),
                    };

                    notebookPairs.push({
                        source: sourceNotebook,
                        codex: codexNotebook,
                    });

                    bookCount++;
                    setProgress({
                        stage: "creating",
                        message: `Processing book ${bookCount}/${totalBooks}: ${bookName}`,
                        progress: 60 + (bookCount / totalBooks) * 30,
                    });
                }

                setNotebooks(notebookPairs);
                setProgress({ stage: "complete", message: "Download complete!", progress: 100 });
                setDownloadComplete(true);
                setIsDownloading(false);

                // If this is a translation import, handle alignment
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

        setIsDownloading(true);
        setError(null);
        setProgress({ stage: "downloading", message: "Initializing download...", progress: 0 });

        try {
            // Request download from provider using the generic download system
            const result = await downloadResource(
                "macula-bible", // Plugin ID
                (progress) => {
                    setProgress(progress);
                }
            );

            // Process the downloaded verses
            if (result && result.verses) {
                await processVersesToNotebooks(result.verses);
            } else {
                throw new Error("Invalid response from download");
            }
        } catch (err) {
            console.error("Download failed:", err);
            setError(err instanceof Error ? err.message : "Unknown error occurred");
            setIsDownloading(false);
        }
    }, [downloadResource]);

    const handleTranslationAlignment = async (notebookPairs: NotebookPair[]) => {
        if (!alignContent || !wizardContext?.selectedSource) return;

        try {
            setProgress({
                stage: "aligning",
                message: "Preparing translation alignment...",
                progress: 0,
            });

            // Convert all notebooks to imported content
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

            // Request alignment
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

    const handleRetryAlignment = async (aligner: CellAligner) => {
        if (!alignContent || !wizardContext?.selectedSource) return;

        try {
            const allImportedContent: ImportedContent[] = [];
            for (const pair of notebooks) {
                const content = notebookToImportedContent(pair);
                allImportedContent.push(...content);
            }

            const aligned = await alignContent(
                allImportedContent,
                wizardContext.selectedSource.path,
                aligner
            );

            setAlignedContent(aligned);
        } catch (err) {
            console.error("Retry alignment failed:", err);
            setError(
                `Alignment retry failed: ${err instanceof Error ? err.message : "Unknown error"}`
            );
        }
    };

    const handleComplete = () => {
        if (notebooks.length > 0 && onComplete) {
            onComplete(notebooks);
        }
    };

    // Show alignment preview for translation imports
    if (isTranslationImport && alignedContent) {
        return (
            <div className="container mx-auto p-6 max-w-4xl">
                <Card>
                    <CardHeader>
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-3">
                                <Languages className="h-6 w-6 text-primary" />
                                <div>
                                    <CardTitle>Translation Ready</CardTitle>
                                    <CardDescription>
                                        Macula Bible content aligned with{" "}
                                        {wizardContext?.selectedSource?.name}
                                    </CardDescription>
                                </div>
                            </div>
                            <Button variant="ghost" onClick={onCancel}>
                                <ArrowLeft className="h-4 w-4 mr-2" />
                                Back
                            </Button>
                        </div>
                    </CardHeader>
                    <CardContent className="space-y-6">
                        <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>Alignment Complete</AlertTitle>
                            <AlertDescription>
                                Successfully aligned {alignedContent.length} items from the Macula
                                Bible. Ready to import translations.
                            </AlertDescription>
                        </Alert>

                        <div className="flex justify-between">
                            <Button variant="outline" onClick={onCancel}>
                                Cancel
                            </Button>
                            <Button onClick={handleConfirmAlignment}>
                                <BookOpen className="h-4 w-4 mr-2" />
                                Import Translation
                            </Button>
                        </div>
                    </CardContent>
                </Card>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <Languages className="h-6 w-6 text-primary" />
                            <div>
                                <CardTitle>Macula Hebrew and Greek Bible</CardTitle>
                                <CardDescription>
                                    {isTranslationImport
                                        ? `Import translation for: ${wizardContext?.selectedSource?.name}`
                                        : "Download the original language Bible with morphological annotations"}
                                </CardDescription>
                            </div>
                        </div>
                        <Button variant="ghost" onClick={onCancel}>
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                    </div>
                </CardHeader>

                <CardContent className="space-y-6">
                    {/* Bible Information */}
                    <div className="bg-muted/50 p-4 rounded-lg">
                        <div className="flex items-start gap-3">
                            <Info className="h-5 w-5 text-blue-500 mt-0.5" />
                            <div>
                                <h4 className="font-medium mb-2">About the Macula Bible</h4>
                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm text-muted-foreground">
                                    <div>
                                        <span className="font-medium">Languages:</span> Hebrew (OT)
                                        and Greek (NT)
                                    </div>
                                    <div>
                                        <span className="font-medium">Content:</span> Both Old and
                                        New Testament
                                    </div>
                                    <div>
                                        <span className="font-medium">Features:</span> Morphological
                                        annotations
                                    </div>
                                    <div>
                                        <span className="font-medium">Source:</span> Genesis AI
                                        Development
                                    </div>
                                </div>
                                <div className="mt-3">
                                    <a
                                        href="https://github.com/genesis-ai-dev/hebrew-greek-bible"
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="inline-flex items-center gap-1 text-blue-600 hover:text-blue-800 text-sm"
                                    >
                                        View repository
                                        <ExternalLink className="h-3 w-3" />
                                    </a>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Existing Bible Check */}
                    {existingMaculaBible && (
                        <Alert>
                            <Info className="h-4 w-4" />
                            <AlertTitle>Existing Macula Bible Found</AlertTitle>
                            <AlertDescription>
                                You already have a Macula Bible in your project:{" "}
                                <strong>{existingMaculaBible.name}</strong>
                                {isTranslationImport
                                    ? " This import will add translations to your existing target files."
                                    : " Importing again will create duplicate files."}
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Error Display */}
                    {error && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertTitle>Download Failed</AlertTitle>
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {/* Progress Display */}
                    {isDownloading && (
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <Loader2 className="h-4 w-4 animate-spin" />
                                <span className="text-sm font-medium">
                                    {progress.message || "Processing..."}
                                </span>
                            </div>
                            <Progress value={progress.progress || 0} className="w-full" />
                            <p className="text-xs text-muted-foreground">
                                {Math.round(progress.progress || 0)}% complete
                            </p>
                        </div>
                    )}

                    {/* Success Display */}
                    {downloadComplete && !isTranslationImport && (
                        <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertTitle>Download Complete</AlertTitle>
                            <AlertDescription>
                                Successfully downloaded {notebooks.length} books from the Macula
                                Bible. Ready to import into your project.
                            </AlertDescription>
                        </Alert>
                    )}

                    {/* Action Buttons */}
                    <div className="flex justify-between">
                        <Button variant="outline" onClick={onCancel}>
                            Cancel
                        </Button>

                        <div className="flex gap-2">
                            {!downloadComplete && (
                                <Button
                                    onClick={handleDownload}
                                    disabled={isDownloading}
                                    className="min-w-[120px]"
                                >
                                    {isDownloading ? (
                                        <>
                                            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                                            Downloading
                                        </>
                                    ) : (
                                        <>
                                            <Download className="h-4 w-4 mr-2" />
                                            Download
                                        </>
                                    )}
                                </Button>
                            )}

                            {downloadComplete && !isTranslationImport && (
                                <Button onClick={handleComplete}>
                                    <BookOpen className="h-4 w-4 mr-2" />
                                    Import to Project
                                </Button>
                            )}
                        </div>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
