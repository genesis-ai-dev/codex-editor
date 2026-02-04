import React, { useState, useCallback, useEffect, useMemo } from "react";
import {
    ImporterComponentProps,
    AlignedCell,
    CellAligner,
    ImportedContent,
    defaultCellAligner,
} from "../../types/plugin";
import { ImportProgress, NotebookPair } from "../../types/common";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
import { Checkbox } from "../../../components/ui/checkbox";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../../components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription, AlertTitle } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogHeader,
    DialogTitle,
} from "../../../components/ui/dialog";
import {
    Download,
    ExternalLink,
    CheckCircle,
    XCircle,
    ArrowLeft,
    Globe,
    Search,
    Filter,
    Book,
    Languages,
    Info,
    AlertCircle,
    BookOpen,
    Loader2,
} from "lucide-react";

import {
    EbibleTranslation,
    parseTranslationsCSV,
    filterTranslations,
    getTranslationStats,
} from "./components/translationUtils";
import { downloadEbibleCorpus } from "./download";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { EbibleDownloadForm } from "../../components/EbibleDownloadForm";
import { ebibleCorpusImporter } from "./index";
import { AlignmentPreview } from "../../components/AlignmentPreview";

// Import the translations.csv file
import translationsCSV from "./translations.csv?raw";


export const EbibleDownloadImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const {
        onCancel,
        onTranslationComplete,
        alignContent,
        wizardContext,
        existingFiles = [],
    } = props;
    const [showExistingCheck, setShowExistingCheck] = useState(true);

    // Filter for Bible files from existing files
    const existingBibles = React.useMemo(() => {
        return existingFiles.filter(
            (file) =>
                file.type === "bible" ||
                file.type === "ebibleCorpus" ||
                file.type === "paratext" ||
                (file.metadata?.corpusMarker &&
                    ["ebibleCorpus", "paratext"].includes(file.metadata.corpusMarker))
        );
    }, [existingFiles]);
    const [selectedTranslation, setSelectedTranslation] = useState<EbibleTranslation | null>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [filters, setFilters] = useState({
        hasOT: false,
        hasNT: false,
        hasDC: false,
        textDirection: "all" as "ltr" | "rtl" | "all",
        downloadable: true,
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [showDetails, setShowDetails] = useState(false);
    const [result, setResult] = useState<NotebookPair | null>(null);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    // Parse translations from CSV
    const allTranslations = useMemo(() => {
        try {
            return parseTranslationsCSV(translationsCSV);
        } catch (err) {
            console.error("Failed to parse translations CSV:", err);
            return [];
        }
    }, []);

    // Filter translations based on search and filters
    const filteredTranslations = useMemo(() => {
        return filterTranslations(allTranslations, searchTerm, filters);
    }, [allTranslations, searchTerm, filters]);

    // Group by language for display
    const translationsByLanguage = useMemo(() => {
        const grouped = new Map<string, EbibleTranslation[]>();
        filteredTranslations.forEach((translation) => {
            const lang = translation.languageNameInEnglish || translation.languageCode;
            if (!grouped.has(lang)) {
                grouped.set(lang, []);
            }
            grouped.get(lang)!.push(translation);
        });
        return Array.from(grouped.entries()).sort((a, b) => a[0].localeCompare(b[0]));
    }, [filteredTranslations]);

    const handleSelectTranslation = useCallback((translation: EbibleTranslation) => {
        setSelectedTranslation(translation);
        setError(null);
    }, []);

    const handleDownload = useCallback(async () => {
        if (!selectedTranslation) {
            setError("Please select a translation to download");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setProgress([]);
        setAlignedCells(null);

        try {
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            const result = await downloadEbibleCorpus(
                {
                    languageCode: selectedTranslation.languageCode,
                    translationId: selectedTranslation.translationId,
                    title: selectedTranslation.title,
                    description: selectedTranslation.description,
                    textDirection: selectedTranslation.textDirection as "ltr" | "rtl" | undefined,
                },
                onProgress
            );

            if (result.success && result.notebookPair) {
                // If we have multiple notebooks (for different books), handle them
                const allNotebooks = (result.metadata as any)?.allNotebooks;
                let primaryNotebook: NotebookPair;

                if (allNotebooks) {
                    // Convert all notebooks to array format
                    const notebookPairs: NotebookPair[] = Object.values(allNotebooks);
                    primaryNotebook = notebookPairs[0];

                    onProgress({
                        stage: "Complete",
                        message: `Successfully downloaded ${
                            Object.keys(allNotebooks).length
                        } books`,
                        progress: 80,
                    });
                } else {
                    primaryNotebook = result.notebookPair as NotebookPair;
                }

                setResult(primaryNotebook);

                // For translation imports, perform alignment
                if (isTranslationImport && alignContent && selectedSource) {
                    onProgress({
                        stage: "Alignment",
                        message: "Aligning eBible content with target cells...",
                        progress: 85,
                    });

                    setIsAligning(true);

                    try {
                        // Convert notebook to imported content
                        const importedContent = notebookToImportedContent(primaryNotebook);
                        setImportedContent(importedContent);

                        // Use default cell aligner for eBible (structured content with verse IDs)
                        const aligned = await alignContent(
                            importedContent,
                            selectedSource.path,
                            defaultCellAligner
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
                            `Alignment failed: ${
                                err instanceof Error ? err.message : "Unknown error"
                            }`
                        );
                    }
                } else {
                    // For source imports, complete normally
                    if (allNotebooks) {
                        const notebookPairs: NotebookPair[] = Object.values(allNotebooks);

                        setTimeout(async () => {
                            try {
                                // For multi-file imports, pass all notebook pairs for batch import
                                await handleImportCompletion(notebookPairs, props);
                            } catch (err) {
                                setError(
                                    err instanceof Error ? err.message : "Failed to complete import"
                                );
                            }
                        }, 2000);
                    } else {
                        // Single notebook - use the translation helper
                        try {
                            await handleImportCompletion(
                                result.notebookPair as NotebookPair,
                                props
                            );
                        } catch (err) {
                            setError(
                                err instanceof Error ? err.message : "Failed to complete import"
                            );
                        }
                    }
                }
            } else {
                throw new Error(result.error || "Download failed");
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed");
            setIsProcessing(false);
        }
    }, [selectedTranslation, props]);

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
        if (isProcessing) {
            if (!window.confirm("Cancel download in progress?")) {
                return;
            }
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

    // Show existing bibles warning first if there are any
    if (showExistingCheck && existingBibles.length > 0) {
        return (
            <div className="container mx-auto p-6 max-w-4xl">
                <div className="flex items-center justify-between mb-6">
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Globe className="h-6 w-6" />
                        Download eBible Translation {isTranslationImport && "(Translation)"}
                    </h1>
                    {isTranslationImport && selectedSource && (
                        <p className="text-muted-foreground">
                            Importing translation for:{" "}
                            <span className="font-medium">{selectedSource.name}</span>
                        </p>
                    )}
                    <Button
                        variant="ghost"
                        onClick={handleCancel}
                        className="flex items-center gap-2"
                    >
                        <ArrowLeft className="h-4 w-4" />
                        Back to Home
                    </Button>
                </div>

                <div className="space-y-4">
                    <Alert
                        variant="destructive"
                        className="border-yellow-600 bg-yellow-50 dark:bg-yellow-950/20"
                    >
                        <AlertCircle className="h-4 w-4 text-yellow-600" />
                        <AlertTitle className="text-yellow-800 dark:text-yellow-200">
                            Existing Bible Found in Project
                        </AlertTitle>
                        <AlertDescription className="text-yellow-700 dark:text-yellow-300">
                            <p className="mb-4">
                                You already have {existingBibles.length} Bible
                                {existingBibles.length > 1 ? "s" : ""} in your project. To maintain
                                data integrity, we recommend either:
                            </p>
                            <ul className="list-disc list-inside space-y-2 mb-4">
                                <li>Delete the existing Bible(s) first, then import the new one</li>
                                <li>Start a new project for the new Bible translation</li>
                            </ul>

                            <div className="space-y-2">
                                <h4 className="font-semibold">Existing Bibles:</h4>
                                {existingBibles.map((bible, index) => (
                                    <div
                                        key={index}
                                        className="bg-white dark:bg-gray-800 p-3 rounded-md border"
                                    >
                                        <div className="flex items-center justify-between">
                                            <div>
                                                <p className="font-medium">{bible.name}</p>
                                                <p className="text-sm text-muted-foreground">
                                                    {bible.cellCount} cells
                                                    {bible.type && bible.type !== "bible" && (
                                                        <span className="ml-2">• {bible.type}</span>
                                                    )}
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </AlertDescription>
                    </Alert>

                    <div className="flex gap-3 justify-end">
                        <Button variant="outline" onClick={handleCancel}>
                            Cancel Import
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => setShowExistingCheck(false)}
                            className="bg-yellow-600 hover:bg-yellow-700"
                        >
                            Continue Anyway
                        </Button>
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-6xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Globe className="h-6 w-6" />
                        Download eBible Translation {isTranslationImport && "(Translation)"}
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

            {/* Search and Filters */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Search className="h-5 w-5" />
                        Search Translations
                    </CardTitle>
                    <CardDescription>
                        Search from {allTranslations.length} available Bible translations
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="relative">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-muted-foreground h-4 w-4" />
                        <Input
                            placeholder="Search by language, code, or translation name..."
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            className="pl-10"
                        />
                    </div>

                    <div className="flex flex-wrap gap-4">
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="hasOT"
                                checked={filters.hasOT}
                                onCheckedChange={(checked) =>
                                    setFilters((prev) => ({ ...prev, hasOT: !!checked }))
                                }
                            />
                            <Label htmlFor="hasOT">Has Old Testament</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="hasNT"
                                checked={filters.hasNT}
                                onCheckedChange={(checked) =>
                                    setFilters((prev) => ({ ...prev, hasNT: !!checked }))
                                }
                            />
                            <Label htmlFor="hasNT">Has New Testament</Label>
                        </div>
                        <div className="flex items-center space-x-2">
                            <Checkbox
                                id="hasDC"
                                checked={filters.hasDC}
                                onCheckedChange={(checked) =>
                                    setFilters((prev) => ({ ...prev, hasDC: !!checked }))
                                }
                            />
                            <Label htmlFor="hasDC">Has Deuterocanon</Label>
                        </div>
                        <Select
                            value={filters.textDirection}
                            onValueChange={(value: "ltr" | "rtl" | "all") =>
                                setFilters((prev) => ({ ...prev, textDirection: value }))
                            }
                        >
                            <SelectTrigger className="w-[180px]">
                                <SelectValue placeholder="Text direction" />
                            </SelectTrigger>
                            <SelectContent>
                                <SelectItem value="all">All Directions</SelectItem>
                                <SelectItem value="ltr">Left to Right</SelectItem>
                                <SelectItem value="rtl">Right to Left</SelectItem>
                            </SelectContent>
                        </Select>
                    </div>

                    <p className="text-sm text-muted-foreground">
                        Showing {filteredTranslations.length} of {allTranslations.length}{" "}
                        translations
                    </p>
                </CardContent>
            </Card>

            {/* Selected Translation Details */}
            {selectedTranslation && (
                <Card className="border-primary">
                    <CardHeader>
                        <CardTitle className="flex items-center justify-between">
                            <span className="flex items-center gap-2">
                                <Book className="h-5 w-5" />
                                Selected Translation
                            </span>
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => setSelectedTranslation(null)}
                            >
                                <XCircle className="h-4 w-4" />
                            </Button>
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="space-y-3">
                            <div>
                                <h3 className="font-semibold text-lg">
                                    {selectedTranslation.title}
                                </h3>
                                <p className="text-sm text-muted-foreground">
                                    {selectedTranslation.description}
                                </p>
                            </div>

                            <div className="flex flex-wrap gap-2">
                                <Badge variant="secondary">
                                    <Languages className="h-3 w-3 mr-1" />
                                    {selectedTranslation.languageNameInEnglish} (
                                    {selectedTranslation.languageCode})
                                </Badge>
                                <Badge variant="secondary">
                                    ID: {selectedTranslation.translationId}
                                </Badge>
                                <Badge variant="outline">
                                    {selectedTranslation.textDirection?.toUpperCase()}
                                </Badge>
                                {selectedTranslation.shortTitle && (
                                    <Badge>{selectedTranslation.shortTitle}</Badge>
                                )}
                            </div>

                            <div className="grid grid-cols-3 gap-4 text-sm">
                                {(() => {
                                    const stats = getTranslationStats(selectedTranslation);
                                    return (
                                        <>
                                            <div>
                                                <span className="text-muted-foreground">
                                                    Total Books:
                                                </span>{" "}
                                                <span className="font-medium">
                                                    {stats.totalBooks}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">
                                                    Total Verses:
                                                </span>{" "}
                                                <span className="font-medium">
                                                    {stats.totalVerses.toLocaleString()}
                                                </span>
                                            </div>
                                            <div>
                                                <span className="text-muted-foreground">
                                                    Updated:
                                                </span>{" "}
                                                <span className="font-medium">
                                                    {new Date(
                                                        selectedTranslation.updateDate
                                                    ).toLocaleDateString()}
                                                </span>
                                            </div>
                                        </>
                                    );
                                })()}
                            </div>

                            {selectedTranslation.copyright && (
                                <div className="text-xs text-muted-foreground border-t pt-3">
                                    {selectedTranslation.copyright}
                                </div>
                            )}

                            <div className="flex gap-2 pt-2">
                                <Button
                                    onClick={handleDownload}
                                    disabled={isProcessing}
                                    className="flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>Processing...</>
                                    ) : (
                                        <>
                                            <Download className="h-4 w-4" />
                                            Download & Import
                                        </>
                                    )}
                                </Button>
                                <Button
                                    variant="outline"
                                    onClick={() => setShowDetails(true)}
                                    className="flex items-center gap-2"
                                >
                                    <Info className="h-4 w-4" />
                                    More Details
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Progress Display */}
            {progress.length > 0 && (
                <Card>
                    <CardContent className="pt-6">
                        <div className="space-y-3">
                            <Progress value={totalProgress} className="w-full" />
                            {progress.map((item, index) => (
                                <div key={index} className="text-sm text-muted-foreground">
                                    {item.stage}: {item.message}
                                </div>
                            ))}
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Error Display */}
            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Translation List */}
            <Card>
                <CardHeader>
                    <CardTitle>Available Translations</CardTitle>
                    <CardDescription>
                        Click on a translation to select it for download
                    </CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                        {translationsByLanguage.map(([language, translations]) => (
                            <div key={language} className="space-y-1">
                                <h4 className="font-medium text-sm text-muted-foreground sticky top-0 bg-background py-1">
                                    {language}
                                </h4>
                                {translations.map((translation) => {
                                    const stats = getTranslationStats(translation);
                                    const isSelected =
                                        selectedTranslation?.translationId ===
                                        translation.translationId;

                                    return (
                                        <div
                                            key={`${translation.languageCode}-${translation.translationId}`}
                                            className={`p-3 border rounded-lg cursor-pointer transition-colors ${
                                                isSelected
                                                    ? "border-primary bg-primary/5"
                                                    : "hover:bg-muted/50"
                                            }`}
                                            onClick={() => handleSelectTranslation(translation)}
                                        >
                                            <div className="flex items-start justify-between">
                                                <div className="flex-1">
                                                    <h5 className="font-medium">
                                                        {translation.title ||
                                                            translation.translationId}
                                                    </h5>
                                                    {translation.description && (
                                                        <p className="text-sm text-muted-foreground">
                                                            {translation.description}
                                                        </p>
                                                    )}
                                                    <div className="flex gap-2 mt-1">
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            {translation.translationId}
                                                        </Badge>
                                                        {stats.hasOT && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                OT: {stats.otBooks}
                                                            </Badge>
                                                        )}
                                                        {stats.hasNT && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                NT: {stats.ntBooks}
                                                            </Badge>
                                                        )}
                                                        {stats.hasDC && (
                                                            <Badge
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                DC: {stats.dcBooks}
                                                            </Badge>
                                                        )}
                                                    </div>
                                                </div>
                                                {isSelected && (
                                                    <CheckCircle className="h-5 w-5 text-primary" />
                                                )}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Details Dialog */}
            <Dialog open={showDetails} onOpenChange={setShowDetails}>
                <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
                    <DialogHeader>
                        <DialogTitle>Translation Details</DialogTitle>
                        <DialogDescription>
                            Complete information about {selectedTranslation?.title}
                        </DialogDescription>
                    </DialogHeader>
                    {selectedTranslation && (
                        <div className="space-y-4">
                            {Object.entries(selectedTranslation).map(([key, value]) => (
                                <div key={key} className="grid grid-cols-3 gap-2 text-sm">
                                    <span className="font-medium text-muted-foreground">
                                        {key.replace(/([A-Z])/g, " $1").trim()}:
                                    </span>
                                    <span className="col-span-2">{value || "N/A"}</span>
                                </div>
                            ))}
                        </div>
                    )}
                </DialogContent>
            </Dialog>
        </div>
    );
};
