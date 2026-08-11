import { describe, expect, it } from "vitest";
import { createAudioEditorClip } from "../audio-editor/audioEditModel";
import { computePlaybackSchedule } from "../audio-editor/useAudioTimelinePlayback";

function clip(label: string, durationSec: number, startSec = 0, endSec = durationSec) {
    return {
        ...createAudioEditorClip({
            inputId: label,
            label,
            audioBlob: new Blob(["audio"]),
            audioUrl: `blob:${label}`,
            fileExtension: "webm",
            durationSec,
        }),
        startSec,
        endSec,
    };
}

describe("computePlaybackSchedule", () => {
    it("schedules trimmed clips back to back from the start", () => {
        const schedule = computePlaybackSchedule([
            clip("first", 10, 2, 5), // 3s on the timeline, source offset 2
            clip("second", 8, 1, 7), // 6s on the timeline, source offset 1
        ]);
        expect(schedule).toEqual([
            expect.objectContaining({
                inputId: "first",
                startAtSec: 0,
                sourceOffsetSec: 2,
                durationSec: 3,
            }),
            expect.objectContaining({
                inputId: "second",
                startAtSec: 3,
                sourceOffsetSec: 1,
                durationSec: 6,
            }),
        ]);
    });

    it("starts partway through the clip containing fromSec", () => {
        const schedule = computePlaybackSchedule(
            [clip("first", 10, 2, 5), clip("second", 8, 1, 7)],
            4 // one second into the second clip
        );
        expect(schedule).toEqual([
            expect.objectContaining({
                inputId: "second",
                startAtSec: 0,
                sourceOffsetSec: 2,
                durationSec: 5,
            }),
        ]);
    });

    it("plays the remainder of the first clip and all of the second", () => {
        const schedule = computePlaybackSchedule(
            [clip("first", 10, 2, 5), clip("second", 8, 1, 7)],
            1
        );
        expect(schedule).toEqual([
            expect.objectContaining({
                inputId: "first",
                startAtSec: 0,
                sourceOffsetSec: 3,
                durationSec: 2,
            }),
            expect.objectContaining({
                inputId: "second",
                startAtSec: 2,
                sourceOffsetSec: 1,
                durationSec: 6,
            }),
        ]);
    });

    it("skips zero-width clips", () => {
        const schedule = computePlaybackSchedule([
            clip("empty", 10, 4, 4),
            clip("real", 10, 0, 2),
        ]);
        expect(schedule).toHaveLength(1);
        expect(schedule[0]).toEqual(
            expect.objectContaining({ inputId: "real", startAtSec: 0, durationSec: 2 })
        );
    });

    it("returns nothing when fromSec is at or past the end", () => {
        expect(computePlaybackSchedule([clip("only", 10, 0, 3)], 3)).toEqual([]);
    });
});
