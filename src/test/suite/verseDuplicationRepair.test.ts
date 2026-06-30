import * as assert from "assert";
import { planVerseDuplicationRepair } from "../../projectManager/utils/merge/utils/verseDuplicationRepair";
import { CodexCellTypes } from "../../../types/enums";

// Builds a live (or soft-deleted) verse text cell with a globalReference.
function vCell(id: string, globalRef: string, value: string, deleted = false) {
    return {
        kind: 2,
        languageId: "scripture",
        value,
        metadata: {
            id,
            type: CodexCellTypes.TEXT,
            data: {
                globalReferences: [globalRef],
                ...(deleted ? { deleted: true } : {}),
            },
            edits: [],
        },
    };
}

suite("planVerseDuplicationRepair - issue #848 verse-range/single duplication", () => {
    test("content in the RANGE, empty singles -> tombstone the empty singles", () => {
        const plan = planVerseDuplicationRepair([
            vCell("r", "MAT 8:14-15", "<p>translated</p>"),
            vCell("s14", "MAT 8:14", ""),
            vCell("s15", "MAT 8:15", ""),
        ]);
        assert.deepStrictEqual(plan.tombstoneIds.sort(), ["s14", "s15"]);
        assert.strictEqual(plan.conflicts.length, 0);
    });

    test("content in the SINGLES, empty range -> tombstone the empty range", () => {
        const plan = planVerseDuplicationRepair([
            vCell("r", "MAT 13:1-2", ""),
            vCell("s1", "MAT 13:1", "<p>a</p>"),
            vCell("s2", "MAT 13:2", "<p>b</p>"),
        ]);
        assert.deepStrictEqual(plan.tombstoneIds, ["r"]);
        assert.strictEqual(plan.conflicts.length, 0);
    });

    test("content in BOTH forms (overlap) -> reported as a conflict, nothing tombstoned", () => {
        const plan = planVerseDuplicationRepair([
            vCell("r", "MAT 12:46-47", "<p>both verses</p>"),
            vCell("s46", "MAT 12:46", "<p>first</p>"),
            vCell("s47", "MAT 12:47", "<p>second</p>"),
        ]);
        assert.strictEqual(plan.tombstoneIds.length, 0);
        assert.strictEqual(plan.conflicts.length, 1);
        assert.strictEqual(plan.conflicts[0].chapter, 12);
    });

    test("both forms empty -> keep the chapter's dominant form (single), drop the empty range", () => {
        const plan = planVerseDuplicationRepair([
            vCell("c1", "MAT 1:1", "<p>content</p>"), // makes single the dominant form in ch1
            vCell("r", "MAT 1:5-6", ""),
            vCell("s5", "MAT 1:5", ""),
            vCell("s6", "MAT 1:6", ""),
        ]);
        assert.deepStrictEqual(plan.tombstoneIds, ["r"]);
    });

    test("no duplication (distinct verses) -> empty plan", () => {
        const plan = planVerseDuplicationRepair([
            vCell("a", "MAT 1:1", "<p>a</p>"),
            vCell("b", "MAT 1:2", "<p>b</p>"),
        ]);
        assert.strictEqual(plan.tombstoneIds.length, 0);
        assert.strictEqual(plan.conflicts.length, 0);
    });

    test("idempotent: already soft-deleted duplicates are ignored", () => {
        const plan = planVerseDuplicationRepair([
            vCell("r", "MAT 8:14-15", "<p>translated</p>"),
            vCell("s14", "MAT 8:14", "", true),
            vCell("s15", "MAT 8:15", "", true),
        ]);
        assert.strictEqual(plan.tombstoneIds.length, 0);
        assert.strictEqual(plan.conflicts.length, 0);
    });

    test("never tombstones a content cell even across a 3-way mixed cluster", () => {
        // Range has content; one single empty, one single has its own content. The
        // empty single is covered by the range, but the content single overlaps the
        // range -> conflict guard fires, so nothing is tombstoned.
        const plan = planVerseDuplicationRepair([
            vCell("r", "MAT 5:1-2", "<p>combined</p>"),
            vCell("s1", "MAT 5:1", ""),
            vCell("s2", "MAT 5:2", "<p>verse 2</p>"),
        ]);
        assert.strictEqual(plan.conflicts.length, 1);
        assert.strictEqual(plan.tombstoneIds.length, 0);
    });

    test("multi-book file: same chapter:verse in different books are NOT treated as duplicates", () => {
        const plan = planVerseDuplicationRepair([
            vCell("g", "GEN 1:1", "<p>in the beginning</p>"),
            vCell("e", "EXO 1:1", "<p>these are the names</p>"),
            vCell("er", "EXO 1:1-2", "<p>names range</p>"), // range only collides within EXO
        ]);
        // GEN 1:1 must not collide with EXO 1:1; the EXO range+single overlap is a conflict (both content).
        assert.strictEqual(plan.tombstoneIds.length, 0);
        assert.strictEqual(plan.conflicts.length, 1);
        assert.strictEqual(plan.conflicts[0].refs.every((r) => r.startsWith("EXO")), true);
    });

    test("pure-single overlap with no range cell (e.g. study notes) is left untouched", () => {
        const plan = planVerseDuplicationRepair([
            vCell("a", "MAT 1:1", "<p>verse</p>"),
            vCell("b", "MAT 1:1", "<p>study note on the verse</p>"),
            vCell("c", "MAT 1:1", ""), // empty cell sharing the ref — must NOT be tombstoned
        ]);
        assert.strictEqual(plan.tombstoneIds.length, 0);
        assert.strictEqual(plan.conflicts.length, 0);
    });
});
