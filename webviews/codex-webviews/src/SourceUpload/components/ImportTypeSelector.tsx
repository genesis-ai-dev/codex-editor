import React from "react";
import { ImportType } from "../types";

interface ImportTypeSelectorProps {
    onSelect: (type: ImportType) => void;
}

export const ImportTypeSelector: React.FC<ImportTypeSelectorProps> = ({ onSelect }) => {
    return (
        <div style={{ padding: "1.5rem", textAlign: "center" }}>
            <h2 style={{ marginBottom: "1.5rem" }}>What would you like to import?</h2>

            <div
                style={{
                    display: "flex",
                    gap: "1.5rem",
                    justifyContent: "center",
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
            </div>
        </div>
    );
};
