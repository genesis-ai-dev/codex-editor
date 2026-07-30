import { describe, it, expect } from "vitest";
import { formatTimecode } from "../../../sharedUtils/timeUtils";

describe("formatTimecode", () => {
    it("formats zero", () => {
        expect(formatTimecode(0)).toBe("00:00:00.000");
    });

    it("formats sub-minute times", () => {
        expect(formatTimecode(41.875)).toBe("00:00:41.875");
        expect(formatTimecode(51.51)).toBe("00:00:51.510");
    });

    it("rounds float artifacts instead of truncating", () => {
        // 64.94 % 1 === 0.9399999..., which Math.floor-based formatting
        // renders as .939 — the VTT export and display must both say .940
        expect(formatTimecode(64.94)).toBe("00:01:04.940");
    });

    it("includes the hours place past one hour", () => {
        expect(formatTimecode(4026.485)).toBe("01:07:06.485");
    });

    it("carries rounding across unit boundaries", () => {
        expect(formatTimecode(59.9996)).toBe("00:01:00.000");
        expect(formatTimecode(3599.9999)).toBe("01:00:00.000");
    });

    it("guards against invalid input", () => {
        expect(formatTimecode(NaN)).toBe("00:00:00.000");
        expect(formatTimecode(Infinity)).toBe("00:00:00.000");
        expect(formatTimecode(-1)).toBe("00:00:00.000");
    });
});
