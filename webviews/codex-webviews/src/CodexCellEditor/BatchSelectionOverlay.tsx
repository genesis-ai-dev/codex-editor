import React, { useEffect, useState, useRef, useCallback } from "react";

interface BatchSelectionOverlayProps {
    cellIds: string[];
    containerRef: React.RefObject<HTMLElement | null>;
    isDragging: boolean;
}

/**
 * Draws a straight vertical line from the midpoint of the first selected cell
 * to the midpoint of the last selected cell. The real sparkle buttons on the
 * endpoint cells serve as the visual anchors — this component is just the line.
 */
const BatchSelectionOverlay: React.FC<BatchSelectionOverlayProps> = ({
    cellIds,
    containerRef,
    isDragging,
}) => {
    const [position, setPosition] = useState<{
        top: number;
        bottom: number;
        left: number;
    } | null>(null);
    const rafRef = useRef<number>(0);

    const measure = useCallback(() => {
        if (!containerRef.current || cellIds.length === 0) {
            setPosition(null);
            return;
        }

        const container = containerRef.current;
        const containerRect = container.getBoundingClientRect();

        const firstEl = container.querySelector(
            `[data-cell-id="${cellIds[0]}"]`
        ) as HTMLElement | null;
        const lastEl = container.querySelector(
            `[data-cell-id="${cellIds[cellIds.length - 1]}"]`
        ) as HTMLElement | null;

        if (!firstEl || !lastEl) {
            setPosition(null);
            return;
        }

        const firstRect = firstEl.getBoundingClientRect();
        const lastRect = lastEl.getBoundingClientRect();

        // Snap to vertical midpoint of each cell
        const firstMid =
            firstRect.top + firstRect.height / 2 - containerRect.top + container.scrollTop;
        const lastMid =
            lastRect.top + lastRect.height / 2 - containerRect.top + container.scrollTop;

        // Find the sparkle button's horizontal center and half-height for inset
        const sparkleBtn = firstEl.querySelector(".action-button-container button");
        let sparkleCenter = 24; // fallback
        let sparkleHalfHeight = 8; // fallback (16px button / 2)
        if (sparkleBtn) {
            const btnRect = sparkleBtn.getBoundingClientRect();
            sparkleCenter = btnRect.left + btnRect.width / 2 - containerRect.left + container.scrollLeft;
            sparkleHalfHeight = btnRect.height / 2;
        }

        const topMid = Math.min(firstMid, lastMid);
        const bottomMid = Math.max(firstMid, lastMid);

        setPosition({
            top: topMid + sparkleHalfHeight,
            bottom: bottomMid - sparkleHalfHeight,
            left: sparkleCenter,
        });
    }, [cellIds, containerRef]);

    useEffect(() => {
        measure();
    }, [measure]);

    // Re-measure on scroll and resize
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;

        const onScroll = () => {
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
            rafRef.current = requestAnimationFrame(measure);
        };

        container.addEventListener("scroll", onScroll, { passive: true });
        window.addEventListener("resize", onScroll, { passive: true });

        return () => {
            container.removeEventListener("scroll", onScroll);
            window.removeEventListener("resize", onScroll);
            if (rafRef.current) cancelAnimationFrame(rafRef.current);
        };
    }, [containerRef, measure]);

    if (!position || cellIds.length < 2) return null;

    const lineHeight = position.bottom - position.top;

    return (
        <div
            style={{
                position: "absolute",
                top: position.top,
                left: position.left - 1, // center the 2px line on the sparkle button
                height: lineHeight,
                width: "2px",
                backgroundColor: "var(--vscode-focusBorder)",
                opacity: isDragging ? 0.5 : 0.8,
                zIndex: 0,
                pointerEvents: "none",
            }}
        />
    );
};

export default React.memo(BatchSelectionOverlay);
