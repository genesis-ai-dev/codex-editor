import React, { useMemo, useState, useCallback, lazy, Suspense } from "react";
import { ImporterComponentProps, WriteNotebooksWithAttachmentsMessage } from "../../types/plugin";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Label } from "../../../components/ui/label";
import { Slider } from "../../../components/ui/slider";
import { Switch } from "../../../components/ui/switch";
import {
    Upload,
    ListChecks,
    Scissors,
    FileText,
    Check,
    ChevronDown,
    ChevronRight,
    Clock,
    Trash2,
    Music,
    Activity,
    AlertTriangle,
} from "lucide-react";
import { processVttOrTsv } from "./timestampParsers";
import { Alert, AlertDescription } from "../../../components/ui/alert";

// Lazy load the waveform component to avoid blocking initial render
const AudioWaveform = lazy(() => import("./AudioWaveform"));

type AudioRow = {
    id: string;
    file: File;
    name: string;
    durationSec?: number;
    segments: Array<{ startSec: number; endSec: number }>;
    status: "new" | "segmented";
    expanded?: boolean;
};

function generateAttachmentId(): string {
    return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

function toTimestampDataUrl(file: File): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
}

function formatSeconds(sec: number): string {
    if (!isFinite(sec)) return "--:--";
    const minutes = Math.floor(sec / 60);
    const seconds = Math.floor(sec % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

function formatFileSize(bytes: number): string {
    if (bytes < 1024) return bytes + " B";
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + " KB";
    return (bytes / (1024 * 1024)).toFixed(1) + " MB";
}

const processedNotebook = (name: string, cells: any[], nowIso: string) => ({
    name,
    cells: cells.map((c) => ({
        id: c.metadata.id,
        content: c.value,
        images: [],
        metadata: c.metadata || {},
    })),
    metadata: {
        id: name,
        originalFileName: name,
        importerType: "audio",
        createdAt: nowIso,
    },
});

export const AudioImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
    onCancelImport,
    wizardContext,
}) => {
    const [rows, setRows] = useState<AudioRow[]>([]);
    const [documentName, setDocumentName] = useState<string>(
        wizardContext?.selectedSource?.name || "AudioDocument"
    );
    const [isProcessing, setIsProcessing] = useState(false);
    const [silenceThreshold, setSilenceThreshold] = useState(0.5); // seconds
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [mergeFiles, setMergeFiles] = useState(false); // Default to individual files

    const handleSelectFiles = useCallback(
        (ev: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(ev.target.files || []).filter(
                (f) =>
                    f.type.startsWith("audio/") ||
                    /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(f.name)
            );
            const next: AudioRow[] = files.map((f, idx) => ({
                id: `${f.name}-${idx}-${Date.now()}`,
                file: f,
                name: f.name.replace(/\.[^/.]+$/, ""),
                segments: [{ startSec: 0, endSec: Number.NaN }],
                status: "new",
                expanded: false,
            }));
            setRows((prev) => [...prev, ...next]);

            // Set document name to first file's name if not already set
            if (files.length > 0 && (!documentName || documentName === "AudioDocument")) {
                const firstName = files[0].name.replace(/\.[^/.]+$/, "");
                setDocumentName(firstName);
            }

            ev.currentTarget.value = "";
        },
        [documentName]
    );

    const handleImportTimestamps = useCallback(
        async (rowId: string, ev: React.ChangeEvent<HTMLInputElement>) => {
            const file = ev.target.files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const segments = processVttOrTsv(text);
                if (segments.length > 0) {
                    setRows((prev) =>
                        prev.map((r) =>
                            r.id === rowId ? { ...r, segments, status: "segmented" } : r
                        )
                    );
                } else {
                    alert("No valid timestamps found in the file");
                }
            } catch (e) {
                console.error("Failed to parse timestamps:", e);
                alert("Failed to parse timestamp file. Please check the format (VTT or TSV).");
            } finally {
                ev.currentTarget.value = "";
            }
        },
        []
    );

    const handleRemoveFile = useCallback((rowId: string) => {
        setRows((prev) => prev.filter((r) => r.id !== rowId));
    }, []);

    const toggleExpanded = useCallback((rowId: string) => {
        setRows((prev) => prev.map((r) => (r.id === rowId ? { ...r, expanded: !r.expanded } : r)));
    }, []);

    const buildNotebookPairAndAttachments = async () => {
        const nowIso = new Date().toISOString();
        const fileDataMap = new Map<string, string>();
        const allAttachments: WriteNotebooksWithAttachmentsMessage["attachments"] = [];
        const notebookPairs: any[] = [];

        if (mergeFiles) {
            // MERGE MODE: Create one notebook with all files as sections
            const docId = documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
            const sourceCells: any[] = [];
            const codexCells: any[] = [];

            let sectionIndex = 0;
            for (const row of rows) {
                sectionIndex++;

                // Get or create the base64 data for this file
                let fileDataUrl = fileDataMap.get(row.file.name);
                if (!fileDataUrl) {
                    fileDataUrl = await toTimestampDataUrl(row.file);
                    fileDataMap.set(row.file.name, fileDataUrl);
                }

                const baseAttachmentId = generateAttachmentId();
                const segs = row.segments.map((s) => ({
                    startSec: s.startSec ?? 0,
                    endSec: s.endSec ?? Number.NaN,
                }));

                let cellIndex = 0;
                for (const seg of segs) {
                    cellIndex++;
                    const cellId = `${docId} ${sectionIndex}:${cellIndex}`;
                    const segmentAttachmentId = `${baseAttachmentId}-seg${cellIndex}`;
                    const ext = row.file.name.split(".").pop() || "webm";
                    const fileName = `${segmentAttachmentId}.${ext}`;

                    allAttachments.push({
                        cellId,
                        attachmentId: segmentAttachmentId,
                        fileName,
                        mime: row.file.type || "audio/webm",
                        ...(cellIndex === 1
                            ? {
                                  dataBase64: fileDataUrl,
                                  startTime: seg.startSec,
                                  endTime: seg.endSec,
                              }
                            : {
                                  sourceFileId: baseAttachmentId,
                                  startTime: seg.startSec,
                                  endTime: seg.endSec,
                              }),
                    });

                    const url = `.project/attachments/files/${docId}/${fileName}`;
                    populateCellObjects(
                        sourceCells,
                        cellId,
                        seg,
                        segmentAttachmentId,
                        url,
                        codexCells
                    );
                }
            }

            notebookPairs.push({
                source: processedNotebook(docId, sourceCells, nowIso),
                codex: processedNotebook(docId, codexCells, nowIso),
            });
        } else {
            // INDIVIDUAL MODE: Create separate notebook for each file
            for (const row of rows) {
                const fileDocId = row.name.replace(/\s+/g, "");
                const sourceCells: any[] = [];
                const codexCells: any[] = [];

                // Get or create the base64 data for this file
                let fileDataUrl = fileDataMap.get(row.file.name);
                if (!fileDataUrl) {
                    fileDataUrl = await toTimestampDataUrl(row.file);
                    fileDataMap.set(row.file.name, fileDataUrl);
                }

                const baseAttachmentId = generateAttachmentId();
                // In individual mode, ensure all segments are normalized to start from 0
                // Find the earliest start time and offset all segments
                const rawSegs = row.segments.map((s) => ({
                    startSec: s.startSec ?? 0,
                    endSec: s.endSec ?? Number.NaN,
                }));

                const earliestStart = Math.min(...rawSegs.map((s) => s.startSec));
                const segs = rawSegs.map((s) => ({
                    startSec: s.startSec - earliestStart,
                    endSec: s.endSec - earliestStart,
                }));

                let cellIndex = 0;
                for (const seg of segs) {
                    cellIndex++;
                    const cellId = `${fileDocId} 1:${cellIndex}`; // Single section per file
                    const segmentAttachmentId = `${baseAttachmentId}-seg${cellIndex}`;
                    const ext = row.file.name.split(".").pop() || "webm";
                    const fileName = `${segmentAttachmentId}.${ext}`;

                    allAttachments.push({
                        cellId,
                        attachmentId: segmentAttachmentId,
                        fileName,
                        mime: row.file.type || "audio/webm",
                        ...(cellIndex === 1
                            ? {
                                  dataBase64: fileDataUrl,
                                  startTime: seg.startSec,
                                  endTime: seg.endSec,
                              }
                            : {
                                  sourceFileId: baseAttachmentId,
                                  startTime: seg.startSec,
                                  endTime: seg.endSec,
                              }),
                    });

                    const url = `.project/attachments/files/${fileDocId}/${fileName}`;
                    populateCellObjects(
                        sourceCells,
                        cellId,
                        seg,
                        segmentAttachmentId,
                        url,
                        codexCells
                    );
                }

                notebookPairs.push({
                    source: processedNotebook(fileDocId, sourceCells, nowIso),
                    codex: processedNotebook(fileDocId, codexCells, nowIso),
                });
            }
        }

        // Send notebooks plus attachments via custom message
        const message: WriteNotebooksWithAttachmentsMessage = {
            command: "writeNotebooksWithAttachments",
            notebookPairs,
            attachments: allAttachments,
            metadata: { importerType: "audio", timestamp: nowIso },
        } as any;
        (window as any).vscodeApi.postMessage(message);

        // Show success feedback - pass the notebook pairs to onComplete
        onComplete?.(notebookPairs as any);

        function populateCellObjects(
            sourceCells: any[],
            cellId: string,
            seg: { startSec: number; endSec: number },
            segmentAttachmentId: string,
            url: string,
            codexCells: any[]
        ) {
            sourceCells.push({
                kind: 2,
                value: "",
                languageId: "html",
                metadata: {
                    type: "text",
                    id: cellId,
                    data: { startTime: seg.startSec, endTime: seg.endSec },
                    edits: [],
                    attachments: {
                        [segmentAttachmentId]: {
                            url,
                            type: "audio",
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                            isDeleted: false,
                            startTime: seg.startSec,
                            endTime: seg.endSec,
                        },
                    },
                    selectedAudioId: segmentAttachmentId,
                    selectionTimestamp: Date.now(),
                },
            });

            codexCells.push({
                kind: 2,
                value: "",
                languageId: "html",
                metadata: {
                    type: "text",
                    id: cellId,
                    data: { startTime: seg.startSec, endTime: seg.endSec },
                    edits: [],
                    attachments: [],
                },
            });
        }
    };

    const canConfirm = rows.length > 0 && documentName.trim().length > 0;
    const totalSegments = rows.reduce((sum, r) => sum + r.segments.length, 0);
    const hasWarning = totalSegments <= 1 || totalSegments < 3;

    return (
        <div className="container mx-auto p-6 max-w-4xl">
            <Card>
                <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                        <Music className="h-5 w-5" />
                        Import Audio Files
                    </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                    {/* Document name and file selection */}
                    <div className="space-y-4">
                        <div className="space-y-2">
                            <Label htmlFor="doc-name">Document Name</Label>
                            <Input
                                id="doc-name"
                                value={documentName}
                                onChange={(e) => setDocumentName(e.target.value)}
                                placeholder="Enter document name"
                                className="w-full"
                            />
                        </div>

                        {/* Import mode toggle */}
                        {rows.length > 1 && (
                            <div className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                                <div className="space-y-1">
                                    <div className="font-medium text-sm">Import Mode</div>
                                    <div className="text-xs text-muted-foreground">
                                        {mergeFiles
                                            ? "All files will be combined into one notebook with sequential segments"
                                            : "Each file will create its own separate notebook"}
                                    </div>
                                </div>
                                <div className="flex items-center gap-3">
                                    <Label htmlFor="merge-toggle" className="text-sm">
                                        {mergeFiles ? "Merge All Files" : "Individual Files"}
                                    </Label>
                                    <Switch checked={mergeFiles} onCheckedChange={setMergeFiles} />
                                </div>
                            </div>
                        )}

                        <div className="flex justify-center">
                            <input
                                id="audio-file-input"
                                type="file"
                                accept="audio/*"
                                multiple
                                className="hidden"
                                onChange={handleSelectFiles}
                            />
                            <label htmlFor="audio-file-input" className="cursor-pointer">
                                <Button asChild variant="outline" size="lg">
                                    <span>
                                        <Upload className="mr-2 h-4 w-4" />
                                        Select Audio Files
                                    </span>
                                </Button>
                            </label>
                        </div>
                    </div>

                    {/* Summary stats and controls */}
                    {rows.length > 0 && (
                        <div className="space-y-3">
                            <Alert>
                                <AlertDescription>
                                    <div className="flex justify-between items-center flex-wrap">
                                        <div className="flex gap-4 text-sm items-center">
                                            <span>
                                                {rows.length} file{rows.length > 1 ? "s" : ""}{" "}
                                                selected
                                            </span>
                                            <span>•</span>
                                            <div className="flex items-center gap-1">
                                                <span>
                                                    {totalSegments} total segment
                                                    {totalSegments !== 1 ? "s" : ""}
                                                </span>
                                                {hasWarning && (
                                                    <Badge
                                                        variant="outline"
                                                        className="text-orange-600 border-orange-300 text-xs"
                                                    >
                                                        <AlertTriangle className="h-2 w-2 mr-1" />
                                                        Few segments
                                                    </Badge>
                                                )}
                                            </div>
                                            <span>•</span>
                                            <span>
                                                {
                                                    rows.filter((r) => r.status === "segmented")
                                                        .length
                                                }{" "}
                                                file
                                                {rows.filter((r) => r.status === "segmented")
                                                    .length !== 1
                                                    ? "s"
                                                    : ""}{" "}
                                                segmented
                                            </span>
                                            {rows.length > 1 && (
                                                <>
                                                    <span>•</span>
                                                    <span>
                                                        Will create{" "}
                                                        {mergeFiles
                                                            ? "1 merged notebook"
                                                            : `${rows.length} separate notebooks`}
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                        <Button
                                            variant="default"
                                            size="sm"
                                            onClick={() => {
                                                if (mergeFiles) {
                                                    // In merge mode, expand all files simultaneously
                                                    setRows((prev) =>
                                                        prev.map((r) => ({ ...r, expanded: true }))
                                                    );
                                                } else {
                                                    // In individual mode, expand files sequentially to avoid timing conflicts
                                                    setRows((prev) =>
                                                        prev.map((r, index) => ({
                                                            ...r,
                                                            expanded: true,
                                                        }))
                                                    );
                                                }
                                            }}
                                        >
                                            <Scissors className="mr-2 h-3 w-3" />
                                            Auto Segment
                                        </Button>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* File list with segments */}
                    <div className="space-y-2">
                        {rows.map((row, rowIndex) => (
                            <Card key={row.id} className="overflow-hidden">
                                <div className="p-3">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1">
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="p-0 h-6 w-6"
                                                onClick={() => toggleExpanded(row.id)}
                                            >
                                                {row.expanded ? (
                                                    <ChevronDown className="h-4 w-4" />
                                                ) : (
                                                    <ChevronRight className="h-4 w-4" />
                                                )}
                                            </Button>
                                            <FileText className="h-4 w-4 text-muted-foreground" />
                                            <div className="flex-1">
                                                <div className="font-medium">{row.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {formatFileSize(row.file.size)} •{" "}
                                                    {row.file.type || "audio"}
                                                </div>
                                            </div>
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <Badge
                                                variant={
                                                    row.status === "segmented"
                                                        ? "default"
                                                        : "secondary"
                                                }
                                            >
                                                {row.segments.length} segment
                                                {row.segments.length !== 1 ? "s" : ""}
                                            </Badge>
                                            {row.status === "segmented" && (
                                                <Badge
                                                    variant="outline"
                                                    className="text-green-600 border-green-600"
                                                >
                                                    <Check className="h-3 w-3 mr-1" />
                                                    Segmented
                                                </Badge>
                                            )}
                                            <input
                                                id={`timestamp-${row.id}`}
                                                type="file"
                                                accept=".vtt,.tsv,.csv,.txt"
                                                className="hidden"
                                                onChange={(e) => handleImportTimestamps(row.id, e)}
                                            />
                                            <label htmlFor={`timestamp-${row.id}`}>
                                                <Button variant="outline" size="sm" asChild>
                                                    <span>
                                                        <ListChecks className="mr-1 h-3 w-3" />
                                                        Import Timestamps
                                                    </span>
                                                </Button>
                                            </label>
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => handleRemoveFile(row.id)}
                                                className="text-destructive hover:text-destructive"
                                            >
                                                <Trash2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

                                    {/* Expandable segments view with waveform */}
                                    {row.expanded && (
                                        <div className="mt-3 pl-4 pr-2 space-y-3">
                                            <Suspense
                                                fallback={
                                                    <div className="flex items-center justify-center h-32 bg-gray-50 rounded">
                                                        <div className="text-sm text-muted-foreground">
                                                            Loading waveform...
                                                        </div>
                                                    </div>
                                                }
                                            >
                                                <AudioWaveform
                                                    key={`${row.id}-${mergeFiles}`}
                                                    file={row.file}
                                                    segments={row.segments}
                                                    onSegmentsChange={(newSegments) => {
                                                        setRows((prev) =>
                                                            prev.map((r) =>
                                                                r.id === row.id
                                                                    ? {
                                                                          ...r,
                                                                          segments: newSegments,
                                                                          status: "segmented",
                                                                      }
                                                                    : r
                                                            )
                                                        );
                                                    }}
                                                    silenceThreshold={-40}
                                                    minSilenceDuration={0.5}
                                                    mergeMode={mergeFiles}
                                                    fileIndex={rowIndex}
                                                    totalFiles={rows.length}
                                                />
                                            </Suspense>
                                        </div>
                                    )}
                                </div>
                            </Card>
                        ))}

                        {rows.length === 0 && (
                            <div className="text-center py-8 text-muted-foreground">
                                <Music className="h-12 w-12 mx-auto mb-3 opacity-50" />
                                <p>No audio files selected</p>
                                <p className="text-sm mt-1">
                                    Click "Select Audio Files" to get started
                                </p>
                            </div>
                        )}
                    </div>

                    {/* Action buttons */}
                    <div className="flex flex-wrap gap-2 justify-end pt-4 border-t">
                        <Button variant="ghost" onClick={() => onCancel?.()}>
                            Cancel
                        </Button>
                        <Button
                            disabled={!canConfirm || isProcessing}
                            variant={hasWarning && !isProcessing ? "outline" : "default"}
                            className={`flex flex-wrap ${
                                hasWarning && !isProcessing
                                    ? "border-orange-300 text-orange-700 hover:bg-orange-50"
                                    : ""
                            }`}
                            onClick={async () => {
                                // Warn if very few segments - might indicate segmentation issues or user forgot to split
                                if (totalSegments <= 1) {
                                    const proceed = confirm(
                                        totalSegments === 0
                                            ? "No audio segments detected. This might indicate an issue with your audio files. Do you want to proceed anyway?"
                                            : "Only 1 audio segment detected. This means your audio won't be split into smaller parts. " +
                                                  "You can expand the waveform view and use auto-split or manual splitting to create more segments. " +
                                                  "Do you want to proceed with a single segment?"
                                    );
                                    if (!proceed) {
                                        return;
                                    }
                                } else if (totalSegments < 3) {
                                    const proceed = confirm(
                                        `Only ${totalSegments} audio segments detected. This might be fewer than expected. ` +
                                            "You can expand the waveform view and adjust the silence threshold or add manual splits. " +
                                            "Do you want to proceed with the current segmentation?"
                                    );
                                    if (!proceed) {
                                        return;
                                    }
                                }

                                setIsProcessing(true);
                                try {
                                    await buildNotebookPairAndAttachments();
                                } catch (error) {
                                    console.error("Import failed:", error);
                                    alert(
                                        "Failed to import audio files. Please check the console for details."
                                    );
                                } finally {
                                    setIsProcessing(false);
                                }
                            }}
                        >
                            {isProcessing ? (
                                <>Processing...</>
                            ) : hasWarning ? (
                                <>
                                    <AlertTriangle className="mr-2 h-4 w-4" />
                                    Import {totalSegments} Segment{totalSegments !== 1 ? "s" : ""}{" "}
                                    {mergeFiles
                                        ? "as 1 Notebook"
                                        : `as ${rows.length} Notebook${
                                              rows.length !== 1 ? "s" : ""
                                          }`}
                                </>
                            ) : (
                                <>
                                    <Scissors className="mr-2 h-4 w-4" />
                                    Import {totalSegments} Segment{totalSegments !== 1 ? "s" : ""}{" "}
                                    {mergeFiles
                                        ? "as 1 Notebook"
                                        : `as ${rows.length} Notebook${
                                              rows.length !== 1 ? "s" : ""
                                          }`}
                                </>
                            )}
                        </Button>
                    </div>
                </CardContent>
            </Card>
        </div>
    );
};

export default AudioImporterForm;
