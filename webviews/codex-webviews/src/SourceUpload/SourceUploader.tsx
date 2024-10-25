import React, { useState, useCallback } from "react";
import { VSCodePanels, VSCodePanelTab, VSCodePanelView, VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { SourceUploadPostMessages } from "../../../../types";
import { FileDropzone } from "./components/FileDropzone";
import { WorkflowProgress } from "./components/WorkflowProgress";
import { SourcePreview } from "./components/SourcePreview";
import { ProcessingStages } from "./components/ProcessingStages";
import { ProgressDisplay } from "./components/ProgressDisplay";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { WorkflowState, WorkflowStep } from "./types";

const initialWorkflowState: WorkflowState = {
    step: "select",
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
                    vscode.postMessage({
                        command: "uploadSourceText",
                        fileContent: e.target?.result?.toString() || "",
                        fileName: file.name,
                    } as SourceUploadPostMessages);
                };
                reader.readAsText(file);
            }
        },
        [setWorkflow, vscode]
    );

    const handleClearFile = useCallback(() => {
        setWorkflow((prev) => ({
            ...prev,
            selectedFile: null,
            step: "select",
        }));
    }, []);

    const handlePreviewConfirm = useCallback(() => {
        vscode.postMessage({
            command: "confirmSourceImport",
        } as SourceUploadPostMessages);
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
            if (step === "select") {
                handleClearFile();
            } else if (step === "preview" && workflow.preview) {
                setWorkflow((prev) => ({
                    ...prev,
                    step: "preview",
                }));
            }
        },
        [workflow.preview, handleClearFile]
    );

    const handleUploadAnother = useCallback(() => {
        setWorkflow((prev) => ({
            ...initialWorkflowState,
        }));
    }, []);

    const renderWorkflowStep = () => {
        switch (workflow.step) {
            case "select":
                return (
                    <div style={{ padding: "2rem" }}>
                        <h2 style={{ marginBottom: "1rem" }}>Select Your Source Text</h2>
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFile={workflow.selectedFile}
                            onClearFile={handleClearFile}
                        />
                    </div>
                );

            case "preview":
                return workflow.preview ? (
                    <SourcePreview
                        preview={workflow.preview}
                        onConfirm={handlePreviewConfirm}
                        onCancel={handlePreviewCancel}
                    />
                ) : null;

            case "processing":
                return (
                    <div style={{ padding: "2rem" }}>
                        <ProcessingStages stages={workflow.processingStages} />
                        {workflow.progress && (
                            <ProgressDisplay
                                progress={workflow.progress}
                                stages={workflow.processingStages}
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
                        <p style={{ marginBottom: "2rem" }}>Your source file has been successfully imported.</p>
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
                        maxWidth: "800px",
                        margin: "0 auto",
                        padding: "2rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2rem",
                    }}
                >
                    <WorkflowProgress
                        currentStep={workflow.step}
                        steps={["select", "preview", "processing", "complete"]}
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
