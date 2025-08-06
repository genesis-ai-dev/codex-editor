import React, { useState, useCallback } from "react";
import { ImporterComponentProps, ImportedContent, AlignedCell } from "../../types/plugin";
import { NotebookPair } from "../../types/common";
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
import {
    Upload,
    Table,
    CheckCircle,
    XCircle,
    ArrowLeft,
    FileSpreadsheet,
    Hash,
    Type,
    Languages,
} from "lucide-react";
import { parseSpreadsheetFile, validateSpreadsheetFile } from "./parser";
import { ParsedSpreadsheet, ColumnType, ColumnTypeSelection } from "./types";
import { AlignmentPreview } from "../../components/AlignmentPreview";

export const SpreadsheetImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onComplete, onCancel, wizardContext, onTranslationComplete, alignContent } = props;

    // Check if this is a translation import
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [parsedData, setParsedData] = useState<ParsedSpreadsheet | null>(null);
    const [columnMapping, setColumnMapping] = useState<ColumnTypeSelection>({});
    const [error, setError] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);

    // Translation import specific state
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [isAligning, setIsAligning] = useState(false);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setIsDirty(true);
            setError(null);
            setParsedData(null);
            setColumnMapping({});
            setShowPreview(false);
            setAlignedCells(null);
        }
    }, []);

    const handleParseFile = async () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        setError(null);

        try {
            // Validate file
            const validation = validateSpreadsheetFile(selectedFile);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(", "));
            }

            // Parse file
            const data = await parseSpreadsheetFile(selectedFile);
            setParsedData(data);

            // Auto-detect column purposes based on names
            const autoMapping: ColumnTypeSelection = {};
            data.columns.forEach((col) => {
                const name = col.name.toLowerCase();
                if (name.includes("id") || name.includes("key") || name.includes("reference")) {
                    autoMapping[col.index] = "id";
                } else if (
                    name.includes("source") ||
                    name.includes("original") ||
                    name.includes("text")
                ) {
                    autoMapping[col.index] = "source";
                } else if (
                    name.includes("target") ||
                    name.includes("translation") ||
                    name.includes("translated")
                ) {
                    autoMapping[col.index] = "target";
                } else {
                    autoMapping[col.index] = "unused";
                }
            });
            setColumnMapping(autoMapping);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to parse file");
        } finally {
            setIsProcessing(false);
        }
    };

    const updateColumnMapping = (columnIndex: number, type: ColumnType) => {
        setColumnMapping((prev) => ({
            ...prev,
            [columnIndex]: type,
        }));
    };

    const getColumnTypeCount = (type: ColumnType): number => {
        return Object.values(columnMapping).filter((t) => t === type).length;
    };

    const createCellId = (docName: string, rowIndex: number): string => {
        const cleanDocName = docName.replace(/\s+/g, "");
        return `${cleanDocName} 1:${rowIndex + 1}`;
    };

    const handleImport = async () => {
        if (!parsedData) return;

        const sourceColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "source"
        );
        const idColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "id"
        );
        const targetColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "target"
        );

        if (!sourceColumnIndex && !targetColumnIndex) {
            setError("Please select at least one content column (source or target)");
            return;
        }

        if (isTranslationImport && !targetColumnIndex) {
            setError("Please select a target column for translation import");
            return;
        }

        if (!isTranslationImport && !sourceColumnIndex) {
            setError("Please select a source column for new content import");
            return;
        }

        try {
            if (isTranslationImport) {
                // Translation import - create ImportedContent from target column
                const importedContent: ImportedContent[] = parsedData.rows
                    .filter((row) => row[parseInt(targetColumnIndex!)]?.trim())
                    .map((row, index) => {
                        const id = idColumnIndex
                            ? row[parseInt(idColumnIndex)]?.trim() ||
                              createCellId(parsedData.filename, index)
                            : createCellId(parsedData.filename, index);

                        return {
                            id,
                            content: row[parseInt(targetColumnIndex!)],
                            rowIndex: index,
                        };
                    });

                setIsAligning(true);
                const aligned = await alignContent!(importedContent, selectedSource!.path);
                setAlignedCells(aligned);
                setShowPreview(true);
            } else {
                // Source import - create notebook pair
                const sourceCells = parsedData.rows
                    .filter((row) => row[parseInt(sourceColumnIndex!)]?.trim())
                    .map((row, index) => {
                        const id = idColumnIndex
                            ? row[parseInt(idColumnIndex)]?.trim() ||
                              createCellId(parsedData.filename, index)
                            : createCellId(parsedData.filename, index);

                        return {
                            id,
                            content: row[parseInt(sourceColumnIndex!)],
                            images: [],
                            metadata: {
                                id,
                                data: {
                                    rowIndex: index,
                                    originalRow: row,
                                },
                            },
                        };
                    });

                const notebookPair: NotebookPair = {
                    source: {
                        name: parsedData.filename,
                        cells: sourceCells,
                        metadata: {
                            id: parsedData.filename,
                            originalFileName: selectedFile!.name,
                            importerType: "spreadsheet",
                            createdAt: new Date().toISOString(),
                            delimiter: parsedData.delimiter,
                            columnCount: parsedData.columns.length,
                            rowCount: parsedData.rows.length,
                        },
                    },
                    codex: {
                        name: parsedData.filename,
                        cells: sourceCells.map((cell) => ({
                            ...cell,
                            content: "", // Empty target cells
                        })),
                        metadata: {
                            id: parsedData.filename,
                            originalFileName: selectedFile!.name,
                            importerType: "spreadsheet",
                            createdAt: new Date().toISOString(),
                        },
                    },
                };

                onComplete!(notebookPair);
                setIsDirty(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
        } finally {
            setIsAligning(false);
        }
    };

    const handleTranslationComplete = () => {
        if (alignedCells && selectedSource) {
            onTranslationComplete!(alignedCells, selectedSource.path);
            setIsDirty(false);
        }
    };

    const handleCancel = () => {
        if (isDirty) {
            if (!confirm("Leave without saving? Your column mapping will be lost.")) {
                return;
            }
        }
        onCancel();
    };

    const renderColumnMappingCard = () => {
        if (!parsedData) return null;

        return (
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Table className="h-5 w-5" />
                        Choose Your Columns
                    </CardTitle>
                    <CardDescription>
                        {isTranslationImport
                            ? `Tell us which column contains the translations for "${selectedSource?.name}"`
                            : "Tell us which columns contain your content"}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Column mapping interface */}
                    <div className="grid gap-4">
                        {parsedData.columns.map((column) => (
                            <div
                                key={column.index}
                                className="flex items-center justify-between p-4 border rounded-lg"
                            >
                                <div className="flex-1">
                                    <div className="font-medium">{column.name}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {column.sampleValues.length > 0
                                            ? `Examples: ${column.sampleValues.join(", ")}`
                                            : "No data preview"}
                                    </div>
                                </div>
                                <Select
                                    value={columnMapping[column.index] || "unused"}
                                    onValueChange={(value: ColumnType) =>
                                        updateColumnMapping(column.index, value)
                                    }
                                >
                                    <SelectTrigger className="w-40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="unused">Not used</SelectItem>
                                        <SelectItem
                                            value="id"
                                            disabled={
                                                getColumnTypeCount("id") > 0 &&
                                                columnMapping[column.index] !== "id"
                                            }
                                        >
                                            <div className="flex items-center gap-2">
                                                <Hash className="h-4 w-4" />
                                                ID Column
                                            </div>
                                        </SelectItem>
                                        {!isTranslationImport && (
                                            <SelectItem
                                                value="source"
                                                disabled={
                                                    getColumnTypeCount("source") > 0 &&
                                                    columnMapping[column.index] !== "source"
                                                }
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Type className="h-4 w-4" />
                                                    Source Content
                                                </div>
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
                                                <div className="flex items-center gap-2">
                                                    <Languages className="h-4 w-4" />
                                                    Translation
                                                </div>
                                            </SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>

                    {/* Summary */}
                    <div className="flex gap-2 pt-4 border-t">
                        {getColumnTypeCount("id") > 0 && (
                            <Badge variant="secondary">
                                <Hash className="h-3 w-3 mr-1" />
                                ID Column
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
                    </div>

                    {error && (
                        <Alert>
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="flex gap-2 pt-4">
                        <Button onClick={handleCancel} variant="outline">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                        <Button
                            onClick={handleImport}
                            disabled={
                                isAligning ||
                                (!getColumnTypeCount("source") && !getColumnTypeCount("target"))
                            }
                            className="flex-1"
                        >
                            {isAligning ? (
                                <>Processing...</>
                            ) : isTranslationImport ? (
                                "Import Translation"
                            ) : (
                                "Import Content"
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderFileUpload = () => (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    {isTranslationImport
                        ? `Import Translation for "${selectedSource?.name}"`
                        : "Import Spreadsheet Data"}
                </CardTitle>
                <CardDescription>
                    {isTranslationImport
                        ? "Choose a CSV or TSV file containing translations that match your source content"
                        : "Choose a CSV or TSV file to import as source content and create a translation workspace"}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                    <input
                        type="file"
                        accept=".csv,.tsv"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-input"
                        disabled={isProcessing}
                    />
                    <label
                        htmlFor="file-input"
                        className="cursor-pointer inline-flex flex-col items-center gap-4"
                    >
                        <Upload className="h-12 w-12 text-muted-foreground" />
                        <div className="space-y-2">
                            <div className="text-lg font-medium">Choose your spreadsheet file</div>
                            <div className="text-sm text-muted-foreground">
                                Click to select a CSV or TSV file up to 50MB
                            </div>
                        </div>
                    </label>
                </div>

                {selectedFile && (
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <FileSpreadsheet className="h-8 w-8 text-blue-500" />
                            <div>
                                <div className="font-medium">{selectedFile.name}</div>
                                <div className="text-sm text-gray-500">
                                    {(selectedFile.size / 1024).toFixed(1)}KB
                                </div>
                            </div>
                        </div>
                        <Button onClick={handleParseFile} disabled={isProcessing}>
                            {isProcessing ? "Analyzing..." : "Analyze File"}
                        </Button>
                    </div>
                )}

                {error && (
                    <Alert>
                        <XCircle className="h-4 w-4" />
                        <AlertDescription>{error}</AlertDescription>
                    </Alert>
                )}

                <div className="flex gap-2">
                    <Button onClick={handleCancel} variant="outline">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                    </Button>
                </div>
            </CardContent>
        </Card>
    );

    // Show alignment preview for translation imports
    if (showPreview && alignedCells && isTranslationImport) {
        return (
            <div className="container mx-auto p-6">
                <AlignmentPreview
                    alignedCells={alignedCells}
                    importedContent={[]}
                    targetCells={[]}
                    sourceCells={[]}
                    selectedSourceName={selectedSource?.name}
                    onConfirm={handleTranslationComplete}
                    onCancel={() => setShowPreview(false)}
                />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6">
            {parsedData ? renderColumnMappingCard() : renderFileUpload()}
        </div>
    );
};
