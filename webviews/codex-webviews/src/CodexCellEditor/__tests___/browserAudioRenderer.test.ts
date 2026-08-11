import { describe, expect, it } from "vitest";
import { encodePcmWav } from "../audio-editor/browserAudioRenderer";

describe("browserAudioRenderer", () => {
    it("encodes mono PCM samples with a valid WAV header", () => {
        const bytes = encodePcmWav([new Float32Array([-1, 0, 1])], 44100);
        const view = new DataView(bytes.buffer);
        const text = (offset: number, length: number) =>
            String.fromCharCode(...bytes.slice(offset, offset + length));

        expect(text(0, 4)).toBe("RIFF");
        expect(text(8, 4)).toBe("WAVE");
        expect(text(36, 4)).toBe("data");
        expect(view.getUint16(22, true)).toBe(1);
        expect(view.getUint32(24, true)).toBe(44100);
        expect(view.getUint32(28, true)).toBe(44100 * 2);
        expect(view.getUint16(32, true)).toBe(2);
        expect(view.getUint32(40, true)).toBe(6);
        expect(view.getInt16(44, true)).toBe(-32768);
        expect(view.getInt16(46, true)).toBe(0);
        expect(view.getInt16(48, true)).toBe(32767);
    });

    it("encodes stereo PCM as interleaved frames with stereo header fields", () => {
        const left = new Float32Array([1, -1]);
        const right = new Float32Array([0, 0.5]);
        const bytes = encodePcmWav([left, right], 48000);
        const view = new DataView(bytes.buffer);

        expect(view.getUint16(22, true)).toBe(2); // channels
        expect(view.getUint32(24, true)).toBe(48000); // sample rate
        expect(view.getUint32(28, true)).toBe(48000 * 4); // byte rate
        expect(view.getUint16(32, true)).toBe(4); // block align
        expect(view.getUint32(40, true)).toBe(8); // data size: 2 frames * 2 ch * 2 bytes
        // Interleaved order: L0 R0 L1 R1
        expect(view.getInt16(44, true)).toBe(32767);
        expect(view.getInt16(46, true)).toBe(0);
        expect(view.getInt16(48, true)).toBe(-32768);
        expect(view.getInt16(50, true)).toBe(Math.trunc(0.5 * 0x7fff));
    });

    it("clamps out-of-range samples", () => {
        const bytes = encodePcmWav([new Float32Array([2, -2])], 44100);
        const view = new DataView(bytes.buffer);
        expect(view.getInt16(44, true)).toBe(32767);
        expect(view.getInt16(46, true)).toBe(-32768);
    });
});
