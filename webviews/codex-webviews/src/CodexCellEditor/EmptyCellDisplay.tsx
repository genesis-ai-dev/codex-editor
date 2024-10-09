import React, { useContext } from "react";
import { EditorCellContent } from "../../../../types";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    cellLabel?: string;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    textDirection: "ltr" | "rtl";
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({
    cellMarkers,
    cellLabel,
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
            cellChanged: false,
            cellLabel: cellLabel || "",
        });
    };

    return (
        <div
            className="empty-cell-display"
            onClick={handleClick}
            style={{ direction: textDirection }}
        >
            <span className="empty-cell-marker">{cellLabel || cellMarkers.join("-")}</span>
            <span className="empty-cell-prompt">Click to add cell content</span>
        </div>
    );
};

export default EmptyCellDisplay;
