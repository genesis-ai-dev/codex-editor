import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { captureScrollAnchor, restoreScrollAnchor } from "./scrollAnchorUtils";

const makeCell = (id: string, top: number, height: number): HTMLElement => {
    const el = document.createElement("div");
    el.setAttribute("data-cell-id", id);
    Object.defineProperty(el, "getBoundingClientRect", {
        value: () => ({
            top,
            bottom: top + height,
            left: 0,
            right: 100,
            width: 100,
            height,
            x: 0,
            y: top,
            toJSON: () => ({}),
        }),
    });
    return el;
};

describe("scrollAnchorUtils", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        container.className = "scrollable-content";
        container.scrollTop = 200;
        Object.defineProperty(container, "getBoundingClientRect", {
            value: () => ({
                top: 80,
                bottom: 580,
                left: 0,
                right: 100,
                width: 100,
                height: 500,
                x: 0,
                y: 80,
                toJSON: () => ({}),
            }),
        });
        document.body.appendChild(container);
    });

    afterEach(() => {
        document.body.innerHTML = "";
    });

    it("captures the first cell that intersects the viewport", () => {
        const above = makeCell("above", 0, 40);
        const firstVisible = makeCell("visible", 90, 40);
        const below = makeCell("below", 200, 40);
        container.append(above, firstVisible, below);

        const anchor = captureScrollAnchor(container);
        expect(anchor).toEqual({ cellId: "visible", viewportTop: 90, scrollTop: 200 });
    });

    it("falls back to scrollTop when the container has no cells", () => {
        expect(captureScrollAnchor(container)).toEqual({
            cellId: null,
            viewportTop: 0,
            scrollTop: 200,
        });
        expect(captureScrollAnchor(null)).toBeNull();
    });

    it("restores scrollTop so the anchored cell keeps its viewport Y", () => {
        const cell = makeCell("visible", 140, 40);
        container.appendChild(cell);
        container.scrollTop = 200;

        restoreScrollAnchor(container, { cellId: "visible", viewportTop: 90, scrollTop: 200 });

        // cell is 50px lower than the captured viewport Y, so we scroll down by 50
        expect(container.scrollTop).toBe(250);
    });

    it("does not change scrollTop when the cell is already at the captured Y", () => {
        const cell = makeCell("visible", 90, 40);
        container.appendChild(cell);
        container.scrollTop = 200;

        restoreScrollAnchor(container, { cellId: "visible", viewportTop: 90, scrollTop: 200 });
        expect(container.scrollTop).toBe(200);
    });

    it("falls back to captured scrollTop when the anchored cell is gone", () => {
        container.scrollTop = 40;
        restoreScrollAnchor(container, { cellId: "missing", viewportTop: 90, scrollTop: 200 });
        expect(container.scrollTop).toBe(200);
    });
});
