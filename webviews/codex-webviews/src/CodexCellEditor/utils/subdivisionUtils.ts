import type { MilestoneInfo } from "../../../../../types";
import type { Subsection } from "../../lib/types";

/**
 * Builds the UI-facing `Subsection` list for a milestone. Prefers
 * provider-computed subdivisions (custom user breaks and/or the arithmetic
 * fallback produced by the resolver) and falls back to a local arithmetic
 * calculation only when those are absent — typically during the narrow window
 * between loading the webview and receiving the first `milestoneIndex` update.
 *
 * Returns:
 * - exactly one zero-range subsection for empty milestones, so the UI never
 *   renders a nonsensical `"1-0"` label;
 * - subsections whose `label` is always a numeric `"<start>-<end>"` range,
 *   regardless of whether a `name` is present. Callers decide whether to
 *   display `name` in place of `label`.
 */
export function buildSubsectionsForMilestone(
    milestoneIdx: number,
    milestone: MilestoneInfo | undefined,
    cellsPerPage: number
): Subsection[] {
    if (!milestone) return [];

    const { cellCount } = milestone;

    if (cellCount === 0) {
        return [
            {
                id: `milestone-${milestoneIdx}-page-0`,
                label: "0",
                startIndex: 0,
                endIndex: 0,
            },
        ];
    }

    // Resolver-provided subdivisions already encode both custom and arithmetic
    // layouts; trust them when available.
    if (milestone.subdivisions && milestone.subdivisions.length > 0) {
        return milestone.subdivisions.map((sub, i) => {
            const startCellNumber = sub.startRootIndex + 1;
            const endCellNumber = sub.endRootIndex;
            return {
                id: `milestone-${milestoneIdx}-page-${i}`,
                label: `${startCellNumber}-${endCellNumber}`,
                startIndex: sub.startRootIndex,
                endIndex: sub.endRootIndex,
                name: sub.name,
                key: sub.key,
                startCellId: sub.startCellId,
                source: sub.source,
            };
        });
    }

    // Legacy fallback for stale milestoneIndex payloads missing `subdivisions`.
    const pageSize = Math.max(1, cellsPerPage);
    const totalPages = Math.ceil(cellCount / pageSize) || 1;
    const subsections: Subsection[] = [];
    for (let i = 0; i < totalPages; i++) {
        const startCellNumber = i * pageSize + 1;
        const endCellNumber = Math.min((i + 1) * pageSize, cellCount);
        subsections.push({
            id: `milestone-${milestoneIdx}-page-${i}`,
            label: `${startCellNumber}-${endCellNumber}`,
            startIndex: i * pageSize,
            endIndex: endCellNumber,
        });
    }
    return subsections;
}
