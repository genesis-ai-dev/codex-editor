import React from "react";
import { VSCodeProgressRing, VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { ImportType, ProcessingStatus, WorkflowStep } from "../types";
import { BibleDownloadStages } from "../types";

interface ProcessingStagesProps {
    stages: Record<
        string,
        {
            label: string;
            description: string;
            status: ProcessingStatus;
        }
    >;
    importType: ImportType;
    progress?: {
        message: string;
        increment: number;
    };
    step: WorkflowStep;
    error?: string;
    onRetry?: () => void;
}

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

export const ProcessingStages: React.FC<ProcessingStagesProps> = ({ stages, importType, progress, step, error, onRetry }) => {
    const currentStages = React.useMemo(() => {
        if (importType === "bible-download") {
            // Start with Bible download stages
            const bibleStages = getBibleDownloadStages();
            // Merge with any active stages from props
            return Object.entries(stages).reduce(
                (acc, [key, stage]) => ({
                    ...acc,
                    [key]: {
                        ...bibleStages[key as keyof BibleDownloadStages],
                        status: stage.status,
                    },
                }),
                bibleStages
            );
        }
        return stages;
    }, [stages, importType]);

    const title = {
        heading: step === "preview-download" ? "Downloading Preview Content" : "Downloading Bible",
        subheading: step === "preview-download" ? undefined : "Downloading and processing Bible content"
    };

    // If there's an error during preview-download, show error state instead of progress
    if (step === "preview-download" && error) {
        return (
            <div style={{ marginBottom: "2rem" }}>
                <h2 style={{ marginBottom: "0.5rem" }}>{title.heading}</h2>
                <div style={{
                    padding: "1rem",
                    marginTop: "1rem",
                    backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                    border: "1px solid var(--vscode-inputValidation-errorBorder)",
                    color: "var(--vscode-inputValidation-errorForeground)",
                    borderRadius: "4px",
                }}>
                    <div style={{ marginBottom: "1rem" }}>{error}</div>
                    <VSCodeButton onClick={onRetry}>
                        Go Back and Try Another Translation
                    </VSCodeButton>
                </div>
            </div>
        );
    }

    return (
        <div style={{ marginBottom: "2rem" }}>
            <h2 style={{ marginBottom: "0.5rem" }}>{title.heading}</h2>
            {title.subheading && (
                <p style={{ marginBottom: "1rem", opacity: 0.8 }}>{title.subheading}</p>
            )}
            
            {/* Progress bar */}
            {progress && (
                <div style={{ marginBottom: "1.5rem" }}>
                    <div style={{
                        position: "relative",
                        width: "100%",
                        height: "4px",
                        backgroundColor: "var(--vscode-progressBar-background)",
                        borderRadius: "2px"
                    }}>
                        <div style={{
                            position: "absolute",
                            left: 0,
                            top: 0,
                            width: `${progress.increment}%`,
                            height: "100%",
                            backgroundColor: "var(--vscode-progressBar-foreground)",
                            borderRadius: "2px",
                            transition: "width 0.3s ease-in-out"
                        }} />
                    </div>
                    <div style={{ 
                        fontSize: "0.9em",
                        marginTop: "0.5rem",
                        opacity: 0.8 
                    }}>
                        {progress.message}
                    </div>
                </div>
            )}

            {/* Stages list - only show if not in preview-download step */}
            {step !== "preview-download" && (
                <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
                    {Object.entries(currentStages).map(([key, stage]) => (
                        <div
                            key={key}
                            style={{
                                display: "flex",
                                alignItems: "flex-start",
                                gap: "0.75rem",
                                opacity: stage.status === "pending" ? 0.5 : 1,
                            }}
                        >
                            <div style={{ 
                                width: "20px",
                                height: "20px",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                                marginTop: "2px"
                            }}>
                                {stage.status === "complete" ? (
                                    <i 
                                        className="codicon codicon-check"
                                        style={{ 
                                            color: "var(--vscode-testing-iconPassed)",
                                            fontSize: "16px"
                                        }}
                                    />
                                ) : stage.status === "active" ? (
                                    <VSCodeProgressRing style={{ width: "16px", height: "16px" }} />
                                ) : (
                                    <span
                                        style={{
                                            width: "8px",
                                            height: "8px",
                                            borderRadius: "50%",
                                            backgroundColor: "var(--vscode-foreground)",
                                            opacity: 0.5
                                        }}
                                    />
                                )}
                            </div>
                            <div>
                                <div style={{ 
                                    fontWeight: stage.status === "active" ? "600" : "normal",
                                    color: "var(--vscode-foreground)"
                                }}>
                                    {stage.label}
                                </div>
                                {stage.description && (
                                    <div style={{ 
                                        fontSize: "0.9em",
                                        opacity: 0.8,
                                        marginTop: "0.25rem" 
                                    }}>
                                        {stage.description}
                                    </div>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
