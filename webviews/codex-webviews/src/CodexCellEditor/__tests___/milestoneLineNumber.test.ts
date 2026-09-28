import { describe, expect, it } from "vitest";
import { CodexCellTypes } from "../../../../../types/enums";
import {
    lineNumberWithinCellRange,
    milestoneContentStartIndex,
} from "../../../../../src/providers/codexCellEditorProvider/utils/cellUtils";

type TestCell = {
    metadata?: {
        id?: string;
        type?: string;
        parentId?: string;
        data?: {
            parentId?: string;
            merged?: boolean;
            hidden?: boolean;
            deleted?: boolean;
        };
    };
};

const text = (id: string): TestCell => ({
    metadata: { id, type: CodexCellTypes.TEXT },
});

const milestone = (id: string): TestCell => ({
    metadata: { id, type: CodexCellTypes.MILESTONE },
});

const paratext = (id: string): TestCell => ({
    metadata: { id, type: CodexCellTypes.PARATEXT },
});

describe("milestone line numbers used outside the editor", () => {
    it("restarts at each Bible chapter and skips headings and split cells", () => {
        const cells: TestCell[] = [
            milestone("ms-1"),
            text("gen1-1"),
            paratext("gen1-heading"),
            text("gen1-2"),
            milestone("ms-2"),
            paratext("gen2-heading"),
            text("gen2-1"),
            { metadata: { id: "gen2-1a", type: CodexCellTypes.TEXT, parentId: "gen2-1" } },
            text("gen2-2"),
        ];

        const chapter2Start = milestoneContentStartIndex(cells, 4);
        expect(chapter2Start).toBe(5);
        expect(lineNumberWithinCellRange(cells, "gen2-1", chapter2Start, cells.length)).toBe(1);
        expect(lineNumberWithinCellRange(cells, "gen2-2", chapter2Start, cells.length)).toBe(2);
        expect(lineNumberWithinCellRange(cells, "gen2-heading", chapter2Start, cells.length)).toBeUndefined();
        expect(lineNumberWithinCellRange(cells, "gen2-1a", chapter2Start, cells.length)).toBeUndefined();
        expect(lineNumberWithinCellRange(cells, "gen1-2", 1, 4)).toBe(2);
    });

    it("numbers an IDML chapter without counting section headings or merged cells", () => {
        const cells: TestCell[] = [
            milestone("ms"),
            paratext("heading"),
            text("p1"),
            { metadata: { id: "p2", type: CodexCellTypes.TEXT, data: { merged: true } } },
            { metadata: { id: "p3", type: CodexCellTypes.TEXT, data: { deleted: true } } },
            text("p4"),
        ];
        const start = milestoneContentStartIndex(cells, 0);
        expect(lineNumberWithinCellRange(cells, "p1", start, cells.length)).toBe(1);
        expect(lineNumberWithinCellRange(cells, "p4", start, cells.length)).toBe(2);
        expect(lineNumberWithinCellRange(cells, "p2", start, cells.length)).toBeUndefined();
    });

    it("numbers a single audio milestone from its first segment", () => {
        const cells: TestCell[] = [milestone("episode"), text("seg-1"), text("seg-2"), text("seg-3")];
        const start = milestoneContentStartIndex(cells, 0);
        expect(lineNumberWithinCellRange(cells, "seg-1", start, cells.length)).toBe(1);
        expect(lineNumberWithinCellRange(cells, "seg-3", start, cells.length)).toBe(3);
    });

    it("numbers a file with no milestone header from the first cell", () => {
        const cells: TestCell[] = [text("seg-1"), text("seg-2")];
        const start = milestoneContentStartIndex(cells, 0);
        expect(start).toBe(0);
        expect(lineNumberWithinCellRange(cells, "seg-1", start, cells.length)).toBe(1);
        expect(lineNumberWithinCellRange(cells, "seg-2", start, cells.length)).toBe(2);
    });
});
