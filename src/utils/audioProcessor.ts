/**
 * Backend audio processing utilities using FFmpeg binaries
 * Handles audio decoding, silence detection, segmentation, and waveform generation
 * Uses @ffmpeg-installer/ffmpeg for cross-platform FFmpeg binaries
 */

import * as path from 'path';
import * as fs from 'fs';

// Lazy load to avoid bundling issues
function getFs(): typeof fs {
    try {
        // Use eval to prevent webpack from analyzing
        const req = eval('require') as any;
        return req('fs');
    } catch {
        return fs;
    }
}

function getSpawn(): ((command: string, args?: readonly string[]) => any) | null {
    try {
        const req = eval('require') as any;
        const cp = req('child_process');
        return cp && cp.spawn ? cp.spawn : null;
    } catch {
        return null;
    }
}

// Cache for FFmpeg and FFprobe binary paths
let ffmpegPath: string | null = null;
let ffprobePath: string | null = null;

/**
 * Ensure binary has execute permissions
 */
function ensureExecutePermission(binaryPath: string): void {
    const fsModule = getFs();
    try {
        // Check if file exists
        if (!fsModule.existsSync(binaryPath)) {
            throw new Error(`Binary not found: ${binaryPath}`);
        }

        // Get current file stats
        const stats = fsModule.statSync(binaryPath);

        // Check if file has execute permission (for owner, group, or others)
        const mode = stats.mode;
        const executeBit = 0o111; // Execute permission bit

        if ((mode & executeBit) === 0) {
            // File doesn't have execute permission, add it
            // Add execute permission for owner, group, and others
            fsModule.chmodSync(binaryPath, mode | 0o111);
        }
    } catch (error) {
        // Log warning but don't throw - the spawn might still work
        console.warn(`[audioProcessor] Warning: Could not set execute permissions on ${binaryPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get FFmpeg binary path from @ffmpeg-installer/ffmpeg
 */
function getFFmpegPath(): string {
    if (ffmpegPath) {
        return ffmpegPath;
    }
    try {
        const req = eval('require') as any;
        const ffmpegInstaller = req('@ffmpeg-installer/ffmpeg');
        const installerPath: string | null = ffmpegInstaller.path;
        if (!installerPath) {
            throw new Error('FFmpeg path is null');
        }
        ffmpegPath = installerPath;
        ensureExecutePermission(ffmpegPath);
        return ffmpegPath;
    } catch (error) {
        throw new Error(`Failed to get FFmpeg path: ${error instanceof Error ? error.message : String(error)}. Make sure @ffmpeg-installer/ffmpeg is installed.`);
    }
}

/**
 * Get FFprobe binary path from @ffprobe-installer/ffprobe
 */
function getFFprobePath(): string {
    if (ffprobePath) {
        return ffprobePath;
    }
    try {
        const req = eval('require') as any;
        const ffprobeInstaller = req('@ffprobe-installer/ffprobe');
        const installerPath: string | null = ffprobeInstaller.path;
        if (!installerPath) {
            throw new Error('FFprobe path is null');
        }
        ffprobePath = installerPath;
        ensureExecutePermission(ffprobePath);
        return ffprobePath;
    } catch (error) {
        throw new Error(`Failed to get FFprobe path: ${error instanceof Error ? error.message : String(error)}. Make sure @ffprobe-installer/ffprobe is installed.`);
    }
}

export interface AudioFileMetadata {
    id: string;
    name: string;
    path: string;
    durationSec: number;
    sizeBytes: number;
    previewPeaks: number[];
    segments: Array<{ startSec: number; endSec: number; }>;
}

export interface AudioSegment {
    startSec: number;
    endSec: number;
}

/**
 * Get audio duration using FFprobe
 */
async function getAudioDuration(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error('child_process.spawn not available'));
        }

        const ffprobePath = getFFprobePath();
        const ffprobe = spawn(ffprobePath, [
            '-v', 'error',
            '-show_entries', 'format=duration',
            '-of', 'default=noprint_wrappers=1:nokey=1',
            filePath
        ]);

        let output = '';
        ffprobe.stdout.on('data', (data: Buffer) => {
            output += data.toString();
        });

        ffprobe.on('exit', (code: number | null) => {
            if (code === 0) {
                const duration = parseFloat(output.trim());
                resolve(isNaN(duration) ? 0 : duration);
            } else {
                reject(new Error('Failed to get audio duration'));
            }
        });

        ffprobe.on('error', reject);
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
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error('child_process.spawn not available'));
        }

        const ffmpegPath = getFFmpegPath();

        // Prepare output buckets
        const peaks: number[] = new Array(Math.max(1, targetPoints)).fill(0);
        const totalSamples = Math.max(1, Math.floor(durationSec * sampleRate));
        const samplesPerPeak = Math.max(1, Math.ceil(totalSamples / peaks.length));

        let samplesProcessed = 0;
        let leftover: Buffer | null = null;

        // Extract audio as 32-bit float, mono, downsampled sampleRate
        const ffmpeg = spawn(ffmpegPath, [
            '-i', filePath,
            '-f', 'f32le',
            '-ac', '1',
            '-ar', String(sampleRate),
            'pipe:1'
        ]);

        ffmpeg.stdout.on('data', (chunk: Buffer) => {
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

        ffmpeg.on('exit', (code: number | null) => {
            if (code !== 0) {
                return reject(new Error('FFmpeg failed to decode audio'));
            }
            resolve(peaks);
        });

        ffmpeg.on('error', reject);
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
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error('child_process.spawn not available'));
        }

        const ffmpegPath = getFFmpegPath();
        const ffmpeg = spawn(ffmpegPath, [
            '-i', filePath,
            '-af', `silencedetect=n=${thresholdDb}dB:d=${minDuration}`,
            '-f', 'null',
            '-'
        ]);

        let stderr = '';
        ffmpeg.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on('exit', async (code: number | null) => {
            console.log(`[audioProcessor] FFmpeg silence detection exit code: ${code}`);
            console.log(`[audioProcessor] FFmpeg stderr length: ${stderr.length} chars`);

            // Log a sample of the actual output for debugging
            const sampleLines = stderr.split('\n').filter(line =>
                line.includes('silence_start') || line.includes('silence_end')
            ).slice(0, 10);
            if (sampleLines.length > 0) {
                console.log(`[audioProcessor] Sample FFmpeg output lines:`, sampleLines);
            }

            // Parse silence detection output - collect all starts and ends separately
            const silenceStarts: number[] = [];
            const silenceEnds: number[] = [];

            // More robust regex that handles FFmpeg's output format
            const lines = stderr.split('\n');
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

            const silenceRegions: Array<{ start: number; end: number; }> = [];

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
            const cleanedRegions: Array<{ start: number; end: number; }> = [];
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

            console.log(`[audioProcessor] Found ${silenceStarts.length} silence starts, ${silenceEnds.length} silence ends`);
            if (silenceStarts.length > 0 || silenceEnds.length > 0) {
                console.log(`[audioProcessor] Silence starts: [${silenceStarts.slice(0, 10).join(', ')}${silenceStarts.length > 10 ? '...' : ''}]`);
                console.log(`[audioProcessor] Silence ends: [${silenceEnds.slice(0, 10).join(', ')}${silenceEnds.length > 10 ? '...' : ''}]`);
            }
            console.log(`[audioProcessor] Created ${cleanedRegions.length} silence regions`);
            if (cleanedRegions.length > 0) {
                console.log(`[audioProcessor] Silence regions: [${cleanedRegions.slice(0, 5).map(r => `${r.start.toFixed(2)}-${r.end.toFixed(2)}`).join(', ')}${cleanedRegions.length > 5 ? '...' : ''}]`);
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
                const uniqueBreakpoints = breakpoints.filter((bp, i) =>
                    i === 0 || bp - breakpoints[i - 1] >= 0.01
                );

                const segments: AudioSegment[] = [];
                for (let i = 0; i < uniqueBreakpoints.length - 1; i++) {
                    segments.push({
                        startSec: uniqueBreakpoints[i],
                        endSec: uniqueBreakpoints[i + 1]
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
                                endSec: currentEnd
                            });
                            currentStart = currentEnd;
                        }
                    }
                }

                console.log(`[audioProcessor] Final segments: ${finalSegments.length}`);
                if (finalSegments.length > 0) {
                    console.log(`[audioProcessor] First 5 segments: [${finalSegments.slice(0, 5).map(s => `${s.startSec.toFixed(2)}-${s.endSec.toFixed(2)}`).join(', ')}${finalSegments.length > 5 ? '...' : ''}]`);
                }

                resolve(finalSegments);
            } catch (error) {
                reject(error);
            }
        });

        ffmpeg.on('error', reject);
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
    console.log(`[audioProcessor] Processing file: ${filePath}`);
    const fsModule = getFs();

    if (!fsModule.existsSync(filePath)) {
        const error = `Audio file not found: ${filePath}`;
        console.error(`[audioProcessor] ${error}`);
        throw new Error(error);
    }

    console.log(`[audioProcessor] File exists, getting stats...`);
    const stats = fsModule.statSync(filePath);
    const fileName = path.basename(filePath, path.extname(filePath));
    const fileId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    console.log(`[audioProcessor] File: ${fileName}, ID: ${fileId}, Size: ${stats.size} bytes`);

    console.log(`[audioProcessor] Starting parallel processing (duration, peaks, segments)...`);

    // Get duration first to calculate appropriate target points
    const duration = await getAudioDuration(filePath).catch(err => {
        console.error(`[audioProcessor] Error getting duration:`, err);
        throw err;
    });

    // Calculate target points: ~50 points per second, capped between 1000-8000
    const targetPoints = Math.max(1000, Math.min(8000, Math.floor(duration * 50)));
    console.log(`[audioProcessor] Duration: ${duration}s, generating ${targetPoints} waveform points`);

    const [peaks, segments] = await Promise.all([
        generateWaveformPeaks(filePath, duration, targetPoints).catch(err => {
            console.error(`[audioProcessor] Error generating peaks:`, err);
            return []; // Return empty array on error instead of throwing
        }),
        detectSilence(filePath, thresholdDb, minDuration).catch(err => {
            console.error(`[audioProcessor] Error detecting silence:`, err);
            throw err;
        })
    ]);

    console.log(`[audioProcessor] Processing complete: duration=${duration}s, peaks=${peaks.length}, segments=${segments.length}`);

    return {
        id: fileId,
        name: fileName,
        path: filePath,
        durationSec: duration,
        sizeBytes: stats.size,
        previewPeaks: Array.isArray(peaks) ? peaks : [],
        segments
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
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error('child_process.spawn not available'));
        }

        const ffmpegPath = getFFmpegPath();
        const duration = endSec - startSec;
        const args = [
            '-i', sourcePath,
            '-ss', startSec.toString(),
            '-t', duration.toString(),
            '-acodec', 'pcm_s16le',
            '-ar', '44100',
            '-ac', '1',
            '-y',
            outputPath
        ];

        const ffmpeg = spawn(ffmpegPath, args);

        let stderr = '';
        ffmpeg.stderr.on('data', (data: Buffer) => {
            stderr += data.toString();
        });

        ffmpeg.on('exit', (code: number | null) => {
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`FFmpeg segment extraction failed: ${stderr}`));
            }
        });

        ffmpeg.on('error', reject);
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

