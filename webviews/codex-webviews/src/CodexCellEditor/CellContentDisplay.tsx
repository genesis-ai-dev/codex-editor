import React, { useContext, useEffect, useRef, useState } from "react";
import { EditorCellContent, EditorPostMessages, Timestamps } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    cellLabel?: string;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    timestamps: Timestamps | undefined;
    alertColorCode: number | undefined;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds,
    cellContent,
    cellType,
    cellLabel,
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
    timestamps,
    alertColorCode,
}) => {
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const cellRef = useRef<HTMLDivElement>(null);
    const { contentToScrollTo } = useContext(ScrollToContentContext);

    useEffect(() => {
        if (
            contentToScrollTo &&
            contentToScrollTo === cellIds[0] &&
            cellRef.current &&
            !unsavedChanges
        ) {
            cellRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [contentToScrollTo]);

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            toggleFlashingBorder();
            return;
        }
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent,
            cellChanged: unsavedChanges,
            cellLabel,
            timestamps,
        } as EditorCellContent);
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: cellIds[0] },
        } as EditorPostMessages);
    };

    const displayLabel =
        cellLabel ||
        (() => {
            const numbers = cellIds.map((id) => id.split(":").pop());
            const reference =
                numbers.length === 1 ? numbers[0] : `${numbers[0]}-${numbers[numbers.length - 1]}`;
            return reference?.slice(-3) ?? "";
        })();

    const AlertDot = ({ color }: { color: string }) => (
        <span
            style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: color,
                marginLeft: "4px",
            }}
        />
    );

    const getAlertDot = () => {
        if (alertColorCode === -1) return null;

        const colors = {
            "0": "transparent",
            "1": "#FF6B6B",
            "2": "purple",
            "3": "white",
        } as const;
        return (
            <AlertDot
                color={colors[alertColorCode?.toString() as keyof typeof colors] || "transparent"}
            />
        );
    };

    return (
        <span
            ref={cellRef}
            className={`verse-display ${
                cellType === CodexCellTypes.TEXT ? "canonical-display" : "paratext-display"
            } cell-content ${hasDuplicateId ? "duplicate-id" : ""}`}
            onClick={handleVerseClick}
            style={{ direction: textDirection, backgroundColor: "transparent" }}
        >
            {hasDuplicateId && (
                <span className="duplicate-id-alert">
                    <i className="codicon codicon-warning"></i>
                </span>
            )}
            {cellType === CodexCellTypes.TEXT && (
                <sup>
                    {displayLabel}
                    {getAlertDot()}
                </sup>
            )}
            {cellType === CodexCellTypes.PARATEXT && (
                <span className="paratext-indicator">[Paratext]</span>
            )}
            <span
                style={{ direction: textDirection, backgroundColor: "transparent" }}
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cellContent),
                }}
            />
        </span>
    );
};

export default CellContentDisplay;
