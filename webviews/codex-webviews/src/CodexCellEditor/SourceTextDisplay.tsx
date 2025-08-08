import React, { useRef, useEffect } from "react";
import { useTooltip } from "./contextProviders/TooltipContext";
import { updateFootnoteNumbering } from "./footnoteUtils";

interface SourceTextDisplayProps {
    content: string;
    footnoteOffset?: number;
}

/**
 * Component for displaying source text with footnote hover functionality
 * This ensures that footnotes in source text have the same hover behavior
 * as footnotes in the main cell content display.
 */
const SourceTextDisplay: React.FC<SourceTextDisplayProps> = ({ content, footnoteOffset = 1 }) => {
    const contentRef = useRef<HTMLDivElement>(null);
    const { showTooltip, hideTooltip } = useTooltip();

    // Effect to attach event listeners to footnote markers
    useEffect(() => {
        if (!contentRef.current) return;

        // Find all footnote markers in the rendered content
        const markers = contentRef.current.querySelectorAll("sup.footnote-marker");

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
        });

        // Use the proper footnote numbering utility
        if (contentRef.current) {
            updateFootnoteNumbering(contentRef.current, footnoteOffset, false);
        }

        // Clean up listeners when component unmounts
        return () => {
            markers.forEach((marker) => {
                marker.removeEventListener("mouseenter", handleMarkerMouseEnter);
                marker.removeEventListener("mouseleave", handleMarkerMouseLeave);
            });
        };
    }, [content, showTooltip, hideTooltip, footnoteOffset]);

    return (
        <div className="content-section">
            <div
                ref={contentRef}
                className="prose prose-sm max-w-none"
                dangerouslySetInnerHTML={{
                    __html: content || "Loading source text...",
                }}
            />
        </div>
    );
};

export default SourceTextDisplay;
