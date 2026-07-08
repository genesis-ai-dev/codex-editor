import * as assert from "assert";
import { resolveCodexCustomMerge } from "../../../src/projectManager/utils/merge/resolvers";

/**
 * Issue #1079 — "Tripuri project: episode repeats x 3".
 *
 * A wholesale re-import of a subtitle document regenerates every cell id. The
 * merge resolver keyed cells only by id, so syncing a re-imported file against
 * a stale clone unioned the two copies: every cue duplicated, an extra
 * milestone, the episode repeated. These tests cover the content-key alignment
 * that now folds re-imported cells into their existing counterparts.
 */

let idCounter = 0;
const freshId = () => `test-uuid-${String(++idCounter).padStart(4, "0")}`;

function cueCell(opts: {
    id?: string;
    start: number;
    end: number;
    value?: string;
    edits?: any[];
    deleted?: boolean;
    cellLabel?: string;
}) {
    return {
        kind: 2,
        languageId: "html",
        value: opts.value ?? "",
        metadata: {
            type: "text",
            id: opts.id ?? freshId(),
            ...(opts.cellLabel ? { cellLabel: opts.cellLabel } : {}),
            data: {
                startTime: opts.start,
                endTime: opts.end,
                ...(opts.deleted ? { deleted: true } : {}),
            },
            edits: opts.edits ?? [],
        },
    };
}

function milestoneCell(value: string, id?: string) {
    return {
        kind: 2,
        languageId: "html",
        value,
        metadata: { type: "milestone", id: id ?? freshId(), data: {}, edits: [] },
    };
}

function notebook(cells: any[]) {
    return JSON.stringify({
        cells,
        metadata: { id: "TheChosen-105-en-5-2", originalName: "TEST", importerType: "subtitles" },
    });
}

function valueEdit(value: string, timestamp: number, author = "tester") {
    return { editMap: ["value"], value, timestamp, type: "user-edit", author, validatedBy: [] };
}

function deleteEdit(timestamp: number, author = "tester") {
    return {
        editMap: ["metadata", "data", "deleted"],
        value: true,
        timestamp,
        type: "user-edit",
        author,
        validatedBy: [],
    };
}

suite("resolveCodexCustomMerge — re-import content alignment (#1079)", () => {
    test("a re-imported document (all-new ids, same cues) does NOT duplicate the file", async () => {
        const ours = [
            milestoneCell("1", "our-ms"),
            cueCell({ id: "our-1", start: 10.5, end: 12.25, value: "<span>translated one</span>", edits: [valueEdit("<span>translated one</span>", 1000)], cellLabel: "JESUS" }),
            cueCell({ id: "our-2", start: 13.0, end: 15.75, value: "<span>translated two</span>", edits: [valueEdit("<span>translated two</span>", 1001)] }),
            cueCell({ id: "our-3", start: 16.1, end: 18.0 }),
        ];
        // the re-import: identical cues + one genuinely new cue, every id fresh
        const theirs = [
            milestoneCell("1"),
            cueCell({ start: 10.5, end: 12.25 }),
            cueCell({ start: 13.0, end: 15.75 }),
            cueCell({ start: 16.1, end: 18.0 }),
            cueCell({ start: 19.0, end: 21.0 }), // new cue only in the re-import
        ];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        const cells = merged.cells;

        const milestones = cells.filter((c: any) => c.metadata?.type === "milestone");
        assert.strictEqual(milestones.length, 1, "milestone must not be duplicated");
        assert.strictEqual(milestones[0].metadata.id, "our-ms", "our milestone id is canonical");

        assert.strictEqual(cells.length, 5, "3 aligned cues + 1 milestone + 1 new cue");

        const our1 = cells.find((c: any) => c.metadata?.id === "our-1");
        assert.ok(our1, "aligned cue keeps OUR id");
        assert.strictEqual(our1.value, "<span>translated one</span>", "translation survives the re-import");
        assert.strictEqual(our1.metadata.cellLabel, "JESUS", "speaker label survives");

        const timings = cells
            .filter((c: any) => c.metadata?.type === "text")
            .map((c: any) => `${c.metadata.data.startTime}-${c.metadata.data.endTime}`);
        assert.strictEqual(new Set(timings).size, timings.length, "no duplicated cue timings");
        assert.ok(
            timings.includes("19-21"),
            "the genuinely new cue from the re-import is still added"
        );
    });

    test("divergent edits on an aligned cue resolve by newest edit, histories union", async () => {
        const ours = [
            cueCell({ id: "our-1", start: 5, end: 7, value: "<span>old rendering</span>", edits: [valueEdit("<span>old rendering</span>", 1000)] }),
        ];
        const theirs = [
            cueCell({ start: 5, end: 7, value: "<span>newer rendering</span>", edits: [valueEdit("<span>newer rendering</span>", 2000)] }),
        ];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        assert.strictEqual(merged.cells.length, 1);
        const cell = merged.cells[0];
        assert.strictEqual(cell.metadata.id, "our-1");
        assert.strictEqual(cell.value, "<span>newer rendering</span>", "newest edit wins");
        const editValues = cell.metadata.edits.map((e: any) => e.value);
        assert.ok(editValues.includes("<span>old rendering</span>"), "older edit stays in history");
        assert.ok(editValues.includes("<span>newer rendering</span>"));
    });

    test("a live re-imported cue does NOT fold into a tombstoned cell (no cross-cell delete transfer)", async () => {
        // deletion semantics travel only via same-id merges; a tombstone on one
        // physical cell must never swallow a different live cell that shares its
        // timing — the incoming cue is inserted as its own live cell instead
        const ours = [
            cueCell({ id: "our-1", start: 5, end: 7, deleted: true, edits: [deleteEdit(5000)] }),
        ];
        const theirs = [cueCell({ start: 5, end: 7 })];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        assert.strictEqual(merged.cells.length, 2, "incoming live cue is inserted, not folded");
        const tomb = merged.cells.find((c: any) => c.metadata.id === "our-1");
        assert.strictEqual(tomb.metadata.data.deleted, true, "our tombstone is untouched");
        const live = merged.cells.find((c: any) => c.metadata.id !== "our-1");
        assert.ok(!live.metadata.data?.deleted, "the re-imported cue stays live");
    });

    test("REGRESSION (Tripuri collision): incoming tombstoned duplicates must not kill live cells", async () => {
        // One clone repaired by hard-removing duplicates (kept copy A live);
        // the other side carries the tombstoned duplicate copies (repair via
        // soft-delete) whose delete edits are NEWER than A's content. The
        // tombstoned copies must insert as-is — never fold into live copy A.
        const ours = [
            milestoneCell("TheChosen-103-en-5-2 1", "ms-A"),
            cueCell({ id: "cue-A", start: 10, end: 12, value: "<span>translated</span>", edits: [valueEdit("<span>translated</span>", 1000)], cellLabel: "JESUS" }),
        ];
        const theirs = [
            milestoneCell("TheChosen-103-en-5-2 1", "ms-A"), // same id — normal merge
            cueCell({ id: "cue-A", start: 10, end: 12, value: "<span>translated</span>", edits: [valueEdit("<span>translated</span>", 1000)], cellLabel: "JESUS" }),
            // their-unique tombstoned duplicate copy of the same cue, newer delete edit
            cueCell({ id: "cue-C", start: 10, end: 12, deleted: true, edits: [deleteEdit(9000)] }),
            // their-unique tombstoned duplicate milestone, same chapter number
            { ...milestoneCell("1", "ms-C"), metadata: { type: "milestone", id: "ms-C", data: { deleted: true }, edits: [deleteEdit(9000)] } },
        ];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        const byId = (id: string) => merged.cells.find((c: any) => c.metadata?.id === id);

        const cueA = byId("cue-A");
        assert.ok(!cueA.metadata.data?.deleted, "live copy A must STAY LIVE");
        assert.strictEqual(cueA.value, "<span>translated</span>", "translation intact");
        const msA = byId("ms-A");
        assert.ok(!msA.metadata.data?.deleted, "live milestone must stay live");
        assert.strictEqual(byId("cue-C").metadata.data.deleted, true, "duplicate copy inserted as tombstone");
        assert.strictEqual(byId("ms-C").metadata.data.deleted, true, "duplicate milestone inserted as tombstone");
    });

    test("ambiguous timing keys (already-damaged file) fall back to the old insert behavior", async () => {
        const ours = [
            cueCell({ id: "our-1", start: 5, end: 7, value: "<span>copy one</span>" }),
            cueCell({ id: "our-2", start: 5, end: 7, value: "<span>copy two</span>" }), // pre-existing damage
        ];
        const theirs = [cueCell({ start: 5, end: 7 })];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        // we must NOT guess which copy to merge into — the incoming cell is inserted
        assert.strictEqual(merged.cells.length, 3, "no silent merge when the target is ambiguous");
        const values = merged.cells.map((c: any) => c.value);
        assert.ok(values.includes("<span>copy one</span>"));
        assert.ok(values.includes("<span>copy two</span>"));
    });

    test("a repaired file (live cell + tombstoned twin on the same cue) aligns to the LIVE cell", async () => {
        // after the #1079 repair, copy-C duplicates remain as tombstones sharing
        // the live copy-A cell's timing key — a later re-import must fold into the
        // live cell, not bounce off as "ambiguous" and duplicate the file again
        const ours = [
            cueCell({ id: "our-live", start: 5, end: 7, value: "<span>kept translation</span>", edits: [valueEdit("<span>kept translation</span>", 1000)] }),
            cueCell({ id: "our-tombstone", start: 5, end: 7, deleted: true, edits: [deleteEdit(2000)] }),
        ];
        const theirs = [cueCell({ start: 5, end: 7 })];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        assert.strictEqual(merged.cells.length, 2, "no third copy is inserted");
        const live = merged.cells.find((c: any) => c.metadata.id === "our-live");
        assert.strictEqual(live.value, "<span>kept translation</span>");
        assert.ok(!live.metadata.data.deleted, "live cell stays live");
        const tomb = merged.cells.find((c: any) => c.metadata.id === "our-tombstone");
        assert.strictEqual(tomb.metadata.data.deleted, true, "tombstone untouched");
    });

    test("cells without timing data (Bible projects) keep the existing id-only behavior", async () => {
        const verse = (id: string, value: string) => ({
            kind: 2,
            languageId: "html",
            value,
            metadata: { type: "text", id, data: { globalReferences: [id] }, edits: [] },
        });
        const ours = [verse("GEN 1:1", "<span>in the beginning</span>")];
        const theirs = [verse("GEN 1:2", "<span>and the earth</span>")];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        assert.strictEqual(merged.cells.length, 2, "verse cells are unioned by id as before");
    });

    test("milestones with different chapter numbers are still treated as distinct", async () => {
        const ours = [milestoneCell("TheChosen-103-en-5-2 1", "our-ms-1")];
        const theirs = [milestoneCell("2")];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        const milestones = merged.cells.filter((c: any) => c.metadata?.type === "milestone");
        assert.strictEqual(milestones.length, 2, "a genuinely new chapter milestone is added");
    });

    test("a re-imported bare-'1' milestone aligns with the long-form '<docName> 1' milestone", async () => {
        // the importer names milestones "1"; the milestone migration names them
        // "<docName> <chapter>" — the same chapter must align across formats
        const ours = [milestoneCell("TheChosen-103-en-5-2 1", "our-ms-1")];
        const theirs = [milestoneCell("1")];

        const merged = JSON.parse(await resolveCodexCustomMerge(notebook(ours), notebook(theirs)));
        const milestones = merged.cells.filter((c: any) => c.metadata?.type === "milestone");
        assert.strictEqual(milestones.length, 1, "same chapter in both formats must not duplicate");
        assert.strictEqual(milestones[0].metadata.id, "our-ms-1", "our milestone id is canonical");
        assert.strictEqual(
            milestones[0].value,
            "TheChosen-103-en-5-2 1",
            "our long-form name survives (their import cell has no newer value edit)"
        );
    });
});
