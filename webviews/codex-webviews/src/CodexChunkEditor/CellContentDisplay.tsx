import React from "react";
import {
    EditorVerseContent,
    EditorPostMessages,
    CodexCellTypes,
} from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";

interface CellContentDisplayProps {
    cellIds: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    setContentBeingUpdated: React.Dispatch<
        React.SetStateAction<EditorVerseContent>
    >;
    vscode: any;
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cellIds: verseMarkers,
    cellContent: verseContent,
    cellIndex: verseIndex,
    setContentBeingUpdated,
    vscode,
}) => {
    const handleVerseClick = () => {
        setContentBeingUpdated({
            verseMarkers: verseMarkers,
            content: verseContent,
            verseIndex,
        });
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: verseMarkers[0] },
        } as EditorPostMessages);
    };
    const verseMarkerVerseNumbers = verseMarkers.map((verseMarker) => {
        return verseMarker.split(" ")[1].split(":")[1];
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
            <sup>{verseRefForDisplay}</sup>
            <span
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(verseContent),
                }}
            />
        </span>
    );
};

export default CellContentDisplay;
