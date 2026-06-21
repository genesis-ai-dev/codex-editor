import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { MessageCircle, Copy, Loader2, Trash2, History, Mic, Settings as SettingsIcon } from "lucide-react";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import { AudioValidationBadge } from "./AudioValidationBadge.tsx";
import type { AudioValidationPopoverProps } from "./AudioValidationBadge.tsx";
import {
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "../components/ui/popover";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import { Input } from "../components/ui/input";

interface AudioWaveformWithTranscriptionProps {
    audioUrl: string;
    audioBlob?: Blob | null;
    transcription?: {
        content: string;
        timestamp: number;
        language?: string;
    } | null;
    /** Pre-computed friendly label for the language badge ("Swahili", "Auto Detect", or null
     *  for "render nothing"). Computed by the caller via `labelForTranscriptionLanguage()`
     *  from sharedUtils/asrLanguageUtils.ts so this component stays presentational. */
    transcriptionLanguageLabel?: string | null;
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
    /** Total number of audio recordings for the cell (including soft-deleted). When > 0, a count badge is rendered on the History button. */
    historyCount?: number;
    // Advanced ASR settings (gear menu, next to the Transcribe button).
    /** Whether to display the gear menu. Hide on source-text editors where the user can't drive transcription policy. */
    showAdvancedAsrMenu?: boolean;
    /** Current language mode. Determines the chevron position in the gear menu. */
    asrLanguageMode?: "auto" | "project";
    /** Current script preference: "auto", "latin", or a 4-letter ISO 15924 tag (e.g. "Arab"). */
    asrScriptPref?: string;
    /** Friendly project-language label for the "Project language" radio (e.g. "Swahili"). */
    projectLanguageName?: string;
    onChangeAsrLanguageMode?: (mode: "auto" | "project") => void;
    onChangeAsrScriptPref?: (pref: string) => void;
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
    historyCount,
    transcriptionLanguageLabel,
    showAdvancedAsrMenu = true,
    asrLanguageMode = "project",
    asrScriptPref = "auto",
    projectLanguageName,
    onChangeAsrLanguageMode,
    onChangeAsrScriptPref,
}) => {
    const [audioSrc, setAudioSrc] = useState<string>("");
    const [audioDuration, setAudioDuration] = useState<number | null>(null);

    // The Script picker offers three "preset" choices plus a free-form 4-letter input for
    // power users (e.g. someone wants `swa_Cyrl` even though the resolver would never pick
    // it). We track the *dropdown* selection separately from the committed `asrScriptPref`
    // so picking "Custom" reveals the input even before a valid tag has been entered.
    type ScriptOption = "auto" | "latin" | "custom";
    const optionFromPref = (pref: string): ScriptOption =>
        pref === "auto" ? "auto" : pref === "latin" ? "latin" : "custom";
    const [scriptSelection, setScriptSelection] = useState<ScriptOption>(
        optionFromPref(asrScriptPref)
    );
    const [scriptCustomDraft, setScriptCustomDraft] = useState<string>(
        optionFromPref(asrScriptPref) === "custom" ? asrScriptPref : ""
    );
    useEffect(() => {
        const next = optionFromPref(asrScriptPref);
        setScriptSelection(next);
        if (next === "custom") setScriptCustomDraft(asrScriptPref);
    }, [asrScriptPref]);
    const commitCustomScript = () => {
        const candidate = scriptCustomDraft.trim();
        if (/^[A-Za-z]{4}$/.test(candidate)) onChangeAsrScriptPref?.(candidate);
    };

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
                            {/* Language badge intentionally hidden in this PR.
                                The new `codex-asr` Modal app DOES run MMS-LID and echo back a
                                `lang` for auto-detect (and the plumbing all the way through
                                `transcriptionLanguageLabel` is wired and ready), but this PR
                                keeps the client pointed at the existing Frontier auth-proxy ASR
                                endpoint, which still forwards to the legacy `mms-zeroshot-asr`
                                Modal app — no LID, no `lang` echo. Showing the badge in that
                                world means falling back to "Auto Detect" (or worse, the project
                                language) instead of an honest detection, which is misleading.
                                Re-enable this `<Badge>` once the auth-proxy upstream migrates
                                to `codex-asr` (see docs/AUTH_SERVER_ASR_IMPLEMENTATION.md). */}
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
                {/* Transcribe / Re-transcribe split-button. The gear is glued to the right
                    edge of the main button (shared border, no gap) so it visually belongs
                    to the transcribe control. The label flips to "Re-transcribe" once a
                    saved transcription exists so the user can re-run with different ASR
                    settings (e.g. flip to auto-detect). Grey-out the whole group while a
                    transcription is in flight. */}
                {(() => {
                    const sharedBtnClass =
                        "h-8 text-xs text-[var(--vscode-button-background)] border-[var(--vscode-button-background)]/20 hover:bg-[var(--vscode-button-background)]/10";
                    const transcribeDisabled =
                        disabled || isTranscribing || (!audioUrl && !audioBlob);
                    return (
                        <div className="inline-flex items-stretch">
                            <Button
                                onClick={onTranscribe}
                                disabled={transcribeDisabled}
                                variant="outline"
                                className={`${sharedBtnClass} px-2 ${
                                    showAdvancedAsrMenu ? "rounded-r-none border-r-0" : ""
                                }`}
                                title={
                                    transcription
                                        ? "Re-transcribe audio with current settings"
                                        : "Transcribe Audio"
                                }
                            >
                                <MessageCircle className="h-3 w-3" />
                                <span className="ml-1">
                                    {transcription ? "Re-transcribe" : "Transcribe"}
                                </span>
                            </Button>
                            {showAdvancedAsrMenu && (
                                <Popover>
                                    <PopoverTrigger asChild>
                                        <Button
                                            type="button"
                                            variant="outline"
                                            disabled={isTranscribing}
                                            className={`${sharedBtnClass} px-1.5 rounded-l-none`}
                                            title="Advanced ASR settings (Language / Script)"
                                            aria-label="Advanced ASR settings"
                                        >
                                            <SettingsIcon className="h-3 w-3 opacity-70" />
                                        </Button>
                                    </PopoverTrigger>
                                    <PopoverContent className="w-64 space-y-3" align="end">
                                        <div className="space-y-1">
                                            <div className="text-xs font-semibold">Language</div>
                                            <Select
                                                value={asrLanguageMode}
                                                onValueChange={(v) =>
                                                    onChangeAsrLanguageMode?.(
                                                        v === "auto" ? "auto" : "project"
                                                    )
                                                }
                                            >
                                                <SelectTrigger className="h-7 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="project">
                                                        {projectLanguageName
                                                            ? `Project (${projectLanguageName})`
                                                            : "Project language"}
                                                    </SelectItem>
                                                    <SelectItem value="auto">
                                                        Auto-detect
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-xs font-semibold">Script</div>
                                            <Select
                                                value={scriptSelection}
                                                onValueChange={(v) => {
                                                    const next = v as ScriptOption;
                                                    setScriptSelection(next);
                                                    if (next === "auto" || next === "latin") {
                                                        onChangeAsrScriptPref?.(next);
                                                    }
                                                }}
                                            >
                                                <SelectTrigger className="h-7 text-xs">
                                                    <SelectValue />
                                                </SelectTrigger>
                                                <SelectContent>
                                                    <SelectItem value="auto">
                                                        Default
                                                    </SelectItem>
                                                    <SelectItem value="latin">
                                                        Latin (where supported)
                                                    </SelectItem>
                                                    <SelectItem value="custom">
                                                        Other (ISO 15924 tag)
                                                    </SelectItem>
                                                </SelectContent>
                                            </Select>
                                            {scriptSelection === "custom" && (
                                                <div className="flex items-center gap-1">
                                                    <Input
                                                        value={scriptCustomDraft}
                                                        onChange={(e) =>
                                                            setScriptCustomDraft(e.target.value)
                                                        }
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter") {
                                                                e.preventDefault();
                                                                commitCustomScript();
                                                            }
                                                        }}
                                                        placeholder="e.g. Arab, Cyrl, Hans"
                                                        maxLength={4}
                                                        className="h-7 text-xs"
                                                    />
                                                    <Button
                                                        size="sm"
                                                        variant="outline"
                                                        className="h-7 px-2 text-xs"
                                                        disabled={
                                                            !/^[A-Za-z]{4}$/.test(
                                                                scriptCustomDraft.trim()
                                                            )
                                                        }
                                                        onClick={commitCustomScript}
                                                    >
                                                        Apply
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </PopoverContent>
                                </Popover>
                            )}
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
