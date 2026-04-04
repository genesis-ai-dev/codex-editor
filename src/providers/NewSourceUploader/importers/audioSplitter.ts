import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
    SelectAudioFileMessage,
    ReprocessAudioFileMessage,
    RequestAudioSegmentMessage,
    FinalizeAudioImportMessage,
    UpdateAudioSegmentsMessage,
    AudioProcessingCompleteMessage,
} from "../../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";

interface AudioImportSession {
    filePath: string;
    segments: Array<{ id: string; startSec: number; endSec: number }>;
    tempDir: string;
    durationSec?: number;
    /** True when FFmpeg was unavailable and the webview handled processing. */
    usingFallback: boolean;
    /** Original file extension without the dot (e.g. "mp3", "m4a"). */
    sourceExtension: string;
}

const fileToDataUrl = (filePath: string): string => {
    const fileData = fs.readFileSync(filePath);
    const base64 = fileData.toString("base64");

    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
        ".mp3": "audio/mpeg",
        ".wav": "audio/wav",
        ".m4a": "audio/mp4",
        ".aac": "audio/aac",
        ".ogg": "audio/ogg",
        ".webm": "audio/webm",
        ".flac": "audio/flac",
    };
    const mimeType = mimeMap[ext] ?? "application/octet-stream";

    return `data:${mimeType};base64,${base64}`;
};

class AudioSplitter {
    private audioImportSessions = new Map<string, AudioImportSession>();

    /**
     * Handle file selection: open dialog, copy to temp, then either
     * process via FFmpeg (primary) or send to the webview for Web Audio API
     * processing (fallback).
     */
    async handleSelectAudioFile(
        message: SelectAudioFileMessage,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            const fileUris = await vscode.window.showOpenDialog({
                canSelectFiles: true,
                canSelectFolders: false,
                canSelectMany: true,
                filters: {
                    Audio: ["mp3", "wav", "m4a", "aac", "ogg", "webm", "flac"],
                },
                openLabel: "Select Audio Files",
            });

            if (!fileUris || fileUris.length === 0) {
                webviewPanel.webview.postMessage({
                    command: "audioFileSelected",
                    sessionId: "",
                    fileName: "",
                    durationSec: 0,
                    segments: [],
                    waveformPeaks: [],
                    error: "No files selected",
                });
                return;
            }

            const thresholdDb = message.thresholdDb ?? -40;
            const minDuration = message.minDuration ?? 0.5;

            const { isFFmpegAvailable } = await import("../../../utils/audioProcessor");
            const { shouldUseNativeAudio } = await import("../../../utils/toolPreferences");
            const ffmpegAvailable = await isFFmpegAvailable();
            const useNative = shouldUseNativeAudio(ffmpegAvailable);

            if (useNative) {
                await this.processWithFFmpeg(fileUris, thresholdDb, minDuration, workspaceFolder, webviewPanel);
            } else {
                await this.processWithFallback(fileUris, thresholdDb, minDuration, workspaceFolder, webviewPanel);
            }
        } catch (error) {
            console.error("[AudioImporter] Error selecting audio file:", error);
            webviewPanel.webview.postMessage({
                command: "audioFileSelected",
                sessionId: "",
                fileName: "",
                durationSec: 0,
                segments: [],
                waveformPeaks: [],
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    /** Primary path: process audio on the host using FFmpeg. */
    private async processWithFFmpeg(
        fileUris: vscode.Uri[],
        thresholdDb: number,
        minDuration: number,
        workspaceFolder: vscode.WorkspaceFolder,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        const { processAudioFile } = await import("../../../utils/audioProcessor");

        const results: Array<{
            sessionId: string;
            fileName: string;
            durationSec: number;
            segments: Array<{ id: string; startSec: number; endSec: number }>;
            waveformPeaks: number[];
            fullAudioUri: string;
            sourceExtension: string;
        }> = [];

        for (const fileUri of fileUris) {
            const filePath = fileUri.fsPath;
            const fileName = path.basename(filePath);
            const sessionId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const tempDir = path.join(
                workspaceFolder.uri.fsPath, ".project", ".temp", "audio-import", sessionId,
            );

            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFilePath = path.join(tempDir, fileName);
            fs.copyFileSync(filePath, tempFilePath);

            const metadata = await processAudioFile(tempFilePath, 30, thresholdDb, minDuration);

            const segments = metadata.segments.map((seg, index) => ({
                id: `${sessionId}-seg${index + 1}`,
                startSec: seg.startSec,
                endSec: seg.endSec,
            }));

            const sourceExtension = path.extname(fileName).replace(/^\./, "").toLowerCase();

            this.audioImportSessions.set(sessionId, {
                filePath: tempFilePath,
                segments,
                tempDir,
                durationSec: metadata.durationSec,
                usingFallback: false,
                sourceExtension,
            });

            const fullAudioUri = fileToDataUrl(tempFilePath);

            results.push({
                sessionId,
                fileName,
                durationSec: metadata.durationSec,
                segments,
                waveformPeaks: metadata.previewPeaks || [],
                fullAudioUri,
                sourceExtension,
            });
        }

        if (results.length === 1) {
            webviewPanel.webview.postMessage({
                command: "audioFileSelected",
                sessionId: results[0].sessionId,
                fileName: results[0].fileName,
                durationSec: results[0].durationSec,
                segments: results[0].segments,
                waveformPeaks: results[0].waveformPeaks,
                fullAudioUri: results[0].fullAudioUri,
                sourceExtension: results[0].sourceExtension,
                thresholdDb,
                minDuration,
            });
        } else {
            webviewPanel.webview.postMessage({
                command: "audioFilesSelected",
                files: results.map((r) => ({
                    sessionId: r.sessionId,
                    fileName: r.fileName,
                    durationSec: r.durationSec,
                    segments: r.segments,
                    waveformPeaks: r.waveformPeaks,
                    fullAudioUri: r.fullAudioUri,
                    sourceExtension: r.sourceExtension,
                })),
                thresholdDb,
                minDuration,
            });
        }
    }

    /**
     * Fallback path: send the raw audio to the webview for Web Audio API
     * processing. The webview will reply with `audioProcessingComplete`.
     */
    private async processWithFallback(
        fileUris: vscode.Uri[],
        thresholdDb: number,
        minDuration: number,
        workspaceFolder: vscode.WorkspaceFolder,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        for (const fileUri of fileUris) {
            const filePath = fileUri.fsPath;
            const fileName = path.basename(filePath);
            const sessionId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
            const tempDir = path.join(
                workspaceFolder.uri.fsPath, ".project", ".temp", "audio-import", sessionId,
            );

            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFilePath = path.join(tempDir, fileName);
            fs.copyFileSync(filePath, tempFilePath);

            const sourceExtension = path.extname(fileName).replace(/^\./, "").toLowerCase();

            this.audioImportSessions.set(sessionId, {
                filePath: tempFilePath,
                segments: [],
                tempDir,
                usingFallback: true,
                sourceExtension,
            });

            const fullAudioUri = fileToDataUrl(tempFilePath);
            const sizeBytes = fs.statSync(tempFilePath).size;

            webviewPanel.webview.postMessage({
                command: "audioFileForProcessing",
                sessionId,
                fileName,
                fullAudioUri,
                sizeBytes,
                thresholdDb,
                minDuration,
            });
        }
    }

    /**
     * Handle the webview's response after Web Audio API processing completes.
     * Updates the session with segments and duration.
     */
    handleAudioProcessingComplete(message: AudioProcessingCompleteMessage): void {
        const session = this.audioImportSessions.get(message.sessionId);
        if (!session) {
            console.warn(`[AudioImporter] No session found for audioProcessingComplete: ${message.sessionId}`);
            return;
        }

        session.segments = message.segments;
        session.durationSec = message.durationSec;
        console.log(
            `[AudioImporter] Webview processing complete for ${message.sessionId}: ` +
            `duration=${message.durationSec}s, segments=${message.segments.length}`,
        );
    }

    async handleReprocessAudioFile(
        message: ReprocessAudioFileMessage,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
            }

            if (session.usingFallback) {
                webviewPanel.webview.postMessage({
                    command: "reprocessAudioInWebview",
                    sessionId: message.sessionId,
                    thresholdDb: message.thresholdDb,
                    minDuration: message.minDuration,
                });
                return;
            }

            const { processAudioFile } = await import("../../../utils/audioProcessor");
            const metadata = await processAudioFile(session.filePath, 30, message.thresholdDb, message.minDuration);

            const segments = metadata.segments.map((seg, index) => ({
                id: `${message.sessionId}-seg${index + 1}`,
                startSec: seg.startSec,
                endSec: seg.endSec,
            }));

            session.segments = segments;
            if (metadata.durationSec) {
                session.durationSec = metadata.durationSec;
            }

            const fullAudioUri = fileToDataUrl(session.filePath);

            webviewPanel.webview.postMessage({
                command: "audioFileSelected",
                sessionId: message.sessionId,
                fileName: path.basename(session.filePath),
                durationSec: metadata.durationSec,
                segments,
                waveformPeaks: metadata.previewPeaks || [],
                fullAudioUri,
                sourceExtension: session.sourceExtension,
                thresholdDb: message.thresholdDb,
                minDuration: message.minDuration,
            });
        } catch (error) {
            console.error("[AudioImporter] Error reprocessing audio file:", error);
            webviewPanel.webview.postMessage({
                command: "audioFileSelected",
                sessionId: message.sessionId,
                fileName: "",
                durationSec: 0,
                segments: [],
                waveformPeaks: [],
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    async handleRequestAudioSegment(
        message: RequestAudioSegmentMessage,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
            }

            if (session.usingFallback) {
                webviewPanel.webview.postMessage({
                    command: "audioSegmentResponse",
                    segmentId: message.segmentId,
                    audioUri: "",
                    error: "Segment preview is handled by the webview in fallback mode",
                });
                return;
            }

            const segment = session.segments.find((s) => s.id === message.segmentId);
            if (!segment) {
                throw new Error("Segment not found");
            }

            const outputFileName = `${message.segmentId}.wav`;
            const outputPath = path.join(session.tempDir, outputFileName);

            const { extractSegment } = await import("../../../utils/audioProcessor");
            await extractSegment(session.filePath, outputPath, message.startSec, message.endSec);

            const audioUri = fileToDataUrl(outputPath);

            webviewPanel.webview.postMessage({
                command: "audioSegmentResponse",
                segmentId: message.segmentId,
                audioUri,
            });
        } catch (error) {
            console.error("[AudioImporter] Error extracting segment:", error);
            webviewPanel.webview.postMessage({
                command: "audioSegmentResponse",
                segmentId: message.segmentId,
                audioUri: "",
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    async handleUpdateAudioSegments(
        message: UpdateAudioSegmentsMessage,
        webviewPanel: vscode.WebviewPanel,
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
            }

            if (message.segments.length === 0) {
                throw new Error("Segments array cannot be empty");
            }

            const duration = Math.max(...message.segments.map((s) => s.endSec));

            const MAX_SEGMENT_LENGTH = 30;
            const processedSegments: Array<{ id: string; startSec: number; endSec: number }> = [];

            for (let i = 0; i < message.segments.length; i++) {
                const seg = message.segments[i];

                if (seg.startSec < 0 || seg.endSec < 0) {
                    throw new Error(`Segment ${seg.id} has negative time`);
                }
                if (seg.startSec >= seg.endSec) {
                    throw new Error(`Segment ${seg.id} has invalid time range`);
                }
                if (seg.endSec > duration + 0.1) {
                    throw new Error(`Segment ${seg.id} extends beyond audio duration`);
                }

                if (i > 0 && seg.startSec < message.segments[i - 1].endSec) {
                    throw new Error("Segments overlap or are out of order");
                }

                const segmentDuration = seg.endSec - seg.startSec;
                if (segmentDuration <= MAX_SEGMENT_LENGTH) {
                    processedSegments.push({ id: seg.id, startSec: seg.startSec, endSec: seg.endSec });
                } else {
                    let currentStart = seg.startSec;
                    let segmentIndex = 0;
                    while (currentStart < seg.endSec) {
                        const currentEnd = Math.min(currentStart + MAX_SEGMENT_LENGTH, seg.endSec);
                        const newId = segmentIndex === 0 ? seg.id : `${seg.id}-split${segmentIndex}`;
                        processedSegments.push({ id: newId, startSec: currentStart, endSec: currentEnd });
                        currentStart = currentEnd;
                        segmentIndex++;
                    }
                }
            }

            session.segments = processedSegments;

            console.log(
                `[AudioImporter] Updated ${processedSegments.length} segments ` +
                `(from ${message.segments.length} input segments) for session ${message.sessionId}`,
            );

            webviewPanel.webview.postMessage({
                command: "audioSegmentsUpdated",
                sessionId: message.sessionId,
                success: true,
            });
        } catch (error) {
            console.error("[AudioImporter] Error updating segments:", error);
            webviewPanel.webview.postMessage({
                command: "audioSegmentsUpdated",
                sessionId: message.sessionId,
                success: false,
                error: error instanceof Error ? error.message : "Unknown error",
            });
        }
    }

    async handleFinalizeAudioImport(
        message: FinalizeAudioImportMessage,
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel,
        writeNotebooksHandler: (
            message: { command: string; notebookPairs: any[]; metadata: any },
            token: vscode.CancellationToken,
            webviewPanel: vscode.WebviewPanel,
        ) => Promise<void>,
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
            }

            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                throw new Error("No workspace folder found");
            }

            webviewPanel.webview.postMessage({
                command: "audioImportProgress",
                sessionId: message.sessionId,
                stage: "preparing",
                message: "Preparing directories...",
                progress: 5,
            });

            const docId = message.documentName;
            const filesDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "attachments", "files", docId);
            const pointersDir = vscode.Uri.joinPath(workspaceFolder.uri, ".project", "attachments", "pointers", docId);

            await vscode.workspace.fs.createDirectory(filesDir);
            await vscode.workspace.fs.createDirectory(pointersDir);

            const totalSegments = message.segmentMappings.length;
            const startTime = Date.now();

            webviewPanel.webview.postMessage({
                command: "audioImportProgress",
                sessionId: message.sessionId,
                stage: "extracting",
                message: `Extracting and saving ${totalSegments} audio segments...`,
                progress: 10,
                currentSegment: 0,
                totalSegments,
            });

            const minUpdateIntervalMs = 100;
            let lastUpdateTime = Date.now();

            // Build a lookup for encoded segments from the webview (fallback path)
            const encodedMap = new Map<string, string>();
            if (session.usingFallback && message.encodedSegments) {
                for (const enc of message.encodedSegments) {
                    encodedMap.set(enc.segmentId, enc.wavBase64);
                }
            }

            for (let i = 0; i < message.segmentMappings.length; i++) {
                const mapping = message.segmentMappings[i];
                const segment = session.segments.find((s) => s.id === mapping.segmentId);
                if (!segment) {
                    console.warn(`Segment ${mapping.segmentId} not found in session`);
                    continue;
                }

                const filesPath = path.join(filesDir.fsPath, mapping.fileName);
                const pointersPath = path.join(pointersDir.fsPath, mapping.fileName);

                if (session.usingFallback) {
                    const wavBase64 = encodedMap.get(mapping.segmentId);
                    if (wavBase64) {
                        const wavBuffer = Buffer.from(wavBase64, "base64");
                        const dir = path.dirname(filesPath);
                        if (!fs.existsSync(dir)) {
                            fs.mkdirSync(dir, { recursive: true });
                        }
                        fs.writeFileSync(filesPath, wavBuffer);
                    } else {
                        console.warn(`[AudioImporter] No encoded segment data for ${mapping.segmentId}`);
                        continue;
                    }
                } else {
                    const { extractSegment } = await import("../../../utils/audioProcessor");
                    try {
                        await extractSegment(session.filePath, filesPath, segment.startSec, segment.endSec, "copy");
                    } catch (streamCopyError) {
                        console.warn(
                            `[AudioImporter] Stream-copy failed for ${mapping.segmentId}, ` +
                            `falling back to re-encode:`,
                            streamCopyError,
                        );
                        await extractSegment(session.filePath, filesPath, segment.startSec, segment.endSec, "reencode");
                    }
                }

                fs.copyFileSync(filesPath, pointersPath);

                const elapsedMs = Date.now() - startTime;
                const elapsedSeconds = elapsedMs / 1000;
                const segmentsPerSecond = (i + 1) / elapsedSeconds;
                const remainingSegments = totalSegments - (i + 1);
                const etaSeconds = segmentsPerSecond > 0 ? Math.ceil(remainingSegments / segmentsPerSecond) : undefined;

                const now = Date.now();
                const shouldUpdate =
                    i === 0 || i === message.segmentMappings.length - 1 || now - lastUpdateTime >= minUpdateIntervalMs;

                if (shouldUpdate) {
                    const progress = Math.floor(((i + 1) / totalSegments) * 80);
                    lastUpdateTime = now;

                    webviewPanel.webview.postMessage({
                        command: "audioImportProgress",
                        sessionId: message.sessionId,
                        stage: "processing",
                        message: `Processing segments... (${i + 1}/${totalSegments})`,
                        progress,
                        currentSegment: i + 1,
                        totalSegments,
                        etaSeconds,
                    });
                }
            }

            webviewPanel.webview.postMessage({
                command: "audioImportProgress",
                sessionId: message.sessionId,
                stage: "creating",
                message: "Creating notebook files...",
                progress: 85,
            });

            await writeNotebooksHandler(
                {
                    command: "writeNotebooks",
                    notebookPairs: message.notebookPairs,
                    metadata: {
                        importerType: "audio",
                        timestamp: new Date().toISOString(),
                    },
                },
                token,
                webviewPanel,
            );

            webviewPanel.webview.postMessage({
                command: "audioImportProgress",
                sessionId: message.sessionId,
                stage: "cleaning",
                message: "Cleaning up temporary files...",
                progress: 95,
            });

            this.audioImportSessions.delete(message.sessionId);

            try {
                fs.rmSync(session.tempDir, { recursive: true, force: true });
            } catch (cleanupError) {
                console.warn(`Failed to cleanup temp directory ${session.tempDir}:`, cleanupError);
            }

            webviewPanel.webview.postMessage({
                command: "audioImportComplete",
                sessionId: message.sessionId,
                success: true,
            });

            webviewPanel.webview.postMessage({
                command: "notification",
                type: "success",
                message: "Audio import completed successfully!",
            });
        } catch (error) {
            console.error("[AudioImporter] Error finalizing import:", error);
            webviewPanel.webview.postMessage({
                command: "audioImportComplete",
                sessionId: message.sessionId,
                success: false,
                error: error instanceof Error ? error.message : "Failed to finalize import",
            });
            webviewPanel.webview.postMessage({
                command: "notification",
                type: "error",
                message: error instanceof Error ? error.message : "Failed to finalize import",
            });
        }
    }
}

const audioSplitter = new AudioSplitter();

export const handleSelectAudioFile = (
    message: SelectAudioFileMessage,
    webviewPanel: vscode.WebviewPanel,
): Promise<void> => audioSplitter.handleSelectAudioFile(message, webviewPanel);

export const handleReprocessAudioFile = (
    message: ReprocessAudioFileMessage,
    webviewPanel: vscode.WebviewPanel,
): Promise<void> => audioSplitter.handleReprocessAudioFile(message, webviewPanel);

export const handleRequestAudioSegment = (
    message: RequestAudioSegmentMessage,
    webviewPanel: vscode.WebviewPanel,
): Promise<void> => audioSplitter.handleRequestAudioSegment(message, webviewPanel);

export const handleUpdateAudioSegments = (
    message: UpdateAudioSegmentsMessage,
    webviewPanel: vscode.WebviewPanel,
): Promise<void> => audioSplitter.handleUpdateAudioSegments(message, webviewPanel);

export const handleFinalizeAudioImport = (
    message: FinalizeAudioImportMessage,
    token: vscode.CancellationToken,
    webviewPanel: vscode.WebviewPanel,
    writeNotebooksHandler: (
        message: { command: string; notebookPairs: any[]; metadata: any },
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel,
    ) => Promise<void>,
): Promise<void> => audioSplitter.handleFinalizeAudioImport(message, token, webviewPanel, writeNotebooksHandler);

export const handleAudioProcessingComplete = (
    message: AudioProcessingCompleteMessage,
): void => audioSplitter.handleAudioProcessingComplete(message);
