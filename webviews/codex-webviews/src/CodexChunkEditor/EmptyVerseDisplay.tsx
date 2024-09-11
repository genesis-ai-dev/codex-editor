import React from "react";
import { EditorVerseContent } from "../../../../types";

interface EmptyVerseDisplayProps {
    verseMarker: string;
    verseIndex: number;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorVerseContent>>;
}

const EmptyVerseDisplay: React.FC<EmptyVerseDisplayProps> = ({
    verseMarker,
    verseIndex,
    setContentBeingUpdated,
}) => {
    const handleClick = () => {
        setContentBeingUpdated({
            verseMarkers: [verseMarker],
            content: "",
            verseIndex,
        });
    };

    return (
        <div className="empty-verse-display" onClick={handleClick}>
            <span className="empty-verse-marker">{verseMarker}</span>
            <span className="empty-verse-prompt">Click to add verse</span>
        </div>
    );
};

export default EmptyVerseDisplay;