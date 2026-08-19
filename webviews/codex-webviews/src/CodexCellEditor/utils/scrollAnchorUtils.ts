export type ScrollAnchor = {
    cellId: string | null;
    viewportTop: number;
    scrollTop: number;
};

const cellSelector = "[data-cell-id], [data-cell-editor-id]";

const cellIdOf = (el: Element): string | null =>
    el.getAttribute("data-cell-id") || el.getAttribute("data-cell-editor-id");

const queryCell = (root: ParentNode, cellId: string): HTMLElement | null => {
    const escapedId = cellId.replace(/"/g, '\\"');
    return (
        (root.querySelector(`[data-cell-id="${escapedId}"]`) as HTMLElement | null) ||
        (root.querySelector(`[data-cell-editor-id="${escapedId}"]`) as HTMLElement | null)
    );
};

/**
 * Capture the first cell that is at least partially visible in `scrollContainer`,
 * along with its viewport Y and the raw scrollTop. Used to keep that cell in
 * place across in-place content refreshes (merge, source-editing toggle) that
 * insert/remove rows above. `scrollTop` is the fallback when the anchored
 * cell is gone after the update (e.g. it was merged into a neighbor).
 */
export const captureScrollAnchor = (scrollContainer: HTMLElement | null): ScrollAnchor | null => {
    if (!scrollContainer) {
        return null;
    }
    const scrollTop = scrollContainer.scrollTop;
    const containerRect = scrollContainer.getBoundingClientRect();
    const cells = scrollContainer.querySelectorAll(cellSelector);
    for (const cell of Array.from(cells)) {
        const rect = cell.getBoundingClientRect();
        if (rect.bottom > containerRect.top + 1) {
            const cellId = cellIdOf(cell);
            if (cellId) {
                return { cellId, viewportTop: rect.top, scrollTop };
            }
        }
    }
    return { cellId: null, viewportTop: 0, scrollTop };
};

/**
 * Scroll `scrollContainer` so the anchored cell sits at the same viewport Y
 * it had when `captureScrollAnchor` ran. Falls back to the captured
 * `scrollTop` if that cell is no longer in the DOM.
 */
export const restoreScrollAnchor = (
    scrollContainer: HTMLElement | null,
    anchor: ScrollAnchor
): void => {
    if (!scrollContainer) {
        return;
    }
    const previousOverflowAnchor = scrollContainer.style.getPropertyValue("overflow-anchor");
    scrollContainer.style.setProperty("overflow-anchor", "none");
    try {
        if (anchor.cellId) {
            const cellEl = queryCell(scrollContainer, anchor.cellId);
            if (cellEl) {
                const delta = cellEl.getBoundingClientRect().top - anchor.viewportTop;
                if (Math.abs(delta) > 1) {
                    scrollContainer.scrollTop += delta;
                }
                return;
            }
        }
        if (Math.abs(scrollContainer.scrollTop - anchor.scrollTop) > 1) {
            scrollContainer.scrollTop = anchor.scrollTop;
        }
    } finally {
        if (previousOverflowAnchor) {
            scrollContainer.style.setProperty("overflow-anchor", previousOverflowAnchor);
        } else {
            scrollContainer.style.removeProperty("overflow-anchor");
        }
    }
};
