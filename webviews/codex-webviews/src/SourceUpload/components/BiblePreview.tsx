import React from "react";
import {
    VSCodeButton,
    VSCodeDivider,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { BiblePreviewData } from "../../../../../types";
import ValidationResult from "./ValidationResult";
import { formatFileSize } from "../../../../../src/utils/formatters";

interface BiblePreviewProps {
    preview: {
        type: "bible";
        original: {
            preview: string;
            validationResults: any[];
        };
        transformed: {
            sourceNotebooks: Array<{
                name: string;
                cells: Array<{
                    value: string;
                    metadata: { id: string; type: string };
                }>;
                metadata: any;
            }>;
            validationResults: any[];
        };
    };
    onConfirm: () => void;
    onCancel: () => void;
}

export const BiblePreview: React.FC<BiblePreviewProps> = ({ preview, onConfirm, onCancel }) => {
    const notebook = preview.transformed.sourceNotebooks[0];
    const metadata = notebook.metadata;

    return (
        <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
            <h2>Preview Bible Content</h2>

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

                        {preview.original.validationResults.map((result, index) => (
                            <ValidationResult key={index} result={result} />
                        ))}
                    </div>
                </VSCodePanelView>

                <VSCodePanelView id="view-2">
                    <div className="preview-section">
                        <h3>Bible Details</h3>
                        <ul style={{ marginBottom: "1rem" }}>
                            <li>Translation ID: {metadata.id}</li>
                            <li>Language: {metadata.originalName}</li>
                            <li>Total Books: {preview.transformed.sourceNotebooks.length}</li>
                            <li>Total Verses: {notebook.cells.length}</li>
                            <li>Content Size: {formatFileSize(preview.original.preview.length)}</li>
                            {metadata.format && <li>Format: {metadata.format}</li>}
                            {metadata.license && <li>License: {metadata.license}</li>}
                        </ul>

                        <h4>Sample Content</h4>
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
                                        {cell.metadata.id}
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
