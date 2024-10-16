import React, { useContext } from "react";
import { EditorCellContent, EditorPostMessages, Timestamps } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    cellLabel?: string;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    timestamps: Timestamps | undefined;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds,
    cellContent,
    cellType,
    cellLabel,
    setContentBeingUpdated,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
    timestamps,
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
            cellLabel: cellLabel,
            timestamps: timestamps,
        } as EditorCellContent);
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
    // truncate display vref to just show the last 3 chars max
    verseRefForDisplay = verseRefForDisplay.slice(-3);

    const displayLabel = cellLabel || verseRefForDisplay;

    // FIXME: we need to allow for the ref/id to be displayed at the start or end of the cell
    return (
        <span
            className={
                `verse-display ${
                    cellType === CodexCellTypes.TEXT ? "canonical-display" : "paratext-display"
                } ${cellType === CodexCellTypes.PARATEXT ? "paratext-display" : ""}` +
                ` cell-content ${hasDuplicateId ? "duplicate-id" : ""}`
            }
            onClick={handleVerseClick}
            style={{
                direction: textDirection,
            }}
        >
            {hasDuplicateId && (
                <span className="duplicate-id-alert">
                    <i className="codicon codicon-warning"></i>
                </span>
            )}
            {cellType === CodexCellTypes.TEXT && <sup>{displayLabel}</sup>}
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
