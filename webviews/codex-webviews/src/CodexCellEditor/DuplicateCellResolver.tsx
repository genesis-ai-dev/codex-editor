import React, { useState } from "react";
import { EditorPostMessages, QuillCellContent } from "../../../../types";
import CellContentDisplay from "./CellContentDisplay";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const DuplicateCellResolver: React.FC<{
    translationUnits: QuillCellContent[];
    textDirection: "ltr" | "rtl";
    vscode: any;
}> = ({ translationUnits, textDirection, vscode }) => {
    const [selectedCell, setSelectedCell] = useState<(QuillCellContent & { index: number }) | null>(
        null
    );
    const getListOfDuplicateCells = (translationUnitsToCheck: QuillCellContent[]): string[] => {
        const listOfCellIds = translationUnitsToCheck.map((unit) => unit.cellMarkers[0]);
        const uniqueCellIds = new Set(listOfCellIds);
        const duplicateCellIds = listOfCellIds.filter((cellId) => {
            if (uniqueCellIds.has(cellId)) {
                uniqueCellIds.delete(cellId);
                return false;
            } else {
                return true;
            }
        });

        const uniqueDuplicateCellIds = new Set(duplicateCellIds);
        return Array.from(uniqueDuplicateCellIds);
    };

    const duplicateCellIds = getListOfDuplicateCells(translationUnits);
    const duplicateCells = translationUnits.filter((unit) =>
        duplicateCellIds.includes(unit.cellMarkers[0])
    );
    interface IdOrderedDuplicateCell {
        [id: string]: QuillCellContent[];
    }

    const idOrderedDuplicateCells: IdOrderedDuplicateCell = {};
    duplicateCells.forEach((cell) => {
        const id = cell.cellMarkers[0];
        if (!idOrderedDuplicateCells[id]) {
            idOrderedDuplicateCells[id] = [];
        }
        idOrderedDuplicateCells[id].push(cell);
    });

    const selectedCellWithIndexRemoved = {
        cellMarkers: selectedCell?.cellMarkers,
        cellContent: selectedCell?.cellContent,
        cellType: selectedCell?.cellType,
        editHistory: selectedCell?.editHistory,
        timestamps: selectedCell?.timestamps,
        cellLabel: selectedCell?.cellLabel,
    } as QuillCellContent;

    return (
        <div className="codex-cell-editor">
            <div className="scrollable-content">
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "1rem",
                        alignItems: "center",
                    }}
                >
                    <h1 style={{ marginBottom: "2em" }}>
                        <i className="codicon codicon-warning" style={{ fontSize: "1.5em" }}></i>
                        Duplicate cells found
                    </h1>
                    {duplicateCellIds.map((id, index) => {
                        return (
                            <>
                                <h2>{id}</h2>
                                <div
                                    style={{ display: "flex", justifyContent: "space-between" }}
                                    key={id}
                                >
                                    {idOrderedDuplicateCells[id].map((cell, cellIndex) => (
                                        <React.Fragment key={cell.cellMarkers[0]}>
                                            {cellIndex > 0 && (
                                                <div
                                                    style={{
                                                        width: "1px",
                                                        backgroundColor: "#ccc",
                                                        margin: "0 10px",
                                                    }}
                                                />
                                            )}
                                            <div
                                                style={{
                                                    backgroundColor:
                                                        selectedCell?.index === cellIndex &&
                                                        selectedCell?.cellMarkers[0] ===
                                                            cell.cellMarkers[0]
                                                            ? "#e6ffe6"
                                                            : "transparent",
                                                    padding: "10px",
                                                    borderRadius: "5px",
                                                }}
                                            >
                                                <span
                                                    onClick={() => {
                                                        setSelectedCell({
                                                            ...cell,
                                                            index: cellIndex,
                                                        });
                                                    }}
                                                >
                                                    <CellContentDisplay
                                                        timestamps={cell.timestamps}
                                                        hasDuplicateId={false}
                                                        cellIds={cell.cellMarkers}
                                                        cellContent={cell.cellContent}
                                                        cellIndex={index}
                                                        cellType={cell.cellType}
                                                        cellLabel={cell.cellLabel}
                                                        setContentBeingUpdated={() => {}}
                                                        vscode={vscode}
                                                        textDirection={textDirection}
                                                        isSourceText={true}
                                                    />
                                                </span>
                                                {selectedCell?.index === cellIndex &&
                                                    selectedCell.cellMarkers[0] ===
                                                        cell.cellMarkers[0] && (
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                justifyContent: "center",
                                                                gap: "1rem",
                                                                marginTop: "1rem",
                                                            }}
                                                        >
                                                            <VSCodeButton
                                                                onClick={() => {
                                                                    vscode.postMessage({
                                                                        command:
                                                                            "replaceDuplicateCells",
                                                                        content: {
                                                                            ...selectedCellWithIndexRemoved,
                                                                        },
                                                                    } as EditorPostMessages);
                                                                }}
                                                            >
                                                                <i className="codicon codicon-check"></i>
                                                            </VSCodeButton>
                                                            <VSCodeButton
                                                                onClick={() => {
                                                                    setSelectedCell(null);
                                                                }}
                                                            >
                                                                <i className="codicon codicon-x"></i>
                                                            </VSCodeButton>
                                                        </div>
                                                    )}
                                            </div>
                                        </React.Fragment>
                                    ))}
                                </div>
                            </>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default DuplicateCellResolver;
