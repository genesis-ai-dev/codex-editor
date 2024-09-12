import React from "react";
import { EditorVerseContent, EditorPostMessages } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";

interface VerseDisplayProps {
    verseMarkers: string[];
    verseContent: string;
    verseIndex: number;
    setContentBeingUpdated: React.Dispatch<
        React.SetStateAction<EditorVerseContent>
    >;
    vscode: any;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
    verseMarkers,
    verseContent,
    verseIndex,
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

export default VerseDisplay;
