import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { MessageCircle, Copy, Loader2, Trash2, History, Mic } from "lucide-react";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import { AudioValidationBadge } from "./AudioValidationBadge.tsx";
import type { AudioValidationPopoverProps } from "./AudioValidationBadge.tsx";

interface AudioWaveformWithTranscriptionProps {
    audioUrl: string;
    audioBlob?: Blob | null;
    transcription?: {
        content: string;
        timestamp: number;
        language?: string;
    } | null;
    isTranscribing: boolean;
    transcriptionProgress: number;
    onTranscribe: () => void;
    onInsertTranscription: () => void;
    disabled?: boolean;
    onRequestRemove?: () => void;
    onShowHistory?: () => void;
    onShowRecorder?: () => void;
    audioValidationPopoverProps: AudioValidationPopoverProps;
    validationStatusProps: ValidationStatusIconProps;
    author?: string;
    targetDuration?: number | null; // Target duration (in seconds) derived from cell timestamps.
}

const AudioWaveformWithTranscription: React.FC<AudioWaveformWithTranscriptionProps> = ({
    audioUrl,
    audioBlob,
    transcription,
    isTranscribing,
    transcriptionProgress,
    onTranscribe,
    onInsertTranscription,
    disabled = false,
    onRequestRemove,
    onShowHistory,
    onShowRecorder,
    validationStatusProps,
    audioValidationPopoverProps,
    targetDuration,
    author,
}) => {
    const [audioSrc, setAudioSrc] = useState<string>("");
    const [audioDuration, setAudioDuration] = useState<number | null>(null);

    // Prefer the provided URL (can be blob: or data:). Fall back to creating an object URL from the blob.
    useEffect(() => {
        if (audioUrl) {
            setAudioSrc(audioUrl);
            return;
        }
        if (audioBlob) {
            const url = URL.createObjectURL(audioBlob);
            setAudioSrc(url);
            return () => URL.revokeObjectURL(url);
        }
        setAudioSrc("");
    }, [audioBlob, audioUrl]);


    // Decode the audio blob to get its actual duration (best-effort).
    // Only needed when a target duration is supplied so we can render the comparison bar.
    useEffect(() => {
        let cancelled = false;

        if (!targetDuration || !audioBlob) {
            setAudioDuration(null);
            return;
        }

        (async () => {
            try {
                const arrayBuffer = await audioBlob.arrayBuffer();
                if (cancelled) return;
                const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
                if (!AudioCtx) return;
                const audioCtx = new AudioCtx();
                try {
                    const decoded = await audioCtx.decodeAudioData(arrayBuffer.slice(0));
                    if (cancelled) return;
                    if (isFinite(decoded.duration) && decoded.duration > 0) {
                        setAudioDuration(decoded.duration);
                    } else {
                        setAudioDuration(null);
                    }
                } finally {
                    try {
                        audioCtx.close();
                    } catch {
                        void 0;
                    }
                }
            } catch {
                if (!cancelled) setAudioDuration(null);
            }
        })();

        return () => {
            cancelled = true;
        };
    }, [audioBlob, targetDuration]);


    return (
        <div className="bg-[var(--vscode-editor-background)] flex flex-col gap-y-3 p-3 sm:p-4 rounded-md shadow w-full relative">
            {/* Transcription Section */}
            <>
                {isTranscribing ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-[var(--vscode-button-background)]" />
                            <span className="text-sm text-[var(--vscode-foreground)]">
                                Transcribing... {Math.round(transcriptionProgress)}%
                            </span>
                        </div>
                        {transcriptionProgress > 0 && (
                            <div className="w-full bg-[var(--vscode-editor-background)] rounded-full h-2">
                                <div
                                    className="bg-[var(--vscode-button-background)] h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${transcriptionProgress}%` }}
                                />
                            </div>
                        )}
                    </div>
                ) : transcription ? (
                    <div className="space-y-3">
                        <div className="bg-[var(--vscode-editor-background)] p-4 rounded-lg border border-[var(--vscode-panel-border)]">
                            <p
                                className="text-sm leading-relaxed mb-2 italic"
                                style={{ color: "var(--vscode-disabledForeground)" }}
                            >
                                {transcription.content}
                            </p>
                            {transcription.language && (
                                <Badge variant="secondary" className="text-xs">
                                    {transcription.language}
                                </Badge>
                            )}
                        </div>
                        <Button
                            onClick={onInsertTranscription}
                            disabled={disabled}
                            className="w-full h-8 px-2 text-sm bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
                        >
                            <Copy className="mr-2 h-4 w-4" />
                            Insert Transcription
                        </Button>
                    </div>
                ) : null}
            </>

            {/* Waveform */}
            <div className="bg-[var(--vscode-editor-background)]">
                {audioSrc ? (
                    <CustomWaveformCanvas
                        audioUrl={audioSrc}
                        audioBlob={audioBlob || undefined}
                        height={48}
                        showControls={true}
                        showDebugInfo={false}
                        author={author}
                    />
                ) : (
                    <div className="flex items-center justify-center h-16 text-[var(--vscode-foreground)] text-sm">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading waveform...
                    </div>
                )}
            </div>

            {/* Validate badge overlay in the top-right corner of the card */}
            {validationStatusProps && (
                <div className="absolute -top-2 -right-2 z-50">
                    <AudioValidationBadge
                        validationStatusProps={validationStatusProps}
                        popoverProps={audioValidationPopoverProps}
                    />
                </div>
            )}

            {/* Timestamp length comparison bar (actual recorded audio vs. target from cell timestamps) */}
            {targetDuration &&
                targetDuration > 0 &&
                (() => {
                    const actual = audioDuration && audioDuration > 0 ? audioDuration : 0;
                    const rawPercentage = actual > 0 ? (actual / targetDuration) * 100 : 0;
                    const progressPercentage = Math.min(100, rawPercentage);
                    const shouldStopFilling = rawPercentage >= 100;
                    const barColor =
                        rawPercentage <= 90
                            ? "rgb(34, 197, 94)" // green-500
                            : rawPercentage <= 100
                            ? "rgb(234, 179, 8)" // yellow-500
                            : "rgb(239, 68, 68)"; // red-500

                    return (
                        <div className="w-full space-y-2 px-2">
                            <div className="relative w-full h-3 bg-blue-200/60 rounded-full overflow-hidden">
                                <div
                                    className="h-full rounded-full transition-all duration-100"
                                    style={{
                                        width: `${shouldStopFilling ? 100 : progressPercentage}%`,
                                        backgroundColor: barColor,
                                    }}
                                />
                            </div>
                            <div className="flex justify-between text-xs text-muted-foreground">
                                <span>
                                    {audioDuration !== null ? `${actual.toFixed(2)}s` : "—"}
                                </span>
                                <span>Timestamp Length</span>
                                <span>{targetDuration.toFixed(2)}s</span>
                            </div>
                        </div>
                    );
                })()}

            {/* Action buttons at bottom */}
            <div className="flex flex-wrap items-center justify-center gap-2 px-2">
                {!transcription && !isTranscribing && (
                    <Button
                        onClick={onTranscribe}
                        disabled={disabled || (!audioUrl && !audioBlob)}
                        variant="outline"
                        className="h-8 px-2 text-xs text-[var(--vscode-button-background)] border-[var(--vscode-button-background)]/20 hover:bg-[var(--vscode-button-background)]/10"
                        title="Transcribe Audio"
                    >
                        <MessageCircle className="h-3 w-3" />
                        <span className="ml-1">Transcribe</span>
                    </Button>
                )}
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => onRequestRemove?.()}
                    title="Delete Audio"
                >
                    <Trash2 className="h-3 w-3" />
                    <span className="ml-1">Delete</span>
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => onShowHistory?.()}
                    title="Audio History"
                >
                    <History className="h-3 w-3" />
                    <span className="ml-1">History</span>
                </Button>
                <Button
                    variant="outline"
                    size="sm"
                    className="h-8 px-2 text-xs"
                    onClick={() => onShowRecorder?.()}
                    title="Re-record / Upload New"
                >
                    <Mic className="h-3 w-3" />
                    <span className="ml-1">Re-record</span>
                </Button>
            </div>
        </div>
    );
};

export default AudioWaveformWithTranscription;
