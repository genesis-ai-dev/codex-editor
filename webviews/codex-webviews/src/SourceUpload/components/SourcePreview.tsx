import React from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { SourcePreview as ISourcePreview } from "../../../../../types";
import { formatFileSize } from "../../../../../src/utils/formatters";

interface SourcePreviewProps {
    preview: ISourcePreview;
    onConfirm?: () => void;
    onCancel?: () => void;
    hideActions?: boolean;
}

export const SourcePreview: React.FC<SourcePreviewProps> = ({
    preview,
    onConfirm,
    onCancel,
    hideActions,
}) => {
    if (!preview?.original) {
        return <div>No preview available</div>;
    }

    return (
        <div>
            <h3>Source File Preview</h3>
            {preview.fileSize && (
                <div style={{ marginBottom: "1rem", color: "var(--vscode-descriptionForeground)" }}>
                    File size: {formatFileSize(preview.fileSize)}
                </div>
            )}
            <VSCodePanels>
                <VSCodePanelView id="view-1">
                    <div
                        style={{
                            padding: "1rem",
                            background: "var(--vscode-editor-background)",
                            borderRadius: "4px",
                            marginBottom: "1rem",
                        }}
                    >
                        <pre
                            style={{
                                whiteSpace: "pre-wrap",
                                fontFamily: "var(--vscode-editor-font-family)",
                                fontSize: "0.9em",
                                margin: 0,
                            }}
                        >
                            {preview.original.preview}
                        </pre>
                    </div>

                    {preview.original.validationResults.map((result, index) => (
                        <ValidationResult key={index} result={result} />
                    ))}
                </VSCodePanelView>
            </VSCodePanels>

            {!hideActions && (
                <div style={{ marginTop: "1rem", display: "flex", gap: "0.5rem" }}>
                    <VSCodeButton onClick={onConfirm}>Import</VSCodeButton>
                    <VSCodeButton onClick={onCancel}>Cancel</VSCodeButton>
                </div>
            )}
        </div>
    );
};

const ValidationResult: React.FC<{
    result: { isValid: boolean; errors: Array<{ message: string }> };
}> = ({ result }) => (
    <div
        style={{
            padding: "1rem",
            borderRadius: "4px",
            background: result.isValid
                ? "var(--vscode-testing-iconPassed)15"
                : "var(--vscode-inputValidation-errorBackground)",
            border: `1px solid ${
                result.isValid
                    ? "var(--vscode-testing-pass)"
                    : "var(--vscode-inputValidation-errorBorder)"
            }`,
        }}
    >
        {!result.isValid && (
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.5rem",
                }}
            >
                {result.errors.map((error, i) => (
                    <div
                        key={i}
                        style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            color: "var(--vscode-inputValidation-errorForeground)",
                        }}
                    >
                        <i className="codicon codicon-error" />
                        {error.message}
                    </div>
                ))}
            </div>
        )}
    </div>
);

const NotebookPreview: React.FC<{
    notebook: {
        name: string;
        cells: Array<{
            value?: string;
            metadata: {
                id: string;
                type: string;
            };
        }>;
    };
    type: "source" | "target";
}> = ({ notebook, type }) => (
    <div
        style={{
            padding: "1rem",
            background: "var(--vscode-editor-background)",
            borderRadius: "4px",
            marginBottom: "1rem",
        }}
    >
        <h5 style={{ marginBottom: "1rem" }}>{notebook.name}</h5>
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "0.5rem",
                maxHeight: "200px",
                overflow: "auto",
            }}
        >
            {notebook.cells.slice(0, 5).map((cell, index) => (
                <div
                    key={index}
                    style={{
                        padding: "0.5rem",
                        background: "var(--vscode-input-background)",
                        borderRadius: "2px",
                        fontSize: "0.9em",
                    }}
                >
                    <div style={{ color: "var(--vscode-descriptionForeground)" }}>
                        {cell.metadata.id} ({cell.metadata.type})
                    </div>
                    {type === "source" && cell.value && (
                        <pre style={{ margin: "0.5rem 0 0 0" }}>{cell.value}</pre>
                    )}
                </div>
            ))}
            {notebook.cells.length > 5 && (
                <div style={{ textAlign: "center", padding: "0.5rem" }}>
                    ... {notebook.cells.length - 5} more cells
                </div>
            )}
        </div>
    </div>
);
