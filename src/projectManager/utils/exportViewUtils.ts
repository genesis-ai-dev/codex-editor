import * as vscode from "vscode";
import { CodexNotebookAsJSONData } from "../../../types";
import {
    getCellAudioState,
    isExportableCell,
    isLabelableCell,
} from "../../exportHandler/audioAttachmentUtils";

export {
    EXPORT_OPTIONS_BY_FILE_TYPE,
    isExportCategoryVisibleForGroup,
    IMPORTER_PLUGIN_ID_TO_EXPORT_GROUP_KEY,
    getExportGroupKeyForImporterPlugin,
} from "../../../sharedUtils/exportOptionsEligibility";

/** Display name for each file type group in the export view */
export const FILE_TYPE_DISPLAY_NAMES: Record<string, string> = {
    audio: "Audio Files",
    markdown: "Markdown Files",
    subtitles: "Subtitle Files",
    tms: "TMS Files",
    docx: "Word Documents",
    indesign: "InDesign Files",
    usfm: "USFM Files",
    ebible: "eBible Files",
    maculabible: "Macula Bible",
    obs: "Bible Stories",
    biblica: "Biblica Study Notes",
    spreadsheet: "Spreadsheet with Audio data",
    paratext: "Paratext Projects",
    unknown: "Other Files",
};

export interface NotebookAudioStats {
    /** Active cells (kind 1|2, not merged/deleted) — the denominator. */
    eligibleCellCount: number;
    /** Cells with a take that will actually be exported. */
    audioReadyCount: number;
    /** Eligible cells with no usable audio attachment at all. */
    noAudioRecordedCount: number;
    /**
     * selectedAudioId was set on the cell but the referenced attachment is
     * gone (deleted, missing, or unknown). Nothing will be exported — the
     * user has to pick again or re-record.
     */
    selectionMissingCount: number;
    /**
     * No selectedAudioId, but non-deleted takes are present. The user has
     * never picked one (or their pick was cleared by deletion). Nothing will
     * be exported — we refuse to auto-pick on the user's behalf.
     */
    noneSelectedCount: number;
}

export interface FileGroupEntry {
    path: string;
    name: string;
    displayName: string;
    hasTranslations: boolean;
    hasAudio: boolean;
    audioStats?: NotebookAudioStats;
}

export interface FileGroup {
    groupKey: string;
    displayName: string;
    files: FileGroupEntry[];
}

async function readCodexNotebookFromUri(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
}

type CellEntry = CodexNotebookAsJSONData["cells"][number];

function isActiveTextCell(cell: CellEntry): boolean {
    const meta = cell.metadata as Record<string, unknown> | undefined;
    if (!meta) {
        return false;
    }
    const cellType = meta.type as string | undefined;
    if (cellType !== "text") {
        return false;
    }
    const data = meta.data as { merged?: boolean; deleted?: boolean; } | undefined;
    return !(data?.merged) && !(data?.deleted);
}

function cellHasNonEmptyValue(cell: CellEntry): boolean {
    if (!cell.value) {
        return false;
    }
    const stripped = cell.value.replace(/<[^>]*>/g, "").trim();
    return stripped.length > 0;
}

function cellHasAudioAttachment(cell: CellEntry): boolean {
    const attachments = (cell.metadata as Record<string, unknown>)?.attachments as
        | Record<string, { type?: string; isDeleted?: boolean; isMissing?: boolean; url?: string; }>
        | undefined;
    if (!attachments) {
        return false;
    }
    // Note: `isMissing` is intentionally not part of the predicate. The flag
    // is a stale hint; the export's resolver will attempt LFS resolution at
    // access time and report real failures via the missing-files reporter.
    return Object.values(attachments).some(
        (att) => att.type === "audio" && !att.isDeleted && !!att.url
    );
}

/** Scan notebook cells to determine whether the file has any text translations or audio. */
export function analyzeNotebookContent(notebook: CodexNotebookAsJSONData): {
    hasTranslations: boolean;
    hasAudio: boolean;
} {
    let hasTranslations = false;
    let hasAudio = false;
    for (const cell of notebook.cells) {
        if (!isActiveTextCell(cell)) {
            continue;
        }
        if (!hasTranslations && cellHasNonEmptyValue(cell)) {
            hasTranslations = true;
        }
        if (!hasAudio && cellHasAudioAttachment(cell)) {
            hasAudio = true;
        }
        if (hasTranslations && hasAudio) {
            break;
        }
    }
    return { hasTranslations, hasAudio };
}

/**
 * Full notebook walk that mirrors the predicate used by `audioExporter.ts` so
 * Step 1 inline counts cannot disagree with what the actual export will do.
 * Pure notebook-metadata walk: no disk IO, no network.
 */
export function analyzeNotebookAudioStats(
    notebook: CodexNotebookAsJSONData
): NotebookAudioStats {
    let eligibleCellCount = 0;
    let audioReadyCount = 0;
    let noAudioRecordedCount = 0;
    let selectionMissingCount = 0;
    let noneSelectedCount = 0;

    for (const cell of notebook.cells) {
        if (!isExportableCell(cell)) continue;
        eligibleCellCount += 1;
        const state = getCellAudioState(cell);
        if (state === "ready") {
            audioReadyCount += 1;
            continue;
        }
        // Mirror the exporter: cells we can't label aren't surfaced as
        // missing-audio rows, so they shouldn't inflate the Step 1 counts.
        if (!isLabelableCell(cell)) continue;
        if (state === "selection-missing") {
            selectionMissingCount += 1;
        } else if (state === "none-selected") {
            noneSelectedCount += 1;
        } else {
            noAudioRecordedCount += 1;
        }
    }

    return {
        eligibleCellCount,
        audioReadyCount,
        noAudioRecordedCount,
        selectionMissingCount,
        noneSelectedCount,
    };
}

/**
 * Determines the export group key for a codex file based on metadata.
 * Aligns with supported import types: Audio, Markdown, Subtitle, TMS, Word,
 * InDesign, USFM, Bible Stories (OBS), Biblica Study Notes, Spreadsheet.
 */
function getGroupKeyFromMetadata(metadata: Record<string, unknown>): string {
    const corpusMarker = metadata?.corpusMarker
        ? String(metadata.corpusMarker).trim()
        : "";
    const importerType = metadata?.importerType
        ? String(metadata.importerType).trim()
        : "";
    const fileType = metadata?.fileType ? String(metadata.fileType).trim() : "";
    const originalFileName = metadata?.originalFileName
        ? String(metadata.originalFileName).trim()
        : (metadata?.originalName ? String(metadata.originalName).trim() : "");

    // Audio Files (mp3, wav, m4a, aac...)
    if (importerType === "audio") {
        return "audio";
    }

    // Markdown Files (md, mdown, mkd)
    if (importerType === "markdown") {
        return "markdown";
    }

    // Subtitle Files (vtt, srt)
    if (importerType === "subtitles" || corpusMarker === "subtitles") {
        return "subtitles";
    }

    // TMS Files (tmx, xliff, xlf)
    if (
        corpusMarker === "tms" ||
        corpusMarker === "tms-tmx" ||
        corpusMarker === "tms-xliff" ||
        importerType === "tms" ||
        (importerType === "translation" &&
            (fileType === "tmx" || fileType === "xliff")) ||
        (originalFileName && /\.(tmx|xliff|xlf)$/i.test(originalFileName))
    ) {
        return "tms";
    }

    // Word Documents (docx)
    if (
        corpusMarker === "docx" ||
        corpusMarker === "docx-roundtrip" ||
        importerType === "docx" ||
        (originalFileName && /\.docx$/i.test(originalFileName))
    ) {
        return "docx";
    }

    // Reach4Life (idml) - check before Biblica and generic InDesign
    if (
        corpusMarker === "reach4life" ||
        corpusMarker === "reach4life-idml" ||
        importerType === "reach4life" ||
        fileType === "reach4life"
    ) {
        return "reach4life";
    }

    // Biblica Study Notes (idml) - check before generic InDesign
    if (
        corpusMarker === "biblica" ||
        corpusMarker === "biblica-idml" ||
        importerType === "biblica" ||
        fileType === "biblica" ||
        importerType === "biblica-experimental" ||
        fileType === "biblica-experimental"
    ) {
        return "biblica";
    }

    // InDesign Files (idml)
    if (
        corpusMarker === "idml-roundtrip" ||
        (corpusMarker && corpusMarker.startsWith("idml-")) ||
        importerType === "indesign" ||
        (originalFileName && /\.idml$/i.test(originalFileName))
    ) {
        return "indesign";
    }

    // eBible Files - check before USFM (both can use NT/OT corpus markers)
    if (
        importerType === "ebibleCorpus" ||
        importerType === "ebible" ||
        corpusMarker === "ebibleCorpus"
    ) {
        return "ebible";
    }

    // Macula Bible Files - check before USFM
    if (
        importerType === "macula" ||
        importerType === "maculabible" ||
        corpusMarker === "macula" ||
        corpusMarker === "maculabible"
    ) {
        return "maculabible";
    }

    // Paratext scripture projects (USFM-like; subtitle export gating differs from generic "unknown")
    if (importerType === "paratext" || fileType === "paratext") {
        return "paratext";
    }

    // USFM Files (usfm, sfm)
    if (
        corpusMarker === "usfm" ||
        importerType === "usfm-experimental" ||
        importerType === "usfm" ||
        ((corpusMarker === "NT" || corpusMarker === "OT") &&
            originalFileName &&
            /\.(usfm|sfm)$/i.test(originalFileName)) ||
        (originalFileName && /\.(usfm|sfm)$/i.test(originalFileName))
    ) {
        return "usfm";
    }

    // Bible Stories (OBS)
    if (corpusMarker === "obs" || importerType === "obs") {
        return "obs";
    }

    // Spreadsheet with Audio data (CSV, TSV)
    if (
        corpusMarker === "spreadsheet" ||
        corpusMarker === "spreadsheet-csv" ||
        corpusMarker === "spreadsheet-tsv" ||
        importerType === "spreadsheet" ||
        importerType === "spreadsheet-csv" ||
        importerType === "spreadsheet-tsv" ||
        (originalFileName && /\.(csv|tsv)$/i.test(originalFileName))
    ) {
        return "spreadsheet";
    }

    return "unknown";
}

/**
 * Groups codex files by their importer type for the export view.
 * Returns an array of groups, each with a display name and list of files.
 */
export async function groupCodexFilesByImporterType(
    codexUris: vscode.Uri[]
): Promise<FileGroup[]> {
    const groupsMap = new Map<string, FileGroupEntry[]>();

    for (const uri of codexUris) {
        try {
            const notebook = await readCodexNotebookFromUri(uri);
            const metadata = (notebook.metadata || {}) as unknown as Record<string, unknown>;
            const groupKey = getGroupKeyFromMetadata(metadata);
            const name = uri.fsPath.split(/[/\\]/).pop() || "";
            const fileDisplayName =
                (typeof metadata?.fileDisplayName === "string" && metadata.fileDisplayName.trim()) ||
                name.replace(/\.codex$/i, "") ||
                name;
            const { hasTranslations, hasAudio } = analyzeNotebookContent(notebook);
            const audioStats = hasAudio
                ? analyzeNotebookAudioStats(notebook)
                : undefined;

            if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, []);
            }
            groupsMap.get(groupKey)!.push({
                path: uri.fsPath,
                name,
                displayName: fileDisplayName,
                hasTranslations,
                hasAudio,
                audioStats,
            });
        } catch {
            const name = uri.fsPath.split(/[/\\]/).pop() || "";
            if (!groupsMap.has("unknown")) {
                groupsMap.set("unknown", []);
            }
            groupsMap.get("unknown")!.push({
                path: uri.fsPath,
                name,
                displayName: name.replace(/\.codex$/i, "") || name,
                hasTranslations: false,
                hasAudio: false,
            });
        }
    }

    /** Order for displaying file type groups (matches user-defined list) */
    const GROUP_ORDER: Record<string, number> = {
        audio: 1,
        markdown: 2,
        subtitles: 3,
        tms: 4,
        docx: 5,
        indesign: 6,
        usfm: 7,
        ebible: 8,
        maculabible: 9,
        obs: 10,
        biblica: 11,
        reach4life: 12,
        spreadsheet: 13,
        unknown: 99,
    };

    return Array.from(groupsMap.entries())
        .map(([groupKey, files]) => ({
            groupKey,
            displayName:
                FILE_TYPE_DISPLAY_NAMES[groupKey] ?? FILE_TYPE_DISPLAY_NAMES.unknown,
            files: files.sort((a, b) => a.displayName.localeCompare(b.displayName)),
        }))
        .sort(
            (a, b) =>
                (GROUP_ORDER[a.groupKey] ?? 99) - (GROUP_ORDER[b.groupKey] ?? 99)
        );
}
