/**
 * Audio extraction utilities for extracting audio from video files
 * Prefers system PATH FFmpeg, falls back to @ffmpeg-installer/ffmpeg if needed
 */

import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

// Load spawn lazily to avoid bundling 'child_process' in test/browser builds
function getSpawn(): ((command: string, args?: readonly string[]) => any) | null {
    try {
        // Use eval to prevent webpack from statically analyzing this require
        // eslint-disable-next-line no-eval
        const req = eval('require') as any;
        const cp = req('child_process');
        return cp && cp.spawn ? cp.spawn : null;
    } catch {
        return null;
    }
}

// Cache for FFmpeg binary path
let ffmpegPath: string | null = null;

/**
 * Ensure binary has execute permissions
 */
function ensureExecutePermission(binaryPath: string): void {
    try {
        // Check if file exists
        if (!fs.existsSync(binaryPath)) {
            throw new Error(`Binary not found: ${binaryPath}`);
        }

        // Get current file stats
        const stats = fs.statSync(binaryPath);

        // Check if file has execute permission (for owner, group, or others)
        const mode = stats.mode;
        const executeBit = 0o111; // Execute permission bit

        if ((mode & executeBit) === 0) {
            // File doesn't have execute permission, add it
            // Add execute permission for owner, group, and others
            fs.chmodSync(binaryPath, mode | 0o111);
        }
    } catch (error) {
        // Log warning but don't throw - the spawn might still work
        console.warn(`[audioExtractor] Warning: Could not set execute permissions on ${binaryPath}: ${error instanceof Error ? error.message : String(error)}`);
    }
}

/**
 * Get FFmpeg binary path from @ffmpeg-installer/ffmpeg (fallback only)
 */
function getInstallerFFmpegPath(): string | null {
    if (ffmpegPath) {
        return ffmpegPath;
    }
    try {
        const req = eval('require') as any;
        const ffmpegInstaller = req('@ffmpeg-installer/ffmpeg');
        const installerPath: string | null = ffmpegInstaller.path;
        if (!installerPath) {
            return null;
        }
        ffmpegPath = installerPath;
        ensureExecutePermission(ffmpegPath);
        return ffmpegPath;
    } catch (error) {
        // Return null if installer package is not available
        console.warn(`[audioExtractor] Could not get FFmpeg path from installer: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

/**
 * Check if ffmpeg is available (tries system PATH first, falls back to installer package)
 */
async function isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const spawn = getSpawn();
        if (!spawn) {
            // In environments without child_process (e.g., tests), report not available
            resolve(false);
            return;
        }

        // Try system PATH first
        const systemFFmpeg = spawn('ffmpeg', ['-version']);

        const timeout = setTimeout(() => {
            systemFFmpeg.kill();
            // System PATH failed, try installer package
            tryInstallerPackage();
        }, 5000);

        systemFFmpeg.on('error', () => {
            clearTimeout(timeout);
            // System PATH failed, try installer package
            tryInstallerPackage();
        });

        systemFFmpeg.on('exit', (code: number | null) => {
            clearTimeout(timeout);
            if (code === 0) {
                resolve(true);
            } else {
                // System PATH failed, try installer package
                tryInstallerPackage();
            }
        });

        function tryInstallerPackage() {
            const installerPath = getInstallerFFmpegPath();
            if (!installerPath || !spawn) {
                resolve(false);
                return;
            }

            const installerFFmpeg = spawn(installerPath, ['-version']);
            const installerTimeout = setTimeout(() => {
                installerFFmpeg.kill();
                resolve(false);
            }, 5000);

            installerFFmpeg.on('error', () => {
                clearTimeout(installerTimeout);
                resolve(false);
            });

            installerFFmpeg.on('exit', (code: number | null) => {
                clearTimeout(installerTimeout);
                resolve(code === 0);
            });
        }
    });
}

/**
 * Extract audio from video using ffmpeg
 */
async function extractAudioWithFFmpeg(
    videoData: Buffer,
    startTime: number,
    endTime: number
): Promise<Buffer> {
    return new Promise((resolve, reject) => {
        const spawn = getSpawn();
        if (!spawn) {
            return reject(new Error('child_process.spawn not available'));
        }
        const tempDir = path.join(__dirname, '..', '..', '.temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempVideoPath = path.join(tempDir, `temp_video_${Date.now()}.mp4`);
        const tempAudioPath = path.join(tempDir, `temp_audio_${Date.now()}.webm`);

        // Write video to temp file
        fs.writeFileSync(tempVideoPath, videoData);

        // Build ffmpeg command
        const args = [
            '-i', tempVideoPath,
            '-vn', // No video
            '-acodec', 'libopus', // Use Opus codec for webm
            '-b:a', '128k', // Audio bitrate
        ];

        // Add time range if specified
        if (startTime > 0) {
            args.push('-ss', startTime.toString());
        }
        if (isFinite(endTime) && endTime > startTime) {
            args.push('-t', (endTime - startTime).toString());
        }

        args.push('-y', tempAudioPath); // Output file

        // Try system PATH first, fallback to installer package
        trySystemFFmpeg();

        function trySystemFFmpeg() {
            if (!spawn) {
                reject(new Error('child_process.spawn not available'));
                return;
            }
            const ffmpeg = spawn('ffmpeg', args);
            let stderr = '';

            ffmpeg.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on('error', (error: Error) => {
                // System PATH failed, try installer package
                const installerPath = getInstallerFFmpegPath();
                if (installerPath) {
                    tryInstallerFFmpeg(installerPath);
                } else {
                    // Clean up temp files
                    try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore cleanup errors */ }
                    try { fs.unlinkSync(tempAudioPath); } catch (e) { /* ignore cleanup errors */ }
                    reject(new Error(`FFmpeg error: ${error.message}`));
                }
            });

            ffmpeg.on('exit', (code: number | null) => {
                if (code === 0) {
                    try {
                        const audioBuffer = fs.readFileSync(tempAudioPath);
                        // Clean up temp files
                        fs.unlinkSync(tempVideoPath);
                        fs.unlinkSync(tempAudioPath);
                        resolve(audioBuffer);
                    } catch (error) {
                        reject(new Error(`Failed to read audio file: ${error}`));
                    }
                } else {
                    // System PATH failed, try installer package
                    const installerPath = getInstallerFFmpegPath();
                    if (installerPath) {
                        tryInstallerFFmpeg(installerPath);
                    } else {
                        // Clean up temp files
                        try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore cleanup errors */ }
                        try { fs.unlinkSync(tempAudioPath); } catch (e) { /* ignore cleanup errors */ }
                        reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
                    }
                }
            });
        }

        function tryInstallerFFmpeg(installerPath: string) {
            if (!spawn) {
                reject(new Error('child_process.spawn not available'));
                return;
            }
            const ffmpeg = spawn(installerPath, args);
            let stderr = '';

            ffmpeg.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on('error', (error: Error) => {
                // Clean up temp files
                try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore cleanup errors */ }
                try { fs.unlinkSync(tempAudioPath); } catch (e) { /* ignore cleanup errors */ }
                reject(new Error(`FFmpeg error: ${error.message}`));
            });

            ffmpeg.on('exit', (code: number | null) => {
                if (code === 0) {
                    try {
                        const audioBuffer = fs.readFileSync(tempAudioPath);
                        // Clean up temp files
                        fs.unlinkSync(tempVideoPath);
                        fs.unlinkSync(tempAudioPath);
                        resolve(audioBuffer);
                    } catch (error) {
                        reject(new Error(`Failed to read audio file: ${error}`));
                    }
                } else {
                    // Clean up temp files
                    try { fs.unlinkSync(tempVideoPath); } catch (e) { /* ignore cleanup errors */ }
                    try { fs.unlinkSync(tempAudioPath); } catch (e) { /* ignore cleanup errors */ }
                    reject(new Error(`FFmpeg exited with code ${code}: ${stderr}`));
                }
            });
        }
    });
}

/**
 * Fallback: Just copy the video data as-is (browser will handle playback)
 */
function fallbackCopyVideo(videoData: Buffer): Buffer {
    // For fallback, we just return the video data
    // The browser's audio player might be able to play just the audio track
    console.warn('FFmpeg not available, using video file as-is for audio attachment');
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
        console.log('Using FFmpeg to extract audio from video');
        try {
            return await extractAudioWithFFmpeg(videoData, startTime, endTime);
        } catch (error) {
            console.error('FFmpeg extraction failed, using fallback:', error);
            return fallbackCopyVideo(videoData);
        }
    } else {
        console.log('FFmpeg not available, using fallback method');
        return fallbackCopyVideo(videoData);
    }
}

/**
 * Process audio/video attachments and extract audio if needed
 */
export async function processMediaAttachment(
    attachment: any,
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
