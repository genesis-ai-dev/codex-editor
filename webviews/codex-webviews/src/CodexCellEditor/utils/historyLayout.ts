/** Measure the single-row width without changing the visible entries. */
export function historyNeedsStackedLayout(panel: HTMLElement): boolean {
    return Array.from(panel.querySelectorAll<HTMLElement>(".codex-history-entry-header"))
        .some((header) => {
            const probe = header.cloneNode(true) as HTMLElement;
            probe.setAttribute("aria-hidden", "true");
            probe.inert = true;
            Object.assign(probe.style, {
                position: "absolute",
                visibility: "hidden",
                pointerEvents: "none",
                width: "max-content",
                maxWidth: "none",
                flexDirection: "row",
                flexWrap: "nowrap",
                font: getComputedStyle(header).font,
            });
            for (const child of Array.from(probe.children) as HTMLElement[]) {
                Object.assign(child.style, {
                    flex: "0 0 auto",
                    width: "max-content",
                    maxWidth: "none",
                    whiteSpace: "nowrap",
                    flexWrap: "nowrap",
                });
            }
            panel.appendChild(probe);
            try {
                return probe.getBoundingClientRect().width > header.getBoundingClientRect().width + 1;
            } finally {
                probe.remove();
            }
        });
}
