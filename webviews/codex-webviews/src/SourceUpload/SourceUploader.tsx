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

const DEBUG = true;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[SourceUploader]", ...args);
    }
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

        try {
            const filePromises = workflow.fileObjects.map(async (file) => ({
                content: await readFileAsText(file),
                name: file.name,
            }));

            const files = await Promise.all(filePromises);
            debug({ files });

            const content = files[0].content;
            // Parse just the first line to get headers/columns
            const firstLine = content.split("\n")[0];
            const delimiter = files[0].name.endsWith(".csv") ? "," : "\t";
            // const parsedHeaders = parse(firstLine, {
            //     delimiter,
            //     skip_empty_lines: true,
            //     columns: false,
            //     to: 1, // Only parse first line
            // });
            // debug("parsedHeaders", parsedHeaders);
            readString(content, {
                // worker: true,
                header: false,
                complete: (results: any) => {
                    setWorkflow((prev) => ({
                        ...prev,
                        fileHeaders: results.data[0],
                        fileContent: content,
                        step: "select", // This will trigger showing the TranslationPairsForm
                    }));
                    debug("---------------------------");
                    debug(results);
                    debug("---------------------------");
                },
            });

            // If no headers, generate column numbers
            // const headers = parsedHeaders; /* .map((_, i) => `Column ${i + 1}`); */
            // if (workflow.importType === "translation") {
            //     // Handle translation files
            //     const filesWithSourceIds = files.map((file) => {
            //         const association = workflow.translationAssociations.find(
            //             (a) => a.file.name === file.name
            //         );
            //         return {
            //             ...file,
            //             sourceId: association?.codexId || "",
            //         };
            //     });

            //     vscode.postMessage({
            //         command: "uploadTranslation",
            //         files: filesWithSourceIds,
            //     } as SourceUploadPostMessages);
            // } else if (workflow.importType === "translation-pairs") {
            //     // For translation pairs, we just send the file and wait for headers
            //     vscode.postMessage({
            //         command: "uploadSourceText",
            //         files,
            //     } as SourceUploadPostMessages);
            //     // fixme: we probably don't need to send the files here, since we're just waiting for headers we can parse the headers out and do the flow in the webview and simply send the codex and source file to the provider when they are ready.

            //     // The provider will respond with fileHeaders command, which will trigger
            //     // the TranslationPairsForm to be shown
            // } else {
            //     // Handle source files
            //     vscode.postMessage({
            //         command: "uploadSourceText",
            //         files,
            //     } as SourceUploadPostMessages);
            // }
        } catch (error) {
            console.error("Error preparing files:", error);
            setWorkflow((prev) => ({
                ...prev,
                error: error instanceof Error ? error.message : "Failed to read files",
            }));
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
                        console.log("confirmBibleDownload in webview", {
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
                    return (
                        <TranslationPairsForm
                            headers={workflow.fileHeaders}
                            onSubmit={async (mapping) => {
                                debug({ mapping });
                                readString(workflow.fileContent || "", {
                                    header: true,
                                    complete: (results: ParseResult<{ [key: string]: string }>) => {
                                        debug({ results });

                                        const sourceCells = results.data
                                            .filter(
                                                (row) =>
                                                    row[mapping.sourceColumn] &&
                                                    row[mapping.targetColumn] &&
                                                    !(row[mapping.idColumn || ""] === "")
                                            )
                                            .map((row) => ({
                                                value: row[mapping.sourceColumn],
                                                metadata: {
                                                    id: row[mapping.idColumn || ""],
                                                    type: "source",
                                                },
                                            }));

                                        const targetCells = sourceCells.map((cell) => {
                                            const targetRow = results.data.find(
                                                (row) =>
                                                    row[mapping.idColumn || ""] === cell.metadata.id
                                            );
                                            return {
                                                value: targetRow?.[mapping.targetColumn] || "",
                                                metadata: {
                                                    id: cell.metadata.id,
                                                    type: "target",
                                                },
                                            };
                                        });

                                        const preview: PreviewContent = {
                                            type: "translation-pairs",
                                            fileName: workflow.fileObjects[0].name,
                                            fileSize: workflow.fileObjects[0].size,
                                            fileType: workflow.fileObjects[0].type as FileType,
                                            original: {
                                                preview:
                                                    "CSV/TSV content will be processed according to the following mapping:\n" +
                                                    `Source: ${mapping.sourceColumn}\n` +
                                                    `Target: ${mapping.targetColumn}\n` +
                                                    (mapping.idColumn
                                                        ? `ID: ${mapping.idColumn}\n`
                                                        : "") +
                                                    `Metadata: ${mapping.metadataColumns.join(
                                                        ", "
                                                    )}`,
                                                validationResults: [],
                                            },
                                            preview: {
                                                original: {
                                                    preview:
                                                        "CSV/TSV content will be processed according to the following mapping:\n" +
                                                        `Source: ${mapping.sourceColumn}\n` +
                                                        `Target: ${mapping.targetColumn}\n` +
                                                        (mapping.idColumn
                                                            ? `ID: ${mapping.idColumn}\n`
                                                            : "") +
                                                        `Metadata: ${mapping.metadataColumns.join(
                                                            ", "
                                                        )}`,
                                                    validationResults: [],
                                                },
                                                transformed: {
                                                    sourceNotebook: {
                                                        name: "Source",
                                                        cells: sourceCells,
                                                    },
                                                    targetNotebook: {
                                                        name: "Target",
                                                        cells: targetCells,
                                                    },
                                                    matchedCells: 0,
                                                    unmatchedContent: 0,
                                                    paratextItems: 0,
                                                    validationResults: [],
                                                },
                                            },
                                        };
                                        setWorkflow((prev) => ({
                                            ...prev,
                                            previews: [
                                                ...prev.previews,
                                                {
                                                    id: "translation-pairs",
                                                    fileName: "Translation Pairs",
                                                    fileSize: 0,
                                                    fileType: "csv",
                                                    preview,
                                                },
                                            ],
                                            columnMapping: mapping,
                                            step: "preview",
                                        }));
                                    },
                                });
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

                // For source and translation imports, show multiple previews
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
                            vscode.postMessage({
                                command:
                                    workflow.importType === "translation"
                                        ? "cancelTranslationImport"
                                        : "cancelSourceImport",
                            });
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
                        <VSCodeButton onClick={handleUploadAnother}>
                            Upload Another File
                        </VSCodeButton>
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
        <VSCodePanels>
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
