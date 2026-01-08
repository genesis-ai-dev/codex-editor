import React, { useState, useCallback, useEffect } from "react";
import {
    ImporterComponentProps,
    ImportedContent,
    AlignedCell,
    WriteNotebooksWithAttachmentsMessage,
} from "../../types/plugin";
import { NotebookPair } from "../../types/common";
import { v4 as uuidv4 } from "uuid";
import { Button } from "../../../components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "../../../components/ui/card";
import { Progress } from "../../../components/ui/progress";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { Badge } from "../../../components/ui/badge";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";
import {
    Upload,
    Table,
    CheckCircle,
    XCircle,
    ArrowLeft,
    FileSpreadsheet,
    Type,
    Languages,
    Download,
    Link as LinkIcon,
    AlertCircle,
} from "lucide-react";
import { parseSpreadsheetFile, validateSpreadsheetFile } from "./parser";
import { ParsedSpreadsheet, ColumnType, ColumnTypeSelection } from "./types";
import { AlignmentPreview } from "../../components/AlignmentPreview";
import { addMilestoneCellsToNotebookPair } from "../../utils/workflowHelpers";
import { createSpreadsheetCellMetadata } from "./cellMetadata";

export const SpreadsheetImporterForm: React.FC<ImporterComponentProps> = (props) => {
    const { onComplete, onCancel, wizardContext, onTranslationComplete, alignContent } = props;

    // Check if this is a translation import
    const isTranslationImport =
        wizardContext?.intent === "target" &&
        wizardContext?.selectedSource &&
        onTranslationComplete &&
        alignContent;
    const selectedSource = wizardContext?.selectedSource;

    const [selectedFile, setSelectedFile] = useState<File | null>(null);
    const [isDirty, setIsDirty] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [parsedData, setParsedData] = useState<ParsedSpreadsheet | null>(null);
    const [columnMapping, setColumnMapping] = useState<ColumnTypeSelection>({});
    const [error, setError] = useState<string | null>(null);
    const [showPreview, setShowPreview] = useState(false);
    const [pendingImport, setPendingImport] = useState<any | null>(null);
    const [pendingNotebookPair, setPendingNotebookPair] = useState<NotebookPair | null>(null);

    // Translation import specific state
    const [alignedCells, setAlignedCells] = useState<AlignedCell[] | null>(null);
    const [isAligning, setIsAligning] = useState(false);
    const [debugOpen, setDebugOpen] = useState(false);
    const [debugLogs, setDebugLogs] = useState<string[]>([]);

    const debugLog = useCallback((message: string) => {
        setDebugLogs((prev) => [...prev, `${new Date().toISOString()} ${message}`]);
        try {
            console.log(`[SpreadsheetImporter] ${message}`);
        } catch (e) {
            /* noop */
        }
    }, []);

    const downloadTemplate = useCallback(() => {
        try {
            const csv = [
                "GlobalReferences,Source,Attachments",
                "GEN 1:1,Hello world,https://example.com/audio1.mp3",
                'GEN 1:2,Second row,"https://example.com/a1.mp3 https://example.com/a2.wav"',
            ].join("\n");

            // Try Blob + anchor click
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
            const url = URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "spreadsheet-template.csv";
            a.rel = "noopener";
            a.style.display = "none";
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);

            // Fallback: navigate a hidden iframe (some webviews block anchor download)
            const iframe = document.createElement("iframe");
            iframe.style.display = "none";
            iframe.src = url;
            document.body.appendChild(iframe);
            setTimeout(() => {
                try {
                    document.body.removeChild(iframe);
                } catch (e) {
                    /* noop */
                }
                URL.revokeObjectURL(url);
            }, 1500);
        } catch (e) {
            console.error("Template download failed", e);
            // Last resort: send a notification
            try {
                (window as any).vscodeApi?.postMessage({
                    command: "notification",
                    type: "error",
                    message: "Template download failed. Please check Webview console.",
                });
            } catch (e2) {
                /* noop */
            }
        }
    }, []);

    // Listen for extension messages to surface progress/errors in debug console
    useEffect(() => {
        const handler = (event: MessageEvent) => {
            const msg: any = (event && (event as any).data) || {};
            if (!msg || typeof msg !== "object") return;
            if (msg.command === "attachmentProgress") {
                debugLog(`EXT progress ${msg.current}/${msg.total}: ${msg.message || ""}`);
            } else if (msg.command === "notification") {
                debugLog(`EXT notification [${msg.type}]: ${msg.message}`);
            } else if (msg.command === "downloadResourceProgress") {
                debugLog(`EXT download: ${JSON.stringify(msg.progress)}`);
            } else if (msg.command === "downloadResourceComplete") {
                debugLog(
                    `EXT download complete: success=${msg.success}${
                        msg.error ? ` error=${msg.error}` : ""
                    }`
                );
            }
        };
        window.addEventListener("message", handler as any);
        return () => window.removeEventListener("message", handler as any);
    }, [debugLog]);

    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            setSelectedFile(file);
            setIsDirty(true);
            setError(null);
            setParsedData(null);
            setColumnMapping({});
            setShowPreview(false);
            setAlignedCells(null);
        }
    }, []);

    const handleParseFile = async () => {
        if (!selectedFile) return;

        setIsProcessing(true);
        setError(null);

        try {
            // Validate file
            const validation = validateSpreadsheetFile(selectedFile);
            if (!validation.isValid) {
                throw new Error(validation.errors.join(", "));
            }

            // Parse file
            const data = await parseSpreadsheetFile(selectedFile);
            setParsedData(data);

            // Auto-detect column purposes based on names
            const autoMapping: ColumnTypeSelection = {};
            data.columns.forEach((col) => {
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
            setColumnMapping(autoMapping);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to parse file");
        } finally {
            setIsProcessing(false);
        }
    };

    const updateColumnMapping = (columnIndex: number, type: ColumnType) => {
        setColumnMapping((prev) => ({
            ...prev,
            [columnIndex]: type,
        }));
    };

    const getColumnTypeCount = (type: ColumnType): number => {
        return Object.values(columnMapping).filter((t) => t === type).length;
    };

    const parseGlobalReferencesField = (raw: unknown): string[] => {
        if (raw === null || raw === undefined) return [];
        const value = String(raw).trim();
        if (!value) return [];

        // Prefer explicit delimiters first to avoid splitting verse refs by spaces.
        const primaryParts = value
            .split(/[\n;|]+/g)
            .map((s) => s.trim())
            .filter(Boolean);

        if (primaryParts.length > 1) return primaryParts;

        // If only one part and commas are present, treat commas as delimiters.
        if (value.includes(",")) {
            return value
                .split(",")
                .map((s) => s.trim())
                .filter(Boolean);
        }

        return primaryParts;
    };

    const spreadsheetGlobalReferencesAligner = useCallback(
        async (targetCells: any[], _sourceCells: any[], importedContent: ImportedContent[]): Promise<AlignedCell[]> => {
            const aligned: AlignedCell[] = [];

            // Map globalReference -> first matching target cell
            const refToTarget = new Map<string, any>();
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

            // Pass 1: match by globalReferences
            for (const item of importedContent) {
                const refs: unknown = (item as any).globalReferences ?? (item as any).data?.globalReferences;
                const refList = Array.isArray(refs) ? refs.map((r) => String(r ?? "").trim()).filter(Boolean) : [];
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

            // Pass 2: fallback sequential into remaining empty target cells
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
        },
        []
    );

    const handleImport = async () => {
        if (!parsedData) return;

        const sourceColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "source"
        );
        const globalReferencesColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "globalReferences"
        );
        const targetColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "target"
        );
        const attachmentsColumnIndex = Object.keys(columnMapping).find(
            (key) => columnMapping[parseInt(key)] === "attachments"
        );

        if (!sourceColumnIndex && !targetColumnIndex) {
            setError("Please select at least one content column (source or target)");
            return;
        }

        if (isTranslationImport && !targetColumnIndex) {
            setError("Please select a target column for translation import");
            return;
        }

        if (!isTranslationImport && !sourceColumnIndex) {
            setError("Please select a source column for new content import");
            return;
        }

        try {
            if (isTranslationImport) {
                // Translation import - create ImportedContent from target column
                const importedContent: ImportedContent[] = parsedData.rows
                    .filter((row) => row[parseInt(targetColumnIndex!)]?.trim())
                    .map((row, index) => {
                        const globalReferences = globalReferencesColumnIndex
                            ? parseGlobalReferencesField(row[parseInt(globalReferencesColumnIndex)])
                            : [];

                        return {
                            id: uuidv4(),
                            content: row[parseInt(targetColumnIndex!)],
                            rowIndex: index,
                            globalReferences,
                        };
                    });

                setIsAligning(true);
                const aligned = await alignContent!(
                    importedContent,
                    selectedSource!.path,
                    spreadsheetGlobalReferencesAligner
                );
                setAlignedCells(aligned);
                setShowPreview(true);
            } else {
                // Source import - create notebook pair
                const sourceCells = parsedData.rows
                    .filter((row) => row[parseInt(sourceColumnIndex!)]?.trim())
                    .map((row, index) => {
                        const globalReferences = globalReferencesColumnIndex
                            ? parseGlobalReferencesField(row[parseInt(globalReferencesColumnIndex)])
                            : [];

                        // Create cell metadata (always generates UUID)
                        const { cellId, metadata: cellMetadata } = createSpreadsheetCellMetadata({
                            originalContent: row[parseInt(sourceColumnIndex!)],
                            rowIndex: index,
                            originalRow: Object.keys(row),
                            fileName: selectedFile!.name,
                            globalReferences,
                        });

                        return {
                            id: cellId,
                            content: row[parseInt(sourceColumnIndex!)],
                            images: [],
                            metadata: cellMetadata,
                        };
                    });

                const notebookPair: NotebookPair = {
                    source: {
                        name: parsedData.filename,
                        cells: sourceCells,
                        metadata: {
                            id: parsedData.filename,
                            originalFileName: selectedFile!.name,
                            importerType: "spreadsheet",
                            createdAt: new Date().toISOString(),
                            importContext: {
                                importerType: "spreadsheet",
                                fileName: selectedFile!.name,
                                originalFileName: selectedFile!.name,
                                fileSize: selectedFile!.size,
                                importTimestamp: new Date().toISOString(),
                            },
                            delimiter: parsedData.delimiter,
                            columnCount: parsedData.columns.length,
                            rowCount: parsedData.rows.length,
                        },
                    },
                    codex: {
                        name: parsedData.filename,
                        cells: sourceCells.map((cell) => ({
                            ...cell,
                            content: "", // Empty target cells
                        })),
                        metadata: {
                            id: parsedData.filename,
                            originalFileName: selectedFile!.name,
                            importerType: "spreadsheet",
                            createdAt: new Date().toISOString(),
                            importContext: {
                                importerType: "spreadsheet",
                                fileName: selectedFile!.name,
                                originalFileName: selectedFile!.name,
                                fileSize: selectedFile!.size,
                                importTimestamp: new Date().toISOString(),
                            },
                        },
                    },
                };

                // Add milestone cells to the notebook pair
                const notebookPairWithMilestones = addMilestoneCellsToNotebookPair(notebookPair);

                // If attachments column present, fetch audio URLs and send with notebooks
                if (attachmentsColumnIndex !== undefined) {
                    const docId = parsedData.filename.replace(/\s+/g, "");
                    const allAttachments: WriteNotebooksWithAttachmentsMessage["attachments"] = [];

                    const looksLikeAudioName = (name: string) =>
                        /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(name || "");
                    const sanitizeFileName = (name: string) => {
                        const base = (name || "").trim();
                        let out = "";
                        for (let i = 0; i < base.length; i++) {
                            const ch = base[i];
                            const code = base.charCodeAt(i);
                            // Skip reserved characters and ASCII control codes (0x00-0x1F)
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
                            )
                                continue;
                            out += ch;
                        }
                        return out;
                    };
                    const fileNameFromUrl = (url: string, attachmentId: string, row?: string[]) => {
                        const fallback = `${attachmentId}.mp3`;
                        let candidate = "";
                        try {
                            const u = new URL(url);
                            const lastSegment = u.pathname.split("/").filter(Boolean).pop() || "";
                            // Decode percent-encoding and strip trailing dots
                            candidate = decodeURIComponent(lastSegment).replace(/\.+$/, "");
                        } catch {
                            // ignore URL parse errors
                        }
                        // If URL does not yield a plausible audio filename, fall back to first column in the row
                        if (
                            !looksLikeAudioName(candidate) &&
                            row &&
                            row[0] &&
                            looksLikeAudioName(row[0])
                        ) {
                            candidate = row[0].trim();
                        }
                        candidate = candidate || fallback;
                        return sanitizeFileName(candidate);
                    };

                    const isAudioByExt = (name: string) =>
                        /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(name);

                    // Convert Google Drive view/share links to a direct-download endpoint
                    const toGoogleDriveDirect = (raw: string): string | null => {
                        try {
                            const u = new URL(raw);
                            if (/^drive\.google\.com$/i.test(u.hostname)) {
                                // Patterns:
                                // 1) /file/d/<id>/view
                                // 2) /open?id=<id>
                                // 3) /uc?export=download&id=<id>
                                let id = "";
                                const fileMatch = u.pathname.match(/\/file\/d\/([^/]+)\//i);
                                if (fileMatch && fileMatch[1]) id = fileMatch[1];
                                if (!id) id = u.searchParams.get("id") || "";
                                if (id) {
                                    // Use usercontent host for fewer redirects and better CORS
                                    return `https://drive.usercontent.google.com/uc?id=${id}&export=download`;
                                }
                            }
                        } catch (e) {
                            /* noop */
                        }
                        return null;
                    };

                    const fetchAsDataUrl = async (url: string) => {
                        try {
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
                            debugLog(`FETCH ${encodedUrl}`);
                            const res = await fetch(encodedUrl);
                            debugLog(`RESPONSE ${encodedUrl} -> ${res.status} ${res.statusText}`);
                            if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
                            const blob = await res.blob();
                            const mime = blob.type || "";
                            debugLog(`MIME ${encodedUrl} -> ${mime || "unknown"}`);
                            // Some hosts return octet-stream; try to infer from Content-Disposition filename or URL
                            const cd =
                                (res.headers &&
                                    (res.headers.get
                                        ? res.headers.get("content-disposition")
                                        : null)) ||
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
                                    `Not audio (mime: ${mime || "unknown"}${
                                        cdFileName ? ", cd=" + cdFileName : ""
                                    })`
                                );
                            }
                            const reader = new FileReader();
                            const dataUrl: string = await new Promise((resolve, reject) => {
                                reader.onload = () => resolve(String(reader.result));
                                reader.onerror = reject;
                                reader.readAsDataURL(blob);
                            });
                            return { dataUrl, mime: mime || "audio/mpeg" };
                        } catch (e: any) {
                            debugLog(`ERROR ${url} -> ${e?.message || e}`);
                            throw e;
                        }
                    };

                    for (let i = 0; i < parsedData.rows.length; i++) {
                        const row = parsedData.rows[i];
                        const urlCell = row[parseInt(attachmentsColumnIndex)]?.trim();
                        if (!urlCell) continue;
                        const urls = urlCell
                            .split(/[,;]+/)
                            .map((u) => u.trim())
                            .filter(Boolean);

                        const sourceText = row[parseInt(sourceColumnIndex!)]?.trim();
                        if (!sourceText) continue;

                        // Find the corresponding cell by rowIndex (since we now use UUIDs or spreadsheet IDs)
                        const correspondingCell = sourceCells.find(
                            (cell) => cell.metadata?.data?.rowIndex === i
                        );
                        
                        if (!correspondingCell) {
                            debugLog(`Skipping attachment for row ${i} - no corresponding cell found`);
                            continue;
                        }
                        
                        const id = correspondingCell.id;

                        let firstAttachmentId: string | null = null;
                        for (const u of urls) {
                            // Validate that the URL appears to be an audio file before processing
                            const normalizedUrl = u.trim().replace(/^@+/, "");
                            const isAudioUrl = isAudioByExt(normalizedUrl) || 
                                normalizedUrl.startsWith("data:audio/") ||
                                /\.(mp3|wav|m4a|aac|ogg|webm|flac)(\?|#|$)/i.test(normalizedUrl);
                            
                            if (!isAudioUrl) {
                                debugLog(`Skipping non-audio URL: ${normalizedUrl}`);
                                continue;
                            }

                            const attachmentId = `audio-${Date.now()}-${Math.random()
                                .toString(36)
                                .substr(2, 9)}`;
                            if (!firstAttachmentId) firstAttachmentId = attachmentId;
                            let fileName = fileNameFromUrl(u, attachmentId, row as any);
                            
                            try {
                                const { dataUrl, mime } = await fetchAsDataUrl(u);
                                
                                // Double-check that the fetched content is actually audio
                                if (!mime.startsWith("audio/") && !isAudioByExt(fileName)) {
                                    debugLog(`Skipping non-audio content: ${u} (mime: ${mime})`);
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
                                } as any);

                                const urlPath = `.project/attachments/files/${docId}/${fileName}`;
                                const cell = notebookPair.source.cells.find(
                                    (c) => c.metadata?.id === id
                                );
                                if (cell) {
                                    (cell.metadata as any).attachments = {
                                        ...((cell.metadata as any).attachments || {}),
                                        [attachmentId]: {
                                            url: urlPath,
                                            type: "audio",
                                            createdAt: Date.now(),
                                            updatedAt: Date.now(),
                                            isDeleted: false,
                                            startTime: 0,
                                            endTime: Number.NaN,
                                        },
                                    };
                                    (cell.metadata as any).selectedAudioId =
                                        (cell.metadata as any).selectedAudioId || firstAttachmentId;
                                    (cell.metadata as any).selectionTimestamp = Date.now();
                                }
                            } catch (e: any) {
                                // Only create fallback for audio URLs that failed to fetch
                                // Check if it's likely an audio file before creating fallback
                                const raw = u.trim().replace(/^@+/, "");
                                const driveDirect = toGoogleDriveDirect(raw);
                                const effectiveUrl = driveDirect || raw;
                                
                                // Only create fallback if URL looks like audio
                                if (isAudioByExt(effectiveUrl) || effectiveUrl.startsWith("data:audio/")) {
                                    debugLog(`FALLBACK remote download pointer for audio URL: ${effectiveUrl}`);
                                    allAttachments.push({
                                        cellId: id,
                                        attachmentId,
                                        fileName: fileNameFromUrl(effectiveUrl, attachmentId, row as any),
                                        remoteUrl: effectiveUrl,
                                        startTime: 0,
                                        endTime: Number.NaN,
                                    } as any);
                                    
                                    const cell = notebookPair.source.cells.find(
                                        (c) => c.metadata?.id === id
                                    );
                                    if (cell) {
                                        (cell.metadata as any).attachments = {
                                            ...((cell.metadata as any).attachments || {}),
                                            [attachmentId]: {
                                                url: effectiveUrl,
                                                type: "audio",
                                                createdAt: Date.now(),
                                                updatedAt: Date.now(),
                                                isDeleted: false,
                                                startTime: 0,
                                                endTime: Number.NaN,
                                            },
                                        };
                                        (cell.metadata as any).selectedAudioId =
                                            (cell.metadata as any).selectedAudioId || firstAttachmentId;
                                        (cell.metadata as any).selectionTimestamp = Date.now();
                                    }
                                } else {
                                    debugLog(`Skipping non-audio URL that failed to fetch: ${effectiveUrl}`);
                                }
                            }
                        }
                    }

                    const message: WriteNotebooksWithAttachmentsMessage = {
                        command: "writeNotebooksWithAttachments",
                        notebookPairs: [notebookPair],
                        attachments: allAttachments,
                        metadata: {
                            importerType: "spreadsheet",
                            timestamp: new Date().toISOString(),
                        },
                    } as any;
                    // Queue the import so the user can review debug output first
                    setPendingImport(message);
                    setPendingNotebookPair(notebookPairWithMilestones);
                    debugLog(
                        `Prepared import with ${allAttachments.length} attachment(s). Click 'Complete import' to proceed.`
                    );
                } else {
                    onComplete!(notebookPairWithMilestones);
                }
                setIsDirty(false);
            }
        } catch (err) {
            setError(err instanceof Error ? err.message : "Import failed");
        } finally {
            setIsAligning(false);
        }
    };

    const handleCompleteImport = () => {
        if (!pendingImport || !pendingNotebookPair) return;
        try {
            (window as any).vscodeApi?.postMessage(pendingImport);
            onComplete?.(pendingNotebookPair);
            debugLog("Import dispatched to extension.");
        } finally {
            setPendingImport(null);
            setPendingNotebookPair(null);
            setIsDirty(false);
        }
    };

    const handleTranslationComplete = () => {
        if (alignedCells && selectedSource) {
            onTranslationComplete!(alignedCells, selectedSource.path);
            setIsDirty(false);
        }
    };

    const handleCancel = () => {
        if (isDirty) {
            if (!confirm("Leave without saving? Your column mapping will be lost.")) {
                return;
            }
        }
        onCancel();
    };

    const renderColumnMappingCard = () => {
        if (!parsedData) return null;

        return (
            <Card>
                <CardHeader>
                    <div className="flex items-center justify-between">
                        <CardTitle className="flex items-center gap-2">
                            <Table className="h-5 w-5" />
                            Choose Your Columns
                        </CardTitle>
                        {!isTranslationImport && (
                            <div className="flex items-center gap-2">
                                <Button
                                    onClick={downloadTemplate}
                                    aria-label="Download CSV template"
                                >
                                    <Download className="h-3 w-3 mr-1" /> Template
                                </Button>
                                <Button
                                    onClick={() => setDebugOpen((v) => !v)}
                                    title="Toggle debug console"
                                >
                                    {debugOpen ? "Hide Debug" : "Debug"}
                                </Button>
                            </div>
                        )}
                    </div>
                    <CardDescription>
                        {isTranslationImport
                            ? `Tell us which column contains the translations for "${selectedSource?.name}"`
                            : "Tell us which columns contain your content. Optional: add an Attachments column with audio URLs to auto-attach audio to each cell."}
                    </CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                    {debugOpen && (
                        <div className="rounded border border-gray-700 bg-black/70 text-white p-2 max-h-48 overflow-auto font-mono text-xs whitespace-pre-wrap">
                            {debugLogs.length ? debugLogs.join("\n") : "No debug output yet."}
                        </div>
                    )}
                    {/* Column mapping interface */}
                    <div className="grid gap-4">
                        {parsedData.columns.map((column) => (
                            <div
                                key={column.index}
                                className="flex items-center justify-between p-4 border rounded-lg"
                            >
                                <div className="flex-1">
                                    <div className="font-medium">{column.name}</div>
                                    <div className="text-sm text-muted-foreground">
                                        {column.sampleValues.length > 0
                                            ? `Examples: ${column.sampleValues.join(", ")}`
                                            : "No data preview"}
                                    </div>
                                </div>
                                <Select
                                    value={columnMapping[column.index] || "unused"}
                                    onValueChange={(value: ColumnType) =>
                                        updateColumnMapping(column.index, value)
                                    }
                                >
                                    <SelectTrigger className="w-40">
                                        <SelectValue />
                                    </SelectTrigger>
                                    <SelectContent>
                                        <SelectItem value="unused">Not used</SelectItem>
                                        <SelectItem value="globalReferences">
                                            <div className="flex items-center gap-2">
                                                <LinkIcon className="h-4 w-4" />
                                                Global References
                                            </div>
                                        </SelectItem>
                                        {!isTranslationImport && (
                                            <SelectItem
                                                value="source"
                                                disabled={
                                                    getColumnTypeCount("source") > 0 &&
                                                    columnMapping[column.index] !== "source"
                                                }
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Type className="h-4 w-4" />
                                                    Source Content
                                                </div>
                                            </SelectItem>
                                        )}
                                        {isTranslationImport && (
                                            <SelectItem
                                                value="target"
                                                disabled={
                                                    getColumnTypeCount("target") > 0 &&
                                                    columnMapping[column.index] !== "target"
                                                }
                                            >
                                                <div className="flex items-center gap-2">
                                                    <Languages className="h-4 w-4" />
                                                    Translation
                                                </div>
                                            </SelectItem>
                                        )}
                                        {!isTranslationImport && (
                                            <SelectItem
                                                value="attachments"
                                                disabled={
                                                    getColumnTypeCount("attachments") > 0 &&
                                                    columnMapping[column.index] !== "attachments"
                                                }
                                            >
                                                <div className="flex items-center gap-2">
                                                    <LinkIcon className="h-4 w-4" />
                                                    Attachments (audio URLs)
                                                </div>
                                            </SelectItem>
                                        )}
                                    </SelectContent>
                                </Select>
                            </div>
                        ))}
                    </div>

                    {/* Summary */}
                    <div className="flex gap-2 pt-4 border-t">
                        {getColumnTypeCount("globalReferences") > 0 && (
                            <Badge variant="secondary">
                                <LinkIcon className="h-3 w-3 mr-1" />
                                Global References
                            </Badge>
                        )}
                        {getColumnTypeCount("source") > 0 && (
                            <Badge variant="secondary">
                                <Type className="h-3 w-3 mr-1" />
                                Source Content
                            </Badge>
                        )}
                        {getColumnTypeCount("target") > 0 && (
                            <Badge variant="secondary">
                                <Languages className="h-3 w-3 mr-1" />
                                Translation
                            </Badge>
                        )}
                        {!isTranslationImport && getColumnTypeCount("attachments") > 0 && (
                            <Badge variant="secondary">
                                <LinkIcon className="h-3 w-3 mr-1" />
                                Attachments
                            </Badge>
                        )}
                    </div>

                    {error && (
                        <Alert>
                            <XCircle className="h-4 w-4" />
                            <AlertDescription>{error}</AlertDescription>
                        </Alert>
                    )}

                    <div className="flex gap-2 pt-4">
                        <Button onClick={handleCancel} variant="outline">
                            <ArrowLeft className="h-4 w-4 mr-2" />
                            Back
                        </Button>
                        {pendingImport && (
                            <Button
                                onClick={handleCompleteImport}
                                className="flex-1 bg-green-600 hover:bg-green-700 text-white"
                            >
                                Complete import
                            </Button>
                        )}
                        <Button
                            onClick={handleImport}
                            disabled={
                                isAligning ||
                                (!getColumnTypeCount("source") && !getColumnTypeCount("target"))
                            }
                            className="flex-1"
                        >
                            {isAligning ? (
                                <>Processing...</>
                            ) : isTranslationImport ? (
                                "Import Translation"
                            ) : (
                                "Import Content"
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        );
    };

    const renderFileUpload = () => (
        <Card>
            <CardHeader>
                <CardTitle className="flex items-center gap-2">
                    <FileSpreadsheet className="h-5 w-5" />
                    {isTranslationImport
                        ? `Import Translation for "${selectedSource?.name}"`
                        : "Import Spreadsheet Data"}
                </CardTitle>
                <CardDescription>
                    {isTranslationImport
                        ? "Choose a CSV or TSV file containing translations that match your source content"
                        : "Choose a CSV or TSV file to import as source content and create a translation workspace. You can include an optional Attachments column with audio URLs (mp3, wav, m4a, aac, ogg, webm, flac)."}
                </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
                {/* Quick help + template download */}
                {!isTranslationImport && (
                    <div className="p-3 rounded border border-yellow-300 bg-yellow-100">
                        <div className="flex items-start justify-between gap-3">
                            <div className="flex items-start gap-2">
                                <AlertCircle className="h-4 w-4 text-yellow-700 mt-0.5" />
                                <div className="space-y-1 text-sm text-yellow-800">
                                    <div className="font-medium">CSV Columns</div>
                                    <ul className="list-disc ml-5 space-y-1">
                                        <li>
                                            <span className="font-medium">ID</span> (optional):
                                            unique cell id. If omitted we generate like "DocName
                                            1:1".
                                        </li>
                                        <li>
                                            <span className="font-medium">Source</span> (required):
                                            your source text per row.
                                        </li>
                                        <li>
                                            <span className="font-medium">Attachments</span>{" "}
                                            (optional): audio URLs separated by comma, semicolon, or
                                            space.
                                        </li>
                                    </ul>
                                    <div className="text-xs text-yellow-800">
                                        Supported audio: mp3, wav, m4a, aac, ogg, webm, flac.
                                    </div>
                                </div>
                            </div>
                            <Button onClick={downloadTemplate} title="Download CSV template">
                                <Download className="h-3 w-3 mr-1" /> Template
                            </Button>
                        </div>
                    </div>
                )}
                <div className="border-2 border-dashed border-muted-foreground/25 rounded-lg p-8 text-center">
                    <input
                        type="file"
                        accept=".csv,.tsv"
                        onChange={handleFileSelect}
                        className="hidden"
                        id="file-input"
                        disabled={isProcessing}
                    />
                    <label
                        htmlFor="file-input"
                        className="cursor-pointer inline-flex flex-col items-center gap-4"
                    >
                        <Upload className="h-12 w-12 text-muted-foreground" />
                        <div className="space-y-2">
                            <div className="text-lg font-medium">Choose your spreadsheet file</div>
                            <div className="text-sm text-muted-foreground">
                                Click to select a CSV or TSV file up to 50MB
                            </div>
                        </div>
                    </label>
                </div>

                {selectedFile && (
                    <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                        <div className="flex items-center gap-3">
                            <FileSpreadsheet className="h-8 w-8 text-blue-500" />
                            <div>
                                <div className="font-medium">{selectedFile.name}</div>
                                <div className="text-sm text-gray-500">
                                    {(selectedFile.size / 1024).toFixed(1)}KB
                                </div>
                            </div>
                        </div>
                        <Button onClick={handleParseFile} disabled={isProcessing}>
                            {isProcessing ? "Analyzing..." : "Analyze File"}
                        </Button>
                    </div>
                )}

                {error && (
                    <Alert>
                        <XCircle className="h-4 w-4" />
                        <AlertDescription className="flex items-start justify-between gap-3 w-full">
                            <span>{error}</span>
                            <Button
                                variant="outline"
                                size="sm"
                                onClick={() => setDebugOpen((v) => !v)}
                            >
                                {debugOpen ? "Hide Details" : "Show Details"}
                            </Button>
                        </AlertDescription>
                        {debugOpen && (
                            <div className="mt-2 max-h-40 overflow-auto rounded bg-black/60 text-xs text-white p-2 font-mono whitespace-pre-wrap">
                                {debugLogs.length ? debugLogs.join("\n") : "No debug output yet."}
                            </div>
                        )}
                    </Alert>
                )}

                <div className="flex gap-2">
                    <Button onClick={handleCancel} variant="outline">
                        <ArrowLeft className="h-4 w-4 mr-2" />
                        Back
                    </Button>
                </div>
            </CardContent>
        </Card>
    );

    // Show alignment preview for translation imports
    if (showPreview && alignedCells && isTranslationImport) {
        return (
            <div className="container mx-auto p-6">
                <AlignmentPreview
                    alignedCells={alignedCells}
                    importedContent={[]}
                    targetCells={[]}
                    sourceCells={[]}
                    selectedSourceName={selectedSource?.name}
                    onConfirm={handleTranslationComplete}
                    onCancel={() => setShowPreview(false)}
                />
            </div>
        );
    }

    return (
        <div className="container mx-auto p-6">
            {parsedData ? renderColumnMappingCard() : renderFileUpload()}
        </div>
    );
};
