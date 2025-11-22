/**
 * Audio file merging utility using FFmpeg
 * Concatenates two audio files into a single merged audio file
 */

import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { getFFmpegPath } from './ffmpegManager';

// Lazy load to avoid bundling issues
function getFs(): typeof fs {
    try {
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

// Global extension context for ffmpeg downloads
let extensionContext: vscode.ExtensionContext | undefined;

/**
 * Initialize audio merger with extension context
 * Call this once during extension activation
 */
export function initializeAudioMerger(context: vscode.ExtensionContext): void {
    extensionContext = context;
    console.log('[audioMerger] Initialized with extension context');
}

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
    const fs = getFs();
    const spawn = getSpawn();

    if (!spawn) {
        console.warn('[audioMerger] child_process.spawn not available');
        return null;
    }

    // Check if input files exist
    if (!fs.existsSync(inputFile1)) {
        console.warn(`[audioMerger] Input file 1 does not exist: ${inputFile1}`);
        return null;
    }

    if (!fs.existsSync(inputFile2)) {
        console.warn(`[audioMerger] Input file 2 does not exist: ${inputFile2}`);
        return null;
    }

    try {
        // Get FFmpeg path (may download if needed)
        const ffmpegPath = await getFFmpegPath(extensionContext);

        // Ensure output directory exists
        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        // Create a temporary file list for FFmpeg concat demuxer
        // This approach works better for different audio formats
        const tempDir = path.join(__dirname, '..', '..', '.temp');
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempListFile = path.join(tempDir, `concat_list_${Date.now()}.txt`);
        // Use absolute paths for FFmpeg concat demuxer to avoid path resolution issues
        const absInputFile1 = path.isAbsolute(inputFile1) ? inputFile1 : path.resolve(inputFile1);
        const absInputFile2 = path.isAbsolute(inputFile2) ? inputFile2 : path.resolve(inputFile2);
        // Escape single quotes and backslashes for FFmpeg concat format
        const escapedFile1 = absInputFile1.replace(/\\/g, '/').replace(/'/g, "\\'");
        const escapedFile2 = absInputFile2.replace(/\\/g, '/').replace(/'/g, "\\'");
        const listContent = `file '${escapedFile1}'\nfile '${escapedFile2}'`;
        fs.writeFileSync(tempListFile, listContent);

        return new Promise((resolve, reject) => {
            // Use concat demuxer for better format compatibility
            const args = [
                '-f', 'concat',
                '-safe', '0',
                '-i', tempListFile,
                '-c', 'copy', // Copy codec (no re-encoding for speed)
                '-y', // Overwrite output file
                outputPath
            ];

            const ffmpeg = spawn(ffmpegPath, args);

            let stderr = '';
            ffmpeg.stderr.on('data', (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on('error', (error: Error) => {
                // Clean up temp file
                try {
                    if (fs.existsSync(tempListFile)) {
                        fs.unlinkSync(tempListFile);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }
                console.error(`[audioMerger] FFmpeg spawn error:`, error);
                resolve(null); // Return null instead of rejecting to allow text merge to continue
            });

            ffmpeg.on('exit', (code: number | null) => {
                // Clean up temp file
                try {
                    if (fs.existsSync(tempListFile)) {
                        fs.unlinkSync(tempListFile);
                    }
                } catch (e) {
                    // Ignore cleanup errors
                }

                if (code === 0) {
                    // Verify output file was created
                    if (fs.existsSync(outputPath)) {
                        console.log(`[audioMerger] Successfully merged audio files to: ${outputPath}`);
                        resolve(outputPath);
                    } else {
                        console.warn(`[audioMerger] FFmpeg exited successfully but output file not found: ${outputPath}`);
                        resolve(null);
                    }
                } else {
                    console.warn(`[audioMerger] FFmpeg exited with code ${code}: ${stderr.slice(0, 500)}`);
                    resolve(null); // Return null instead of rejecting to allow text merge to continue
                }
            });
        });
    } catch (error) {
        console.error(`[audioMerger] Error merging audio files:`, error);
        return null;
    }
}

