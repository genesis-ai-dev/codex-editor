import React, { useContext } from "react";
import { EditorCellContent, EditorPostMessages } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    vscode: any;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds,
    cellContent,
    cellType,
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
}) => {
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            // FIXME: if you click a source text cell.. maybe we still want to update the shared state store?
            toggleFlashingBorder();
            return;
        }
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent: cellContent,
            cellChanged: unsavedChanges,
        });
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: cellIds[0] },
        } as EditorPostMessages);
    };
    const verseMarkerVerseNumbers = cellIds.map((cellMarker) => {
        const parts = cellMarker?.split(":");
        return parts?.[parts.length - 1];
    });
    let verseRefForDisplay = "";
    if (verseMarkerVerseNumbers.length === 1) {
        verseRefForDisplay = verseMarkerVerseNumbers[0];
    } else {
        verseRefForDisplay = `${verseMarkerVerseNumbers[0]}-${
            verseMarkerVerseNumbers[verseMarkerVerseNumbers.length - 1]
        }`;
    }
    // FIXME: we need to allow for the ref/id to be displayed at the start or end of the cell
    return (
        <span
            className={`verse-display ${
                cellType === CodexCellTypes.PARATEXT ? "paratext-display" : ""
            }`}
            onClick={handleVerseClick}
            style={{ direction: textDirection }}
        >
            {cellType === CodexCellTypes.TEXT && <sup>{verseRefForDisplay}</sup>}
            {/* Display a visual indicator for paratext cells */}
            {cellType === CodexCellTypes.PARATEXT && (
                <span className="paratext-indicator">[Paratext]</span>
            )}
            <span
                style={{ direction: textDirection }}
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cellContent),
                }}
            />
        </span>
    );
};

export default CellContentDisplay;
