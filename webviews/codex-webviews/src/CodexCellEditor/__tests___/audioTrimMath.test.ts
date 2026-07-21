import { describe, expect, it } from "vitest";
import {
    formatAudioEditTime,
    isWholeAudioSelected,
    normalizeAudioTrimRange,
    updateAudioTrimEnd,
    updateAudioTrimStart,
} from "../audio-editor/audioTrimMath";

describe("audioTrimMath", () => {
    it("orders and clamps slider values", () => {
        expect(normalizeAudioTrimRange([8, -2], 10)).toEqual({ startSec: 0, endSec: 8 });
        expect(normalizeAudioTrimRange([2, 20], 10)).toEqual({ startSec: 2, endSec: 10 });
    });

    it("keeps a minimum editable selection", () => {
        expect(normalizeAudioTrimRange([5, 5.01], 10)).toEqual({ startSec: 5, endSec: 5.1 });
        expect(normalizeAudioTrimRange([9.99, 10], 10)).toEqual({ startSec: 9.9, endSec: 10 });
    });

    it("allows a collapsed range when the minimum duration is zero", () => {
        expect(normalizeAudioTrimRange([5, 5], 10, 0)).toEqual({ startSec: 5, endSec: 5 });
        expect(updateAudioTrimStart(4, 4, 10, 0)).toEqual({ startSec: 4, endSec: 4 });
        expect(updateAudioTrimEnd(4, 4, 10, 0)).toEqual({ startSec: 4, endSec: 4 });
    });

    it("constrains precise start and end edits", () => {
        expect(updateAudioTrimStart(9, 4, 10)).toEqual({ startSec: 3.9, endSec: 4 });
        expect(updateAudioTrimEnd(1, 3, 10)).toEqual({ startSec: 3, endSec: 3.1 });
    });

    it("detects an unchanged full-length selection", () => {
        expect(isWholeAudioSelected({ startSec: 0, endSec: 10 }, 10)).toBe(true);
        expect(isWholeAudioSelected({ startSec: 0.2, endSec: 10 }, 10)).toBe(false);
    });

    it("formats editor time with hundredths", () => {
        expect(formatAudioEditTime(65.25)).toBe("1:05.25");
    });
});
