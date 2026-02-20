import * as vscode from "vscode";
import { CodexNotebookAsJSONData } from "../../../types";

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
    pdf: "PDF Files",
    unknown: "Other Files",
};

export interface FileGroup {
    groupKey: string;
    displayName: string;
    files: Array<{ path: string; name: string; displayName: string }>;
}

/**
 * Config for which file types see which export options.
 * - roundTrip: file types that support round-trip export
 * - usfm: eBible, USFM, and Macula Bible files
 * - html: eBible, USFM, and Macula Bible files
 * - subtitles: only subtitle files (shown at top, expanded)
 * - All others (plaintext, html, xliff, audio, backtranslations, dataExport): all file types
 */
export const EXPORT_OPTIONS_BY_FILE_TYPE: Record<string, string[]> = {
    roundTrip: [
        "docx",
        "indesign",
        "biblica",
        "pdf",
        "obs",
        "tms",
        "usfm",
        "spreadsheet",
    ],
    // USFM and HTML generation should be limited to eBible, USFM, and Macula Bible groups
    usfm: ["ebible", "usfm", "maculabible"],
    html: ["ebible", "usfm", "maculabible"],
    subtitles: ["subtitles"],
};

async function readCodexNotebookFromUri(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
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
        corpusMarker === "docx-roundtrip" ||
        importerType === "docx-roundtrip" ||
        importerType === "docx" ||
        (originalFileName && /\.docx$/i.test(originalFileName))
    ) {
        return "docx";
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

    // PDF Files (backward compatibility)
    if (
        corpusMarker === "pdf" ||
        corpusMarker === "pdf-importer" ||
        corpusMarker === "pdf-sentence" ||
        importerType === "pdf" ||
        fileType === "pdf" ||
        (originalFileName && /\.pdf$/i.test(originalFileName))
    ) {
        return "pdf";
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
    const groupsMap = new Map<string, Array<{ path: string; name: string; displayName: string }>>();

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

            if (!groupsMap.has(groupKey)) {
                groupsMap.set(groupKey, []);
            }
            groupsMap.get(groupKey)!.push({
                path: uri.fsPath,
                name,
                displayName: fileDisplayName,
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
        spreadsheet: 12,
        pdf: 13,
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
