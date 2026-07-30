import * as assert from "assert";
import { matchCellLabels } from "../../cellLabelImporter/matcher";
import {
    convertTimestampToSeconds,
    detectTimecodeFrameRate,
    isStartTimeHeader,
    isTimeishHeader,
    looksLikeTimecodeValue,
} from "../../cellLabelImporter/utils";
import type { FileData, ImportedRow } from "../../cellLabelImporter/types";

const cell = (id: string, value: string, startTime: number, endTime: number) => ({
    value,
    metadata: { id, type: "text", edits: [], data: { startTime, endTime } },
});

const sourceFile = (cells: ReturnType<typeof cell>[]): FileData =>
    ({ uri: { fsPath: "/project/episode.source" }, cells } as unknown as FileData);

const labelsFor = async (rows: ImportedRow[], cells: ReturnType<typeof cell>[], column: string) =>
    matchCellLabels(rows, [sourceFile(cells)], [], column);

suite("cellLabelImporter — timestamp parsing", () => {
    test("parses SMPTE timecode using the supplied frame rate", () => {
        // 5 frames at 24fps = 0.2083s past the 63s mark
        assert.ok(Math.abs(convertTimestampToSeconds("00:01:03:05", 24) - 63.2083) < 0.001);
        // The same timecode at 30fps is a different instant
        assert.ok(Math.abs(convertTimestampToSeconds("00:01:03:05", 30) - 63.1667) < 0.001);
    });

    test("SMPTE without a frame rate falls back to the default rather than zero", () => {
        // Regression: this previously fell through to parseFloat and returned 0, silently
        // dropping every row in the file.
        assert.ok(convertTimestampToSeconds("00:01:03:05") > 63);
    });

    test("existing timestamp formats are unchanged", () => {
        assert.strictEqual(convertTimestampToSeconds("00:00:41.792"), 41.792);
        assert.strictEqual(convertTimestampToSeconds("00:00:41,792"), 41.792);
        assert.strictEqual(convertTimestampToSeconds("00:01:03"), 63);
        assert.strictEqual(convertTimestampToSeconds("01:03.500"), 63.5);
        assert.strictEqual(convertTimestampToSeconds("63.209"), 63.209);
        assert.strictEqual(convertTimestampToSeconds(""), 0);
    });

    test("frame rate is inferred from the largest frame value seen", () => {
        assert.strictEqual(detectTimecodeFrameRate(["00:00:01:23", "00:00:02:04"]), 24);
        assert.strictEqual(detectTimecodeFrameRate(["00:00:01:24"]), 25);
        assert.strictEqual(detectTimecodeFrameRate(["00:00:01:29"]), 30);
        // Nothing SMPTE in the column at all
        assert.strictEqual(detectTimecodeFrameRate(["00:00:41.792", "63.209", ""]), undefined);
    });
});

suite("cellLabelImporter — header recognition", () => {
    test("recognises dialogue-list timecode headers", () => {
        assert.ok(isTimeishHeader("TC In"));
        assert.ok(isTimeishHeader("TC Out"));
        assert.ok(isTimeishHeader("startTime"));
        // Duplicate headers arrive de-duplicated with a _N suffix
        assert.ok(isTimeishHeader("TC In_1"));
        assert.ok(!isTimeishHeader("Character"));
        assert.ok(!isTimeishHeader("Translation"));
    });

    test("identifies the start column specifically", () => {
        assert.ok(isStartTimeHeader("TC In"));
        assert.ok(isStartTimeHeader("TC In_1"));
        assert.ok(isStartTimeHeader("Start Time"));
        assert.ok(isStartTimeHeader("Time In"));
        assert.ok(!isStartTimeHeader("TC Out"));
        assert.ok(!isStartTimeHeader("Character"));
    });

    test("distinguishes timecode-shaped values from bare numbers", () => {
        assert.ok(looksLikeTimecodeValue("00:01:03:05"));
        assert.ok(looksLikeTimecodeValue("00:01:03.209"));
        assert.ok(!looksLikeTimecodeValue("7"));
        assert.ok(!looksLikeTimecodeValue(""));
    });
});

suite("cellLabelImporter — matching", () => {
    test("imports a dialogue list keyed on TC In with SMPTE timecode", async () => {
        const cells = [cell("a", "Abba?", 63.209, 63.667), cell("b", "Sit down.", 68.876, 69.5)];
        const rows: ImportedRow[] = [
            { "Line #": "10", "TC In": "00:01:03:05", "TC Out": "00:01:03:16", Character: "MARY" },
            { "Line #": "11", "TC In": "00:01:08:21", "TC Out": "00:01:09:12", Character: "FATHER" },
        ];
        const result = await labelsFor(rows, cells, "Character");
        assert.strictEqual(result.length, 2);
        assert.deepStrictEqual(
            result.map((r) => [r.cellId, r.newLabel, r.matched]),
            [
                ["a", "MARY", true],
                ["b", "FATHER", true],
            ]
        );
    });

    test("simultaneous speakers each claim their own cell, in order", async () => {
        // Four characters greet at once; the source holds four cells at one timestamp.
        const cells = [
            cell("c1", "Shalom.", 818.375, 819.417),
            cell("c2", "Shalom.", 818.375, 819.417),
            cell("c3", "Shalom.", 818.375, 819.417),
            cell("c4", "Shalom.", 818.375, 819.417),
        ];
        const rows: ImportedRow[] = ["JOSHUA", "FRIEND #2", "FRIEND #3", "FRIEND #4"].map((c) => ({
            "TC In": "00:13:38:09",
            Character: c,
        }));
        const result = await labelsFor(rows, cells, "Character");
        assert.strictEqual(result.filter((r) => r.matched).length, 4);
        assert.deepStrictEqual(
            result.map((r) => [r.cellId, r.newLabel]),
            [
                ["c1", "JOSHUA"],
                ["c2", "FRIEND #2"],
                ["c3", "FRIEND #3"],
                ["c4", "FRIEND #4"],
            ]
        );
    });

    test("surplus rows at one timestamp stay unmatched instead of overwriting", async () => {
        const cells = [cell("only", "Shalom.", 100, 101)];
        const rows: ImportedRow[] = [
            { "TC In": "00:01:40:00", Character: "FIRST" },
            { "TC In": "00:01:40:00", Character: "SECOND" },
        ];
        const result = await labelsFor(rows, cells, "Character");
        assert.strictEqual(result[0].matched, true);
        assert.strictEqual(result[0].cellId, "only");
        assert.strictEqual(result[1].matched, false, "second row must not steal the first's cell");
    });

    test("a mislabelled column holding line numbers loses to the real timecode column", async () => {
        // Seen in the wild: the header row repeats "TC In", so column A (line numbers) and the
        // real timecode column are both start-time candidates. Reading "7" as 7 seconds matched
        // arbitrary cells and applied wrong labels.
        const cells = [cell("x", "This is the spot.", 30.042, 31.542)];
        const rows: ImportedRow[] = [
            { "TC In": "7", "TC In_1": "00:00:30:01", "TC Out": "00:00:31:13", Character: "JACOB" },
        ];
        const result = await labelsFor(rows, cells, "Character");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].matched, true);
        assert.strictEqual(result[0].cellId, "x");
        assert.strictEqual(result[0].newLabel, "JACOB");
    });

    test("still matches millisecond timestamps via a timeStamp range column", async () => {
        const cells = [cell("v", "What do you make of this?", 41.792, 43.043)];
        const rows: ImportedRow[] = [
            {
                ID: "1",
                Source: "What do you make of this?",
                timeStamp: "00:00:41.792 --> 00:00:43.043",
                "Character Label": "ATTICUS",
            },
        ];
        const result = await labelsFor(rows, cells, "Character Label");
        assert.strictEqual(result[0].matched, true);
        assert.strictEqual(result[0].cellId, "v");
        assert.strictEqual(result[0].newLabel, "ATTICUS");
    });

    test("rows with an empty label are skipped and do not consume a cell", async () => {
        const cells = [cell("c1", "Shalom.", 100, 101), cell("c2", "Shalom.", 100, 101)];
        const rows: ImportedRow[] = [
            { "TC In": "00:01:40:00", Character: "" },
            { "TC In": "00:01:40:00", Character: "REAL SPEAKER" },
        ];
        const result = await labelsFor(rows, cells, "Character");
        assert.strictEqual(result.length, 1);
        assert.strictEqual(result[0].cellId, "c1", "blank row must not burn the first cell");
        assert.strictEqual(result[0].newLabel, "REAL SPEAKER");
    });
});
