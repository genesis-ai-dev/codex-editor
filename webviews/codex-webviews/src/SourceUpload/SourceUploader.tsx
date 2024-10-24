import React, { useEffect, useState, useCallback } from "react";
import { useDropzone } from "react-dropzone";
import {
    VSCodeButton,
    VSCodeDataGrid,
    VSCodeDataGridRow,
    VSCodeDataGridCell,
    VSCodeDropdown,
    VSCodeOption,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeProgressRing,
} from "@vscode/webview-ui-toolkit/react";
import { SourceUploadPostMessages } from "../../../../types";
import "./App.css";
const vscode = acquireVsCodeApi();

interface AggregatedMetadata {
    id: string;
    originalName: string;
    sourceFsPath?: string;
    codexFsPath?: string;
    videoUrl?: string;
    lastModified?: string;
    gitStatus?:
        | "uninitialized"
        | "modified"
        | "added"
        | "deleted"
        | "renamed"
        | "conflict"
        | "untracked"
        | "committed";
}

// Add new types for workflow state tracking
type WorkflowStep = "select" | "confirm" | "processing" | "complete";

// Add ProcessingStage type
type ProcessingStatus = "pending" | "active" | "complete" | "error";

// Update the workflow state
interface WorkflowState {
    step: WorkflowStep;
    selectedFile: File | null;
    processingStages: Record<
        string,
        {
            label: string;
            description: string;
            status: ProcessingStatus;
        }
    >;
}

const SourceUploader: React.FC = () => {
    const [aggregatedMetadata, setAggregatedMetadata] = useState<AggregatedMetadata[]>([]);
    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isSourceUpload, setIsSourceUpload] = useState<boolean>(true);
    const [selectedSourceFile, setSelectedSourceFile] = useState<string | null>(null);
    const [shouldShowImporter, setShouldShowImporter] = useState<boolean>(false);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [workflow, setWorkflow] = useState<WorkflowState>({
        step: "select",
        selectedFile: null,
        processingStages: {
            fileValidation: {
                label: "Validating File",
                description: "Checking file format and content",
                status: "pending",
            },
            folderCreation: {
                label: "Creating Project Structure",
                description: "Setting up source and target folders",
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
    });

    useEffect(() => {
        vscode.postMessage({ command: "getMetadata" } as SourceUploadPostMessages);

        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateMetadata":
                    setAggregatedMetadata(message.metadata);
                    break;
                case "updateProcessingStatus":
                    if (message.status) {
                        setWorkflow((prev) => ({
                            ...prev,
                            processingStages: Object.entries(message.status).reduce<
                                Record<
                                    string,
                                    { label: string; description: string; status: ProcessingStatus }
                                >
                            >(
                                (acc, [key, status]) => ({
                                    ...acc,
                                    [key]: {
                                        ...prev.processingStages[key],
                                        status: status as ProcessingStatus,
                                    },
                                }),
                                prev.processingStages
                            ),
                        }));
                    }
                    break;
                case "setupComplete":
                    setWorkflow((prev) => ({
                        ...prev,
                        step: "complete",
                    }));
                    break;
                case "error":
                    // Handle error state by updating the active stage to error
                    setWorkflow((prev) => {
                        const activeStage = Object.entries(prev.processingStages).find(
                            ([_, stage]) => stage.status === "active"
                        );
                        if (activeStage) {
                            return {
                                ...prev,
                                processingStages: {
                                    ...prev.processingStages,
                                    [activeStage[0]]: {
                                        ...prev.processingStages[activeStage[0]],
                                        status: "error",
                                    },
                                },
                            };
                        }
                        return prev;
                    });
                    break;
            }
        };

        window.addEventListener("message", messageHandler);

        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    const onDrop = useCallback((acceptedFiles: File[]) => {
        if (acceptedFiles.length > 0) {
            const file = acceptedFiles[0];
            setWorkflow((prev) => ({
                ...prev,
                selectedFile: file,
            }));

            // Create a FileReader to read the file content
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                vscode.postMessage({
                    command: "uploadSourceText",
                    fileContent: content,
                    fileName: file.name,
                } as SourceUploadPostMessages);
            };
            reader.readAsText(file);
        }
    }, []);

    const { getRootProps, getInputProps } = useDropzone({ onDrop });

    const handleUpload = async () => {
        if (selectedFile) {
            const reader = new FileReader();
            reader.onload = (e) => {
                const content = e.target?.result?.toString() || "";
                vscode.postMessage({
                    command: isSourceUpload ? "uploadSourceText" : "uploadTranslation",
                    fileContent: content,
                    fileName: selectedFile.name,
                    sourceFileName: selectedSourceFile,
                } as SourceUploadPostMessages);
            };
            reader.readAsText(selectedFile);
        }
        setShouldShowImporter(false);
    };

    const toggleDisplayImporter = () => {
        setShouldShowImporter(!shouldShowImporter);
    };

    const handleDownloadBible = () => {
        vscode.postMessage({ command: "downloadBible" } as SourceUploadPostMessages);
    };

    const handleImportTranslation = (metadata: AggregatedMetadata) => {
        setIsSourceUpload(false);
        setSelectedSourceFile(metadata.originalName);
    };

    const GetSyncStatus: React.FC<{
        metadata: AggregatedMetadata;
        onClick: (status: string) => void;
    }> = ({ metadata, onClick }) => {
        const status = metadata.gitStatus || "Unknown";
        const iconClass = `codicon codicon-${
            status === "uninitialized"
                ? "repo"
                : status === "modified"
                ? "git-commit"
                : status === "added"
                ? "diff-added"
                : status === "deleted"
                ? "diff-removed"
                : status === "renamed"
                ? "diff-renamed"
                : status === "conflict"
                ? "git-merge"
                : status === "untracked"
                ? "file-add"
                : status === "committed"
                ? "check"
                : "question"
        }`;
        return (
            <i
                className={iconClass}
                onClick={() => onClick(status)}
                aria-label={`Sync status: ${status}`}
            ></i>
        );
    };

    const handleSyncStatusClick = (metadata: AggregatedMetadata) => {
        const fileUri = metadata.sourceFsPath || metadata.codexFsPath;
        if (fileUri) {
            vscode.postMessage({
                command: "syncAction",
                status: metadata.gitStatus,
                fileUri,
            } as SourceUploadPostMessages);
        } else {
            console.error("No file URI available for sync action");
        }
    };

    const getAttachments = (
        metadata: AggregatedMetadata & { audioUrl?: string; imageUrls?: string[] }
    ): JSX.Element => {
        const attachments = [];
        if (metadata.videoUrl)
            attachments.push(
                <i className="codicon codicon-file-media" title="Video" key="video"></i>
            );
        if (metadata.audioUrl)
            attachments.push(
                <i className="codicon codicon-file-media" title="Audio" key="audio"></i>
            );
        if (metadata.imageUrls && metadata.imageUrls.length > 0)
            attachments.push(
                <i className="codicon codicon-file-media" title="Images" key="images"></i>
            );

        return <span>{attachments.length > 0 ? attachments : "None"}</span>;
    };

    const handleOpenFile = (fileUri: string | undefined) => {
        console.log("handleOpenFile", { fileUri });
        if (fileUri) {
            vscode.postMessage({
                command: "openFile",
                fileUri,
            } as SourceUploadPostMessages);
        }
    };

    // Add this inside your component
    const initialProcessingStages = {
        fileValidation: {
            label: "Validating File",
            description: "Checking file format and content",
            status: "pending",
        },
        folderCreation: {
            label: "Creating Project Structure",
            description: "Setting up source and target folders",
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
    };

    // Update the renderWorkflowStep function
    const renderWorkflowStep = () => {
        switch (workflow.step) {
            case "select":
                return (
                    <div className="workflow-step">
                        <h2>Select Your Source Text</h2>
                        <div className="source-selection">
                            <div {...getRootProps()} className="dropzone">
                                <input {...getInputProps()} />
                                <div className="dropzone-content">
                                    <i className="codicon codicon-cloud-upload"></i>
                                    <p>Drag and drop your source text file here</p>
                                    <p className="dropzone-subtitle">or click to select a file</p>
                                </div>
                            </div>
                            {workflow.selectedFile && (
                                <div className="selected-file">
                                    <i className="codicon codicon-file"></i>
                                    <span>{workflow.selectedFile.name}</span>
                                    <VSCodeButton
                                        appearance="secondary"
                                        onClick={() =>
                                            setWorkflow((prev) => ({
                                                ...prev,
                                                selectedFile: null,
                                            }))
                                        }
                                    >
                                        <i className="codicon codicon-close"></i>
                                    </VSCodeButton>
                                </div>
                            )}
                            <div className="workflow-navigation">
                                <VSCodeButton
                                    disabled={!workflow.selectedFile}
                                    onClick={() =>
                                        setWorkflow((prev) => ({ ...prev, step: "confirm" }))
                                    }
                                >
                                    Continue
                                </VSCodeButton>
                            </div>
                        </div>
                    </div>
                );

            case "confirm":
                return (
                    <div className="workflow-step">
                        <h2>Confirm Source File Setup</h2>
                        <div className="confirmation-details">
                            <div className="file-preview">
                                <h3>Selected File</h3>
                                <p>{workflow.selectedFile?.name}</p>
                                <p className="file-size">
                                    Size: {formatFileSize(workflow.selectedFile?.size || 0)}
                                </p>
                            </div>
                            <div className="setup-actions">
                                <p>This will:</p>
                                <ul>
                                    <li>Create a source folder structure</li>
                                    <li>Process the source file into sections</li>
                                    <li>Create corresponding translation notebooks</li>
                                    <li>Set up project metadata</li>
                                </ul>
                            </div>
                            <div className="confirmation-buttons">
                                <VSCodeButton
                                    onClick={() =>
                                        setWorkflow((prev) => ({ ...prev, step: "select" }))
                                    }
                                >
                                    Back
                                </VSCodeButton>
                                <VSCodeButton onClick={handleCreateSourceFolder}>
                                    Start Setup
                                </VSCodeButton>
                            </div>
                        </div>
                    </div>
                );

            case "processing":
                return (
                    <div className="workflow-step">
                        <h2>Setting Up Your Project</h2>
                        <div className="processing-stages">
                            {Object.entries(workflow.processingStages).map(([key, stage]) => (
                                <div key={key} className={`processing-stage ${stage.status}`}>
                                    <div className="stage-header">
                                        <span className="stage-indicator">
                                            {stage.status === "active" && <VSCodeProgressRing />}
                                            {stage.status === "complete" && (
                                                <i className="codicon codicon-check" />
                                            )}
                                            {stage.status === "error" && (
                                                <i className="codicon codicon-error" />
                                            )}
                                        </span>
                                        <h3>{stage.label}</h3>
                                    </div>
                                    <p className="stage-description">{stage.description}</p>
                                </div>
                            ))}
                        </div>
                    </div>
                );

            case "complete":
                return (
                    <div className="workflow-step">
                        <h2>Setup Complete!</h2>
                        <div className="completion-summary">
                            <p>Your source file has been processed and is ready for translation.</p>
                            <div className="completion-actions">
                                <VSCodeButton onClick={handleStartTranslating}>
                                    Start Translating
                                </VSCodeButton>
                                <VSCodeButton onClick={handleOpenSourceFile}>
                                    View Source Text
                                </VSCodeButton>
                            </div>
                        </div>
                    </div>
                );
        }
    };

    // Add helper function for file size formatting
    const formatFileSize = (bytes: number): string => {
        if (bytes === 0) return "0 Bytes";
        const k = 1024;
        const sizes = ["Bytes", "KB", "MB", "GB"];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
    };

    // Add these handlers
    const handleCreateSourceFolder = useCallback(() => {
        if (!workflow.selectedFile) return;

        setWorkflow((prev) => ({
            ...prev,
            step: "processing",
        }));

        // Create a temporary URL for the file
        const fileUrl = URL.createObjectURL(workflow.selectedFile);

        vscode.postMessage({
            command: "createSourceFolder",
            data: {
                sourcePath: fileUrl,
            },
        } as SourceUploadPostMessages);
    }, [workflow.selectedFile]);

    const handleOpenSourceFile = useCallback(() => {
        if (!workflow.selectedFile) return;

        const fileUrl = URL.createObjectURL(workflow.selectedFile);
        vscode.postMessage({
            command: "openFile",
            fileUri: fileUrl,
        } as SourceUploadPostMessages);
    }, [workflow.selectedFile]);

    const handleStartTranslating = useCallback(() => {
        // This will be implemented later - for now just close the panel
        vscode.postMessage({
            command: "closePanel",
        } as SourceUploadPostMessages);
    }, []);

    return (
        <div className="source-uploader">
            <VSCodePanels>
                <VSCodePanelTab id="setup">Project Setup</VSCodePanelTab>
                <VSCodePanelTab id="advanced">Advanced</VSCodePanelTab>

                <VSCodePanelView id="setup-view">
                    <div className="workflow-container">
                        <div className="workflow-progress">
                            {["select", "confirm", "processing", "complete"].map((step, index) => (
                                <div
                                    key={step}
                                    className={`progress-step ${
                                        workflow.step === step
                                            ? "active"
                                            : index <
                                              [
                                                  "select",
                                                  "confirm",
                                                  "processing",
                                                  "complete",
                                              ].indexOf(workflow.step)
                                            ? "complete"
                                            : ""
                                    }`}
                                >
                                    <div className="step-indicator">{index + 1}</div>
                                    <span>{step}</span>
                                </div>
                            ))}
                        </div>
                        {renderWorkflowStep()}
                    </div>
                </VSCodePanelView>

                <VSCodePanelView id="advanced-view">
                    <div style={{ padding: "16px", maxWidth: "1200px", margin: "0 auto" }}>
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                marginBottom: "24px",
                            }}
                        >
                            <h1 style={{ fontSize: "24px", fontWeight: "bold" }}>Source Manager</h1>
                            {shouldShowImporter ? (
                                <div>
                                    <VSCodeButton
                                        onClick={toggleDisplayImporter}
                                        aria-label="Close Importer"
                                    >
                                        <i className="codicon codicon-close"></i>
                                    </VSCodeButton>
                                </div>
                            ) : (
                                <div style={{ display: "flex", gap: "0.2em" }}>
                                    <VSCodeButton
                                        onClick={() => {
                                            setIsSourceUpload(false);
                                            toggleDisplayImporter();
                                        }}
                                        aria-label="Add new translation"
                                    >
                                        <i className="codicon codicon-insert"></i>
                                    </VSCodeButton>
                                    <VSCodeButton
                                        onClick={() => {
                                            setIsSourceUpload(true);
                                            toggleDisplayImporter();
                                        }}
                                        aria-label="Add new source"
                                    >
                                        <i className="codicon codicon-add"></i>
                                    </VSCodeButton>
                                    <VSCodeButton
                                        onClick={handleDownloadBible}
                                        aria-label="Download Bible"
                                    >
                                        <i className="codicon codicon-cloud-download"></i>
                                    </VSCodeButton>
                                </div>
                            )}
                        </div>

                        {shouldShowImporter && (
                            <div
                                style={{
                                    marginBottom: "2rem",
                                    boxShadow: "0 0 10px 0 rgba(0, 0, 0, 0.1)",
                                    padding: "1rem",
                                    borderRadius: "0.5rem",
                                }}
                            >
                                <h2
                                    style={{
                                        fontSize: "18px",
                                        fontWeight: "600",
                                        marginBottom: "8px",
                                    }}
                                >
                                    {isSourceUpload ? "Upload New Source" : "Import Translation"}
                                </h2>
                                <div
                                    {...getRootProps()}
                                    style={{
                                        border: "2px dashed var(--vscode-widget-border)",
                                        borderRadius: "4px",
                                        padding: "32px",
                                        textAlign: "center",
                                        cursor: "pointer",
                                    }}
                                >
                                    <input {...getInputProps()} />
                                    <p style={{ color: "var(--vscode-foreground)" }}>
                                        <i
                                            className="codicon codicon-cloud-upload"
                                            style={{ marginRight: "8px" }}
                                        ></i>
                                        Drag 'n' drop a {isSourceUpload ? "source" : "translation"}{" "}
                                        file here, or click to select
                                    </p>
                                </div>

                                {selectedFile && (
                                    <p style={{ marginTop: "8px", fontSize: "14px" }}>
                                        Selected file: {selectedFile.name}
                                    </p>
                                )}

                                {!isSourceUpload && (
                                    <div style={{ marginTop: "16px" }}>
                                        <label
                                            htmlFor="sourceFile"
                                            style={{
                                                display: "block",
                                                marginBottom: "4px",
                                                fontSize: "14px",
                                            }}
                                        >
                                            Select corresponding source file:
                                        </label>
                                        <VSCodeDropdown
                                            id="sourceFile"
                                            value={selectedSourceFile || ""}
                                            onChange={(e) =>
                                                setSelectedSourceFile(
                                                    (e.target as HTMLSelectElement).value
                                                )
                                            }
                                        >
                                            <VSCodeOption value="">
                                                Select a source file
                                            </VSCodeOption>
                                            {aggregatedMetadata
                                                .filter((metadata) => metadata.sourceFsPath)
                                                .map((metadata) => (
                                                    <VSCodeOption
                                                        key={metadata.id}
                                                        value={metadata.originalName}
                                                    >
                                                        {metadata.originalName}
                                                    </VSCodeOption>
                                                ))}
                                        </VSCodeDropdown>
                                    </div>
                                )}

                                <VSCodeButton
                                    style={{ marginTop: "16px" }}
                                    onClick={handleUpload}
                                    disabled={
                                        !selectedFile || (!isSourceUpload && !selectedSourceFile)
                                    }
                                >
                                    <i
                                        className="codicon codicon-cloud-upload"
                                        style={{ marginRight: "8px" }}
                                    ></i>
                                    Upload {isSourceUpload ? "Source" : "Translation"}
                                </VSCodeButton>
                            </div>
                        )}

                        <div
                            style={{
                                height: "100%",
                                overflow: "auto",
                                marginBottom: "32px",
                                border: "1px solid var(--vscode-widget-border)",
                            }}
                        >
                            <VSCodeDataGrid
                                aria-label="Source and Target Files"
                                style={{ display: "flex", flexDirection: "column" }}
                            >
                                <VSCodeDataGridRow
                                    row-type="header"
                                    style={{ display: "flex", justifyContent: "space-between" }}
                                >
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Name
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Source File
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Target File
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Attachments
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Last Modified
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Sync Status
                                    </VSCodeDataGridCell>
                                    <VSCodeDataGridCell cell-type="columnheader">
                                        Actions
                                    </VSCodeDataGridCell>
                                </VSCodeDataGridRow>
                                {aggregatedMetadata.map((metadata) => (
                                    <VSCodeDataGridRow
                                        key={metadata.id}
                                        style={{ display: "flex", justifyContent: "space-between" }}
                                    >
                                        <VSCodeDataGridCell>
                                            {metadata.originalName}
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            {metadata.sourceFsPath ? (
                                                <VSCodeButton
                                                    appearance="icon"
                                                    onClick={() =>
                                                        handleOpenFile(metadata.sourceFsPath)
                                                    }
                                                >
                                                    <i
                                                        className="codicon codicon-open-preview"
                                                        title="Open Source"
                                                    ></i>
                                                </VSCodeButton>
                                            ) : (
                                                "Missing"
                                            )}
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            {metadata.codexFsPath ? (
                                                <div style={{ display: "flex", gap: "0.2em" }}>
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        onClick={() =>
                                                            handleOpenFile(metadata.codexFsPath)
                                                        }
                                                    >
                                                        <i
                                                            className="codicon codicon-link-external"
                                                            title="Open Codex Draft Notebook"
                                                        ></i>
                                                    </VSCodeButton>
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        onClick={() =>
                                                            handleImportTranslation(metadata)
                                                        }
                                                    >
                                                        <i
                                                            className="codicon codicon-insert"
                                                            title="Import Translations"
                                                        ></i>
                                                    </VSCodeButton>
                                                </div>
                                            ) : (
                                                "Missing"
                                            )}
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            {getAttachments(metadata)}
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            {metadata.lastModified
                                                ? new Date(metadata.lastModified).toLocaleString(
                                                      "en-US",
                                                      {
                                                          year: "numeric",
                                                          month: "numeric",
                                                          day: "numeric",
                                                          hour: "2-digit",
                                                          minute: "2-digit",
                                                          second: "2-digit",
                                                          hour12: false,
                                                      }
                                                  )
                                                : "N/A"}
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            <GetSyncStatus
                                                metadata={metadata}
                                                onClick={() => handleSyncStatusClick(metadata)}
                                            />
                                        </VSCodeDataGridCell>
                                        <VSCodeDataGridCell>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => console.log("Edit", metadata.id)}
                                                aria-label="Edit"
                                            >
                                                <i className="codicon codicon-edit"></i>
                                            </VSCodeButton>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => console.log("Open", metadata.id)}
                                                aria-label="Open"
                                            >
                                                <i className="codicon codicon-go-to-file"></i>
                                            </VSCodeButton>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => handleImportTranslation(metadata)}
                                                aria-label="Import translation"
                                            >
                                                <i className="codicon codicon-import"></i>
                                            </VSCodeButton>
                                        </VSCodeDataGridCell>
                                    </VSCodeDataGridRow>
                                ))}
                            </VSCodeDataGrid>
                        </div>
                    </div>
                </VSCodePanelView>
            </VSCodePanels>
        </div>
    );
};

export default SourceUploader;
