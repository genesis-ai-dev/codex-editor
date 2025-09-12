/* Note: this file has some support for importing video files as well as audio, but this generally results in a grey screen blocking the main thread, so user-facing copy related to video is disabled for now. */

import React, { useMemo, useState, useCallback, lazy, Suspense, useEffect } from "react";
import { ImporterComponentProps, WriteNotebooksWithAttachmentsMessage } from "../../types/plugin";
import { Button } from "../../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../../components/ui/card";
import { Input } from "../../../components/ui/input";
import { Badge } from "../../../components/ui/badge";
import { Label } from "../../../components/ui/label";
import { Slider } from "../../../components/ui/slider";
import { Switch } from "../../../components/ui/switch";
import { Progress } from "../../../components/ui/progress";
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
    Video,
} from "lucide-react";
import { processVttOrTsv } from "./timestampParsers";
import { Alert, AlertDescription } from "../../../components/ui/alert";
import { isVideoFile } from "./audioExtractor";

// Lazy load the waveform component to avoid blocking initial render
const AudioWaveform = lazy(() => import("./AudioWaveform"));

type MediaRow = {
    id: string;
    file: File;
    name: string;
    durationSec?: number;
    segments: Array<{ startSec: number; endSec: number; text?: string }>;
    status: "new" | "segmented";
    expanded?: boolean;
    isVideo?: boolean;
};

function generateAttachmentId(): string {
    return `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

async function extractAudioSegment(file: File, startTime: number, endTime?: number): Promise<Blob> {
    try {
        // Create audio context
        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();

        // Read file as array buffer
        const arrayBuffer = await file.arrayBuffer();

        // Decode audio data
        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);

        // Calculate segment duration
        const duration =
            endTime && isFinite(endTime)
                ? Math.min(endTime - startTime, audioBuffer.duration - startTime)
                : audioBuffer.duration - startTime;

        if (duration <= 0) {
            throw new Error("Invalid segment duration");
        }

        // Create offline context for the segment
        const offlineContext = new OfflineAudioContext(
            audioBuffer.numberOfChannels,
            Math.ceil(duration * audioBuffer.sampleRate),
            audioBuffer.sampleRate
        );

        // Create buffer source
        const source = offlineContext.createBufferSource();
        source.buffer = audioBuffer;
        source.connect(offlineContext.destination);

        // Start playback from the segment start time
        source.start(0, startTime, duration);

        // Render the segment
        const renderedBuffer = await offlineContext.startRendering();

        // Convert to WAV format
        return audioBufferToWav(renderedBuffer);
    } catch (error) {
        console.error("Error extracting audio segment:", error);
        throw error;
    }
}

// Convert AudioBuffer to WAV Blob
function audioBufferToWav(buffer: AudioBuffer): Blob {
    const numOfChan = buffer.numberOfChannels;
    const length = buffer.length * numOfChan * 2;
    const sampleRate = buffer.sampleRate;
    const wavBuffer = new ArrayBuffer(44 + length);
    const view = new DataView(wavBuffer);

    // Write WAV header
    writeString(view, 0, "RIFF");
    view.setUint32(4, 36 + length, true);
    writeString(view, 8, "WAVE");
    writeString(view, 12, "fmt ");
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, numOfChan, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2 * numOfChan, true);
    view.setUint16(32, numOfChan * 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, "data");
    view.setUint32(40, length, true);

    // Write audio data
    const offset = 44;
    const channels = [];
    for (let i = 0; i < numOfChan; i++) {
        channels.push(buffer.getChannelData(i));
    }

    for (let i = 0; i < buffer.length; i++) {
        for (let channel = 0; channel < numOfChan; channel++) {
            const sample = Math.max(-1, Math.min(1, channels[channel][i]));
            view.setInt16(
                offset + (i * numOfChan + channel) * 2,
                sample < 0 ? sample * 0x8000 : sample * 0x7fff,
                true
            );
        }
    }

    return new Blob([wavBuffer], { type: "audio/wav" });
}

function writeString(view: DataView, offset: number, string: string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
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

const processedNotebook = (
    name: string,
    cells: any[],
    nowIso: string,
    videoUrl?: string,
    audioOnly?: boolean
) => ({
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
        importerType: "audio", // Keep as "audio" for compatibility
        createdAt: nowIso,
        ...(videoUrl && { videoUrl }),
        ...(audioOnly !== undefined ? { audioOnly } : {}),
    },
});

export const AudioImporterForm: React.FC<ImporterComponentProps> = ({
    onComplete,
    onCancel,
    onCancelImport,
    wizardContext,
}) => {
    const [rows, setRows] = useState<MediaRow[]>([]);
    const [documentName, setDocumentName] = useState<string>(
        wizardContext?.selectedSource?.name || "MediaDocument"
    );
    const [isProcessing, setIsProcessing] = useState(false);
    const [silenceThreshold, setSilenceThreshold] = useState(0.5); // seconds
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [mergeFiles, setMergeFiles] = useState(false); // Default to individual files

    // Auto-segmentation progress state
    const [isAutoSegmenting, setIsAutoSegmenting] = useState(false);
    const [autoSegmentProgress, setAutoSegmentProgress] = useState({ current: 0, total: 0 });

    // Attachment import progress state
    const [attachmentProgress, setAttachmentProgress] = useState({
        current: 0,
        total: 0,
        message: "",
        isVisible: false,
    });

    const handleSelectFiles = useCallback(
        async (ev: React.ChangeEvent<HTMLInputElement>) => {
            const files = Array.from(ev.target.files || []).filter(
                (f) =>
                    f.type.startsWith("audio/") ||
                    // f.type.startsWith("video/") ||
                    // /\.(mp3|wav|m4a|aac|ogg|webm|flac|mp4|mov|avi|mkv|webm)$/i.test(f.name)
                    /\.(mp3|wav|m4a|aac|ogg|webm|flac)$/i.test(f.name)
            );

            const next: MediaRow[] = files.map((f, idx) => {
                const isVideo = isVideoFile(f);
                return {
                    id: `${f.name}-${idx}-${Date.now()}`,
                    file: f,
                    name: f.name.replace(/\.[^/.]+$/, ""),
                    segments: [{ startSec: 0, endSec: Number.NaN }],
                    status: "new", // All files are ready for processing
                    expanded: false,
                    isVideo,
                };
            });
            setRows((prev) => [...prev, ...next]);

            // Set document name to first file's name if not already set
            if (files.length > 0 && (!documentName || documentName === "MediaDocument")) {
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
                        prev.map((r) => {
                            if (r.id !== rowId) return r;
                            return {
                                ...r,
                                segments: segments.map((s) => ({
                                    startSec: s.startSec,
                                    endSec: s.endSec,
                                    text: s.text,
                                })),
                                status: "segmented",
                            };
                        })
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

    const handleAutoSegment = useCallback(async () => {
        const filesToProcess = rows.filter((row) => !row.expanded);
        if (filesToProcess.length === 0) return;

        setIsAutoSegmenting(true);
        setAutoSegmentProgress({ current: 0, total: filesToProcess.length });

        try {
            for (let i = 0; i < filesToProcess.length; i++) {
                const row = filesToProcess[i];
                setAutoSegmentProgress({ current: i, total: filesToProcess.length });

                // Expand the file to trigger auto-segmentation
                setRows((prev) =>
                    prev.map((r) => (r.id === row.id ? { ...r, expanded: true } : r))
                );

                // Wait a bit for the waveform to process
                await new Promise((resolve) => setTimeout(resolve, 1000));
            }

            setAutoSegmentProgress({
                current: filesToProcess.length,
                total: filesToProcess.length,
            });

            // Give a final moment to show completion
            await new Promise((resolve) => setTimeout(resolve, 500));
        } finally {
            setIsAutoSegmenting(false);
            setAutoSegmentProgress({ current: 0, total: 0 });
        }
    }, [rows]);

    // Listen for attachment progress messages from the VS Code extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.command === "attachmentProgress") {
                setAttachmentProgress({
                    current: message.current,
                    total: message.total,
                    message: message.message,
                    isVisible: message.current < message.total || message.current === 0,
                });

                // Hide progress after completion
                if (message.current === message.total && message.current > 0) {
                    setTimeout(() => {
                        setAttachmentProgress((prev) => ({ ...prev, isVisible: false }));
                    }, 2000);
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    const buildNotebookPairAndAttachments = async () => {
        const nowIso = new Date().toISOString();
        const fileDataMap = new Map<string, string>();
        const allAttachments: WriteNotebooksWithAttachmentsMessage["attachments"] = [];
        const notebookPairs: any[] = [];

        // Show initial processing progress
        setAttachmentProgress({
            current: 0,
            total: rows.length,
            message: "Processing media files...",
            isVisible: true,
        });

        // Determine if we have video files and get the first video URL
        const hasVideoFiles = rows.some((row) => row.isVideo);
        const firstVideoFile = rows.find((row) => row.isVideo);
        let videoUrl: string | undefined;

        if (firstVideoFile) {
            // Create a video URL in the project attachments folder
            const docId = documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
            const ext = firstVideoFile.file.name.split(".").pop() || "mp4";
            videoUrl = `.project/attachments/files/${docId}/${firstVideoFile.name}.${ext}`;
        }

        // Calculate total segments for local preprocessing progress (approximate)
        const totalSegmentsToProcess = rows.reduce(
            (sum, r) => sum + Math.max(1, r.segments.length),
            0
        );
        let processedSegmentsSoFar = 0;

        if (mergeFiles) {
            // MERGE MODE: Create one notebook with all files as sections
            const docId = documentName.replace(/\.[^/.]+$/, "").replace(/\s+/g, "");
            const sourceCells: any[] = [];
            const codexCells: any[] = [];

            // Store video file data separately if we have videos
            if (hasVideoFiles && firstVideoFile) {
                const videoDataUrl = await toTimestampDataUrl(firstVideoFile.file);
                fileDataMap.set("VIDEO_FILE", videoDataUrl);
            }

            let sectionIndex = 0;
            let anyTextProvided = false;
            for (const row of rows) {
                sectionIndex++;

                // Update progress for each file
                setAttachmentProgress({
                    current: sectionIndex - 1,
                    total: rows.length,
                    message: `Processing ${row.name}...`,
                    isVisible: true,
                });

                const baseAttachmentId = generateAttachmentId();
                const rawSegs = row.segments.map((s) => ({
                    startSec: s.startSec ?? 0,
                    endSec: isFinite(s.endSec) ? s.endSec : Number.NaN,
                    text: s.text,
                }));

                // Filter out invalid segments
                const validSegs = rawSegs.filter((s) => {
                    const isValidStart = isFinite(s.startSec) && s.startSec >= 0;
                    const isValidEnd = isFinite(s.endSec) || isNaN(s.endSec);
                    const isValidRange = isNaN(s.endSec) || s.endSec > s.startSec;

                    return isValidStart && isValidEnd && isValidRange;
                });

                if (validSegs.length === 0) {
                    console.warn(
                        `No valid segments for file ${row.name}, creating default segment`
                    );
                    validSegs.push({ startSec: 0, endSec: Number.NaN });
                }

                const segs = validSegs;

                // For video files, we still need to send the whole file for backend processing
                let fileDataUrl: string | undefined;
                if (row.isVideo) {
                    fileDataUrl = fileDataMap.get(row.file.name);
                    if (!fileDataUrl) {
                        console.log(`Reading video file data for ${row.name}...`);
                        fileDataUrl = await toTimestampDataUrl(row.file);
                        fileDataMap.set(row.file.name, fileDataUrl);
                    }
                }

                // For both video and audio: Create attachments with timing metadata
                // Backend will handle extraction if needed
                let cellIndex = 0;
                for (const seg of segs) {
                    cellIndex++;
                    const cellId = `${docId} ${sectionIndex}:${cellIndex}`;
                    const segmentAttachmentId = `${baseAttachmentId}-seg${cellIndex}`;

                    // Backend will handle audio extraction for video files
                    const fileName = row.isVideo
                        ? `${segmentAttachmentId}.webm` // Backend will extract to webm
                        : `${segmentAttachmentId}.wav`; // We're creating WAV segments

                    console.log(
                        `Processing segment ${cellIndex}/${segs.length} for ${row.name}: ${seg.startSec}s - ${seg.endSec}s`
                    );

                    // For audio files, extract the actual segment
                    if (!row.isVideo) {
                        try {
                            console.log(
                                `Extracting audio segment ${cellIndex} from ${row.name}...`
                            );
                            const segmentBlob = await extractAudioSegment(
                                row.file,
                                seg.startSec,
                                seg.endSec
                            );
                            const segmentDataUrl = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(String(reader.result));
                                reader.onerror = reject;
                                reader.readAsDataURL(segmentBlob);
                            });

                            allAttachments.push({
                                cellId,
                                attachmentId: segmentAttachmentId,
                                fileName,
                                mime: "audio/wav", // We're converting all segments to WAV
                                dataBase64: segmentDataUrl,
                                startTime: 0, // The segment is already cut, so it starts at 0
                                endTime: Number.NaN, // And plays to the end
                            });
                        } catch (error) {
                            console.error(
                                `Failed to extract segment ${cellIndex} from ${row.name}:`,
                                error
                            );
                            throw error;
                        }
                    } else {
                        // For video files, send the whole file with timing metadata
                        allAttachments.push({
                            cellId,
                            attachmentId: segmentAttachmentId,
                            fileName,
                            mime: "audio/webm",
                            ...(cellIndex === 1
                                ? {
                                      dataBase64: fileDataUrl, // Video data for backend extraction
                                      startTime: seg.startSec,
                                      endTime: seg.endSec,
                                      isFromVideo: true,
                                  }
                                : {
                                      sourceFileId: baseAttachmentId,
                                      startTime: seg.startSec,
                                      endTime: seg.endSec,
                                  }),
                        });
                    }

                    // Update local preprocessing progress
                    processedSegmentsSoFar++;
                    setAttachmentProgress({
                        current: processedSegmentsSoFar,
                        total: totalSegmentsToProcess,
                        message: `Preparing segments (${processedSegmentsSoFar}/${totalSegmentsToProcess})…`,
                        isVisible: true,
                    });

                    const url = `.project/attachments/files/${docId}/${fileName}`;
                    populateCellObjects(
                        sourceCells,
                        cellId,
                        seg,
                        segmentAttachmentId,
                        url,
                        codexCells,
                        !row.isVideo // isPreSegmented
                    );
                }
            }

            const hasAnyText = sourceCells.some((c: any) => (c.value || "").trim().length > 0);
            notebookPairs.push({
                source: processedNotebook(docId, sourceCells, nowIso, videoUrl, !hasAnyText),
                codex: processedNotebook(docId, codexCells, nowIso, videoUrl, !hasAnyText),
            });
        } else {
            // INDIVIDUAL MODE: Create separate notebook for each file
            for (let fileIndex = 0; fileIndex < rows.length; fileIndex++) {
                const row = rows[fileIndex];

                // Update progress for each file
                setAttachmentProgress({
                    current: fileIndex,
                    total: rows.length,
                    message: `Processing ${row.name}...`,
                    isVisible: true,
                });
                const fileDocId = row.name.replace(/\s+/g, "");
                const sourceCells: any[] = [];
                const codexCells: any[] = [];

                const baseAttachmentId = generateAttachmentId();
                console.log(`Processing individual file: ${row.name}, isVideo: ${row.isVideo}`);

                // In individual mode, ensure all segments are normalized to start from 0
                const rawSegs = row.segments.map((s) => ({
                    startSec: s.startSec ?? 0,
                    endSec: isFinite(s.endSec) ? s.endSec : Number.NaN,
                    text: s.text,
                }));

                // Filter out invalid segments
                const validSegs = rawSegs.filter((s) => {
                    const isValidStart = isFinite(s.startSec) && s.startSec >= 0;
                    const isValidEnd = isFinite(s.endSec) || isNaN(s.endSec);
                    const isValidRange = isNaN(s.endSec) || s.endSec > s.startSec;

                    console.log(
                        `Segment validation: start=${s.startSec}, end=${s.endSec}, validStart=${isValidStart}, validEnd=${isValidEnd}, validRange=${isValidRange}`
                    );

                    return isValidStart && isValidEnd && isValidRange;
                });

                if (validSegs.length === 0) {
                    console.warn(
                        `No valid segments for file ${row.name}, creating default segment`
                    );
                    // Create a default segment for the entire file
                    validSegs.push({ startSec: 0, endSec: Number.NaN });
                }

                const earliestStart = Math.min(...validSegs.map((s) => s.startSec));
                const segs = validSegs.map((s) => ({
                    startSec: s.startSec - earliestStart,
                    endSec: isFinite(s.endSec) ? s.endSec - earliestStart : Number.NaN,
                    text: s.text,
                }));

                console.log(`File ${row.name} has ${segs.length} valid segments`);

                // For individual files, pass video URL if this specific file is a video
                let fileVideoUrl: string | undefined;
                if (row.isVideo) {
                    fileVideoUrl = `.project/attachments/files/${fileDocId}/${row.name}.${
                        row.file.name.split(".").pop() || "mp4"
                    }`;
                    // Store video file data for later writing
                    try {
                        const videoDataUrl = await toTimestampDataUrl(row.file);
                        fileDataMap.set(`VIDEO_FILE_${row.id}`, videoDataUrl);
                        console.log(`Stored video data for ${row.name}`);
                    } catch (error) {
                        console.error(`Failed to read video file ${row.name}:`, error);
                        continue;
                    }
                }

                // Get file data (video files will be processed by backend)
                const fileDataUrl = await toTimestampDataUrl(row.file);
                console.log(`${row.isVideo ? "Video" : "Audio"} file data loaded for ${row.name}`);

                // For both video and audio: Create attachments with timing metadata
                let cellIndex = 0;
                for (const seg of segs) {
                    cellIndex++;
                    const cellId = `${fileDocId} 1:${cellIndex}`; // Single section per file
                    const segmentAttachmentId = `${baseAttachmentId}-seg${cellIndex}`;

                    // Backend will handle audio extraction for video files
                    const fileName = row.isVideo
                        ? `${segmentAttachmentId}.webm` // Backend will extract to webm
                        : `${segmentAttachmentId}.wav`; // We're creating WAV segments

                    console.log(
                        `Processing segment ${cellIndex}/${segs.length} for ${row.name}: ${seg.startSec}s - ${seg.endSec}s`
                    );

                    // For audio files, extract the actual segment
                    if (!row.isVideo) {
                        try {
                            console.log(
                                `Extracting audio segment ${cellIndex} from ${row.name}...`
                            );
                            const segmentBlob = await extractAudioSegment(
                                row.file,
                                seg.startSec,
                                seg.endSec
                            );
                            const segmentDataUrl = await new Promise<string>((resolve, reject) => {
                                const reader = new FileReader();
                                reader.onload = () => resolve(String(reader.result));
                                reader.onerror = reject;
                                reader.readAsDataURL(segmentBlob);
                            });

                            allAttachments.push({
                                cellId,
                                attachmentId: segmentAttachmentId,
                                fileName,
                                mime: "audio/wav", // We're converting all segments to WAV
                                dataBase64: segmentDataUrl,
                                startTime: 0, // The segment is already cut, so it starts at 0
                                endTime: Number.NaN, // And plays to the end
                            });
                        } catch (error) {
                            console.error(
                                `Failed to extract segment ${cellIndex} from ${row.name}:`,
                                error
                            );
                            throw error;
                        }
                    } else {
                        // For video files, send the whole file with timing metadata
                        allAttachments.push({
                            cellId,
                            attachmentId: segmentAttachmentId,
                            fileName,
                            mime: "audio/webm",
                            ...(cellIndex === 1
                                ? {
                                      dataBase64: fileDataUrl, // Video data for backend extraction
                                      startTime: seg.startSec,
                                      endTime: seg.endSec,
                                      isFromVideo: true,
                                  }
                                : {
                                      sourceFileId: baseAttachmentId,
                                      startTime: seg.startSec,
                                      endTime: seg.endSec,
                                  }),
                        });
                    }

                    // Update local preprocessing progress
                    processedSegmentsSoFar++;
                    setAttachmentProgress({
                        current: processedSegmentsSoFar,
                        total: totalSegmentsToProcess,
                        message: `Preparing segments (${processedSegmentsSoFar}/${totalSegmentsToProcess})…`,
                        isVisible: true,
                    });

                    const url = `.project/attachments/files/${fileDocId}/${fileName}`;
                    populateCellObjects(
                        sourceCells,
                        cellId,
                        seg,
                        segmentAttachmentId,
                        url,
                        codexCells,
                        !row.isVideo // isPreSegmented
                    );
                }

                notebookPairs.push({
                    source: processedNotebook(
                        fileDocId,
                        sourceCells,
                        nowIso,
                        fileVideoUrl,
                        !sourceCells.some((c: any) => (c.value || "").trim().length > 0)
                    ),
                    codex: processedNotebook(
                        fileDocId,
                        codexCells,
                        nowIso,
                        fileVideoUrl,
                        !sourceCells.some((c: any) => (c.value || "").trim().length > 0)
                    ),
                });
            }
        }

        // Prepare video files for separate storage
        const videoFiles: Array<{ path: string; dataBase64: string }> = [];
        if (mergeFiles && hasVideoFiles) {
            const videoData = fileDataMap.get("VIDEO_FILE");
            if (videoData && videoUrl) {
                videoFiles.push({ path: videoUrl, dataBase64: videoData });
            }
        } else {
            // Individual mode - collect all video files
            for (const row of rows) {
                if (row.isVideo) {
                    const fileDocId = row.name.replace(/\s+/g, "");
                    const videoPath = `.project/attachments/files/${fileDocId}/${row.name}.${
                        row.file.name.split(".").pop() || "mp4"
                    }`;
                    const videoData = fileDataMap.get(`VIDEO_FILE_${row.id}`);
                    if (videoData) {
                        videoFiles.push({ path: videoPath, dataBase64: videoData });
                    }
                }
            }
        }

        // Send notebooks plus attachments via custom message
        const message: WriteNotebooksWithAttachmentsMessage = {
            command: "writeNotebooksWithAttachments",
            notebookPairs,
            attachments: allAttachments,
            metadata: {
                importerType: "audio",
                timestamp: nowIso,
                videoFiles, // Include video files for separate storage
            },
        } as any;
        (window as any).vscodeApi.postMessage(message);

        // Hide attachment progress on success
        setAttachmentProgress((prev) => ({ ...prev, isVisible: false }));

        // Show success feedback - pass the notebook pairs to onComplete
        onComplete?.(notebookPairs as any);

        function populateCellObjects(
            sourceCells: any[],
            cellId: string,
            seg: { startSec: number; endSec: number; text?: string },
            segmentAttachmentId: string,
            url: string,
            codexCells: any[],
            isPreSegmented: boolean
        ) {
            // For pre-segmented audio, the timing in cell metadata should reflect the original timing
            // but the attachment timing should be 0 since the file is already cut

            sourceCells.push({
                kind: 2,
                value: seg.text || "",
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
                            startTime: isPreSegmented ? 0 : seg.startSec,
                            endTime: isPreSegmented ? Number.NaN : seg.endSec,
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
                        <div className="flex items-center gap-1">
                            <Music className="h-5 w-5" />
                            {/* <Video className="h-5 w-5" /> */}
                        </div>
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
                                id="media-file-input"
                                type="file"
                                accept="audio/*"
                                multiple
                                className="hidden"
                                onChange={handleSelectFiles}
                            />
                            <label htmlFor="media-file-input" className="cursor-pointer">
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
                                            onClick={handleAutoSegment}
                                            disabled={
                                                isAutoSegmenting ||
                                                rows.filter((row) => !row.expanded).length === 0
                                            }
                                        >
                                            <Scissors className="mr-2 h-3 w-3" />
                                            {isAutoSegmenting
                                                ? "Auto Segmenting..."
                                                : "Auto Segment"}
                                        </Button>
                                    </div>
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Auto-segmentation progress */}
                    {isAutoSegmenting && (
                        <div className="space-y-3">
                            <Alert>
                                <Activity className="h-4 w-4" />
                                <AlertDescription>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-medium">
                                                Auto-segmenting files...
                                            </span>
                                            <span className="text-sm text-muted-foreground">
                                                {autoSegmentProgress.current} of{" "}
                                                {autoSegmentProgress.total}
                                            </span>
                                        </div>
                                        <Progress
                                            value={
                                                (autoSegmentProgress.current /
                                                    autoSegmentProgress.total) *
                                                100
                                            }
                                            className="w-full"
                                        />
                                    </div>
                                </AlertDescription>
                            </Alert>
                        </div>
                    )}

                    {/* Attachment import progress */}
                    {attachmentProgress.isVisible && (
                        <div className="space-y-3">
                            <Alert>
                                <Upload className="h-4 w-4" />
                                <AlertDescription>
                                    <div className="space-y-2">
                                        <div className="flex justify-between items-center">
                                            <span className="text-sm font-medium">
                                                Importing attachments...
                                            </span>
                                            <span className="text-sm text-muted-foreground">
                                                {attachmentProgress.current} of{" "}
                                                {attachmentProgress.total}
                                            </span>
                                        </div>
                                        <Progress
                                            value={
                                                attachmentProgress.total > 0
                                                    ? (attachmentProgress.current /
                                                          attachmentProgress.total) *
                                                      100
                                                    : 0
                                            }
                                            className="w-full"
                                        />
                                        {attachmentProgress.message && (
                                            <div className="text-xs text-muted-foreground">
                                                {attachmentProgress.message}
                                            </div>
                                        )}
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
                                            {row.isVideo ? (
                                                <Video className="h-4 w-4 text-muted-foreground" />
                                            ) : (
                                                <Music className="h-4 w-4 text-muted-foreground" />
                                            )}
                                            <div className="flex-1">
                                                <div className="font-medium">{row.name}</div>
                                                <div className="text-xs text-muted-foreground">
                                                    {formatFileSize(row.file.size)} •{" "}
                                                    {row.file.type ||
                                                        (row.isVideo ? "video" : "audio")}
                                                    {row.isVideo && (
                                                        <span className="ml-1 text-blue-600">
                                                            • Video file
                                                        </span>
                                                    )}
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
                                <div className="flex justify-center gap-2 mb-3">
                                    <Music className="h-12 w-12 opacity-50" />
                                    {/* <Video className="h-12 w-12 opacity-50" /> */}
                                </div>
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
                                console.log("Import button clicked, starting validation...");

                                // Warn if very few segments - might indicate segmentation issues or user forgot to split
                                if (totalSegments <= 1) {
                                    const proceed = confirm(
                                        totalSegments === 0
                                            ? "No media segments detected. This might indicate an issue with your media files. Do you want to proceed anyway?"
                                            : "Only 1 media segment detected. This means your audio won't be split into smaller parts. " +
                                                  "You can expand the waveform view and use auto-split or manual splitting to create more segments. " +
                                                  "Do you want to proceed with a single segment?"
                                    );
                                    if (!proceed) {
                                        return;
                                    }
                                } else if (totalSegments < 3) {
                                    const proceed = confirm(
                                        `Only ${totalSegments} media segments detected. This might be fewer than expected. ` +
                                            "You can expand the waveform view and adjust the silence threshold or add manual splits. " +
                                            "Do you want to proceed with the current segmentation?"
                                    );
                                    if (!proceed) {
                                        return;
                                    }
                                }

                                console.log("Starting import process...");
                                setIsProcessing(true);

                                try {
                                    await buildNotebookPairAndAttachments();
                                    console.log("Import completed successfully");
                                } catch (error) {
                                    console.error("Import failed:", error);

                                    // Hide any progress indicators
                                    setAttachmentProgress((prev) => ({
                                        ...prev,
                                        isVisible: false,
                                    }));

                                    alert(
                                        `Failed to import media files: ${
                                            error instanceof Error ? error.message : "Unknown error"
                                        }. Please check the console for details.`
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
