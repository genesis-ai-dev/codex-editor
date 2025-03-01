import React, { useContext, useEffect, useRef, useState } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    Timestamps,
    EditHistory,
    QuillCellContent,
} from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import ValidationButton from "./ValidationButton";

const SHOW_VALIDATION_BUTTON = false;
interface CellContentDisplayProps {
    cell: QuillCellContent;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    alertColorCode: number | undefined;
    highlightedCellId?: string | null;
    scrollSyncEnabled: boolean;
    cellLabelOrGeneratedLabel: string;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cell,
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
    alertColorCode,
    highlightedCellId,
    scrollSyncEnabled,
    cellLabelOrGeneratedLabel,
}) => {
    const { cellContent, timestamps, editHistory } = cell;
    const cellIds = cell.cellMarkers;

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
            cellLabel: cellLabelOrGeneratedLabel,
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
        cellLabelOrGeneratedLabel ||
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
                    {!isSourceText && (
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
        </div>
    );
};

export default CellContentDisplay;
