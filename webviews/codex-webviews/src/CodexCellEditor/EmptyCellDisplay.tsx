import React from "react";
import { EditorCellContent } from "../../../../types";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    textDirection: "ltr" | "rtl";
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({
    cellMarkers,
    setContentBeingUpdated,
    textDirection,
}) => {
    const handleClick = () => {
        setContentBeingUpdated({
            cellMarkers,
            content: "",
        });
    };

    return (
        <div
            className="empty-cell-display"
            onClick={handleClick}
            style={{ direction: textDirection }}
        >
            <span className="empty-cell-marker">{cellMarkers.join("-")}</span>
            <span className="empty-cell-prompt">Click to add cell</span>
        </div>
    );
};

export default EmptyCellDisplay;
