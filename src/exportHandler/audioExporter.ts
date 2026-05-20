import * as vscode from "vscode";
import { basename, extname } from "path";
import { CodexNotebookAsJSONData } from "@types";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import { getFFmpegPath } from "../utils/ffmpegManager";
import { isLfsPointerContent, parsePointerContent } from "../utils/lfsHelpers";
import { getCachedLfsBytes, setCachedLfsBytes } from "../utils/mediaCache";
import { getMediaFilesStrategy } from "../utils/localProjectSettings";
import type { ExportProgressReporter, ExportMissingReason } from "./exportProgress";
import { pickAudioAttachment, isExportableCell, type AudioPick, type AudioPickOutcome } from "./audioAttachmentUtils";
import { formatCellDisplayLabel } from "./cellLabelUtils";

const execAsync = promisify(exec);

let extensionContext: vscode.ExtensionContext | undefined;

export const initializeAudioExporter = (context: vscode.ExtensionContext): void => {
    extensionContext = context;
};

// Debug logging for audio export diagnostics
const DEBUG = false;
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[AudioExporter]", ...args);
    }
}

type ExportAudioOptions = {
    includeTimestamps?: boolean;
};


function sanitizeFileComponent(input: string): string {
    return input
        .replace(/\s+/g, "_")
        .replace(/[^a-zA-Z0-9._-]/g, "-")
        .replace(/_+/g, "_");
}

function sanitizeFolderName(input: string): string {
    return input
        .replace(/[<>:"/\\|?*]/g, "")
        .replace(/\s+/g, " ")
        .trim();
}

/**
 * Parses a cell reference ID (from globalReferences) to extract book, chapter, and verse.
 * Falls back to parsing cellId if globalReferences not available (legacy support).
 */
function parseCellIdToBookChapterVerse(cell: any, cellId: string): { book: string; chapter?: number; verse?: number; } {
    // Try to get from globalReferences first
    const globalRefs = cell?.metadata?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const refId = globalRefs[0];
        try {
            const [book, rest] = refId.split(" ");
            const [chapterStr, verseStr] = (rest || "").split(":");
            let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
            let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
            if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
            if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
            return { book: (book || "").toUpperCase(), chapter, verse };
        } catch {
            return { book: "", chapter: undefined, verse: undefined };
        }
    }

    // MILESTONES: This is a legacy fallback for cell IDs that don't have globalReferences.
    try {
        const [book, rest] = cellId.split(" ");
        const [chapterStr, verseStr] = (rest || "").split(":");
        let chapter: number | undefined = chapterStr ? Number(chapterStr) : undefined;
        let verse: number | undefined = verseStr ? Number(verseStr) : undefined;
        if (chapter !== undefined && !Number.isFinite(chapter)) chapter = undefined;
        if (verse !== undefined && !Number.isFinite(verse)) verse = undefined;
        return { book: (book || "").toUpperCase(), chapter, verse };
    } catch {
        return { book: "", chapter: undefined, verse: undefined };
    }
}

/**
 * Builds the chapter/verse segment for an export filename.
 * Returns e.g. "C1_V25" when both are available, "C1" for chapter only, or "" if neither.
 */
function formatChapterVerseSuffix(chapter?: number, verse?: number): string {
    if (chapter !== undefined && Number.isFinite(chapter)) {
        if (verse !== undefined && Number.isFinite(verse)) {
            return `C${chapter}_V${verse}`;
        }
        return `C${chapter}`;
    }
    return "";
}

// `formatCellDisplayLabel` and `extractCellTextSnippet` were extracted to
// `./cellLabelUtils.ts` so the export wizard's pre-flight scan can reuse the
// same identifiers — see that file for the rules and rationale.

function getTargetLanguageCode(): string {
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const lang = projectConfig.get<any>("targetLanguage") || {};
    const code: string = lang.tag || lang.refName || "lang";
    return sanitizeFileComponent(String(code).toLowerCase());
}

/**
 * Builds a mapping from cell ID to its milestone folder name.
 * Folder names follow the pattern "N - milestone name" (e.g. "1 - Genesis 1").
 * If the milestone value is purely numeric, the folder is just the sequential number (e.g. "1").
 */
function buildCellMilestoneMap(cells: CodexNotebookAsJSONData["cells"]): Map<string, string> {
    const map = new Map<string, string>();
    let milestoneSeq = 0;
    let currentFolderName: string | null = null;

    for (const cell of cells) {
        const isMilestone = cell?.metadata?.type === "milestone";
        const data = cell?.metadata?.data;
        const isDeleted = !!(data && data.deleted);

        if (isMilestone && !isDeleted) {
            milestoneSeq++;
            const milestoneValue = typeof cell?.value === "string" ? cell.value.trim() : "";
            const isNumericOnly = /^\d+$/.test(milestoneValue);
            currentFolderName = isNumericOnly || !milestoneValue
                ? `${milestoneSeq}`
                : `${milestoneSeq} - ${milestoneValue}`;
            continue;
        }

        if (!currentFolderName) continue;

        const cellId: string | undefined = cell?.metadata?.id;
        if (cellId) {
            map.set(cellId, currentFolderName);
        }
    }

    return map;
}

function computeDialogueLineNumbers(
    cells: CodexNotebookAsJSONData["cells"]
): Map<string, number> {
    const map = new Map<string, number>();
    let line = 0;
    for (const cell of cells) {
        // Accept both Code cells (kind 2) and Markup cells (kind 1)
        const isValidKind = cell.kind === 2 || cell.kind === 1;
        const data = cell?.metadata?.data;
        const isMerged = !!(data && data.merged);
        const isDeleted = !!(data && data.deleted);
        const isParatext = cell?.metadata?.type === "paratext";
        const isMilestone = cell?.metadata?.type === "milestone";
        if (!isValidKind || isMerged || isDeleted || isParatext || isMilestone) continue;
        const id: string | undefined = cell?.metadata?.id;
        if (!id) continue;
        line += 1;
        map.set(id, line);
    }
    return map;
}

function formatTimestampForMetadata(seconds?: number): string | undefined {
    if (seconds === undefined || !Number.isFinite(seconds)) return undefined;
    const totalMs = Math.floor(seconds * 1000);
    const hours = Math.floor(totalMs / 3600000);
    const minutes = Math.floor((totalMs % 3600000) / 60000);
    const secs = Math.floor((totalMs % 60000) / 1000);
    const millis = totalMs % 1000;
    const pad2 = (n: number) => String(n).padStart(2, "0");
    const pad3 = (n: number) => String(n).padStart(3, "0");
    return `${pad2(hours)}:${pad2(minutes)}:${pad2(secs)}.${pad3(millis)}`;
}

// BWF (Broadcast Wave Format) metadata writer. Inserts bext chunk after fmt and before data chunk.
function embedWavTimecodes(original: Uint8Array, start?: number, end?: number, cellLabel?: string): Uint8Array {
    try {
        if (original.length < 44) return original;
        // RIFF header check
        if (
            original[0] !== 0x52 || // R
            original[1] !== 0x49 || // I
            original[2] !== 0x46 || // F
            original[3] !== 0x46 // F
        ) return original;
        if (
            original[8] !== 0x57 || // W
            original[9] !== 0x41 || // A
            original[10] !== 0x56 || // V
            original[11] !== 0x45 // E
        ) return original;

        // Find fmt chunk and extract sample rate
        let fmtOffset = 12;
        while (fmtOffset < original.length - 8) {
            const chunkId = String.fromCharCode(...original.slice(fmtOffset, fmtOffset + 4));
            const chunkSize = original[fmtOffset + 4] | (original[fmtOffset + 5] << 8) |
                (original[fmtOffset + 6] << 16) | (original[fmtOffset + 7] << 24);
            if (chunkId === 'fmt ') {
                break;
            }
            fmtOffset += 8 + chunkSize + (chunkSize % 2); // Skip to next chunk (with padding)
        }

        // Extract sample rate from fmt chunk (offset 12 within fmt chunk)
        const sampleRate = original[fmtOffset + 12] | (original[fmtOffset + 13] << 8) |
            (original[fmtOffset + 14] << 16) | (original[fmtOffset + 15] << 24);

        // Find data chunk
        let dataOffset = fmtOffset + 8 + original[fmtOffset + 4];
        while (dataOffset < original.length - 8) {
            const chunkId = String.fromCharCode(...original.slice(dataOffset, dataOffset + 4));
            if (chunkId === 'data') {
                break;
            }
            const chunkSize = original[dataOffset + 4] | (original[dataOffset + 5] << 8) |
                (original[dataOffset + 6] << 16) | (original[dataOffset + 7] << 24);
            dataOffset += 8 + chunkSize + (chunkSize % 2);
        }

        // Build bext chunk
        const bextSize = 602;
        const bextChunk = Buffer.alloc(8 + bextSize);
        Buffer.from('bext').copy(bextChunk, 0);
        bextChunk.writeUInt32LE(bextSize, 4);

        // Description (256 bytes)
        const description = cellLabel || "Audio";
        Buffer.from(description.substring(0, 256)).copy(bextChunk, 8);

        // Originator (32 bytes)
        Buffer.from("Codex Editor").copy(bextChunk, 264);

        // OriginatorReference (32 bytes) - generate unique ID
        const originatorRef = Array.from({ length: 12 }, () =>
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789'[Math.floor(Math.random() * 62)]
        ).join('');
        Buffer.from(originatorRef).copy(bextChunk, 296);

        // OriginationDate (10 bytes) - YYYY-MM-DD
        const now = new Date();
        const dateStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
        Buffer.from(dateStr).copy(bextChunk, 328);

        // OriginationTime (8 bytes) - HH:MM:SS
        const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
        Buffer.from(timeStr).copy(bextChunk, 338);

        // TimeReference (8 bytes, uint64 LE) - start time in samples
        const timeReference = start ? Math.floor(start * sampleRate) : 0;
        bextChunk.writeUInt32LE(timeReference & 0xFFFFFFFF, 346); // low 32 bits
        bextChunk.writeUInt32LE(Math.floor(timeReference / 0x100000000), 350); // high 32 bits

        // Version (2 bytes) - must be 1
        bextChunk.writeUInt16LE(1, 354);

        // UMID (64 bytes at offset 356) - leave as zeros
        // LoudnessValue, LoudnessRange, etc. - leave as zeros
        // Reserved (180 bytes) - leave as zeros

        // Insert bext chunk between fmt and data
        const beforeBext = Buffer.from(original.slice(0, dataOffset));
        const afterBext = Buffer.from(original.slice(dataOffset));
        const updated = Buffer.concat([beforeBext, bextChunk, afterBext]);

        // Update RIFF chunk size at offset 4
        updated.writeUInt32LE(updated.length - 8, 4);
        return updated;
    } catch {
        return original;
    }
}

// WebM/Matroska Tags writer. Appends a Tags element with SimpleTag COMMENT to the end of the file.
function embedWebMTimecodes(original: Uint8Array, start?: number, end?: number): Uint8Array {
    try {
        if (original.length < 4) return original;
        // Check for EBML header (0x1A 0x45 0xDF 0xA3)
        if (
            original[0] !== 0x1a ||
            original[1] !== 0x45 ||
            original[2] !== 0xdf ||
            original[3] !== 0xa3
        ) return original;

        const startStr = formatTimestampForMetadata(start);
        const endStr = formatTimestampForMetadata(end);
        if (!startStr && !endStr) return original;

        const text = `start=${startStr ?? ""};end=${endStr ?? ""}`;

        // Helper to write EBML variable-length integer
        const encodeVInt = (value: number, forceLength?: number): Buffer => {
            if (forceLength) {
                const buf = Buffer.alloc(forceLength);
                buf[0] = (1 << (8 - forceLength)) | (value >> ((forceLength - 1) * 8));
                for (let i = 1; i < forceLength; i++) {
                    buf[i] = (value >> ((forceLength - 1 - i) * 8)) & 0xff;
                }
                return buf;
            }
            if (value < 127) return Buffer.from([0x80 | value]);
            if (value < 16383) return Buffer.from([0x40 | (value >> 8), value & 0xff]);
            if (value < 2097151) return Buffer.from([0x20 | (value >> 16), (value >> 8) & 0xff, value & 0xff]);
            return Buffer.from([0x10 | (value >> 24), (value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff]);
        };

        // Build SimpleTag structure
        const commentNameUtf8 = Buffer.from("COMMENT", "utf8");
        const commentValueUtf8 = Buffer.from(text, "utf8");

        // TagName (0x45A3)
        const tagNameId = Buffer.from([0x45, 0xa3]);
        const tagNameSize = encodeVInt(commentNameUtf8.length);
        const tagName = Buffer.concat([tagNameId, tagNameSize, commentNameUtf8]);

        // TagString (0x4487)
        const tagStringId = Buffer.from([0x44, 0x87]);
        const tagStringSize = encodeVInt(commentValueUtf8.length);
        const tagString = Buffer.concat([tagStringId, tagStringSize, commentValueUtf8]);

        // SimpleTag (0x67C8)
        const simpleTagContent = Buffer.concat([tagName, tagString]);
        const simpleTagId = Buffer.from([0x67, 0xc8]);
        const simpleTagSize = encodeVInt(simpleTagContent.length);
        const simpleTag = Buffer.concat([simpleTagId, simpleTagSize, simpleTagContent]);

        // Tag (0x7373)
        const tagId = Buffer.from([0x73, 0x73]);
        const tagSize = encodeVInt(simpleTag.length);
        const tag = Buffer.concat([tagId, tagSize, simpleTag]);

        // Tags (0x1254C367)
        const tagsId = Buffer.from([0x12, 0x54, 0xc3, 0x67]);
        const tagsSize = encodeVInt(tag.length);
        const tags = Buffer.concat([tagsId, tagsSize, tag]);

        return Buffer.concat([Buffer.from(original), tags]);
    } catch {
        return original;
    }
}

// M4A (MPEG-4) metadata writer. Inserts/updates the ©cmt atom in the udta.meta.ilst container.
function embedM4ATimecodes(original: Uint8Array, start?: number, end?: number): Uint8Array {
    try {
        if (original.length < 8) return original;

        const startStr = formatTimestampForMetadata(start);
        const endStr = formatTimestampForMetadata(end);
        if (!startStr && !endStr) return original;

        const text = `start=${startStr ?? ""};end=${endStr ?? ""}`;
        const textUtf8 = Buffer.from(text, "utf8");

        // Build ©cmt atom structure:
        // ©cmt atom -> data atom (type 1 = UTF-8) -> actual text
        const dataContent = Buffer.alloc(8 + textUtf8.length);
        dataContent.writeUInt32BE(8 + textUtf8.length, 0); // data atom size
        dataContent.write("data", 4, 4, "ascii");
        dataContent.writeUInt32BE(1, 8); // type = 1 (UTF-8 text)
        dataContent.writeUInt32BE(0, 12); // locale/reserved
        textUtf8.copy(dataContent, 16);

        const cmtAtomSize = 8 + dataContent.length;
        const cmtAtom = Buffer.alloc(cmtAtomSize);
        cmtAtom.writeUInt32BE(cmtAtomSize, 0);
        cmtAtom.write("©cmt", 4, 4, "ascii"); // using copyright symbol
        dataContent.copy(cmtAtom, 8);

        // For simplicity, we'll append to the file and hope players parse it.
        // Full implementation would require parsing/rebuilding moov->udta->meta->ilst,
        // but appending often works for metadata-only additions.
        return Buffer.concat([Buffer.from(original), cmtAtom]);
    } catch {
        return original;
    }
}

// Convert audio to WAV format using the extension-owned FFmpeg binary.
async function convertToWav(
    inputBytes: Uint8Array,
    originalExt: string,
    sampleRate: number = 48000
): Promise<Uint8Array> {
    const ffmpegBinaryPath = await getFFmpegPath(extensionContext);
    if (!ffmpegBinaryPath) {
        throw new Error("FFmpeg not available");
    }
    const tempDir = os.tmpdir();
    const uniqueId = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempInputPath = `${tempDir}/codex-audio-input-${uniqueId}${originalExt}`;
    const tempOutputPath = `${tempDir}/codex-audio-output-${uniqueId}.wav`;

    try {
        fs.writeFileSync(tempInputPath, Buffer.from(inputBytes));

        await execAsync(
            `"${ffmpegBinaryPath}" -i "${tempInputPath}" -ar ${sampleRate} -ac 1 -sample_fmt s16 "${tempOutputPath}"`
        );

        const wavBytes = fs.readFileSync(tempOutputPath);
        return new Uint8Array(wavBytes);
    } catch (error) {
        console.error("Error converting audio to WAV:", error);
        throw error;
    } finally {
        try {
            if (fs.existsSync(tempInputPath)) fs.unlinkSync(tempInputPath);
            if (fs.existsSync(tempOutputPath)) fs.unlinkSync(tempOutputPath);
        } catch {
            // Ignore cleanup errors
        }
    }
}

// Detect format and convert/embed metadata appropriately for export
async function prepareAudioForExport(
    original: Uint8Array,
    ext: string,
    start?: number,
    end?: number,
    cellLabel?: string
): Promise<{ bytes: Uint8Array; ext: string; }> {
    const lowerExt = ext.toLowerCase();

    // For WAV files, just add BWF metadata
    if (lowerExt === ".wav") {
        const withMetadata = embedWavTimecodes(original, start, end, cellLabel);
        return { bytes: withMetadata, ext: ".wav" };
    }

    // For WebM or M4A, convert to WAV first, then add BWF metadata
    if (lowerExt === ".webm" || lowerExt === ".m4a") {
        try {
            // Convert to WAV
            const wavBytes = await convertToWav(original, ext);
            // Add BWF metadata to the converted WAV
            const withMetadata = embedWavTimecodes(wavBytes, start, end, cellLabel);
            return { bytes: withMetadata, ext: ".wav" };
        } catch (error) {
            console.error(`Failed to convert ${ext} to WAV, exporting original:`, error);
            // Fallback: export original with basic metadata embedding
            if (lowerExt === ".webm") {
                return { bytes: embedWebMTimecodes(original, start, end), ext };
            } else if (lowerExt === ".m4a") {
                return { bytes: embedM4ATimecodes(original, start, end), ext };
            }
            return { bytes: original, ext };
        }
    }

    // For other formats, export as-is
    return { bytes: original, ext };
}

const EXPORT_CONCURRENCY = 30;

/**
 * Runs async tasks with a sliding-window concurrency pool.
 * Keeps exactly `concurrency` tasks active at all times — as soon as one
 * finishes, the next pending task starts immediately.
 */
export async function runWithConcurrencyPool<T, R>(
    items: T[],
    concurrency: number,
    processor: (item: T, index: number) => Promise<R>,
    onProgress?: (completed: number, total: number) => void
): Promise<Array<PromiseSettledResult<R>>> {
    const results: Array<PromiseSettledResult<R>> = new Array(items.length);
    let nextIndex = 0;
    let completedCount = 0;

    const runWorker = async (): Promise<void> => {
        let idx = nextIndex++;
        while (idx < items.length) {
            try {
                const value = await processor(items[idx], idx);
                results[idx] = { status: "fulfilled", value };
            } catch (reason: any) {
                results[idx] = { status: "rejected", reason };
            }

            completedCount++;
            onProgress?.(completedCount, items.length);
            idx = nextIndex++;
        }
    };

    const workerCount = Math.min(concurrency, items.length);
    await Promise.all(Array.from({ length: workerCount }, () => runWorker()));
    return results;
}

function predictOutputExt(originalExt: string, includeTimestamps: boolean): string {
    if (!includeTimestamps) return originalExt;
    const lower = originalExt.toLowerCase();
    if (lower === ".webm" || lower === ".m4a") return ".wav";
    return originalExt;
}

async function readNotebook(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString());
}

function pickAudioAttachmentForCell(cell: any): AudioPickOutcome {
    return pickAudioAttachment(cell);
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

type ResolveResult =
    | { data: Uint8Array; error?: undefined }
    | { data?: undefined; error: string };

/**
 * Reads audio bytes from disk, resolving LFS pointers on-the-fly via the
 * Frontier API when the file is a stub.  Falls back to the pointers/ directory
 * if the files/ entry doesn't exist at all.
 */
async function resolveAudioBytes(
    absoluteSrc: vscode.Uri,
    workspaceFolderUri: vscode.Uri,
    frontierApi: { downloadLFSFile: (projectPath: string, oid: string, size: number) => Promise<Uint8Array>; } | null
): Promise<ResolveResult> {
    const projectPath = workspaceFolderUri.fsPath;

    // Helper: download from LFS with cache support
    const downloadFromPointer = async (pointerText: string): Promise<ResolveResult> => {
        const pointer = parsePointerContent(pointerText);
        if (!pointer) {
            return { error: "Invalid LFS pointer format" };
        }

        // Check in-memory cache first
        const cached = getCachedLfsBytes(pointer.oid);
        if (cached) {
            debug("Using cached LFS bytes for export");
            return { data: cached };
        }

        if (!frontierApi) {
            return { error: "Frontier API not available — cannot stream audio for export" };
        }

        const lfsData = await frontierApi.downloadLFSFile(projectPath, pointer.oid, pointer.size);
        setCachedLfsBytes(pointer.oid, lfsData);
        return { data: lfsData };
    };

    // Try reading the file at absoluteSrc
    if (await pathExists(absoluteSrc)) {
        const rawBytes = await vscode.workspace.fs.readFile(absoluteSrc);

        if (!isLfsPointerContent(rawBytes)) {
            return { data: rawBytes };
        }

        // It's a pointer — resolve via LFS
        const pointerText = Buffer.from(rawBytes).toString("utf-8");
        return downloadFromPointer(pointerText);
    }

    // files/ entry doesn't exist — try falling back to pointers/ directory
    const fsPath = absoluteSrc.fsPath;
    const normalizedPath = fsPath.replace(/\\/g, "/");
    let pointerPath: string | null = null;

    if (normalizedPath.includes("/.project/attachments/files/")) {
        pointerPath = normalizedPath.replace("/.project/attachments/files/", "/.project/attachments/pointers/");
    } else if (normalizedPath.includes(".project/attachments/files/")) {
        pointerPath = normalizedPath.replace(".project/attachments/files/", ".project/attachments/pointers/");
    }

    if (pointerPath) {
        const pointerUri = vscode.Uri.file(pointerPath);
        if (await pathExists(pointerUri)) {
            const pointerBytes = await vscode.workspace.fs.readFile(pointerUri);
            const pointerText = Buffer.from(pointerBytes).toString("utf-8");
            return downloadFromPointer(pointerText);
        }
    }

    return { error: "Audio file not found" };
}

export async function exportAudioAttachments(
    userSelectedPath: string,
    filesToExport: string[],
    reporter: ExportProgressReporter,
    options?: ExportAudioOptions
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        reporter.error("No project folder found. Please open a project first.");
        return;
    }
    const workspaceFolder = workspaceFolders[0];

    const exportDir = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportDir);

    const includeTimestamps = !!options?.includeTimestamps;
    const selectedFiles = filesToExport.map((p) => vscode.Uri.file(p));
    debug(`Files to export: ${filesToExport.length}`, filesToExport);
    if (selectedFiles.length === 0) {
        reporter.error("No files selected for export.");
        return;
    }

    // Determine if we may need to stream audio from LFS
    const mediaStrategy = await getMediaFilesStrategy(workspaceFolder.uri);
    const mayNeedStreaming = mediaStrategy === "stream-only" || mediaStrategy === "stream-and-save";

    // Obtain the Frontier API for LFS downloads (may be null if not available)
    let frontierApi: { downloadLFSFile: (projectPath: string, oid: string, size: number) => Promise<Uint8Array>; } | null = null;
    if (mayNeedStreaming) {
        // Enforce version gates before attempting any LFS operations
        try {
            const { ensureAllVersionGatesForMedia } = await import("../utils/versionGate");
            const allowed = await ensureAllVersionGatesForMedia(true);
            if (!allowed) {
                reporter.error(
                    "Audio export requires a compatible version of Frontier. Please update and try again."
                );
                return;
            }
        } catch (gateErr) {
            debug("Version gate check failed:", gateErr);
        }

        try {
            const { getAuthApi } = await import("../extension");
            const api = getAuthApi();
            if (api?.downloadLFSFile) {
                frontierApi = api;
            }
        } catch {
            // Frontier not available — will be handled per-file
        }

        if (!frontierApi) {
            reporter.error(
                "Cannot export audio in streaming mode: Frontier authentication is not available. " +
                "Please ensure you are online and signed in, or switch to Auto Download mode first."
            );
            return;
        }
    }

    let copiedCount = 0;
    let missingCount = 0;
    let streamFailCount = 0;
    let notRecordedCount = 0;
    let noneSelectedCount = 0;
    let selectionMissingCount = 0;

    for (const [index, file] of selectedFiles.entries()) {
        reporter.report({
            stage: "processing",
            message: `Processing ${basename(file.fsPath)} (${index + 1}/${selectedFiles.length})`,
            file: basename(file.fsPath),
            current: index + 1,
            total: selectedFiles.length,
        });

                const bookCode = basename(file.fsPath).split(".")[0] || "BOOK";
                const bookFolder = vscode.Uri.joinPath(exportDir, sanitizeFileComponent(bookCode));
                await vscode.workspace.fs.createDirectory(bookFolder);

                let notebook: CodexNotebookAsJSONData;
                try {
                    notebook = await readNotebook(file);
                    debug(`Successfully read notebook: ${file.fsPath}`);
                } catch (e) {
                    debug(`Failed to read notebook: ${file.fsPath}`, e);
                    missingCount++;
                    continue;
                }

                const dialogueMap = computeDialogueLineNumbers(notebook.cells);
                debug(`Processing notebook with ${notebook.cells.length} cells`);

                // Build milestone folder mapping: cellId -> milestone folder name
                const cellMilestoneFolder = buildCellMilestoneMap(notebook.cells);

                // Count audio cells for per-book progress. Paratext and
                // milestone cells (e.g. chapter headers, intros) are not
                // recording targets, so they're filtered out by
                // `isExportableCell` — they would otherwise show up under
                // "no audio recorded" purely as noise.
                const audioCells: Array<{ cell: any; cellId: string; pick: AudioPick }> = [];
                for (const cell of notebook.cells) {
                    if (!isExportableCell(cell)) continue;
                    const cellId: string | undefined = cell?.metadata?.id;
                    if (!cellId) continue;
                    const outcome = pickAudioAttachmentForCell(cell);
                    if (outcome.state === "ready" && outcome.pick) {
                        audioCells.push({ cell, cellId, pick: outcome.pick });
                        continue;
                    }
                    const label = formatCellDisplayLabel(cell, cellId, bookCode);
                    if (!label) {
                        // No identifier we can present to the user — omit
                        // entirely rather than reporting a row they can't act on.
                        continue;
                    }
                    if (outcome.state === "selection-missing") {
                        // The user explicitly chose a take but the attachment
                        // is gone (deleted, missing, or unknown). We refuse to
                        // substitute a different take they never approved.
                        reporter.fileMissing(
                            label,
                            "audio-file-missing",
                            "The audio file you selected for this cell cannot be found. Open the cell to choose another take or re-record."
                        );
                        selectionMissingCount++;
                        continue;
                    }
                    if (outcome.state === "none-selected") {
                        // There are valid takes on this cell but the user has
                        // never picked one (or their previous pick was cleared
                        // when its take was deleted). We refuse to auto-pick.
                        reporter.fileMissing(
                            label,
                            "no-audio-selected",
                            "Audio is recorded for this cell but no take has been selected. Open the cell to choose which take to export."
                        );
                        noneSelectedCount++;
                        continue;
                    }
                    // No usable attachment at all — Tier 1 informational.
                    reporter.fileMissing(label, "no-audio-recorded");
                    notRecordedCount++;
                }

                // Snapshot every audio attachment currently flagged
                // `isMissing=true`. If the resolver succeeds for one of them
                // below, we'll clear the flag on disk so the next pre-flight
                // scan and the audio-history "MISSING" badge converge to
                // reality without waiting for the migration scan to re-run.
                //
                // Why per-file: we mutate `notebook` in memory and write the
                // whole `.codex` back if anything changed; doing this once at
                // end-of-file (not per attachment) keeps the write count low.
                const wasMissingBefore = new Map<string, Set<string>>();
                for (const cell of notebook.cells) {
                    const cellId: string | undefined = cell?.metadata?.id;
                    if (!cellId) continue;
                    const attachments = (cell?.metadata?.attachments ?? {}) as Record<string, any>;
                    for (const [attId, attVal] of Object.entries(attachments)) {
                        if (attVal?.type !== "audio") continue;
                        if (attVal?.isMissing !== true) continue;
                        let set = wasMissingBefore.get(cellId);
                        if (!set) {
                            set = new Set();
                            wasMissingBefore.set(cellId, set);
                        }
                        set.add(attId);
                    }
                }
                // Tracks (cellId -> attachmentIds) whose bytes were successfully
                // resolved + written during this file's pass. Used after the
                // inner loop to decide which `isMissing=true` flags to clear.
                const resolvedCells = new Map<string, Set<string>>();

                // Phase 1: Pre-compute export tasks with unique destination paths
                type AudioExportTask = {
                    cellId: string;
                    /** The attachmentId actually picked for this task — used to
                     * scope the post-export `isMissing` clear so we only touch
                     * the take that actually resolved. */
                    attachmentId: string;
                    /**
                     * Human-readable label for the missing-files UI. Null when
                     * the cell has no identifier we can present (see
                     * `formatCellDisplayLabel`); in that case the audio is still
                     * exported but per-cell failure rows are suppressed.
                     */
                    cellLabel: string | null;
                    absoluteSrc: vscode.Uri;
                    destUri: vscode.Uri;
                    targetFolder: vscode.Uri;
                    originalExt: string;
                    start?: number;
                    end?: number;
                };

                const tasks: AudioExportTask[] = [];
                const assignedPaths = new Set<string>();

                for (const { cell, cellId, pick } of audioCells) {
                    const srcPath = pick.url;
                    const absoluteSrc = srcPath.startsWith("/") || srcPath.match(/^[A-Za-z]:\\/)
                        ? vscode.Uri.file(srcPath)
                        : vscode.Uri.joinPath(workspaceFolder.uri, srcPath);

                    const timeFromCell = (cell?.metadata?.data || {}) as { startTime?: number; endTime?: number; };
                    const originalExt = extname(absoluteSrc.fsPath) || ".wav";
                    const labelRaw = cell?.metadata?.cellLabel || "unlabeled";
                    const label = sanitizeFileComponent(String(labelRaw).toLowerCase());
                    const lineNumber = dialogueMap.get(cellId) || 0;

                    const { chapter, verse } = parseCellIdToBookChapterVerse(cell, cellId);
                    const cvSuffix = formatChapterVerseSuffix(chapter, verse);

                    const outputExt = predictOutputExt(originalExt, includeTimestamps);

                    const milestoneFolderName = cellMilestoneFolder.get(cellId);
                    const targetFolder = milestoneFolderName
                        ? vscode.Uri.joinPath(bookFolder, sanitizeFolderName(milestoneFolderName))
                        : bookFolder;

                    const baseSegments = [sanitizeFileComponent(bookCode)];
                    if (cvSuffix) {
                        baseSegments.push(cvSuffix);
                    } else {
                        baseSegments.push(label);
                    }
                    baseSegments.push(`L${lineNumber}`);
                    const baseName = baseSegments.join("_");

                    let destName = `${baseName}${outputExt}`;
                    let destUri = vscode.Uri.joinPath(targetFolder, destName);

                    let attempt = 1;
                    while (assignedPaths.has(destUri.fsPath) || await pathExists(destUri)) {
                        destName = `${baseName}_${attempt}${outputExt}`;
                        destUri = vscode.Uri.joinPath(targetFolder, destName);
                        attempt++;
                    }
                    assignedPaths.add(destUri.fsPath);

                    const cellLabel = formatCellDisplayLabel(cell, cellId, bookCode);

                    tasks.push({
                        cellId,
                        attachmentId: pick.id,
                        cellLabel,
                        absoluteSrc,
                        destUri,
                        targetFolder,
                        originalExt,
                        start: timeFromCell.startTime,
                        end: timeFromCell.endTime,
                    });
                }

                // Pre-create all target directories in parallel
                const uniqueDirs = [...new Set(tasks.map(t => t.targetFolder.fsPath))];
                await Promise.all(
                    uniqueDirs.map(dir => vscode.workspace.fs.createDirectory(vscode.Uri.file(dir)))
                );

                // Phase 2a: Download all audio bytes with concurrency pool (network-bound).
                // Keeps EXPORT_CONCURRENCY downloads active; as soon as one finishes
                // the next starts immediately.
                type DownloadResult =
                    | { data: Uint8Array; error?: undefined }
                    | { data?: undefined; error: string };

        const downloadResults = await runWithConcurrencyPool<typeof tasks[number], DownloadResult>(
            tasks,
            EXPORT_CONCURRENCY,
            async (task) => {
                debug(`Cell ${task.cellId}: downloading ${task.absoluteSrc.fsPath}`);
                const resolved = await resolveAudioBytes(
                    task.absoluteSrc, workspaceFolder.uri, frontierApi
                );
                if (resolved.error || !resolved.data) {
                    return { error: resolved.error ?? "No data returned" };
                }
                return { data: resolved.data };
            },
            (completed, total) => {
                reporter.report({
                    stage: "downloading",
                    message: `${basename(file.fsPath)}: downloading audio (${completed}/${total})`,
                    file: basename(file.fsPath),
                    current: completed,
                    total,
                });
            }
        );

        // Phase 2b: Convert and write each file (CPU/disk-bound, sequential
        // to avoid FFmpeg contention and show per-file progress).
        for (let ti = 0; ti < tasks.length; ti++) {
            const task = tasks[ti];
            const dlResult = downloadResults[ti];

            reporter.report({
                stage: "writing",
                message: `${basename(file.fsPath)}: writing audio (${ti + 1}/${tasks.length})`,
                file: basename(file.fsPath),
                current: ti + 1,
                total: tasks.length,
            });

            if (dlResult.status === "rejected") {
                console.error("Failed to download audio:", dlResult.reason);
                if (task.cellLabel) {
                    reporter.fileMissing(
                        task.cellLabel,
                        "download-failed",
                        dlResult.reason ? String(dlResult.reason) : undefined
                    );
                    streamFailCount++;
                    missingCount++;
                }
                continue;
            }

            const resolved = dlResult.value;
            if (resolved.error || !resolved.data) {
                debug(`Cell ${task.cellId}: ${resolved.error ?? "No data returned"}`);
                const err = resolved.error ?? "No data returned";
                const isStreamFailure =
                    err.includes("Frontier") || err.includes("stream");
                const isPointerCorrupt = err.includes("Invalid LFS pointer");
                if (task.cellLabel) {
                    if (isStreamFailure) streamFailCount++;
                    const reason: ExportMissingReason = isStreamFailure
                        ? "download-failed"
                        : isPointerCorrupt
                            ? "pointer-corrupt"
                            : "audio-file-missing";
                    reporter.fileMissing(task.cellLabel, reason, err);
                    missingCount++;
                }
                continue;
            }

            let bytes: Uint8Array = resolved.data;

            if (includeTimestamps) {
                try {
                    const prepared = await prepareAudioForExport(
                        bytes, task.originalExt, task.start, task.end, task.cellId
                    );
                    bytes = prepared.bytes;

                    const predicted = predictOutputExt(task.originalExt, true);
                    if (prepared.ext !== predicted) {
                        const correctedName = basename(task.destUri.fsPath)
                            .replace(new RegExp(`\\${predicted.replace(".", "\\.")}$`), prepared.ext);
                        task.destUri = vscode.Uri.joinPath(
                            task.targetFolder, correctedName
                        );
                    }
                } catch (e) {
                    console.error(`Failed to transcode audio for ${task.cellId}:`, e);
                    if (task.cellLabel) {
                        reporter.fileMissing(
                            task.cellLabel,
                            "transcode-failed",
                            e instanceof Error ? e.message : String(e)
                        );
                        missingCount++;
                    }
                    continue;
                }
            }

            try {
                await vscode.workspace.fs.writeFile(task.destUri, bytes);
                copiedCount++;
                // Record the successful resolution so we can clear a stale
                // `isMissing=true` on the source attachment after this file
                // finishes. We never set `isMissing=true` from export, even
                // on failure — failures here are often transient (network),
                // and the migration scan is the only authoritative
                // negative-side writer.
                let setForCell = resolvedCells.get(task.cellId);
                if (!setForCell) {
                    setForCell = new Set();
                    resolvedCells.set(task.cellId, setForCell);
                }
                setForCell.add(task.attachmentId);
            } catch (e) {
                console.error(`Failed to write audio for ${task.cellId}:`, e);
                if (task.cellLabel) {
                    reporter.fileMissing(
                        task.cellLabel,
                        "write-failed",
                        e instanceof Error ? e.message : String(e)
                    );
                    missingCount++;
                }
            }
        }

        // Persist `isMissing=false` for any attachments that were flagged
        // missing before the export but successfully resolved during it.
        //
        // Risk: if the user has this `.codex` open in the cell editor, the
        // editor's in-memory state diverges from disk for `isMissing` (and
        // `updatedAt` on those attachments). The startup migration writes
        // the same shape of mutation at startup with no documented issues;
        // the worst case here is a transient disagreement that the next
        // editor reload reconciles.
        try {
            if (resolvedCells.size > 0 && wasMissingBefore.size > 0) {
                let didChange = false;
                for (const [cellId, resolvedAttIds] of resolvedCells) {
                    const wasSet = wasMissingBefore.get(cellId);
                    if (!wasSet) continue;
                    const cell = notebook.cells.find(
                        (c: any) => c?.metadata?.id === cellId
                    );
                    const attachments = cell?.metadata?.attachments as
                        | Record<string, any>
                        | undefined;
                    if (!attachments) continue;
                    for (const attId of resolvedAttIds) {
                        if (!wasSet.has(attId)) continue;
                        const att = attachments[attId];
                        if (att && att.isMissing === true) {
                            att.isMissing = false;
                            att.updatedAt = Date.now();
                            didChange = true;
                        }
                    }
                }
                if (didChange) {
                    const updatedJson = JSON.stringify(notebook, null, 2);
                    await vscode.workspace.fs.writeFile(
                        file,
                        new TextEncoder().encode(updatedJson)
                    );
                    debug(`Persisted isMissing=false updates to ${basename(file.fsPath)}`);
                }
            }
        } catch (err) {
            // Non-fatal: stale flags will be repaired on the next migration
            // scan / wizard reopen. Don't disrupt the export.
            console.warn(
                `[AudioExporter] Failed to persist isMissing updates for ${basename(file.fsPath)}`,
                err
            );
        }
    }

    debug(
        `Export summary: ${copiedCount} files copied, ${missingCount} skipped, ` +
        `${streamFailCount} stream failures, ${notRecordedCount} cells without recorded audio, ` +
        `${noneSelectedCount} cells with audio but none selected, ` +
        `${selectionMissingCount} cells with selected audio missing`
    );

    if (streamFailCount > 0 && copiedCount === 0) {
        reporter.error(
            "Audio export failed: could not download any audio files from the server. " +
            "Please check your network connection and try again."
        );
        return;
    }

    const summaryParts: string[] = [];
    summaryParts.push(`${copiedCount} audio file(s) exported`);
    if (streamFailCount > 0) summaryParts.push(`${streamFailCount} failed to download`);
    if (missingCount - streamFailCount > 0) {
        summaryParts.push(`${missingCount - streamFailCount} could not be resolved`);
    }
    if (notRecordedCount > 0) summaryParts.push(`${notRecordedCount} cells without recorded audio`);
    if (noneSelectedCount > 0) summaryParts.push(`${noneSelectedCount} cells with audio, none selected`);
    if (selectionMissingCount > 0) summaryParts.push(`${selectionMissingCount} cells with selected audio missing`);

    reporter.complete({
        exportPath: exportDir.fsPath,
        filesExported: selectedFiles.length,
        audioCopied: copiedCount,
        audioMissing: missingCount,
        audioFailed: streamFailCount,
        extraMessages: [summaryParts.join(", ") + "."],
    });
}


