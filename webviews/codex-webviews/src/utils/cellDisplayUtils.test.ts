import { describe, it, expect } from "vitest";
import { getCellDisplayLabel } from "./cellDisplayUtils";

describe("getCellDisplayLabel", () => {
    describe("Priority 1: full display info", () => {
        it("shows fileDisplayName · milestoneValue · Line N when all fields present", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:3",
                    fileDisplayName: "Genesis",
                    milestoneValue: "Genesis 1",
                    cellLineNumber: 3,
                })
            ).toBe("Genesis · Genesis 1 · Line 3");
        });
    });

    describe("Priority 2: partial display info", () => {
        it("shows milestoneValue · Line N when fileDisplayName is missing", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:3",
                    milestoneValue: "Genesis 1",
                    cellLineNumber: 3,
                })
            ).toBe("Genesis 1 · Line 3");
        });

        it("shows fileDisplayName · Line N when milestoneValue is missing", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:3",
                    fileDisplayName: "Genesis",
                    cellLineNumber: 3,
                })
            ).toBe("Genesis · Line 3");
        });
    });

    describe("Priority 3: cellLabel from metadata", () => {
        it("shows cellLabel when display info is absent", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:5",
                    cellLabel: "5",
                })
            ).toBe("5");
        });

        it("shows cellLabel even for narrator/character labels", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "some-uuid-1234567890",
                    cellLabel: "Narrator",
                })
            ).toBe("Narrator");
        });

        it("ignores empty cellLabel and falls through to next priority", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:1",
                    cellLabel: "  ",
                    globalReferences: ["GEN 1:1"],
                })
            ).toBe("Gen 1:1");
        });
    });

    describe("Priority 4: globalReferences", () => {
        it("formats a single reference (ALL_CAPS → Title Case)", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "some-uuid-1234567890",
                    globalReferences: ["GEN 1:1"],
                })
            ).toBe("Gen 1:1");
        });

        it("joins multiple references with a comma", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "some-uuid-1234567890",
                    globalReferences: ["GEN 1:1", "GEN 1:2"],
                })
            ).toBe("Gen 1:1, Gen 1:2");
        });

        it("handles mixed-case book codes", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "some-uuid-1234567890",
                    globalReferences: ["NUM 1:7"],
                })
            ).toBe("Num 1:7");
        });
    });

    describe("Priority 5: cellId fallback (the former NO LABEL case)", () => {
        it("formats a short verse-style cellId as a reference", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "GEN 1:1",
                })
            ).toBe("Gen 1:1");
        });

        it("shortens long UUID-style cellIds instead of showing raw UUID", () => {
            const result = getCellDisplayLabel({
                cellId: "550e8400-e29b-41d4-a716-446655440000",
            });
            expect(result).toBe("...55440000");
            // Must NOT produce the old "[NO LABEL: ...]" format
            expect(result).not.toContain("NO LABEL");
        });

        it("never produces the old [NO LABEL] fallback string", () => {
            const result = getCellDisplayLabel({
                cellId: "abc-def-ghi-jkl-mno",
            });
            expect(result).not.toContain("NO LABEL");
        });
    });

    describe("string input (legacy format)", () => {
        it("returns short string as-is", () => {
            expect(getCellDisplayLabel("GEN 1:1")).toBe("Gen 1:1");
        });

        it("shortens long string to last 8 chars", () => {
            expect(getCellDisplayLabel("550e8400-e29b-41d4-a716-446655440000")).toBe(
                "...55440000"
            );
        });
    });

    describe("empty / edge cases", () => {
        it("returns 'Unknown cell' for empty cellId with no fallbacks", () => {
            expect(
                getCellDisplayLabel({
                    cellId: "",
                })
            ).toBe("Unknown cell");
        });

        it("returns 'Unknown cell' for empty string input", () => {
            expect(getCellDisplayLabel("")).toBe("Unknown cell");
        });
    });
});
