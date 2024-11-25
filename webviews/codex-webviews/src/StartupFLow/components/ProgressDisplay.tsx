import React from "react";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { ImportType } from "../types";

interface ProgressDisplayProps {
    progress?: {
        message: string;
        increment: number;
    };
    importType: ImportType;
    stages: {
        [key: string]: {
            label: string;
            description: string;
            status: "pending" | "active" | "complete" | "error";
        };
    };
}

export const ProgressDisplay: React.FC<ProgressDisplayProps> = ({ progress, stages, importType }) => {
    const getImportTypeLabel = (type: ImportType) => {
        switch (type) {
            case "source":
                return "Source Text Import";
            case "translation":
                return "Translation Import";
            case "bible-download":
                return "Bible Download";
            default:
                return "Import";
        }
    };

    const activeStage = Object.entries(stages).find(([_, stage]) => stage.status === "active");

    if (!activeStage) return null;

    const [stageKey, stage] = activeStage;

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                padding: "1rem",
                background: "var(--vscode-editor-background)",
                borderRadius: "4px",
            }}
        >
            <div style={{ marginBottom: "1rem" }}>
                <span style={{ 
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: "0.9em" 
                }}>
                    {getImportTypeLabel(importType)}
                </span>
            </div>

            <div
                style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "1rem",
                }}
            >
                <VSCodeProgressRing />
                <div>
                    <div style={{ fontWeight: "500" }}>{stage.label}</div>
                    <div
                        style={{
                            color: "var(--vscode-descriptionForeground)",
                            fontSize: "0.9em",
                        }}
                    >
                        {stage.description}
                    </div>
                </div>
            </div>

            {progress && (
                <div>
                    <div style={{ marginBottom: "0.5rem" }}>{progress.message}</div>
                    <div
                        style={{
                            height: "4px",
                            background: "var(--vscode-progressBar-background)",
                            borderRadius: "2px",
                            overflow: "hidden",
                        }}
                    >
                        <div
                            style={{
                                height: "100%",
                                width: `${progress.increment}%`,
                                background: "var(--vscode-progressBar-foreground)",
                                transition: "width 0.3s ease",
                            }}
                        />
                    </div>
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                    marginTop: "0.5rem",
                }}
            >
                {Object.entries(stages).map(([key, stageInfo]) => (
                    <div
                        key={key}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            opacity: stageInfo.status === "pending" ? 0.5 : 1,
                        }}
                    >
                        {stageInfo.status === "complete" && (
                            <i
                                className="codicon codicon-check"
                                style={{
                                    color: "var(--vscode-testing-iconPassed)",
                                }}
                            />
                        )}
                        {stageInfo.status === "active" && (
                            <i className="codicon codicon-sync codicon-modifier-spin" />
                        )}
                        {stageInfo.status === "error" && (
                            <i
                                className="codicon codicon-error"
                                style={{
                                    color: "var(--vscode-testing-iconFailed)",
                                }}
                            />
                        )}
                        {stageInfo.status === "pending" && (
                            <i className="codicon codicon-circle-outline" />
                        )}
                        <span>{stageInfo.label}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};
