/**
 * Consolidated audio processing utilities using FFmpeg binaries
 * Combines: audioProcessor, audioExtractor, audioMerger
 *
 * Handles:
 * - Audio decoding, silence detection, segmentation, and waveform generation
 * - Audio extraction from video files
 * - Audio file merging
 *
 * Downloads FFmpeg binaries on-demand to keep VSIX size small
 */

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { getFFmpegPath, getFFprobePath } from "./ffmpegManager";

// ============================================================================
// Shared utilities (deduplicated from audioProcessor, audioExtractor, audioMerger)
// ============================================================================

// Lazy load to avoid bundling issues
function getFs(): typeof fs {
    try {
        // Use eval to prevent webpack from analyzing
        // eslint-disable-next-line no-eval
        const req = eval("require") as NodeRequire;
        return req("fs") as typeof fs;
    } catch {
        return fs;
    }
}

function getSpawn(): ((command: string, args?: readonly string[]) => ReturnType<typeof import("child_process").spawn>) | null {
    try {
        // eslint-disable-next-line no-eval
        const req = eval("require") as NodeRequire;
        const cp = req("child_process") as typeof import("child_process");
        return cp && cp.spawn ? cp.spawn : null;
    } catch {
        return null;
    }
}

// Global extension context for ffmpeg downloads
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Initialize audio processing with extension context
 * Call this once during extension activation
 */
export function initializeAudioProcessing(context: vscode.ExtensionContext): void {
    extensionContext = context;
    console.log("[audioProcessing] Initialized with extension context");
}

// Legacy exports for backwards compatibility
export const initializeAudioProcessor = initializeAudioProcessing;
export const initializeAudioMerger = initializeAudioProcessing;

// ============================================================================
// Types
// ============================================================================

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

// ============================================================================
// Audio Processing (from audioProcessor.ts)
// ============================================================================

/**
 * Get audio duration using FFprobe
 */
async function getAudioDuration(filePath: string): Promise<number> {
    const ffprobeBinaryPath = await getFFprobePath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        const ffprobe = spawn(ffprobeBinaryPath, [
            "-v",
            "error",
            "-show_entries",
            "format=duration",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            filePath,
        ]);

        let output = "";
        ffprobe.stdout?.on("data", (data: Buffer) => {
            output += data.toString();
        });

        ffprobe.on("exit", (code: number | null) => {
            if (code === 0) {
                const duration = parseFloat(output.trim());
                resolve(isNaN(duration) ? 0 : duration);
            } else {
                reject(new Error("Failed to get audio duration"));
            }
        });

        ffprobe.on("error", reject);
    });
}

/**
 * Generate waveform peaks for visualization over the entire file
 * Streams FFmpeg output and computes peaks incrementally (low memory)
 */
async function generateWaveformPeaks(
    filePath: string,
    durationSec: number,
    targetPoints: number = 2000,
    sampleRate: number = 8000
): Promise<number[]> {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        // Prepare output buckets
        const peaks: number[] = new Array(Math.max(1, targetPoints)).fill(0);
        const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
        const samplesPerPeak = Math.max(1, Math.ceil(totalSamples / peaks.length));

        let samplesProcessed = 0;
        let leftover: Buffer | null = null;

        // Extract audio as 32-bit float, mono, downsampled sampleRate
        const ffmpeg = spawn(ffmpegBinaryPath, [
            "-i",
            filePath,
            "-f",
            "f32le",
            "-ac",
            "1",
            "-ar",
            String(sampleRate),
            "pipe:1",
        ]);

        ffmpeg.stdout?.on("data", (chunk: Buffer) => {
            // Ensure chunk aligns on 4-byte boundaries for Float32Array
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
                if (abs > peaks[bucketIndex]) peaks[bucketIndex] = abs;
                samplesProcessed++;
                if (samplesProcessed >= totalSamples) break;
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
}

/**
 * Detect silence regions in audio file using FFmpeg silencedetect filter
 */
export async function detectSilence(
    filePath: string,
    thresholdDb: number = -40,
    minDuration: number = 0.5
): Promise<AudioSegment[]> {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        const ffmpeg = spawn(ffmpegBinaryPath, [
            "-i",
            filePath,
            "-af",
            `silencedetect=n=${thresholdDb}dB:d=${minDuration}`,
            "-f",
            "null",
            "-",
        ]);

        let stderr = "";
        ffmpeg.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on("exit", async (code: number | null) => {
            // Log a sample of the actual output for debugging
            const sampleLines = stderr
                .split("\n")
                .filter((line) => line.includes("silence_start") || line.includes("silence_end"))
                .slice(0, 10);
            if (sampleLines.length > 0) {
                console.log(`[audioProcessing] Sample FFmpeg output lines:`, sampleLines);
            }

            // Parse silence detection output - collect all starts and ends separately
            const silenceStarts: number[] = [];
            const silenceEnds: number[] = [];

            // More robust regex that handles FFmpeg's output format
            const lines = stderr.split("\n");
            for (const line of lines) {
                // Match silence_start: can appear anywhere in the line
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

            // Sort and pair up silence regions
            silenceStarts.sort((a, b) => a - b);
            silenceEnds.sort((a, b) => a - b);

            const silenceRegions: Array<{ start: number; end: number }> = [];

            // Pair up starts and ends - take the earliest end for each start
            let endIndex = 0;
            for (const start of silenceStarts) {
                // Find the next end that comes after this start
                while (endIndex < silenceEnds.length && silenceEnds[endIndex] <= start) {
                    endIndex++;
                }
                if (endIndex < silenceEnds.length) {
                    const end = silenceEnds[endIndex];
                    if (end > start) {
                        silenceRegions.push({ start, end });
                        endIndex++; // Use this end for this start
                    }
                }
            }

            // Sort silence regions by start time
            silenceRegions.sort((a, b) => a.start - b.start);

            // Remove overlapping regions (keep the first one if they overlap)
            const cleanedRegions: Array<{ start: number; end: number }> = [];
            for (const region of silenceRegions) {
                if (cleanedRegions.length === 0) {
                    cleanedRegions.push(region);
                } else {
                    const last = cleanedRegions[cleanedRegions.length - 1];
                    if (region.start >= last.end) {
                        cleanedRegions.push(region);
                    } else if (region.end > last.end) {
                        // Extend the last region if it overlaps
                        last.end = region.end;
                    }
                }
            }

            console.log(
                `[audioProcessing] Found ${silenceStarts.length} silence starts, ${silenceEnds.length} silence ends`
            );
            if (silenceStarts.length > 0 || silenceEnds.length > 0) {
                console.log(
                    `[audioProcessing] Silence starts: [${silenceStarts.slice(0, 10).join(", ")}${silenceStarts.length > 10 ? "..." : ""}]`
                );
                console.log(
                    `[audioProcessing] Silence ends: [${silenceEnds.slice(0, 10).join(", ")}${silenceEnds.length > 10 ? "..." : ""}]`
                );
            }
            console.log(`[audioProcessing] Created ${cleanedRegions.length} silence regions`);
            if (cleanedRegions.length > 0) {
                console.log(
                    `[audioProcessing] Silence regions: [${cleanedRegions
                        .slice(0, 5)
                        .map((r) => `${r.start.toFixed(2)}-${r.end.toFixed(2)}`)
                        .join(", ")}${cleanedRegions.length > 5 ? "..." : ""}]`
                );
            }

            // Breakpoints at midpoint of silence regions
            try {
                const duration = await getAudioDuration(filePath);

                const breakpoints: number[] = [0];
                for (const silence of cleanedRegions) {
                    breakpoints.push((silence.start + silence.end) / 2);
                }
                breakpoints.push(duration);

                breakpoints.sort((a, b) => a - b);
                const uniqueBreakpoints = breakpoints.filter(
                    (bp, i) => i === 0 || bp - breakpoints[i - 1] >= 0.01
                );

                const segments: AudioSegment[] = [];
                for (let i = 0; i < uniqueBreakpoints.length - 1; i++) {
                    segments.push({
                        startSec: uniqueBreakpoints[i],
                        endSec: uniqueBreakpoints[i + 1],
                    });
                }

                // If no segments found, use entire file
                if (segments.length === 0) {
                    segments.push({ startSec: 0, endSec: duration });
                }

                // Split segments that exceed 30 seconds maximum length
                const MAX_SEGMENT_LENGTH = 30;
                const finalSegments: AudioSegment[] = [];
                for (const seg of segments) {
                    const segDuration = seg.endSec - seg.startSec;
                    if (segDuration <= MAX_SEGMENT_LENGTH) {
                        finalSegments.push(seg);
                    } else {
                        // Split into multiple segments of max 30 seconds each
                        let currentStart = seg.startSec;
                        while (currentStart < seg.endSec) {
                            const currentEnd = Math.min(currentStart + MAX_SEGMENT_LENGTH, seg.endSec);
                            finalSegments.push({
                                startSec: currentStart,
                                endSec: currentEnd,
                            });
                            currentStart = currentEnd;
                        }
                    }
                }

                console.log(`[audioProcessing] Final segments: ${finalSegments.length}`);
                if (finalSegments.length > 0) {
                    console.log(
                        `[audioProcessing] First 5 segments: [${finalSegments
                            .slice(0, 5)
                            .map((s) => `${s.startSec.toFixed(2)}-${s.endSec.toFixed(2)}`)
                            .join(", ")}${finalSegments.length > 5 ? "..." : ""}]`
                    );
                }

                resolve(finalSegments);
            } catch (error) {
                reject(error);
            }
        });

        ffmpeg.on("error", reject);
    });
}

/**
 * Process audio file: get metadata, generate preview waveform, detect segments
 */
export async function processAudioFile(
    filePath: string,
    previewDuration: number = 30, // Kept for backwards compatibility, but not used
    thresholdDb: number = -40,
    minDuration: number = 0.5
): Promise<AudioFileMetadata> {
    console.log(`[audioProcessing] Processing file: ${filePath}`);
    const fsModule = getFs();

    if (!fsModule.existsSync(filePath)) {
        const error = `Audio file not found: ${filePath}`;
        console.error(`[audioProcessing] ${error}`);
        throw new Error(error);
    }

    console.log(`[audioProcessing] File exists, getting stats...`);
    const stats = fsModule.statSync(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[audioProcessing] File: ${fileName}, ID: ${fileId}, Size: ${stats.size} bytes`);

    console.log(`[audioProcessing] Starting parallel processing (duration, peaks, segments)...`);

    // Get duration first to calculate appropriate target points
    const duration = await getAudioDuration(filePath).catch((err) => {
        console.error(`[audioProcessing] Error getting duration:`, err);
        throw err;
    });

    // Calculate target points: ~50 points per second, capped between 1000-8000
    const targetPoints = Math.max(1000, Math.min(8000, Math.floor(duration * 50)));
    console.log(`[audioProcessing] Duration: ${duration}s, generating ${targetPoints} waveform points`);

    const [peaks, segments] = await Promise.all([
        generateWaveformPeaks(filePath, duration, targetPoints).catch((err) => {
            console.error(`[audioProcessing] Error generating peaks:`, err);
            return []; // Return empty array on error instead of throwing
        }),
        detectSilence(filePath, thresholdDb, minDuration).catch((err) => {
            console.error(`[audioProcessing] Error detecting silence:`, err);
            throw err;
        }),
    ]);

    console.log(
        `[audioProcessing] Processing complete: duration=${duration}s, peaks=${peaks.length}, segments=${segments.length}`
    );

    return {
        id: fileId,
        name: fileName,
        path: filePath,
        durationSec: duration,
        sizeBytes: stats.size,
        previewPeaks: Array.isArray(peaks) ? peaks : [],
        segments,
    };
}

/**
 * Extract audio segment and save as WAV file
 */
export async function extractSegment(
    sourcePath: string,
    outputPath: string,
    startSec: number,
    endSec: number
): Promise<void> {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);

    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }

        const duration = endSec - startSec;
        const args = [
            "-i",
            sourcePath,
            "-ss",
            startSec.toString(),
            "-t",
            duration.toString(),
            "-acodec",
            "pcm_s16le",
            "-ar",
            "44100",
            "-ac",
            "1",
            "-y",
            outputPath,
        ];

        const ffmpeg = spawn(ffmpegBinaryPath, args);

        let stderr = "";
        ffmpeg.stderr?.on("data", (data: Buffer) => {
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
}

/**
 * Extract multiple segments from an audio file
 */
export async function extractSegments(
    sourcePath: string,
    outputDir: string,
    segments: AudioSegment[],
    baseFileName: string
): Promise<string[]> {
    const outputPaths: string[] = [];

    for (let i = 0; i < segments.length; i++) {
        const segment = segments[i];
        const outputFileName = `${baseFileName}-seg${i + 1}.wav`;
        const outputPath = path.join(outputDir, outputFileName);

        await extractSegment(sourcePath, outputPath, segment.startSec, segment.endSec);
        outputPaths.push(outputPath);
    }

    return outputPaths;
}

// ============================================================================
// Audio Extraction from Video (from audioExtractor.ts)
// ============================================================================

/**
 * Check if ffmpeg is available on the system (for extraction fallback)
 */
async function isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const spawn = getSpawn();
        if (!spawn) {
            resolve(false);
            return;
        }

        const ffmpeg = spawn("ffmpeg", ["-version"]);

        const timeout = setTimeout(() => {
            ffmpeg.kill();
            resolve(false);
        }, 5000);

        ffmpeg.on("error", () => {
            clearTimeout(timeout);
            resolve(false);
        });
        ffmpeg.on("exit", (code: number | null) => {
            clearTimeout(timeout);
            resolve(code === 0);
        });
    });
}

/**
 * Extract audio from video using ffmpeg
 */
async function extractAudioWithFFmpeg(videoData: Buffer, startTime: number, endTime: number): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        const fsModule = getFs();
        if (!spawn) {
            return reject(new Error("child_process.spawn not available"));
        }
        const tempDir = path.join(__dirname, "..", "..", ".temp");
        if (!fsModule.existsSync(tempDir)) {
            fsModule.mkdirSync(tempDir, { recursive: true });
        }

        const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
        const tempAudioPath = path.join(tempDir, `temp_audio_${Date.now()}.webm`);

        // Write video to temp file
        fsModule.writeFileSync(tempVideoPath, videoData);

        // Build ffmpeg command
        const args = [
            "-i",
            tempVideoPath,
            "-vn", // No video
            "-acodec",
            "libopus", // Use Opus codec for webm
            "-b:a",
            "128k", // Audio bitrate
        ];

        // Add time range if specified
        if (startTime > 0) {
            args.push("-ss", startTime.toString());
        }
        if (isFinite(endTime) && endTime > startTime) {
            args.push("-t", (endTime - startTime).toString());
        }

        args.push("-y", tempAudioPath); // Output file

        const ffmpeg = spawn("ffmpeg", args);

        let stderr = "";
        ffmpeg.stderr?.on("data", (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on("error", (error: Error) => {
            // Clean up temp files
            try {
                fsModule.unlinkSync(tempVideoPath);
            } catch {
                /* ignore cleanup errors */
            }
            try {
                fsModule.unlinkSync(tempAudioPath);
            } catch {
                /* ignore cleanup errors */
            }
            reject(new Error(`FFmpeg error: ${error.message}`));
        });

        ffmpeg.on("exit", (code: number | null) => {
            if (code === 0) {
                try {
                    const audioBuffer = fsModule.readFileSync(tempAudioPath);
                    // Clean up temp files
                    fsModule.unlinkSync(tempVideoPath);
                    fsModule.unlinkSync(tempAudioPath);
                    resolve(audioBuffer);
                } catch (error) {
                    reject(new Error(`Failed to read audio file: ${error}`));
                }
            } else {
                // Clean up temp files
                try {
                    fsModule.unlinkSync(tempVideoPath);
                } catch {
                    /* ignore cleanup errors */
                }
                try {
                    fsModule.unlinkSync(tempAudioPath);
                } catch {
                    /* ignore cleanup errors */
                }
                reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
            }
        });
    });
}

/**
 * Fallback: Just copy the video data as-is (browser will handle playback)
 */
function fallbackCopyVideo(videoData: Buffer): Buffer {
    console.warn("FFmpeg not available, using video file as-is for audio attachment");
    return videoData;
}

/**
 * Extract audio from video data
 */
export async function extractAudioFromVideo(
    videoData: Buffer,
    startTime: number = 0,
    endTime: number = Number.POSITIVE_INFINITY
): Promise<Buffer> {
    const hasFFmpeg = await isFFmpegAvailable();

    if (hasFFmpeg) {
        console.log("Using FFmpeg to extract audio from video");
        try {
            return await extractAudioWithFFmpeg(videoData, startTime, endTime);
        } catch (error) {
            console.error("FFmpeg extraction failed, using fallback:", error);
            return fallbackCopyVideo(videoData);
        }
    } else {
        console.log("FFmpeg not available, using fallback method");
        return fallbackCopyVideo(videoData);
    }
}

/**
 * Process audio/video attachments and extract audio if needed
 */
export async function processMediaAttachment(
    attachment: { dataBase64: string; startTime?: number; endTime?: number },
    isFromVideo: boolean
): Promise<Buffer> {
    const base64 = attachment.dataBase64.includes(",")
        ? attachment.dataBase64.split(",")[1]
        : attachment.dataBase64;
    const buffer = Buffer.from(base64, "base64");

    if (isFromVideo) {
        // Extract audio from video
        return await extractAudioFromVideo(
            buffer,
            attachment.startTime || 0,
            attachment.endTime || Number.POSITIVE_INFINITY
        );
    } else {
        // Audio file, return as-is
        return buffer;
    }
}

// ============================================================================
// Audio Merging (from audioMerger.ts)
// ============================================================================

/**
 * Merge two audio files using FFmpeg
 * @param inputFile1 Path to the first audio file
 * @param inputFile2 Path to the second audio file
 * @param outputPath Path where the merged audio file should be saved
 * @returns Promise that resolves to the output path if successful, or null if FFmpeg is unavailable or merge fails
 */
export async function mergeAudioFiles(
    inputFile1: string,
    inputFile2: string,
    outputPath: string
): Promise<string | null> {
    const fsModule = getFs();
    const spawn = getSpawn();

    if (!spawn) {
        console.warn("[audioProcessing] child_process.spawn not available");
        return null;
    }

    // Check if input files exist
    if (!fsModule.existsSync(inputFile1)) {
        console.warn(`[audioProcessing] Input file 1 does not exist: ${inputFile1}`);
        return null;
    }

    if (!fsModule.existsSync(inputFile2)) {
        console.warn(`[audioProcessing] Input file 2 does not exist: ${inputFile2}`);
        return null;
    }

    try {
        // Get FFmpeg path (may download if needed)
        const ffmpegPath = await getFFmpegPath(extensionContext);

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fsModule.existsSync(outputDir)) {
            fsModule.mkdirSync(outputDir, { recursive: true });
        }

        // Create a temporary file list for FFmpeg concat demuxer
        const tempDir = path.join(__dirname, "..", "..", ".temp");
        if (!fsModule.existsSync(tempDir)) {
            fsModule.mkdirSync(tempDir, { recursive: true });
        }

        const tempListFile = path.join(tempDir, `concat_list_${Date.now()}.txt`);
        // Use absolute paths for FFmpeg concat demuxer to avoid path resolution issues
        const absInputFile1 = path.isAbsolute(inputFile1) ? inputFile1 : path.resolve(inputFile1);
        const absInputFile2 = path.isAbsolute(inputFile2) ? inputFile2 : path.resolve(inputFile2);
        // Escape single quotes and backslashes for FFmpeg concat format
        const escapedFile1 = absInputFile1.replace(/\\/g, "/").replace(/'/g, "\\'");
        const escapedFile2 = absInputFile2.replace(/\\/g, "/").replace(/'/g, "\\'");
        const listContent = `file '${escapedFile1}'\nfile '${escapedFile2}'`;
        fsModule.writeFileSync(tempListFile, listContent);

        return new Promise((resolve) => {
            // Use concat demuxer for better format compatibility
            const args = [
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                tempListFile,
                "-c",
                "copy", // Copy codec (no re-encoding for speed)
                "-y", // Overwrite output file
                outputPath,
            ];

            const ffmpeg = spawn(ffmpegPath, args);

            let stderr = "";
            ffmpeg.stderr?.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on("error", (error: Error) => {
                // Clean up temp file
                try {
                    if (fsModule.existsSync(tempListFile)) {
                        fsModule.unlinkSync(tempListFile);
                    }
                } catch {
                    // Ignore cleanup errors
                }
                console.error(`[audioProcessing] FFmpeg spawn error:`, error);
                resolve(null);
            });

            ffmpeg.on("exit", (code: number | null) => {
                // Clean up temp file
                try {
                    if (fsModule.existsSync(tempListFile)) {
                        fsModule.unlinkSync(tempListFile);
                    }
                } catch {
                    // Ignore cleanup errors
                }

                if (code === 0) {
                    // Verify output file was created
                    if (fsModule.existsSync(outputPath)) {
                        console.log(`[audioProcessing] Successfully merged audio files to: ${outputPath}`);
                        resolve(outputPath);
                    } else {
                        console.warn(
                            `[audioProcessing] FFmpeg exited successfully but output file not found: ${outputPath}`
                        );
                        resolve(null);
                    }
                } else {
                    console.warn(`[audioProcessing] FFmpeg exited with code ${code}: ${stderr.slice(0, 500)}`);
                    resolve(null);
                }
            });
        });
    } catch (error) {
        console.error(`[audioProcessing] Error merging audio files:`, error);
        return null;
    }
}
