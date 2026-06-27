import { describe, it, expect } from "vitest";
import type { MilestoneInfo, SubdivisionInfo } from "../../../../../types";
import { buildSubsectionsForMilestone } from "./subdivisionUtils";

const makeMilestone = (
    overrides: Partial<MilestoneInfo> = {},
    subdivisions?: SubdivisionInfo[]
): MilestoneInfo => ({
    value: "Luke 1",
    cellIndex: 0,
    cellCount: 10,
    firstCellId: "v1",
    subdivisions,
    ...overrides,
});

describe("buildSubsectionsForMilestone", () => {
    it("returns [] when milestone is undefined", () => {
        const subs = buildSubsectionsForMilestone(0, undefined, 50);
        expect(subs).toEqual([]);
    });

    it("returns a single zero-range subsection for empty milestones", () => {
        const subs = buildSubsectionsForMilestone(0, makeMilestone({ cellCount: 0 }), 50);
        expect(subs).toHaveLength(1);
        expect(subs[0].label).toBe("0");
        expect(subs[0].startIndex).toBe(0);
        expect(subs[0].endIndex).toBe(0);
    });

    it("prefers resolver subdivisions over arithmetic fallback", () => {
        const subs = buildSubsectionsForMilestone(
            0,
            makeMilestone({ cellCount: 10 }, [
                {
                    index: 0,
                    startRootIndex: 0,
                    endRootIndex: 5,
                    key: "__start__",
                    startCellId: "v1",
                    name: "Beginning",
                    source: "custom",
                },
                {
                    index: 1,
                    startRootIndex: 5,
                    endRootIndex: 10,
                    key: "v6",
                    startCellId: "v6",
                    source: "custom",
                },
            ]),
            50
        );
        expect(subs).toHaveLength(2);
        expect(subs[0].label).toBe("1-5");
        expect(subs[0].name).toBe("Beginning");
        expect(subs[0].startCellId).toBe("v1");
        expect(subs[0].source).toBe("custom");
        expect(subs[1].label).toBe("6-10");
        expect(subs[1].key).toBe("v6");
        expect(subs[1].name).toBeUndefined();
    });

    it("falls back to arithmetic pagination when no subdivisions are provided", () => {
        const subs = buildSubsectionsForMilestone(
            0,
            makeMilestone({ cellCount: 125 }, undefined),
            50
        );
        expect(subs).toHaveLength(3);
        expect(subs.map((s) => s.label)).toEqual(["1-50", "51-100", "101-125"]);
        expect(subs.map((s) => [s.startIndex, s.endIndex])).toEqual([
            [0, 50],
            [50, 100],
            [100, 125],
        ]);
    });

    it("arithmetic label matches resolver output for the no-custom-breaks case", () => {
        // When the resolver produces auto-only subdivisions, the labels must
        // match what the legacy arithmetic path produced. Guarantees no UI
        // regression for notebooks without custom breaks.
        const arithmetic = buildSubsectionsForMilestone(0, makeMilestone({ cellCount: 125 }), 50);
        const resolverEquivalent = buildSubsectionsForMilestone(
            0,
            makeMilestone({ cellCount: 125 }, [
                { index: 0, startRootIndex: 0, endRootIndex: 50, key: "__start__", startCellId: "v1", source: "auto" },
                { index: 1, startRootIndex: 50, endRootIndex: 100, key: "v51", startCellId: "v51", source: "auto" },
                { index: 2, startRootIndex: 100, endRootIndex: 125, key: "v101", startCellId: "v101", source: "auto" },
            ]),
            50
        );
        expect(resolverEquivalent.map((s) => s.label)).toEqual(arithmetic.map((s) => s.label));
        expect(resolverEquivalent.map((s) => [s.startIndex, s.endIndex])).toEqual(
            arithmetic.map((s) => [s.startIndex, s.endIndex])
        );
    });

    it("assigns stable IDs based on milestone index", () => {
        const subs = buildSubsectionsForMilestone(2, makeMilestone({ cellCount: 100 }), 50);
        expect(subs.map((s) => s.id)).toEqual(["milestone-2-page-0", "milestone-2-page-1"]);
    });

    it("handles cellsPerPage=0 gracefully by clamping to 1", () => {
        const subs = buildSubsectionsForMilestone(0, makeMilestone({ cellCount: 3 }), 0);
        expect(subs).toHaveLength(3);
    });
});
