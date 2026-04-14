import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { MessageCircle, Copy, Loader2, Trash2, History, Mic } from "lucide-react";
import ValidationStatusIcon, { getValidationLabel } from "./AudioValidationStatusIcon.tsx";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import type { QuillCellContent } from "../../../../types";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import ValidatorPopover from "./components/ValidatorPopover";
import { audioPopoverTracker } from "./validationUtils";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";

interface AudioValidationPopoverProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredAudioValidations?: number;
    disabled?: boolean;
    disabledReason?: string;
}

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
    author,
}) => {
    const [audioSrc, setAudioSrc] = useState<string>("");
    // State for hover popover of audio validators
    const [showValidatorsPopover, setShowValidatorsPopover] = useState(false);
    const validationContainerRef = React.useRef<HTMLDivElement>(null);
    const popoverCloseTimerRef = React.useRef<number | null>(null);
    const cancelCloseTimer = () => {
        if (popoverCloseTimerRef.current != null) {
            clearTimeout(popoverCloseTimerRef.current);
            popoverCloseTimerRef.current = null;
        }
    };
    const scheduleCloseTimer = (cb: () => void, delay = 100) => {
        cancelCloseTimer();
        popoverCloseTimerRef.current = window.setTimeout(cb, delay);
    };

    // Stabilize frequently used popover values for hook dependencies
    const popoverCurrentUsername = audioValidationPopoverProps?.currentUsername;
    const popoverCell = audioValidationPopoverProps?.cell;
    const popoverCellId = audioValidationPopoverProps?.cellId;
    const isSourceTextPopover = audioValidationPopoverProps?.isSourceText;
    const hasPopover = Boolean(audioValidationPopoverProps);
    const uniqueId = React.useRef(
        `audio-validation-${popoverCellId ?? "unknown"}-${Math.random()
            .toString(36)
            .substring(2, 11)}`
    );

    // Derive validators via shared hook (deduped latest per user)
    const { validators: uniqueValidationUsers } = useAudioValidationStatus({
        cell: (popoverCell as any) || ({} as any),
        currentUsername: popoverCurrentUsername || null,
        requiredAudioValidations:
            audioValidationPopoverProps &&
            audioValidationPopoverProps.requiredAudioValidations !== undefined &&
            audioValidationPopoverProps.requiredAudioValidations !== null
                ? audioValidationPopoverProps.requiredAudioValidations
                : null,
        isSourceText: Boolean(isSourceTextPopover),
        disabled: false,
        displayValidationText: false,
    });

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

    const handleValidation = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        // Add to audio validation queue for sequential processing
        enqueueValidation(audioValidationPopoverProps.cellId, true, true)
            .then(() => {})
            .catch((error) => {
                console.error("Audio validation queue error:", error);
            });
        processValidationQueue(audioValidationPopoverProps.vscode, true).catch((error) => {
            console.error("Audio validation queue processing error:", error);
        });
    };

    const handleAudioValidationMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        e.preventDefault();
        cancelCloseTimer();
        setShowValidatorsPopover(true);
        audioPopoverTracker.setActivePopover(uniqueId.current);
    };

    const handleAudioValidationMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        e.preventDefault();
        scheduleCloseTimer(() => {
            setShowValidatorsPopover(false);
            if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                audioPopoverTracker.setActivePopover(null);
            }
        }, 100);
    };

    const renderValidationButton = () => {
        const { currentValidations, requiredValidations, isValidatedByCurrentUser } =
            validationStatusProps;
        const isFullyValidated = currentValidations >= requiredValidations;
        const canValidate = currentValidations === 0 || (!isFullyValidated && !isValidatedByCurrentUser);
        const label = getValidationLabel({ currentValidations, requiredValidations, isValidatedByCurrentUser });
        const buttonLabel = currentValidations === 0 ? "Validate" : label;

        const iconClass = currentValidations === 0
            ? "codicon codicon-circle-outline"
            : isFullyValidated
            ? "codicon codicon-check-all"
            : isValidatedByCurrentUser
            ? "codicon codicon-check"
            : "codicon codicon-circle-filled";
        const iconColor = (isFullyValidated || isValidatedByCurrentUser)
            ? "var(--vscode-charts-green)"
            : "var(--vscode-descriptionForeground)";

        return (
            <Button
                variant="outline"
                size="sm"
                className="static h-6 px-2 rounded-full text-sm bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border border-[var(--vscode-panel-border)]/40 hover:opacity-90"
                onClick={canValidate ? handleValidation : undefined}
                onMouseEnter={handleAudioValidationMouseEnter}
                onMouseLeave={handleAudioValidationMouseLeave}
            >
                <i className={iconClass} style={{ fontSize: "14px", color: iconColor, filter: (isFullyValidated || isValidatedByCurrentUser) ? "drop-shadow(0 0 0.5px rgba(0,0,0,0.45))" : undefined }}></i>
                <span className="ml-1">{buttonLabel}</span>
            </Button>
        );
    };

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
                <div
                    className="absolute -top-2 -right-2 z-50"
                    ref={validationContainerRef}
                    onMouseEnter={(e) => {
                        e.stopPropagation();
                        cancelCloseTimer();
                        setShowValidatorsPopover(true);
                        audioPopoverTracker.setActivePopover(uniqueId.current);
                    }}
                    onMouseLeave={(e) => {
                        e.stopPropagation();
                        scheduleCloseTimer(() => {
                            setShowValidatorsPopover(false);
                            if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                                audioPopoverTracker.setActivePopover(null);
                            }
                        }, 100);
                    }}
                >
                    <div
                        className="relative inline-flex items-center justify-center"
                        style={{
                            filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.15))",
                        }}
                    >
                        {renderValidationButton()}
                    </div>
                    {showValidatorsPopover &&
                        audioValidationPopoverProps &&
                        uniqueValidationUsers.length > 0 && (
                            <ValidatorPopover
                                anchorRef={validationContainerRef}
                                show={showValidatorsPopover}
                                setShow={setShowValidatorsPopover}
                                validators={uniqueValidationUsers}
                                currentUsername={popoverCurrentUsername || null}
                                uniqueId={uniqueId.current}
                                onRemoveSelf={() => {
                                    enqueueValidation(popoverCellId!, false, true)
                                        .then(() => {})
                                        .catch((error) =>
                                            console.error("Audio validation queue error:", error)
                                        );
                                    processValidationQueue(
                                        audioValidationPopoverProps!.vscode,
                                        true
                                    ).catch((error) =>
                                        console.error(
                                            "Audio validation queue processing error:",
                                            error
                                        )
                                    );
                                }}
                                cancelCloseTimer={cancelCloseTimer}
                                scheduleCloseTimer={scheduleCloseTimer}
                            />
                        )}
                </div>
            )}

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
