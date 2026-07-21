import React, { useEffect, useMemo, useRef, useState } from "react";
import { decodeAudio, generatePeaks } from "../../utils/audioProcessing";
import { getAudioEditorDuration, type AudioEditorClip } from "./audioEditModel";
import { formatAudioEditTime, type AudioTrimRange } from "./audioTrimMath";

type PointerMode = "range" | "insert";
type DragTarget = "start" | "end" | "insert";

interface SimpleAudioTimelineProps {
    clips: AudioEditorClip[];
    mode: PointerMode;
    range: AudioTrimRange;
    insertTimeSec: number;
    zoom: number;
    minimumRangeSec: number;
    disabled?: boolean;
    onRangeChange: (range: AudioTrimRange) => void;
    onInsertTimeChange: (timeSec: number) => void;
    onZoomChange: (zoom: number) => void;
    onInputDuration: (inputId: string, durationSec: number) => void;
}

const HEIGHT = 198;
const TRACK_TOP = 38;
const TRACK_HEIGHT = 148;
const BASE_PIXELS_PER_SECOND = 82;
function tickInterval(pixelsPerSecond: number): number {
    const minimum = 75 / Math.max(1, pixelsPerSecond);
    return [0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60].find((value) => value >= minimum) ?? 120;
}

function drawMarker(
    context: CanvasRenderingContext2D,
    x: number,
    canvasWidth: number,
    color: string,
    label: string,
    align: "left" | "right"
): void {
    context.strokeStyle = color;
    context.lineWidth = 2;
    context.beginPath();
    context.moveTo(x, 28);
    context.lineTo(x, TRACK_TOP + TRACK_HEIGHT);
    context.stroke();
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(x - 6, 28);
    context.lineTo(x + 6, 28);
    context.lineTo(x, 36);
    context.closePath();
    context.fill();

    context.font = "600 11px sans-serif";
    const width = context.measureText(label).width + 12;
    const preferredX = align === "left" ? x + 5 : x - width - 5;
    const labelX = Math.max(2, Math.min(canvasWidth - width - 2, preferredX));
    context.fillRect(labelX, 3, width, 21);
    context.fillStyle = "white";
    context.textBaseline = "middle";
    context.fillText(label, labelX + 6, 13.5);
}

/**
 * Canvas timeline that draws waveform peaks and either two range pointers or
 * one insert pointer. Pointer edits use global timeline seconds, not source time.
 */
export function SimpleAudioTimeline({
    clips,
    mode,
    range,
    insertTimeSec,
    zoom,
    minimumRangeSec,
    disabled = false,
    onRangeChange,
    onInsertTimeChange,
    onZoomChange,
    onInputDuration,
}: SimpleAudioTimelineProps) {
    const viewportRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const dragTargetRef = useRef<DragTarget | null>(null);
    const zoomAnchorRef = useRef<{ timeSec: number; viewportX: number } | null>(null);
    const onInputDurationRef = useRef(onInputDuration);
    const wheelStateRef = useRef({ disabled, onZoomChange, pixelsPerSecond: 1, zoom });
    const [viewportWidth, setViewportWidth] = useState(640);
    const [peaksByInput, setPeaksByInput] = useState<Map<string, number[]>>(new Map());
    const durationSec = getAudioEditorDuration(clips);
    const pixelsPerSecond = BASE_PIXELS_PER_SECOND * Math.min(8, Math.max(0.75, zoom));
    const canvasWidth = Math.min(30000, Math.max(viewportWidth - 2, durationSec * pixelsPerSecond));
    onInputDurationRef.current = onInputDuration;
    wheelStateRef.current = { disabled, onZoomChange, pixelsPerSecond, zoom };

    // Split clips can share a Blob, so waveform decoding is keyed by input ID.
    const uniqueInputs = useMemo(() => {
        const inputs = new Map<string, Blob>();
        clips.forEach((clip) => inputs.set(clip.inputId, clip.audioBlob));
        return [...inputs.entries()];
    }, [clips]);
    const inputSignature = uniqueInputs
        .map(([inputId, blob]) => `${inputId}:${blob.size}:${blob.type}`)
        .join("|");

    // Track the visible width so short recordings still fill the editor panel.
    useEffect(() => {
        const viewport = viewportRef.current;
        if (!viewport) return;
        const update = () => setViewportWidth(Math.max(320, viewport.clientWidth));
        update();
        const observer = new ResizeObserver(update);
        observer.observe(viewport);
        return () => observer.disconnect();
    }, []);

    // Keep Ctrl+wheel zoom centered on the time currently under the mouse.
    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const handleWheel = (event: WheelEvent) => {
            const state = wheelStateRef.current;
            if (!event.ctrlKey || state.disabled) return;
            event.preventDefault();
            const viewport = viewportRef.current;
            if (viewport) {
                const rect = viewport.getBoundingClientRect();
                const viewportX = event.clientX - rect.left;
                zoomAnchorRef.current = {
                    timeSec: (viewport.scrollLeft + viewportX) / state.pixelsPerSecond,
                    viewportX,
                };
            }
            const factor = event.deltaY > 0 ? 0.9 : 1.1;
            state.onZoomChange(Math.min(8, Math.max(0.75, state.zoom * factor)));
        };
        // A non-passive listener prevents the surrounding webview from zooming.
        canvas.addEventListener("wheel", handleWheel, { passive: false });
        return () => canvas.removeEventListener("wheel", handleWheel);
    }, []);

    // Reapply the mouse-time anchor after React has rendered the new canvas width.
    useEffect(() => {
        const viewport = viewportRef.current;
        const anchor = zoomAnchorRef.current;
        if (!viewport || !anchor) return;
        viewport.scrollLeft = Math.max(0, anchor.timeSec * pixelsPerSecond - anchor.viewportX);
        zoomAnchorRef.current = null;
    }, [pixelsPerSecond]);

    // Decode waveform peaks only when the underlying source inputs change.
    useEffect(() => {
        let cancelled = false;
        void Promise.all(uniqueInputs.map(async ([inputId, blob]) => {
            const bytes = await blob.arrayBuffer();
            const buffer = await decodeAudio(bytes.slice(0));
            onInputDurationRef.current(inputId, buffer.duration);
            const raw = generatePeaks(buffer, 2400);
            const maximum = Math.max(0.01, ...raw);
            return [inputId, raw.map((peak) => peak / maximum)] as const;
        })).then((entries) => {
            if (!cancelled) setPeaksByInput(new Map(entries));
        }).catch((error) => {
            console.warn("[SimpleAudioTimeline] Unable to decode waveform:", error);
        });
        return () => { cancelled = true; };
        // The signature changes only when an underlying audio input changes.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [inputSignature]);

    // Redraw scale, waveform, selection shading, and pointer labels as one canvas.
    useEffect(() => {
        const canvas = canvasRef.current;
        const context = canvas?.getContext("2d");
        if (!canvas || !context) return;
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.max(1, Math.floor(canvasWidth * dpr));
        canvas.height = Math.floor(HEIGHT * dpr);
        context.setTransform(dpr, 0, 0, dpr, 0, 0);
        context.clearRect(0, 0, canvasWidth, HEIGHT);

        context.fillStyle = "rgba(127,127,127,.06)";
        context.fillRect(0, TRACK_TOP, canvasWidth, TRACK_HEIGHT);
        const interval = tickInterval(pixelsPerSecond);
        context.font = "10px sans-serif";
        context.textBaseline = "top";
        for (let second = 0; second <= durationSec; second += interval) {
            const x = second * pixelsPerSecond;
            context.strokeStyle = "rgba(127,127,127,.22)";
            context.beginPath();
            context.moveTo(x, TRACK_TOP);
            context.lineTo(x, TRACK_TOP + TRACK_HEIGHT);
            context.stroke();
            context.fillStyle = "rgba(127,127,127,.85)";
            context.fillText(formatAudioEditTime(second), x + 3, TRACK_TOP + 3);
        }

        let globalStart = 0;
        clips.forEach((clip) => {
            const clipDuration = Math.max(0, clip.endSec - clip.startSec);
            const clipX = globalStart * pixelsPerSecond;
            const clipWidth = Math.max(1, clipDuration * pixelsPerSecond);
            const peaks = peaksByInput.get(clip.inputId) ?? [];
            const bars = Math.max(1, Math.floor(clipWidth / 2));
            for (let bar = 0; bar < bars; bar++) {
                const ratio = bar / bars;
                const sourceTime = clip.startSec + ratio * clipDuration;
                const peakIndex = Math.min(
                    peaks.length - 1,
                    Math.max(0, Math.floor(sourceTime / Math.max(clip.sourceDurationSec, .001) * peaks.length))
                );
                const barHeight = Math.max(2, (peaks[peakIndex] ?? 0) * (TRACK_HEIGHT - 30));
                context.fillStyle = "rgba(37,99,235,.9)";
                context.fillRect(
                    clipX + ratio * clipWidth,
                    TRACK_TOP + (TRACK_HEIGHT - barHeight) / 2,
                    1.25,
                    barHeight
                );
            }
            globalStart += clipDuration;
        });

        if (mode === "range") {
            const startX = range.startSec * pixelsPerSecond;
            const endX = range.endSec * pixelsPerSecond;
            context.fillStyle = "rgba(59,130,246,.15)";
            context.fillRect(startX, TRACK_TOP, Math.max(0, endX - startX), TRACK_HEIGHT);
            context.fillStyle = "rgba(15,23,42,.14)";
            context.fillRect(0, TRACK_TOP, startX, TRACK_HEIGHT);
            context.fillRect(endX, TRACK_TOP, Math.max(0, canvasWidth - endX), TRACK_HEIGHT);
            drawMarker(context, startX, canvasWidth, "#0284c7", `Start ${formatAudioEditTime(range.startSec)}`, "left");
            drawMarker(context, endX, canvasWidth, "#2563eb", `End ${formatAudioEditTime(range.endSec)}`, "right");
        } else {
            const insertX = insertTimeSec * pixelsPerSecond;
            drawMarker(context, insertX, canvasWidth, "#ea580c", `Insert ${formatAudioEditTime(insertTimeSec)}`, "left");
        }
    }, [canvasWidth, clips, durationSec, insertTimeSec, mode, peaksByInput, pixelsPerSecond, range]);

    const pointerTime = (event: React.PointerEvent<HTMLCanvasElement>) => {
        const rect = event.currentTarget.getBoundingClientRect();
        return Math.min(durationSec, Math.max(0, (event.clientX - rect.left) / pixelsPerSecond));
    };

    const updatePointer = (target: DragTarget, timeSec: number) => {
        if (target === "insert") {
            onInsertTimeChange(timeSec);
        } else if (target === "start") {
            onRangeChange({
                startSec: Math.min(timeSec, Math.max(0, range.endSec - minimumRangeSec)),
                endSec: range.endSec,
            });
        } else {
            onRangeChange({
                startSec: range.startSec,
                endSec: Math.max(timeSec, Math.min(durationSec, range.startSec + minimumRangeSec)),
            });
        }
    };

    return (
        <div className="space-y-1.5">
            <div ref={viewportRef} className="w-full overflow-x-auto rounded-md border border-[var(--vscode-panel-border)] bg-[var(--vscode-editor-background)]">
                <canvas
                    ref={canvasRef}
                    className={`block select-none ${disabled ? "cursor-not-allowed opacity-60" : "cursor-ew-resize"}`}
                    style={{ width: canvasWidth, height: HEIGHT, touchAction: "none" }}
                    aria-label={mode === "range" ? "Drag the start and end pointers to select an audio range" : "Drag the insert pointer to choose an insertion position"}
                    onPointerDown={(event) => {
                        if (disabled || durationSec <= 0) return;
                        const timeSec = pointerTime(event);
                        let target: DragTarget = "insert";
                        if (mode === "range") {
                            // Clicking the waveform moves whichever range pointer is closer.
                            target = Math.abs(timeSec - range.startSec) <= Math.abs(timeSec - range.endSec)
                                ? "start"
                                : "end";
                        }
                        dragTargetRef.current = target;
                        event.currentTarget.setPointerCapture(event.pointerId);
                        updatePointer(target, timeSec);
                    }}
                    onPointerMove={(event) => {
                        if (!dragTargetRef.current || disabled) return;
                        updatePointer(dragTargetRef.current, pointerTime(event));
                    }}
                    onPointerUp={(event) => {
                        dragTargetRef.current = null;
                        event.currentTarget.releasePointerCapture(event.pointerId);
                    }}
                />
            </div>
            <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
                <span>{mode === "range" ? "Drag the blue pointers or click the waveform · Ctrl + mouse wheel to zoom" : "Drag the orange pointer or click the waveform · Ctrl + mouse wheel to zoom"}</span>
                <span className="font-mono">Total {formatAudioEditTime(durationSec)}</span>
            </div>
        </div>
    );
}
