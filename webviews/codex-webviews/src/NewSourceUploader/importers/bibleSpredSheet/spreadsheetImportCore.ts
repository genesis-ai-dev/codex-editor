import { v4 as uuidv4 } from "uuid";
import { CodexCellTypes } from "types/enums";
import type { CustomNotebookCellData } from "types";
import { NotebookPair, ImportProgress } from "../../types/common";
import type {
    AlignedCell,
    CellAligner,
    ImportedContent,
    WriteNotebooksWithAttachmentsMessage,
} from "../../types/plugin";
import { addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
import { createSpreadsheetCellMetadata } from "./cellMetadata";
import type {
    ColumnType,
    ColumnTypeSelection,
    ParsedSpreadsheet,
    SpreadsheetColumn,
    SpreadsheetRow,
} from "./types";

export function inferColumnMapping(columns: SpreadsheetColumn[]): ColumnTypeSelection {
    const autoMapping: ColumnTypeSelection = {};
    columns.forEach((col) => {
        const name = col.name.toLowerCase();
        if (name.includes("id") || name.includes("key") || name.includes("reference")) {
            autoMapping[col.index] = "globalReferences";
        } else if (
            name.includes("source") ||
            name.includes("original") ||
            name.includes("text")
        ) {
            autoMapping[col.index] = "source";
        } else if (
            name.includes("target") ||
            name.includes("translation") ||
            name.includes("translated")
        ) {
            autoMapping[col.index] = "target";
        } else if (
            name.includes("attach") ||
            name.includes("audio") ||
            name.includes("url") ||
            name.includes("media")
        ) {
            autoMapping[col.index] = "attachments";
        } else {
            autoMapping[col.index] = "unused";
        }
    });
    return autoMapping;
}

export function parseGlobalReferencesField(raw: unknown): string[] {
    if (raw === null || raw === undefined) return [];
    const value = String(raw).trim();
    if (!value) return [];

    const primaryParts = value
        .split(/[\n;|]+/g)
        .map((s) => s.trim())
        .filter(Boolean);

    if (primaryParts.length > 1) return primaryParts;

    if (value.includes(",")) {
        return value
            .split(",")
            .map((s) => s.trim())
            .filter(Boolean);
    }

    return primaryParts;
}

function findColumnIndex(columnMapping: ColumnTypeSelection, type: ColumnType): number | undefined {
    const key = Object.keys(columnMapping).find((k) => columnMapping[parseInt(k, 10)] === type);
    return key !== undefined ? parseInt(key, 10) : undefined;
}

export interface BuildSpreadsheetResult {
    notebookPairWithMilestones: NotebookPair;
    attachmentMessage?: WriteNotebooksWithAttachmentsMessage;
}

export async function buildSpreadsheetImportResult(
    file: File,
    parsedData: ParsedSpreadsheet,
    options: { isTranslationImport: boolean; columnMapping?: ColumnTypeSelection; },
    onProgress: (progress: ImportProgress) => void
): Promise<BuildSpreadsheetResult> {
    const { isTranslationImport } = options;
    const columnMapping = options.columnMapping ?? inferColumnMapping(parsedData.columns);

    const sourceColumnIndex = findColumnIndex(columnMapping, "source");
    const globalReferencesColumnIndex = findColumnIndex(columnMapping, "globalReferences");
    const targetColumnIndex = findColumnIndex(columnMapping, "target");
    const attachmentsColumnIndex = findColumnIndex(columnMapping, "attachments");

    if (!sourceColumnIndex && !targetColumnIndex) {
        throw new Error("Could not detect a source or target text column from headers. Name a column Source, Target, or similar.");
    }

    if (isTranslationImport && targetColumnIndex === undefined) {
        throw new Error("Could not detect a translation column. Name a column Target, Translation, or similar.");
    }

    if (!isTranslationImport && sourceColumnIndex === undefined) {
        throw new Error("Could not detect a source text column. Name a column Source, Original, or Text.");
    }

    onProgress({ stage: "Parse", message: "Building notebook…", progress: 40 });

    if (isTranslationImport) {
        const cells = parsedData.rows
            .filter((row) => row[targetColumnIndex!]?.trim())
            .map((row, index) => {
                const globalReferences = globalReferencesColumnIndex !== undefined
                    ? parseGlobalReferencesField(row[globalReferencesColumnIndex])
                    : [];
                const cellId = uuidv4();
                return {
                    id: cellId,
                    content: row[targetColumnIndex!],
                    images: [] as string[],
                    metadata: {
                        id: cellId,
                        type: CodexCellTypes.TEXT,
                        edits: [],
                        data: {
                            rowIndex: index,
                            globalReferences,
                        },
                    },
                };
            });

        const baseMeta = {
            id: uuidv4(),
            originalFileName: file.name,
            sourceFile: file.name,
            createdAt: new Date().toISOString(),
        };

        const notebookPair: NotebookPair = {
            source: {
                name: parsedData.filename,
                cells,
                metadata: { ...baseMeta },
            },
            codex: {
                name: parsedData.filename,
                cells: cells.map((c) => ({
                    ...c,
                    content: "",
                })),
                metadata: { ...baseMeta },
            },
        };

        return { notebookPairWithMilestones: notebookPair };
    }

    const sourceCells = parsedData.rows
        .filter((row) => row[sourceColumnIndex!]?.trim())
        .map((row, index) => {
            const globalReferences =
                globalReferencesColumnIndex !== undefined
                    ? parseGlobalReferencesField(row[globalReferencesColumnIndex])
                    : [];

            const originalRowValues: string[] = [];
            for (let i = 0; i < parsedData.columns.length; i++) {
                originalRowValues.push(row[i] || "");
            }

            const { cellId, metadata: cellMetadata } = createSpreadsheetCellMetadata({
                originalContent: row[sourceColumnIndex!],
                rowIndex: index,
                originalRowValues,
                sourceColumnIndex: sourceColumnIndex!,
                fileName: file.name,
                globalReferences,
            });

            return {
                id: cellId,
                content: row[sourceColumnIndex!],
                images: [] as string[],
                metadata: cellMetadata,
            };
        });

    const columnHeaders = parsedData.columns.map((col) => col.name);
    const originalFileContent = await file.text();

    const fileExtension = file.name.toLowerCase().split(".").pop();
    const spreadsheetType =
        fileExtension === "tsv" || parsedData.delimiter === "\t"
            ? "spreadsheet-tsv"
            : "spreadsheet-csv";

    const notebookPair: NotebookPair = {
        source: {
            name: parsedData.filename,
            cells: sourceCells,
            metadata: {
                id: uuidv4(),
                originalFileName: file.name,
                sourceFile: file.name,
                importerType: spreadsheetType,
                corpusMarker: spreadsheetType,
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: spreadsheetType,
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                delimiter: parsedData.delimiter,
                columnCount: parsedData.columns.length,
                rowCount: parsedData.rows.length,
                columnHeaders,
                sourceColumnIndex: sourceColumnIndex!,
                originalFileContent,
            },
        },
        codex: {
            name: parsedData.filename,
            cells: sourceCells.map((cell) => ({
                ...cell,
                content: "",
            })),
            metadata: {
                id: uuidv4(),
                originalFileName: file.name,
                sourceFile: file.name,
                importerType: spreadsheetType,
                corpusMarker: spreadsheetType,
                createdAt: new Date().toISOString(),
                importContext: {
                    importerType: spreadsheetType,
                    fileName: file.name,
                    originalFileName: file.name,
                    fileSize: file.size,
                    importTimestamp: new Date().toISOString(),
                },
                delimiter: parsedData.delimiter,
                columnHeaders,
                sourceColumnIndex: sourceColumnIndex!,
                originalFileContent,
            },
        },
    };

    onProgress({ stage: "Build", message: "Finalizing…", progress: 70 });

    if (attachmentsColumnIndex === undefined) {
        return {
            notebookPairWithMilestones: addMilestoneCellsToNotebookPair(notebookPair),
        };
    }

    const docId = parsedData.filename.replace(/\s+/g, "");
    type SpreadsheetAttachmentRow = WriteNotebooksWithAttachmentsMessage["attachments"][number] & {
        remoteUrl?: string;
    };
    const allAttachments: SpreadsheetAttachmentRow[] = [];

    const looksLikeAudioName = (name: string) =>
        /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(name || "");
    const sanitizeFileName = (name: string) => {
        const base = (name || "").trim();
        let out = "";
        for (let i = 0; i < base.length; i++) {
            const ch = base[i];
            const code = base.charCodeAt(i);
            if (code < 32) continue;
            if (
                ch === "<" ||
                ch === ">" ||
                ch === ":" ||
                ch === '"' ||
                ch === "/" ||
                ch === "\\" ||
                ch === "|" ||
                ch === "?" ||
                ch === "*"
            ) {
                continue;
            }
            out += ch;
        }
        return out;
    };
    const fileNameFromUrl = (url: string, attachmentId: string, row?: SpreadsheetRow) => {
        const fallback = `${attachmentId}.mp3`;
        let candidate = "";
        try {
            const u = new URL(url);
            const lastSegment = u.pathname.split("/").filter(Boolean).pop() || "";
            candidate = decodeURIComponent(lastSegment).replace(/\.+$/, "");
        } catch {
            /* ignore */
        }
        if (!looksLikeAudioName(candidate) && row && row[0] && looksLikeAudioName(row[0])) {
            candidate = row[0].trim();
        }
        candidate = candidate || fallback;
        return sanitizeFileName(candidate);
    };

    const isAudioByExt = (name: string) => /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(name);

    const toGoogleDriveDirect = (raw: string): string | null => {
        try {
            const u = new URL(raw);
            if (/^drive\.google\.com$/i.test(u.hostname)) {
                let id = "";
                const fileMatch = u.pathname.match(/\/file\/d\/([^/]+)\//i);
                if (fileMatch?.[1]) id = fileMatch[1];
                if (!id) id = u.searchParams.get("id") || "";
                if (id) {
                    return `https://drive.usercontent.google.com/uc?id=${id}&export=download`;
                }
            }
        } catch {
            /* noop */
        }
        return null;
    };

    const fetchAsDataUrl = async (url: string) => {
        const normalizedUrl = url.trim();
        const sanitizedUrl = normalizedUrl.replace(/^@+/, "");
        if (!/^https?:|^data:/i.test(sanitizedUrl)) {
            throw new Error(
                `Attachment must be a full URL (http(s) or data:). Got: ${sanitizedUrl}`
            );
        }
        const driveDirect = toGoogleDriveDirect(sanitizedUrl);
        const effectiveUrl = driveDirect || sanitizedUrl;
        const encodedUrl = effectiveUrl.startsWith("data:")
            ? effectiveUrl
            : encodeURI(effectiveUrl);
        const res = await fetch(encodedUrl);
        if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
        const blob = await res.blob();
        const mime = blob.type || "";
        const cd =
            (res.headers && (res.headers.get ? res.headers.get("content-disposition") : null)) ||
            "";
        const cdNameMatch = cd.match(/filename\*?=(?:UTF-8''|")?([^";\r\n]+)/i);
        const cdFileName = cdNameMatch
            ? decodeURIComponent(cdNameMatch[1].replace(/"/g, ""))
            : "";
        const seemsAudio =
            mime.startsWith("audio/") ||
            isAudioByExt(cdFileName) ||
            isAudioByExt(encodedUrl);
        if (!seemsAudio) {
            throw new Error(
                `Not audio (mime: ${mime || "unknown"}${cdFileName ? ", cd=" + cdFileName : ""})`
            );
        }
        const reader = new FileReader();
        const dataUrl: string = await new Promise((resolve, reject) => {
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
        return { dataUrl, mime: mime || "audio/mpeg" };
    };

    onProgress({
        stage: "Attachments",
        message: "Fetching audio attachments…",
        progress: 75,
    });

    for (let i = 0; i < parsedData.rows.length; i++) {
        const row = parsedData.rows[i];
        const urlCell = row[attachmentsColumnIndex]?.trim();
        if (!urlCell) continue;
        const urls = urlCell
            .split(/[,;]+/)
            .map((u) => u.trim())
            .filter(Boolean);

        const sourceText = row[sourceColumnIndex!]?.trim();
        if (!sourceText) continue;

        const correspondingCell = sourceCells.find((cell) => cell.metadata?.data?.rowIndex === i);
        if (!correspondingCell) continue;

        const id = correspondingCell.id;

        let firstAttachmentId: string | null = null;
        for (const u of urls) {
            const normalizedUrl = u.trim().replace(/^@+/, "");
            const isAudioUrl =
                isAudioByExt(normalizedUrl) ||
                normalizedUrl.startsWith("data:audio/") ||
                /\.(mp3|wav|m4a|aac|ogg|webm|flac)(\?|#|$)/i.test(normalizedUrl);

            if (!isAudioUrl) continue;

            const attachmentId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            if (!firstAttachmentId) firstAttachmentId = attachmentId;
            let fileName = fileNameFromUrl(u, attachmentId, row as unknown as string[]);

            try {
                const { dataUrl, mime } = await fetchAsDataUrl(u);

                if (!mime.startsWith("audio/") && !isAudioByExt(fileName)) {
                    continue;
                }

                if (!/\.[a-z0-9]+$/i.test(fileName)) {
                    fileName = `${attachmentId}.${mime.split("/").pop() || "mp3"}`;
                }

                allAttachments.push({
                    cellId: id,
                    attachmentId,
                    fileName,
                    mime,
                    dataBase64: dataUrl,
                    startTime: 0,
                    endTime: Number.NaN,
                });

                const urlPath = `.project/attachments/files/${docId}/${fileName}`;
                const cell = notebookPair.source.cells.find((c) => c.metadata?.id === id);
                if (cell) {
                    (cell.metadata as Record<string, unknown>).attachments = {
                        ...(((cell.metadata as Record<string, unknown>).attachments as object) ||
                            {}),
                        [attachmentId]: {
                            url: urlPath,
                            type: "audio",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            isDeleted: false,
                            audioAvailability: "available-local" as const,
                            startTime: 0,
                            endTime: Number.NaN,
                        },
                    };
                    (cell.metadata as Record<string, unknown>).selectedAudioId =
                        (cell.metadata as Record<string, unknown>).selectedAudioId ||
                        firstAttachmentId;
                    (cell.metadata as Record<string, unknown>).selectionTimestamp = Date.now();
                }
            } catch {
                const raw = u.trim().replace(/^@+/, "");
                const driveDirect = toGoogleDriveDirect(raw);
                const effectiveUrl = driveDirect || raw;

                if (isAudioByExt(effectiveUrl) || effectiveUrl.startsWith("data:audio/")) {
                    allAttachments.push({
                        cellId: id,
                        attachmentId,
                        fileName: fileNameFromUrl(effectiveUrl, attachmentId, row),
                        remoteUrl: effectiveUrl,
                        startTime: 0,
                        endTime: Number.NaN,
                    });

                    const cell = notebookPair.source.cells.find((c) => c.metadata?.id === id);
                    if (cell) {
                        (cell.metadata as Record<string, unknown>).attachments = {
                            ...(((cell.metadata as Record<string, unknown>).attachments as object) ||
                                {}),
                            [attachmentId]: {
                                url: effectiveUrl,
                                type: "audio",
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                                isDeleted: false,
                                audioAvailability: "available-local" as const,
                                startTime: 0,
                                endTime: Number.NaN,
                            },
                        };
                        (cell.metadata as Record<string, unknown>).selectedAudioId =
                            (cell.metadata as Record<string, unknown>).selectedAudioId ||
                            firstAttachmentId;
                        (cell.metadata as Record<string, unknown>).selectionTimestamp = Date.now();
                    }
                }
            }
        }
    }

    const attachmentMessage: WriteNotebooksWithAttachmentsMessage = {
        command: "writeNotebooksWithAttachments",
        notebookPairs: [notebookPair],
        attachments: allAttachments as WriteNotebooksWithAttachmentsMessage["attachments"],
        metadata: {
            importerType: "spreadsheet",
            timestamp: new Date().toISOString(),
        },
    };

    onProgress({ stage: "Complete", message: "Ready to save", progress: 100 });

    return {
        notebookPairWithMilestones: addMilestoneCellsToNotebookPair(notebookPair),
        attachmentMessage,
    };
}

/**
 * Match imported rows to target cells using metadata.globalReferences, then sequential fallback.
 */
export const spreadsheetCellAligner: CellAligner = async (
    targetCells: CustomNotebookCellData[],
    _sourceCells: CustomNotebookCellData[],
    importedContent: ImportedContent[]
): Promise<AlignedCell[]> => {
    const aligned: AlignedCell[] = [];

    const refToTarget = new Map<string, CustomNotebookCellData>();
    for (const cell of targetCells || []) {
        const refs: unknown = cell?.metadata?.data?.globalReferences;
        if (Array.isArray(refs)) {
            for (const r of refs) {
                const key = String(r ?? "").trim();
                if (key && !refToTarget.has(key)) {
                    refToTarget.set(key, cell);
                }
            }
        }
    }

    const usedTargetIds = new Set<string>();
    const remainder: ImportedContent[] = [];

    for (const item of importedContent) {
        const refs: unknown =
            (item as { globalReferences?: unknown; }).globalReferences ??
            (item as { data?: { globalReferences?: unknown; }; }).data?.globalReferences;
        const refList = Array.isArray(refs)
            ? refs.map((r) => String(r ?? "").trim()).filter(Boolean)
            : [];
        const match = refList.map((r) => refToTarget.get(r)).find((c) => c);

        const targetId = match?.metadata?.id ? String(match.metadata.id) : undefined;
        if (match && targetId && !usedTargetIds.has(targetId)) {
            usedTargetIds.add(targetId);
            aligned.push({
                notebookCell: match,
                importedContent: item,
                alignmentMethod: "custom",
                confidence: 0.95,
            });
        } else {
            remainder.push(item);
        }
    }

    const emptyTargets = (targetCells || []).filter((cell) => {
        const id = cell?.metadata?.id ? String(cell.metadata.id) : "";
        if (!id || usedTargetIds.has(id)) return false;
        const v = typeof cell?.value === "string" ? cell.value.trim() : "";
        return v === "";
    });

    let emptyIdx = 0;
    for (const item of remainder) {
        const next = emptyTargets[emptyIdx++];
        if (next) {
            aligned.push({
                notebookCell: next,
                importedContent: item,
                alignmentMethod: "sequential",
                confidence: 0.6,
            });
        } else {
            aligned.push({
                notebookCell: null,
                importedContent: item,
                isParatext: true,
                alignmentMethod: "sequential",
                confidence: 0.2,
            });
        }
    }

    return aligned;
};
