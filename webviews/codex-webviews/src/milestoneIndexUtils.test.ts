import { describe, it, expect } from "vitest";
import {
    buildMilestoneIndexModel,
    hasSelectableMilestonesInCells,
} from "../../../sharedUtils/milestoneIndexUtils";
import { CodexCellTypes } from "../../../types/enums";

function milestoneCell(value: string) {
    return {
        kind: 2,
        value,
        metadata: {
            type: CodexCellTypes.MILESTONE,
            data: {},
        },
    };
}

function contentCell(id: string) {
    return {
        kind: 2,
        value: "verse",
        metadata: {
            type: "text",
            id,
            data: { globalReferences: [id] },
        },
    };
}

describe("hasSelectableMilestonesInCells", () => {
    it("returns true for a notebook with one explicit milestone chapter", () => {
        const cells = [
            milestoneCell("Chapter 1"),
            contentCell("MAT 1:1"),
            contentCell("MAT 1:2"),
        ];
        expect(buildMilestoneIndexModel(cells).milestones).toHaveLength(1);
        expect(hasSelectableMilestonesInCells(cells)).toBe(true);
    });

    it("returns true for multiple explicit milestones", () => {
        const cells = [
            milestoneCell("Chapter 1"),
            contentCell("MAT 1:1"),
            milestoneCell("Chapter 2"),
            contentCell("MAT 2:1"),
        ];
        expect(hasSelectableMilestonesInCells(cells)).toBe(true);
    });

    it("returns false when only the synthetic single-chapter fallback applies", () => {
        const cells = [
            {
                kind: 2,
                value: "plain",
                metadata: { type: "text", data: {} },
            },
        ];
        expect(buildMilestoneIndexModel(cells).milestones).toHaveLength(1);
        expect(hasSelectableMilestonesInCells(cells)).toBe(false);
    });
});
