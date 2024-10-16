import React, { useMemo } from "react";
import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import "@vscode/codicons/dist/codicon.css"; // Import codicons
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";

interface CellListProps {
    translationUnits: QuillCellContent[];
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    spellCheckResponse: SpellCheckResponse | null;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    windowHeight: number;
    headerHeight: number;
}

const CellList: React.FC<CellListProps> = ({
    translationUnits,
    contentBeingUpdated,
    setContentBeingUpdated,
    spellCheckResponse,
    handleCloseEditor,
    handleSaveHtml,
    vscode,
    textDirection,
    cellDisplayMode,
    isSourceText,
    windowHeight,
    headerHeight,
}) => {
    // Detect duplicate cell IDs
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

    const checkForAlert = (content: string) => {
        const lowerContent = content.toLowerCase();
        const hasAlert = lowerContent.includes("alert");
        const hasPurple = lowerContent.includes("purple");
        const hasBoth = lowerContent.includes("both");

        if (hasBoth) return ["#FF6B6B", "#A0A0FF"]; // Brighter red and a more vibrant purple
        if (hasPurple) return ["#A0A0FF"]; // A more vibrant purple
        if (hasAlert) return ["#FF6B6B"]; // Brighter red
        return [];
    };

    const renderCellGroup = useMemo(
        () => (group: typeof translationUnits, startIndex: number) =>
            (
                <span
                    key={`group-${startIndex}`}
                    className={`verse-group cell-display-${cellDisplayMode}`}
                    style={{ direction: textDirection }}
                >
                    {group.map(
                        ({ cellMarkers, cellContent, cellType, cellLabel, timestamps }, index) => {
                            const cellId = cellMarkers.join(" ");
                            const hasDuplicateId = duplicateCellIds.has(cellId);
                            const alertColors = checkForAlert(cellContent);

                            return (
                                <div
                                    key={startIndex + index}
                                    style={{ display: "flex", alignItems: "center" }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            marginRight: "8px",
                                        }}
                                    >
                                        {alertColors.map((color, i) => (
                                            <div
                                                key={i}
                                                style={{
                                                    width: "10px",
                                                    height: "10px",
                                                    borderRadius: "50%",
                                                    backgroundColor: color,
                                                    marginBottom: "-4px",
                                                    boxShadow: "0 0 2px rgba(0,0,0,0.2)",
                                                }}
                                            />
                                        ))}
                                    </div>
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
        [cellDisplayMode, textDirection, setContentBeingUpdated, vscode, isSourceText]
    );

    const renderCells = useMemo(
        () => () => {
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
                    const alertColors = checkForAlert(cellContent);
                    result.push(
                        <div
                            key={cellMarkers.join(" ")}
                            style={{ display: "flex", alignItems: "center" }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    marginRight: "8px",
                                }}
                            >
                                {alertColors.map((color, i) => (
                                    <div
                                        key={i}
                                        style={{
                                            width: "10px",
                                            height: "10px",
                                            borderRadius: "50%",
                                            backgroundColor: color,
                                            marginBottom: "-4px",
                                            boxShadow: "0 0 2px rgba(0,0,0,0.2)",
                                        }}
                                    />
                                ))}
                            </div>
                            <CellEditor
                                cellMarkers={cellMarkers}
                                cellContent={cellContent}
                                cellIndex={i}
                                cellType={cellType}
                                cellLabel={cellLabel}
                                cellTimestamps={timestamps}
                                spellCheckResponse={spellCheckResponse}
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
        },
        [
            translationUnits,
            contentBeingUpdated,
            isSourceText,
            spellCheckResponse,
            handleCloseEditor,
            handleSaveHtml,
            renderCellGroup,
        ]
    );

    const listHeight = windowHeight - headerHeight - 20; // 20px for padding

    return (
        <div
            className="verse-list ql-editor"
            style={{ direction: textDirection, height: `${listHeight}px`, overflowY: "auto" }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo(CellList);
