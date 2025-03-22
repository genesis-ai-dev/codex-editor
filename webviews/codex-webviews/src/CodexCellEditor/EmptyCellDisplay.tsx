import React from "react";
import { WebviewApi } from "vscode-webview";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    cellLabel: string;
    setContentBeingUpdated: (content: any) => void;
    textDirection: "ltr" | "rtl";
    vscode: WebviewApi<unknown>;
    openCellById: (cellId: string, text: string) => void;
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({ 
    cellMarkers, 
    cellLabel, 
    openCellById 
}) => {
    return (
        <div 
            className="empty-cell-display"
            onClick={() => openCellById(cellMarkers[0], "")}
            style={{
                whiteSpace: "normal", // Allow text to wrap
                wordBreak: "break-word", // Break words to prevent overflow
                overflow: "hidden", // Hide any overflow content
                textOverflow: "ellipsis", // Show ellipsis for overflow text
                display: "flex",
                flexWrap: "wrap", // Wrap content to next line if needed
                alignItems: "center",
                padding: "0px 0px", // Reduced padding to match content cells
                background: "transparent", // Ensure transparent background
                border: "none", // Explicitly remove any border
                height: "21px", // Match height of content cells
                lineHeight: "21px", // Ensure vertical centering
                width: "100%", // Take full width
                boxSizing: "border-box"
            }}
        >
            {cellLabel && (
                <span className="empty-cell-marker">{cellLabel}</span>
            )}
            <span className="empty-cell-prompt" style={{ paddingLeft: "0px" }}>Click to translate</span>
        </div>
    );
};

export default EmptyCellDisplay;
