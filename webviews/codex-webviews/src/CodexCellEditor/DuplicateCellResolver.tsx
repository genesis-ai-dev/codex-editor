import React from "react";
import { QuillCellContent } from "../../../../types";
import CellContentDisplay from "./CellContentDisplay";

const DuplicateCellResolver: React.FC<{
    translationUnits: QuillCellContent[];
    textDirection: "ltr" | "rtl";
    vscode: any;
}> = ({ translationUnits, textDirection, vscode }) => {
    const getListOfDuplicateCells = (translationUnitsToCheck: QuillCellContent[]) => {
        const listOfCellIds = translationUnitsToCheck.map((unit) => unit.cellMarkers[0]);
        const uniqueCellIds = new Set(listOfCellIds);
        return listOfCellIds.filter((cellId) => {
            if (uniqueCellIds.has(cellId)) {
                uniqueCellIds.delete(cellId);
                return false;
            } else {
                return true;
            }
        });
    };
    // const listOfCellIds = translationUnits.map((unit) => unit.cellMarkers[0]);
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
                                            <span
                                                onClick={() => {
                                                    console.log("clicked", cellIndex + 1);
                                                }}
                                            >
                                                <CellContentDisplay
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
