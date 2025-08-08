import React, { useCallback, useEffect, useState } from "react";

import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import {
    BiblePreview as IBiblePreview,
    PreviewContent,
    SourceUploadPostMessages,
    SourceUploadResponseMessages,
    NotebookPreview,
    CustomCellMetaData,
    CodexNotebookAsJSONData,
    FileType,
    TranslationPairsPreview,
} from "../../../../types";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { SourcePreview } from "./components/SourcePreview";
import { ProcessingStages } from "./components/ProcessingStages";
import { ProgressDisplay } from "./components/ProgressDisplay";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import {
    WorkflowState,
    WorkflowStep,
    ImportType,
    ProcessingStatus,
    BibleDownloadState,
} from "./types";
import { ImportTypeSelector } from "./components/ImportTypeSelector";
import { TranslationPreview } from "./components/TranslationPreview";
import { BibleDownloadForm } from "./components/BibleDownloadForm";
import { ExtendedMetadata } from "../../../../src/utils/ebible/ebibleCorpusUtils";
import { BiblePreview } from "./components/BiblePreview";
import { FileDropzone } from "./components/FileDropzone";
import { MultiPreviewContainer } from "./components/MultiPreviewContainer";
import { TranslationPairsForm } from "./components/TranslationPairsForm";
import { usePapaParse } from "react-papaparse";
import { ParseResult } from "papaparse";
import {
    TranslationPreview as ITranslationPreview,
    SourcePreview as ISourcePreview,
} from "../../../../types";

const DEBUG = false;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[SourceUploader]", ...args);
    }
};

const generateCellId = (fileName: string, chapterIndex: number, cellIndex: number) => {
    const fileId = fileName.replace(/\.[^/.]+$/, "");
    return `${fileId} ${chapterIndex}:${cellIndex}`;
};

const initialWorkflowState: WorkflowState = {
    step: "type-select",
    importType: null,
    selectedFiles: [],
    translationAssociations: [],
    fileObjects: [],
    previews: [],
    processingStages: {
        fileValidation: {
            label: "Validating File",
            description: "Checking file format and content",
            status: "pending",
        },
        transformation: {
            label: "Transforming Content",
            description: "Converting to notebook format",
            status: "pending",
        },
        sourceNotebook: {
            label: "Creating Source Notebook",
            description: "Processing source content",
            status: "pending",
        },
        targetNotebook: {
            label: "Preparing Translation Notebook",
            description: "Creating corresponding translation file",
            status: "pending",
        },
        metadataSetup: {
            label: "Finalizing Setup",
            description: "Setting up project metadata",
            status: "pending",
        },
    },
};

const getBibleProcessingStages = (status: ProcessingStatus = "pending") => ({
    validation: {
        label: "Validation",
        description: "Validating Bible content",
        status,
    },
    download: {
        label: "Download",
        description: "Downloading Bible text",
        status,
    },
    splitting: {
        label: "Splitting",
        description: "Splitting into sections",
        status,
    },
    notebooks: {
        label: "Notebooks",
        description: "Creating notebooks",
        status,
    },
    metadata: {
        label: "Metadata",
        description: "Updating metadata",
        status,
    },
    commit: {
        label: "Commit",
        description: "Committing changes",
        status,
    },
    indexing: {
        label: "Indexing",
        description: "Building search index",
        status,
    },
});

const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result?.toString() || "");
        reader.onerror = reject;
        reader.readAsText(file);
    });
};

export const SourceUploader: React.FC = () => {
    const [tempCodexFileContent, setTempCodexFileContent] =
        useState<CodexNotebookAsJSONData | null>(null);
    const { vscode, workflow, setWorkflow } = useVSCodeMessageHandler();
    const { readString } = usePapaParse();
    const handleClearFile = useCallback(() => {
        setWorkflow((prev) => ({
            ...prev,
            selectedFile: null,
            step: "select",
        }));
    }, [setWorkflow]);

    const handlePreviewConfirm = useCallback(
        (type: "source" | "translation") => {
            if (type === "source") {
                vscode.postMessage({
                    command: "confirmSourceImport",
                } as SourceUploadPostMessages);
            } else {
                vscode.postMessage({
                    command: "confirmTranslationImport",
                } as SourceUploadPostMessages);
            }
            setWorkflow((prev) => ({
                ...prev,
                step: "processing",
            }));
        },
        [setWorkflow, vscode]
    );

    const handlePreviewCancel = useCallback(() => {
        vscode.postMessage({
            command: "cancelSourceImport",
        } as SourceUploadPostMessages);
        handleClearFile();
    }, [handleClearFile, vscode]);

    const handleStepClick = useCallback(
        (step: WorkflowStep) => {
            if (workflow.step === "processing") return; // Prevent navigation during processing
            if (step === "complete" && workflow.step !== "complete") return; // Prevent skipping to complete

            switch (step) {
                case "type-select":
                    setWorkflow((_prev) => ({
                        ...initialWorkflowState,
                    }));
                    break;
                case "select":
                    setWorkflow((prev) => ({
                        ...prev,
                        step: "select",
                        selectedFile: null,
                    }));
                    break;
                case "preview":
                    if (workflow.preview) {
                        setWorkflow((prev) => ({
                            ...prev,
                            step: "preview",
                        }));
                    }
                    break;
            }
        },
        [workflow.preview, workflow.step, setWorkflow]
    );

    const handleUploadAnother = useCallback(() => {
        setWorkflow((_prev) => ({
            ...initialWorkflowState,
        }));
    }, [setWorkflow]);

    const handleImportTypeSelect = useCallback(
        (type: ImportType) => {
            if (type === "translation") {
                // Request available source files from extension
                vscode.postMessage({
                    command: "getAvailableCodexFiles",
                } as SourceUploadPostMessages);
            }

            setWorkflow((prev) => ({
                ...prev,
                importType: type,
                step: "select",
                error: undefined,
                // Initialize Bible download stages if needed
                processingStages:
                    type === "bible-download" ? getBibleProcessingStages() : prev.processingStages,
            }));
        },
        [setWorkflow, vscode]
    );

    const handleBibleDownload = useCallback(
        (metadata: ExtendedMetadata, asTranslationOnly: boolean) => {
            setWorkflow((prev) => ({
                ...prev,
                step: "preview-download",
                bibleDownload: {
                    language: metadata.languageCode,
                    status: "downloading",
                    translationId: metadata.translationId || "",
                },
                progress: {
                    message: "Downloading preview content...",
                    increment: 20,
                },
            }));

            vscode.postMessage({
                command: "downloadBible",
                ebibleMetadata: metadata,
                asTranslationOnly,
            } as SourceUploadPostMessages);
        },
        [setWorkflow, vscode]
    );

    const handleCancel = useCallback(() => {
        debug("handleCancel in webview", { workflow });
        setWorkflow((prev) => {
            // For Bible download, preserve the language selection
            if (prev.importType === "bible-download" && prev.bibleDownload?.language) {
                return {
                    ...prev,
                    step: "select",
                    error: undefined,
                    bibleDownload: {
                        ...prev.bibleDownload,
                        status: "idle",
                        translationId: "",
                    },
                    currentTransaction: undefined,
                    preview: undefined,
                };
            }
            // For other cases, reset to initial state
            return {
                ...prev,
                step: "type-select",
                importType: null,
                error: undefined,
                bibleDownload: undefined,
            };
        });
    }, [setWorkflow]);

    const handleFileDrop = useCallback(
        (files: File[]) => {
            setWorkflow((prev) => ({
                ...prev,
                selectedFiles: files.map((f) => f.name),
                fileObjects: files,
                // Reset associations when new files are dropped
                translationAssociations: [],
            }));
        },
        [setWorkflow]
    );

    const handleAssociationChange = useCallback(
        (associations: Array<{ file: File; codexId: string }>) => {
            setWorkflow((prev) => ({
                ...prev,
                translationAssociations: associations,
            }));
        },
        [setWorkflow]
    );

    const handleContinue = useCallback(async () => {
        if (!workflow.fileObjects.length) return;

        if (workflow.importType === "translation-pairs") {
            try {
                const filePromises = workflow.fileObjects.map(async (file) => ({
                    content: await readFileAsText(file),
                    name: file.name,
                }));

                const files = await Promise.all(filePromises);
                debug({ files });

                const content = files[0].content;
                const fileIsCSV = files[0].name.endsWith(".csv");
                const fileIsTSV = files[0].name.endsWith(".tsv");
                const fileIsTab = files[0].name.endsWith(".tab");

                if (fileIsCSV || fileIsTSV || fileIsTab) {
                    const delimiter = fileIsCSV ? "," : "\t";
                    const parseConfig = {
                        delimiter,
                        header: false,
                        skipEmptyLines: true,
                        transformHeader: (header: string) => header.trim(),
                        transform: (value: string) => value.trim(),
                        encoding: "utf8",
                        // Handle quoted fields properly
                        quoteChar: '"',
                        escapeChar: '"',
                        // Keep raw values to preserve complex content
                        keepRawData: true,
                        // Error handling
                        error: (error: Error) => {
                            setWorkflow((prev) => ({
                                ...prev,
                                error: `Error parsing file: ${error.message}`,
                            }));
                        },
                        complete: (results: ParseResult<string[]>) => {
                            debug("---> [handleContinue] readString complete. Results:", results);
                            try {
                                if (!results.data || results.data.length < 1) {
                                    throw new Error("No data rows found in file");
                                }

                                // First row should be headers
                                const headers = results.data[0];

                                // Update workflow with file content and headers for the mapping step
                                setWorkflow((prev) => ({
                                    ...prev,
                                    fileContent: content,
                                    fileHeaders: headers,
                                    step: "select", // Move to column mapping step with TranslationPairsForm
                                }));
                            } catch (error) {
                                console.error("Error parsing file:", error);
                                setWorkflow((prev) => ({
                                    ...prev,
                                    error:
                                        error instanceof Error
                                            ? error.message
                                            : "Failed to parse file",
                                }));
                            }
                        },
                    };

                    readString(content, parseConfig);
                } else {
                    setWorkflow((prev) => ({
                        ...prev,
                        fileContent: content,
                        step: "select",
                    }));
                }
            } catch (error) {
                console.error("Error preparing files:", error);
                setWorkflow((prev) => ({
                    ...prev,
                    error: error instanceof Error ? error.message : "Failed to read files",
                }));
            }
        } else {
            try {
                const filePromises = workflow.fileObjects.map(async (file) => ({
                    content: await readFileAsText(file),
                    name: file.name,
                }));

                const files = await Promise.all(filePromises);

                if (workflow.importType === "translation") {
                    // Handle translation files
                    const filesWithSourceIds = files.map((file) => {
                        const association = workflow.translationAssociations.find(
                            (a) => a.file.name === file.name
                        );
                        return {
                            ...file,
                            sourceId: association?.codexId || "",
                        };
                    });

                    vscode.postMessage({
                        command: "uploadTranslation",
                        files: filesWithSourceIds,
                    } as SourceUploadPostMessages);
                } else {
                    debug("uploading source files", { files });
                    // Handle source files
                    vscode.postMessage({
                        command: "uploadSourceText",
                        files,
                    } as SourceUploadPostMessages);
                }
            } catch (error) {
                console.error("Error preparing files:", error);
                setWorkflow((prev) => ({
                    ...prev,
                    error: error instanceof Error ? error.message : "Failed to read files",
                }));
            }
        }
    }, [workflow.fileObjects, workflow.importType, workflow.translationAssociations, vscode]);

    const handlePreviewReject = useCallback(
        (previewId: string) => {
            setWorkflow((prev) => ({
                ...prev,
                previews: prev.previews.map((p) =>
                    p.id === previewId ? { ...p, isValid: true, isRejected: true } : p
                ),
            }));
        },
        [setWorkflow]
    );

    const handleRemoveFile = useCallback(
        (fileToRemove: File) => {
            setWorkflow((prev) => ({
                ...prev,
                selectedFiles: prev.selectedFiles.filter((f) => f !== fileToRemove.name),
                fileObjects: prev.fileObjects.filter((f) => f !== fileToRemove),
                translationAssociations: prev.translationAssociations.filter(
                    (a) => a.file !== fileToRemove
                ),
            }));
        },
        [setWorkflow]
    );

    const renderPreview = () => {
        if (!workflow.preview) return null;

        // Type guard for IBiblePreview
        const isBiblePreview = (preview: any): preview is IBiblePreview => {
            return (
                Object.prototype.hasOwnProperty.call(preview, "original") &&
                Object.prototype.hasOwnProperty.call(preview, "transformed") &&
                Array.isArray(preview.transformed.sourceNotebooks)
            );
        };

        // Type guard for TranslationPreview
        const isTranslationPreview = (preview: any): preview is ITranslationPreview => {
            return preview.type === "translation";
        };

        // Type guard for SourcePreview
        const isSourcePreview = (preview: any): preview is ISourcePreview => {
            return preview.type === "source";
        };

        if (
            workflow.importType === "bible-download" &&
            "type" in workflow.preview &&
            workflow.preview.type === "bible"
        ) {
            return (
                <BiblePreview
                    preview={{
                        type: "bible",
                        fileName: workflow.preview.fileName,
                        fileSize: workflow.preview.fileSize,
                        fileType: workflow.preview.fileType,
                        original: workflow.preview.original,
                        transformed: {
                            sourceNotebooks: (
                                workflow.preview.transformed.sourceNotebooks as NotebookPreview[]
                            ).map((notebook) => ({
                                name: notebook.name,
                                cells: notebook.cells.map((cell) => ({
                                    value: cell.value,
                                    metadata: {
                                        id: cell.metadata?.id || "",
                                        type: cell.metadata?.type || "",
                                    },
                                })),
                                metadata: notebook.metadata,
                            })),
                            validationResults: workflow.preview.transformed.validationResults,
                        },
                    }}
                    onConfirm={() => {
                        debug("confirmBibleDownload in webview", {
                            transaction: workflow.currentTransaction,
                        });
                        vscode.postMessage({
                            command: "confirmBibleDownload",
                            transaction: workflow.currentTransaction,
                        } as SourceUploadPostMessages);
                        setWorkflow((prev) => ({
                            ...prev,
                            step: "processing",
                        }));
                    }}
                    onCancel={() => {
                        vscode.postMessage({
                            command: "cancelBibleDownload",
                            transaction: workflow.currentTransaction,
                        } as SourceUploadPostMessages);
                        setWorkflow((prev) => ({
                            ...prev,
                            step: "select",
                            importType: "bible-download",
                            error: undefined,
                            bibleDownload: prev.bibleDownload
                                ? {
                                      ...prev.bibleDownload,
                                      status: "idle",
                                      translationId: "",
                                  }
                                : undefined,
                            currentTransaction: undefined,
                            preview: undefined,
                        }));
                    }}
                />
            );
        }

        if (isTranslationPreview(workflow.preview)) {
            const preview = workflow.preview as ITranslationPreview;
            debug("isTranslationPreview", { preview });
            return (
                <TranslationPreview
                    preview={preview}
                    onConfirm={() => handlePreviewConfirm("translation")}
                    onCancel={handlePreviewCancel}
                />
            );
        }

        if (isSourcePreview(workflow.preview)) {
            const preview = workflow.preview;
            return (
                <SourcePreview
                    preview={preview}
                    onConfirm={() => handlePreviewConfirm("source")}
                    onCancel={handlePreviewCancel}
                />
            );
        }

        return null;
    };

    const renderWorkflowStep = () => {
        switch (workflow.step) {
            case "type-select":
                return (
                    <ImportTypeSelector onSelect={handleImportTypeSelect} onCancel={handleCancel} />
                );

            case "select":
                if (workflow.importType === "bible-download") {
                    return (
                        <BibleDownloadForm
                            onDownload={handleBibleDownload}
                            onCancel={handleCancel}
                            initialLanguage={workflow.bibleDownload?.language}
                        />
                    );
                }

                if (workflow.importType === "translation-pairs" && workflow.fileHeaders) {
                    debug("Rendering TranslationPairsForm", {
                        headers: workflow.fileHeaders,
                        fileContent: workflow.fileContent?.substring(0, 100) + "...", // Show first 100 chars
                    });
                    return (
                        <TranslationPairsForm
                            headers={workflow.fileHeaders}
                            onSubmit={async (mapping) => {
                                debug("TranslationPairsForm onSubmit", { mapping });

                                try {
                                    // Ensure all mapping properties are properly defined
                                    const safeMapping = {
                                        sourceColumn: mapping.sourceColumn || "",
                                        targetColumn: mapping.targetColumn || "",
                                        idColumn: mapping.idColumn || "",
                                        metadataColumns: Array.isArray(mapping.metadataColumns)
                                            ? mapping.metadataColumns
                                            : [],
                                        hasHeaders: Boolean(mapping.hasHeaders),
                                    };

                                    debug("Sanitized mapping", safeMapping);

                                    readString(workflow.fileContent || "", {
                                        header: safeMapping.hasHeaders,
                                        skipEmptyLines: true,
                                        error: (error: Error) => {
                                            console.error("Error parsing file:", error);
                                            setWorkflow((prev) => ({
                                                ...prev,
                                                error: `Error parsing file: ${error.message}`,
                                            }));
                                        },
                                        complete: (results: ParseResult<string[]>) => {
                                            try {
                                                debug(
                                                    "---> [onSubmit] readString complete. Results:",
                                                    results
                                                );

                                                if (
                                                    !results.data ||
                                                    !Array.isArray(results.data) ||
                                                    results.data.length <
                                                        (safeMapping.hasHeaders ? 2 : 1)
                                                ) {
                                                    throw new Error("No data rows found in file");
                                                }

                                                // Ensure we're working with arrays
                                                const headerRow = Array.isArray(results.data[0])
                                                    ? results.data[0]
                                                    : typeof results.data[0] === "object"
                                                    ? Object.keys(results.data[0])
                                                    : [];

                                                const dataRows = results.data.slice(
                                                    safeMapping.hasHeaders ? 1 : 0
                                                );

                                                debug("Processing data", {
                                                    headerRow,
                                                    totalRows: dataRows.length,
                                                });

                                                // Log the exact headers with their lengths to debug whitespace issues
                                                debug("Header details", {
                                                    headers: headerRow.map((h) => ({
                                                        text: h,
                                                        length: h.length,
                                                        withQuotes: JSON.stringify(h),
                                                    })),
                                                });

                                                // Check if the data is an array or object
                                                const dataRowsType = Array.isArray(dataRows[0])
                                                    ? "array"
                                                    : "object";

                                                // Make sure we have valid header values to work with
                                                const safeHeaders = Array.isArray(headerRow)
                                                    ? headerRow
                                                    : [];

                                                // Use the columns selected by the user in the mapping form
                                                const sourceColumn = safeMapping.sourceColumn;
                                                const targetColumn = safeMapping.targetColumn;
                                                const idColumn = safeMapping.idColumn;
                                                const metadataColumns = safeMapping.metadataColumns;

                                                // Find column indices safely
                                                const sourceIndex =
                                                    typeof sourceColumn === "string" && sourceColumn
                                                        ? safeHeaders.findIndex(
                                                              (h) => h === sourceColumn
                                                          )
                                                        : -1;

                                                // Add more debugging to understand the issue
                                                debug("Finding target column", {
                                                    targetColumn,
                                                    safeHeaders,
                                                    dataRowsType,
                                                    hasTargetKey:
                                                        dataRows[0] &&
                                                        typeof dataRows[0] === "object" &&
                                                        targetColumn in dataRows[0],
                                                });

                                                // Enhanced target index finding - handles both array and object structures
                                                let targetIndex = -1;
                                                if (
                                                    typeof targetColumn === "string" &&
                                                    targetColumn
                                                ) {
                                                    // First check by index in headers
                                                    targetIndex = safeHeaders.findIndex(
                                                        (h) => h === targetColumn
                                                    );

                                                    // If not found but data is in object format, check if the key exists directly
                                                    if (
                                                        targetIndex === -1 &&
                                                        dataRows.length > 0 &&
                                                        typeof dataRows[0] === "object" &&
                                                        !Array.isArray(dataRows[0]) &&
                                                        targetColumn in dataRows[0]
                                                    ) {
                                                        debug(
                                                            "Found target key directly in data object"
                                                        );
                                                        targetIndex = 1; // Set to a non-negative value to indicate it exists
                                                    }
                                                }

                                                const idIndex =
                                                    typeof idColumn === "string" && idColumn
                                                        ? safeHeaders.findIndex(
                                                              (h) => h === idColumn
                                                          )
                                                        : -1;

                                                debug("Column indices", {
                                                    sourceIndex,
                                                    targetIndex,
                                                    idIndex,
                                                });

                                                // Add this debug to see the first data row structure
                                                debug("First data row structure:", {
                                                    firstRow: dataRows[0],
                                                    isArray: Array.isArray(dataRows[0]),
                                                    keys: dataRows[0]
                                                        ? Object.keys(
                                                              dataRows[0] as Record<string, any>
                                                          )
                                                        : [],
                                                    sourceValue: dataRows[0]
                                                        ? Array.isArray(dataRows[0])
                                                            ? dataRows[0][sourceIndex as number]
                                                            : (dataRows[0] as Record<string, any>)[
                                                                  sourceColumn as string
                                                              ]
                                                        : null,
                                                });

                                                // Safely create metadata indices map with explicit types
                                                const metadataIndices: Record<string, number> = {};
                                                Object.entries(metadataColumns).forEach(
                                                    ([key, value]) => {
                                                        if (typeof value === "string" && value) {
                                                            metadataIndices[key as string] =
                                                                safeHeaders.findIndex(
                                                                    (h) => h === value
                                                                );
                                                        }
                                                    }
                                                );

                                                debug("Metadata indices", metadataIndices);

                                                // Type guard to check if we can access properties on row
                                                type RowData = Record<string | number, any>;

                                                if (
                                                    safeMapping.hasHeaders &&
                                                    sourceIndex === -1 &&
                                                    !(dataRows[0] as any)?.[sourceColumn]
                                                ) {
                                                    // Check only if headers were expected
                                                    throw new Error(
                                                        `Source column '${sourceColumn}' not found in headers.`
                                                    );
                                                }

                                                // Process each row to extract content and metadata
                                                const processRow = (
                                                    rowData: any,
                                                    rowIndex: number
                                                ) => {
                                                    try {
                                                        // Extract metadata based on configured columns
                                                        const metadata: Record<string, string> = {};
                                                        Object.entries(metadataIndices).forEach(
                                                            ([key, index]) => {
                                                                const metadataKey = key as string;
                                                                const metadataColumnName =
                                                                    metadataColumns[
                                                                        metadataKey as keyof typeof metadataColumns
                                                                    ];

                                                                const value = Array.isArray(rowData)
                                                                    ? rowData[index]
                                                                    : typeof rowData === "object" &&
                                                                      typeof metadataColumnName ===
                                                                          "string"
                                                                    ? rowData[metadataColumnName]
                                                                    : undefined;

                                                                if (value !== undefined) {
                                                                    metadata[metadataKey] =
                                                                        String(value);
                                                                }
                                                            }
                                                        );

                                                        // Calculate section ID for pagination
                                                        const sectionNumber =
                                                            Math.floor(rowIndex / 10) + 1;

                                                        // Get source content
                                                        const sourceContent = Array.isArray(rowData)
                                                            ? rowData[sourceIndex]
                                                            : typeof rowData === "object" &&
                                                              sourceColumn &&
                                                              typeof sourceColumn === "string"
                                                            ? (rowData as Record<string, any>)[
                                                                  sourceColumn
                                                              ]
                                                            : "";

                                                        // Generate cell ID
                                                        const cellId =
                                                            idIndex !== -1 &&
                                                            Array.isArray(rowData) &&
                                                            rowData[idIndex] != null
                                                                ? String(rowData[idIndex])
                                                                : idColumn &&
                                                                  typeof rowData === "object" &&
                                                                  (rowData as Record<string, any>)[
                                                                      idColumn
                                                                  ] != null
                                                                ? String(
                                                                      (
                                                                          rowData as Record<
                                                                              string,
                                                                              any
                                                                          >
                                                                      )[idColumn]
                                                                  )
                                                                : generateCellId(
                                                                      workflow.fileObjects?.[0]
                                                                          ?.name || "unknown",
                                                                      sectionNumber,
                                                                      (rowIndex % 10) + 1
                                                                  );

                                                        return {
                                                            value:
                                                                sourceContent !== null &&
                                                                sourceContent !== undefined
                                                                    ? String(sourceContent)
                                                                    : "",
                                                            metadata: {
                                                                id: cellId,
                                                                type: "text",
                                                                otherFields: metadata,
                                                            },
                                                        };
                                                    } catch (error) {
                                                        console.error(
                                                            "Error processing row:",
                                                            error
                                                        );
                                                        return {
                                                            value: "",
                                                            metadata: {
                                                                id: generateCellId(
                                                                    workflow.fileObjects?.[0]
                                                                        ?.name || "unknown",
                                                                    0,
                                                                    rowIndex
                                                                ),
                                                                type: "text",
                                                                otherFields: {},
                                                            },
                                                        };
                                                    }
                                                };

                                                // Process all rows
                                                const sourceCells = Array.isArray(dataRows)
                                                    ? dataRows.map(processRow)
                                                    : [];

                                                debug("---> Generated sourceCells:", sourceCells);

                                                // Generate target cells with strict type safety
                                                const generatedTargetCells = Array.isArray(
                                                    sourceCells
                                                )
                                                    ? sourceCells.map((sourceCell) => {
                                                          if (!sourceCell)
                                                              return {
                                                                  value: "",
                                                                  metadata: {
                                                                      id: generateCellId(
                                                                          "unknown",
                                                                          1,
                                                                          1
                                                                      ),
                                                                      type: "target",
                                                                      otherFields: {},
                                                                  },
                                                              };

                                                          // Find the original row corresponding to this source cell
                                                          let originalRow: any = null;

                                                          // If we have an ID index and can locate the row by ID
                                                          if (
                                                              idIndex !== -1 &&
                                                              Array.isArray(dataRows)
                                                          ) {
                                                              originalRow = dataRows.find((row) => {
                                                                  if (!row) return false;

                                                                  const rowId = row[idIndex];
                                                                  const cellId =
                                                                      sourceCell?.metadata?.id;

                                                                  return (
                                                                      rowId != null &&
                                                                      cellId != null &&
                                                                      String(rowId) ===
                                                                          String(cellId)
                                                                  );
                                                              });
                                                          }

                                                          // Fall back to using the source cell's position in the array if we couldn't find by ID
                                                          if (
                                                              !originalRow &&
                                                              Array.isArray(dataRows) &&
                                                              Array.isArray(sourceCells)
                                                          ) {
                                                              // Find the index of this source cell in the sourceCells array
                                                              const cellIndex =
                                                                  sourceCells.findIndex(
                                                                      (cell) => cell === sourceCell
                                                                  );

                                                              // If found and in range of dataRows, use the corresponding row
                                                              if (
                                                                  cellIndex !== -1 &&
                                                                  cellIndex < dataRows.length
                                                              ) {
                                                                  originalRow = dataRows[cellIndex];
                                                                  debug(
                                                                      `Using position-based row matching for index ${cellIndex}`
                                                                  );
                                                              }
                                                          }

                                                          // Extract the target value, ensuring we handle array vs object data structures
                                                          let targetValue: string | null = null;

                                                          // Get detailed info about the target column
                                                          const targetColumnInOriginalRow =
                                                              Object.keys(originalRow).some(
                                                                  (key) => key === targetColumn
                                                              );

                                                          debug(
                                                              "Target column extraction details:",
                                                              {
                                                                  targetColumn,
                                                                  originalRowKeys:
                                                                      Object.keys(originalRow),
                                                                  targetColumnInOriginalRow,
                                                              }
                                                          );

                                                          if (Array.isArray(originalRow)) {
                                                              const targetIndex =
                                                                  safeHeaders.indexOf(targetColumn);
                                                              if (
                                                                  targetIndex !== -1 &&
                                                                  originalRow[targetIndex] !==
                                                                      undefined
                                                              ) {
                                                                  targetValue = String(
                                                                      originalRow[targetIndex]
                                                                  );
                                                              }
                                                          } else {
                                                              // First try direct key lookup
                                                              if (
                                                                  originalRow[targetColumn] !==
                                                                  undefined
                                                              ) {
                                                                  targetValue = String(
                                                                      originalRow[targetColumn]
                                                                  );
                                                              } else {
                                                                  // Enhanced whitespace handling - try more extensive matching approaches
                                                                  const trimmedTargetColumn =
                                                                      targetColumn.trim();

                                                                  // Method 1: Find key that matches when trimmed
                                                                  let matchingKey = Object.keys(
                                                                      originalRow
                                                                  ).find(
                                                                      (key) =>
                                                                          key.trim() ===
                                                                          trimmedTargetColumn
                                                                  );

                                                                  // Method 2: Find key that contains the target or vice versa
                                                                  if (!matchingKey) {
                                                                      matchingKey = Object.keys(
                                                                          originalRow
                                                                      ).find(
                                                                          (key) =>
                                                                              key
                                                                                  .trim()
                                                                                  .includes(
                                                                                      trimmedTargetColumn
                                                                                  ) ||
                                                                              trimmedTargetColumn.includes(
                                                                                  key.trim()
                                                                              )
                                                                      );
                                                                  }

                                                                  // Method 3: Try case-insensitive matching
                                                                  if (!matchingKey) {
                                                                      const lowerTargetColumn =
                                                                          trimmedTargetColumn.toLowerCase();
                                                                      matchingKey = Object.keys(
                                                                          originalRow
                                                                      ).find(
                                                                          (key) =>
                                                                              key
                                                                                  .trim()
                                                                                  .toLowerCase() ===
                                                                              lowerTargetColumn
                                                                      );
                                                                  }

                                                                  if (matchingKey) {
                                                                      targetValue = String(
                                                                          originalRow[matchingKey]
                                                                      );
                                                                      debug(
                                                                          "Found target column with advanced matching:",
                                                                          {
                                                                              requestedColumn:
                                                                                  targetColumn,
                                                                              matchingColumn:
                                                                                  matchingKey,
                                                                              value: targetValue,
                                                                          }
                                                                      );
                                                                  }
                                                              }
                                                          }

                                                          // Log if we couldn't extract target value
                                                          if (targetValue === null) {
                                                              debug(
                                                                  "Could not extract target value using standard methods",
                                                                  {
                                                                      row: originalRow,
                                                                      targetColumn,
                                                                  }
                                                              );
                                                              // Ensure targetValue is always a string
                                                              targetValue = "";
                                                          }

                                                          // Create metadata fields safely
                                                          const otherFields: Record<
                                                              string,
                                                              string
                                                          > = {};

                                                          // Only process if metadataIndices is a valid object
                                                          if (
                                                              metadataIndices &&
                                                              typeof metadataIndices === "object" &&
                                                              originalRow
                                                          ) {
                                                              Object.entries(
                                                                  metadataIndices
                                                              ).forEach(([colName, index]) => {
                                                                  if (
                                                                      colName &&
                                                                      index != null &&
                                                                      originalRow[index] != null
                                                                  ) {
                                                                      otherFields[colName] = String(
                                                                          originalRow[index] || ""
                                                                      );
                                                                  }
                                                              });
                                                          }

                                                          return {
                                                              value: targetValue,
                                                              metadata: {
                                                                  id:
                                                                      sourceCell.metadata?.id ||
                                                                      generateCellId(
                                                                          "unknown",
                                                                          1,
                                                                          1
                                                                      ),
                                                                  type: "target",
                                                                  otherFields,
                                                              },
                                                          };
                                                      })
                                                    : [];

                                                // Create preview object with proper safety checks
                                                const preview: PreviewContent = {
                                                    type: "translation-pairs",
                                                    fileName:
                                                        workflow.fileObjects?.[0]?.name ||
                                                        "unknown",
                                                    fileSize: workflow.fileObjects?.[0]?.size || 0,
                                                    fileType: (workflow.fileObjects?.[0]?.type ||
                                                        "text/plain") as FileType,
                                                    original: {
                                                        preview:
                                                            `Processing ${
                                                                dataRows.length
                                                            } rows from ${
                                                                workflow.fileObjects?.[0]?.name ||
                                                                "unknown"
                                                            }.\n` +
                                                            `Source Column: ${sourceColumn} (Index ${sourceIndex})\n` +
                                                            (targetColumn
                                                                ? `Target Column: ${targetColumn} (Index ${targetIndex})\n`
                                                                : "Target Column: None\n") +
                                                            (idColumn
                                                                ? `ID Column: ${idColumn} (Index ${idIndex})\n`
                                                                : "ID Column: Generated\n") +
                                                            `Metadata Columns: ${Object.entries(
                                                                metadataIndices || {}
                                                            )
                                                                .map(
                                                                    ([name, idx]) =>
                                                                        `${name} (Index ${idx})`
                                                                )
                                                                .join(", ")}`,
                                                        validationResults: [],
                                                    },
                                                    preview: {
                                                        original: {
                                                            preview:
                                                                `Processing ${
                                                                    dataRows.length
                                                                } rows from ${
                                                                    workflow.fileObjects?.[0]
                                                                        ?.name || "unknown"
                                                                }.\n` +
                                                                `Source Column: ${sourceColumn} (Index ${sourceIndex})\n` +
                                                                (targetColumn
                                                                    ? `Target Column: ${targetColumn} (Index ${targetIndex})\n`
                                                                    : "Target Column: None\n") +
                                                                (idColumn
                                                                    ? `ID Column: ${idColumn} (Index ${idIndex})\n`
                                                                    : "ID Column: Generated\n") +
                                                                `Metadata Columns: ${Object.keys(
                                                                    metadataIndices || {}
                                                                ).join(", ")}`,
                                                            validationResults: [],
                                                        },
                                                        transformed: {
                                                            sourceNotebook: {
                                                                name: "Source",
                                                                cells: Array.isArray(sourceCells)
                                                                    ? sourceCells.map((cell) => ({
                                                                          ...cell,
                                                                          kind: 2,
                                                                          languageId: "html",
                                                                      }))
                                                                    : [],
                                                            },
                                                            targetNotebook: {
                                                                name: "Target",
                                                                cells: Array.isArray(
                                                                    generatedTargetCells
                                                                )
                                                                    ? generatedTargetCells.map(
                                                                          (cell) => ({
                                                                              ...cell,
                                                                              kind: 2,
                                                                              languageId: "html",
                                                                          })
                                                                      )
                                                                    : [],
                                                            },
                                                            matchedCells: 0,
                                                            unmatchedContent: 0,
                                                            paratextItems: 0,
                                                            validationResults: [],
                                                        },
                                                    },
                                                };
                                                debug("---> Generated preview object:", preview);

                                                // Update workflow state
                                                setWorkflow((prev) => ({
                                                    ...prev,
                                                    previews: [
                                                        {
                                                            id: "spreadsheet-preview-" + Date.now(),
                                                            fileName: "Spreadsheet",
                                                            fileSize:
                                                                workflow.fileObjects?.[0]?.size ||
                                                                0,
                                                            fileType:
                                                                workflow.fileObjects?.[0]?.type ||
                                                                "text/plain",
                                                            preview,
                                                            isValid: true,
                                                        },
                                                    ],
                                                    columnMapping: {
                                                        sourceColumn,
                                                        targetColumn,
                                                        idColumn,
                                                        metadataColumns: Array.isArray(
                                                            metadataColumns
                                                        )
                                                            ? metadataColumns
                                                            : [],
                                                        hasHeaders: Boolean(safeMapping.hasHeaders),
                                                    },
                                                    step: "preview",
                                                    error: undefined,
                                                }));
                                            } catch (error) {
                                                console.error(
                                                    "Error during preview generation:",
                                                    error
                                                );
                                                setWorkflow((prev) => ({
                                                    ...prev,
                                                    error:
                                                        error instanceof Error
                                                            ? `Preview Error: ${error.message}`
                                                            : "Unknown error during preview generation",
                                                }));
                                            }
                                        },
                                    });
                                } catch (error) {
                                    console.error(
                                        "Error during TranslationPairsForm submission:",
                                        error
                                    );
                                    setWorkflow((prev) => ({
                                        ...prev,
                                        error:
                                            error instanceof Error
                                                ? `Error during TranslationPairsForm submission: ${error.message}`
                                                : "Unknown error during TranslationPairsForm submission",
                                    }));
                                }
                            }}
                            onCancel={handleCancel}
                        />
                    );
                }

                return (
                    <div style={{ padding: "2rem" }}>
                        <h2 style={{ marginBottom: "1rem" }}>
                            {workflow.importType === "source"
                                ? "Select Your Source File"
                                : workflow.importType === "translation-pairs"
                                ? "Select CSV/TSV File"
                                : "Select Translation File"}
                        </h2>
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFiles={workflow.fileObjects}
                            onClearFiles={handleClearFile}
                            onRemoveFile={handleRemoveFile}
                            type={workflow.importType}
                            availableCodexFiles={workflow.availableCodexFiles}
                            onAssociationChange={handleAssociationChange}
                            accept={
                                workflow.importType === "translation-pairs"
                                    ? ".csv,.tsv,.tab"
                                    : undefined
                            }
                        />
                        {workflow.error && (
                            <div
                                style={{
                                    marginTop: "1rem",
                                    padding: "0.5rem",
                                    color: "var(--vscode-inputValidation-errorForeground)",
                                    background: "var(--vscode-inputValidation-errorBackground)",
                                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                    borderRadius: "4px",
                                }}
                            >
                                {workflow.error}
                            </div>
                        )}
                        {workflow.fileObjects.length > 0 && (
                            <VSCodeButton
                                onClick={handleContinue}
                                style={{ marginTop: "1rem" }}
                                disabled={
                                    workflow.importType === "translation" &&
                                    (workflow.translationAssociations.length === 0 ||
                                        workflow.translationAssociations.length <
                                            workflow.fileObjects.length)
                                }
                            >
                                {workflow.importType === "translation"
                                    ? `Continue with ${
                                          workflow.translationAssociations.length
                                      } matched file${
                                          workflow.translationAssociations.length !== 1 ? "s" : ""
                                      }`
                                    : "Continue"}
                            </VSCodeButton>
                        )}
                    </div>
                );

            case "preview-download":
                return (
                    <div style={{ padding: "2rem" }}>
                        <ProcessingStages
                            stages={{
                                preview: {
                                    label: "Downloading Preview",
                                    description: "Preparing Bible content preview",
                                    status: "active",
                                },
                            }}
                            importType={workflow.importType || "source"}
                            progress={workflow.progress}
                            step={workflow.step}
                            error={workflow.error}
                            onRetry={() => {
                                setWorkflow((prev) => ({
                                    ...prev,
                                    step: "select",
                                    error: undefined,
                                    // Preserve the language selection if it exists
                                    bibleDownload: prev.bibleDownload
                                        ? {
                                              ...prev.bibleDownload,
                                              status: "idle",
                                              translationId: "",
                                          }
                                        : undefined,
                                }));
                            }}
                        />
                    </div>
                );

            case "preview":
                if (workflow.importType === "bible-download" && workflow.preview) {
                    const biblePreview = workflow.preview as IBiblePreview;
                    return (
                        <BiblePreview
                            preview={{
                                type: "bible",
                                fileName: biblePreview.fileName,
                                fileSize: biblePreview.fileSize || 0,
                                fileType: biblePreview.fileType,
                                original: biblePreview.original,
                                transformed: {
                                    sourceNotebooks: biblePreview.transformed.sourceNotebooks.map(
                                        (notebook) => ({
                                            name: notebook.name,
                                            cells: notebook.cells.map((cell) => ({
                                                value: cell.value,
                                                metadata: {
                                                    id: cell.metadata?.id || "",
                                                    type: cell.metadata?.type || "",
                                                },
                                            })),
                                            metadata: notebook.metadata,
                                        })
                                    ),
                                    validationResults: biblePreview.transformed.validationResults,
                                },
                            }}
                            onConfirm={() => {
                                if (workflow.currentTransaction) {
                                    vscode.postMessage({
                                        command: "confirmBibleDownload",
                                        transaction: workflow.currentTransaction,
                                    });
                                    setWorkflow((prev) => ({
                                        ...prev,
                                        step: "processing",
                                    }));
                                }
                            }}
                            onCancel={() => {
                                vscode.postMessage({
                                    command: "cancelBibleDownload",
                                    transaction: workflow.currentTransaction,
                                } as SourceUploadPostMessages);
                                setWorkflow((prev) => ({
                                    ...prev,
                                    step: "select",
                                    importType: "bible-download",
                                    error: undefined,
                                    bibleDownload: prev.bibleDownload
                                        ? {
                                              ...prev.bibleDownload,
                                              status: "idle",
                                              translationId: "",
                                          }
                                        : undefined,
                                    currentTransaction: undefined,
                                    preview: undefined,
                                }));
                            }}
                        />
                    );
                }

                debug(
                    `---> Rendering preview step. Import Type: ${workflow.importType}. Number of previews: ${workflow.previews.length}`
                );
                debug("---> Full workflow state in preview step:", workflow);
                return (
                    <MultiPreviewContainer
                        previews={workflow.previews.map((p) => ({
                            ...p,
                            isValid: true,
                        }))}
                        onConfirm={() => {
                            // let command = "";
                            // let data: PreviewContent | undefined = undefined;

                            let message: SourceUploadPostMessages | undefined = undefined;

                            switch (workflow.importType) {
                                case "translation":
                                    message = {
                                        command: "confirmTranslationImport",
                                    };
                                    break;
                                case "source":
                                    message = {
                                        command: "confirmSourceImport",
                                    };
                                    break;
                                case "bible-download":
                                    message = {
                                        command: "confirmBibleDownload",
                                        transaction: workflow.currentTransaction,
                                    };
                                    break;
                                case "translation-pairs":
                                    debug("confirmTranslationPairsImport in webview", {
                                        workflow,
                                    });
                                    message = {
                                        command: "confirmTranslationPairsImport",
                                        headers: workflow.fileHeaders || [],
                                        data: workflow.previews[0]
                                            .preview as TranslationPairsPreview,
                                    };
                                    break;
                            }

                            vscode.postMessage(message);
                        }}
                        onCancel={() => {
                            if (workflow.importType === "translation-pairs") {
                                setWorkflow((prev) => {
                                    // For other cases, reset to initial state
                                    return {
                                        ...prev,
                                        step: "select",
                                        importType: "translation-pairs",
                                        error: undefined,
                                        bibleDownload: undefined,
                                        previews: [],
                                    };
                                });
                            } else {
                                vscode.postMessage({
                                    command:
                                        workflow.importType === "translation"
                                            ? "cancelTranslationImport"
                                            : "cancelSourceImport",
                                });
                            }
                        }}
                        onRejectPreview={(id) => {
                            setWorkflow((prev) => ({
                                ...prev,
                                previews: prev.previews.map((p) =>
                                    p.id === id ? { ...p, isValid: true, isRejected: true } : p
                                ),
                            }));
                        }}
                    />
                );

            case "processing":
                return (
                    <div style={{ padding: "2rem" }}>
                        {workflow.error &&
                        (workflow.error.includes("404 Not Found") ||
                            workflow.error.includes("Failed to fetch Bible text")) ? (
                            <div
                                style={{
                                    padding: "1rem",
                                    marginBottom: "1rem",
                                    backgroundColor:
                                        "var(--vscode-inputValidation-errorBackground)",
                                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                    color: "var(--vscode-inputValidation-errorForeground)",
                                    borderRadius: "4px",
                                }}
                            >
                                <div style={{ marginBottom: "1rem" }}>{workflow.error}</div>
                                <VSCodeButton
                                    onClick={() => {
                                        setWorkflow((prev) => ({
                                            ...prev,
                                            step: "select",
                                            error: undefined,
                                            // Preserve the language selection if it exists
                                            bibleDownload: prev.bibleDownload
                                                ? {
                                                      ...prev.bibleDownload,
                                                      status: "idle",
                                                      translationId: "",
                                                  }
                                                : undefined,
                                        }));
                                    }}
                                >
                                    Go Back and Try Another Translation
                                </VSCodeButton>
                            </div>
                        ) : (
                            <ProcessingStages
                                stages={workflow.processingStages}
                                importType={workflow.importType || "source"}
                                progress={workflow.progress}
                                step={workflow.step}
                                error={workflow.error}
                            />
                        )}
                    </div>
                );

            case "complete":
                return (
                    <div style={{ textAlign: "center", padding: "2rem" }}>
                        <i
                            className="codicon codicon-check"
                            style={{
                                fontSize: "3rem",
                                color: "var(--vscode-testing-iconPassed)",
                                marginBottom: "1rem",
                                display: "block",
                            }}
                        />
                        <h2 style={{ marginBottom: "1rem" }}>Import Complete!</h2>
                        <p style={{ marginBottom: "2rem" }}>
                            {workflow.importType === "bible-download"
                                ? "Bible content has been successfully downloaded and processed."
                                : "Your source file has been successfully imported."}
                        </p>
                        <div
                            style={{
                                display: "flex",
                                gap: "1rem",
                                justifyContent: "center",
                                flexWrap: "wrap",
                            }}
                        >
                            <VSCodeButton
                                onClick={() => {
                                    vscode.postMessage({ command: "openTranslationFile" });
                                }}
                                style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}
                            >
                                <i className="codicon codicon-file-code"></i>&nbsp; Start
                                Translating
                            </VSCodeButton>
                            <VSCodeButton appearance="secondary" onClick={handleUploadAnother}>
                                Upload Another File
                            </VSCodeButton>
                        </div>
                    </div>
                );

            default:
                return null;
        }
    };

    useEffect(() => {
        const messageHandler = (event: MessageEvent<SourceUploadResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
                case "fileHeaders":
                    // When we receive headers for translation pairs, update the workflow
                    setWorkflow((prev) => ({
                        ...prev,
                        fileHeaders: message.headers,
                        step: "select", // This will trigger showing the TranslationPairsForm
                    }));
                    break;
                case "preview":
                    setWorkflow((prev) => ({
                        ...prev,
                        step: "preview",
                        preview: message.preview,
                    }));
                    break;
                case "error":
                    setWorkflow((prev) => ({
                        ...prev,
                        error: message.message,
                        // If we're in preview-download step and get a 404 error, stay in that step
                        step:
                            prev.step === "preview-download" &&
                            (message.message.includes("404 Not Found") ||
                                message.message.includes("Failed to fetch Bible text"))
                                ? "preview-download"
                                : prev.step,
                    }));
                    break;
                case "bibleDownloadProgress":
                    if (message.progress) {
                        setWorkflow((prev) => {
                            const currentStages = getBibleProcessingStages();
                            const updatedStages: any = { ...currentStages };

                            // Update stages based on progress status
                            Object.entries(message.progress?.status || {}).forEach(
                                ([key, status]) => {
                                    if (key in updatedStages) {
                                        updatedStages[key] = {
                                            ...updatedStages[key],
                                            status: status as ProcessingStatus,
                                        };
                                    }
                                }
                            );

                            return {
                                ...prev,
                                step: "processing",
                                processingStages: updatedStages,
                                progress: {
                                    message: message.progress?.message || "",
                                    increment: message.progress?.increment || 0,
                                },
                            };
                        });
                    }
                    break;

                case "bibleDownloadComplete":
                    setWorkflow((prev) => ({
                        ...prev,
                        step: "complete",
                        processingStages: getBibleProcessingStages("complete"),
                        bibleDownload: {
                            ...prev.bibleDownload!,
                            status: "complete",
                        },
                    }));
                    break;

                case "bibleDownloadError":
                    setWorkflow((prev) => ({
                        ...prev,
                        error: message.error || "Failed to download Bible",
                    }));
                    break;

                case "biblePreview":
                    setWorkflow((prev) => ({
                        ...prev,
                        step: "preview",
                        preview: message.preview,
                        currentTransaction: message.transaction,
                    }));
                    break;

                // ... rest of the cases ...
            }
        };

        window.addEventListener("message", messageHandler);
        return () => window.removeEventListener("message", messageHandler);
    }, [setWorkflow]);

    return (
        <VSCodePanels style={{ height: "100vh" }}>
            <VSCodePanelTab id="setup">Project Setup</VSCodePanelTab>
            <VSCodePanelView id="setup-view">
                <div className="workflow-container">
                    <WorkflowProgress
                        currentStep={workflow.step}
                        importType="bible-download"
                        steps={[
                            "type-select",
                            "select",
                            "preview-download",
                            "preview",
                            "processing",
                            "complete",
                        ]}
                        onStepClick={handleStepClick}
                    />
                    {workflow.error &&
                        !workflow.error.includes("404 Not Found") &&
                        !workflow.error.includes("Failed to fetch Bible text") && (
                            <div
                                style={{
                                    padding: "1rem",
                                    background: "var(--vscode-inputValidation-errorBackground)",
                                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                    borderRadius: "4px",
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                }}
                            >
                                <i className="codicon codicon-error" />
                                <span>{workflow.error}</span>
                            </div>
                        )}
                    {renderWorkflowStep()}
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
};

export default SourceUploader;
