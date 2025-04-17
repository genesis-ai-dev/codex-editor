import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { ImportType } from "../types";

const FEATURE_FLAG_TRANSLATION_PAIRS = true;

interface ImportTypeSelectorProps {
    onSelect: (type: ImportType) => void;
    onCancel: () => void;
}

export const ImportTypeSelector: React.FC<ImportTypeSelectorProps> = ({ onSelect, onCancel }) => {
    return (
        <div style={{ padding: "1.5rem", textAlign: "center" }}>
            <h2 style={{ marginBottom: "1.5rem" }}>What would you like to import? </h2>

            <div
                style={{
                    display: "flex",
                    gap: "1.5rem",
                    justifyContent: "center",
                    flexWrap: "wrap",
                    marginBottom: "2rem",
                }}
            >
                <div
                    className="import-option"
                    onClick={() => onSelect("source")}
                    style={{
                        padding: "1.5rem",
                        border: "2px solid var(--vscode-button-background)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        width: "180px",
                        transition: "background-color 0.2s",
                    }}
                >
                    <i
                        className="codicon codicon-file-add"
                        style={{
                            fontSize: "1.5rem",
                            marginBottom: "0.5rem",
                            display: "block",
                        }}
                    />
                    <h3 style={{ marginBottom: "0.5rem" }}>New Source Text</h3>
                    <p
                        style={{
                            color: "var(--vscode-descriptionForeground)",
                            fontSize: "0.9em",
                        }}
                    >
                        Import a new source text file to translate
                    </p>
                </div>

                <div
                    className="import-option"
                    onClick={() => onSelect("translation")}
                    style={{
                        padding: "1.5rem",
                        border: "2px solid var(--vscode-button-background)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        width: "180px",
                        transition: "background-color 0.2s",
                    }}
                >
                    <i
                        className="codicon codicon-globe"
                        style={{
                            fontSize: "1.5rem",
                            marginBottom: "0.5rem",
                            display: "block",
                        }}
                    />
                    <h3 style={{ marginBottom: "0.5rem" }}>Translation</h3>
                    <p
                        style={{
                            color: "var(--vscode-descriptionForeground)",
                            fontSize: "0.9em",
                        }}
                    >
                        Import a translation for an existing source text
                    </p>
                </div>

                {FEATURE_FLAG_TRANSLATION_PAIRS && (
                    <div
                        className="import-option"
                        onClick={() => onSelect("translation-pairs")}
                        style={{
                            padding: "1.5rem",
                            border: "2px solid var(--vscode-button-background)",
                            borderRadius: "6px",
                            cursor: "pointer",
                            width: "180px",
                            transition: "background-color 0.2s",
                        }}
                    >
                        <i
                            className="codicon codicon-file-text"
                            style={{
                                fontSize: "1.5rem",
                                marginBottom: "0.5rem",
                                display: "block",
                            }}
                        />
                        <h3 style={{ marginBottom: "0.5rem" }}>Spreadsheet</h3>
                        <p
                            style={{
                                color: "var(--vscode-descriptionForeground)",
                                fontSize: "0.9em",
                            }}
                        >
                            Import data from CSV or TSV files
                        </p>
                    </div>
                )}

                <div
                    className="import-option"
                    onClick={() => onSelect("bible-download")}
                    style={{
                        padding: "1.5rem",
                        border: "2px solid var(--vscode-button-background)",
                        borderRadius: "6px",
                        cursor: "pointer",
                        width: "180px",
                        transition: "background-color 0.2s",
                    }}
                >
                    <i
                        className="codicon codicon-cloud-download"
                        style={{
                            fontSize: "1.5rem",
                            marginBottom: "0.5rem",
                            display: "block",
                        }}
                    />
                    <h3 style={{ marginBottom: "0.5rem" }}>Download Bible</h3>
                    <p
                        style={{
                            color: "var(--vscode-descriptionForeground)",
                            fontSize: "0.9em",
                        }}
                    >
                        Download a Bible translation from online sources
                    </p>
                </div>
            </div>

            <div style={{ display: "flex", justifyContent: "center" }}>
                <VSCodeButton appearance="secondary" onClick={onCancel}>
                    Cancel
                </VSCodeButton>
            </div>
        </div>
    );
};
