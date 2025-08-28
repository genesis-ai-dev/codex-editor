import React, { useRef, useEffect } from "react";
import { WebviewApi } from "vscode-webview";
import { useTooltip } from "./contextProviders/TooltipContext";

interface EmptyCellDisplayProps {
    cellMarkers: string[];
    cellLabel: string;
    setContentBeingUpdated: (content: any) => void;
    textDirection: "ltr" | "rtl";
    openCellById: (cellId: string, text: string) => void;
    fontSize?: number; // Font size for responsive styling
    isSourceCell?: boolean;
}

const EmptyCellDisplay: React.FC<EmptyCellDisplayProps> = ({
    cellMarkers,
    cellLabel,
    openCellById,
    fontSize = 14,
    isSourceCell = false,
}) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const { showTooltip, hideTooltip } = useTooltip();

    // Calculate responsive margins based on font size
    const getResponsiveMargins = () => {
        if (fontSize <= 14) {
            return { marginTop: "0px", marginBottom: "0px" };
        } else if (fontSize <= 18) {
            return { marginTop: "2px", marginBottom: "2px" };
        } else if (fontSize <= 22) {
            return { marginTop: "4px", marginBottom: "4px" };
        } else if (fontSize <= 26) {
            return { marginTop: "6px", marginBottom: "6px" };
        } else {
            return { marginTop: "8px", marginBottom: "8px" };
        }
    };

    const responsiveMargins = getResponsiveMargins();

    // Effect to attach event listeners to footnote markers (if any)
    useEffect(() => {
        if (!contentRef.current) return;

        // Find all footnote markers in the rendered content
        const markers = contentRef.current.querySelectorAll("sup.footnote-marker");
        if (markers.length === 0) return;

        // Function to show tooltip on hover
        const handleMarkerMouseEnter = (e: Event) => {
            const marker = e.currentTarget as HTMLElement;
            const content = marker.getAttribute("data-footnote") || "";
            const rect = marker.getBoundingClientRect();

            // Position at the top center of the marker
            const x = rect.left + rect.width / 2;
            const y = rect.top;

            showTooltip(<div dangerouslySetInnerHTML={{ __html: content }} />, x, y);
        };

        // Function to hide tooltip when mouse leaves
        const handleMarkerMouseLeave = () => {
            hideTooltip();
        };

        // Attach listeners to all markers
        markers.forEach((marker) => {
            marker.addEventListener("mouseenter", handleMarkerMouseEnter);
            marker.addEventListener("mouseleave", handleMarkerMouseLeave);

            // Update marker text to show its position (1-based)
            const index = Array.from(markers).indexOf(marker);
            if (marker.textContent !== `${index + 1}`) {
                marker.textContent = `${index + 1}`;
            }
        });

        // Clean up listeners when component unmounts
        return () => {
            markers.forEach((marker) => {
                marker.removeEventListener("mouseenter", handleMarkerMouseEnter);
                marker.removeEventListener("mouseleave", handleMarkerMouseLeave);
            });
        };
    }, [showTooltip, hideTooltip]);

    return (
        <div
            ref={contentRef}
            className="empty-cell-display"
            onClick={() => openCellById(cellMarkers[0], "")}
            style={{
                whiteSpace: "normal", // Allow text to wrap
                wordBreak: "break-word", // Break words to prevent overflow
                overflow: "visible", // Changed from hidden to visible to allow tooltips
                textOverflow: "ellipsis", // Show ellipsis for overflow text
                display: "flex",
                flexWrap: "wrap", // Wrap content to next line if needed
                alignItems: "center",
                padding: "0px 0px", // Reduced padding to match content cells
                background: "transparent", // Ensure transparent background
                border: "none", // Explicitly remove any border
                minHeight: "21px", // Use minHeight instead of fixed height
                lineHeight: "21px", // Ensure vertical centering
                width: "100%", // Take full width
                boxSizing: "border-box",
                ...responsiveMargins,
            }}
        >
            {cellLabel && <span className="empty-cell-marker">{cellLabel}</span>}
            <span className="empty-cell-prompt" style={{ paddingLeft: "0px" }}>
                {isSourceCell ? "No text" : "Click to translate"}
            </span>
        </div>
    );
};

export default EmptyCellDisplay;
