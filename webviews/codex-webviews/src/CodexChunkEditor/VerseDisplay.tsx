import React from "react";
import { EditorVerseContent, EditorPostMessages } from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";

interface VerseDisplayProps {
    verseMarker: string;
    verseContent: string;
    verseIndex: number;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
    vscode: any;
}

const VerseDisplay: React.FC<VerseDisplayProps> = ({
    verseMarker,
    verseContent,
    verseIndex,
    setContentBeingUpdated,
    vscode,
}) => {
    const handleVerseClick = () => {
        setContentBeingUpdated({
            verseMarkers: [verseMarker],
            content: verseContent,
            verseIndex,
        });
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: verseMarker },
        } as EditorPostMessages);
    };

    return (
        <span className="verse-display" onClick={handleVerseClick}>
            <sup>{verseMarker.split(" ")[1].split(":")[1]}</sup>
            <span
                dangerouslySetInnerHTML={{ __html: HACKY_removeContiguousSpans(verseContent) }}
            />
        </span>
    );
};

export default VerseDisplay;