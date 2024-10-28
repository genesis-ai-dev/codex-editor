import React, { useState, useCallback } from "react";
import {
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import { SourceUploadPostMessages } from "../../../../types";
import { FileDropzone } from "./components/FileDropzone";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { SourcePreview } from "./components/SourcePreview";
import { ProcessingStages } from "./components/ProcessingStages";
import { ProgressDisplay } from "./components/ProgressDisplay";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { WorkflowState, WorkflowStep, ImportType } from "./types";
import { ImportTypeSelector } from "./components/ImportTypeSelector";
import { TranslationPreview } from "./components/TranslationPreview";
import { PreviewContent } from "../../../../types";

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

const getInitialProcessingStages = (importType: ImportType) => ({
    fileValidation: {
        label: "Validating File",
        description:
            importType === "source"
                ? "Checking source file format and content"
                : "Validating translation file",
        status: "pending",
    },
    transformation: {
        label: "Transforming Content",
        description:
            importType === "source"
                ? "Converting to notebook format"
                : "Processing translation content",
        status: "pending",
    },
    ...(importType === "source"
        ? {
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
          }
        : {
              alignment: {
                  label: "Aligning Content",
                  description: "Matching translations with source text",
                  status: "pending",
              },
              merging: {
                  label: "Merging Translations",
                  description: "Updating translation notebook",
                  status: "pending",
              },
          }),
    metadataSetup: {
        label: "Finalizing Setup",
        description: "Setting up project metadata",
        status: "pending",
    },
});

export const SourceUploader: React.FC = () => {
    const { vscode, workflow, setWorkflow } = useVSCodeMessageHandler();

    const handleFileDrop = useCallback(
        (files: File[]) => {
            if (files.length > 0) {
                const file = files[0];
                setWorkflow((prev) => ({
                    ...prev,
                    selectedFile: file,
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

    const handleClearFile = useCallback(() => {
        setWorkflow((prev) => ({
            ...prev,
            selectedFile: null,
            step: "select",
        }));
    }, []);

    const handlePreviewConfirm = useCallback((type: "source" | "translation") => {
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
    }, []);

    const handlePreviewCancel = useCallback(() => {
        vscode.postMessage({
            command: "cancelSourceImport",
        } as SourceUploadPostMessages);
        handleClearFile();
    }, [handleClearFile]);

    const handleStepClick = useCallback(
        (step: WorkflowStep) => {
            // Don't allow navigation during processing
            if (workflow.step === "processing") {
                return;
            }

            switch (step) {
                case "type-select":
                    setWorkflow((prev) => ({
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
        [workflow.preview, workflow.step]
    );

    const handleBack = useCallback(() => {
        setWorkflow((prev) => {
            const currentStepIndex = [
                "type-select",
                "select",
                "preview",
                "processing",
                "complete",
            ].indexOf(prev.step);
            if (currentStepIndex <= 0) {
                return prev;
            }

            const previousStep = ["type-select", "select", "preview", "processing", "complete"][
                currentStepIndex - 1
            ] as WorkflowStep;

            switch (previousStep) {
                case "type-select":
                    return {
                        ...initialWorkflowState,
                    };
                case "select":
                    return {
                        ...prev,
                        step: "select",
                        selectedFile: null,
                    };
                case "preview":
                    return prev.preview
                        ? {
                              ...prev,
                              step: "preview",
                          }
                        : prev;
                default:
                    return prev;
            }
        });
    }, []);

    const handleUploadAnother = useCallback(() => {
        setWorkflow((prev) => ({
            ...initialWorkflowState,
        }));
    }, []);

    const handleImportTypeSelect = useCallback(
        (type: ImportType) => {
            if (type === "translation") {
                // Request available source files from extension
                vscode.postMessage({
                    command: "getAvailableSourceFiles",
                } as SourceUploadPostMessages);
            }

            setWorkflow((prev) => ({
                ...prev,
                importType: type,
                step: "select",
            }));
        },
        [vscode]
    );

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
                return (
                    <div style={{ padding: "2rem" }}>
                        <h2 style={{ marginBottom: "1rem" }}>
                            {workflow.importType === "source"
                                ? "Select Your Source Text"
                                : "Select Translation File"}
                        </h2>
                        {workflow.importType === "translation" && (
                            <div style={{ marginBottom: "2rem" }}>
                                <label>Source Text:</label>
                                <VSCodeDropdown
                                    style={{ width: "100%", marginTop: "0.5rem" }}
                                    onChange={(e: any) => {
                                        setWorkflow((prev) => ({
                                            ...prev,
                                            selectedSourceId: e.target.value,
                                            error: null, // Clear any previous errors
                                        }));
                                    }}
                                >
                                    <VSCodeOption value="">Select a source text...</VSCodeOption>
                                    {workflow.availableSourceFiles?.map((file) => (
                                        <VSCodeOption key={file.id} value={file.id}>
                                            {file.name}
                                        </VSCodeOption>
                                    ))}
                                </VSCodeDropdown>
                            </div>
                        )}
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFile={workflow.selectedFile}
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
