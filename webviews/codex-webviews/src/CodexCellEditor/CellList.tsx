import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import React, { useMemo, useCallback, useState, useEffect } from "react";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";

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
                {group.map(
                    ({ cellMarkers, cellContent, cellType, cellLabel, timestamps }, index) => {
                        const cellId = cellMarkers.join(" ");
                        const hasDuplicateId = duplicateCellIds.has(cellId);

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
                                    cellIds={cellMarkers}
                                    cellContent={cellContent}
                                    cellIndex={startIndex + index}
                                    cellType={cellType}
                                    cellLabel={cellLabel || (startIndex + index).toString()}
                                    setContentBeingUpdated={setContentBeingUpdated}
                                    vscode={vscode}
                                    textDirection={textDirection}
                                    isSourceText={isSourceText}
                                    hasDuplicateId={hasDuplicateId}
                                    timestamps={timestamps}
                                    alertColorCode={
                                        cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                            ? -1
                                            : alertColorCodes[cellId]
                                    }
                                    highlightedCellId={highlightedCellId}
                                    scrollSyncEnabled={scrollSyncEnabled}
                                />
                            </span>
                        );
                    }
                )}
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
        ]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;

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
                            cellLabel={cellLabel || i.toString()}
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
                result.push(
                    <EmptyCellDisplay
                        key={cellMarkers.join(" ")}
                        cellMarkers={cellMarkers}
                        cellLabel={cellLabel || i.toString()}
                        setContentBeingUpdated={setContentBeingUpdated}
                        textDirection={textDirection}
                        vscode={vscode}
                        openCellById={openCellById}
                    />
                );
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
        highlightedCellId,
    ]);

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
