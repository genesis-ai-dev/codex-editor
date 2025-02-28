import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import React, { useMemo, useCallback, useState, useEffect } from "react";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { CodexCellTypes } from "../../../../types/enums";

export interface CellListProps {
    spellCheckResponse: SpellCheckResponse | null;
    translationUnits: QuillCellContent[];
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    vscode: any;
    textDirection: "ltr" | "rtl";
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    windowHeight: number;
    headerHeight: number;
    alertColorCodes: { [cellId: string]: number };
    highlightedCellId: string | null;
    scrollSyncEnabled: boolean;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellList] ${message}`, ...args);
    }
}

const CellList: React.FC<CellListProps> = ({
    translationUnits,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveHtml,
    vscode,
    textDirection,
    cellDisplayMode,
    isSourceText,
    windowHeight,
    headerHeight,
    spellCheckResponse,
    alertColorCodes,
    highlightedCellId,
    scrollSyncEnabled,
}) => {
    const numberOfEmptyCellsToRender = 1;

    const duplicateCellIds = useMemo(() => {
        const idCounts = new Map<string, number>();
        const duplicates = new Set<string>();

        translationUnits.forEach(({ cellMarkers }) => {
            const id = cellMarkers.join(" ");
            idCounts.set(id, (idCounts.get(id) || 0) + 1);
            if (idCounts.get(id)! > 1) {
                duplicates.add(id);
            }
        });

        return duplicates;
    }, [translationUnits]);

    // Helper function to generate appropriate cell label
    const generateCellLabel = useCallback(
        (cell: QuillCellContent, index: number): string => {
            // If cell already has a label, use it
            if (cell.cellLabel) {
                return cell.cellLabel;
            }

            // Don't use index as fallback for paratext cells
            if (cell.cellType === CodexCellTypes.PARATEXT) {
                return "";
            }

            // Check if this is a child cell
            const cellId = cell.cellMarkers[0];
            const cellIdParts = cellId.split(":");

            // Child cells have more than 2 segments in their ID (e.g., "1TH 1:6:1740475700855-sbcr37orm")
            if (cellIdParts.length > 2) {
                // Get the parent cell ID (e.g., "1TH 1:6")
                const parentCellId = cellIdParts.slice(0, 2).join(":");

                // Find the parent cell
                const parentCell = translationUnits.find(
                    (unit) => unit.cellMarkers[0] === parentCellId
                );

                if (parentCell) {
                    // Get parent's label
                    const parentLabel =
                        parentCell.cellLabel ||
                        (parentCell.cellType !== CodexCellTypes.PARATEXT
                            ? translationUnits.indexOf(parentCell).toString()
                            : "");

                    // Find all siblings (cells with the same parent)
                    const siblings = translationUnits.filter((unit) => {
                        const unitId = unit.cellMarkers[0];
                        const unitIdParts = unitId.split(":");
                        return (
                            unitIdParts.length > 2 &&
                            unitIdParts.slice(0, 2).join(":") === parentCellId
                        );
                    });

                    // Find this cell's index among its siblings
                    const childIndex =
                        siblings.findIndex((sibling) => sibling.cellMarkers[0] === cellId) + 1;

                    // Return label in format "parentLabel.childIndex"
                    return `${parentLabel}.${childIndex}`;
                }
            }

            // Default fallback for regular cells
            return index.toString();
        },
        [translationUnits]
    );

    const renderCellGroup = useCallback(
        (group: typeof translationUnits, startIndex: number) => (
            <span
                key={`group-${startIndex}`}
                className={`verse-group cell-display-${cellDisplayMode}`}
                style={{
                    direction: textDirection,
                    display: cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "inline" : "block",
                    backgroundColor: "transparent",
                }}
            >
                {group.map((cell, index) => {
                    const cellId = cell.cellMarkers.join(" ");
                    const hasDuplicateId = duplicateCellIds.has(cellId);
                    const generatedCellLabel = generateCellLabel(group[index], startIndex + index);
                    const cellMarkers = cell.cellMarkers;

                    return (
                        <span
                            key={startIndex + index}
                            style={{
                                display:
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? "inline"
                                        : "block",
                                verticalAlign: "middle",
                                backgroundColor: "transparent",
                            }}
                        >
                            <CellContentDisplay
                                cell={cell}
                                cellLabel={cell.cellLabel || generatedCellLabel} // Fixme: We should have a separate label for line numbers line numbers should be different the the label for the cell content
                                key={`cell-${cellMarkers[0]}`}
                                setContentBeingUpdated={setContentBeingUpdated}
                                vscode={vscode}
                                textDirection={textDirection}
                                isSourceText={isSourceText}
                                hasDuplicateId={hasDuplicateId}
                                alertColorCode={alertColorCodes[cellMarkers[0]]}
                                highlightedCellId={highlightedCellId}
                                scrollSyncEnabled={scrollSyncEnabled}
                            />
                        </span>
                    );
                })}
            </span>
        ),
        [
            cellDisplayMode,
            textDirection,
            setContentBeingUpdated,
            vscode,
            isSourceText,
            duplicateCellIds,
            highlightedCellId,
            scrollSyncEnabled,
            alertColorCodes,
            generateCellLabel,
        ]
    );

    const openCellById = useCallback(
        (cellId: string, text: string) => {
            const cellToOpen = translationUnits.find((unit) => unit.cellMarkers[0] === cellId);

            if (cellToOpen) {
                debug("openCellById", { cellToOpen, text });
                setContentBeingUpdated({
                    cellMarkers: cellToOpen.cellMarkers,
                    cellContent: text,
                    cellChanged: true,
                    cellLabel: cellToOpen.cellLabel,
                });
            } else {
                vscode.postMessage({
                    command: "showErrorMessage",
                    text: `Cell with ID ${cellId} not found.`,
                });
            }
        },
        [translationUnits, setContentBeingUpdated, vscode]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;
        let emptyCellsRendered = 0;

        debug("translationUnits", { translationUnits });

        for (let i = 0; i < translationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType, cellLabel, timestamps, editHistory } =
                translationUnits[i];

            const checkIfCurrentCellIsChild = () => {
                const currentCellId = cellMarkers[0];
                const translationUnitsWithCurrentCellRemoved = translationUnits.filter(
                    ({ cellMarkers }) => cellMarkers[0] !== currentCellId
                );

                const currentCellWithLastIdSegmentRemoved = currentCellId
                    .split(":")
                    .slice(0, 2)
                    .join(":");
                return translationUnitsWithCurrentCellRemoved.some(
                    ({ cellMarkers }) => cellMarkers[0] === currentCellWithLastIdSegmentRemoved
                );
            };

            if (
                !isSourceText &&
                cellMarkers.join(" ") === contentBeingUpdated.cellMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                const cellIsChild = checkIfCurrentCellIsChild();
                const generatedCellLabel = generateCellLabel(translationUnits[i], i);

                result.push(
                    <span
                        key={cellMarkers.join(" ")}
                        style={{ display: "inline-flex", alignItems: "center" }}
                    >
                        <CellEditor
                            editHistory={editHistory}
                            spellCheckResponse={spellCheckResponse}
                            cellIsChild={cellIsChild}
                            cellMarkers={cellMarkers}
                            cellContent={cellContent}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel || generatedCellLabel}
                            cellTimestamps={timestamps}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={setContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            textDirection={textDirection}
                            openCellById={openCellById}
                        />
                    </span>
                );
                groupStartIndex = i + 1;
            } else if (cellContent?.trim()?.length === 0) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }

                // Only render empty cells in one-line-per-cell mode or if it's the next empty cell to render
                if (
                    cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ||
                    translationUnits[i - 1]?.cellContent?.trim()?.length > 0 ||
                    i === 0
                ) {
                    const generatedCellLabel = generateCellLabel(translationUnits[i], i);

                    const emptyCellDisplay =
                        cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ? (
                            <EmptyCellDisplay
                                key={cellMarkers.join(" ")}
                                cellMarkers={cellMarkers}
                                cellLabel={cellLabel || generatedCellLabel}
                                setContentBeingUpdated={setContentBeingUpdated}
                                textDirection={textDirection}
                                vscode={vscode}
                                openCellById={openCellById}
                            />
                        ) : (
                            <VSCodeButton
                                appearance="secondary"
                                style={{ height: "15px" }}
                                onClick={() => openCellById(cellMarkers[0], "")}
                            >
                                <i
                                    className="codicon codicon-plus"
                                    style={{ fontSize: "12px" }}
                                ></i>
                            </VSCodeButton>
                        );

                    result.push(emptyCellDisplay);
                    emptyCellsRendered++;
                }
                groupStartIndex = i + 1;
            } else {
                currentGroup.push(translationUnits[i]);
            }
        }

        if (currentGroup.length > 0) {
            result.push(renderCellGroup(currentGroup, groupStartIndex));
        }

        return result;
    }, [
        translationUnits,
        contentBeingUpdated,
        isSourceText,
        handleCloseEditor,
        handleSaveHtml,
        renderCellGroup,
        setContentBeingUpdated,
        textDirection,
        vscode,
        spellCheckResponse,
        openCellById,
        cellDisplayMode,
        generateCellLabel,
    ]);

    // Debug log to see the structure of translationUnits
    useEffect(() => {
        if (DEBUG_ENABLED && translationUnits.length > 0) {
            console.log("Translation unit structure:", translationUnits[0]);
        }
    }, [translationUnits]);

    return (
        <div
            className="verse-list ql-editor"
            style={{
                direction: textDirection,
                overflowY: "auto",
                display: cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "inline-block" : "block",
                width: "100%",
                backgroundColor: "transparent",
            }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo(CellList);
