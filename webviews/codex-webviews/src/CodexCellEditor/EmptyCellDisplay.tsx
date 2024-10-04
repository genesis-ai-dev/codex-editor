import React, { useContext } from "react";
import { EditorCellContent } from "../../../../types";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";

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
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);
    const handleClick = () => {
        if (unsavedChanges) {
            toggleFlashingBorder();
            return;
        }
        setContentBeingUpdated({
            cellMarkers,
            cellContent: "",
        });
    };

    return (
        <div
            className="empty-cell-display"
            onClick={handleClick}
            style={{ direction: textDirection }}
        >
            <span className="empty-cell-marker">{cellMarkers.join("-")}</span>
            <span className="empty-cell-prompt">Click to add cell content</span>
        </div>
    );
};

export default EmptyCellDisplay;
