import React, { useContext } from "react";
import { EditorCellContent, EditorPostMessages } from "../../../../types";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    cellLabel?: string;
    setContentBeingUpdated: React.Dispatch<React.SetStateAction<EditorCellContent>>;
    textDirection: "ltr" | "rtl";
    vscode: any; // Add vscode prop
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({
    cellMarkers,
    cellLabel,
    setContentBeingUpdated,
    textDirection,
    vscode, // Add vscode to the destructured props
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

        // Add this block to update the global state
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: { currentLineId: cellMarkers[0] },
        } as EditorPostMessages);
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
