import React, { useState, useCallback } from "react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Label } from "../../components/ui/label";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../components/ui/card";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select";
import { Badge } from "../../components/ui/badge";
import { Loader2, Download, ExternalLink, CheckCircle, AlertCircle } from "lucide-react";
import {
    ExtendedEbibleMetadata,
    validateEbibleMetadata,
    checkEbibleAvailability,
    getPopularEbibleOptions,
    downloadBibleFromEbible,
} from "../utils/ebibleDownload";
import { ProgressCallback } from "../types/common";

interface EbibleDownloadFormProps {
    onImportSuccess?: (result: any) => void;
    onImportError?: (error: string) => void;
    onProgress?: ProgressCallback;
}

export const EbibleDownloadForm: React.FC<EbibleDownloadFormProps> = ({
    onImportSuccess,
    onImportError,
    onProgress,
}) => {
    const [metadata, setMetadata] = useState<ExtendedEbibleMetadata>({
        languageCode: "",
        translationId: "",
        title: "",
        description: "",
        direction: "ltr",
    });

    const [isDownloading, setIsDownloading] = useState(false);
    const [isChecking, setIsChecking] = useState(false);
    const [availability, setAvailability] = useState<{
        available: boolean;
        url: string;
        error?: string;
    } | null>(null);
    const [asTranslationOnly, setAsTranslationOnly] = useState(false);
    const [validationErrors, setValidationErrors] = useState<string[]>([]);

    const popularOptions = getPopularEbibleOptions();

    // Handle input changes
    const handleInputChange = useCallback(
        (field: keyof ExtendedEbibleMetadata, value: string) => {
            setMetadata((prev) => ({ ...prev, [field]: value }));
            setAvailability(null); // Reset availability when metadata changes

            // Clear validation errors when user starts typing
            if (validationErrors.length > 0) {
                setValidationErrors([]);
            }
        },
        [validationErrors.length]
    );

    // Load popular option
    const handleSelectPopularOption = useCallback((option: ExtendedEbibleMetadata) => {
        setMetadata(option);
        setAvailability(null);
        setValidationErrors([]);
    }, []);

    // Check availability
    const handleCheckAvailability = useCallback(async () => {
        const errors = validateEbibleMetadata(metadata);
        if (errors.length > 0) {
            setValidationErrors(errors);
            return;
        }

        setIsChecking(true);
        try {
            const result = await checkEbibleAvailability(metadata);
            setAvailability(result);
        } catch (error) {
            setAvailability({
                available: false,
                url: "",
                error: error instanceof Error ? error.message : "Unknown error",
            });
        } finally {
            setIsChecking(false);
        }
    }, [metadata]);

    // Handle download
    const handleDownload = useCallback(async () => {
        const errors = validateEbibleMetadata(metadata);
        if (errors.length > 0) {
            setValidationErrors(errors);
            return;
        }

        setIsDownloading(true);
        try {
            const result = await downloadBibleFromEbible({
                metadata,
                asTranslationOnly,
                onProgress,
            });

            if (result.success) {
                onImportSuccess?.(result);
            } else {
                onImportError?.(result.error || "Download failed");
            }
        } catch (error) {
            const errorMessage = error instanceof Error ? error.message : "Unknown error";
            onImportError?.(errorMessage);
        } finally {
            setIsDownloading(false);
        }
    }, [metadata, asTranslationOnly, onProgress, onImportSuccess, onImportError]);

    return (
        <div className="space-y-6">
            {/* Popular Options */}
            <Card>
                <CardHeader>
                    <CardTitle>Popular eBible Translations</CardTitle>
                    <CardDescription>Select from commonly used Bible translations</CardDescription>
                </CardHeader>
                <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        {popularOptions.map((option) => (
                            <div
                                key={`${option.languageCode}-${option.translationId}`}
                                className="p-4 border rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                                onClick={() => handleSelectPopularOption(option)}
                            >
                                <div className="flex items-center justify-between mb-2">
                                    <h4 className="font-medium">{option.title}</h4>
                                    <Badge variant="secondary">{option.abbreviation}</Badge>
                                </div>
                                <p className="text-sm text-gray-600 mb-2">{option.description}</p>
                                <div className="flex gap-2 text-xs text-gray-500">
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
                                value={metadata.title || ""}
                                onChange={(e) => handleInputChange("title", e.target.value)}
                            />
                        </div>
                        <div className="space-y-2">
                            <Label htmlFor="direction">Text Direction</Label>
                            <Select
                                value={metadata.direction || "ltr"}
                                onValueChange={(value) => handleInputChange("direction", value)}
                            >
                                <SelectTrigger>
                                    <SelectValue placeholder="Select direction" />
                                </SelectTrigger>
                                <SelectContent>
                                    <SelectItem value="ltr">Left to Right (LTR)</SelectItem>
                                    <SelectItem value="rtl">Right to Left (RTL)</SelectItem>
                                </SelectContent>
                            </Select>
                        </div>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="description">Description (Optional)</Label>
                        <Input
                            id="description"
                            placeholder="Brief description of this translation"
                            value={metadata.description || ""}
                            onChange={(e) => handleInputChange("description", e.target.value)}
                        />
                    </div>

                    {/* Import Mode */}
                    <div className="space-y-2">
                        <Label>Import Mode</Label>
                        <div className="flex items-center space-x-2">
                            <input
                                type="checkbox"
                                id="translationOnly"
                                checked={asTranslationOnly}
                                onChange={(e) => setAsTranslationOnly(e.target.checked)}
                                className="rounded"
                            />
                            <Label htmlFor="translationOnly" className="text-sm">
                                Translation only (update existing notebooks)
                            </Label>
                        </div>
                    </div>

                    {/* Validation Errors */}
                    {validationErrors.length > 0 && (
                        <div className="space-y-2">
                            {validationErrors.map((error, index) => (
                                <div
                                    key={index}
                                    className="flex items-center gap-2 text-red-600 text-sm"
                                >
                                    <AlertCircle className="h-4 w-4" />
                                    {error}
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Availability Check */}
                    {availability && (
                        <div className="space-y-2">
                            <div
                                className={`flex items-center gap-2 text-sm ${
                                    availability.available ? "text-green-600" : "text-red-600"
                                }`}
                            >
                                {availability.available ? (
                                    <CheckCircle className="h-4 w-4" />
                                ) : (
                                    <AlertCircle className="h-4 w-4" />
                                )}
                                {availability.available
                                    ? "Available for download"
                                    : "Not available"}
                            </div>
                            {availability.error && (
                                <p className="text-sm text-red-600">{availability.error}</p>
                            )}
                            <div className="flex items-center gap-2 text-xs text-gray-500">
                                <ExternalLink className="h-3 w-3" />
                                <a
                                    href={availability.url}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="hover:underline"
                                >
                                    {availability.url}
                                </a>
                            </div>
                        </div>
                    )}

                    {/* Action Buttons */}
                    <div className="flex gap-3">
                        <Button
                            variant="outline"
                            onClick={handleCheckAvailability}
                            disabled={
                                isChecking || !metadata.languageCode || !metadata.translationId
                            }
                        >
                            {isChecking ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <ExternalLink className="mr-2 h-4 w-4" />
                            )}
                            Check Availability
                        </Button>

                        <Button
                            onClick={handleDownload}
                            disabled={
                                isDownloading || !metadata.languageCode || !metadata.translationId
                            }
                            className="flex-1"
                        >
                            {isDownloading ? (
                                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                            ) : (
                                <Download className="mr-2 h-4 w-4" />
                            )}
                            {asTranslationOnly ? "Download as Translation" : "Download Bible"}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};
