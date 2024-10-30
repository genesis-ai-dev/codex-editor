import React from "react";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { ImportType, ProcessingStatus } from "../../../../../types";
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

export const ProcessingStages: React.FC<ProcessingStagesProps> = ({ stages, importType }) => {
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

    const getImportTypeTitle = () => {
        switch (importType) {
            case "source":
                return "Processing Source Text";
            case "translation":
                return "Processing Translation";
            case "bible-download":
                return "Downloading Bible";
            default:
                return "Processing";
        }
    };

    const getImportTypeDescription = () => {
        switch (importType) {
            case "source":
                return "Creating source notebooks and preparing translation templates";
            case "translation":
                return "Processing translation file and linking with source text";
            case "bible-download":
                return "Downloading and processing Bible content";
            default:
                return "Processing content";
        }
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                padding: "1rem",
            }}
        >
            <div style={{ marginBottom: "1rem" }}>
                <h3>{getImportTypeTitle()}</h3>
                <p
                    style={{
                        color: "var(--vscode-descriptionForeground)",
                        fontSize: "0.9em",
                        marginTop: "0.5rem",
                    }}
                >
                    {getImportTypeDescription()}
                </p>
            </div>

            {Object.entries(currentStages).map(([key, stage]) => (
                <div
                    key={key}
                    style={{
                        display: "flex",
                        alignItems: "flex-start",
                        gap: "1rem",
                        padding: "1rem",
                        background: "var(--vscode-editor-background)",
                        borderRadius: "4px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            minWidth: "24px",
                            justifyContent: "center",
                        }}
                    >
                        {stage.status === "active" && <VSCodeProgressRing />}
                        {stage.status === "complete" && (
                            <i
                                className="codicon codicon-check"
                                style={{ color: "var(--vscode-testing-iconPassed)" }}
                            />
                        )}
                        {stage.status === "error" && (
                            <i
                                className="codicon codicon-error"
                                style={{ color: "var(--vscode-testing-iconFailed)" }}
                            />
                        )}
                        {stage.status === "pending" && (
                            <i
                                className="codicon codicon-circle-outline"
                                style={{ color: "var(--vscode-descriptionForeground)" }}
                            />
                        )}
                    </div>
                    <div style={{ flex: 1 }}>
                        <h3 style={{ marginBottom: "0.5rem" }}>{stage.label}</h3>
                        <p style={{ color: "var(--vscode-descriptionForeground)" }}>
                            {stage.description}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
};
