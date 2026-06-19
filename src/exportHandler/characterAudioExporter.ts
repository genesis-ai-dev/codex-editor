import * as vscode from "vscode";
import { basename } from "path";
import { CodexNotebookAsJSONData } from "@types";
import { execFile } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import * as path from "path";
import { getFFmpegPath } from "../utils/ffmpegManager";
import { EditMapUtils } from "../utils/editMapUtils";
import {
    sanitizeFileComponent,
    getTargetLanguageCode,
    pickAudioAttachmentForCell,
    readNotebook,
    getAudioExporterContext,
    setupAudioStreaming,
    resolveAudioBytes,
    runWithConcurrencyPool,
    tokenToAbortSignal,
    ExportCancelledError,
    type FrontierLfsApi,
} from "./audioExporter";
import { isExportableCell } from "./audioAttachmentUtils";
import { buildMilestoneIndexModel } from "../../sharedUtils/milestoneIndexUtils";

const execFileAsync = promisify(execFile);

const DEBUG = false;
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[CharacterAudioExporter]", ...args);
    }
}

export type CharacterAudioFormat = "wav" | "flac" | "opus";

interface CharacterClip {
    absolutePath: string;
    startMs: number;
    endMs?: number;
    cellId: string;
}

interface CharacterInterval {
    startSec: number;
    endSec: number;
    hasAudio: boolean;
}

export interface CharacterPreviewCharacter {
    label: string;
    key: string;
    intervals: CharacterInterval[];
    audioCellCount: number;
    noAudioCellCount: number;
    untimedCellCount: number;
    speakingSecAudio: number;
    speakingSecNoAudio: number;
    lastEndSec: number;
    willExport: boolean;
}

export interface CharacterPreviewFile {
    fileBase: string;
    episodeDurationSec: number;
    characters: CharacterPreviewCharacter[];
    skippedCells: number;
    missingTiming: boolean;
}

export interface CharacterPreviewResult {
    files: CharacterPreviewFile[];
}

function formatExtension(fmt: CharacterAudioFormat): string {
    switch (fmt) {
        case "flac": return ".flac";
        case "opus": return ".opus";
        case "wav":
        default: return ".wav";
    }
}

function codecArgs(fmt: CharacterAudioFormat, sampleRate: number): string[] {
    switch (fmt) {
        case "flac":
            return ["-c:a", "flac", "-ar", String(sampleRate), "-ac", "1", "-compression_level", "8"];
        case "opus":
            return ["-c:a", "libopus", "-b:a", "64k", "-vbr", "on", "-ar", "48000", "-ac", "1"];
        case "wav":
        default:
            return ["-ar", String(sampleRate), "-ac", "1", "-sample_fmt", "s16"];
    }
}

function coerceFiniteNumber(value: unknown): number | undefined {
    if (value === undefined || value === null) return undefined;
    const num = typeof value === "number" ? value : Number(value);
    return Number.isFinite(num) ? num : undefined;
}

// Resolve the current cell label, preferring the materialized value but falling
// back to the most recent ["metadata", "cellLabel"] CRDT edit when the cell
// hasn't been re-saved since the label change.
function resolveCellLabel(cell: any): string | undefined {
    const direct = cell?.metadata?.cellLabel;
    if (typeof direct === "string" && direct.trim() !== "") return direct;

    const edits = cell?.metadata?.edits;
    if (!Array.isArray(edits) || edits.length === 0) return undefined;

    const labelEditMap = EditMapUtils.cellLabel();
    let latest: { value: unknown; timestamp: number; } | null = null;
    for (const edit of edits) {
        if (!edit || !Array.isArray(edit.editMap)) continue;
        if (!EditMapUtils.equals(edit.editMap, labelEditMap)) continue;
        const ts = typeof edit.timestamp === "number" ? edit.timestamp : 0;
        if (!latest || ts > latest.timestamp) {
            latest = { value: edit.value, timestamp: ts };
        }
    }
    if (latest && typeof latest.value === "string" && latest.value.trim() !== "") {
        return latest.value;
    }
    return undefined;
}

function computeEpisodeDurationSeconds(cells: CodexNotebookAsJSONData["cells"]): number {
    let maxEnd = 0;
    for (const cell of cells) {
        if (!isExportableCell(cell)) continue;
        const data = (cell?.metadata?.data || {}) as { startTime?: unknown; endTime?: unknown; };
        const end = coerceFiniteNumber(data.endTime) ?? coerceFiniteNumber(data.startTime);
        if (end !== undefined && end > maxEnd) maxEnd = end;
    }
    return maxEnd;
}

interface CharacterGroup {
    label: string;
    clips: CharacterClip[];
}

function groupClipsByCharacter(
    cells: CodexNotebookAsJSONData["cells"],
    workspaceFolder: vscode.WorkspaceFolder,
    milestoneFilter?: number[]
): { groups: Map<string, CharacterGroup>; skipped: number; } {
    const groups = new Map<string, CharacterGroup>();
    let skipped = 0;

    // Only build the (somewhat costly) milestone index when the user actually
    // narrowed the export to a subset of milestones on step 3.
    const milestoneModel = milestoneFilter ? buildMilestoneIndexModel(cells) : undefined;

    for (let cellIndex = 0; cellIndex < cells.length; cellIndex++) {
        const cell = cells[cellIndex];
        if (milestoneFilter) {
            const milestoneIndex = milestoneModel!.cellMilestoneIndices[cellIndex] ?? 0;
            if (!milestoneFilter.includes(milestoneIndex)) continue;
        }
        if (!isExportableCell(cell)) continue;
        const cellId: string | undefined = cell?.metadata?.id;
        if (!cellId) continue;

        const outcome = pickAudioAttachmentForCell(cell);
        if (outcome.state !== "ready" || !outcome.pick) continue;

        const data = (cell?.metadata?.data || {}) as { startTime?: unknown; endTime?: unknown; };
        const startSec = coerceFiniteNumber(data.startTime);
        if (startSec === undefined) {
            // No timeline position — cannot place in consolidated track
            skipped++;
            continue;
        }
        const endSec = coerceFiniteNumber(data.endTime);

        const srcPath = outcome.pick.url;
        const absoluteSrc = srcPath.startsWith("/") || /^[A-Za-z]:\\/.test(srcPath)
            ? vscode.Uri.file(srcPath)
            : vscode.Uri.joinPath(workspaceFolder.uri, srcPath);

        const resolvedLabel = resolveCellLabel(cell);
        const labelStr = resolvedLabel && resolvedLabel.trim() !== ""
            ? resolvedLabel
            : "unlabeled";
        const key = sanitizeFileComponent(labelStr.toLowerCase()) || "unlabeled";

        if (!groups.has(key)) groups.set(key, { label: labelStr, clips: [] });
        groups.get(key)!.clips.push({
            absolutePath: absoluteSrc.fsPath,
            startMs: Math.max(0, Math.floor(startSec * 1000)),
            endMs: endSec !== undefined && endSec > startSec
                ? Math.floor(endSec * 1000)
                : undefined,
            cellId,
        });
    }

    return { groups, skipped };
}

async function renderCharacterTrack(
    ffmpegBinaryPath: string,
    clips: CharacterClip[],
    trimDurationSec: number,
    outputPath: string,
    format: CharacterAudioFormat
): Promise<void> {
    if (trimDurationSec <= 0) {
        throw new Error("Trim duration must be greater than 0");
    }

    const sampleRate = 48000;
    const baseDurationStr = trimDurationSec.toFixed(3);
    const outArgs = codecArgs(format, sampleRate);

    // No clips for this character — just emit silence of trim length.
    if (clips.length === 0) {
        await execFileAsync(ffmpegBinaryPath, [
            "-y",
            "-f", "lavfi",
            "-t", baseDurationStr,
            "-i", `anullsrc=r=${sampleRate}:cl=mono`,
            ...outArgs,
            outputPath,
        ], { maxBuffer: 1024 * 1024 * 50 });
        return;
    }

    // Build filter_complex: each clip gets resampled to mono 48k, delayed to its
    // cell's startTime, then mixed onto a silent base trimmed to this character's
    // last endTime. `amix duration=first` clamps the result to the base length.
    const filterLines: string[] = [];
    for (let i = 0; i < clips.length; i++) {
        const inputIdx = i + 1; // input 0 is the silent base
        const delayMs = clips[i].startMs;
        filterLines.push(
            `[${inputIdx}:a]aresample=${sampleRate},aformat=channel_layouts=mono:sample_fmts=s16,adelay=${delayMs}:all=1[a${inputIdx}]`
        );
    }
    const mixInputs = ["[0:a]", ...clips.map((_, i) => `[a${i + 1}]`)].join("");
    filterLines.push(
        `${mixInputs}amix=inputs=${clips.length + 1}:duration=first:normalize=0[out]`
    );
    const filterScript = filterLines.join(";\n");

    const tempDir = os.tmpdir();
    const uniq = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const scriptPath = path.join(tempDir, `codex-char-filter-${uniq}.txt`);
    fs.writeFileSync(scriptPath, filterScript);

    const args: string[] = [
        "-y",
        "-f", "lavfi",
        "-t", baseDurationStr,
        "-i", `anullsrc=r=${sampleRate}:cl=mono`,
    ];
    for (const clip of clips) {
        args.push("-i", clip.absolutePath);
    }
    args.push(
        "-filter_complex_script", scriptPath,
        "-map", "[out]",
        ...outArgs,
        outputPath,
    );

    try {
        await execFileAsync(ffmpegBinaryPath, args, { maxBuffer: 1024 * 1024 * 200 });
    } finally {
        try { fs.unlinkSync(scriptPath); } catch { /* ignore */ }
    }
}

function computeTrimDurationSec(clips: CharacterClip[], fallbackSec: number): number {
    let maxEndMs = 0;
    for (const c of clips) {
        if (c.endMs !== undefined && c.endMs > maxEndMs) maxEndMs = c.endMs;
        else if (c.startMs > maxEndMs) maxEndMs = c.startMs;
    }
    if (maxEndMs <= 0) return fallbackSec;
    // Small pad (250ms) so we don't truncate the very last sample on lossy codecs.
    return Math.max(0.25, maxEndMs / 1000 + 0.25);
}

// Parallelism for streaming clip downloads. Mirrors the per-cell exporter.
const CHARACTER_DOWNLOAD_CONCURRENCY = 30;

interface ResolvedSource {
    /** Local path FFmpeg can read (the original file, or a temp file holding
     * the downloaded/cached bytes). */
    localPath?: string;
    error?: string;
}

/**
 * Resolves every unique clip source to a local file path that FFmpeg can read.
 * In auto-download mode this just reads the bytes already on disk; in
 * stream-only / stream-and-save it downloads LFS objects (with retry + the
 * shared in-memory cache) and materializes them as temp files, because FFmpeg
 * consumes file paths, not in-memory buffers.
 *
 * Returns a map keyed by the original absolute source path so callers can map
 * each clip back to its local copy (and dedupes downloads — a source used by
 * multiple clips is fetched once).
 */
async function resolveSourcesToLocalFiles(
    uniqueSources: string[],
    workspaceFolderUri: vscode.Uri,
    frontierApi: FrontierLfsApi | null,
    tempRoot: string,
    batchId: number,
    signal: AbortSignal | undefined,
    token: vscode.CancellationToken | undefined,
    onProgress?: (completed: number, total: number) => void
): Promise<Map<string, ResolvedSource>> {
    const resolved = new Map<string, ResolvedSource>();

    const results = await runWithConcurrencyPool<string, ResolvedSource>(
        uniqueSources,
        CHARACTER_DOWNLOAD_CONCURRENCY,
        async (srcPath, idx) => {
            const result = await resolveAudioBytes(
                vscode.Uri.file(srcPath),
                workspaceFolderUri,
                frontierApi,
                signal
            );
            if (result.error || !result.data) {
                return { error: result.error ?? "No data returned" };
            }
            const ext = path.extname(srcPath) || ".wav";
            const tempPath = path.join(tempRoot, `clip-${batchId}-${idx}${ext}`);
            await fs.promises.writeFile(tempPath, result.data);
            return { localPath: tempPath };
        },
        onProgress,
        token
    );

    for (let i = 0; i < uniqueSources.length; i++) {
        const settled = results[i];
        if (settled.status === "fulfilled") {
            resolved.set(uniqueSources[i], settled.value);
        } else if (settled.reason instanceof ExportCancelledError) {
            resolved.set(uniqueSources[i], { error: "cancelled" });
        } else {
            resolved.set(uniqueSources[i], {
                error: settled.reason ? String(settled.reason) : "Failed to resolve audio",
            });
        }
    }

    return resolved;
}

export interface CharacterExportOptions {
    format?: CharacterAudioFormat;
    selectedMilestonesByFile?: Record<string, number[]>;
}

export async function exportAudioByCharacter(
    userSelectedPath: string,
    filesToExport: string[],
    options?: CharacterExportOptions,
    token?: vscode.CancellationToken
): Promise<void> {
    const format: CharacterAudioFormat = options?.format ?? "flac";
    const ext = formatExtension(format);
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No project folder found. Please open a project first.");
        return;
    }
    const workspaceFolder = workspaceFolders[0];

    const ffmpegBinaryPath = await getFFmpegPath(getAudioExporterContext());
    if (!ffmpegBinaryPath) {
        vscode.window.showErrorMessage("FFmpeg is not available; cannot consolidate audio by character.");
        return;
    }

    // Resolve the media strategy and (when streaming) the Frontier download API
    // up front, so a stream-only project can pull its audio on demand exactly
    // like the per-cell exporter. A descriptive error here means we stop with a
    // clear message rather than silently writing zero files.
    const { frontierApi, error: streamingSetupError } = await setupAudioStreaming(workspaceFolder.uri);
    if (streamingSetupError) {
        vscode.window.showErrorMessage(streamingSetupError);
        return;
    }

    const { signal: abortSignal, dispose: disposeAbort } = tokenToAbortSignal(token);

    const exportDir = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportDir);

    const selectedFiles = filesToExport.map((p) => vscode.Uri.file(p));
    if (selectedFiles.length === 0) {
        disposeAbort();
        vscode.window.showInformationMessage("No files selected for export.");
        return;
    }

    const milestoneSelection = options?.selectedMilestonesByFile;

    // One temp directory for the whole run; cleaned up in `finally`.
    const tempRoot = path.join(
        os.tmpdir(),
        `codex-char-export-${Date.now()}-${Math.random().toString(36).slice(2)}`
    );
    await fs.promises.mkdir(tempRoot, { recursive: true });

    try {
        return await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Audio by Character",
                cancellable: false,
            },
            async (progress) => {
                const increment = 100 / selectedFiles.length;
                let writtenCount = 0;
                let charactersWritten = 0;
                let skippedCellsTotal = 0;
                let downloadFailCount = 0;
                const filesWithoutTiming: string[] = [];

                for (const [index, file] of selectedFiles.entries()) {
                    if (token?.isCancellationRequested) break;
                    const fileBase = basename(file.fsPath).split(".")[0] || "FILE";
                    progress.report({
                        message: `Processing ${basename(file.fsPath)} (${index + 1}/${selectedFiles.length})`,
                        increment,
                    });

                    // Honor per-milestone selection (step 3). An explicit empty
                    // array means the user cleared every milestone for this file.
                    const milestoneFilter = milestoneSelection?.[file.fsPath];
                    if (
                        milestoneSelection &&
                        Object.prototype.hasOwnProperty.call(milestoneSelection, file.fsPath) &&
                        milestoneFilter &&
                        milestoneFilter.length === 0
                    ) {
                        continue;
                    }

                    let notebook: CodexNotebookAsJSONData;
                    try {
                        notebook = await readNotebook(file);
                    } catch (e) {
                        debug(`Failed to read notebook ${file.fsPath}:`, e);
                        continue;
                    }

                    const episodeDurationSec = computeEpisodeDurationSeconds(notebook.cells);
                    if (episodeDurationSec <= 0) {
                        filesWithoutTiming.push(fileBase);
                        debug(`Skipping ${fileBase}: no timing data found`);
                        continue;
                    }

                    const { groups, skipped } = groupClipsByCharacter(
                        notebook.cells,
                        workspaceFolder,
                        milestoneFilter
                    );
                    skippedCellsTotal += skipped;

                    if (groups.size === 0) {
                        debug(`No character audio found for ${fileBase}`);
                        continue;
                    }

                    // Resolve every unique clip source (download LFS objects when
                    // streaming) to a local file FFmpeg can read. Dedupe so a
                    // source shared by multiple clips is only fetched once.
                    const uniqueSources = [
                        ...new Set(
                            [...groups.values()].flatMap((g) => g.clips.map((c) => c.absolutePath))
                        ),
                    ];
                    progress.report({
                        message: `Downloading ${fileBase} audio (0/${uniqueSources.length})`,
                    });
                    const resolvedSources = await resolveSourcesToLocalFiles(
                        uniqueSources,
                        workspaceFolder.uri,
                        frontierApi,
                        tempRoot,
                        index,
                        abortSignal,
                        token,
                        (completed, total) => {
                            progress.report({
                                message: `Downloading ${fileBase} audio (${completed}/${total})`,
                            });
                        }
                    );

                    if (token?.isCancellationRequested) break;

                    const bookFolder = vscode.Uri.joinPath(exportDir, sanitizeFileComponent(fileBase));
                    await vscode.workspace.fs.createDirectory(bookFolder);

                    const langCode = getTargetLanguageCode();
                    const safeFileBase = sanitizeFileComponent(fileBase);

                    for (const [charKey, group] of groups.entries()) {
                        if (token?.isCancellationRequested) break;
                        // Swap each clip's source for its resolved local copy,
                        // dropping any that failed to download/resolve so FFmpeg
                        // doesn't choke on a pointer stub or a missing file.
                        const verified: CharacterClip[] = [];
                        for (const clip of group.clips) {
                            const resolved = resolvedSources.get(clip.absolutePath);
                            if (resolved?.localPath) {
                                verified.push({ ...clip, absolutePath: resolved.localPath });
                            } else {
                                debug(`Unresolved audio for ${clip.cellId}: ${resolved?.error ?? "unknown"}`);
                                skippedCellsTotal++;
                                if (resolved?.error && resolved.error !== "cancelled") {
                                    downloadFailCount++;
                                }
                            }
                        }
                        if (verified.length === 0) {
                            continue;
                        }
                        // Sort by start time so the filter is deterministic and easier to debug.
                        verified.sort((a, b) => a.startMs - b.startMs);

                        // Trim to this character's last endTime (with a small pad) so silent tails
                        // don't bloat the file. Files still start at 0 so they DAW-align.
                        const trimSec = computeTrimDurationSec(verified, episodeDurationSec);

                        const destName = `${safeFileBase}_${langCode}_${charKey}${ext}`;
                        const destUri = vscode.Uri.joinPath(bookFolder, destName);

                        try {
                            await renderCharacterTrack(
                                ffmpegBinaryPath,
                                verified,
                                trimSec,
                                destUri.fsPath,
                                format
                            );
                            writtenCount++;
                            charactersWritten++;
                        } catch (e) {
                            console.error(`Failed to render character track ${destName}:`, e);
                        }
                    }
                }

                if (token?.isCancellationRequested) {
                    debug("Character audio export cancelled");
                    return;
                }

                // If streaming was required but nothing came down, surface a hard
                // error instead of a misleading "0 files written" success toast.
                if (writtenCount === 0 && downloadFailCount > 0) {
                    vscode.window.showErrorMessage(
                        "Audio export by character failed: could not download any audio files from the server. " +
                        "Please check your network connection and try again."
                    );
                    return;
                }

                const parts: string[] = [];
                parts.push(`${writtenCount} file${writtenCount === 1 ? "" : "s"} written`);
                if (skippedCellsTotal > 0) parts.push(`${skippedCellsTotal} cell${skippedCellsTotal === 1 ? "" : "s"} skipped (missing timing or file)`);
                if (downloadFailCount > 0) parts.push(`${downloadFailCount} clip${downloadFailCount === 1 ? "" : "s"} failed to download`);
                if (filesWithoutTiming.length > 0) parts.push(`${filesWithoutTiming.length} file${filesWithoutTiming.length === 1 ? "" : "s"} had no timing data`);

                vscode.window.showInformationMessage(
                    `Audio export by character completed: ${parts.join(", ")}. Output: ${exportDir.fsPath}`
                );
                debug(`Summary: written=${writtenCount} chars=${charactersWritten} skipped=${skippedCellsTotal} download-failed=${downloadFailCount} no-timing=${filesWithoutTiming.length}`);
            }
        );
    } finally {
        disposeAbort();
        // Best-effort cleanup of the temp working directory.
        try {
            await fs.promises.rm(tempRoot, { recursive: true, force: true });
        } catch (e) {
            debug(`Failed to clean up temp dir ${tempRoot}:`, e);
        }
    }
}

interface PreviewBuckets {
    label: string;
    intervals: CharacterInterval[];
    audioCellCount: number;
    noAudioCellCount: number;
    untimedCellCount: number;
}

// Scan every active labelled cell — with or without audio — so the preview can
// surface characters that exist in the script but haven't been recorded yet.
function scanCharactersForPreview(
    cells: CodexNotebookAsJSONData["cells"]
): Map<string, PreviewBuckets> {
    const buckets = new Map<string, PreviewBuckets>();
    for (const cell of cells) {
        if (!isExportableCell(cell)) continue;
        const cellId: string | undefined = cell?.metadata?.id;
        if (!cellId) continue;

        const resolvedLabel = resolveCellLabel(cell);
        const labelStr = resolvedLabel && resolvedLabel.trim() !== ""
            ? resolvedLabel
            : "unlabeled";
        const key = sanitizeFileComponent(labelStr.toLowerCase()) || "unlabeled";

        if (!buckets.has(key)) {
            buckets.set(key, {
                label: labelStr,
                intervals: [],
                audioCellCount: 0,
                noAudioCellCount: 0,
                untimedCellCount: 0,
            });
        }
        const bucket = buckets.get(key)!;

        const data = (cell?.metadata?.data || {}) as { startTime?: unknown; endTime?: unknown; };
        const startSec = coerceFiniteNumber(data.startTime);
        const endSec = coerceFiniteNumber(data.endTime);
        const audioOutcome = pickAudioAttachmentForCell(cell);
        const hasAudio = audioOutcome.state === "ready" && !!audioOutcome.pick;

        if (startSec === undefined) {
            bucket.untimedCellCount++;
            continue;
        }
        bucket.intervals.push({
            startSec,
            endSec: endSec !== undefined && endSec > startSec ? endSec : startSec + 0.5,
            hasAudio,
        });
        if (hasAudio) bucket.audioCellCount++;
        else bucket.noAudioCellCount++;
    }
    return buckets;
}

/**
 * Build a lightweight preview of which characters speak when in each selected
 * file. Pure data — the webview turns this into vertically aligned timeline
 * strips. Does not require ffmpeg or write any files.
 */
export async function getCharacterAudioPreview(
    filesToExport: string[]
): Promise<CharacterPreviewResult> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        return { files: [] };
    }

    const result: CharacterPreviewFile[] = [];

    for (const filePath of filesToExport) {
        const file = vscode.Uri.file(filePath);
        const fileBase = basename(file.fsPath).split(".")[0] || "FILE";

        let notebook: CodexNotebookAsJSONData;
        try {
            notebook = await readNotebook(file);
        } catch {
            continue;
        }

        const episodeDurationSec = computeEpisodeDurationSeconds(notebook.cells);
        if (episodeDurationSec <= 0) {
            result.push({
                fileBase,
                episodeDurationSec: 0,
                characters: [],
                skippedCells: 0,
                missingTiming: true,
            });
            continue;
        }

        const buckets = scanCharactersForPreview(notebook.cells);

        const characters: CharacterPreviewCharacter[] = [];
        let skippedCells = 0;
        for (const [key, bucket] of buckets.entries()) {
            bucket.intervals.sort((a, b) => a.startSec - b.startSec);
            const speakingSecAudio = bucket.intervals
                .filter((i) => i.hasAudio)
                .reduce((acc, i) => acc + Math.max(0, i.endSec - i.startSec), 0);
            const speakingSecNoAudio = bucket.intervals
                .filter((i) => !i.hasAudio)
                .reduce((acc, i) => acc + Math.max(0, i.endSec - i.startSec), 0);
            const lastEndSec = bucket.intervals.length
                ? Math.max(...bucket.intervals.filter((i) => i.hasAudio).map((i) => i.endSec), 0)
                : 0;
            const willExport = bucket.audioCellCount > 0;
            skippedCells += bucket.untimedCellCount;
            characters.push({
                label: bucket.label,
                key,
                intervals: bucket.intervals,
                audioCellCount: bucket.audioCellCount,
                noAudioCellCount: bucket.noAudioCellCount,
                untimedCellCount: bucket.untimedCellCount,
                speakingSecAudio,
                speakingSecNoAudio,
                lastEndSec,
                willExport,
            });
        }
        // Sort: characters with audio first, then by first appearance time.
        characters.sort((a, b) => {
            if (a.willExport !== b.willExport) return a.willExport ? -1 : 1;
            const aStart = a.intervals[0]?.startSec ?? Infinity;
            const bStart = b.intervals[0]?.startSec ?? Infinity;
            return aStart - bStart;
        });

        result.push({
            fileBase,
            episodeDurationSec,
            characters,
            skippedCells,
            missingTiming: false,
        });
    }

    return { files: result };
}
