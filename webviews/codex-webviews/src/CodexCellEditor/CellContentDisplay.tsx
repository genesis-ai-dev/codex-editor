import React, { useContext, useEffect, useRef, useState } from "react";
<<<<<<< HEAD
import { EditorCellContent, EditorPostMessages, Timestamps } from "../../../../types";
=======
import {
    EditorCellContent,
    EditorPostMessages,
    Timestamps,
    EditHistory,
    QuillCellContent,
} from "../../../../types";
>>>>>>> main
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
<<<<<<< HEAD

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    cellLabel?: string;
=======
import ValidationButton from "./ValidationButton";

const SHOW_VALIDATION_BUTTON = false;
interface CellContentDisplayProps {
    cell: QuillCellContent;
>>>>>>> main
    setContentBeingUpdated: (content: EditorCellContent) => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
<<<<<<< HEAD
    timestamps: Timestamps | undefined;
    alertColorCode: number | undefined;
    highlightedCellId?: string | null;
    scrollSyncEnabled: boolean;
=======
    alertColorCode: number | undefined;
    highlightedCellId?: string | null;
    scrollSyncEnabled: boolean;
    cellLabelOrGeneratedLabel: string;
>>>>>>> main
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
<<<<<<< HEAD
    cellIds,
    cellContent,
    cellType,
    cellLabel,
=======
    cell,
>>>>>>> main
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
<<<<<<< HEAD
    timestamps,
    alertColorCode,
    highlightedCellId,
    scrollSyncEnabled,
}) => {
=======
    alertColorCode,
    highlightedCellId,
    scrollSyncEnabled,
    cellLabelOrGeneratedLabel,
}) => {
    const { cellContent, timestamps, editHistory } = cell;
    const cellIds = cell.cellMarkers;

>>>>>>> main
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const cellRef = useRef<HTMLDivElement>(null);
    const { contentToScrollTo } = useContext(ScrollToContentContext);

    useEffect(() => {
        if (
            highlightedCellId === cellIds[0] &&
            cellRef.current &&
            isSourceText &&
            scrollSyncEnabled
        ) {
            debug("Scrolling to content highlightedCellId", {
                highlightedCellId,
                cellIds,
                isSourceText,
            });
            cellRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [highlightedCellId]);

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            toggleFlashingBorder();
            return;
        }

        const documentUri =
            (vscode.getState() as any)?.documentUri || window.location.search.substring(1);

        // First update the content
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent,
            cellChanged: unsavedChanges,
<<<<<<< HEAD
            cellLabel,
=======
            cellLabel: cellLabelOrGeneratedLabel,
>>>>>>> main
            timestamps,
            uri: documentUri,
        } as EditorCellContent);

        // Then notify the extension about the current cell and document
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: {
                currentLineId: cellIds[0],
            },
        } as EditorPostMessages);
    };

    const displayLabel =
<<<<<<< HEAD
        cellLabel ||
=======
        cellLabelOrGeneratedLabel ||
>>>>>>> main
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

    const getBackgroundColor = () => {
        if (highlightedCellId === cellIds[0] && scrollSyncEnabled) {
            return "rgba(255, 255, 255, 0.1)";
        }
        return "transparent";
    };

    return (
        <div
            ref={cellRef}
<<<<<<< HEAD
            className={`cell-content ${hasDuplicateId ? "duplicate-cell" : ""} ${
                highlightedCellId === cellIds[0] && scrollSyncEnabled ? "highlighted-cell" : ""
            }`}
            onClick={handleVerseClick}
            style={{
                direction: textDirection,
                textAlign: textDirection === "rtl" ? "right" : "left",
                backgroundColor: getBackgroundColor(),
                cursor: isSourceText ? "default" : "pointer",
            }}
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
=======
            className={`cell-content-display ${
                highlightedCellId === cellIds[0] ? "highlighted-cell" : ""
            }`}
            style={{
                backgroundColor: getBackgroundColor(),
                direction: textDirection,
                borderColor: hasDuplicateId ? "red" : undefined,
            }}
            onClick={handleVerseClick}
        >
            <div className="cell-header">
                <div className="cell-actions">
                    {!isSourceText && SHOW_VALIDATION_BUTTON && (
                        <ValidationButton
                            cellId={cellIds[0]}
                            cell={cell}
                            vscode={vscode}
                            isSourceText={isSourceText}
                        />
                    )}
                    {getAlertDot()}
                </div>
                <div className="cell-label">
                    {cellLabelOrGeneratedLabel && (
                        <span className="cell-label-text">{cellLabelOrGeneratedLabel}</span>
                    )}
                </div>
            </div>
            <div
                className="cell-content"
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cellContent),
                }}
            ></div>
>>>>>>> main
        </div>
    );
};

export default CellContentDisplay;
