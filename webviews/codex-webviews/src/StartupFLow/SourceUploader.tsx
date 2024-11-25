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
import { AuthenticationStep } from "./components/AuthenticationStep";
import { ProjectPicker } from "./components/ProjectPicker";
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
    step: "auth",
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
    authState: {
        isAuthenticated: false,
        isAuthExtensionInstalled: false,
        isLoading: true,
        error: undefined,
    },
    projectSelection: {
        type: undefined,
        path: undefined,
        repoUrl: undefined,
        error: undefined,
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
const vscode = acquireVsCodeApi();

export const SourceUploader: React.FC = () => {
    const [isWorkspaceOpen, setIsWorkspaceOpen] = React.useState<boolean>(false);
    const { workflowState, setWorkflowState } = useVSCodeMessageHandler(
        vscode,
        isWorkspaceOpen,
        setIsWorkspaceOpen
    );

    const handleClearFile = useCallback(() => {
        setWorkflowState((prev) => ({
            ...prev,
            selectedFile: null,
            step: "select",
        }));
    }, [setWorkflowState]);

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
            setWorkflowState((prev) => ({
                ...prev,
                step: "processing",
            }));
        },
        [setWorkflowState, vscode]
    );

    const handlePreviewCancel = useCallback(() => {
        vscode.postMessage({
            command: "cancelSourceImport",
        } as SourceUploadPostMessages);
        handleClearFile();
    }, [handleClearFile, vscode]);

    const handleStepClick = useCallback(
        (step: WorkflowStep) => {
            if (workflowState.step === "processing") return; // Prevent navigation during processing
            if (step === "complete" && workflowState.step !== "complete") return; // Prevent skipping to complete

            switch (step) {
                case "type-select":
                    setWorkflowState((_prev) => ({
                        ...initialWorkflowState,
                    }));
                    break;
                case "select":
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "select",
                        selectedFile: null,
                    }));
                    break;
                case "preview":
                    if (workflowState.preview) {
                        setWorkflowState((prev) => ({
                            ...prev,
                            step: "preview",
                        }));
                    }
                    break;
            }
        },
        [workflowState.preview, workflowState.step, setWorkflowState]
    );

    const handleUploadAnother = useCallback(() => {
        setWorkflowState((_prev) => ({
            ...initialWorkflowState,
        }));
    }, [setWorkflowState]);

    const handleImportTypeSelect = useCallback(
        (type: ImportType) => {
            if (type === "translation") {
                // Request available source files from extension
                vscode.postMessage({
                    command: "getAvailableCodexFiles",
                } as SourceUploadPostMessages);
            }

            setWorkflowState((prev) => ({
                ...prev,
                importType: type,
                step: "select",
                error: null,
                // Initialize Bible download stages if needed
                processingStages:
                    type === "bible-download" ? getBibleProcessingStages() : prev.processingStages,
            }));
        },
        [setWorkflowState, vscode]
    );

    const handleBibleDownload = useCallback(
        (metadata: ExtendedMetadata, asTranslationOnly: boolean) => {
            setWorkflowState((prev) => ({
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
        [setWorkflowState, vscode]
    );

    const handleCancel = useCallback(() => {
        setWorkflowState((prev) => ({
            ...prev,
            step: "type-select",
            importType: null,
            error: null,
            bibleDownload: undefined,
        }));
    }, [setWorkflowState]);

    const handleFileDrop = useCallback(
        (files: File[]) => {
            setWorkflowState((prev) => ({
                ...prev,
                selectedFiles: files.map((f) => f.name),
                fileObjects: files,
                // Reset associations when new files are dropped
                translationAssociations: [],
            }));
        },
        [setWorkflowState]
    );

    const handleAssociationChange = useCallback(
        (associations: Array<{ file: File; codexId: string }>) => {
            setWorkflowState((prev) => ({
                ...prev,
                translationAssociations: associations,
            }));
        },
        [setWorkflowState]
    );

    const handleContinue = useCallback(async () => {
        if (!workflowState.fileObjects.length) return;

        try {
            const fileReaders = workflowState.fileObjects.map(
                (file) =>
                    new Promise<{ content: string; name: string; sourceId?: string }>(
                        (resolve, reject) => {
                            const reader = new FileReader();
                            reader.onload = (e) => {
                                resolve({
                                    content: e.target?.result?.toString() || "",
                                    name: file.name,
                                    ...(workflowState.importType === "translation"
                                        ? {
                                              sourceId: workflowState.translationAssociations.find(
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

            if (workflowState.importType === "translation") {
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
            setWorkflowState((prev) => ({
                ...prev,
                error: error instanceof Error ? error.message : "Failed to process files",
            }));
        }
    }, [
        workflowState.fileObjects,
        workflowState.importType,
        workflowState.translationAssociations,
        vscode,
    ]);

    const handlePreviewReject = useCallback(
        (previewId: string) => {
            setWorkflowState((prev) => ({
                ...prev,
                previews: prev.previews.map((p) =>
                    p.id === previewId ? { ...p, isRejected: true } : p
                ),
            }));
        },
        [setWorkflowState]
    );

    const handleRemoveFile = useCallback(
        (fileToRemove: File) => {
            setWorkflowState((prev) => ({
                ...prev,
                selectedFiles: prev.selectedFiles.filter((f) => f !== fileToRemove.name),
                fileObjects: prev.fileObjects.filter((f) => f !== fileToRemove),
                translationAssociations: prev.translationAssociations.filter(
                    (a) => a.file !== fileToRemove
                ),
            }));
        },
        [setWorkflowState]
    );

    const handleAuthComplete = useCallback(() => {
        setWorkflowState((prev) => ({
            ...prev,
            step: "project-select",
        }));
    }, [setWorkflowState]);

    const handleProjectSelected = useCallback(() => {
        setWorkflowState((prev) => ({
            ...prev,
            step: "type-select",
        }));
    }, [setWorkflowState]);
    console.log({ workflowState });
    const renderCurrentStep = () => {
        console.log({ workflowState }, workflowState.step);
        switch (workflowState.step) {
            case "auth":
                return (
                    <AuthenticationStep
                        authState={workflowState.authState}
                        onAuthComplete={handleAuthComplete}
                        vscode={vscode}
                    />
                );
            case "project-select":
                return (
                    <ProjectPicker
                        projectSelection={workflowState.projectSelection}
                        onProjectSelected={handleProjectSelected}
                        vscode={vscode}
                    />
                );
            case "type-select":
                return <ImportTypeSelector onSelect={handleImportTypeSelect} />;

            case "select":
                if (workflowState.importType === "bible-download") {
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
                            {workflowState.importType === "source"
                                ? "Select Your Source File"
                                : "Select Translation File"}
                        </h2>
                        {/* {workflowState.importType === "translation" && (
                            <div style={{ marginBottom: "2rem" }}>
                                <label>Codex File:</label>
                                <VSCodeDropdown
                                    style={{ width: "100%", marginTop: "0.5rem" }}
                                    onChange={(e: any) => {
                                        setWorkflowState((prev) => ({
                                            ...prev,
                                            selectedSourceId: e.target.value,
                                            error: null,
                                        }));
                                    }}
                                >
                                    <VSCodeOption value="">Select a Codex file...</VSCodeOption>
                                    {workflowState.availableCodexFiles?.map((file) => (
                                        <VSCodeOption key={file.id} value={file.id}>
                                            {file.name}
                                        </VSCodeOption>
                                    ))}
                                </VSCodeDropdown>
                            </div>
                        )} */}
                        <FileDropzone
                            onDrop={handleFileDrop}
                            selectedFiles={workflowState.fileObjects}
                            onClearFiles={handleClearFile}
                            onRemoveFile={handleRemoveFile}
                            type={workflowState.importType}
                            availableCodexFiles={workflowState.availableCodexFiles}
                            onAssociationChange={handleAssociationChange}
                        />
                        {workflowState.error && (
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
                                {workflowState.error}
                            </div>
                        )}
                        {workflowState.fileObjects.length > 0 && (
                            <VSCodeButton
                                onClick={handleContinue}
                                style={{ marginTop: "1rem" }}
                                disabled={
                                    workflowState.importType === "translation" &&
                                    (workflowState.translationAssociations.length === 0 ||
                                        workflowState.translationAssociations.length <
                                            workflowState.fileObjects.length)
                                }
                            >
                                {workflowState.importType === "translation"
                                    ? `Continue with ${
                                          workflowState.translationAssociations.length
                                      } matched file${
                                          workflowState.translationAssociations.length !== 1
                                              ? "s"
                                              : ""
                                      }`
                                    : "Continue"}
                            </VSCodeButton>
                        )}
                    </div>
                );

            case "preview":
                if (workflowState.importType === "bible-download" && workflowState.preview) {
                    return (
                        <BiblePreview
                            preview={
                                { ...workflowState.preview, type: "bible" } as BiblePreviewData
                            }
                            onConfirm={() => {
                                if (workflowState.currentTransaction) {
                                    vscode.postMessage({
                                        command: "confirmBibleDownload",
                                        transaction: workflowState.currentTransaction,
                                    });
                                }
                            }}
                            onCancel={() => {
                                if (workflowState.currentTransaction) {
                                    vscode.postMessage({
                                        command: "cancelBibleDownload",
                                        transaction: workflowState.currentTransaction,
                                    });
                                }
                            }}
                        />
                    );
                }

                // For source and translation imports, show multiple previews
                return (
                    <MultiPreviewContainer
                        previews={workflowState.previews}
                        onConfirm={() => {
                            vscode.postMessage({
                                command:
                                    workflowState.importType === "translation"
                                        ? "confirmTranslationImport"
                                        : "confirmSourceImport",
                            });
                        }}
                        onCancel={() => {
                            vscode.postMessage({
                                command:
                                    workflowState.importType === "translation"
                                        ? "cancelTranslationImport"
                                        : "cancelSourceImport",
                            });
                        }}
                        onRejectPreview={(id) => {
                            setWorkflowState((prev) => ({
                                ...prev,
                                previews: prev.previews.map((p) =>
                                    p.id === id ? { ...p, isRejected: true } : p
                                ),
                            }));
                        }}
                    />
                );

            // case "processing":
            //     return (
            //         <div style={{ padding: "2rem" }}>
            //             <ProcessingStages
            //                 stages={workflowState.processingStages}
            //                 importType={workflowState.importType || "source"}
            //             />
            //             {workflowState.progress && (
            //                 <ProgressDisplay
            //                     progress={workflowState.progress}
            //                     stages={workflowState.processingStages}
            //                     importType={workflowState.importType || "source"}
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
                            {workflowState.importType === "bible-download"
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
                        setWorkflowState((prev) => {
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
                    setWorkflowState((prev) => ({
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
                    setWorkflowState((prev) => ({
                        ...prev,
                        error: message.error || "Failed to download Bible",
                    }));
                    break;

                case "biblePreview":
                    setWorkflowState((prev) => ({
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
    }, [setWorkflowState]);

    useEffect(() => {
        vscode.postMessage({
            command: "extension.check",
            extensionId: "frontier-rnd.frontier-authentication",
        });
    }, []);

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
                        currentStep={workflowState.step}
                        importType={workflowState.importType || "source"}
                        steps={[
                            ...(workflowState.authState.isAuthExtensionInstalled
                                ? (["auth"] as WorkflowStep[])
                                : ([] as WorkflowStep[])),
                            "project-select",
                            "type-select",
                            "select",
                            "preview",
                            "processing",
                            "complete",
                        ]}
                        onStepClick={handleStepClick}
                    />
                    {workflowState.error && (
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
                            <span>{workflowState.error}</span>
                        </div>
                    )}
                    {renderCurrentStep()}
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
};

export default SourceUploader;
