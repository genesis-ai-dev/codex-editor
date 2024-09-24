import React from "react";
import { EditorVerseContent, EditorPostMessages } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    vscode: any;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds: verseMarkers,
    cellContent: verseContent,
    cellType,
    setContentBeingUpdated,
    vscode,
}) => {
    const handleVerseClick = () => {
        setContentBeingUpdated({
            verseMarkers: verseMarkers,
            content: verseContent,
        });
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: verseMarkers[0] },
        } as EditorPostMessages);
    };
    const verseMarkerVerseNumbers = verseMarkers.map((verseMarker) => {
        const parts = verseMarker?.split(":");
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
    return (
        <span className="verse-display" onClick={handleVerseClick}>
            {cellType === "verse" && <sup>{verseRefForDisplay}</sup>}
            <span
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(verseContent),
                }}
            />
        </span>
    );
};

export default CellContentDisplay;
