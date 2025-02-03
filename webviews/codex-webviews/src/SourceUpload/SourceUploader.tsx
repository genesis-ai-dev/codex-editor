import React, { useCallback, useEffect } from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import {
    BiblePreviewData,
    PreviewContent,
    SourceUploadPostMessages,
    SourceUploadResponseMessages,
    NotebookPreview,
    CustomCellMetaData,
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
<<<<<<< HEAD
=======
import { TranslationPairsForm } from "./components/TranslationPairsForm";
>>>>>>> main

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

<<<<<<< HEAD
=======
const readFileAsText = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target?.result?.toString() || "");
        reader.onerror = reject;
        reader.readAsText(file);
    });
};

>>>>>>> main
export const SourceUploader: React.FC = () => {
    const { vscode, workflow, setWorkflow } = useVSCodeMessageHandler();

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
<<<<<<< HEAD
                error: null,
=======
                error: undefined,
>>>>>>> main
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
<<<<<<< HEAD
                step: "processing",
                processingStages: getBibleProcessingStages(),
=======
                step: "preview-download",
>>>>>>> main
                bibleDownload: {
                    language: metadata.languageCode,
                    status: "downloading",
                    translationId: metadata.translationId || "",
                },
<<<<<<< HEAD
=======
                progress: {
                    message: "Downloading preview content...",
                    increment: 20
                }
>>>>>>> main
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
<<<<<<< HEAD
                        translationId: ""
                    },
                    currentTransaction: undefined,
                    preview: undefined
=======
                        translationId: "",
                    },
                    currentTransaction: undefined,
                    preview: undefined,
>>>>>>> main
                };
            }
            // For other cases, reset to initial state
            return {
                ...prev,
                step: "type-select",
                importType: null,
                error: undefined,
<<<<<<< HEAD
                bibleDownload: undefined
=======
                bibleDownload: undefined,
>>>>>>> main
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
<<<<<<< HEAD
            const fileReaders = workflow.fileObjects.map(
                (file) =>
                    new Promise<{ content: string; name: string; sourceId?: string }>(
                        (resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                resolve({
                                    content: e.target?.result?.toString() || "",
                                    name: file.name,
                                    ...(workflow.importType === "translation"
                                        ? {
                                              sourceId: workflow.translationAssociations.find(
                                                  (a) => a.file.name === file.name
                                              )?.codexId,
                                          }
                                        : {}),
                                });
                            };
                            reader.onerror = reject;
                            reader.readAsText(file);
                        }
                    )
            );

            const fileContents = await Promise.all(fileReaders);

            if (workflow.importType === "translation") {
                // Validate associations before proceeding
                const validFiles = fileContents.filter((f) => f.sourceId);
                if (validFiles.length === 0) {
                    throw new Error("Please associate each translation file with a Codex file");
                }

                vscode.postMessage({
                    command: "uploadTranslation",
                    files: validFiles,
                } as SourceUploadPostMessages);
            } else {
                vscode.postMessage({
                    command: "uploadSourceText",
                    files: fileContents,
                } as SourceUploadPostMessages);
            }
        } catch (error) {
            setWorkflow((prev) => ({
                ...prev,
                error: error instanceof Error ? error.message : "Failed to process files",
=======
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
            } else if (workflow.importType === "translation-pairs") {
                // For translation pairs, we just send the file and wait for headers
                vscode.postMessage({
                    command: "uploadSourceText",
                    files,
                } as SourceUploadPostMessages);

                // The provider will respond with fileHeaders command, which will trigger
                // the TranslationPairsForm to be shown
            } else {
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
>>>>>>> main
            }));
        }
    }, [workflow.fileObjects, workflow.importType, workflow.translationAssociations, vscode]);

    const handlePreviewReject = useCallback(
        (previewId: string) => {
            setWorkflow((prev) => ({
                ...prev,
                previews: prev.previews.map((p) =>
<<<<<<< HEAD
                    p.id === previewId ? { ...p, isRejected: true } : p
=======
                    p.id === previewId ? { ...p, isValid: true, isRejected: true } : p
>>>>>>> main
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

        // Type guard for BiblePreviewData
        const isBiblePreview = (preview: any): preview is BiblePreviewData => {
            return (
                Object.prototype.hasOwnProperty.call(preview, "original") &&
                Object.prototype.hasOwnProperty.call(preview, "transformed") &&
                Array.isArray(preview.transformed.sourceNotebooks)
            );
        };

        // Type guard for TranslationPreview
        const isTranslationPreview = (preview: any): preview is typeof TranslationPreview => {
            return preview.type === "translation";
        };

        // Type guard for SourcePreview
        const isSourcePreview = (preview: any): preview is typeof SourcePreview => {
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
<<<<<<< HEAD
                            transaction: workflow.currentTransaction
=======
                            transaction: workflow.currentTransaction,
>>>>>>> main
                        } as SourceUploadPostMessages);
                        setWorkflow((prev) => ({
                            ...prev,
                            step: "select",
                            importType: "bible-download",
                            error: undefined,
<<<<<<< HEAD
                            bibleDownload: prev.bibleDownload ? {
                                ...prev.bibleDownload,
                                status: "idle",
                                translationId: ""
                            } : undefined,
                            currentTransaction: undefined,
                            preview: undefined
=======
                            bibleDownload: prev.bibleDownload
                                ? {
                                      ...prev.bibleDownload,
                                      status: "idle",
                                      translationId: "",
                                  }
                                : undefined,
                            currentTransaction: undefined,
                            preview: undefined,
>>>>>>> main
                        }));
                    }}
                />
            );
        }

        if (isTranslationPreview(workflow.preview)) {
            const preview = workflow.preview as PreviewContent & { type: "translation" };
            return (
                <TranslationPreview
                    preview={preview}
                    onConfirm={() => handlePreviewConfirm("translation")}
                    onCancel={handlePreviewCancel}
                />
            );
        }

        if (isSourcePreview(workflow.preview)) {
            const preview = workflow.preview as PreviewContent & { type: "source" };
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
<<<<<<< HEAD
                return <ImportTypeSelector 
                    onSelect={handleImportTypeSelect}
                    onCancel={handleCancel}
                />;
=======
                return (
                    <ImportTypeSelector onSelect={handleImportTypeSelect} onCancel={handleCancel} />
                );
>>>>>>> main

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

<<<<<<< HEAD
=======
                if (workflow.importType === "translation-pairs" && workflow.fileHeaders) {
                    return (
                        <TranslationPairsForm
                            headers={workflow.fileHeaders}
                            onSubmit={async (mapping) => {
                                vscode.postMessage({
                                    command: "setColumnMapping",
                                    mapping,
                                } as SourceUploadPostMessages);
                            }}
                            onCancel={handleCancel}
                        />
                    );
                }

>>>>>>> main
                return (
                    <div style={{ padding: "2rem" }}>
                        <h2 style={{ marginBottom: "1rem" }}>
                            {workflow.importType === "source"
                                ? "Select Your Source File"
<<<<<<< HEAD
                                : "Select Translation File"}
                        </h2>
                        {/* {workflow.importType === "translation" && (
                            <div style={{ marginBottom: "2rem" }}>
                                <label>Codex File:</label>
                                <VSCodeDropdown
                                    style={{ width: "100%", marginTop: "0.5rem" }}
                                    onChange={(e: any) => {
                                        setWorkflow((prev) => ({
                                            ...prev,
                                            selectedSourceId: e.target.value,
                                            error: null,
                                        }));
                                    }}
                                >
                                    <VSCodeOption value="">Select a Codex file...</VSCodeOption>
                                    {workflow.availableCodexFiles?.map((file) => (
                                        <VSCodeOption key={file.id} value={file.id}>
                                            {file.name}
                                        </VSCodeOption>
                                    ))}
                                </VSCodeDropdown>
                            </div>
                        )} */}
=======
                                : workflow.importType === "translation-pairs"
                                ? "Select CSV/TSV File"
                                : "Select Translation File"}
                        </h2>
>>>>>>> main
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFiles={workflow.fileObjects}
                            onClearFiles={handleClearFile}
                            onRemoveFile={handleRemoveFile}
                            type={workflow.importType}
                            availableCodexFiles={workflow.availableCodexFiles}
                            onAssociationChange={handleAssociationChange}
<<<<<<< HEAD
=======
                            accept={
                                workflow.importType === "translation-pairs"
                                    ? ".csv,.tsv,.tab"
                                    : undefined
                            }
>>>>>>> main
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

<<<<<<< HEAD
=======
            case "preview-download":
                return (
                    <div style={{ padding: "2rem" }}>
                        <ProcessingStages
                            stages={{
                                preview: {
                                    label: "Downloading Preview",
                                    description: "Preparing Bible content preview",
                                    status: "active"
                                }
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

>>>>>>> main
            case "preview":
                if (workflow.importType === "bible-download" && workflow.preview) {
                    return (
                        <BiblePreview
                            preview={{
                                type: "bible",
                                original: workflow.preview.original,
                                transformed: {
                                    sourceNotebooks: (
                                        workflow.preview.transformed
                                            .sourceNotebooks as NotebookPreview[]
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
                                    validationResults:
                                        workflow.preview.transformed.validationResults,
                                },
                            }}
                            onConfirm={() => {
                                if (workflow.currentTransaction) {
                                    vscode.postMessage({
                                        command: "confirmBibleDownload",
                                        transaction: workflow.currentTransaction,
                                    });
<<<<<<< HEAD
=======
                                    setWorkflow((prev) => ({
                                        ...prev,
                                        step: "processing",
                                    }));
>>>>>>> main
                                }
                            }}
                            onCancel={() => {
                                vscode.postMessage({
                                    command: "cancelBibleDownload",
<<<<<<< HEAD
                                    transaction: workflow.currentTransaction
=======
                                    transaction: workflow.currentTransaction,
>>>>>>> main
                                } as SourceUploadPostMessages);
                                setWorkflow((prev) => ({
                                    ...prev,
                                    step: "select",
                                    importType: "bible-download",
                                    error: undefined,
<<<<<<< HEAD
                                    bibleDownload: prev.bibleDownload ? {
                                        ...prev.bibleDownload,
                                        status: "idle",
                                        translationId: ""
                                    } : undefined,
                                    currentTransaction: undefined,
                                    preview: undefined
=======
                                    bibleDownload: prev.bibleDownload
                                        ? {
                                              ...prev.bibleDownload,
                                              status: "idle",
                                              translationId: "",
                                          }
                                        : undefined,
                                    currentTransaction: undefined,
                                    preview: undefined,
>>>>>>> main
                                }));
                            }}
                        />
                    );
                }

                // For source and translation imports, show multiple previews
                return (
                    <MultiPreviewContainer
<<<<<<< HEAD
                        previews={workflow.previews}
=======
                        previews={workflow.previews.map((p) => ({
                            ...p,
                            isValid: true,
                        }))}
>>>>>>> main
                        onConfirm={() => {
                            vscode.postMessage({
                                command:
                                    workflow.importType === "translation"
                                        ? "confirmTranslationImport"
                                        : "confirmSourceImport",
                            });
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
<<<<<<< HEAD
                                    p.id === id ? { ...p, isRejected: true } : p
=======
                                    p.id === id ? { ...p, isValid: true, isRejected: true } : p
>>>>>>> main
                                ),
                            }));
                        }}
                    />
                );

            case "processing":
                return (
                    <div style={{ padding: "2rem" }}>
<<<<<<< HEAD
                        {workflow.error && workflow.error.includes("404 Not Found") ? (
=======
                        {workflow.error && (workflow.error.includes("404 Not Found") || workflow.error.includes("Failed to fetch Bible text")) ? (
>>>>>>> main
                            <div
                                style={{
                                    padding: "1rem",
                                    marginBottom: "1rem",
<<<<<<< HEAD
                                    backgroundColor: "var(--vscode-inputValidation-errorBackground)",
=======
                                    backgroundColor:
                                        "var(--vscode-inputValidation-errorBackground)",
>>>>>>> main
                                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                    color: "var(--vscode-inputValidation-errorForeground)",
                                    borderRadius: "4px",
                                }}
                            >
<<<<<<< HEAD
                                <div style={{ marginBottom: "1rem" }}>
                                    {workflow.error}
                                </div>
                                <VSCodeButton onClick={() => {
                                    setWorkflow(prev => ({
                                        ...prev,
                                        step: "select",
                                        error: undefined,
                                        // Preserve the language selection if it exists
                                        bibleDownload: prev.bibleDownload ? {
                                            ...prev.bibleDownload,
                                            status: "idle",
                                            translationId: ""
                                        } : undefined
                                    }));
                                }}>
=======
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
>>>>>>> main
                                    Go Back and Try Another Translation
                                </VSCodeButton>
                            </div>
                        ) : (
<<<<<<< HEAD
                            <>
                                <ProcessingStages
                                    stages={workflow.processingStages}
                                    importType={workflow.importType || "source"}
                                />
                                {workflow.progress && (
                                    <ProgressDisplay
                                        progress={workflow.progress}
                                        stages={workflow.processingStages}
                                        importType={workflow.importType || "source"}
                                    />
                                )}
                            </>
=======
                            <ProcessingStages
                                stages={workflow.processingStages}
                                importType={workflow.importType || "source"}
                                progress={workflow.progress}
                                step={workflow.step}
                                error={workflow.error}
                            />
>>>>>>> main
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
<<<<<<< HEAD
        const handleMessage = (event: MessageEvent<SourceUploadResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
=======
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
                        step: prev.step === "preview-download" && 
                              (message.message.includes("404 Not Found") || 
                               message.message.includes("Failed to fetch Bible text"))
                            ? "preview-download"
                            : prev.step
                    }));
                    break;
>>>>>>> main
                case "bibleDownloadProgress":
                    if (message.progress) {
                        setWorkflow((prev) => {
                            const currentStages = getBibleProcessingStages();
                            const updatedStages: any = { ...currentStages };

                            // Update stages based on progress status
                            Object.entries(message.progress?.status || {}).forEach(
                                ([key, status]) => {
                                    if (key in updatedStages) {
<<<<<<< HEAD
                                        updatedStages[key].status = status as ProcessingStatus;
=======
                                        updatedStages[key] = {
                                            ...updatedStages[key],
                                            status: status as ProcessingStatus
                                        };
>>>>>>> main
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

<<<<<<< HEAD
                // ... existing cases ...
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
=======
                // ... rest of the cases ...
            }
        };

        window.addEventListener("message", messageHandler);
        return () => window.removeEventListener("message", messageHandler);
>>>>>>> main
    }, [setWorkflow]);

    return (
        <VSCodePanels>
            <VSCodePanelTab id="setup">Project Setup</VSCodePanelTab>
            <VSCodePanelView id="setup-view">
<<<<<<< HEAD
                <div
                    style={{
                        maxWidth: "100dvw",
                        margin: "0 auto",
                        padding: "2rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2rem",
                    }}
                >
                    <WorkflowProgress
                        currentStep={workflow.step}
                        importType={workflow.importType || "source"}
                        steps={["type-select", "select", "preview", "processing", "complete"]}
                        onStepClick={handleStepClick}
                    />
                    {workflow.error && !workflow.error.includes("404 Not Found") && (
=======
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
                            "complete"
                        ]}
                        onStepClick={handleStepClick}
                    />
                    {workflow.error && 
                        !workflow.error.includes("404 Not Found") && 
                        !workflow.error.includes("Failed to fetch Bible text") && (
>>>>>>> main
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
