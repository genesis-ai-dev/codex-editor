import React from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
} from "@vscode/webview-ui-toolkit/react";
import { TranslationPairsPreview as ITranslationPairsPreview } from "../../../../../types";

interface TranslationPreviewProps {
    preview: ITranslationPairsPreview;
    onConfirm?: () => void;
    onCancel?: () => void;
    hideActions?: boolean;
}

const DEBUG = true;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[TranslationPairPreview]", ...args);
    }
};

export const TranslationPairPreview: React.FC<TranslationPreviewProps> = ({
    preview,
    onConfirm,
    onCancel,
    hideActions,
}) => {
    debug({ preview });
    return (
        <div
            style={{
                padding: hideActions ? 0 : "2rem",
                maxWidth: "800px",
                margin: "0 auto",
                display: "flex",
                flexDirection: "column",
                gap: "1.5rem",
            }}
        >
            {!hideActions && <h3>Translation Preview</h3>}

            <VSCodePanels>
                <VSCodePanelTab id="tab-1">Original Content</VSCodePanelTab>
                <VSCodePanelTab id="tab-2">Alignment Preview</VSCodePanelTab>

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

                    {preview.original.validationResults?.map((result, index) => (
                        <ValidationResult key={index} result={result} />
                    ))}
                </VSCodePanelView>

                <VSCodePanelView id="view-2">
                    <div style={{ display: "flex", flexDirection: "column", gap: "1.5rem" }}>
                        {/* <div
                            className="statistics"
                            style={{
                                padding: "1rem",
                                background: "var(--vscode-editor-background)",
                                borderRadius: "4px",
                            }}
                        >
                            <h4 style={{ marginBottom: "0.5rem" }}>Alignment Statistics</h4>
                            <ul
                                style={{
                                    listStyle: "none",
                                    padding: 0,
                                    margin: 0,
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem",
                                }}
                            >
                                <li>
                                    <span style={{ color: "var(--vscode-charts-green)" }}>
                                        <i className="codicon codicon-check" /> Matched Cells:
                                    </span>{" "}
                                    {preview.original.validationResults.length}
                                </li>
                                <li>
                                    <span style={{ color: "var(--vscode-charts-yellow)" }}>
                                        <i className="codicon codicon-warning" /> Unmatched Content:
                                    </span>{" "}
                                    {preview.original.validationResults.length}
                                </li>
                                <li>
                                    <span style={{ color: "var(--vscode-charts-blue)" }}>
                                        <i className="codicon codicon-info" /> Paratext Items:
                                    </span>{" "}
                                    {preview.original.validationResults.length}
                                </li>
                            </ul>
                        </div> */}

                        <h4 style={{ marginBottom: "1rem" }}>Content Preview</h4>
                        <div className="alignment-preview">
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem",
                                    maxHeight: "200px",
                                    overflow: "auto",
                                }}
                            >
                                {preview.preview.transformed.sourceNotebook.cells
                                    .slice(0, 5)
                                    .map((cell, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                padding: "0.5rem",
                                                background: "var(--vscode-input-background)",
                                                borderRadius: "2px",
                                                fontSize: "0.9em",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    color: "var(--vscode-descriptionForeground)",
                                                }}
                                            >
                                                {cell.metadata.id} ({cell.metadata.type})
                                            </div>
                                            <pre style={{ margin: "0.5rem 0 0 0" }}>
                                                {cell.value}
                                            </pre>
                                        </div>
                                    ))}
                                {preview.preview.transformed.sourceNotebook.cells.length > 5 && (
                                    <div
                                        style={{
                                            textAlign: "center",
                                            padding: "0.5rem",
                                            color: "var(--vscode-descriptionForeground)",
                                        }}
                                    >
                                        ...{" "}
                                        {preview.preview.transformed.sourceNotebook.cells.length -
                                            5}{" "}
                                        more cells
                                    </div>
                                )}
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    gap: "0.5rem",
                                    maxHeight: "200px",
                                    overflow: "auto",
                                }}
                            >
                                {preview.preview.transformed.targetNotebook.cells
                                    .slice(0, 5)
                                    .map((cell, index) => (
                                        <div
                                            key={index}
                                            style={{
                                                padding: "0.5rem",
                                                background: "var(--vscode-input-background)",
                                                borderRadius: "2px",
                                                fontSize: "0.9em",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    color: "var(--vscode-descriptionForeground)",
                                                }}
                                            >
                                                {cell.metadata.id} ({cell.metadata.type})
                                            </div>
                                            <pre style={{ margin: "0.5rem 0 0 0" }}>
                                                {cell.value}
                                            </pre>
                                        </div>
                                    ))}
                                {preview.preview.transformed.targetNotebook.cells.length > 5 && (
                                    <div
                                        style={{
                                            textAlign: "center",
                                            padding: "0.5rem",
                                            color: "var(--vscode-descriptionForeground)",
                                        }}
                                    >
                                        ...{" "}
                                        {preview.preview.transformed.targetNotebook.cells.length -
                                            5}{" "}
                                        more cells
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* {preview.transformed.validationResults?.map((result, index) => (
                            <ValidationResult key={index} result={result} />
                        ))} */}
                    </div>
                </VSCodePanelView>
            </VSCodePanels>

            {!hideActions && (
                <div
                    className="action-buttons"
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        gap: "0.5rem",
                        marginTop: "1rem",
                    }}
                >
                    <VSCodeButton appearance="secondary" onClick={onCancel}>
                        Back
                    </VSCodeButton>
                    <VSCodeButton onClick={onConfirm}>Import Translation</VSCodeButton>
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
