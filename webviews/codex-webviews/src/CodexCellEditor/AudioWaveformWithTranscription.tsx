import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { MessageCircle, Copy, Loader2, Trash2, History, Mic } from "lucide-react";
import AudioValidationStatusIcon from "./AudioValidationStatusIcon.tsx";
import type { AudioValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import type { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "@sharedUtils";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";

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
    validationStatusProps?: AudioValidationStatusIconProps;
    audioValidationPopoverProps?: {
        cellId: string;
        cell: QuillCellContent;
        vscode: any;
        isSourceText: boolean;
        currentUsername?: string | null;
        requiredAudioValidations?: number;
        disabled?: boolean;
        disabledReason?: string;
    };
}

// Static tracking for active popover to ensure only one is shown at a time
const audioPopoverTracker = {
    activePopoverId: null as string | null,
    setActivePopover(id: string | null) {
        this.activePopoverId = id;
    },
    getActivePopover() {
        return this.activePopoverId;
    },
};

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
}) => {
    const [audioSrc, setAudioSrc] = useState<string>("");
    // State for hover popover of audio validators
    const [showValidatorsPopover, setShowValidatorsPopover] = useState(false);
    const [isPersistentPopover] = useState(false); // Only hover behavior here
    const [validationUsers, setValidationUsers] = useState<ValidationEntry[]>([]);
    const [username, setUsername] = useState<string | null>(
        audioValidationPopoverProps?.currentUsername ?? null
    );
    const iconContainerRef = React.useRef<HTMLButtonElement>(null);
    const popoverRef = React.useRef<HTMLDivElement>(null);

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

    // Helpers copied from AudioValidationButton to dedupe and compare lists
    const dedupeActiveValidations = (entries: ValidationEntry[]): ValidationEntry[] => {
        const userMap = new Map<string, ValidationEntry>();
        entries.forEach((entry) => {
            if (!entry || (entry as any).isDeleted) {
                return;
            }
            const existing = userMap.get(entry.username);
            if (!existing || entry.updatedTimestamp > existing.updatedTimestamp) {
                userMap.set(entry.username, entry);
            }
        });
        return Array.from(userMap.values());
    };

    const areValidationListsEqual = (a: ValidationEntry[], b: ValidationEntry[]): boolean => {
        if (a.length !== b.length) return false;
        const sortByUsername = (list: ValidationEntry[]) =>
            [...list].sort((left, right) => left.username.localeCompare(right.username));
        const sortedA = sortByUsername(a);
        const sortedB = sortByUsername(b);
        return sortedA.every((entry, index) => {
            const other = sortedB[index];
            return (
                entry.username === other.username &&
                entry.updatedTimestamp === other.updatedTimestamp &&
                (entry as any).isDeleted === (other as any).isDeleted
            );
        });
    };

    // Derived values
    const uniqueValidationUsers = validationUsers;
    const isValidated = React.useMemo(() => {
        if (!username) return false;
        return uniqueValidationUsers.some((entry) => entry.username === username);
    }, [uniqueValidationUsers, username]);

    // Helper to format timestamps (copied from AudioValidationButton)
    const formatTimestamp = (timestamp: number): string => {
        if (!timestamp) return "";
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);
        if (diffDays < 1) {
            if (diffHours < 1) {
                if (diffMins < 1) return "just now";
                return `${diffMins}m ago`;
            }
            return `${diffHours}h ago`;
        }
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
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

    // Keep username in sync if provided from parent; otherwise obtain from message handler
    useEffect(() => {
        if (popoverCurrentUsername) {
            setUsername(popoverCurrentUsername);
        }
    }, [popoverCurrentUsername]);

    // Update validation list when cell or username changes
    useEffect(() => {
        if (!popoverCell) return;
        const cell = popoverCell;
        const effectiveSelectedAudioId = cell.metadata?.selectedAudioId ?? "";
        const cellValueData = getCellValueData({
            ...cell,
            metadata: {
                ...(cell.metadata || {}),
                selectedAudioId: effectiveSelectedAudioId,
            },
        } as any);
        const activeValidations = dedupeActiveValidations(cellValueData.audioValidatedBy || []);
        setValidationUsers((previous) =>
            areValidationListsEqual(previous, activeValidations) ? previous : activeValidations
        );
    }, [popoverCell, username]);

    // Listen for provider updates that impact validations
    useMessageHandler(
        "audioValidationPopover",
        (event: MessageEvent) => {
            const message = (event as any).data;
            if (!hasPopover) return;
            const cellId = popoverCellId;
            if (!username && message.type === "currentUsername") {
                setUsername(message.content.username);
            } else if (message.type === "providerUpdatesAudioValidationState") {
                if (message.content.cellId === cellId) {
                    const validatedBy = message.content.validatedBy as
                        | ValidationEntry[]
                        | undefined;
                    const activeValidations = dedupeActiveValidations(validatedBy || []);
                    setValidationUsers((previous) =>
                        areValidationListsEqual(previous, activeValidations)
                            ? previous
                            : activeValidations
                    );
                }
            } else if (message.type === "audioHistorySelectionChanged") {
                const validatedBy = message.content.validatedBy as ValidationEntry[] | undefined;
                const activeValidations = dedupeActiveValidations(validatedBy || []);
                setValidationUsers((previous) =>
                    areValidationListsEqual(previous, activeValidations)
                        ? previous
                        : activeValidations
                );
            } else if (message.command === "updateAudioValidationCount") {
                const list = (message.content?.validations || []) as ValidationEntry[];
                const activeValidations = dedupeActiveValidations(list);
                setValidationUsers((previous) =>
                    areValidationListsEqual(previous, activeValidations)
                        ? previous
                        : activeValidations
                );
            }
        },
        [popoverCellId, username, hasPopover]
    );

    // Position the popover near the icon on hover
    useEffect(() => {
        if (!showValidatorsPopover || !popoverRef.current || !iconContainerRef.current) return;
        const buttonRect = iconContainerRef.current.getBoundingClientRect();
        const popoverRect = popoverRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        const spaceAbove = buttonRect.top;
        const spaceBelow = viewportHeight - (buttonRect.top + buttonRect.height);
        const spaceRight = viewportWidth - (buttonRect.left + buttonRect.width);
        const spaceLeft = buttonRect.left;

        let left = buttonRect.width + 5;
        let top = 0;
        if (spaceRight < popoverRect.width + 10) {
            left = -popoverRect.width - 5;
        }
        if (spaceRight < popoverRect.width + 10 && spaceLeft < popoverRect.width + 10) {
            left = -(popoverRect.width / 2) + buttonRect.width / 2;
        }
        if (spaceBelow >= popoverRect.height + 10) {
            top = buttonRect.height + 5;
        } else if (spaceAbove >= popoverRect.height + 10) {
            top = -popoverRect.height - 5;
        } else {
            top = -(popoverRect.height / 2) + buttonRect.height / 2;
        }

        const finalLeft = Math.min(
            Math.max(left, -buttonRect.left + 10),
            viewportWidth - buttonRect.left - popoverRect.width - 10
        );
        const finalTop = Math.min(
            Math.max(top, -buttonRect.top + 10),
            viewportHeight - buttonRect.top - popoverRect.height - 10
        );

        popoverRef.current.style.position = "absolute";
        popoverRef.current.style.top = `${buttonRect.top + finalTop}px`;
        popoverRef.current.style.left = `${buttonRect.left + finalLeft}px`;
        popoverRef.current.style.opacity = "1";
        popoverRef.current.style.pointerEvents = "auto";
        popoverRef.current.style.zIndex = "100000";
    }, [showValidatorsPopover]);

    return (
        <div className="bg-[var(--vscode-editor-background)] flex flex-col gap-y-3 p-3 sm:p-4 rounded-md shadow w-full">
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
                    />
                ) : (
                    <div className="flex items-center justify-center h-16 text-[var(--vscode-foreground)] text-sm">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading waveform...
                    </div>
                )}
            </div>
            {validationStatusProps && (
                <div className="flex w-full items-center justify-end">
                    <button
                        ref={iconContainerRef}
                        onClick={(e) => {
                            e.stopPropagation();

                            if (hasPopover && validationUsers.length > 0 && !isSourceTextPopover) {
                                setShowValidatorsPopover(true);
                                audioPopoverTracker.setActivePopover(uniqueId.current);
                            }
                        }}
                        style={{ position: "relative", display: "inline-block" }}
                    >
                        <AudioValidationStatusIcon {...validationStatusProps} />
                    </button>
                    {showValidatorsPopover &&
                        audioValidationPopoverProps &&
                        validationUsers.length > 0 && (
                            <div
                                ref={popoverRef}
                                className="audio-validation-popover"
                                style={{
                                    position: "fixed",
                                    zIndex: 100000,
                                    opacity: showValidatorsPopover ? "1" : "0",
                                    transition: "opacity 0.2s ease-in-out",
                                    pointerEvents: showValidatorsPopover ? "auto" : "none",
                                    backgroundColor: "var(--vscode-editor-background)",
                                    boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                                    border: "1px solid var(--vscode-editorWidget-border)",
                                }}
                                onMouseEnter={(e) => {
                                    e.stopPropagation();
                                    setShowValidatorsPopover(true);
                                }}
                                onMouseLeave={(e) => {
                                    e.stopPropagation();
                                    setShowValidatorsPopover(false);
                                    if (
                                        audioPopoverTracker.getActivePopover() === uniqueId.current
                                    ) {
                                        audioPopoverTracker.setActivePopover(null);
                                    }
                                }}
                            >
                                <div style={{ padding: "0 8px" }}>
                                    <div
                                        style={{
                                            fontWeight: "bold",
                                            marginBottom: "4px",
                                            borderBottom:
                                                "1px solid var(--vscode-editorWidget-border)",
                                            paddingBottom: "4px",
                                        }}
                                    >
                                        Audio Validators
                                    </div>
                                    {uniqueValidationUsers.map((user) => {
                                        const isCurrentUser = user.username === username;
                                        const canDelete = isCurrentUser && isValidated;
                                        const formattedTime = formatTimestamp(
                                            user.updatedTimestamp
                                        );

                                        return (
                                            <div
                                                key={user.username}
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "space-between",
                                                    padding: "3px 0",
                                                    position: "relative",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "8px",
                                                        flex: "1",
                                                    }}
                                                >
                                                    <span
                                                        id={`username-${user.username}-${uniqueId.current}`}
                                                        style={{
                                                            fontWeight: isCurrentUser
                                                                ? "600"
                                                                : "400",
                                                        }}
                                                    >
                                                        {user.username}
                                                    </span>
                                                    {user.username === username && (
                                                        <span
                                                            id={`trash-icon-${user.username}-${uniqueId.current}`}
                                                            onClick={(e) => {
                                                                e.stopPropagation();

                                                                // Add to audio validation queue for sequential processing
                                                                enqueueValidation(
                                                                    popoverCellId!,
                                                                    false,
                                                                    true
                                                                )
                                                                    .then(() => {
                                                                        // Validation request has been queued successfully
                                                                    })
                                                                    .catch((error) => {
                                                                        console.error(
                                                                            "Audio validation queue error:",
                                                                            error
                                                                        );
                                                                    });

                                                                // Process the queue
                                                                processValidationQueue(
                                                                    audioValidationPopoverProps!
                                                                        .vscode,
                                                                    true
                                                                ).catch((error) => {
                                                                    console.error(
                                                                        "Audio validation queue processing error:",
                                                                        error
                                                                    );
                                                                });

                                                                // Immediately close the popover
                                                                setShowValidatorsPopover(false);
                                                                if (
                                                                    audioPopoverTracker.getActivePopover() ===
                                                                    uniqueId.current
                                                                ) {
                                                                    audioPopoverTracker.setActivePopover(
                                                                        null
                                                                    );
                                                                }
                                                            }}
                                                            title="Remove your audio validation"
                                                            className="audio-validation-trash-icon"
                                                            style={{
                                                                cursor: "pointer",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                justifyContent: "center",
                                                                padding: "2px",
                                                                borderRadius: "3px",
                                                                transition: "background-color 0.2s",
                                                            }}
                                                        >
                                                            <svg
                                                                width="14"
                                                                height="14"
                                                                viewBox="0 0 24 24"
                                                                fill="none"
                                                                xmlns="http://www.w3.org/2000/svg"
                                                            >
                                                                <path
                                                                    d="M3 6H5H21"
                                                                    stroke="#ff5252"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                />
                                                                <path
                                                                    d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z"
                                                                    stroke="#ff5252"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                />
                                                                <path
                                                                    d="M10 11V17"
                                                                    stroke="#ff5252"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                />
                                                                <path
                                                                    d="M14 11V17"
                                                                    stroke="#ff5252"
                                                                    strokeWidth="2"
                                                                    strokeLinecap="round"
                                                                    strokeLinejoin="round"
                                                                />
                                                            </svg>
                                                        </span>
                                                    )}
                                                    <span
                                                        style={{
                                                            fontSize: "11px",
                                                            color: "var(--vscode-descriptionForeground)",
                                                            marginLeft: "auto",
                                                        }}
                                                    >
                                                        {formatTimestamp(user.updatedTimestamp)}
                                                    </span>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
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
                    title="Remove Audio"
                >
                    <Trash2 className="h-3 w-3" />
                    <span className="ml-1">Remove</span>
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
