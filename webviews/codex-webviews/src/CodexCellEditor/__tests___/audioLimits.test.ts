import { describe, expect, it } from "vitest";
import { estimateWavBytes, MAX_AUDIO_ATTACHMENT_BYTES, maxWavDurationSec } from "@sharedUtils";

describe("audioLimits", () => {
    it("computes exact PCM16 WAV sizes", () => {
        expect(estimateWavBytes(1, 44100, 1)).toBe(44 + 44100 * 2);
        expect(estimateWavBytes(1, 48000, 2)).toBe(44 + 48000 * 4);
        expect(estimateWavBytes(0, 48000, 2)).toBe(44);
        expect(estimateWavBytes(-5, 48000, 1)).toBe(44);
    });

    it("reports the longest duration that fits under the attachment cap", () => {
        const monoLimit = maxWavDurationSec(48000, 1);
        expect(estimateWavBytes(monoLimit, 48000, 1)).toBeLessThanOrEqual(
            MAX_AUDIO_ATTACHMENT_BYTES
        );
        expect(estimateWavBytes(monoLimit + 1, 48000, 1)).toBeGreaterThan(
            MAX_AUDIO_ATTACHMENT_BYTES
        );
        // Stereo halves the budget.
        expect(maxWavDurationSec(48000, 2)).toBe(Math.floor(monoLimit / 2));
    });
});
