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
                error: null,
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
                step: "processing",
                processingStages: getBibleProcessingStages(),
                bibleDownload: {
                    language: metadata.languageCode,
                    status: "downloading",
                    translationId: metadata.translationId || "",
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
        setWorkflow((prev) => ({
            ...prev,
            step: "type-select",
            importType: null,
            error: null,
            bibleDownload: undefined,
        }));
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
            }));
        }
    }, [workflow.fileObjects, workflow.importType, workflow.translationAssociations, vscode]);

    const handlePreviewReject = useCallback(
        (previewId: string) => {
            setWorkflow((prev) => ({
                ...prev,
                previews: prev.previews.map((p) =>
                    p.id === previewId ? { ...p, isRejected: true } : p
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
                            transaction: workflow.currentTransaction,
                        } as SourceUploadPostMessages);
                        handleCancel();
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
                return <ImportTypeSelector 
                    onSelect={handleImportTypeSelect}
                    onCancel={handleCancel}
                />;

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

                return (
                    <div style={{ padding: "2rem" }}>
                        <h2 style={{ marginBottom: "1rem" }}>
                            {workflow.importType === "source"
                                ? "Select Your Source File"
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
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFiles={workflow.fileObjects}
                            onClearFiles={handleClearFile}
                            onRemoveFile={handleRemoveFile}
                            type={workflow.importType}
                            availableCodexFiles={workflow.availableCodexFiles}
                            onAssociationChange={handleAssociationChange}
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
                                }
                            }}
                            onCancel={() => {
                                if (workflow.currentTransaction) {
                                    vscode.postMessage({
                                        command: "cancelBibleDownload",
                                        transaction: workflow.currentTransaction,
                                    });
                                }
                            }}
                        />
                    );
                }

                // For source and translation imports, show multiple previews
                return (
                    <MultiPreviewContainer
                        previews={workflow.previews}
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
                                    p.id === id ? { ...p, isRejected: true } : p
                                ),
                            }));
                        }}
                    />
                );

            case "processing":
                return (
                    <div style={{ padding: "2rem" }}>
                        {workflow.error && workflow.error.includes("404 Not Found") ? (
                            <div
                                style={{
                                    padding: "1rem",
                                    marginBottom: "1rem",
                                    backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                                    color: "var(--vscode-inputValidation-errorForeground)",
                                    borderRadius: "4px",
                                }}
                            >
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
                                    Go Back and Try Another Translation
                                </VSCodeButton>
                            </div>
                        ) : (
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
        const handleMessage = (event: MessageEvent<SourceUploadResponseMessages>) => {
            const message = event.data;

            switch (message.command) {
                case "bibleDownloadProgress":
                    if (message.progress) {
                        setWorkflow((prev) => {
                            const currentStages = getBibleProcessingStages();
                            const updatedStages: any = { ...currentStages };

                            // Update stages based on progress status
                            Object.entries(message.progress?.status || {}).forEach(
                                ([key, status]) => {
                                    if (key in updatedStages) {
                                        updatedStages[key].status = status as ProcessingStatus;
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

                // ... existing cases ...
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [setWorkflow]);

    return (
        <VSCodePanels>
            <VSCodePanelTab id="setup">Project Setup</VSCodePanelTab>
            <VSCodePanelView id="setup-view">
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
