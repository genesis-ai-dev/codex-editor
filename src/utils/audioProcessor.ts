/**
 * Audio processing utilities using FFmpeg.
 *
 * Primary path: uses FFmpeg for silence detection, waveform peaks, and
 * segment extraction. When FFmpeg is unavailable the webview-side Web Audio
 * API implementation serves as a fallback for import flows.
 *
 * FFprobe is NOT required — duration is extracted from FFmpeg's stderr.
 */

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { getFFmpegPath, checkAudioToolsAvailable } from "./ffmpegManager";

const getFs = (): typeof fs => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        return require("fs");
    } catch {
        return fs;
    }
};

const getSpawn = (): ((command: string, args?: readonly string[]) => any) | null => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const cp = require("child_process");
        return cp?.spawn ?? null;
    } catch {
        return null;
    }
};

let extensionContext: vscode.ExtensionContext | undefined;

export const initializeAudioProcessor = (context: vscode.ExtensionContext): void => {
    extensionContext = context;
    console.log("[audioProcessor] Initialized with extension context");
};

export interface AudioFileMetadata {
    id: string;
    name: string;
    path: string;
    durationSec: number;
    sizeBytes: number;
    previewPeaks: number[];
    segments: Array<{ startSec: number; endSec: number }>;
}

export interface AudioSegment {
    startSec: number;
    endSec: number;
}

/**
 * Check whether FFmpeg is available (system path, downloaded, or bundled).
 * Returns true only if the binary can actually be resolved.
 */
export const isFFmpegAvailable = async (): Promise<boolean> => {
    try {
        await getFFmpegPath(extensionContext);
        return true;
    } catch {
        return false;
    }
};

/**
 * Re-export for callers that need the raw tools-available check
 * (system PATH only, no download attempt).
 */
export { checkAudioToolsAvailable };

/**
 * Parse `Duration: HH:MM:SS.ms` from FFmpeg stderr output.
 * FFmpeg always prints this for every input file it opens.
 */
const parseDurationFromStderr = (stderr: string): number | null => {
    const match = stderr.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
    if (!match) {
        return null;
    }
    const hours = parseInt(match[1], 10);
    const minutes = parseInt(match[2], 10);
    const seconds = parseFloat(match[3]);
    return hours * 3600 + minutes * 60 + seconds;
};

interface SilenceDetectionResult {
    segments: AudioSegment[];
    durationSec: number;
}

/**
 * Detect silence regions using FFmpeg silencedetect filter.
 * Also extracts duration from FFmpeg's stderr, eliminating the need for FFprobe.
 */
const detectSilenceWithDuration = async (
    filePath: string,
    thresholdDb: number = -40,
    minDuration: number = 0.5,
): Promise<SilenceDetectionResult> => {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        const ffmpeg = spawn(ffmpegBinaryPath, [
            "-i", filePath,
            "-af", `silencedetect=n=${thresholdDb}dB:d=${minDuration}`,
            "-f", "null",
            "-",
        ]);

        let stderr = "";
        ffmpeg.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on("exit", (code: number | null) => {
            const sampleLines = stderr.split("\n").filter(
                (line) => line.includes("silence_start") || line.includes("silence_end"),
            ).slice(0, 10);
            if (sampleLines.length > 0) {
                console.log("[audioProcessor] Sample FFmpeg output lines:", sampleLines);
            }

            const silenceStarts: number[] = [];
            const silenceEnds: number[] = [];

            const lines = stderr.split("\n");
            for (const line of lines) {
                const startMatch = line.match(/silence_start:\s*([\d.]+)/);
                const endMatch = line.match(/silence_end:\s*([\d.]+)/);

                if (startMatch) {
                    const time = parseFloat(startMatch[1]);
                    if (!isNaN(time) && time >= 0) {
                        silenceStarts.push(time);
                    }
                }
                if (endMatch) {
                    const time = parseFloat(endMatch[1]);
                    if (!isNaN(time) && time >= 0) {
                        silenceEnds.push(time);
                    }
                }
            }

            silenceStarts.sort((a, b) => a - b);
            silenceEnds.sort((a, b) => a - b);

            const silenceRegions: Array<{ start: number; end: number }> = [];
            let endIndex = 0;
            for (const start of silenceStarts) {
                while (endIndex < silenceEnds.length && silenceEnds[endIndex] <= start) {
                    endIndex++;
                }
                if (endIndex < silenceEnds.length) {
                    const end = silenceEnds[endIndex];
                    if (end > start) {
                        silenceRegions.push({ start, end });
                        endIndex++;
                    }
                }
            }

            silenceRegions.sort((a, b) => a.start - b.start);

            const cleanedRegions: Array<{ start: number; end: number }> = [];
            for (const region of silenceRegions) {
                if (cleanedRegions.length === 0) {
                    cleanedRegions.push(region);
                } else {
                    const last = cleanedRegions[cleanedRegions.length - 1];
                    if (region.start >= last.end) {
                        cleanedRegions.push(region);
                    } else if (region.end > last.end) {
                        last.end = region.end;
                    }
                }
            }

            console.log(`[audioProcessor] Found ${silenceStarts.length} silence starts, ${silenceEnds.length} silence ends`);
            console.log(`[audioProcessor] Created ${cleanedRegions.length} silence regions`);

            const duration = parseDurationFromStderr(stderr);
            if (duration === null || duration <= 0) {
                return reject(new Error("Could not determine audio duration from FFmpeg output"));
            }

            const breakpoints: number[] = [0];
            for (const silence of cleanedRegions) {
                breakpoints.push((silence.start + silence.end) / 2);
            }
            breakpoints.push(duration);

            breakpoints.sort((a, b) => a - b);
            const uniqueBreakpoints = breakpoints.filter(
                (bp, i) => i === 0 || bp - breakpoints[i - 1] >= 0.01,
            );

            const segments: AudioSegment[] = [];
            for (let i = 0; i < uniqueBreakpoints.length - 1; i++) {
                segments.push({
                    startSec: uniqueBreakpoints[i],
                    endSec: uniqueBreakpoints[i + 1],
                });
            }

            if (segments.length === 0) {
                segments.push({ startSec: 0, endSec: duration });
            }

            const MAX_SEGMENT_LENGTH = 30;
            const finalSegments: AudioSegment[] = [];
            for (const seg of segments) {
                const segDuration = seg.endSec - seg.startSec;
                if (segDuration <= MAX_SEGMENT_LENGTH) {
                    finalSegments.push(seg);
                } else {
                    let currentStart = seg.startSec;
                    while (currentStart < seg.endSec) {
                        const currentEnd = Math.min(currentStart + MAX_SEGMENT_LENGTH, seg.endSec);
                        finalSegments.push({ startSec: currentStart, endSec: currentEnd });
                        currentStart = currentEnd;
                    }
                }
            }

            console.log(`[audioProcessor] Final segments: ${finalSegments.length}, duration: ${duration}s`);

            resolve({ segments: finalSegments, durationSec: duration });
        });

        ffmpeg.on("error", reject);
    });
};

/**
 * Generate waveform peaks for visualization over the entire file.
 * Streams FFmpeg output and computes peaks incrementally (low memory).
 */
const generateWaveformPeaks = async (
    filePath: string,
    durationSec: number,
    targetPoints: number = 2000,
    sampleRate: number = 8000,
): Promise<number[]> => {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        const peaks: number[] = new Array(Math.max(1, targetPoints)).fill(0);
        const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
        const samplesPerPeak = Math.max(1, Math.ceil(totalSamples / peaks.length));

        let samplesProcessed = 0;
        let leftover: Buffer | null = null;

        const ffmpeg = spawn(ffmpegBinaryPath, [
            "-i", filePath,
            "-f", "f32le",
            "-ac", "1",
            "-ar", String(sampleRate),
            "pipe:1",
        ]);

        ffmpeg.stdout.on("data", (chunk: Buffer) => {
            let buffer = leftover ? Buffer.concat([leftover, chunk]) : chunk;
            const remainder = buffer.length % 4;
            if (remainder !== 0) {
                leftover = buffer.slice(buffer.length - remainder);
                buffer = buffer.slice(0, buffer.length - remainder);
            } else {
                leftover = null;
            }

            const samples = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.length / 4);
            for (let i = 0; i < samples.length; i++) {
                const abs = Math.abs(samples[i]);
                const bucketIndex = Math.min(peaks.length - 1, Math.floor(samplesProcessed / samplesPerPeak));
                if (abs > peaks[bucketIndex]) {
                    peaks[bucketIndex] = abs;
                }
                samplesProcessed++;
                if (samplesProcessed >= totalSamples) {
                    break;
                }
            }
        });

        ffmpeg.on("exit", (code: number | null) => {
            if (code !== 0) {
                return reject(new Error("FFmpeg failed to decode audio"));
            }
            resolve(peaks);
        });

        ffmpeg.on("error", reject);
    });
};

/**
 * Process audio file: detect segments + duration via FFmpeg, then generate waveform peaks.
 */
export const processAudioFile = async (
    filePath: string,
    _previewDuration: number = 30,
    thresholdDb: number = -40,
    minDuration: number = 0.5,
): Promise<AudioFileMetadata> => {
    console.log(`[audioProcessor] Processing file: ${filePath}`);
    const fsModule = getFs();

    if (!fsModule.existsSync(filePath)) {
        throw new Error(`Audio file not found: ${filePath}`);
    }

    const stats = fsModule.statSync(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[audioProcessor] File: ${fileName}, ID: ${fileId}, Size: ${stats.size} bytes`);

    // Silence detection also extracts duration from FFmpeg stderr (no FFprobe needed)
    const { segments, durationSec } = await detectSilenceWithDuration(filePath, thresholdDb, minDuration);

    const targetPoints = Math.max(1000, Math.min(8000, Math.floor(durationSec * 50)));
    console.log(`[audioProcessor] Duration: ${durationSec}s, generating ${targetPoints} waveform points`);

    const peaks = await generateWaveformPeaks(filePath, durationSec, targetPoints).catch((err) => {
        console.error("[audioProcessor] Error generating peaks:", err);
        return [];
    });

    console.log(`[audioProcessor] Processing complete: duration=${durationSec}s, peaks=${peaks.length}, segments=${segments.length}`);

    return {
        id: fileId,
        name: fileName,
        path: filePath,
        durationSec,
        sizeBytes: stats.size,
        previewPeaks: Array.isArray(peaks) ? peaks : [],
        segments,
    };
};

/** Extra padding (seconds) added each side when stream-copying to avoid clipping at frame boundaries. */
const FRAME_SAFETY_BUFFER_SEC = 0.1;

export type SegmentExtractionMode = "wav" | "copy" | "reencode";

/**
 * Extract an audio segment.
 *
 * - `"copy"` — stream-copies the segment in the original codec/container.
 *   No re-encoding, no quality loss. A small safety buffer is added around
 *   the cut points so frame-boundary rounding in lossy codecs never clips speech.
 * - `"reencode"` — re-encodes using FFmpeg's default codec for the output
 *   container (auto-detected from the output file extension). Useful as a
 *   fallback when stream-copy fails for an unusual format.
 * - `"wav"` (default) — re-encodes to WAV PCM s16le / 44100 Hz / mono.
 */
export const extractSegment = async (
    sourcePath: string,
    outputPath: string,
    startSec: number,
    endSec: number,
    mode: SegmentExtractionMode = "wav",
): Promise<void> => {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        let args: string[];
        switch (mode) {
            case "copy":
                args = buildStreamCopyArgs(sourcePath, outputPath, startSec, endSec);
                break;
            case "reencode":
                args = buildReencodeArgs(sourcePath, outputPath, startSec, endSec);
                break;
            default:
                args = buildWavReencodeArgs(sourcePath, outputPath, startSec, endSec);
                break;
        }

        const ffmpeg = spawn(ffmpegBinaryPath, args);

        let stderr = "";
        ffmpeg.stderr.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on("exit", (code: number | null) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg segment extraction failed: ${stderr}`));
            }
        });

        ffmpeg.on("error", reject);
    });
};

const buildStreamCopyArgs = (
    sourcePath: string,
    outputPath: string,
    startSec: number,
    endSec: number,
): string[] => {
    const adjustedStart = Math.max(0, startSec - FRAME_SAFETY_BUFFER_SEC);
    const actualStartBuffer = startSec - adjustedStart;
    const adjustedDuration = (endSec - startSec) + actualStartBuffer + FRAME_SAFETY_BUFFER_SEC;
    return [
        "-i", sourcePath,
        "-ss", adjustedStart.toString(),
        "-t", adjustedDuration.toString(),
        "-c:a", "copy",
        "-y",
        outputPath,
    ];
};

const buildReencodeArgs = (
    sourcePath: string,
    outputPath: string,
    startSec: number,
    endSec: number,
): string[] => {
    const duration = endSec - startSec;
    return [
        "-i", sourcePath,
        "-ss", startSec.toString(),
        "-t", duration.toString(),
        "-ac", "1",
        "-y",
        outputPath,
    ];
};

const buildWavReencodeArgs = (
    sourcePath: string,
    outputPath: string,
    startSec: number,
    endSec: number,
): string[] => {
    const duration = endSec - startSec;
    return [
        "-i", sourcePath,
        "-ss", startSec.toString(),
        "-t", duration.toString(),
        "-acodec", "pcm_s16le",
        "-ar", "44100",
        "-ac", "1",
        "-y",
        outputPath,
    ];
};

/**
 * Extract multiple segments from an audio file.
 *
 * When mode is `"copy"` or `"reencode"` the output extension is derived from
 * the source file so segments keep the original container format.
 */
export const extractSegments = async (
    sourcePath: string,
    outputDir: string,
    segments: AudioSegment[],
    baseFileName: string,
    mode: SegmentExtractionMode = "wav",
): Promise<string[]> => {
    const outputPaths: string[] = [];
    const ext = mode === "wav" ? ".wav" : path.extname(sourcePath);

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const outputFileName = `${baseFileName}-seg${i + 1}${ext}`;
        const outputPath = path.join(outputDir, outputFileName);

        await extractSegment(sourcePath, outputPath, segment.startSec, segment.endSec, mode);
        outputPaths.push(outputPath);
    }

    return outputPaths;
};
