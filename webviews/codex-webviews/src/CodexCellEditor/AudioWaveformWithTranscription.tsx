import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import {
    DropdownMenu,
    DropdownMenuCheckboxItem,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import {
    MessageCircle,
    Copy,
    Loader2,
    Trash2,
    History,
    Mic,
    ChevronDown,
} from "lucide-react";
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
    targetDurationSeconds?: number | null;
    audioDurationSeconds?: number | null;
    targetDuration?: number | null; // Target duration (in seconds) derived from cell timestamps.
    // ASR language hint shown next to the Transcribe button and toggleable
    // between the project language and server-side auto-detect (LID).
    asrLanguageName?: string; // friendly name of the project's language (e.g. "Swahili"). Falls back to "Auto Detect".
    asrLanguageMode?: "project" | "auto";
    onChangeAsrLanguageMode?: (mode: "project" | "auto") => void;
    // Persistent ASR preferences exposed via the Transcribe-row gear popover.
    asrPhonetic?: boolean;
    onChangeAsrPhonetic?: (enabled: boolean) => void;
    /** Total number of audio recordings for the cell (including soft-deleted). When > 0, a count badge is rendered on the History button. */
    historyCount?: number;
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
    targetDurationSeconds,
    audioDurationSeconds,
    targetDuration,
    author,
    asrLanguageName,
    asrLanguageMode = "project",
    onChangeAsrLanguageMode,
    asrPhonetic = false,
    onChangeAsrPhonetic,
    historyCount,
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
                            {(() => {
                                // `language` is the friendly display name (e.g. "English") resolved from
                                // the project's source/target language at transcription time. Treat empty/
                                // missing values and the legacy "unknown" sentinel as no-known-language so
                                // the user can tell the transcription happened without a language hint.
                                const lang = transcription.language?.trim();
                                const hasKnownLanguage = !!lang && lang.toLowerCase() !== "unknown";
                                return (
                                    <Badge
                                        variant="secondary"
                                        className={hasKnownLanguage ? "text-xs" : "text-[10px]"}
                                    >
                                        {hasKnownLanguage ? lang : "Transcription Language Unknown"}
                                    </Badge>
                                );
                            })()}
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
            <div>
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

            {/* Target duration bar (e.g. subtitle cells): audio length vs allotted timestamp length */}
            {targetDurationSeconds != null &&
                targetDurationSeconds > 0 &&
                audioDurationSeconds != null &&
                audioDurationSeconds >= 0 && (
                    <div className="w-full space-y-2">
                        <div className="relative w-full h-3 bg-blue-200/60 rounded-full overflow-hidden">
                            <div
                                className="h-full rounded-full transition-all duration-100"
                                style={{
                                    width: `${Math.min(
                                        100,
                                        (audioDurationSeconds / targetDurationSeconds) * 100
                                    )}%`,
                                    backgroundColor:
                                        audioDurationSeconds > targetDurationSeconds
                                            ? "rgb(239, 68, 68)" // red: over allotted
                                            : (audioDurationSeconds / targetDurationSeconds) *
                                                  100 >=
                                              90
                                            ? "rgb(34, 197, 94)" // green: within 90%+
                                            : "rgb(234, 179, 8)", // yellow: under 90%
                                }}
                            />
                        </div>
                        <div className="flex justify-between text-xs text-muted-foreground">
                            <span>{audioDurationSeconds.toFixed(3)}s</span>
                            <span>Timestamp Length</span>
                            <span>{targetDurationSeconds.toFixed(3)}s</span>
                        </div>
                    </div>
                )}

            {/* Action buttons at bottom */}
            <div className="flex flex-wrap items-center justify-center gap-2 px-2">
                {!isTranscribing && (() => {
                    const transcribeDisabled = disabled || (!audioUrl && !audioBlob);
                    const isAuto = asrLanguageMode === "auto";
                    // The label shows what will actually happen on click — the
                    // resolved project language name, or "Auto Detect" when
                    // either the user opted into auto-detect or we couldn't
                    // resolve a project language to send.
                    const effectiveLabel =
                        !isAuto && asrLanguageName ? asrLanguageName : "Auto Detect";
                    // Once a transcription exists, the same control becomes a
                    // "Re-transcribe" affordance — same flow, just relabeled so
                    // users know they're about to overwrite the saved result.
                    const hasExistingTranscription = !!transcription;
                    const transcribeButtonLabel = hasExistingTranscription
                        ? "Re-transcribe"
                        : "Transcribe";
                    const transcribeTitle = hasExistingTranscription
                        ? `Re-transcribe Audio (${effectiveLabel})`
                        : `Transcribe Audio (${effectiveLabel})`;
                    const sharedBtnClass =
                        "h-8 px-2 text-xs text-[var(--vscode-button-background)] border-[var(--vscode-button-background)]/20 hover:bg-[var(--vscode-button-background)]/10";
                    return (
                        <div className="inline-flex items-stretch">
                            <Button
                                onClick={onTranscribe}
                                disabled={transcribeDisabled}
                                variant="outline"
                                className={`${sharedBtnClass} rounded-r-none border-r-0`}
                                title={transcribeTitle}
                            >
                                <MessageCircle className="h-3 w-3" />
                                <span className="ml-1">{transcribeButtonLabel}</span>
                            </Button>
                            <DropdownMenu>
                                <DropdownMenuTrigger asChild>
                                    <Button
                                        type="button"
                                        variant="outline"
                                        disabled={transcribeDisabled}
                                        className={`${sharedBtnClass} rounded-l-none px-1.5`}
                                        title={`Language: ${effectiveLabel}. Click to change.`}
                                        aria-label={`Change transcription language. Current: ${effectiveLabel}`}
                                    >
                                        <ChevronDown className="h-3 w-3 opacity-70" />
                                    </Button>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="end" className="min-w-[12rem]">
                                    <DropdownMenuLabel>Transcription language</DropdownMenuLabel>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuRadioGroup
                                        value={
                                            !asrLanguageName
                                                ? "auto"
                                                : asrLanguageMode
                                        }
                                        onValueChange={(v) =>
                                            onChangeAsrLanguageMode?.(
                                                v === "auto" ? "auto" : "project"
                                            )
                                        }
                                    >
                                        <DropdownMenuRadioItem
                                            value="project"
                                            disabled={!asrLanguageName}
                                        >
                                            {asrLanguageName || "Project language (unset)"}
                                        </DropdownMenuRadioItem>
                                        <DropdownMenuRadioItem value="auto">
                                            Auto Detect
                                        </DropdownMenuRadioItem>
                                    </DropdownMenuRadioGroup>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuCheckboxItem
                                        checked={!!asrPhonetic}
                                        onCheckedChange={(checked) =>
                                            onChangeAsrPhonetic?.(!!checked)
                                        }
                                        // Keep the menu open so users can flip multiple
                                        // settings before dismissing.
                                        onSelect={(e) => e.preventDefault()}
                                    >
                                        Include phonetic (IPA)
                                    </DropdownMenuCheckboxItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    );
                })()}
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
                    {typeof historyCount === "number" && historyCount > 0 && (
                        <Badge
                            variant="secondary"
                            className="ml-1 justify-center leading-none"
                            style={{
                                minWidth: "1.5em",
                                height: "1.5em",
                                padding: "0 0.35em",
                                fontSize: "0.85em",
                                fontWeight: 700,
                                backgroundColor: "var(--vscode-badge-background)",
                                color: "var(--vscode-badge-foreground)",
                            }}
                            aria-label={`${historyCount} audio recording${historyCount === 1 ? "" : "s"} in history`}
                        >
                            {historyCount}
                        </Badge>
                    )}
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
