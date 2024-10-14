import React, { useMemo } from "react";
import { FixedSizeList as List } from "react-window";
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

    const renderCellGroup = (group: typeof translationUnits, startIndex: number) => (
        <span
            key={`group-${startIndex}`}
            className={`verse-group cell-display-${cellDisplayMode}`}
            style={{ direction: textDirection }}
        >
            {group.map(({ cellMarkers, cellContent, cellType, cellLabel }, index) => {
                const cellId = cellMarkers.join(" ");
                const hasDuplicateId = duplicateCellIds.has(cellId);

                return (
                    <CellContentDisplay
                        key={startIndex + index}
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
            const { cellMarkers, cellContent, cellType, cellLabel } = translationUnits[i];

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
                        cellLabel={cellLabel}
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
    };

    const cellGroups = useMemo(
        () => renderCells(),
        [translationUnits, contentBeingUpdated, spellCheckResponse]
    );

    const Row = ({ index, style }: { index: number; style: React.CSSProperties }) => (
        <div style={style}>{cellGroups[index]}</div>
    );

    const listHeight = windowHeight - headerHeight - 20; // 20px for padding

    return (
        <div className="verse-list ql-editor" style={{ direction: textDirection, height: `${listHeight}px` }}>
            <List
                height={listHeight}
                itemCount={cellGroups.length}
                itemSize={50} // Adjust this value based on your average row height
                width="100%"
            >
                {Row}
            </List>
        </div>
    );
};

export default CellList;
