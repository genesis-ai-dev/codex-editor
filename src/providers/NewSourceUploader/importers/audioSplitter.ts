import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";
import {
    SelectAudioFileMessage,
    ReprocessAudioFileMessage,
    RequestAudioSegmentMessage,
    FinalizeAudioImportMessage,
    UpdateAudioSegmentsMessage,
} from "../../../../webviews/codex-webviews/src/NewSourceUploader/types/plugin";

interface AudioImportSession {
    filePath: string;
    segments: Array<{ id: string; startSec: number; endSec: number }>;
    tempDir: string;
    durationSec?: number;
}

class AudioSplitter {
    private audioImportSessions = new Map<string, AudioImportSession>();

    async handleSelectAudioFile(
        message: SelectAudioFileMessage,
        webviewPanel: vscode.WebviewPanel
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

            const { processAudioFile } = await import("../../../utils/audioProcessor");
            const thresholdDb = message.thresholdDb ?? -40;
            const minDuration = message.minDuration ?? 0.5;

            const results: Array<{
                sessionId: string;
                fileName: string;
                durationSec: number;
                segments: Array<{ id: string; startSec: number; endSec: number }>;
                waveformPeaks: number[];
                fullAudioUri: string;
            }> = [];

            for (const fileUri of fileUris) {
                const filePath = fileUri.fsPath;
                const fileName = path.basename(filePath);

                const sessionId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const tempDir = path.join(workspaceFolder.uri.fsPath, ".project", ".temp", "audio-import", sessionId);

                if (!fs.existsSync(tempDir)) {
                    fs.mkdirSync(tempDir, { recursive: true });
                }

                const tempFilePath = path.join(tempDir, fileName);
                fs.copyFileSync(filePath, tempFilePath);
                const tempFileUri = vscode.Uri.file(tempFilePath);

                const metadata = await processAudioFile(tempFilePath, 30, thresholdDb, minDuration);

                const segments = metadata.segments.map((seg, index) => ({
                    id: `${sessionId}-seg${index + 1}`,
                    startSec: seg.startSec,
                    endSec: seg.endSec,
                }));

                this.audioImportSessions.set(sessionId, {
                    filePath: tempFilePath,
                    segments,
                    tempDir,
                    durationSec: metadata.durationSec,
                });

                const fullAudioUri = webviewPanel.webview.asWebviewUri(tempFileUri).toString();

                results.push({
                    sessionId,
                    fileName,
                    durationSec: metadata.durationSec,
                    segments,
                    waveformPeaks: metadata.previewPeaks || [],
                    fullAudioUri,
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
                    })),
                    thresholdDb,
                    minDuration,
                });
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

    async handleReprocessAudioFile(
        message: ReprocessAudioFileMessage,
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
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

            const fullAudioUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(session.filePath)).toString();

            webviewPanel.webview.postMessage({
                command: "audioFileSelected",
                sessionId: message.sessionId,
                fileName: path.basename(session.filePath),
                durationSec: metadata.durationSec,
                segments,
                waveformPeaks: metadata.previewPeaks || [],
                fullAudioUri,
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
        webviewPanel: vscode.WebviewPanel
    ): Promise<void> {
        try {
            const session = this.audioImportSessions.get(message.sessionId);
            if (!session) {
                throw new Error("Session not found");
            }

            const segment = session.segments.find((s) => s.id === message.segmentId);
            if (!segment) {
                throw new Error("Segment not found");
            }

            const outputFileName = `${message.segmentId}.wav`;
            const outputPath = path.join(session.tempDir, outputFileName);

            const { extractSegment } = await import("../../../utils/audioProcessor");
            await extractSegment(session.filePath, outputPath, message.startSec, message.endSec);

            const audioUri = webviewPanel.webview.asWebviewUri(vscode.Uri.file(outputPath)).toString();

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
        webviewPanel: vscode.WebviewPanel
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
                    throw new Error(`Segments overlap or are out of order`);
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
                        processedSegments.push({
                            id: newId,
                            startSec: currentStart,
                            endSec: currentEnd,
                        });
                        currentStart = currentEnd;
                        segmentIndex++;
                    }
                }
            }

            session.segments = processedSegments.map((seg) => ({
                id: seg.id,
                startSec: seg.startSec,
                endSec: seg.endSec,
            }));

            console.log(
                `[AudioImporter] Updated ${processedSegments.length} segments (from ${message.segments.length} input segments) for session ${message.sessionId}`
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
            webviewPanel: vscode.WebviewPanel
        ) => Promise<void>
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
            const pointersDir = vscode.Uri.joinPath(
                workspaceFolder.uri,
                ".project",
                "attachments",
                "pointers",
                docId
            );

            await vscode.workspace.fs.createDirectory(filesDir);
            await vscode.workspace.fs.createDirectory(pointersDir);

            const totalSegments = message.segmentMappings.length;
            let processedSegments = 0;
            const startTime = Date.now();

            webviewPanel.webview.postMessage({
                command: "audioImportProgress",
                sessionId: message.sessionId,
                stage: "extracting",
                message: `Extracting and saving ${totalSegments} audio segments...`,
                progress: 10,
                currentSegment: 0,
                totalSegments,
                etaSeconds: undefined,
            });

            const minUpdateIntervalMs = 100;
            let lastUpdateTime = Date.now();

            for (let i = 0; i < message.segmentMappings.length; i++) {
                const mapping = message.segmentMappings[i];
                const segment = session.segments.find((s) => s.id === mapping.segmentId);
                if (!segment) {
                    console.warn(`Segment ${mapping.segmentId} not found in session`);
                    continue;
                }

                const filesPath = path.join(filesDir.fsPath, mapping.fileName);
                const pointersPath = path.join(pointersDir.fsPath, mapping.fileName);

                const { extractSegment } = await import("../../../utils/audioProcessor");
                await extractSegment(session.filePath, filesPath, segment.startSec, segment.endSec);

                fs.copyFileSync(filesPath, pointersPath);

                processedSegments++;

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
                webviewPanel
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

export async function handleSelectAudioFile(
    message: SelectAudioFileMessage,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    return audioSplitter.handleSelectAudioFile(message, webviewPanel);
}

export async function handleReprocessAudioFile(
    message: ReprocessAudioFileMessage,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    return audioSplitter.handleReprocessAudioFile(message, webviewPanel);
}

export async function handleRequestAudioSegment(
    message: RequestAudioSegmentMessage,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    return audioSplitter.handleRequestAudioSegment(message, webviewPanel);
}

export async function handleUpdateAudioSegments(
    message: UpdateAudioSegmentsMessage,
    webviewPanel: vscode.WebviewPanel
): Promise<void> {
    return audioSplitter.handleUpdateAudioSegments(message, webviewPanel);
}

export async function handleFinalizeAudioImport(
    message: FinalizeAudioImportMessage,
    token: vscode.CancellationToken,
    webviewPanel: vscode.WebviewPanel,
    writeNotebooksHandler: (
        message: { command: string; notebookPairs: any[]; metadata: any },
        token: vscode.CancellationToken,
        webviewPanel: vscode.WebviewPanel
    ) => Promise<void>
): Promise<void> {
    return audioSplitter.handleFinalizeAudioImport(message, token, webviewPanel, writeNotebooksHandler);
}

