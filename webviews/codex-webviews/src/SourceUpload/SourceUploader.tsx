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

const initialWorkflowState: WorkflowState = {
    step: "type-select",
    importType: null,
    selectedFile: null,
    fileObject: null,
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
        (metadata: ExtendedMetadata) => {
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
            if (files.length > 0) {
                const file = files[0];
                setWorkflow((prev) => ({
                    ...prev,
                    selectedFile: file.name,
                    fileObject: file,
                }));

                const reader = new FileReader();
                reader.onload = (e) => {
                    if (workflow.importType === "translation") {
                        if (!workflow.selectedSourceId) {
                            vscode.postMessage({
                                command: "error",
                                errorMessage: "Please select a source file first",
                            } as SourceUploadPostMessages);
                            return;
                        }

                        vscode.postMessage({
                            command: "uploadTranslation",
                            fileContent: e.target?.result?.toString() || "",
                            fileName: file.name,
                            sourceId: workflow.selectedSourceId,
                        } as SourceUploadPostMessages);
                    } else {
                        vscode.postMessage({
                            command: "uploadSourceText",
                            fileContent: e.target?.result?.toString() || "",
                            fileName: file.name,
                        } as SourceUploadPostMessages);
                    }
                };
                reader.readAsText(file);
            }
        },
        [setWorkflow, vscode, workflow.importType, workflow.selectedSourceId]
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
                    preview={workflow.preview}
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
                return <ImportTypeSelector onSelect={handleImportTypeSelect} />;

            case "select":
                if (workflow.importType === "bible-download") {
                    return (
                        <BibleDownloadForm
                            onDownload={handleBibleDownload}
                            onCancel={handleCancel}
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
                        {workflow.importType === "translation" && (
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
                        )}
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFile={workflow.fileObject}
                            onClearFile={handleClearFile}
                            type={workflow.importType}
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
                    </div>
                );

            case "preview":
                if (workflow.importType === "bible-download") {
                    return (
                        <BiblePreview
                            preview={workflow.preview as PreviewContent & { type: "bible" }}
                            onConfirm={() => {
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
                return renderPreview();

            // case "processing":
            //     return (
            //         <div style={{ padding: "2rem" }}>
            //             <ProcessingStages
            //                 stages={workflow.processingStages}
            //                 importType={workflow.importType || "source"}
            //             />
            //             {workflow.progress && (
            //                 <ProgressDisplay
            //                     progress={workflow.progress}
            //                     stages={workflow.processingStages}
            //                     importType={workflow.importType || "source"}
            //                 />
            //             )}
            //         </div>
            //     );

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
                    {workflow.error && (
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
