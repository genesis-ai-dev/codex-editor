import React, { useState } from "react";
import { VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { MultiPreviewItem } from "../types";
import { formatFileSize } from "../../../../../src/utils/formatters";
import { SourcePreview } from "./SourcePreview";
import { TranslationPreview } from "./TranslationPreview";
import {
    TranslationPreview as ITranslationPreview,
    TranslationPairsPreview as ITranslationPairsPreview,
} from "../../../../../types";
import { TranslationPairPreview } from "./TranslationPairPreview";
interface PreviewAccordionProps {
    previews: MultiPreviewItem[];
    onReject: (id: string) => void;
    onSelect: (id: string) => void;
    selectedId?: string;
}

const DEBUG = false;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[PreviewAccordion]", ...args);
    }
};

export const PreviewAccordion: React.FC<PreviewAccordionProps> = ({
    previews,
    onReject,
    onSelect,
    selectedId,
}) => {
    debug({ previews, onReject, onSelect, selectedId });
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

    const renderPreviewComponent = (preview: MultiPreviewItem) => {
        switch (preview.preview.type) {
            case "source":
                return <SourcePreview preview={preview.preview} hideActions />;
            case "translation":
                return (
                    <TranslationPreview
                        preview={preview.preview as ITranslationPreview}
                        hideActions
                    />
                );
            case "translation-pairs":
                return <TranslationPairPreview preview={preview.preview} hideActions />;
            default:
                return <div>Unsupported preview type: {preview.preview.type}</div>;
        }
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
                        <div style={{ padding: "1rem" }}>{renderPreviewComponent(preview)}</div>
                    )}
                </React.Fragment>
            ))}
        </div>
    );
};
