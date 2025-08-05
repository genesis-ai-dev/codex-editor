import React, { useState, useCallback, useEffect } from "react";
import {
    ImporterComponentProps,
    AlignedCell,
    CellAligner,
    ImportedContent,
    defaultCellAligner,
    ImportBookNamesMessage,
} from "../../types/plugin";
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
    Database,
    CheckCircle,
    XCircle,
    ArrowLeft,
    Eye,
    FileText,
    Settings,
    BookOpen,
    MapPin,
    Languages,
    Info,
    ArrowRight,
    Download,
    ExternalLink,
    FolderOpen,
    Globe,
    Loader2,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { paratextImporter } from "./parser";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { AlignmentPreview } from "../../components/AlignmentPreview";

// Use the real parser functions from the Paratext importer
const { validateFile, parseFile } = paratextImporter;

// Get the VSCode API
const vscode: { postMessage: (message: any) => void } = (window as any).vscodeApi;

export const ParatextImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [file, setFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAligning, setIsAligning] = useState(false);
    const [isRetrying, setIsRetrying] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<NotebookPair | NotebookPair[] | null>(null);
    const [validation, setValidation] = useState<any>(null);
    const [projectInfo, setProjectInfo] = useState<any>(null);
    const [notebookPairs, setNotebookPairs] = useState<NotebookPair[]>([]);
    const [bookNamesImported, setBookNamesImported] = useState(false);
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [importedContent, setImportedContent] = useState<ImportedContent[]>([]);
    const [targetCells, setTargetCells] = useState<any[]>([]);

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
            setProjectInfo(null);

            // Validate the file
            try {
                const validationResult = await validateFile(selectedFile);
                setValidation(validationResult);
            } catch (err) {
                console.warn("Could not validate file:", err);
                setValidation({
                    isValid: false,
                    errors: ["Could not validate file"],
                    warnings: [],
                });
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

            // Parse file
            const importResult = await parseFile(file, onProgress);

            if (
                !importResult.success ||
                (!importResult.notebookPairs && !importResult.notebookPair)
            ) {
                throw new Error(importResult.error || "Failed to parse Paratext project");
            }

            // Handle both single pair (backwards compatibility) and multiple pairs
            const notebookPairs =
                importResult.notebookPairs ||
                (importResult.notebookPair ? [importResult.notebookPair] : []);

            setResult(notebookPairs[0]); // Display first pair for UI purposes
            setNotebookPairs(notebookPairs); // Store all pairs
            setProjectInfo({
                ...importResult.metadata,
                notebookPairCount: notebookPairs.length,
                totalCellsAllBooks: notebookPairs.reduce(
                    (sum, pair) => sum + pair.source.cells.length,
                    0
                ),
            });

            // For translation imports, perform alignment
            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({
                    stage: "Alignment",
                    message: "Aligning Paratext content with target cells...",
                    progress: 80,
                });

                setIsAligning(true);

                try {
                    // For multi-file imports, we'll use the first file for now
                    const primaryNotebook = notebookPairs[0];
                    const importedContent = notebookToImportedContent(primaryNotebook);
                    setImportedContent(importedContent);

                    // Use default cell aligner for Paratext (structured content with verse IDs)
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
                        `Alignment failed: ${err instanceof Error ? err.message : "Unknown error"}`
                    );
                }
            } else {
                setIsDirty(false);
            }

            // Import book names if available
            if (importResult.metadata?.bookNamesXmlContent && !bookNamesImported) {
                // Send message to import book names
                const message: ImportBookNamesMessage = {
                    command: "importBookNames",
                    xmlContent: importResult.metadata.bookNamesXmlContent,
                    nameType: "long", // Use long names by default for Arabic
                };
                vscode.postMessage(message);
                setBookNamesImported(true);
            }
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

    const handleComplete = async () => {
        if (notebookPairs.length > 0) {
            try {
                // For multi-file imports, pass all notebook pairs for batch import
                const notebooks = notebookPairs.length === 1 ? notebookPairs[0] : notebookPairs;
                await handleImportCompletion(notebooks, props);
            } catch (err) {
                setError(err instanceof Error ? err.message : "Failed to complete import");
            }
        }
    };

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
                sourceCells={
                    Array.isArray(result)
                        ? result[0]?.source.cells || []
                        : result?.source.cells || []
                }
                selectedSourceName={selectedSource?.name}
                onConfirm={handleConfirmAlignment}
                onCancel={handleCancel}
                onRetryAlignment={handleRetryAlignment}
                isRetrying={isRetrying}
            />
        );
    }

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            <div className="flex items-center justify-between mb-6">
                <div>
                    <h1 className="text-2xl font-bold flex items-center gap-2">
                        <Database className="h-6 w-6" />
                        Import Paratext Project {isTranslationImport && "(Translation)"}
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

            <Card>
                <CardHeader>
                    <CardTitle>Select Paratext Project</CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? "Import Paratext translation project that will be aligned with existing cells. Content will be matched by verse references."
                            : "Import Paratext translation projects containing USFM files, project settings, and localized book names. Supports ZIP archives and individual project folders."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex gap-2 mb-4">
                        <Badge variant="outline">.zip</Badge>
                        <Badge variant="outline">.ptx</Badge>
                        <Badge variant="outline">Project Archives</Badge>
                    </div>

                    <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                        <input
                            type="file"
                            accept=".zip,.ptx,application/zip"
                            onChange={handleFileSelect}
                            className="hidden"
                            id="paratext-file-input"
                            disabled={isProcessing}
                        />
                        <label
                            htmlFor="paratext-file-input"
                            className="cursor-pointer inline-flex flex-col items-center gap-2"
                        >
                            <Upload className="h-12 w-12 text-muted-foreground" />
                            <span className="text-sm text-muted-foreground">
                                Click to select a Paratext project ZIP file or drag and drop
                            </span>
                        </label>
                    </div>

                    {file && validation && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between p-4 bg-muted/50 rounded-lg">
                                <div className="flex items-center gap-3">
                                    <Database className="h-5 w-5 text-muted-foreground" />
                                    <div>
                                        <p className="font-medium">{file.name}</p>
                                        <p className="text-sm text-muted-foreground">
                                            {(file.size / (1024 * 1024)).toFixed(1)} MB
                                        </p>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {validation.isValid ? (
                                        <Badge
                                            variant="default"
                                            className="bg-green-100 text-green-800"
                                        >
                                            <CheckCircle className="h-3 w-3 mr-1" />
                                            Valid
                                        </Badge>
                                    ) : (
                                        <Badge variant="destructive">
                                            <XCircle className="h-3 w-3 mr-1" />
                                            Invalid
                                        </Badge>
                                    )}
                                </div>
                            </div>

                            {/* Validation Results */}
                            {validation.warnings.length > 0 && (
                                <Alert>
                                    <Info className="h-4 w-4" />
                                    <AlertDescription>
                                        <div className="space-y-1">
                                            <div className="font-medium">Project Information:</div>
                                            {validation.warnings.map(
                                                (warning: string, index: number) => (
                                                    <div key={index} className="text-sm">
                                                        • {warning}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {validation.errors.length > 0 && (
                                <Alert variant="destructive">
                                    <XCircle className="h-4 w-4" />
                                    <AlertDescription>
                                        <div className="space-y-1">
                                            <div className="font-medium">Validation Errors:</div>
                                            {validation.errors.map(
                                                (error: string, index: number) => (
                                                    <div key={index} className="text-sm">
                                                        • {error}
                                                    </div>
                                                )
                                            )}
                                        </div>
                                    </AlertDescription>
                                </Alert>
                            )}

                            {validation.isValid && (
                                <Button
                                    onClick={handleImport}
                                    disabled={isProcessing}
                                    className="w-full flex items-center gap-2"
                                >
                                    {isProcessing ? (
                                        <>Processing Project...</>
                                    ) : (
                                        <>
                                            <Upload className="h-4 w-4" />
                                            Import Paratext Project
                                        </>
                                    )}
                                </Button>
                            )}
                        </div>
                    )}

                    {progress.length > 0 && (
                        <div className="space-y-3">
                            <div className="flex items-center justify-between">
                                <span className="text-sm font-medium">Import Progress</span>
                                <span className="text-sm text-muted-foreground">
                                    {totalProgress}%
                                </span>
                            </div>
                            <Progress value={totalProgress} className="w-full" />
                            <div className="space-y-2">
                                {progress.map((item, index) => (
                                    <div
                                        key={index}
                                        className="text-sm text-muted-foreground flex items-center gap-2"
                                    >
                                        <div className="w-2 h-2 rounded-full bg-blue-500 flex-shrink-0"></div>
                                        <span className="font-medium">{item.stage}:</span>
                                        <span>{item.message}</span>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {error && (
                        <Alert variant="destructive">
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    {result && projectInfo && (
                        <div className="space-y-4">
                            <Alert>
                                <CheckCircle className="h-4 w-4 text-green-600" />
                                <AlertDescription>
                                    <div className="space-y-2">
                                        <div className="font-medium">Import Successful!</div>
                                        <div className="grid grid-cols-2 gap-4 text-sm">
                                            <div className="flex items-center gap-2">
                                                <BookOpen className="h-4 w-4" />
                                                <span>
                                                    {projectInfo.notebookPairCount || 1} books
                                                    imported
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <FileText className="h-4 w-4" />
                                                <span>
                                                    {projectInfo.totalCellsAllBooks ||
                                                        projectInfo.segmentCount}{" "}
                                                    total segments
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Database className="h-4 w-4" />
                                                <span>{projectInfo.verseCount} verses</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <MapPin className="h-4 w-4" />
                                                <span>
                                                    {projectInfo.paratextCount} paratext segments
                                                </span>
                                            </div>
                                        </div>
                                        {projectInfo.notebookPairCount > 1 && (
                                            <div className="text-xs text-muted-foreground mt-2">
                                                Each book will be created as a separate notebook
                                                pair
                                            </div>
                                        )}
                                        {bookNamesImported && (
                                            <div className="text-xs text-green-600 mt-2 flex items-center gap-1">
                                                <CheckCircle className="h-3 w-3" />
                                                Book names automatically imported from project
                                            </div>
                                        )}
                                    </div>
                                </AlertDescription>
                            </Alert>

                            {/* Project Details */}
                            {projectInfo.projectMetadata && (
                                <Card>
                                    <CardHeader>
                                        <CardTitle className="text-sm flex items-center gap-2">
                                            <Settings className="h-4 w-4" />
                                            Project Information
                                        </CardTitle>
                                    </CardHeader>
                                    <CardContent className="space-y-3">
                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-sm">
                                            {projectInfo.projectMetadata.projectName && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Project Name
                                                    </div>
                                                    <div>
                                                        {projectInfo.projectMetadata.projectName}
                                                    </div>
                                                </div>
                                            )}
                                            {(projectInfo.projectMetadata.language ||
                                                projectInfo.languageCode) && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Language
                                                    </div>
                                                    <div className="flex items-center gap-2">
                                                        <Languages className="h-3 w-3" />
                                                        {projectInfo.projectMetadata.language ||
                                                            "Unknown"}
                                                        {projectInfo.languageCode &&
                                                            ` (${projectInfo.languageCode})`}
                                                    </div>
                                                </div>
                                            )}
                                            {projectInfo.projectMetadata.projectType && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Project Type
                                                    </div>
                                                    <div className="capitalize">
                                                        {projectInfo.projectMetadata.projectType}
                                                    </div>
                                                </div>
                                            )}
                                            {projectInfo.projectMetadata.versification && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Versification
                                                    </div>
                                                    <div>
                                                        {projectInfo.projectMetadata.versification}
                                                    </div>
                                                </div>
                                            )}
                                            {projectInfo.projectAbbreviation && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Project Code
                                                    </div>
                                                    <div className="font-mono">
                                                        {projectInfo.projectAbbreviation}
                                                    </div>
                                                </div>
                                            )}
                                            {projectInfo.detectedYear && (
                                                <div>
                                                    <div className="font-medium text-muted-foreground">
                                                        Project Year
                                                    </div>
                                                    <div>{projectInfo.detectedYear}</div>
                                                </div>
                                            )}
                                        </div>

                                        <div className="flex gap-2 pt-2">
                                            {projectInfo.hasBookNames && (
                                                <Badge variant="outline" className="text-xs">
                                                    <BookOpen className="h-3 w-3 mr-1" />
                                                    Book Names
                                                </Badge>
                                            )}
                                            {projectInfo.hasSettings && (
                                                <Badge variant="outline" className="text-xs">
                                                    <Settings className="h-3 w-3 mr-1" />
                                                    Settings
                                                </Badge>
                                            )}
                                            {projectInfo.languageCode && (
                                                <Badge variant="outline" className="text-xs">
                                                    <Languages className="h-3 w-3 mr-1" />
                                                    {projectInfo.languageCode.toUpperCase()}
                                                </Badge>
                                            )}
                                            {projectInfo.detectedYear && (
                                                <Badge variant="outline" className="text-xs">
                                                    📅 {projectInfo.detectedYear}
                                                </Badge>
                                            )}
                                        </div>

                                        {projectInfo.books && projectInfo.books.length > 0 && (
                                            <div>
                                                <div className="font-medium text-muted-foreground mb-2">
                                                    Books Included ({projectInfo.books.length})
                                                </div>
                                                <div className="flex flex-wrap gap-1">
                                                    {projectInfo.books
                                                        .slice(0, 20)
                                                        .map((book: string) => (
                                                            <Badge
                                                                key={book}
                                                                variant="secondary"
                                                                className="text-xs"
                                                            >
                                                                {book}
                                                            </Badge>
                                                        ))}
                                                    {projectInfo.books.length > 20 && (
                                                        <Badge
                                                            variant="outline"
                                                            className="text-xs"
                                                        >
                                                            +{projectInfo.books.length - 20} more
                                                        </Badge>
                                                    )}
                                                </div>
                                            </div>
                                        )}

                                        {/* Additional project details if available */}
                                        {(projectInfo.projectMetadata.description ||
                                            projectInfo.projectMetadata.copyright) && (
                                            <div className="border-t pt-3 mt-3">
                                                {projectInfo.projectMetadata.description && (
                                                    <div className="mb-2">
                                                        <div className="font-medium text-muted-foreground text-xs mb-1">
                                                            Description
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {
                                                                projectInfo.projectMetadata
                                                                    .description
                                                            }
                                                        </div>
                                                    </div>
                                                )}
                                                {projectInfo.projectMetadata.copyright && (
                                                    <div>
                                                        <div className="font-medium text-muted-foreground text-xs mb-1">
                                                            Copyright
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            {projectInfo.projectMetadata.copyright}
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </CardContent>
                                </Card>
                            )}

                            {/* Action buttons */}
                            <div className="flex gap-3 justify-end">
                                <Button
                                    variant="outline"
                                    onClick={handleCancel}
                                    className="flex items-center gap-2"
                                >
                                    <ArrowLeft className="h-4 w-4" />
                                    Cancel
                                </Button>
                                <Button
                                    onClick={handleComplete}
                                    className="flex items-center gap-2"
                                >
                                    <ArrowRight className="h-4 w-4" />
                                    Complete Import
                                </Button>
                            </div>
                        </div>
                    )}
                </CardContent>
            </Card>
        </div>
    );
};
