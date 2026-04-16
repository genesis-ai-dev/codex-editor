import React, { useState, useCallback, useRef } from "react";
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
    Eye,
    FileText,
    Settings,
    BookOpen,
    MapPin,
    Languages,
    Info,
    BarChart3,
    ExternalLink,
} from "lucide-react";
import { Badge } from "../../../components/ui/badge";
import { paratextImporter } from "./parser";
import { handleImportCompletion, notebookToImportedContent } from "../common/translationHelper";
import { notifyImportStarted, notifyImportEnded } from "../../utils/importProgress";
import { AlignmentPreview } from "../../components/AlignmentPreview";

const { validateFile, parseFile } = paratextImporter;

const vscode: { postMessage: (message: any) => void } = (window as any).vscodeApi;

export const ParatextImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onCancel, onTranslationComplete, alignContent, wizardContext } = props;
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
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
    const [previewContent, setPreviewContent] = useState("");
    const fileInputRef = useRef<HTMLInputElement>(null);

    const isTranslationImport = wizardContext?.intent === "target";
    const selectedSource = wizardContext?.selectedSource;

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const selectedFile = e.target.files?.[0];
        if (!selectedFile) return;

        setFile(selectedFile);
        setError(null);
        setProgress([]);
        setResult(null);
        setProjectInfo(null);
        setNotebookPairs([]);
        setAlignedCells(null);
        setImportedContent([]);
        setPreviewContent("");

        try {
            const validationResult = await validateFile(selectedFile);
            setValidation(validationResult);
        } catch (err) {
            setValidation({
                isValid: false,
                errors: ["Could not validate file"],
                warnings: [],
            });
        }
    }, []);

    const handleImport = useCallback(async () => {
        if (!file) return;

        notifyImportStarted();
        setIsProcessing(true);
        setError(null);
        setProgress([]);

        try {
            const onProgress = (p: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((item) => item.stage !== p.stage),
                    p,
                ]);
            };

            const importResult = await parseFile(file, onProgress);

            if (!importResult.success || (!importResult.notebookPairs && !importResult.notebookPair)) {
                throw new Error(importResult.error || "Failed to parse Paratext project");
            }

            const pairs = importResult.notebookPairs || (importResult.notebookPair ? [importResult.notebookPair] : []);

            setResult(pairs[0]);
            setNotebookPairs(pairs);
            setProjectInfo({
                ...importResult.metadata,
                notebookPairCount: pairs.length,
                totalCellsAllBooks: pairs.reduce((sum, pair) => sum + pair.source.cells.length, 0),
            });

            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({ stage: "Alignment", message: "Aligning content with target cells...", progress: 80 });

                const primaryNotebook = pairs[0];
                const content = notebookToImportedContent(primaryNotebook);
                setImportedContent(content);

                const aligned = await alignContent(content, selectedSource.path, defaultCellAligner);
                setAlignedCells(aligned);

                onProgress({ stage: "Complete", message: "Alignment complete - review and confirm", progress: 100 });
            }

            if (importResult.metadata?.bookNamesXmlContent && !bookNamesImported) {
                const message: ImportBookNamesMessage = {
                    command: "importBookNames",
                    xmlContent: importResult.metadata.bookNamesXmlContent,
                    nameType: "long",
                };
                vscode.postMessage(message);
                setBookNamesImported(true);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Unknown error occurred");
            notifyImportEnded();
        } finally {
            setIsProcessing(false);
        }
    }, [file, isTranslationImport, alignContent, selectedSource, bookNamesImported]);

    const handleComplete = useCallback(async () => {
        if (notebookPairs.length === 0) return;
        try {
            const notebooks = notebookPairs.length === 1 ? notebookPairs[0] : notebookPairs;
            await handleImportCompletion(notebooks, props);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to complete import");
            notifyImportEnded();
        }
    }, [notebookPairs, props]);

    const handleConfirmAlignment = useCallback(() => {
        if (!alignedCells || !selectedSource || !onTranslationComplete) return;
        onTranslationComplete(alignedCells, selectedSource.path);
    }, [alignedCells, selectedSource, onTranslationComplete]);

    const handleRetryAlignment = useCallback(async (aligner: CellAligner) => {
        if (!alignContent || !selectedSource || importedContent.length === 0) return;
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
    }, [alignContent, selectedSource, importedContent]);

    const totalProgress =
        progress.length > 0
            ? Math.round(progress.reduce((sum, p) => sum + (p.progress || 0), 0) / progress.length)
            : 0;

    if (alignedCells && isTranslationImport) {
        return (
            <AlignmentPreview
                alignedCells={alignedCells}
                importedContent={importedContent}
                targetCells={[]}
                sourceCells={Array.isArray(result) ? result[0]?.source.cells || [] : result?.source.cells || []}
                selectedSourceName={selectedSource?.name}
                onConfirm={handleConfirmAlignment}
                onCancel={onCancel}
                onRetryAlignment={handleRetryAlignment}
                isRetrying={isRetrying}
            />
        );
    }

    const hasFile = !!file;
    const isValid = validation?.isValid === true;
    const hasResult = !!result && !!projectInfo;
    const isReady = hasFile && isValid && !isProcessing && !hasResult;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <Database className="h-6 w-6" />
                    Import Paratext Project {isTranslationImport && "(Translation)"}
                </h1>
            </div>

            {isTranslationImport && selectedSource && (
                <Alert>
                    <Database className="h-4 w-4" />
                    <AlertDescription>
                        Importing translation for: <strong>{selectedSource.name}</strong>
                    </AlertDescription>
                </Alert>
            )}

            {/* Paratext Variety Warning */}
            <Alert className="border-amber-200 bg-amber-50">
                <Info className="h-4 w-4 text-amber-600" />
                <AlertDescription className="text-amber-800">
                    <div className="space-y-2">
                        <div className="font-medium">Important Note</div>
                        <div className="text-sm">
                            Paratext projects have a lot of variety in their structure and formatting.
                            While we've tested with many different projects, you may encounter issues
                            with your specific project.
                        </div>
                        <div className="text-sm">
                            Connect with us on our{" "}
                            <a
                                href="https://codexeditor.app"
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-amber-700 hover:text-amber-900 underline font-medium inline-flex items-center gap-1"
                            >
                                Discord server
                                <ExternalLink className="h-3 w-3" />
                            </a>{" "}
                            for support and feedback.
                        </div>
                    </div>
                </AlertDescription>
            </Alert>

            {/* Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Select Paratext Project</CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? "Import a Paratext translation project. Content will be matched by verse references."
                            : "Import Paratext projects containing USFM files, project settings, and localized book names."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">.zip</Badge>
                        <Badge variant="outline">.ptx</Badge>
                        <Badge variant="outline">Project Archives</Badge>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".zip,.ptx,application/zip"
                        onChange={handleFileSelect}
                        className="hidden"
                        disabled={isProcessing}
                    />
                    <Button
                        variant="outline"
                        onClick={() => fileInputRef.current?.click()}
                        disabled={isProcessing}
                        className="w-full h-16 text-base gap-3"
                    >
                        <Upload className="h-5 w-5" />
                        {hasFile ? `${file.name} — Click to change` : "Choose File"}
                    </Button>

                    {hasFile && (
                        <div className="text-sm text-muted-foreground">
                            {file.name}{" "}
                            <span className="text-xs">({(file.size / (1024 * 1024)).toFixed(1)} MB)</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* File Analysis / Validation */}
            {hasFile && validation && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            File Analysis
                        </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="flex items-center gap-3">
                            {isValid ? (
                                <Badge variant="default" className="bg-green-100 text-green-800">
                                    <CheckCircle className="h-3 w-3 mr-1" />
                                    Valid Paratext Project
                                </Badge>
                            ) : (
                                <Badge variant="destructive">
                                    <XCircle className="h-3 w-3 mr-1" />
                                    Invalid
                                </Badge>
                            )}
                        </div>

                        {validation.warnings?.length > 0 && (
                            <Alert>
                                <Info className="h-4 w-4" />
                                <AlertDescription>
                                    <div className="space-y-1">
                                        <div className="font-medium">Project Information:</div>
                                        {validation.warnings.map((warning: string, index: number) => (
                                            <div key={index} className="text-sm">• {warning}</div>
                                        ))}
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}

                        {validation.errors?.length > 0 && (
                            <Alert variant="destructive">
                                <XCircle className="h-4 w-4" />
                                <AlertDescription>
                                    <div className="space-y-1">
                                        <div className="font-medium">Validation Errors:</div>
                                        {validation.errors.map((err: string, index: number) => (
                                            <div key={index} className="text-sm">• {err}</div>
                                        ))}
                                    </div>
                                </AlertDescription>
                            </Alert>
                        )}
                    </CardContent>
                </Card>
            )}

            {/* Progress */}
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

            {/* Error */}
            {error && (
                <Alert variant="destructive">
                    <XCircle className="h-4 w-4" />
                    <AlertDescription>{error}</AlertDescription>
                </Alert>
            )}

            {/* Import Results */}
            {hasResult && (
                <>
                    <Alert>
                        <CheckCircle className="h-4 w-4 text-green-600" />
                        <AlertDescription>
                            <div className="space-y-2">
                                <div className="font-medium">Import Successful!</div>
                                <div className="grid grid-cols-2 gap-4 text-sm">
                                    <div className="flex items-center gap-2">
                                        <BookOpen className="h-4 w-4" />
                                        <span>{projectInfo.notebookPairCount || 1} books imported</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <FileText className="h-4 w-4" />
                                        <span>{projectInfo.totalCellsAllBooks || projectInfo.segmentCount} total segments</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <Database className="h-4 w-4" />
                                        <span>{projectInfo.verseCount} verses</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <MapPin className="h-4 w-4" />
                                        <span>{projectInfo.paratextCount} paratext segments</span>
                                    </div>
                                </div>
                                {projectInfo.notebookPairCount > 1 && (
                                    <div className="text-xs text-muted-foreground mt-2">
                                        Each book will be created as a separate notebook pair
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
                                            <div className="font-medium text-muted-foreground">Project Name</div>
                                            <div>{projectInfo.projectMetadata.projectName}</div>
                                        </div>
                                    )}
                                    {(projectInfo.projectMetadata.language || projectInfo.languageCode) && (
                                        <div>
                                            <div className="font-medium text-muted-foreground">Language</div>
                                            <div className="flex items-center gap-2">
                                                <Languages className="h-3 w-3" />
                                                {projectInfo.projectMetadata.language || "Unknown"}
                                                {projectInfo.languageCode && ` (${projectInfo.languageCode})`}
                                            </div>
                                        </div>
                                    )}
                                    {projectInfo.projectMetadata.projectType && (
                                        <div>
                                            <div className="font-medium text-muted-foreground">Project Type</div>
                                            <div className="capitalize">{projectInfo.projectMetadata.projectType}</div>
                                        </div>
                                    )}
                                    {projectInfo.projectMetadata.versification && (
                                        <div>
                                            <div className="font-medium text-muted-foreground">Versification</div>
                                            <div>{projectInfo.projectMetadata.versification}</div>
                                        </div>
                                    )}
                                    {projectInfo.projectAbbreviation && (
                                        <div>
                                            <div className="font-medium text-muted-foreground">Project Code</div>
                                            <div className="font-mono">{projectInfo.projectAbbreviation}</div>
                                        </div>
                                    )}
                                    {projectInfo.detectedYear && (
                                        <div>
                                            <div className="font-medium text-muted-foreground">Project Year</div>
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
                                </div>

                                {projectInfo.books?.length > 0 && (
                                    <div>
                                        <div className="font-medium text-muted-foreground mb-2">
                                            Books Included ({projectInfo.books.length})
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {projectInfo.books.slice(0, 20).map((book: string) => (
                                                <Badge key={book} variant="secondary" className="text-xs">
                                                    {book}
                                                </Badge>
                                            ))}
                                            {projectInfo.books.length > 20 && (
                                                <Badge variant="outline" className="text-xs">
                                                    +{projectInfo.books.length - 20} more
                                                </Badge>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </CardContent>
                        </Card>
                    )}
                </>
            )}

            {/* Finish Import / Complete Import Button */}
            {hasResult ? (
                <Button
                    onClick={handleComplete}
                    className="w-full h-12 text-base"
                >
                    Finish Import
                </Button>
            ) : (
                <Button
                    onClick={handleImport}
                    disabled={!isReady}
                    className="w-full h-12 text-base"
                    variant={isReady ? "default" : "secondary"}
                >
                    {isProcessing ? "Processing..." : "Finish Import"}
                </Button>
            )}
        </div>
    );
};
