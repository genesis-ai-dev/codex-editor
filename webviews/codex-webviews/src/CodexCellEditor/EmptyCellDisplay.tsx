import React, { useContext } from "react";
import { EditorCellContent, EditorPostMessages } from "../../../../types";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    cellLabel?: string;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    textDirection: "ltr" | "rtl";
    vscode: any;
    openCellById: (cellId: string, text: string) => void;
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({
    cellMarkers,
    cellLabel,
    setContentBeingUpdated,
    textDirection,
    vscode,
    openCellById,
}) => {
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const handleClick = () => {
        if (unsavedChanges) {
            toggleFlashingBorder();
            return;
        }

        openCellById(cellMarkers[0], "");

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
