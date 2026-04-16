/**
 * Pure-JS WAV utilities for the extension host.
 * No native dependencies — reads/writes WAV files using only Node `fs` and `Buffer`.
 */

import * as fs from "fs";
import * as path from "path";

interface WavHeader {
    numChannels: number;
    sampleRate: number;
    bitsPerSample: number;
    dataOffset: number;
    dataSize: number;
}

/**
 * Parse essential fields from a WAV file header.
 * Throws if the file is not a valid RIFF/WAVE with a PCM fmt chunk.
 */
const parseWavHeader = (buf: Buffer): WavHeader => {
    if (buf.length < 44) {
        throw new Error("File too small to be a valid WAV");
    }
    const riff = buf.toString("ascii", 0, 4);
    const wave = buf.toString("ascii", 8, 12);
    if (riff !== "RIFF" || wave !== "WAVE") {
        throw new Error("Not a valid WAV file");
    }

    let offset = 12;
    const header: Partial<WavHeader> = {};

    while (offset < buf.length - 8) {
        const chunkId = buf.toString("ascii", offset, offset + 4);
        const chunkSize = buf.readUInt32LE(offset + 4);

        if (chunkId === "fmt ") {
            header.numChannels = buf.readUInt16LE(offset + 10);
            header.sampleRate = buf.readUInt32LE(offset + 12);
            header.bitsPerSample = buf.readUInt16LE(offset + 22);
        } else if (chunkId === "data") {
            header.dataOffset = offset + 8;
            header.dataSize = chunkSize;
            break;
        }

        offset += 8 + chunkSize;
        if (chunkSize % 2 !== 0) {
            offset++;
        }
    }

    if (
        header.numChannels === undefined ||
        header.sampleRate === undefined ||
        header.bitsPerSample === undefined ||
        header.dataOffset === undefined ||
        header.dataSize === undefined
    ) {
        throw new Error("Invalid WAV: missing required chunks");
    }

    return header as WavHeader;
};

/**
 * Build a 44-byte standard WAV header for PCM data.
 */
const buildWavHeader = (
    dataSize: number,
    numChannels: number,
    sampleRate: number,
    bitsPerSample: number,
): Buffer => {
    const blockAlign = numChannels * (bitsPerSample / 8);
    const byteRate = sampleRate * blockAlign;
    const buf = Buffer.alloc(44);

    buf.write("RIFF", 0, "ascii");
    buf.writeUInt32LE(36 + dataSize, 4);
    buf.write("WAVE", 8, "ascii");

    buf.write("fmt ", 12, "ascii");
    buf.writeUInt32LE(16, 16);
    buf.writeUInt16LE(1, 20);
    buf.writeUInt16LE(numChannels, 22);
    buf.writeUInt32LE(sampleRate, 24);
    buf.writeUInt32LE(byteRate, 28);
    buf.writeUInt16LE(blockAlign, 32);
    buf.writeUInt16LE(bitsPerSample, 34);

    buf.write("data", 36, "ascii");
    buf.writeUInt32LE(dataSize, 40);

    return buf;
};

/**
 * Get the duration (in seconds) of a WAV file by reading its header.
 */
export const getWavDuration = (filePath: string): number => {
    const buf = fs.readFileSync(filePath);
    const header = parseWavHeader(buf);
    const bytesPerSample = header.bitsPerSample / 8;
    const totalSamples = header.dataSize / (bytesPerSample * header.numChannels);
    return totalSamples / header.sampleRate;
};

/**
 * Merge two WAV files by concatenating their PCM data.
 *
 * Both files must share the same sample rate, channel count, and bit depth.
 * The merged output uses the format of the first file.
 *
 * Returns the output path on success, or `null` on failure (non-throwing to
 * match the existing `mergeAudioFiles` API contract).
 */
export const mergeWavFiles = (
    inputFile1: string,
    inputFile2: string,
    outputPath: string,
): string | null => {
    try {
        if (!fs.existsSync(inputFile1)) {
            console.warn(`[wavUtils] Input file 1 does not exist: ${inputFile1}`);
            return null;
        }
        if (!fs.existsSync(inputFile2)) {
            console.warn(`[wavUtils] Input file 2 does not exist: ${inputFile2}`);
            return null;
        }

        const buf1 = fs.readFileSync(inputFile1);
        const buf2 = fs.readFileSync(inputFile2);

        const hdr1 = parseWavHeader(buf1);
        const hdr2 = parseWavHeader(buf2);

        if (
            hdr1.sampleRate !== hdr2.sampleRate ||
            hdr1.numChannels !== hdr2.numChannels ||
            hdr1.bitsPerSample !== hdr2.bitsPerSample
        ) {
            console.warn(
                `[wavUtils] Format mismatch: file1(${hdr1.sampleRate}Hz/${hdr1.numChannels}ch/${hdr1.bitsPerSample}bit) ` +
                    `vs file2(${hdr2.sampleRate}Hz/${hdr2.numChannels}ch/${hdr2.bitsPerSample}bit)`,
            );
            return null;
        }

        const data1 = buf1.subarray(hdr1.dataOffset, hdr1.dataOffset + hdr1.dataSize);
        const data2 = buf2.subarray(hdr2.dataOffset, hdr2.dataOffset + hdr2.dataSize);
        const mergedDataSize = data1.length + data2.length;

        const header = buildWavHeader(
            mergedDataSize,
            hdr1.numChannels,
            hdr1.sampleRate,
            hdr1.bitsPerSample,
        );

        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const fd = fs.openSync(outputPath, "w");
        try {
            fs.writeSync(fd, header);
            fs.writeSync(fd, data1);
            fs.writeSync(fd, data2);
        } finally {
            fs.closeSync(fd);
        }

        console.log(`[wavUtils] Successfully merged WAV files to: ${outputPath}`);
        return outputPath;
    } catch (error) {
        console.error(`[wavUtils] Error merging WAV files:`, error);
        return null;
    }
};
