import React from "react";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import { ProcessingStatus } from "../types";

interface ProcessingStagesProps {
    stages: Record<
        string,
        {
            label: string;
            description: string;
            status: ProcessingStatus;
        }
    >;
}

export const ProcessingStages: React.FC<ProcessingStagesProps> = ({ stages }) => {
    return (
        <div style={{
            display: "flex",
            flexDirection: "column",
            gap: "1rem",
            padding: "1rem"
        }}>
            {Object.entries(stages).map(([key, stage]) => (
                <div key={key} style={{
                    display: "flex",
                    alignItems: "flex-start",
                    gap: "1rem",
                    padding: "1rem",
                    background: "var(--vscode-editor-background)",
                    borderRadius: "4px"
                }}>
                    <div style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem"
                    }}>
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
