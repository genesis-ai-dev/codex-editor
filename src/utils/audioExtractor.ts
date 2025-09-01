/**
 * Audio extraction utilities for extracting audio from video files
 * Uses fluent-ffmpeg if available, otherwise falls back to simple copy
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

/**
 * Check if ffmpeg is available on the system
 */
async function isFFmpegAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
        const spawn = getSpawn();
        if (!spawn) {
            // In environments without child_process (e.g., tests), report not available
            resolve(false);
            return;
        }

        const ffmpeg = spawn('ffmpeg', ['-version']);

        // Set a timeout to avoid hanging
        const timeout = setTimeout(() => {
            ffmpeg.kill();
            resolve(false);
        }, 5000);

        ffmpeg.on('error', () => {
            clearTimeout(timeout);
            resolve(false);
        });
        ffmpeg.on('exit', (code: number | null) => {
            clearTimeout(timeout);
            resolve(code === 0);
        });
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

        const ffmpeg = spawn('ffmpeg', args);

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
