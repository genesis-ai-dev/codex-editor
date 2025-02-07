import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { PreviewContent } from "../../../../../types/index.d";
import { SourcePreview } from "./SourcePreview";
import { TranslationPreview } from "./TranslationPreview";
import { BiblePreview } from "./BiblePreview";
import { PreviewAccordion } from "./PreviewAccordion";
import { MultiPreviewItem } from "../types";
import { BiblePreview as IBiblePreview } from "../../../../../types";
interface MultiPreviewContainerProps {
    previews: MultiPreviewItem[];
    onConfirm: () => void;
    onCancel: () => void;
    onRejectPreview: (id: string) => void;
}

const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const renderPreview = (preview: PreviewContent) => {
    if (preview.type === "source") {
        return <SourcePreview preview={preview} />;
    }
    if (preview.type === "translation") {
        return <TranslationPreview preview={preview} />;
    }
    if (preview.type === "bible") {
        return (
            <BiblePreview
                preview={preview as IBiblePreview}
                onConfirm={() => {}}
                onCancel={() => {}}
            />
        ); // FIXME: Add onConfirm and onCancel
    }
    return null;
};
const DEBUG = true;
const debug = function (...args: any[]) {
    if (DEBUG) {
        console.log("[MultiPreviewContainer]", ...args);
    }
};

export const MultiPreviewContainer: React.FC<MultiPreviewContainerProps> = ({
    previews,
    onConfirm,
    onCancel,
    onRejectPreview,
}) => {
    debug({ previews, onConfirm, onCancel, onRejectPreview });
    const validPreviews = previews.filter((p) => !p.isRejected && p.isValid);
    const hasValidPreviews = validPreviews.length > 0;

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h3>File Previews</h3>
                <div>
                    <span style={{ marginRight: "1rem" }}>
                        {validPreviews.length} of {previews.length} files ready to import
                    </span>
                </div>
            </div>

            <PreviewAccordion
                previews={previews}
                onReject={onRejectPreview}
                onSelect={(id) => {
                    /* Handle selection */
                }}
            />

            <div
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
                <VSCodeButton onClick={onConfirm} disabled={!hasValidPreviews}>
                    Import {validPreviews.length} File{validPreviews.length !== 1 ? "s" : ""}
                </VSCodeButton>
            </div>
        </div>
    );
};
