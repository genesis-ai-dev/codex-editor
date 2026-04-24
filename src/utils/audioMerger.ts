/**
 * Audio file merging utility.
 * Primary: FFmpeg concat demuxer (handles any format).
 * Fallback: pure-JS WAV merge from wavUtils.ts when FFmpeg is unavailable.
 */

import * as path from "path";
import * as fs from "fs";
import * as vscode from "vscode";
import { getFFmpegPath } from "./ffmpegManager";
import { mergeWavFiles } from "./wavUtils";
import { getAudioToolMode } from "./toolPreferences";
import { captureEvent } from "./telemetry";

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

export const initializeAudioMerger = (context: vscode.ExtensionContext): void => {
    extensionContext = context;
    console.log("[audioMerger] Initialized with extension context");
};

/**
 * Merge two audio files into a single output file.
 *
 * Tries FFmpeg first (supports any format). If FFmpeg is unavailable or
 * fails, falls back to pure-JS WAV concatenation.
 *
 * Returns the output path on success, or `null` if both strategies fail.
 */
export const mergeAudioFiles = async (
    inputFile1: string,
    inputFile2: string,
    outputPath: string,
): Promise<string | null> => {
    if (!fs.existsSync(inputFile1)) {
        console.warn(`[audioMerger] Input file 1 does not exist: ${inputFile1}`);
        return null;
    }
    if (!fs.existsSync(inputFile2)) {
        console.warn(`[audioMerger] Input file 2 does not exist: ${inputFile2}`);
        return null;
    }

    if (getAudioToolMode() !== "builtin") {
        const result = await mergeWithFFmpeg(inputFile1, inputFile2, outputPath);
        if (result) {
            return result;
        }
        console.info("[audioMerger] FFmpeg merge failed or unavailable — falling back to pure-JS WAV merge");
        captureEvent("tool_fallback_used", {
            tool: "audio",
            reason: "ffmpeg_merge_failed",
            mode: getAudioToolMode(),
        });
    } else {
        console.info("[audioMerger] Built-in audio mode active — using pure-JS WAV merge");
    }

    return mergeWavFiles(inputFile1, inputFile2, outputPath);
};

const mergeWithFFmpeg = async (
    inputFile1: string,
    inputFile2: string,
    outputPath: string,
): Promise<string | null> => {
    const spawn = getSpawn();
    if (!spawn) {
        return null;
    }

    try {
        const ffmpegPath = await getFFmpegPath(extensionContext);
        if (!ffmpegPath) {
            console.warn("[audioMerger] FFmpeg not available — cannot merge audio");
            return null;
        }

        const outputDir = path.dirname(outputPath);
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir, { recursive: true });
        }

        const tempDir = path.join(__dirname, "..", "..", ".temp");
        if (!fs.existsSync(tempDir)) {
            fs.mkdirSync(tempDir, { recursive: true });
        }

        const tempListFile = path.join(tempDir, `concat_list_${Date.now()}.txt`);
        const absInputFile1 = path.isAbsolute(inputFile1) ? inputFile1 : path.resolve(inputFile1);
        const absInputFile2 = path.isAbsolute(inputFile2) ? inputFile2 : path.resolve(inputFile2);
        const escapedFile1 = absInputFile1.replace(/\\/g, "/").replace(/'/g, "\\'");
        const escapedFile2 = absInputFile2.replace(/\\/g, "/").replace(/'/g, "\\'");
        fs.writeFileSync(tempListFile, `file '${escapedFile1}'\nfile '${escapedFile2}'`);

        const cleanupTemp = () => {
            try {
                if (fs.existsSync(tempListFile)) {
                    fs.unlinkSync(tempListFile);
                }
            } catch {
                // best-effort cleanup
            }
        };

        return new Promise<string | null>((resolve) => {
            const args = [
                "-f", "concat",
                "-safe", "0",
                "-i", tempListFile,
                "-c", "copy",
                "-y",
                outputPath,
            ];

            const ffmpeg = spawn(ffmpegPath, args);

            let stderr = "";
            ffmpeg.stderr.on("data", (data: Buffer) => {
                stderr += data.toString();
            });

            ffmpeg.on("error", (error: Error) => {
                cleanupTemp();
                console.error("[audioMerger] FFmpeg spawn error:", error);
                resolve(null);
            });

            ffmpeg.on("exit", (code: number | null) => {
                cleanupTemp();
                if (code === 0 && fs.existsSync(outputPath)) {
                    console.log(`[audioMerger] Successfully merged audio files to: ${outputPath}`);
                    resolve(outputPath);
                } else {
                    if (code !== 0) {
                        console.warn(`[audioMerger] FFmpeg exited with code ${code}: ${stderr.slice(0, 500)}`);
                    }
                    resolve(null);
                }
            });
        });
    } catch (error) {
        console.error("[audioMerger] Error in FFmpeg merge:", error);
        return null;
    }
};
