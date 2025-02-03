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
<<<<<<< HEAD
=======
    highlightedCellId?: string | null;
>>>>>>> main
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
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
<<<<<<< HEAD
=======
    highlightedCellId,
>>>>>>> main
}) => {
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const cellRef = useRef<HTMLDivElement>(null);
    const { contentToScrollTo } = useContext(ScrollToContentContext);

    useEffect(() => {
<<<<<<< HEAD
        if (
            contentToScrollTo &&
            contentToScrollTo === cellIds[0] &&
            cellRef.current &&
            !unsavedChanges
        ) {
            cellRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [contentToScrollTo]);
=======
        if (highlightedCellId === cellIds[0] && cellRef.current && isSourceText) {
            cellRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [highlightedCellId]);
>>>>>>> main

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            toggleFlashingBorder();
            return;
        }
<<<<<<< HEAD
        debug("handleVerseClick", { cellIds, cellContent, cellLabel, timestamps });
=======

        const documentUri =
            (vscode.getState() as any)?.documentUri || window.location.search.substring(1);

        // First update the content
>>>>>>> main
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent,
            cellChanged: unsavedChanges,
            cellLabel,
            timestamps,
<<<<<<< HEAD
        } as EditorCellContent);
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: cellIds[0] },
=======
            uri: documentUri,
        } as EditorCellContent);

        // Then notify the extension about the current cell and document
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: {
                currentLineId: cellIds[0],
                uri: documentUri,
            },
>>>>>>> main
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

<<<<<<< HEAD
    return (
        <span
            ref={cellRef}
            className={`verse-display ${
                cellType === CodexCellTypes.TEXT ? "canonical-display" : "paratext-display"
            } cell-content ${hasDuplicateId ? "duplicate-id" : ""}`}
            onClick={handleVerseClick}
            style={{ direction: textDirection, backgroundColor: "transparent" }}
=======
    const getBackgroundColor = () => {
        if (highlightedCellId === cellIds[0]) {
            return "rgba(255, 255, 255, 0.1)";
        }
        return "transparent";
    };

    return (
        <div
            ref={cellRef}
            className={`cell-content ${hasDuplicateId ? "duplicate-cell" : ""} ${
                highlightedCellId === cellIds[0] ? "highlighted-cell" : ""
            }`}
            onClick={handleVerseClick}
            style={{
                direction: textDirection,
                textAlign: textDirection === "rtl" ? "right" : "left",
                backgroundColor: getBackgroundColor(),
                cursor: isSourceText ? "default" : "pointer",
            }}
>>>>>>> main
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
<<<<<<< HEAD
        </span>
=======
        </div>
>>>>>>> main
    );
};

export default CellContentDisplay;
