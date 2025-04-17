import React, { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeDropdown,
    VSCodeOption,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";

interface TranslationPairsFormProps {
    headers: string[];
    onSubmit: (mapping: {
        sourceColumn: string;
        targetColumn: string;
        idColumn?: string;
        metadataColumns: string[];
        hasHeaders: boolean;
    }) => void;
    onCancel: () => void;
    dataPreview?: string[][];
    parseConfig?: {
        delimiter: string;
        hasHeaders: boolean;
        totalRows: number;
    };
}

export const TranslationPairsForm: React.FC<TranslationPairsFormProps> = ({
    headers,
    onSubmit,
    onCancel,
    dataPreview = [],
    parseConfig,
}) => {
    const [sourceColumn, setSourceColumn] = useState<string>("");
    const [targetColumn, setTargetColumn] = useState<string>("");
    const [idColumn, setIdColumn] = useState<string>("");
    const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
    const [hasHeaders, setHasHeaders] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);

    // Try to auto-detect columns
    useEffect(() => {
        if (!hasHeaders) return;

        const sourceMatches = headers.filter(
            (h) =>
                h.toLowerCase().includes("source") ||
                h.toLowerCase() === "en" ||
                h.toLowerCase() === "english"
        );
        const targetMatches = headers.filter(
            (h) =>
                h.toLowerCase().includes("target") ||
                h.toLowerCase() === "translation" ||
                h.toLowerCase().includes("translated")
        );
        const idMatches = headers.filter(
            (h) => h.toLowerCase().includes("id") || h.toLowerCase() === "key"
        );

        if (sourceMatches.length === 1) setSourceColumn(sourceMatches[0]);
        if (targetMatches.length === 1) setTargetColumn(targetMatches[0]);
        if (idMatches.length === 1) setIdColumn(idMatches[0]);
    }, [headers, hasHeaders]);

    const handleSubmit = () => {
        if (!sourceColumn) {
            setError("Please select a source column");
            return;
        }
        if (targetColumn && sourceColumn === targetColumn) {
            setError("Source and target columns must be different");
            return;
        }
        setError(null);
        onSubmit({
            sourceColumn,
            targetColumn,
            ...(idColumn ? { idColumn } : {}),
            metadataColumns,
            hasHeaders,
        });
    };

    const renderPreview = () => {
        if (!dataPreview?.length) return null;

        return (
            <div className="preview-section">
                <h3>Data Preview</h3>
                <div className="preview-table">
                    <table>
                        <thead>
                            <tr>
                                {headers.map((header, i) => (
                                    <th key={i}>
                                        {header}
                                        {header === sourceColumn && " (Source)"}
                                        {header === targetColumn && " (Target)"}
                                        {header === idColumn && " (ID)"}
                                        {metadataColumns.includes(header) && " (Metadata)"}
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {dataPreview.map((row, i) => (
                                <tr key={i}>
                                    {row.map((cell, j) => (
                                        <td key={j} title={cell}>
                                            {cell.length > 50
                                                ? cell.substring(0, 47) + "..."
                                                : cell}
                                        </td>
                                    ))}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
                {parseConfig && (
                    <div className="file-info">
                        <p>
                            <strong>File Format:</strong>{" "}
                            {parseConfig.delimiter === "," ? "CSV" : "TSV"}
                        </p>
                        <p>
                            <strong>Total Rows:</strong> {parseConfig.totalRows}
                        </p>
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="column-mapping-form">
            <h2>Map Columns</h2>
            <p>
                Please select which column contains the source text. Target text column is optional.
            </p>

            <div className="form-group">
                <label>
                    Source Text Column * <span>Content to translate</span>
                </label>
                <VSCodeDropdown
                    value={sourceColumn}
                    onChange={(e) => {
                        const target = e.currentTarget as HTMLSelectElement;
                        setSourceColumn(target.value);
                        setError(null);
                    }}
                >
                    <VSCodeOption value="">Select a column</VSCodeOption>
                    {headers.map((header, index) => (
                        <VSCodeOption key={header} value={header}>
                            {hasHeaders ? header : `Column ${index + 1}`}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>

            <div className="form-group">
                <label>
                    Target Text Column (Optional) <span>Translated content</span>
                </label>
                <VSCodeDropdown
                    value={targetColumn}
                    onChange={(e) => {
                        const target = e.currentTarget as HTMLSelectElement;
                        setTargetColumn(target.value);
                        setError(null);
                    }}
                >
                    <VSCodeOption value="">None</VSCodeOption>
                    {headers.map((header, index) => (
                        <VSCodeOption key={header} value={header}>
                            {hasHeaders ? header : `Column ${index + 1}`}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>

            <div className="form-group">
                <label>
                    ID Column (Optional) <span>Unique identifier for each cell</span>
                </label>
                <VSCodeDropdown
                    value={idColumn}
                    onChange={(e) => {
                        const target = e.currentTarget as HTMLSelectElement;
                        setIdColumn(target.value);
                    }}
                >
                    <VSCodeOption value="">None</VSCodeOption>
                    {headers.map((header, index) => (
                        <VSCodeOption key={header} value={header}>
                            {hasHeaders ? header : `Column ${index + 1}`}
                        </VSCodeOption>
                    ))}
                </VSCodeDropdown>
            </div>

            <div className="form-group">
                <label>
                    Additional Metadata Columns{" "}
                    <span>Optional columns to include in the output</span>
                </label>
                <div className="metadata-columns">
                    {headers
                        .filter((h) => h !== sourceColumn && h !== targetColumn && h !== idColumn)
                        .map((header, index) => (
                            <label key={header} className="metadata-column-label">
                                <input
                                    type="checkbox"
                                    checked={metadataColumns.includes(header)}
                                    onChange={(e) => {
                                        if (e.target.checked) {
                                            setMetadataColumns([...metadataColumns, header]);
                                        } else {
                                            setMetadataColumns(
                                                metadataColumns.filter((h) => h !== header)
                                            );
                                        }
                                    }}
                                />
                                {hasHeaders ? header : `${header} (Value in Column ${index + 1})`}
                            </label>
                        ))}
                </div>
            </div>

            <VSCodeDivider />

            <div className="preview-toggle">
                <VSCodeButton appearance="secondary" onClick={() => setShowPreview(!showPreview)}>
                    {showPreview ? "Hide Preview" : "Show Preview"}
                </VSCodeButton>
            </div>

            {showPreview && renderPreview()}

            {error && (
                <div className="error-message">
                    <i className="codicon codicon-error" />
                    {error}
                </div>
            )}

            <div className="button-group">
                <VSCodeButton onClick={onCancel}>Cancel</VSCodeButton>
                <VSCodeButton onClick={handleSubmit} disabled={!sourceColumn}>
                    Continue
                </VSCodeButton>
            </div>

            <style>{`
                .column-mapping-form {
                    padding: 1rem;
                    max-width: 800px;
                    margin: 0 auto;
                }
                .form-group {
                    margin-bottom: 1.5rem;
                }
                .form-group label {
                    display: block;
                    margin-bottom: 0.5rem;
                }
                .metadata-columns {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(200px, 1fr));
                    gap: 0.75rem;
                    margin-top: 0.5rem;
                }
                .metadata-column-label {
                    display: flex !important;
                    align-items: center;
                    gap: 0.5rem;
                    padding: 0.25rem;
                    border-radius: 3px;
                    background: var(--vscode-input-background);
                }
                .preview-section {
                    margin: 1.5rem 0;
                    padding: 1rem;
                    background: var(--vscode-input-background);
                    border-radius: 4px;
                }
                .preview-table {
                    overflow-x: auto;
                    margin: 1rem 0;
                }
                .preview-table table {
                    width: 100%;
                    border-collapse: collapse;
                }
                .preview-table th, .preview-table td {
                    padding: 0.5rem;
                    text-align: left;
                    border: 1px solid var(--vscode-input-border);
                }
                .preview-table th {
                    background: var(--vscode-editor-background);
                }
                .file-info {
                    margin-top: 1rem;
                    font-size: 0.9em;
                    color: var(--vscode-descriptionForeground);
                }
                .preview-toggle {
                    margin: 1rem 0;
                }
                .error-message {
                    margin: 1rem 0;
                    padding: 0.75rem;
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
                    background: var(--vscode-inputValidation-errorBackground);
                    border: 1px solid var(--vscode-inputValidation-errorBorder);
                    color: var(--vscode-inputValidation-errorForeground);
                    border-radius: 4px;
                }
                .button-group {
                    display: flex;
                    gap: 1rem;
                    justify-content: flex-end;
                    margin-top: 2rem;
                }
            `}</style>
        </div>
    );
};
