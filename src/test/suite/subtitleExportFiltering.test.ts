import * as assert from "assert";
import { CodexCellTypes } from "../../../types/enums";
import { generateSrtData } from "../../exportHandler/subtitleUtils";
import { generateVttData } from "../../exportHandler/vttUtils";
import type { CodexNotebookAsJSONData } from "../../../types";

type Cell = CodexNotebookAsJSONData["cells"][number];

const makeTextCell = (
    id: string,
    value: string,
    startTime: number,
    endTime: number
): Cell => ({
    kind: 2,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
        data: { startTime, endTime },
    },
});

const makeMilestoneCell = (id: string, label: string): Cell => ({
    kind: 2,
    languageId: "html",
    value: label,
    metadata: {
        id,
        type: CodexCellTypes.MILESTONE,
        edits: [],
    },
});

const makeMergedCell = (
    id: string,
    value: string,
    startTime: number,
    endTime: number
): Cell => ({
    kind: 2,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
        data: { startTime, endTime, merged: true },
    },
});

const makeCellWithoutTimestamps = (id: string, value: string): Cell => ({
    kind: 2,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
    },
});

const makeLabeledTextCell = (
    id: string,
    value: string,
    startTime: number,
    endTime: number,
    cellLabel: string
): Cell => ({
    kind: 2,
    languageId: "html",
    value,
    metadata: {
        id,
        type: CodexCellTypes.TEXT,
        edits: [],
        cellLabel,
        data: { startTime, endTime },
    },
});

suite("Subtitle export filtering – milestone and timestamp guards", () => {
    const textCells: Cell[] = [
        makeTextCell("cue-1", "Hello world", 0, 2.5),
        makeTextCell("cue-2", "Second subtitle", 3, 5),
    ];

    // ─── generateSrtData ────────────────────────────────────────────────

    test("SRT: excludes milestone cells", () => {
        const cells: Cell[] = [
            makeMilestoneCell("ms-1", "TheChosen-301-fr 1"),
            ...textCells,
        ];

        const srt = generateSrtData(cells, false);

        assert.ok(!srt.includes("NaN"), "Milestone cell should not produce NaN timestamps");
        assert.ok(
            !srt.includes("TheChosen-301-fr 1"),
            "Milestone label should not appear in SRT output"
        );
        assert.ok(srt.includes("Hello world"), "Normal text cue should be present");
        assert.ok(srt.includes("Second subtitle"), "Normal text cue should be present");
    });

    test("SRT: excludes cells without timestamps", () => {
        const cells: Cell[] = [
            makeCellWithoutTimestamps("no-time", "Orphan text"),
            ...textCells,
        ];

        const srt = generateSrtData(cells, false);

        assert.ok(!srt.includes("NaN"), "Cell without timestamps should not produce NaN");
        assert.ok(!srt.includes("Orphan text"), "Cell without timestamps should be excluded");
        assert.ok(srt.includes("Hello world"));
    });

    test("SRT: excludes merged cells", () => {
        const cells: Cell[] = [makeMergedCell("merged-1", "Merged text", 1, 2), ...textCells];

        const srt = generateSrtData(cells, false);

        assert.ok(!srt.includes("Merged text"), "Merged cell should be excluded from SRT");
        assert.ok(srt.includes("Hello world"));
    });

    test("SRT: outputs correct indices after filtering", () => {
        const cells: Cell[] = [
            makeMilestoneCell("ms-1", "Chapter 1"),
            ...textCells,
        ];

        const srt = generateSrtData(cells, false);
        const lines = srt.split("\n");

        assert.strictEqual(lines[0], "1", "First cue index should be 1, not 2");
        assert.strictEqual(lines[4], "2", "Second cue index should be 2");
    });

    test("SRT: returns empty string when all cells are milestones", () => {
        const cells: Cell[] = [
            makeMilestoneCell("ms-1", "Chapter 1"),
            makeMilestoneCell("ms-2", "Chapter 2"),
        ];

        const srt = generateSrtData(cells, false);

        assert.strictEqual(srt, "", "SRT should be empty when only milestones are present");
    });

    // ─── generateVttData ────────────────────────────────────────────────

    test("VTT: excludes milestone cells (no startTime)", () => {
        const cells: Cell[] = [
            makeMilestoneCell("ms-1", "TheChosen-301-fr 1"),
            ...textCells,
        ];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(!vtt.includes("NaN"), "Milestone cell should not produce NaN timestamps in VTT");
        assert.ok(
            !vtt.includes("TheChosen-301-fr 1"),
            "Milestone label should not appear in VTT output"
        );
        assert.ok(vtt.includes("Hello world"), "Normal text cue should be present in VTT");
    });

    test("VTT: excludes cells without timestamps", () => {
        const cells: Cell[] = [
            makeCellWithoutTimestamps("no-time", "Orphan text"),
            ...textCells,
        ];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(!vtt.includes("Orphan text"), "Cell without timestamps should be excluded from VTT");
        assert.ok(vtt.includes("Hello world"));
    });

    test("VTT: excludes merged cells", () => {
        const cells: Cell[] = [makeMergedCell("merged-1", "Merged text", 1, 2), ...textCells];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(!vtt.includes("Merged text"), "Merged cell should be excluded from VTT");
        assert.ok(vtt.includes("Hello world"));
    });

    test("VTT: header present even when milestones filtered out", () => {
        const cells: Cell[] = [
            makeMilestoneCell("ms-1", "Chapter 1"),
            ...textCells,
        ];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(vtt.startsWith("WEBVTT"), "VTT output should start with WEBVTT header");
    });

    // ─── cellLabel → voice tag ──────────────────────────────────────────

    test("VTT: wraps payload in <v cellLabel>...</v> when cellLabel is set", () => {
        const cells: Cell[] = [
            makeLabeledTextCell("cue-1", "Hello there", 0, 2, "Narrator"),
        ];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(
            vtt.includes("<v Narrator>Hello there</v>"),
            "Cue payload should be wrapped in a voice span with the cellLabel as the speaker"
        );
    });

    test("VTT: omits <v> wrapper when cellLabel is absent", () => {
        const cells: Cell[] = [...textCells];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(
            !vtt.includes("<v "),
            "No voice tag should be emitted for cells without a cellLabel"
        );
        assert.ok(vtt.includes("Hello world"));
        assert.ok(vtt.includes("Second subtitle"));
    });

    test("VTT: sanitizes stray <, >, and newlines out of cellLabel", () => {
        const cells: Cell[] = [
            makeLabeledTextCell("cue-1", "text", 0, 2, "Jane <Smith>\nDoe"),
        ];

        const vtt = generateVttData(cells, false, false, "test.codex");

        assert.ok(
            vtt.includes("<v Jane Smith Doe>text</v>"),
            "Voice-tag annotation should have <, >, and newlines stripped"
        );
    });
});
