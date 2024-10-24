import React, { useMemo, useState, useCallback, useRef, useEffect } from "react";
import { EditorCellContent, QuillCellContent } from "../../../../types";
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
    isProblematicFunction: (
        text: string,
        cellId: string
    ) => Promise<{ isProblematic: boolean; cellId: string }>;
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
    isProblematicFunction,
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
                                <AlertColors
                                    cellId={cellId}
                                    cellContent={cellContent}
                                    isProblematicFunction={isProblematicFunction}
                                />
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
            isProblematicFunction,
        ]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;

        for (let i = 0; i < translationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType, cellLabel, timestamps } =
                translationUnits[i];

            if (
                !isSourceText &&
                cellMarkers.join(" ") === contentBeingUpdated.cellMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                result.push(
                    <div
                        key={cellMarkers.join(" ")}
                        style={{ display: "flex", alignItems: "center" }}
                    >
                        <AlertColors
                            cellId={cellMarkers.join(" ")}
                            cellContent={cellContent}
                            isProblematicFunction={isProblematicFunction}
                        />
                        <CellEditor
                            cellMarkers={cellMarkers}
                            cellContent={cellContent}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel}
                            cellTimestamps={timestamps}
                            isProblematic={isProblematicFunction}
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
        isProblematicFunction,
        setContentBeingUpdated,
        textDirection,
        vscode,
    ]);

    const listHeight = windowHeight - headerHeight - 20;

    return (
        <div
            className="verse-list ql-editor"
            style={{
                direction: textDirection,
                overflowY: "auto",
                maxHeight: `${listHeight}px`,
            }}
        >
            {renderCells()}
        </div>
    );
};

const AlertColors: React.FC<{
    cellId: string;
    cellContent: string;
    isProblematicFunction: (
        text: string,
        cellId: string
    ) => Promise<{ isProblematic: boolean; cellId: string }>;
}> = ({ cellId, cellContent, isProblematicFunction }) => {
    const [isProblematic, setIsProblematic] = useState<boolean>(false);
    const [isLoading, setIsLoading] = useState<boolean>(true);
    const resultsCache = new Map<string, boolean>();

    useEffect(() => {
        const checkContent = async () => {
            if (resultsCache.has(cellId)) {
                setIsProblematic(resultsCache.get(cellId)!);
                setIsLoading(false);
                return;
            }

            try {
                const result = await isProblematicFunction(cellContent, cellId);
                resultsCache.set(cellId, result.isProblematic.isProblematic);
                setIsProblematic(result.isProblematic.isProblematic);
            } catch (error) {
                console.error("Error checking content:", error);
                resultsCache.set(cellId, false);
                setIsProblematic(false);
            } finally {
                setIsLoading(false);
            }
        };

        checkContent();
    }, [cellId, cellContent, isProblematicFunction]);

    if (isLoading) return null;
    if (!isProblematic) return null;

    return (
        <div style={{ display: "flex", flexDirection: "column", marginRight: "8px" }}>
            <div
                style={{
                    width: "10px",
                    height: "10px",
                    borderRadius: "50%",
                    backgroundColor: "#FF6B6B",
                    marginBottom: "-4px",
                    boxShadow: "0 0 2px rgba(0,0,0,0.2)",
                }}
            />
        </div>
    );
};

export default React.memo(CellList);
