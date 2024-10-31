import React, { useState } from "react";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { MultiPreviewItem } from "../types";
import { formatFileSize } from "../../../../../src/utils/formatters";
import { SourcePreview } from "./SourcePreview";
import { TranslationPreview } from "./TranslationPreview";

interface PreviewAccordionProps {
    previews: MultiPreviewItem[];
    onReject: (id: string) => void;
    onSelect: (id: string) => void;
    selectedId?: string;
}

export const PreviewAccordion: React.FC<PreviewAccordionProps> = ({
    previews,
    onReject,
    onSelect,
    selectedId,
}) => {
    const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set([previews[0]?.id]));

    const toggleExpand = (id: string) => {
        const newExpanded = new Set(expandedIds);
        if (newExpanded.has(id)) {
            newExpanded.delete(id);
        } else {
            newExpanded.add(id);
        }
        setExpandedIds(newExpanded);
        onSelect(id);
    };

    return (
        <div className="preview-accordion">
            {previews.map((preview, index) => (
                <React.Fragment key={preview.id}>
                    {index > 0 && <VSCodeDivider />}
                    <div
                        className={`preview-item ${preview.isRejected ? "rejected" : ""} ${
                            selectedId === preview.id ? "selected" : ""
                        }`}
                        style={{
                            padding: "0.5rem",
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "0.5rem",
                            background: preview.isRejected
                                ? "var(--vscode-inputValidation-errorBackground)"
                                : selectedId === preview.id
                                ? "var(--vscode-list-activeSelectionBackground)"
                                : "transparent",
                        }}
                    >
                        <i
                            className={`codicon codicon-${
                                expandedIds.has(preview.id) ? "chevron-down" : "chevron-right"
                            }`}
                            onClick={() => toggleExpand(preview.id)}
                        />
                        <div style={{ flex: 1 }} onClick={() => toggleExpand(preview.id)}>
                            <div style={{ display: "flex", justifyContent: "space-between" }}>
                                <span>{preview.fileName}</span>
                                <span>{formatFileSize(preview.fileSize)}</span>
                            </div>
                            {!preview.isValid && (
                                <div style={{ color: "var(--vscode-errorForeground)" }}>
                                    <i className="codicon codicon-warning" /> Validation errors
                                    found
                                </div>
                            )}
                        </div>
                        {!preview.isRejected && (
                            <i
                                className="codicon codicon-close"
                                onClick={(e) => {
                                    e.stopPropagation();
                                    onReject(preview.id);
                                }}
                                style={{
                                    padding: "4px",
                                    borderRadius: "4px",
                                    cursor: "pointer",
                                }}
                            />
                        )}
                    </div>
                    {expandedIds.has(preview.id) && (
                        <div style={{ padding: "1rem" }}>
                            {preview.preview.type === "source" ? (
                                <SourcePreview preview={preview.preview} hideActions />
                            ) : (
                                <TranslationPreview preview={preview.preview} hideActions />
                            )}
                        </div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};
