import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FilePlus2, Loader2, Save, Scissors, Undo2, X, ZoomIn, ZoomOut } from "lucide-react";
import type { EditorPostMessages } from "../../../../../types";
import { Button } from "../../components/ui/button";
import { useMessageHandler } from "../hooks/useCentralizedMessageDispatcher";
import { AudioPointerTimeControl } from "./AudioPointerTimeControl";
import { audioFileExtension, blobToDataUrl, decodeAudioDuration } from "./audioFileUtils";
import {
    MIN_AUDIO_CLIP_DURATION_SEC,
    PRIMARY_AUDIO_INPUT_ID,
    createAudioEditorClip,
    deleteAudioTimelineRange,
    getAudioEditorDuration,
    insertAudioClipsAtTimelinePosition,
    keepAudioTimelineRange,
    type AudioEditorDraft,
} from "./audioEditModel";
import {
    formatAudioEditTime,
    normalizeAudioTrimRange,
    updateAudioTrimEnd,
    updateAudioTrimStart,
    type AudioTrimRange,
} from "./audioTrimMath";
import { renderAudioClipsInBrowser } from "./browserAudioRenderer";
import { SimpleAudioTimeline } from "./SimpleAudioTimeline";
import { useAudioEditHistory } from "./useAudioEditHistory";

type SimpleEditMode = "delete" | "insert" | "keep";

interface SimpleAudioEditorPanelProps {
    cellId: string;
    sourceAudioId: string;
    audioUrl: string;
    audioBlob: Blob;
    onClose: () => void;
    onSaved?: (audioId: string) => void;
}

const makeId = (prefix: string): string =>
    `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

function createInitialDraft(audioBlob: Blob, audioUrl: string): AudioEditorDraft {
    return {
        clips: [createAudioEditorClip({
            inputId: PRIMARY_AUDIO_INPUT_ID,
            label: "Original audio",
            audioBlob,
            audioUrl,
            fileExtension: "source",
            durationSec: 0,
            isPrimary: true,
        })],
    };
}

/**
 * Focused editor for three operations: delete a range, keep a range, or insert
 * one audio file. Rendering stays in the webview and saving uses the existing
 * saveAudioAttachment message so the original attachment remains unchanged.
 */
export function SimpleAudioEditorPanel({
    cellId,
    sourceAudioId,
    audioUrl,
    audioBlob,
    onClose,
    onSaved,
}: SimpleAudioEditorPanelProps) {
    const initialDraft = useMemo(
        () => createInitialDraft(audioBlob, audioUrl),
        [audioBlob, audioUrl]
    );
    const { value: draft, commit, replace, reset, undo, canUndo } = useAudioEditHistory(initialDraft);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const ownedUrlsRef = useRef<Set<string>>(new Set());
    const [mode, setMode] = useState<SimpleEditMode>("delete");
    const [range, setRange] = useState<AudioTrimRange>({ startSec: 0, endSec: 0 });
    const [insertTimeSec, setInsertTimeSec] = useState(0);
    const [zoom, setZoom] = useState(1);
    const [pendingRequestId, setPendingRequestId] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);
    const durationSec = getAudioEditorDuration(draft.clips);
    const disabled = pendingRequestId !== null;
    const rangeDurationSec = Math.max(0, range.endSec - range.startSec);
    // Delete mode may use a zero-width selection; Keep mode must remain playable.
    const minimumPointerGapSec = mode === "delete" ? 0 : MIN_AUDIO_CLIP_DURATION_SEC;

    // A new source attachment starts a fresh, full-length editing session.
    useEffect(() => {
        reset(initialDraft);
        setMode("delete");
        setRange({ startSec: 0, endSec: 0 });
        setInsertTimeSec(0);
        setError(null);
    }, [initialDraft, reset, sourceAudioId]);

    // Object URLs must remain alive for undo, then are released when the panel closes.
    useEffect(() => {
        const ownedUrls = ownedUrlsRef.current;
        return () => {
            ownedUrls.forEach((url) => URL.revokeObjectURL(url));
            ownedUrls.clear();
        };
    }, []);

    // Keep pointers valid whenever an insert, delete, keep, or undo changes duration.
    useEffect(() => {
        if (durationSec <= 0) return;
        setRange((current) => normalizeAudioTrimRange([
            Math.min(current.startSec, durationSec),
            Math.min(current.endSec > 0 ? current.endSec : durationSec, durationSec),
        ], durationSec, minimumPointerGapSec));
        setInsertTimeSec((current) => Math.min(durationSec, Math.max(0, current)));
    }, [durationSec, minimumPointerGapSec]);

    useMessageHandler(
        `simple-audio-editor-${cellId}-${sourceAudioId}`,
        (event: MessageEvent) => {
            const message = event.data;
            if (
                message?.type !== "audioAttachmentSaved" ||
                message.content?.cellId !== cellId ||
                !pendingRequestId ||
                message.content?.requestId !== pendingRequestId
            ) return;
            setPendingRequestId(null);
            if (message.content.success) onSaved?.(message.content.audioId);
            else setError(message.content.error || "Could not save the edited audio.");
        },
        [cellId, onSaved, pendingRequestId, sourceAudioId]
    );

    const handleInputDuration = useCallback((inputId: string, decodedDuration: number) => {
        if (!Number.isFinite(decodedDuration) || decodedDuration <= 0) return;
        replace((current) => ({
            ...current,
            clips: current.clips.map((clip) =>
                clip.inputId === inputId && clip.sourceDurationSec <= 0
                    ? { ...clip, sourceDurationSec: decodedDuration, endSec: decodedDuration }
                    : clip
            ),
        }));
    }, [replace]);

    const switchMode = (nextMode: SimpleEditMode) => {
        setMode(nextMode);
        // Expand a collapsed Delete selection before entering Keep mode.
        if (nextMode !== "delete") {
            setRange((current) => normalizeAudioTrimRange(
                [current.startSec, current.endSec],
                durationSec
            ));
        }
        setError(null);
    };

    const deleteRange = () => {
        const nextClips = deleteAudioTimelineRange(draft.clips, range);
        const nextDuration = getAudioEditorDuration(nextClips);
        if (nextDuration <= 0) {
            setError("You cannot delete the entire recording. Move the pointers closer together.");
            return;
        }
        commit({ ...draft, clips: nextClips });
        setRange({ startSec: 0, endSec: nextDuration });
        setInsertTimeSec(Math.min(range.startSec, nextDuration));
        setError(null);
    };

    const keepRange = () => {
        const nextClips = keepAudioTimelineRange(draft.clips, range);
        const nextDuration = getAudioEditorDuration(nextClips);
        if (nextDuration < MIN_AUDIO_CLIP_DURATION_SEC) {
            setError("Keep at least 0.10 seconds between the two pointers.");
            return;
        }
        commit({ ...draft, clips: nextClips });
        setRange({ startSec: 0, endSec: nextDuration });
        setInsertTimeSec(0);
        setError(null);
    };

    const insertAudioFile = async (file: File) => {
        try {
            if (file.size > 50 * 1024 * 1024) throw new Error("The inserted audio must be 50 MB or smaller.");
            const insertedDuration = await decodeAudioDuration(file);
            const url = URL.createObjectURL(file);
            ownedUrlsRef.current.add(url);
            const clip = createAudioEditorClip({
                inputId: makeId("inserted"),
                label: file.name,
                audioBlob: file,
                audioUrl: url,
                fileExtension: audioFileExtension(file.name, file.type),
                durationSec: insertedDuration,
            });
            const nextClips = insertAudioClipsAtTimelinePosition(
                draft.clips,
                [clip],
                insertTimeSec
            );
            commit({ ...draft, clips: nextClips });
            setInsertTimeSec(insertTimeSec + insertedDuration);
            setError(null);
        } catch (insertError) {
            setError(insertError instanceof Error ? insertError.message : "Could not insert this audio file.");
        }
    };

    const saveNewVersion = async () => {
        const requestId = makeId("browser-audio-edit-request");
        setPendingRequestId(requestId);
        setError(null);
        try {
            const rendered = await renderAudioClipsInBrowser(draft.clips);
            const outputAudioId = makeId("audio-edit");
            const dataUrl = await blobToDataUrl(new Blob([rendered.bytes], { type: "audio/wav" }));
            const audioData = dataUrl.split(",")[1] ?? "";
            // Reuse the provider's normal attachment save path; no FFmpeg command is sent.
            window.vscodeApi.postMessage({
                command: "saveAudioAttachment",
                requestId,
                content: {
                    cellId,
                    audioId: outputAudioId,
                    audioData,
                    fileExtension: "wav",
                    metadata: {
                        mimeType: "audio/wav",
                        sizeBytes: rendered.bytes.length,
                        sampleRate: rendered.sampleRate,
                        channels: rendered.channels,
                        bitrateKbps: rendered.bitrateKbps,
                        durationSec: rendered.durationSec,
                        derivedFromAudioId: sourceAudioId,
                        editOperation: "timeline",
                        clipCount: draft.clips.length,
                    },
                },
            } as EditorPostMessages);
        } catch (saveError) {
            setPendingRequestId(null);
            setError(saveError instanceof Error ? saveError.message : "Could not generate the edited audio.");
        }
    };

    const rangeMode = mode !== "insert";
    return (
        <section className="mt-3 space-y-3 rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)] p-3 sm:p-4">
            <div className="flex items-start justify-between gap-3">
                <div>
                    <div className="flex items-center gap-2 text-sm font-semibold"><Scissors className="h-4 w-4" />Audio Editor</div>
                    <p className="mt-1 text-xs text-muted-foreground">Choose an action, then drag the pointers on the waveform.</p>
                </div>
                <Button variant="ghost" size="icon" className="h-7 w-7" disabled={disabled} onClick={onClose}><X className="h-4 w-4" /></Button>
            </div>

            <div className="flex flex-wrap items-center gap-2">
                <Button variant={mode === "delete" ? "destructive" : "outline"} size="sm" onClick={() => switchMode("delete")}>Delete range</Button>
                <Button variant={mode === "insert" ? "default" : "outline"} size="sm" onClick={() => switchMode("insert")}>Insert audio</Button>
                <Button variant={mode === "keep" ? "default" : "outline"} size="sm" onClick={() => switchMode("keep")}>Keep range</Button>
                <Button variant="outline" size="icon" className="h-8 w-8" disabled={!canUndo || disabled} onClick={() => { undo(); setError(null); }} title="Undo last edit"><Undo2 className="h-4 w-4" /></Button>
                <div className="ml-auto flex items-center gap-1 text-xs text-muted-foreground">
                    <span>Waveform</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.max(.75, value / 1.25))} title="Zoom out"><ZoomOut className="h-4 w-4" /></Button>
                    <span className="w-10 text-center font-mono">{Math.round(zoom * 100)}%</span>
                    <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => setZoom((value) => Math.min(8, value * 1.25))} title="Zoom in"><ZoomIn className="h-4 w-4" /></Button>
                </div>
            </div>

            <SimpleAudioTimeline
                clips={draft.clips}
                mode={rangeMode ? "range" : "insert"}
                range={range}
                insertTimeSec={insertTimeSec}
                zoom={zoom}
                minimumRangeSec={minimumPointerGapSec}
                disabled={disabled}
                onRangeChange={(nextRange) => setRange(normalizeAudioTrimRange(
                    [nextRange.startSec, nextRange.endSec],
                    durationSec,
                    minimumPointerGapSec
                ))}
                onInsertTimeChange={(timeSec) => setInsertTimeSec(Math.min(durationSec, Math.max(0, timeSec)))}
                onZoomChange={setZoom}
                onInputDuration={handleInputDuration}
            />

            {rangeMode ? (
                <div className="grid gap-2 sm:grid-cols-2">
                    <AudioPointerTimeControl
                        label="Start pointer"
                        valueSec={range.startSec}
                        minSec={0}
                        maxSec={Math.max(0, range.endSec - minimumPointerGapSec)}
                        colorClass="text-sky-600 dark:text-sky-400"
                        disabled={disabled}
                        onChange={(value) => setRange(updateAudioTrimStart(
                            value,
                            range.endSec,
                            durationSec,
                            minimumPointerGapSec
                        ))}
                    />
                    <AudioPointerTimeControl
                        label="End pointer"
                        valueSec={range.endSec}
                        minSec={Math.min(durationSec, range.startSec + minimumPointerGapSec)}
                        maxSec={durationSec}
                        colorClass="text-blue-700 dark:text-blue-400"
                        disabled={disabled}
                        onChange={(value) => setRange(updateAudioTrimEnd(
                            value,
                            range.startSec,
                            durationSec,
                            minimumPointerGapSec
                        ))}
                    />
                </div>
            ) : (
                <AudioPointerTimeControl
                    label="Insert pointer"
                    valueSec={insertTimeSec}
                    minSec={0}
                    maxSec={durationSec}
                    colorClass="text-orange-600 dark:text-orange-400"
                    disabled={disabled}
                    onChange={(value) => setInsertTimeSec(Math.min(durationSec, Math.max(0, value)))}
                />
            )}

            <div className="flex items-center justify-between gap-2 rounded-md border border-[var(--vscode-panel-border)] bg-muted/20 p-2.5">
                <span className="text-xs text-muted-foreground">
                    {rangeMode
                        ? `Selected ${formatAudioEditTime(rangeDurationSec)}`
                        : `Insert at ${formatAudioEditTime(insertTimeSec)}`}
                </span>
                <div className="flex shrink-0 items-center gap-2">
                    {/* Delete accepts any positive-width selection; equal pointers contain no audio. */}
                    {mode === "delete" && <Button variant="destructive" size="sm" disabled={disabled || rangeDurationSec <= 0} onClick={deleteRange}>Delete selected audio</Button>}
                    {mode === "keep" && <Button size="sm" disabled={disabled || rangeDurationSec < MIN_AUDIO_CLIP_DURATION_SEC} onClick={keepRange}>Keep selected audio</Button>}
                    {mode === "insert" && <Button size="sm" disabled={disabled} onClick={() => fileInputRef.current?.click()}><FilePlus2 className="mr-2 h-4 w-4" />Choose audio to insert</Button>}
                    <Button size="sm" disabled={disabled || durationSec <= 0} onClick={() => void saveNewVersion()}>
                        {disabled ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                        {disabled ? "Generating..." : "Save as new version"}
                    </Button>
                </div>
                <input ref={fileInputRef} type="file" accept="audio/*" className="hidden" onChange={(event) => {
                    const file = event.target.files?.[0];
                    event.target.value = "";
                    if (file) void insertAudioFile(file);
                }} />
            </div>

            {error && <div className="rounded border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</div>}
        </section>
    );
}
