import { useCallback, useEffect, useState } from "react";
import { SourceUploadResponseMessages } from "../../../../../types";
import { WorkflowState, BibleDownloadStages } from "../types";
import path from "path";

const initialWorkflowState: WorkflowState = {
    step: "auth",
    selectedFiles: [],
    translationAssociations: [],
    fileObjects: [],
    previews: [],
    processingStages: {},
    importType: null,
    authState: {
        isAuthExtensionInstalled: false,
        isLoading: false,
        isAuthenticated: false,
        error: undefined,
    },
    projectSelection: {
        path: undefined,
        error: undefined,
    },
};

const getBibleDownloadStages = (): BibleDownloadStages => ({
    validation: {
        label: "Validation",
        description: "Validating Bible content",
        status: "pending",
    },
    download: {
        label: "Download",
        description: "Downloading Bible text",
        status: "pending",
    },
    splitting: {
        label: "Splitting",
        description: "Splitting into sections",
        status: "pending",
    },
    notebooks: {
        label: "Notebooks",
        description: "Creating notebooks",
        status: "pending",
    },
    metadata: {
        label: "Metadata",
        description: "Updating metadata",
        status: "pending",
    },
    commit: {
        label: "Commit",
        description: "Committing changes",
        status: "pending",
    },
});

export function useVSCodeMessageHandler(vscode: any) {
    const [workflowState, setWorkflowState] = useState<WorkflowState>(initialWorkflowState);

    useEffect(() => {
        // Request auth status when component mounts
        console.log("Requesting initial auth status");
        vscode.postMessage({
            command: "auth.status",
        });
    }, [vscode]);

    const handleMessage = useCallback((event: MessageEvent<SourceUploadResponseMessages>) => {
        const message = event.data;
        console.log("useVSCodeMessageHandler Received message:", message);
        switch (message.command) {
            case "extension.checkResponse":
                setWorkflowState((prev) => ({
                    ...prev,
                    authState: {
                        ...prev.authState,
                        isAuthExtensionInstalled: message.isInstalled,
                    },
                }));
                break;

            case "updateAuthState":
                console.log("useVSCodeMessageHandler Received auth state update:", message);
                setWorkflowState((prev) => {
                    const newState = {
                        ...prev,
                        authState: {
                            ...prev.authState,
                            ...message.authState,
                        },
                    };

                    // Update step based on auth state
                    if (message.authState.isAuthenticated) {
                        newState.step = "project-select";
                    } else if (message.authState.isAuthExtensionInstalled) {
                        newState.step = "auth";
                    }
                    console.log("useVSCodeMessageHandler Updated auth state:", newState);

                    return newState;
                });
                break;

            case "project.response":
                if (message.success) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "type-select",
                        projectSelection: {
                            ...prev.projectSelection,
                            path: message.projectPath,
                            error: undefined,
                        },
                    }));
                } else {
                    setWorkflowState((prev) => ({
                        ...prev,
                        projectSelection: {
                            ...prev.projectSelection,
                            error: message.error,
                        },
                    }));
                }
                break;

            case "bibleDownloadProgress":
                if (message.progress) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "processing",
                        processingStages: Object.entries(message.progress?.status || {}).reduce(
                            (acc, [key, status]) => ({
                                ...acc,
                                [key]: {
                                    ...getBibleDownloadStages()[key as keyof BibleDownloadStages],
                                    status,
                                },
                            }),
                            prev.processingStages
                        ),
                        progress: {
                            message: message.progress.message || "",
                            increment: message.progress.increment || 0,
                        },
                    }));
                }
                break;

            case "bibleDownloadComplete":
                setWorkflowState((prev) => ({
                    ...prev,
                    step: "complete",
                    processingStages: Object.entries(getBibleDownloadStages()).reduce(
                        (acc, [key, stage]) => ({
                            ...acc,
                            [key]: { ...stage, status: "complete" },
                        }),
                        {}
                    ),
                    bibleDownload: {
                        ...prev.bibleDownload!,
                        status: "complete",
                    },
                }));
                break;

            case "availableCodexFiles":
                if (message.files) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        availableCodexFiles: message.files,
                    }));
                }
                break;

            case "sourcePreview":
                if (message.previews) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "preview",
                        previews: message.previews.map((preview) => ({
                            id: preview.id,
                            fileName: preview.fileName,
                            fileSize: preview.fileSize,
                            isValid: true, // Add required isValid property
                            preview: preview.preview,
                        })),
                    }));
                }
                break;

            case "translationPreview":
                if (message.previews) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "preview",
                        previews: message.previews.map((preview) => ({
                            id: preview.id,
                            fileName: preview.fileName,
                            fileSize: preview.fileSize,
                            isValid: true,
                            preview: {
                                ...preview.preview,
                                type: "translation",
                            },
                            ...(message.command === "translationPreview"
                                ? { sourceId: preview.id }
                                : {}),
                        })),
                    }));
                }
                break;

            case "bibleDownloadError":
                if (message.error) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        error: message.error,
                        bibleDownload: {
                            ...prev.bibleDownload!,
                            status: "error",
                        },
                    }));
                }
                break;

            case "updateProcessingStatus":
                if (message.status) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "processing",
                        processingStages: Object.entries(message.status || {}).reduce(
                            (acc, [key, status]) => ({
                                ...acc,
                                [key]: {
                                    ...prev.processingStages[key],
                                    status,
                                },
                            }),
                            prev.processingStages
                        ),
                    }));
                }
                break;

            case "importComplete":
                setWorkflowState((prev) => ({
                    ...prev,
                    step: "complete",
                }));
                break;

            case "error":
                if (message) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        error: message.message,
                    }));
                }
                break;

            case "biblePreview":
                if (message.preview) {
                    setWorkflowState((prev) => ({
                        ...prev,
                        step: "preview",
                        preview: message.preview,
                        currentTransaction: message.transaction,
                    }));
                }
                break;
        }
    }, []);

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    return {
        workflowState,
        setWorkflowState,
    };
}
