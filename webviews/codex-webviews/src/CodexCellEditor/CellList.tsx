import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import "@vscode/codicons/dist/codicon.css";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";

interface CellListProps {
    translationUnits: QuillCellContent[];
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    windowHeight: number;
    headerHeight: number;
    getAlertCodeFunction: (
        text: string,
        cellId: string
    ) => Promise<{ alertColorCode: number; cellId: string }>;
    spellCheckResponse: SpellCheckResponse | null;
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
    getAlertCodeFunction,
    spellCheckResponse,
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
                style={{ direction: textDirection }}
            >
                {group.map(
                    ({ cellMarkers, cellContent, cellType, cellLabel, timestamps }, index) => {
                        const cellId = cellMarkers.join(" ");
                        const hasDuplicateId = duplicateCellIds.has(cellId);

                        return (
                            <div
                                key={startIndex + index}
                                style={{ display: "flex", alignItems: "center" }}
                            >
                                <CellContentDisplay
                                    cellIds={cellMarkers}
                                    cellContent={cellContent}
                                    cellIndex={startIndex + index}
                                    cellType={cellType}
                                    cellLabel={cellLabel}
                                    setContentBeingUpdated={setContentBeingUpdated}
                                    vscode={vscode}
                                    textDirection={textDirection}
                                    isSourceText={isSourceText}
                                    hasDuplicateId={hasDuplicateId}
                                    timestamps={timestamps}
                                    getAlertCodeFunction={getAlertCodeFunction}
                                />
                            </div>
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
            getAlertCodeFunction,
        ]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;

        for (let i = 0; i < translationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType, cellLabel, timestamps } =
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
                    <div
                        key={cellMarkers.join(" ")}
                        style={{ display: "flex", alignItems: "center" }}
                    >
                        <CellEditor
                            spellCheckResponse={spellCheckResponse}
                            cellIsChild={cellIsChild}
                            cellMarkers={cellMarkers}
                            cellContent={cellContent}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel}
                            cellTimestamps={timestamps}
                            getAlertCode={getAlertCodeFunction}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={setContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            textDirection={textDirection}
                        />
                    </div>
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
                        cellLabel={cellLabel}
                        setContentBeingUpdated={setContentBeingUpdated}
                        textDirection={textDirection}
                        vscode={vscode}
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
        getAlertCodeFunction,
        setContentBeingUpdated,
        textDirection,
        vscode,
    ]);

    return (
        <div
            className="verse-list ql-editor"
            style={{
                direction: textDirection,
                overflowY: "auto",
            }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo(CellList);
