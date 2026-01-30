import * as vscode from "vscode";
import { basename, extname } from "path";
import { CodexNotebookAsJSONData } from "@types";
import { exec } from "child_process";
import { promisify } from "util";
import * as os from "os";
import * as fs from "fs";
import { CodexCellTypes } from "../../types/enums";

const execAsync = promisify(exec);

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

function formatDateForFolder(d: Date): string {
    const pad = (n: number, w = 2) => String(n).padStart(w, "0");
    return `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
}

// REMOVE: This doesn't seem to be used anywhere
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

// REMOVE: This doesn't seem to be used anywhere
function toBookChapterVerseBasename(cell: any, cellId: string): string {
    const { book, chapter, verse } = parseCellIdToBookChapterVerse(cell, cellId);
    const safePad = (n: number | undefined) => (typeof n === "number" && Number.isFinite(n) ? String(n) : "0").padStart(3, "0");
    const chapStr = safePad(chapter);
    const verseStr = safePad(verse);
    return sanitizeFileComponent(`${book}_${chapStr}_${verseStr}`);
}

// REMOVE: This doesn't seem to be used anywhere
function formatTimeRangeSuffix(start?: number, end?: number): string {
    if (start === undefined && end === undefined) return "";
    const coerce = (v: any): number | undefined => {
        if (v === undefined || v === null) return undefined;
        const num = typeof v === "number" ? v : Number(v);
        if (!Number.isFinite(num)) return undefined;
        return num;
    };
    const fmt = (v: number | undefined) => {
        if (v === undefined) return "";
        // Truncate to milliseconds (no rounding up) and format like SRT/VTT but filename-safe: HH-MM-SS_mmm
        const totalMs = Math.floor(v * 1000);
        const hours = Math.floor(totalMs / 3600000);
        const minutes = Math.floor((totalMs % 3600000) / 60000);
        const seconds = Math.floor((totalMs % 60000) / 1000);
        const millis = totalMs % 1000;
        const pad2 = (n: number) => String(n).padStart(2, "0");
        const pad3 = (n: number) => String(n).padStart(3, "0");
        return `${pad2(hours)}-${pad2(minutes)}-${pad2(seconds)}_${pad3(millis)}`;
    };
    const s = fmt(coerce(start));
    const e = fmt(coerce(end));
    if (!s && !e) return "";
    return `_${s || ""}-${e || ""}`;
}

function getTargetLanguageCode(): string {
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    const lang = projectConfig.get<any>("targetLanguage") || {};
    const code: string = lang.tag || lang.refName || "lang";
    return sanitizeFileComponent(String(code).toLowerCase());
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
        const isMilestone = cell?.metadata?.type === CodexCellTypes.MILESTONE;
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

// Convert audio to WAV format using ffmpeg (for WebM, M4A, etc.)
async function convertToWav(
    inputBytes: Uint8Array,
    originalExt: string,
    sampleRate: number = 48000
): Promise<Uint8Array> {
    const tempDir = os.tmpdir();
    const tempInputPath = `${tempDir}/codex-audio-input-${Date.now()}${originalExt}`;
    const tempOutputPath = `${tempDir}/codex-audio-output-${Date.now()}.wav`;

    try {
        // Write input file
        fs.writeFileSync(tempInputPath, Buffer.from(inputBytes));

        // Convert using ffmpeg with high-quality settings
        // -ar: sample rate, -ac: mono, -sample_fmt: 16-bit PCM
        await execAsync(
            `ffmpeg -i "${tempInputPath}" -ar ${sampleRate} -ac 1 -sample_fmt s16 "${tempOutputPath}"`
        );

        // Read converted WAV file
        const wavBytes = fs.readFileSync(tempOutputPath);
        return new Uint8Array(wavBytes);
    } catch (error) {
        console.error("Error converting audio to WAV:", error);
        throw error;
    } finally {
        // Cleanup temp files
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

async function readNotebook(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const bytes = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(bytes).toString());
}

function isActiveCell(cell: any): boolean {
    const data = cell?.metadata?.data;
    const isMerged = !!(data && data.merged);
    const isDeleted = !!(data && data.deleted);
    return !isMerged && !isDeleted;
}

function pickAudioAttachmentForCell(cell: any): { id: string; url: string; start?: number; end?: number; } | null {
    const attachments = cell?.metadata?.attachments || {};
    if (!attachments || typeof attachments !== "object") return null;
    const selectedId: string | undefined = cell?.metadata?.selectedAudioId;

    const candidates: Array<{ id: string; url: string; updatedAt?: number; start?: number; end?: number; isDeleted?: boolean; isMissing?: boolean; }>
        = [];
    for (const [attId, attVal] of Object.entries<any>(attachments)) {
        if (!attVal || typeof attVal !== "object") continue;
        if (attVal.type !== "audio") continue;
        if (attVal.isDeleted) continue;
        if (attVal.isMissing) continue;
        if (!attVal.url || typeof attVal.url !== "string") continue;
        candidates.push({ id: attId, url: attVal.url, updatedAt: attVal.updatedAt, start: attVal.startTime, end: attVal.endTime });
    }
    if (candidates.length === 0) return null;
    if (selectedId) {
        const selected = candidates.find(c => c.id === selectedId);
        if (selected) return selected;
    }
    // fallback to most recently updated
    candidates.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
    return candidates[0];
}

async function pathExists(uri: vscode.Uri): Promise<boolean> {
    try { await vscode.workspace.fs.stat(uri); return true; } catch { return false; }
}

export async function exportAudioAttachments(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportAudioOptions
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }
    const workspaceFolder = workspaceFolders[0];

    // Resolve project name
    const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
    let projectName = projectConfig.get<string>("projectName", "");
    if (!projectName) {
        projectName = basename(workspaceFolder.uri.fsPath);
    }

    const dateStamp = formatDateForFolder(new Date());
    const exportRoot = vscode.Uri.file(userSelectedPath);
    const finalExportDir = vscode.Uri.joinPath(exportRoot, "export", `${sanitizeFileComponent(projectName)}-${dateStamp}`);
    await vscode.workspace.fs.createDirectory(finalExportDir);

    const includeTimestamps = !!options?.includeTimestamps;
    const selectedFiles = filesToExport.map((p) => vscode.Uri.file(p));
    debug(`Files to export: ${filesToExport.length}`, filesToExport);
    if (selectedFiles.length === 0) {
        vscode.window.showInformationMessage("No files selected for export.");
        return;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting Audio Attachments",
            cancellable: false,
        },
        async (progress) => {
            const increment = 100 / selectedFiles.length;
            let copiedCount = 0;
            let missingCount = 0;

            for (const [index, file] of selectedFiles.entries()) {
                progress.report({ message: `Processing ${basename(file.fsPath)} (${index + 1}/${selectedFiles.length})`, increment });

                const bookCode = basename(file.fsPath).split(".")[0] || "BOOK";
                const bookFolder = vscode.Uri.joinPath(finalExportDir, sanitizeFileComponent(bookCode));
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

                const langCode = getTargetLanguageCode();
                const dialogueMap = computeDialogueLineNumbers(notebook.cells);

                debug(`Processing notebook with ${notebook.cells.length} cells`);

                for (const cell of notebook.cells) {
                    // Accept both Code cells (kind 2) and Markup cells (kind 1) - consistent with other exporters
                    if (cell.kind !== 2 && cell.kind !== 1) {
                        debug(`Skipping cell with kind ${cell.kind}`);
                        continue;
                    }
                    if (cell?.metadata?.type === CodexCellTypes.MILESTONE) {
                        debug(`Skipping milestone cell: ${cell?.metadata?.id}`);
                        continue;
                    }
                    if (!isActiveCell(cell)) {
                        debug(`Skipping inactive cell: ${cell?.metadata?.id}`);
                        continue;
                    }
                    const cellId: string | undefined = cell?.metadata?.id;
                    if (!cellId) {
                        debug(`Skipping cell with no ID`);
                        continue;
                    }

                    const pick = pickAudioAttachmentForCell(cell);
                    if (!pick) {
                        // Log detailed info about why no audio was found
                        const attachments = cell?.metadata?.attachments;
                        if (!attachments || Object.keys(attachments).length === 0) {
                            debug(`Cell ${cellId}: No attachments found`);
                        } else {
                            const attKeys = Object.keys(attachments);
                            debug(`Cell ${cellId}: Has ${attKeys.length} attachments but none are valid audio:`,
                                attKeys.map(k => ({
                                    id: k,
                                    type: attachments[k]?.type,
                                    isDeleted: attachments[k]?.isDeleted,
                                    isMissing: attachments[k]?.isMissing,
                                    hasUrl: !!attachments[k]?.url
                                }))
                            );
                        }
                        continue;
                    }

                    debug(`Cell ${cellId}: Found audio attachment ${pick.id} with URL: ${pick.url}`);

                    // Resolve absolute source path (attachment urls are workspace-relative POSIX in this project)
                    const srcPath = pick.url;
                    const absoluteSrc = srcPath.startsWith("/") || srcPath.match(/^[A-Za-z]:\\/)
                        ? vscode.Uri.file(srcPath)
                        : vscode.Uri.joinPath(workspaceFolder.uri, srcPath);

                    debug(`Cell ${cellId}: Resolved absolute path: ${absoluteSrc.fsPath}`);

                    if (!(await pathExists(absoluteSrc))) {
                        debug(`Cell ${cellId}: Audio file does not exist at path: ${absoluteSrc.fsPath}`);
                        missingCount++;
                        continue;
                    }

                    // Build destination filename: <file>_<lang>_<label>_<line>.wav (always export as WAV)
                    const timeFromCell = (cell?.metadata?.data || {}) as { startTime?: number; endTime?: number; };
                    const start = timeFromCell.startTime;
                    const end = timeFromCell.endTime;
                    const originalExt = extname(absoluteSrc.fsPath) || ".wav";
                    const labelRaw = cell?.metadata?.cellLabel || "unlabeled";
                    const label = sanitizeFileComponent(String(labelRaw).toLowerCase());
                    const lineNumber = dialogueMap.get(cellId) || 0;

                    try {
                        let bytes = await vscode.workspace.fs.readFile(absoluteSrc);

                        // Prepare audio for export (convert to WAV if needed, add BWF metadata)
                        let outputExt = originalExt;
                        if (includeTimestamps) {
                            const prepared = await prepareAudioForExport(bytes, originalExt, start, end, cellId);
                            bytes = prepared.bytes;
                            outputExt = prepared.ext;
                        }

                        // Always use .wav extension for output (even if original was WebM/M4A)
                        let destName = `${sanitizeFileComponent(bookCode)}_${langCode}_${label}_${lineNumber}.wav`;
                        let destUri = vscode.Uri.joinPath(bookFolder, destName);

                        // Avoid collisions by appending incremental suffix
                        let attempt = 1;
                        while (await pathExists(destUri)) {
                            destName = `${sanitizeFileComponent(bookCode)}_${langCode}_${label}_${lineNumber}_${attempt}.wav`;
                            destUri = vscode.Uri.joinPath(bookFolder, destName);
                            attempt++;
                        }

                        await vscode.workspace.fs.writeFile(destUri, bytes);
                        copiedCount++;
                    } catch (e) {
                        console.error(`Failed to export audio for ${cellId}:`, e);
                        missingCount++;
                    }
                }
            }

            debug(`Export summary: ${copiedCount} files copied, ${missingCount} skipped`);
            vscode.window.showInformationMessage(`Audio export completed: ${copiedCount} files copied${missingCount ? `, ${missingCount} skipped` : ""}. Output: ${finalExportDir.fsPath}`);
        }
    );
}


