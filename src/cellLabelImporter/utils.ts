import * as vscode from "vscode";
import * as path from "path";

/** SMPTE timecode: HH:MM:SS:FF, where the final field counts frames rather than milliseconds. */
const SMPTE_TIMECODE = /^(\d+):(\d+):(\d+):(\d+)$/;

/** Frame rate assumed for SMPTE timecode when the source file offers no evidence of its own. */
export const DEFAULT_TIMECODE_FPS = 24;

/**
 * Infer the frame rate of a column of SMPTE timecodes from the largest frame value present.
 * Frames run 0..fps-1, so the maximum observed frame puts a floor under the rate. Returns
 * undefined when no value in the column is SMPTE, which is the caller's signal to ignore fps
 * entirely.
 *
 * This deliberately resolves to the nominal rate (24/30/60) rather than its pulled-down
 * variant (23.976/29.97/59.94): the two are indistinguishable from frame values alone, and
 * they differ by well under the matcher's tolerance.
 */
export function detectTimecodeFrameRate(values: Array<string | undefined | null>): number | undefined {
    let maxFrame = -1;
    for (const value of values) {
        const match = String(value ?? "").trim().match(SMPTE_TIMECODE);
        if (!match) continue;
        maxFrame = Math.max(maxFrame, parseInt(match[4], 10));
    }
    if (maxFrame < 0) return undefined; // no SMPTE values at all
    if (maxFrame <= 23) return 24;
    if (maxFrame === 24) return 25;
    if (maxFrame <= 29) return 30;
    if (maxFrame <= 49) return 50;
    return 60;
}

/**
 * True for headers that mark a column as carrying time data of some kind.
 *
 * The lookahead rather than \b is deliberate: a spreadsheet with duplicate headers arrives here
 * de-duplicated as "TC In", "TC In_1", and \b does not match before an underscore.
 */
export function isTimeishHeader(key: string): boolean {
    const k = key.toLowerCase().trim();
    return k.includes("time") || k.includes("timecode") || /^tc[\s_-]*(in|out)(?![a-z])/.test(k);
}

/** True for headers that specifically mark the *start* of a cue. */
export function isStartTimeHeader(key: string): boolean {
    const k = key.toLowerCase().trim();
    if (k.includes("start") || k.includes("begin")) return true;
    if (k.replace(/\s+/g, "").includes("timein")) return true;
    return /^tc[\s_-]*in(?![a-z])/.test(k);
}

/**
 * True when a value is shaped like a clock time or timecode ("00:01:03.209", "00:01:03:05")
 * rather than a bare number.
 *
 * Used to break ties between columns that all *claim* to hold a start time: dialogue lists in
 * the wild carry copy-paste header mistakes, and a column headed "TC In" that actually holds
 * line numbers must not win over one that holds real timecode. Bare seconds are a legitimate
 * format, so this is only ever a preference — never a filter.
 */
export function looksLikeTimecodeValue(value: unknown): boolean {
    return /^\s*\d{1,3}(:\d{1,2}){1,3}([.,]\d+)?\s*$/.test(String(value ?? ""));
}

/**
 * Helper function to convert timestamp from various formats to seconds
 * Supports: HH:MM:SS,mmm, MM:SS.mmm, HH:MM:SS:FF (SMPTE), and raw seconds
 *
 * `fps` is only consulted for SMPTE timecode; pass the value from detectTimecodeFrameRate so a
 * 30fps list isn't read as though frames 24-29 overflowed into the next second.
 */
export function convertTimestampToSeconds(timestamp: string, fps?: number): number {
    if (!timestamp) return 0;

    // Handle different timestamp formats
    let match;

    // Format: HH:MM:SS:FF (SMPTE). Checked before the millisecond formats because those
    // require a , or . separator and so cannot collide with it.
    match = timestamp.match(SMPTE_TIMECODE);
    if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const frames = parseInt(match[4]);
        const rate = fps && fps > 0 ? fps : DEFAULT_TIMECODE_FPS;
        return hours * 3600 + minutes * 60 + seconds + frames / rate;
    }

    // Format: HH:MM:SS,mmm
    match = timestamp.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
    if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const milliseconds = parseInt(match[4]);
        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }

    // Format: HH:MM:SS (no milliseconds)
    match = timestamp.match(/^(\d+):(\d+):(\d+)$/);
    if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        return hours * 3600 + minutes * 60 + seconds;
    }

    // Format: MM:SS.mmm
    match = timestamp.match(/(\d+):(\d+)[,.](\d+)/);
    if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3]);
        return minutes * 60 + seconds + milliseconds / 1000;
    }

    // Format: MM:SS (no milliseconds)
    match = timestamp.match(/^(\d+):(\d+)$/);
    if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        return minutes * 60 + seconds;
    }

    // If it's already in seconds format
    if (!isNaN(parseFloat(timestamp))) {
        return parseFloat(timestamp);
    }

    return 0;
}

/**
 * Parse a timestamp range string like "50.634 --> 51.468" or "00:00:50.634 --> 00:00:51.468"
 * Returns [startSeconds, endSeconds]. If parsing fails, returns [0, 0].
 */
export function parseTimestampRange(range: string, fps?: number): [number, number] {
    if (!range) return [0, 0];
    // Split on arrow, allowing spaces
    const parts = range.split(/\s*-->\s*/);
    if (parts.length === 2) {
        const start = convertTimestampToSeconds(parts[0].trim(), fps);
        const end = convertTimestampToSeconds(parts[1].trim(), fps);
        return [start, end];
    }
    return [0, 0];
}

/**
 * Helper function to copy a file to temporary storage
 */
export async function copyToTempStorage(
    sourceUri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<vscode.Uri> {
    // Create a temp file path in extension's storage area
    const tempDirUri = vscode.Uri.joinPath(context.globalStorageUri, "temp");
    await vscode.workspace.fs.createDirectory(tempDirUri);

    const fileName = path.basename(sourceUri.fsPath);
    const tempFileUri = vscode.Uri.joinPath(tempDirUri, `${Date.now()}-${fileName}`);

    // Read the original file using VS Code's API
    const fileData = await vscode.workspace.fs.readFile(sourceUri);

    // Write it to the temp location
    await vscode.workspace.fs.writeFile(tempFileUri, fileData);

    return tempFileUri;
}

/**
 * Helper function to get column headers from imported data
 */
export function getColumnHeaders(importedData: any[]): string[] {
    if (importedData.length === 0) {
        return [];
    }

    // Get the first row and extract all keys
    const firstRow = importedData[0];
    return Object.keys(firstRow);
}

/**
 * Generate a nonce for CSP (pure utility, no VS Code dependency)
 */
export function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
