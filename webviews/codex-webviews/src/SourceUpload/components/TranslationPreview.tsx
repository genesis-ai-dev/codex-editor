import React from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { TranslationPreview as ITranslationPreview } from "../../../../../types";

interface TranslationPreviewProps {
    preview: ITranslationPreview;
    onConfirm: () => void;
    onCancel: () => void;
}

export const TranslationPreview: React.FC<TranslationPreviewProps> = ({
    preview,
    onConfirm,
    onCancel,
}) => {
    return (
        <div style={{ padding: "2rem", maxWidth: "800px", margin: "0 auto" }}>
            <h3>Translation Preview</h3>

            <VSCodePanels>
                <VSCodePanelTab id="tab-1">Original Content</VSCodePanelTab>
                <VSCodePanelTab id="tab-2">Alignment Preview</VSCodePanelTab>

                <VSCodePanelView id="view-1">
                    <div style={{ padding: "1rem", background: "var(--vscode-editor-background)" }}>
                        <pre>{preview.original.preview}</pre>
                    </div>
                </VSCodePanelView>

                <VSCodePanelView id="view-2">
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                        <div className="statistics">
                            <h4>Alignment Statistics</h4>
                            <ul>
                                <li>Matched Cells: {preview.transformed.matchedCells}</li>
                                <li>Unmatched Content: {preview.transformed.unmatchedContent}</li>
                                <li>Paratext Items: {preview.transformed.paratextItems}</li>
                            </ul>
                        </div>

                        <div className="alignment-preview">
                            <h4>Content Preview</h4>
                            {preview.transformed.targetNotebook.cells
                                .slice(0, 5)
                                .map((cell, index) => (
                                    <div key={index} className="cell-preview">
                                        <div className="cell-id">{cell.metadata.id}</div>
                                        <div className="cell-content">{cell.value}</div>
                                    </div>
                                ))}
                            {preview.transformed.targetNotebook.cells.length > 5 && (
                                <div className="more-indicator">
                                    ... {preview.transformed.targetNotebook.cells.length - 5} more
                                    cells
                                </div>
                            )}
                        </div>
                    </div>
                </VSCodePanelView>
            </VSCodePanels>

            <div className="action-buttons">
                <VSCodeButton appearance="secondary" onClick={onCancel}>
                    Back
                </VSCodeButton>
                <VSCodeButton onClick={onConfirm}>Import Translation</VSCodeButton>
            </div>
        </div>
    );
};
