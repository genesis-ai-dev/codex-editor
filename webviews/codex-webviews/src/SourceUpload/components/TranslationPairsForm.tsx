import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeDropdown, VSCodeOption } from "@vscode/webview-ui-toolkit/react";

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
}

export const TranslationPairsForm: React.FC<TranslationPairsFormProps> = ({
    headers,
    onSubmit,
    onCancel,
}) => {
    const [sourceColumn, setSourceColumn] = useState<string>("");
    const [targetColumn, setTargetColumn] = useState<string>("");
    const [idColumn, setIdColumn] = useState<string>("");
    const [metadataColumns, setMetadataColumns] = useState<string[]>([]);
    const [hasHeaders, setHasHeaders] = useState(true);
    const [error, setError] = useState<string | null>(null);

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
        if (!sourceColumn || !targetColumn) {
            return;
        }
        console.log({
            sourceColumn,
            targetColumn,
            ...(idColumn ? { idColumn } : {}),
            metadataColumns,
            hasHeaders,
        });

        onSubmit({
            sourceColumn,
            targetColumn,
            ...(idColumn ? { idColumn } : {}),
            metadataColumns,
            hasHeaders,
        });
    };

    return (
        <div className="column-mapping-form">
            <h2>Map Columns</h2>
            <p>
                Please select which columns contain the source text, target text, and optional ID.
            </p>

            <div className="form-group">
                {/* <label className="checkbox-label">
                    <input
                        type="checkbox"
                        checked={hasHeaders}
                        onChange={(e) => setHasHeaders(e.target.checked)}
                    />
                    File has headers
                </label> */}
                <p className="help-text">
                    {hasHeaders
                        ? "The first row contains column names"
                        : "The first row contains data"}
                </p>
            </div>

            <div className="form-group">
                <label>Source Text Column *</label>
                <VSCodeDropdown
                    value={sourceColumn}
                    onChange={(e) => {
                        const target = e.currentTarget as HTMLSelectElement;
                        setSourceColumn(target.value);
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
                <label>Target Text Column *</label>
                <VSCodeDropdown
                    value={targetColumn}
                    onChange={(e) => {
                        const target = e.currentTarget as HTMLSelectElement;
                        setTargetColumn(target.value);
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
                <label>ID Column (Optional)</label>
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
                <label>Additional Metadata Columns</label>
                <div className="metadata-columns">
                    {headers
                        .filter((h) => h !== sourceColumn && h !== targetColumn && h !== idColumn)
                        .map((header, index) => (
                            <label key={header}>
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

            <div className="button-group">
                <VSCodeButton onClick={onCancel}>Cancel</VSCodeButton>
                <VSCodeButton onClick={handleSubmit} disabled={!sourceColumn || !targetColumn}>
                    Continue
                </VSCodeButton>
            </div>

            <style>{`
                .column-mapping-form {
                    padding: 1rem;
                    max-width: 600px;
                    margin: 0 auto;
                }
                .form-group {
                    margin-bottom: 1rem;
                }
                .form-group label {
                    display: block;
                    margin-bottom: 0.5rem;
                }
                .checkbox-label {
                    display: flex !important;
                    align-items: center;
                    gap: 0.5rem;
                }
                .help-text {
                    font-size: 0.9em;
                    opacity: 0.8;
                    margin-top: 0.25rem;
                }
                .metadata-columns {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(150px, 1fr));
                    gap: 0.5rem;
                }
                .metadata-columns label {
                    display: flex;
                    align-items: center;
                    gap: 0.5rem;
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
