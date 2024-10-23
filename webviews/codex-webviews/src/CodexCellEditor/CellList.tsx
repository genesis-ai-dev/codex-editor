import React, { useMemo, useState, useCallback } from "react";
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
    spellCheckFunction: (cellContent: string) => Promise<SpellCheckResponse | null>;
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
    spellCheckFunction,
}) => {
    const [alertColorCache, setAlertColorCache] = useState<Map<string, string[]>>(new Map());

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

    const checkForAlert = useCallback(
        async (content: string, cellId: string) => {
            if (alertColorCache.has(cellId)) {
                return alertColorCache.get(cellId)!;
            }

            const lowerContent = content.toLowerCase();
            const hasAlert = lowerContent.includes("alert");
            const hasPurple = lowerContent.includes("purple");
            const hasBoth = lowerContent.includes("both");
            const spellCheckResponse = await spellCheckFunction(content);

            let colors: string[] = [];
            if (spellCheckResponse && spellCheckResponse.length > 0) {
                colors = ["#FF6B6B"]; // Brighter red for spell check errors
            } else if (hasBoth) {
                colors = ["#FF6B6B", "#A0A0FF"]; // Brighter red and a more vibrant purple
            } else if (hasPurple) {
                colors = ["#A0A0FF"]; // A more vibrant purple
            } else if (hasAlert) {
                colors = ["#FF6B6B"]; // Brighter red
            }

            setAlertColorCache((prev) => new Map(prev).set(cellId, colors));
            return colors;
        },
        [alertColorCache, spellCheckFunction]
    );

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
                            const alertColorsPromise = checkForAlert(cellContent, cellId);

                            return (
                                <span key={startIndex + index}>
                                    <AlertColors alertColorsPromise={alertColorsPromise} />
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
            checkForAlert,
            duplicateCellIds,
        ]
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
                    const alertColorsPromise = checkForAlert(cellContent, cellMarkers.join(" "));
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
                                <React.Suspense fallback={<div>Loading...</div>}>
                                    <AlertColors alertColorsPromise={alertColorsPromise} />
                                </React.Suspense>
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
            checkForAlert,
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

const AlertColors: React.FC<{ alertColorsPromise: Promise<string[]> }> = ({
    alertColorsPromise,
}) => {
    const [alertColors, setAlertColors] = React.useState<string[]>([]);

    React.useEffect(() => {
        alertColorsPromise.then(setAlertColors);
    }, [alertColorsPromise]);

    return (
        <>
            {alertColors.map((color, i) => (
                <span
                    key={i}
                    style={{
                        fontSize: "2rem",
                        color: color,
                    }}
                >
                    •
                </span>
            ))}
        </>
    );
};

export default React.memo(CellList);
