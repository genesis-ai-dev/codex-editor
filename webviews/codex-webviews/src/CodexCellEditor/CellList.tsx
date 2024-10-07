import React from "react";
import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import "@vscode/codicons/dist/codicon.css"; // Import codicons
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";
import { HACKY_removeContiguousSpans } from "./utils";
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
}) => {
    const renderCellGroup = (group: typeof translationUnits, startIndex: number) => (
        <span
            key={`group-${startIndex}`}
            className={`verse-group cell-display-${cellDisplayMode}`}
            style={{ direction: textDirection }}
        >
            {group.map(({ cellMarkers, cellContent, cellType }, index) => {
                if (cellType === CodexCellTypes.PARATEXT) {
                    return (
                        <div
                            key={startIndex + index}
                            className="paratext-cell"
                            style={{ backgroundColor: "#f9f9f9", padding: "0.5rem", borderRadius: "4px" }}
                        >
                            <span className="paratext-label">Paratext:</span>
                            <span
                                dangerouslySetInnerHTML={{
                                    __html: HACKY_removeContiguousSpans(cellContent),
                                }}
                            />
                        </div>
                    );
                }

                return (
                    <CellContentDisplay
                        key={startIndex + index}
                        cellIds={cellMarkers}
                        cellContent={cellContent}
                        cellIndex={startIndex + index}
                        cellType={cellType}
                        setContentBeingUpdated={setContentBeingUpdated}
                        vscode={vscode}
                        textDirection={textDirection}
                        isSourceText={isSourceText}
                    />
                );
            })}
        </span>
    );

    const renderCells = () => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;

        for (let i = 0; i < translationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType } = translationUnits[i];

            if (
                !isSourceText &&
                cellMarkers.join(" ") === contentBeingUpdated.cellMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                result.push(
                    <CellEditor
                        key={i}
                        cellMarkers={cellMarkers}
                        cellContent={cellContent}
                        cellIndex={i}
                        cellType={cellType}
                        spellCheckResponse={spellCheckResponse}
                        contentBeingUpdated={contentBeingUpdated}
                        setContentBeingUpdated={setContentBeingUpdated}
                        handleCloseEditor={handleCloseEditor}
                        handleSaveHtml={handleSaveHtml}
                        textDirection={textDirection}
                    />
                );
                groupStartIndex = i + 1;
            } else if (cellContent?.trim()?.length === 0) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                result.push(
                    <EmptyCellDisplay
                        key={i}
                        cellMarkers={cellMarkers}
                        setContentBeingUpdated={setContentBeingUpdated}
                        textDirection={textDirection}
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
    };

    return (
        <div className="verse-list ql-editor" style={{ direction: textDirection }}>
            {renderCells()}
        </div>
    );
};

export default CellList;
