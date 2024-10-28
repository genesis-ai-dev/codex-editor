import React, { useCallback, useEffect } from "react";
import {
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeButton,
} from "@vscode/webview-ui-toolkit/react";
import { SourceUploadPostMessages, SourceUploadResponseMessages } from "../../../../types";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { SourcePreview } from "./components/SourcePreview";
import { ProcessingStages } from "./components/ProcessingStages";
import { ProgressDisplay } from "./components/ProgressDisplay";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { WorkflowState, WorkflowStep, ImportType, ProcessingStatus } from "./types";
import { ImportTypeSelector } from "./components/ImportTypeSelector";
import { TranslationPreview } from "./components/TranslationPreview";
import { BibleDownloadForm } from "./components/BibleDownloadForm";
import { ExtendedMetadata } from "../../../../src/utils/ebible/ebibleCorpusUtils";

const initialWorkflowState: WorkflowState = {
    step: "type-select",
    importType: null,
    selectedFile: null,
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
            // Don't allow navigation during processing
            if (workflow.step === "processing") {
                return;
            }

            switch (step) {
                case "type-select":
                    setWorkflow((prev) => ({
                        ...prev,
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
        setWorkflow((prev) => ({
            ...prev,
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
            }));
        },
        [setWorkflow, vscode]
    );

    const handleBibleDownload = useCallback(
        (metadata: ExtendedMetadata) => {
            setWorkflow((prev) => ({
                ...prev,
                step: "processing",
                bibleDownload: {
                    language: metadata.languageCode,
                    status: "downloading",
                },
            }));

            vscode.postMessage({
                command: "downloadBible",
                ebibleMetadata: metadata, // Pass the full metadata
            });
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

    const renderPreview = () => {
        if (!workflow.preview) return null;

        if (workflow.preview.type === "translation") {
            return (
                <TranslationPreview
                    preview={workflow.preview}
                    onConfirm={() => handlePreviewConfirm("translation")}
                    onCancel={handlePreviewCancel}
                />
            );
        }

        return (
            <SourcePreview
                preview={workflow.preview}
                onConfirm={() => handlePreviewConfirm("source")}
                onCancel={handlePreviewCancel}
            />
        );
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
                // Handle other import types...
                break;

            case "preview":
                return renderPreview();

            case "processing":
                return (
                    <div style={{ padding: "2rem" }}>
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
                            Your source file has been successfully imported.
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
                    {/* <div style={{ 
                        display: "flex", 
                        justifyContent: "space-between", 
                        alignItems: "center" 
                    }}>
                        {workflow.step !== "type-select" && (
                            <VSCodeButton 
                                appearance="secondary" 
                                onClick={handleBack}
                            >
                                <i className="codicon codicon-arrow-left" style={{ marginRight: "0.5rem" }} />
                                Back
                            </VSCodeButton>
                        )}
                    </div> */}

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
