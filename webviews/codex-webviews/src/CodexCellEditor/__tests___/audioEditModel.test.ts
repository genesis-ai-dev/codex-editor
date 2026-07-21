import { describe, expect, it } from "vitest";
import {
    createAudioEditorClip,
    deleteAudioTimelineRange,
    getAudioEditorDuration,
    insertAudioClipsAtTimelinePosition,
    keepAudioTimelineRange,
    locateAudioTimelinePosition,
    splitClipRemovingSelection,
    trimAudioEditorClip,
} from "../audio-editor/audioEditModel";

function clip(label = "Original", durationSec = 10) {
    return createAudioEditorClip({
        inputId: label,
        label,
        audioBlob: new Blob(["audio"]),
        audioUrl: `blob:${label}`,
        fileExtension: "webm",
        durationSec,
    });
}

describe("audioEditModel", () => {
    it("trims a clip to the selected range", () => {
        const trimmed = trimAudioEditorClip(clip(), { startSec: 2, endSec: 7 });
        expect(trimmed.startSec).toBe(2);
        expect(trimmed.endSec).toBe(7);
    });

    it("deletes a middle selection by splitting the clip", () => {
        const pieces = splitClipRemovingSelection(clip(), { startSec: 3, endSec: 6 });
        expect(pieces).toHaveLength(2);
        expect(pieces.map((piece) => [piece.startSec, piece.endSec])).toEqual([
            [0, 3],
            [6, 10],
        ]);
        expect(pieces[0].inputId).toBe(pieces[1].inputId);
    });

    it("removes the entire clip when the full range is selected", () => {
        expect(splitClipRemovingSelection(clip(), { startSec: 0, endSec: 10 })).toEqual([]);
    });

    it("adds the rendered duration of all clips", () => {
        const first = { ...clip("first", 10), startSec: 2, endSec: 5 };
        const second = { ...clip("second", 8), startSec: 1, endSec: 7 };
        expect(getAudioEditorDuration([first, second])).toBe(9);
    });

    it("locates a playhead and inserts a clip by splitting the underlying source", () => {
        const original = clip("original", 10);
        const inserted = clip("inserted", 2);
        const result = insertAudioClipsAtTimelinePosition([original], [inserted], 4);
        expect(result.map((item) => item.label)).toEqual([
            "original · left",
            "inserted",
            "original · right",
        ]);
        expect(result.map((item) => [item.startSec, item.endSec])).toEqual([
            [0, 4],
            [0, 2],
            [4, 10],
        ]);
        expect(locateAudioTimelinePosition(result, 5)?.clipIndex).toBe(1);
    });

    it("deletes a global selection across clip boundaries", () => {
        const result = deleteAudioTimelineRange(
            [clip("first", 10), clip("second", 8)],
            { startSec: 8, endSec: 12 }
        );
        expect(result.map((item) => [item.startSec, item.endSec])).toEqual([
            [0, 8],
            [2, 8],
        ]);
    });

    it("deletes a selected range shorter than 0.10 seconds", () => {
        const result = deleteAudioTimelineRange(
            [clip()],
            { startSec: 5.4, endSec: 5.49 }
        );
        expect(result.map((item) => [item.startSec, item.endSec])).toEqual([
            [0, 5.4],
            [5.49, 10],
        ]);
        expect(getAudioEditorDuration(result)).toBeCloseTo(9.91);
    });

    it("does not delete audio when the two pointers are equal", () => {
        const original = clip();
        expect(deleteAudioTimelineRange([original], { startSec: 5, endSec: 5 })).toEqual([original]);
    });

    it("preserves a remaining audio fragment shorter than 0.10 seconds", () => {
        const result = deleteAudioTimelineRange(
            [clip()],
            { startSec: 0, endSec: 9.95 }
        );
        expect(result.map((item) => [item.startSec, item.endSec])).toEqual([[9.95, 10]]);
    });

    it("keeps a global selection across clip boundaries", () => {
        const result = keepAudioTimelineRange(
            [clip("first", 10), clip("second", 8)],
            { startSec: 8, endSec: 12 }
        );
        expect(result.map((item) => [item.startSec, item.endSec])).toEqual([
            [8, 10],
            [0, 2],
        ]);
    });
});
