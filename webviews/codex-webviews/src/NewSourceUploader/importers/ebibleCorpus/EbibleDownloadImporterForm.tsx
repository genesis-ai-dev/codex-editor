import React, { useState, useCallback } from "react";
import { ImporterComponentProps } from "../../types/plugin";
import { NotebookPair, ImportProgress } from "../../types/common";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import { Label } from "../../../components/ui/label";
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
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import {
    Download,
    ExternalLink,
    CheckCircle,
    XCircle,
    ArrowLeft,
    Globe,
    BookOpen,
} from "lucide-react";

// Popular eBible options
const POPULAR_EBIBLE_OPTIONS = [
    {
        languageCode: "eng",
        translationId: "web",
        title: "World English Bible",
        description: "Modern English translation",
        abbreviation: "WEB",
        direction: "ltr",
    },
    {
        languageCode: "spa",
        translationId: "reina1960",
        title: "Reina-Valera 1960",
        description: "Spanish Bible translation",
        abbreviation: "RVR60",
        direction: "ltr",
    },
    {
        languageCode: "fra",
        translationId: "lsg",
        title: "Louis Segond",
        description: "French Bible translation",
        abbreviation: "LSG",
        direction: "ltr",
    },
    {
        languageCode: "deu",
        translationId: "luther1912",
        title: "Luther Bible 1912",
        description: "German Bible translation",
        abbreviation: "LUT",
        direction: "ltr",
    },
];

interface EbibleMetadata {
    languageCode: string;
    translationId: string;
    title: string;
    description: string;
    direction: "ltr" | "rtl";
    abbreviation?: string;
}

export const EbibleDownloadImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
}) => {
    const [metadata, setMetadata] = useState<EbibleMetadata>({
        languageCode: "",
        translationId: "",
        title: "",
        description: "",
        direction: "ltr",
    });

    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair[] | null>(null);
    const [isChecking, setIsChecking] = useState(false);
    const [availability, setAvailability] = useState<{
        available: boolean;
        url: string;
        error?: string;
    } | null>(null);

    const handleInputChange = useCallback((field: keyof EbibleMetadata, value: string) => {
        setMetadata((prev) => ({ ...prev, [field]: value }));
        setIsDirty(true);
        setError(null);
        setAvailability(null);
    }, []);

    const handleSelectPopularOption = useCallback((option: EbibleMetadata) => {
        setMetadata(option);
        setIsDirty(true);
        setError(null);
        setAvailability(null);
    }, []);

    const handleCheckAvailability = useCallback(async () => {
        if (!metadata.languageCode || !metadata.translationId) {
            setError("Language code and translation ID are required");
            return;
        }

        setIsChecking(true);
        try {
            // Simulate checking availability (in real implementation, this would call an API)
            const url = `https://ebible.org/Scriptures/${metadata.languageCode}_${metadata.translationId}_usfm.zip`;

            // Simple availability check simulation
            await new Promise((resolve) => setTimeout(resolve, 1000));

            setAvailability({
                available: true,
                url,
            });
        } catch (err) {
            setAvailability({
                available: false,
                url: "",
                error: err instanceof Error ? err.message : "Unknown error",
            });
        } finally {
            setIsChecking(false);
        }
    }, [metadata]);

    const handleDownload = useCallback(async () => {
        if (!metadata.languageCode || !metadata.translationId) {
            setError("Language code and translation ID are required");
            return;
        }

        setIsProcessing(true);
        setError(null);
        setProgress([]);

        try {
            const onProgress = (progress: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((p) => p.stage !== progress.stage),
                    progress,
                ]);
            };

            // Simulate download and processing
            onProgress({
                stage: "Downloading",
                message: `Downloading ${metadata.title || metadata.translationId}...`,
                progress: 20,
            });

            await new Promise((resolve) => setTimeout(resolve, 2000));

            onProgress({
                stage: "Processing",
                message: "Processing USFM files...",
                progress: 60,
            });

            await new Promise((resolve) => setTimeout(resolve, 1500));

            onProgress({
                stage: "Creating Notebooks",
                message: "Creating notebook pairs...",
                progress: 90,
            });

            await new Promise((resolve) => setTimeout(resolve, 1000));

            // Create mock notebook pairs (in real implementation, this would process the downloaded files)
            const mockNotebookPairs: NotebookPair[] = [
                {
                    source: {
                        name: `${metadata.abbreviation || metadata.translationId}-Genesis`,
                        cells: [
                            {
                                id: "GEN 1:1",
                                content: "In the beginning God created the heavens and the earth.",
                                images: [],
                                metadata: {},
                            },
                            {
                                id: "GEN 1:2",
                                content:
                                    "The earth was formless and empty. Darkness was on the surface of the deep and God's Spirit was hovering over the surface of the waters.",
                                images: [],
                                metadata: {},
                            },
                        ],
                        metadata: {
                            id: `source-${Date.now()}`,
                            originalFileName: `${metadata.languageCode}_${metadata.translationId}_genesis.usfm`,
                            importerType: "ebible-download",
                            createdAt: new Date().toISOString(),
                        },
                    },
                    codex: {
                        name: `${metadata.abbreviation || metadata.translationId}-Genesis`,
                        cells: [
                            { id: "GEN 1:1", content: "", images: [], metadata: {} },
                            { id: "GEN 1:2", content: "", images: [], metadata: {} },
                        ],
                        metadata: {
                            id: `codex-${Date.now()}`,
                            originalFileName: `${metadata.languageCode}_${metadata.translationId}_genesis.usfm`,
                            importerType: "ebible-download",
                            createdAt: new Date().toISOString(),
                        },
                    },
                },
            ];

            onProgress({
                stage: "Complete",
                message: `Successfully downloaded ${metadata.title || metadata.translationId}`,
                progress: 100,
            });

            setResult(mockNotebookPairs);
            setIsDirty(false);

            // Automatically complete after showing success briefly
            setTimeout(() => {
                onComplete(mockNotebookPairs);
            }, 2000);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Download failed");
        } finally {
            setIsProcessing(false);
        }
    }, [metadata, onComplete]);

    const handleCancel = () => {
        if (isDirty && !window.confirm("Cancel download? Any unsaved changes will be lost.")) {
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
                    <Globe className="h-6 w-6" />
                    Download eBible Translation
                </h1>
                <Button variant="ghost" onClick={handleCancel} className="flex items-center gap-2">
                    <ArrowLeft className="h-4 w-4" />
                    Back to Home
                </Button>
            </div>

            {/* Popular Options */}
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <BookOpen className="h-5 w-5" />
                        Popular eBible Translations
                    </CardTitle>
                    <CardDescription>Select from commonly used Bible translations</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {POPULAR_EBIBLE_OPTIONS.map((option) => (
                            <div
                                key={`${option.languageCode}-${option.translationId}`}
                                className="p-4 border rounded-lg cursor-pointer hover:bg-muted/50 transition-colors"
                                onClick={() => handleSelectPopularOption(option)}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-medium">{option.title}</h4>
                                    <Badge variant="secondary">{option.abbreviation}</Badge>
                                </div>
                                <p className="text-sm text-muted-foreground mb-2">
                                    {option.description}
                                </p>
                                <div className="flex gap-2 text-xs text-muted-foreground">
                                    <span>Lang: {option.languageCode}</span>
                                    <span>ID: {option.translationId}</span>
                                    <Badge variant="outline" className="text-xs">
                                        {option.direction?.toUpperCase()}
                                    </Badge>
                                </div>
                            </div>
                        ))}
                    </div>
                </CardContent>
            </Card>

            {/* Custom Download Form */}
            <Card>
                <CardHeader>
                    <CardTitle>Custom eBible Download</CardTitle>
                    <CardDescription>
                        Enter specific language code and translation ID for eBible corpus
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="languageCode">Language Code *</Label>
                            <Input
                                id="languageCode"
                                placeholder="e.g., eng, spa, fra"
                                value={metadata.languageCode}
                                onChange={(e) => handleInputChange("languageCode", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="translationId">Translation ID *</Label>
                            <Input
                                id="translationId"
                                placeholder="e.g., web, reina1960, lsg"
                                value={metadata.translationId}
                                onChange={(e) => handleInputChange("translationId", e.target.value)}
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                            <Label htmlFor="title">Title (Optional)</Label>
                            <Input
                                id="title"
                                placeholder="e.g., World English Bible"
                                value={metadata.title}
                                onChange={(e) => handleInputChange("title", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="direction">Text Direction</Label>
                            <Select
                                value={metadata.direction}
                                onValueChange={(value: "ltr" | "rtl") =>
                                    handleInputChange("direction", value)
                                }
                            >
                                <SelectTrigger>
                                    <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ltr">Left to Right</SelectItem>
                                    <SelectItem value="rtl">Right to Left</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description (Optional)</Label>
                        <Input
                            id="description"
                            placeholder="Brief description of the translation"
                            value={metadata.description}
                            onChange={(e) => handleInputChange("description", e.target.value)}
                        />
                    </div>

                    <div className="flex gap-2">
                        <Button
                            onClick={handleCheckAvailability}
                            disabled={
                                isChecking || !metadata.languageCode || !metadata.translationId
                            }
                            variant="outline"
                        >
                            {isChecking ? "Checking..." : "Check Availability"}
                        </Button>

                        <Button
                            onClick={handleDownload}
                            disabled={
                                isProcessing || !metadata.languageCode || !metadata.translationId
                            }
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
                    </div>

                    {availability && (
                        <Alert variant={availability.available ? "default" : "destructive"}>
                            {availability.available ? (
                                <CheckCircle className="h-4 w-4 text-green-600" />
                            ) : (
                                <XCircle className="h-4 w-4" />
                            )}
                            <AlertDescription>
                                {availability.available ? (
                                    <div className="flex items-center gap-2">
                                        <span>Translation available for download</span>
                                        <a
                                            href={availability.url}
                                            target="_blank"
                                            rel="noopener noreferrer"
                                            className="inline-flex items-center gap-1 text-primary hover:underline"
                                        >
                                            <ExternalLink className="h-3 w-3" />
                                            View Source
                                        </a>
                                    </div>
                                ) : (
                                    availability.error || "Translation not available"
                                )}
                            </AlertDescription>
                        </Alert>
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
                                Successfully downloaded {result.length} book
                                {result.length > 1 ? "s" : ""}!
                            </AlertDescription>
                        </Alert>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
