import React, { useRef } from "react";
import { useTooltip } from "../CodexCellEditor/contextProviders/TooltipContext";

interface FootnoteMarkerProps {
    id: string;
    content: string;
    number: number;
}

const FootnoteMarker: React.FC<FootnoteMarkerProps> = ({ id, content, number }) => {
    const { showTooltip, hideTooltip } = useTooltip();
    const markerRef = useRef<HTMLElement>(null);

    const handleMouseEnter = () => {
        if (markerRef.current) {
            const rect = markerRef.current.getBoundingClientRect();
            const x = rect.left + rect.width / 2;
            const y = rect.top;

            showTooltip(<div dangerouslySetInnerHTML={{ __html: content }} />, x, y);
        }
    };

    return (
        <sup
            ref={markerRef}
            className="footnote-marker"
            data-footnote={content}
            data-footnote-id={id}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={hideTooltip}
            style={{
                cursor: "help",
                position: "relative",
                fontSize: "0.75em",
                lineHeight: "0",
                verticalAlign: "super",
                textDecoration: "none",
                color: "var(--vscode-textLink-foreground)",
            }}
        >
            {number}
        </sup>
    );
};

export default FootnoteMarker;
