import React, { useState, useCallback, useRef } from "react";
import { FileText, Upload, Table, CheckCircle, XCircle, Eye, BarChart3, Type, Languages, Link as LinkIcon } from "lucide-react";
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
import { Badge } from "../../../components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";
import type { ImporterComponentProps, WriteNotebooksWithAttachmentsMessage } from "../../types/plugin";
import type { NotebookPair, ImportProgress } from "../../types/common";
import {
    parseSpreadsheetFile,
    validateSpreadsheetFile,
} from "./parser";
import { handleImportCompletion } from "../common/translationHelper";
import { notifyImportStarted, notifyImportEnded } from "../../utils/importProgress";
import {
    buildSpreadsheetImportResult,
    inferColumnMapping,
    spreadsheetCellAligner,
} from "./spreadsheetImportCore";
import type { ColumnType, ColumnTypeSelection, ParsedSpreadsheet } from "./types";

export const SpreadsheetImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { wizardContext, onTranslationComplete, alignContent } = props;

    const isTranslationImport =
        wizardContext?.intent === "target" &&
        !!wizardContext?.selectedSource &&
        !!onTranslationComplete &&
        !!alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [previewContent, setPreviewContent] = useState("");
    const [parsedData, setParsedData] = useState<ParsedSpreadsheet | null>(null);
    const [columnMapping, setColumnMapping] = useState<ColumnTypeSelection>({});
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState<ImportProgress[]>([]);
    const [error, setError] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const sourceImportExtraRef = useRef<{
        attachmentMessage: WriteNotebooksWithAttachmentsMessage;
        notebookPairWithMilestones: NotebookPair;
    } | null>(null);

    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        setSelectedFile(file);
        setError(null);
        setProgress([]);
        setParsedData(null);
        setColumnMapping({});

        try {
            const text = await file.text();
            setPreviewContent(text.substring(0, 500));
        } catch {
            setPreviewContent("");
        }

        try {
            const validation = validateSpreadsheetFile(file);
            if (!validation.isValid) {
                setError(validation.errors.join(", "));
                return;
            }
            const data = await parseSpreadsheetFile(file);
            setParsedData(data);
            setColumnMapping(inferColumnMapping(data.columns));
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to parse file");
        }
    }, []);

    const updateColumnMapping = useCallback((columnIndex: number, type: ColumnType) => {
        setColumnMapping((prev) => ({ ...prev, [columnIndex]: type }));
    }, []);

    const getColumnTypeCount = useCallback(
        (type: ColumnType): number =>
            Object.values(columnMapping).filter((t) => t === type).length,
        [columnMapping]
    );

    const handleImport = useCallback(async () => {
        if (!parsedData || !selectedFile) return;

        const hasSource = getColumnTypeCount("source") > 0;
        const hasTarget = getColumnTypeCount("target") > 0;

        if (!hasSource && !hasTarget) {
            setError("Please select at least one content column (source or target)");
            return;
        }
        if (isTranslationImport && !hasTarget) {
            setError("Please select a target column for translation import");
            return;
        }
        if (!isTranslationImport && !hasSource) {
            setError("Please select a source column for new content import");
            return;
        }

        notifyImportStarted();
        setIsProcessing(true);
        setError(null);
        setProgress([]);
        sourceImportExtraRef.current = null;

        try {
            const onProgress = (p: ImportProgress) => {
                setProgress((prev) => [
                    ...prev.filter((item) => item.stage !== p.stage),
                    p,
                ]);
            };

            onProgress({ stage: "Validate", message: "Validating file...", progress: 10 });

            const built = await buildSpreadsheetImportResult(
                selectedFile,
                parsedData,
                { isTranslationImport, columnMapping },
                onProgress
            );

            if (isTranslationImport && alignContent && selectedSource) {
                onProgress({ stage: "Alignment", message: "Aligning content...", progress: 80 });
                const { notebookToImportedContent } = await import("../common/translationHelper");
                const content = notebookToImportedContent(built.notebookPairWithMilestones);
                const aligned = await alignContent(content, selectedSource.path, spreadsheetCellAligner);
                onTranslationComplete!(aligned, selectedSource.path);
            } else if (built.attachmentMessage) {
                const vscodeApi = (window as { vscodeApi?: { postMessage: (msg: unknown) => void } }).vscodeApi;
                vscodeApi?.postMessage(built.attachmentMessage);
                props.onComplete?.(built.notebookPairWithMilestones);
                notifyImportEnded();
            } else {
                await handleImportCompletion(built.notebookPairWithMilestones, props);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
            notifyImportEnded();
        } finally {
            setIsProcessing(false);
        }
    }, [
        parsedData,
        selectedFile,
        columnMapping,
        isTranslationImport,
        alignContent,
        selectedSource,
        onTranslationComplete,
        props,
        getColumnTypeCount,
    ]);

    const totalProgress =
        progress.length > 0
            ? Math.round(progress.reduce((sum, p) => sum + (p.progress || 0), 0) / progress.length)
            : 0;

    const hasFile = !!selectedFile;
    const hasParsed = !!parsedData;
    const hasRequiredColumn = isTranslationImport
        ? getColumnTypeCount("target") > 0
        : getColumnTypeCount("source") > 0;
    const isReady = hasFile && hasParsed && hasRequiredColumn && !isProcessing;

    return (
        <div className="container mx-auto p-6 max-w-4xl space-y-6">
            {/* Header */}
            <div className="flex items-center justify-between mb-2">
                <h1 className="text-2xl font-bold flex items-center gap-2">
                    <FileText className="h-6 w-6" />
                    Import Spreadsheet {isTranslationImport && "(Translation)"}
                </h1>
            </div>

            {isTranslationImport && selectedSource && (
                <Alert>
                    <FileText className="h-4 w-4" />
                    <AlertDescription>
                        Importing translation for: <strong>{selectedSource.name}</strong>
                    </AlertDescription>
                </Alert>
            )}

            {/* Upload Section */}
            <Card>
                <CardHeader>
                    <CardTitle>Select File</CardTitle>
                    <CardDescription>
                        Upload a CSV or TSV file. The first row should be headers.
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                        <Badge variant="outline">.csv</Badge>
                        <Badge variant="outline">.tsv</Badge>
                    </div>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".csv,.tsv"
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
                        {hasFile ? `${selectedFile.name} — Click to change` : "Choose File"}
                    </Button>

                    {hasFile && (
                        <div className="text-sm text-muted-foreground">
                            {selectedFile.name}{" "}
                            <span className="text-xs">({(selectedFile.size / 1024).toFixed(1)} KB)</span>
                        </div>
                    )}
                </CardContent>
            </Card>

            {/* File Analysis */}
            {hasParsed && (
                <Card>
                    <CardHeader>
                        <CardTitle className="text-sm flex items-center gap-2">
                            <BarChart3 className="h-4 w-4" />
                            File Analysis
                        </CardTitle>
                    </CardHeader>
                    <CardContent>
                        <div className="grid grid-cols-3 gap-4 text-sm">
                            <div>
                                <p className="font-medium text-muted-foreground">Data Rows</p>
                                <p className="text-lg">{parsedData.rows.length}</p>
                            </div>
                            <div>
                                <p className="font-medium text-muted-foreground">Columns</p>
                                <p className="text-lg">{parsedData.columns.length}</p>
                            </div>
                            <div>
                                <p className="font-medium text-muted-foreground">Delimiter</p>
                                <p className="text-lg">{parsedData.delimiter === "\t" ? "Tab" : "Comma"}</p>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* File Preview */}
            {hasFile && previewContent && (
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

            {/* Column Mapping */}
            {hasParsed && (
                <Card>
                    <CardHeader>
                        <CardTitle className="flex items-center gap-2">
                            <Table className="h-5 w-5" />
                            Choose Your Columns
                        </CardTitle>
                        <CardDescription>
                            {isTranslationImport
                                ? `Tell us which column contains the translations for "${selectedSource?.name}"`
                                : "Assign each column a role. Only one Source, Target, and Attachments column is allowed."}
                        </CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-4">
                        <div className="grid gap-3">
                            {parsedData.columns.map((column) => (
                                <div
                                    key={column.index}
                                    className="flex items-center justify-between p-4 border rounded-lg"
                                >
                                    <div className="flex-1 min-w-0">
                                        <div className="font-medium">{column.name}</div>
                                        {column.sampleValues.length > 0 && (
                                            <div className="text-sm text-muted-foreground truncate">
                                                Examples: {column.sampleValues.join(", ")}
                                            </div>
                                        )}
                                    </div>
                                    <Select
                                        value={columnMapping[column.index] || "unused"}
                                        onValueChange={(value: string) =>
                                            updateColumnMapping(column.index, value as ColumnType)
                                        }
                                    >
                                        <SelectTrigger className="w-44 ml-4">
                                            <SelectValue />
                                        </SelectTrigger>
                                        <SelectContent>
                                            <SelectItem value="unused">Not used</SelectItem>
                                            <SelectItem value="globalReferences">
                                                <span className="flex items-center gap-2">
                                                    <LinkIcon className="h-4 w-4" />
                                                    Verse References
                                                </span>
                                            </SelectItem>
                                            {!isTranslationImport && (
                                                <SelectItem
                                                    value="source"
                                                    disabled={
                                                        getColumnTypeCount("source") > 0 &&
                                                        columnMapping[column.index] !== "source"
                                                    }
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <Type className="h-4 w-4" />
                                                        Source Content
                                                    </span>
                                                </SelectItem>
                                            )}
                                            {isTranslationImport && (
                                                <SelectItem
                                                    value="target"
                                                    disabled={
                                                        getColumnTypeCount("target") > 0 &&
                                                        columnMapping[column.index] !== "target"
                                                    }
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <Languages className="h-4 w-4" />
                                                        Translation
                                                    </span>
                                                </SelectItem>
                                            )}
                                            {!isTranslationImport && (
                                                <SelectItem
                                                    value="attachments"
                                                    disabled={
                                                        getColumnTypeCount("attachments") > 0 &&
                                                        columnMapping[column.index] !== "attachments"
                                                    }
                                                >
                                                    <span className="flex items-center gap-2">
                                                        <LinkIcon className="h-4 w-4" />
                                                        Attachments (audio URLs)
                                                    </span>
                                                </SelectItem>
                                            )}
                                        </SelectContent>
                                    </Select>
                                </div>
                            ))}
                        </div>

                        {/* Summary badges */}
                        <div className="flex gap-2 pt-4 border-t">
                            {getColumnTypeCount("globalReferences") > 0 && (
                                <Badge variant="secondary">
                                    <LinkIcon className="h-3 w-3 mr-1" />
                                    Verse References
                                </Badge>
                            )}
                            {getColumnTypeCount("source") > 0 && (
                                <Badge variant="secondary">
                                    <Type className="h-3 w-3 mr-1" />
                                    Source Content
                                </Badge>
                            )}
                            {getColumnTypeCount("target") > 0 && (
                                <Badge variant="secondary">
                                    <Languages className="h-3 w-3 mr-1" />
                                    Translation
                                </Badge>
                            )}
                            {getColumnTypeCount("attachments") > 0 && (
                                <Badge variant="secondary">
                                    <LinkIcon className="h-3 w-3 mr-1" />
                                    Attachments
                                </Badge>
                            )}
                        </div>
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

            {/* Finish Import Button */}
            <Button
                onClick={handleImport}
                disabled={!isReady}
                className="w-full h-12 text-base"
                variant={isReady ? "default" : "secondary"}
            >
                {isProcessing ? "Processing..." : "Finish Import"}
            </Button>
        </div>
    );
};
