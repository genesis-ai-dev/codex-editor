import React from "react";
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { BiblePreviewData } from "../../../../../types";

interface BiblePreviewProps {
    preview: BiblePreviewData;
    onConfirm: () => void;
    onCancel: () => void;
}

export const BiblePreview: React.FC<BiblePreviewProps> = ({ preview, onConfirm, onCancel }) => {
    const notebook = preview.transformed.sourceNotebooks[0];
    const metadata = notebook.metadata;

    return (
        <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
            <h2>Preview Downloaded Bible Content</h2>

            <VSCodePanels>
                <VSCodePanelTab id="tab-1">Original Content</VSCodePanelTab>
                <VSCodePanelTab id="tab-2">Transformed Content</VSCodePanelTab>

                <VSCodePanelView id="view-1">
                    <div className="preview-section">
                        <h3>Sample Verses</h3>
                        <pre
                            className="preview-content"
                            style={{
                                whiteSpace: "pre-wrap",
                                fontFamily: "var(--vscode-editor-font-family)",
                                fontSize: "0.9em",
                                padding: "1rem",
                                background: "var(--vscode-editor-background)",
                                borderRadius: "4px",
                            }}
                        >
                            {preview.original.preview}
                        </pre>
                    </div>

                    {preview.original.validationResults.map((result, index) => (
                        <ValidationResult key={index} result={result} />
                    ))}
                </VSCodePanelView>

                <VSCodePanelView id="view-2">
                    <div className="preview-section">
                        <h3>Details</h3>
                        <ul style={{ marginBottom: "1rem" }}>
                            <li>Translation ID: {metadata.id}</li>
                            <li>Language: {metadata.originalName}</li>
                            <li>Total Cells: {notebook.cells.length}</li>
                        </ul>

                        <h4>Sample Transformed Content</h4>
                        <div
                            style={{
                                maxHeight: "300px",
                                overflow: "auto",
                                border: "1px solid var(--vscode-widget-border)",
                                borderRadius: "4px",
                            }}
                        >
                            {notebook.cells.map((cell, index) => (
                                <div
                                    key={index}
                                    style={{
                                        padding: "0.5rem",
                                        borderBottom: "1px solid var(--vscode-widget-border)",
                                    }}
                                >
                                    <div
                                        style={{
                                            color: "var(--vscode-descriptionForeground)",
                                            fontSize: "0.8em",
                                        }}
                                    >
                                        {cell.metadata.type} - {cell.metadata.id}
                                    </div>
                                    <div>{cell.value}</div>
                                </div>
                            ))}
                        </div>

                        {preview.transformed.validationResults.map((result, index) => (
                            <ValidationResult key={index} result={result} />
                        ))}
                    </div>
                </VSCodePanelView>
            </VSCodePanels>

            <div
                style={{
                    display: "flex",
                    gap: "1rem",
                    justifyContent: "flex-end",
                    marginTop: "1rem",
                    paddingTop: "1rem",
                    borderTop: "1px solid var(--vscode-widget-border)",
                }}
            >
                <VSCodeButton appearance="secondary" onClick={onCancel}>
                    Cancel
                </VSCodeButton>
                <VSCodeButton onClick={onConfirm}>Confirm Download</VSCodeButton>
            </div>
        </div>
    );
};

interface ValidationResultProps {
    result: {
        isValid: boolean;
        errors: Array<{ message: string }>;
    };
}

const ValidationResult: React.FC<ValidationResultProps> = ({ result }) => {
    if (result.isValid) {
        return (
            <div
                style={{
                    padding: "0.5rem 1rem",
                    marginTop: "1rem",
                    background: "var(--vscode-testing-iconPassed)15",
                    border: "1px solid var(--vscode-testing-iconPassed)",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                }}
            >
                <i className="codicon codicon-check" />
                <span>Content validation passed</span>
            </div>
        );
    }

    return (
        <div
            style={{
                padding: "0.5rem 1rem",
                marginTop: "1rem",
                background: "var(--vscode-inputValidation-errorBackground)",
                border: "1px solid var(--vscode-inputValidation-errorBorder)",
                borderRadius: "4px",
            }}
        >
            {result.errors.map((error, index) => (
                <div
                    key={index}
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        color: "var(--vscode-inputValidation-errorForeground)",
                    }}
                >
                    <i className="codicon codicon-error" />
                    <span>{error.message}</span>
                </div>
            ))}
        </div>
    );
};
