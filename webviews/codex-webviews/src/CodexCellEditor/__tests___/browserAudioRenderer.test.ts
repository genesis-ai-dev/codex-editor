import { describe, expect, it } from "vitest";
import { encodeMonoPcmWav } from "../audio-editor/browserAudioRenderer";

describe("browserAudioRenderer", () => {
    it("encodes mono PCM samples with a valid WAV header", () => {
        const bytes = encodeMonoPcmWav(new Float32Array([-1, 0, 1]), 44100);
        const view = new DataView(bytes.buffer);
        const text = (offset: number, length: number) =>
            String.fromCharCode(...bytes.slice(offset, offset + length));

        expect(text(0, 4)).toBe("RIFF");
        expect(text(8, 4)).toBe("WAVE");
        expect(text(36, 4)).toBe("data");
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(44100);
        expect(view.getUint32(40, true)).toBe(6);
        expect(view.getInt16(44, true)).toBe(-32768);
        expect(view.getInt16(46, true)).toBe(0);
        expect(view.getInt16(48, true)).toBe(32767);
    });
});
