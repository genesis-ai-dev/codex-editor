import React, { useState, useEffect, useRef } from "react";
import { Button } from "../components/ui/button";
import {
    Play,
    Pause,
    RotateCcw,
    Trash2,
    Download,
    Clock,
    User,
    CheckCircle,
    Circle,
    XCircle,
    X,
} from "lucide-react";
import { WebviewApi } from "vscode-webview";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { ValidationEntry } from "../../../../types";
import { getActiveAudioValidations } from "./validationUtils";
import AudioValidationStatusIcon from "./AudioValidationStatusIcon";

interface AudioHistoryEntry {
    attachmentId: string;
    attachment: {
        url: string;
        type: string;
        createdAt: number;
        updatedAt: number;
        isDeleted: boolean;
        isMissing?: boolean; // Added for missing audio
        validatedBy?: ValidationEntry[];
    };
}

interface AudioHistoryViewerProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    onClose: () => void;
    currentUsername?: string | null;
    requiredAudioValidations?: number;
}

export const AudioHistoryViewer: React.FC<AudioHistoryViewerProps> = ({
    cellId,
    vscode,
    onClose,
    currentUsername,
    requiredAudioValidations: requiredAudioValidationsProp,
}) => {
    const [audioHistory, setAudioHistory] = useState<AudioHistoryEntry[]>([]);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
    const [delayedLoadingIds, setDelayedLoadingIds] = useState<Set<string>>(new Set());
    const [errorIds, setErrorIds] = useState<Set<string>>(new Set());
    const [validatingIds, setValidatingIds] = useState<Set<string>>(new Set());
    const validatingIdsRef = useRef<Set<string>>(new Set());
    const fetchCurrentOnCloseRef = useRef<boolean>(false);
    const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
    const [hasExplicitSelection, setHasExplicitSelection] = useState<boolean>(false);
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());
    const pendingPlayRefs = useRef<Map<string, boolean>>(new Map());
    const blobUrlsRef = useRef<Set<string>>(new Set());
    const loadingTimersRef = useRef<Map<string, NodeJS.Timeout>>(new Map());
    const [username, setUsername] = useState<string | null>(currentUsername ?? null);
    const [requiredAudioValidations, setRequiredAudioValidations] = useState<number | null>(
        requiredAudioValidationsProp ?? null
    );

    const effectiveRequiredAudioValidations =
        (requiredAudioValidationsProp ?? requiredAudioValidations ?? 1) || 1;

    // Request audio history when component mounts
    useEffect(() => {
        // Ask backend to revalidate missing flags for this cell before fetching history
        try {
            vscode.postMessage({
                command: "revalidateMissingForCell",
                content: { cellId },
            } as any);
        } catch {
            /* ignore */
        }
        vscode.postMessage({
            command: "getAudioHistory",
            content: { cellId },
        });

        // Proactively fetch validationCountAudio if not provided
        if (requiredAudioValidationsProp == null) {
            try {
                vscode.postMessage({ command: "getValidationCountAudio" } as any);
            } catch {
                /* ignore */
            }
        }

        // Proactively fetch current username if not provided
        if (!currentUsername) {
            try {
                vscode.postMessage({ command: "getCurrentUsername" } as any);
            } catch {
                /* ignore */
            }
        }
    }, [cellId, vscode, currentUsername, requiredAudioValidationsProp]);

    // Listen for audio history response
    useMessageHandler(
        "audioHistoryViewer",
        (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "audioHistoryReceived" && message.content.cellId === cellId) {
                setAudioHistory(message.content.audioHistory);
                // Use the currentAttachmentId from the backend (this reflects the actual selection state)
                setSelectedAudioId(message.content.currentAttachmentId);
                setHasExplicitSelection(message.content.hasExplicitSelection);

                // Pre-mark entries that are known missing
                try {
                    const missingIds = (message.content.audioHistory as any[])
                        .filter((e: any) => e?.attachment?.isMissing === true)
                        .map((e: any) => e.attachmentId);
                    if (missingIds.length > 0) {
                        setErrorIds((prev) => {
                            const next = new Set(prev);
                            missingIds.forEach((id) => next.add(id));
                            return next;
                        });
                    }
                } catch {
                    /* no-op */
                }
            }
            if (message.type === "audioAttachmentRestored" && message.content.cellId === cellId) {
                // Refresh audio history after restoration
                vscode.postMessage({
                    command: "getAudioHistory",
                    content: { cellId },
                });
            }
            if (message.type === "currentUsername") {
                setUsername(message.content?.username || null);
            }
            if (message.type === "validationCountAudio") {
                setRequiredAudioValidations(message.content || 1);
            }
            if (message.type === "providerSendsInitialContent") {
                if (message.username !== undefined) {
                    setUsername(message.username || null);
                }
                if (message.validationCountAudio !== undefined) {
                    setRequiredAudioValidations(message.validationCountAudio);
                }
            }
            if (message.type === "audioAttachmentSelected" && message.content.cellId === cellId) {
                if (message.content.success) {
                    // Immediately update the selected state
                    setSelectedAudioId(message.content.audioId);
                    setHasExplicitSelection(true);
                }
            }
            if (message.type === "audioAttachmentDeleted" && message.content.cellId === cellId) {
                if (message.content.success) {
                    // Refresh the audio history after delete
                    setTimeout(() => {
                        vscode.postMessage({
                            command: "getAudioHistory",
                            content: { cellId },
                        });
                    }, 50);
                }
            }
            if (message.type === "audioAttachmentRestored" && message.content.cellId === cellId) {
                if (message.content.success) {
                    // Refresh the audio history after restore
                    setTimeout(() => {
                        vscode.postMessage({
                            command: "getAudioHistory",
                            content: { cellId },
                        });
                    }, 50);
                }
            }
            if (message.type === "providerSendsAudioData") {
                const { cellId: audioCellId, audioId, audioData } = message.content;
                if (audioCellId === cellId) {
                    // Handle current-audio fallback (no specific audioId)
                    if (!audioId) {
                        if (audioData) {
                            const hasPendingPlay = Array.from(
                                pendingPlayRefs.current.values()
                            ).some(Boolean);
                            if (hasPendingPlay) {
                                onClose();
                                vscode.postMessage({
                                    command: "setPreferredEditorTab",
                                    content: { tab: "audio" },
                                });
                                try {
                                    sessionStorage.setItem(`start-audio-playback-${cellId}`, "1");
                                } catch (e) {
                                    // ignore
                                }
                            }
                        }
                        return;
                    }

                    // Normal case with specific audioId
                    // Clear loading state regardless of whether audio data was found
                    setLoadingIds((prev) => {
                        const next = new Set(prev);
                        next.delete(audioId);
                        return next;
                    });

                    // Clear delayed loading state and timer
                    setDelayedLoadingIds((prev) => {
                        const next = new Set(prev);
                        next.delete(audioId);
                        return next;
                    });

                    // Clear previous error for this id; will re-add below if needed
                    setErrorIds((prev) => {
                        const next = new Set(prev);
                        next.delete(audioId);
                        return next;
                    });

                    const timer = loadingTimersRef.current.get(audioId);
                    if (timer) {
                        clearTimeout(timer);
                        loadingTimersRef.current.delete(audioId);
                    }

                    if (audioData) {
                        // Convert base64 to blob URL
                        fetch(audioData)
                            .then((res) => res.blob())
                            .then((blob) => {
                                const blobUrl = URL.createObjectURL(blob);
                                blobUrlsRef.current.add(blobUrl); // Track for cleanup
                                setAudioUrls((prev) => new Map(prev).set(audioId, blobUrl));

                                // Auto-play if there was a pending play request
                                const hadPendingPlayForThisAudio =
                                    pendingPlayRefs.current.get(audioId);
                                if (hadPendingPlayForThisAudio) {
                                    pendingPlayRefs.current.set(audioId, false); // Clear the pending flag
                                    try {
                                        let audio = audioRefs.current.get(audioId);
                                        if (!audio) {
                                            audio = new Audio();
                                            audio.onended = () => setPlayingId(null);
                                            audio.onerror = () => {
                                                console.error("Error playing audio:", audioId);
                                                setPlayingId(null);
                                            };
                                            audioRefs.current.set(audioId, audio);
                                        }
                                        audio.src = blobUrl;
                                        audio
                                            .play()
                                            .then(() => setPlayingId(audioId))
                                            .catch(() => setPlayingId(null));
                                    } catch {
                                        setPlayingId(null);
                                    }
                                }

                                // If we were validating for selection, select now
                                if (validatingIdsRef.current.has(audioId)) {
                                    validatingIdsRef.current.delete(audioId);
                                    setValidatingIds((prev) => {
                                        const next = new Set(prev);
                                        next.delete(audioId);
                                        return next;
                                    });
                                    // Selection succeeded; do not force fallback on close
                                    fetchCurrentOnCloseRef.current = false;
                                    vscode.postMessage({
                                        command: "selectAudioAttachment",
                                        content: { cellId, audioId },
                                    });
                                }
                            })
                            .catch(console.error);
                    } else {
                        // No audio data found - set error state
                        setErrorIds((prev) => new Set(prev).add(audioId));
                        // Clear any in-progress validation for this audioId
                        if (validatingIdsRef.current.has(audioId)) {
                            validatingIdsRef.current.delete(audioId);
                            setValidatingIds((prev) => {
                                const next = new Set(prev);
                                next.delete(audioId);
                                return next;
                            });
                            // Mark that we should request the current audio when the user closes history
                            fetchCurrentOnCloseRef.current = true;
                        }
                    }
                }
            }
        },
        [cellId, vscode]
    );

    const handleClose = () => {
        // If a selection failed due to missing file, request current audio so the editor shows waveform
        if (fetchCurrentOnCloseRef.current) {
            fetchCurrentOnCloseRef.current = false;
            vscode.postMessage({
                command: "requestAudioForCell",
                content: { cellId },
            });
        }
        onClose();
    };

    // Clean up blob URLs and timers on unmount
    useEffect(() => {
        return () => {
            // Clean up all blob URLs that were created
            blobUrlsRef.current.forEach((url) => {
                URL.revokeObjectURL(url);
            });
            // Stop all audio elements
            audioRefs.current.forEach((audio) => {
                audio.pause();
            });
            // Clear all loading timers
            loadingTimersRef.current.forEach((timer) => {
                clearTimeout(timer);
            });
            loadingTimersRef.current.clear();
        };
    }, []); // Only run on mount/unmount, not when audioUrls changes

    const handlePlayAudio = async (attachmentId: string) => {
        try {
            // Stop any currently playing audio
            if (playingId && playingId !== attachmentId) {
                const currentAudio = audioRefs.current.get(playingId);
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                }
            }

            if (playingId === attachmentId) {
                // Stop current audio
                const audio = audioRefs.current.get(attachmentId);
                if (audio) {
                    audio.pause();
                    audio.currentTime = 0;
                }
                setPlayingId(null);
                return;
            }

            // Request audio data if not already loaded
            if (!audioUrls.has(attachmentId)) {
                setLoadingIds((prev) => new Set(prev).add(attachmentId));
                pendingPlayRefs.current.set(attachmentId, true);

                // Set a timer to show loading text after 300ms
                const timer = setTimeout(() => {
                    setDelayedLoadingIds((prev) => new Set(prev).add(attachmentId));
                }, 300);
                loadingTimersRef.current.set(attachmentId, timer);

                vscode.postMessage({
                    command: "requestAudioForCell",
                    content: { cellId, audioId: attachmentId },
                });
                return;
            }

            const audioUrl = audioUrls.get(attachmentId);
            if (!audioUrl) return;

            let audio = audioRefs.current.get(attachmentId);
            if (!audio) {
                audio = new Audio();
                audio.onended = () => setPlayingId(null);
                audio.onerror = () => {
                    console.error("Error playing audio:", attachmentId);
                    setPlayingId(null);
                };
                audioRefs.current.set(attachmentId, audio);
            }

            audio.src = audioUrl;
            await audio.play();
            setPlayingId(attachmentId);
        } catch (error) {
            console.error("Error handling audio playback:", error);
            setPlayingId(null);
        }
    };

    const handleRestoreAudio = (attachmentId: string) => {
        vscode.postMessage({
            command: "restoreAudioAttachment",
            content: {
                cellId,
                audioId: attachmentId,
            },
        });
    };

    const handleDeleteAudio = (attachmentId: string) => {
        vscode.postMessage({
            command: "deleteAudioAttachment",
            content: {
                cellId,
                audioId: attachmentId,
            },
        });
        // Refresh history after deletion
        setTimeout(() => {
            vscode.postMessage({
                command: "getAudioHistory",
                content: { cellId },
            });
        }, 100);
    };

    const handleSelectAudio = (attachmentId: string) => {
        // If previously determined missing, block selection
        if (errorIds.has(attachmentId)) {
            return;
        }

        // If we already have the audio loaded or cached, select immediately
        if (audioUrls.has(attachmentId)) {
            vscode.postMessage({
                command: "selectAudioAttachment",
                content: { cellId, audioId: attachmentId },
            });
            return;
        }

        // Otherwise, validate by requesting the audio; on success, selection happens in handler
        validatingIdsRef.current.add(attachmentId);
        setValidatingIds((prev) => new Set(prev).add(attachmentId));
        vscode.postMessage({
            command: "requestAudioForCell",
            content: { cellId, audioId: attachmentId },
        });
    };

    // Helper function to determine current attachment (latest non-deleted)
    const getCurrentAttachment = (history: AudioHistoryEntry[]) => {
        const nonDeleted = history.filter((entry) => !entry.attachment.isDeleted);
        if (nonDeleted.length === 0) return null;

        // Sort by updatedAt (newest first)
        nonDeleted.sort((a, b) => (b.attachment.updatedAt || 0) - (a.attachment.updatedAt || 0));
        return nonDeleted[0];
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString(undefined, {
            year: "numeric",
            month: "short",
            day: "numeric",
            hour: "2-digit",
            minute: "2-digit",
        });
    };

    const getLatestAttachment = () => {
        return audioHistory.find((entry) => !entry.attachment.isDeleted);
    };

    const currentAttachment = getLatestAttachment();

    return (
        <div
            style={{
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                backgroundColor: "rgba(0, 0, 0, 0.5)",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                zIndex: 1000,
            }}
        >
            <div
                style={{
                    backgroundColor: "var(--vscode-editor-background)",
                    border: "1px solid var(--vscode-panel-border)",
                    borderRadius: "8px",
                    padding: "20px",
                    maxWidth: "680px",
                    maxHeight: "80vh",
                    overflow: "auto",
                    width: "92%",
                    boxShadow: "0 10px 24px rgba(0,0,0,0.3)",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "16px",
                        borderBottom: "1px solid var(--vscode-editor-foreground)",
                        paddingBottom: "12px",
                    }}
                >
                    <h3 style={{ margin: 0, color: "var(--vscode-editor-foreground)" }}>
                        Audio History for {cellId}
                    </h3>
                    <Button
                        size="icon"
                        variant="ghost"
                        onClick={handleClose}
                        className="h-9 w-9 rounded-full"
                        title="Close"
                    >
                        <X className="h-5 w-5" />
                    </Button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {audioHistory.length > 0 ? (
                        audioHistory.map((entry, index) => {
                            const isCurrent = entry === currentAttachment; // Latest non-deleted
                            const isSelected = selectedAudioId === entry.attachmentId; // Currently active (either explicit or automatic)
                            const isPlaying = playingId === entry.attachmentId;
                            const isLoading = delayedLoadingIds.has(entry.attachmentId);
                            const hasError =
                                errorIds.has(entry.attachmentId) ||
                                entry.attachment?.isMissing === true;
                            const isValidating = validatingIds.has(entry.attachmentId);

                            // Compute validation status from attachment.validatedBy
                            const activeValidations = getActiveAudioValidations(
                                entry.attachment.validatedBy
                            );
                            const uniqueLatestByUser = new Map<string, ValidationEntry>();
                            activeValidations.forEach((v) => {
                                const existing = uniqueLatestByUser.get(v.username);
                                if (!existing || v.updatedTimestamp > existing.updatedTimestamp) {
                                    uniqueLatestByUser.set(v.username, v);
                                }
                            });
                            const currentValidations = uniqueLatestByUser.size;
                            const isValidatedByCurrentUser = username
                                ? Array.from(uniqueLatestByUser.values()).some(
                                      (validate) =>
                                          (validate.username || "").toLowerCase() ===
                                          (username || "").toLowerCase()
                                  )
                                : false;

                            return (
                                <div
                                    key={entry.attachmentId}
                                    style={{
                                        padding: "12px",
                                        border: "1px solid var(--vscode-panel-border)",
                                        borderRadius: "6px",
                                        backgroundColor: entry.attachment.isDeleted
                                            ? "var(--vscode-inputValidation-errorBackground)"
                                            : isCurrent
                                            ? "var(--vscode-editor-selectionBackground)"
                                            : "var(--vscode-editorWidget-background)",
                                        opacity: entry.attachment.isDeleted ? 0.9 : 1,
                                    }}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                            marginBottom: "8px",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                fontSize: "0.95em",
                                                color: "var(--vscode-foreground)",
                                            }}
                                        >
                                            <Clock size={14} />
                                            <span>
                                                Created: {formatDate(entry.attachment.createdAt)}
                                            </span>
                                            {entry.attachment.updatedAt !==
                                                entry.attachment.createdAt && (
                                                <span>
                                                    • Updated:{" "}
                                                    {formatDate(entry.attachment.updatedAt)}
                                                </span>
                                            )}
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "4px",
                                            }}
                                        >
                                            {isSelected && (
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            "var(--vscode-badge-background)",
                                                        color: "var(--vscode-badge-foreground)",
                                                        padding: "2px 6px",
                                                        borderRadius: "3px",
                                                        fontSize: "0.8em",
                                                        fontWeight: "bold",
                                                    }}
                                                >
                                                    SELECTED
                                                </span>
                                            )}
                                            {isCurrent && !hasExplicitSelection && (
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            "var(--vscode-editorInfo-foreground)",
                                                        color: "var(--vscode-editor-background)",
                                                        padding: "2px 6px",
                                                        borderRadius: "3px",
                                                        fontSize: "0.8em",
                                                        fontWeight: "bold",
                                                    }}
                                                >
                                                    CURRENT
                                                </span>
                                            )}
                                            {entry.attachment.isDeleted && (
                                                <span
                                                    style={{
                                                        backgroundColor:
                                                            "var(--vscode-inputValidation-errorBorder)",
                                                        color: "var(--vscode-editor-background)",
                                                        padding: "2px 6px",
                                                        borderRadius: "3px",
                                                        fontSize: "0.8em",
                                                        fontWeight: "bold",
                                                    }}
                                                >
                                                    DELETED
                                                </span>
                                            )}
                                            {entry.attachment.isMissing &&
                                                !entry.attachment.isDeleted && (
                                                    <span
                                                        style={{
                                                            backgroundColor:
                                                                "var(--vscode-inputValidation-warningBorder)",
                                                            color: "var(--vscode-editor-background)",
                                                            padding: "2px 6px",
                                                            borderRadius: "3px",
                                                            fontSize: "0.8em",
                                                            fontWeight: "bold",
                                                        }}
                                                    >
                                                        MISSING
                                                    </span>
                                                )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            flexWrap: "wrap",
                                        }}
                                    >
                                        <Button
                                            size="sm"
                                            variant={hasError ? "destructive" : "outline"}
                                            onClick={() => handlePlayAudio(entry.attachmentId)}
                                            disabled={isLoading || hasError}
                                            className={hasError ? "opacity-100" : undefined}
                                            title={hasError ? "File missing" : undefined}
                                        >
                                            {isLoading ? (
                                                <span>Loading...</span>
                                            ) : hasError ? (
                                                <>
                                                    <XCircle className="h-4 w-4 mr-1" />
                                                    Play
                                                </>
                                            ) : isPlaying ? (
                                                <>
                                                    <Pause className="h-4 w-4 mr-1" />
                                                    Stop
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="h-4 w-4 mr-1" />
                                                    Play
                                                </>
                                            )}
                                        </Button>

                                        {!entry.attachment.isDeleted && !hasError && (
                                            <Button
                                                size="sm"
                                                variant={isSelected ? "default" : "outline"}
                                                className="transition-none"
                                                onClick={() =>
                                                    handleSelectAudio(entry.attachmentId)
                                                }
                                                disabled={isSelected || isValidating}
                                            >
                                                {isSelected ? (
                                                    <CheckCircle className="h-4 w-4 mr-1" />
                                                ) : isValidating ? (
                                                    <span className="h-4 w-4 mr-1" />
                                                ) : (
                                                    <Circle className="h-4 w-4 mr-1" />
                                                )}
                                                {isSelected
                                                    ? "Selected"
                                                    : isValidating
                                                    ? "Validating..."
                                                    : "Select"}
                                            </Button>
                                        )}

                                        {entry.attachment.isDeleted ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() =>
                                                    handleRestoreAudio(entry.attachmentId)
                                                }
                                            >
                                                <RotateCcw className="h-4 w-4 mr-1" />
                                                Restore
                                            </Button>
                                        ) : (
                                            !isSelected &&
                                            !hasError && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() =>
                                                        handleDeleteAudio(entry.attachmentId)
                                                    }
                                                >
                                                    <Trash2 className="h-4 w-4 mr-1" />
                                                    Delete
                                                </Button>
                                            )
                                        )}

                                        <div className="flex flex-col flex-grow items-end justify-end gap-1">
                                            <span
                                                style={{
                                                    fontSize: "0.8em",
                                                    color: "var(--vscode-descriptionForeground)",
                                                    marginLeft: "auto",
                                                }}
                                            >
                                                ID: {entry.attachmentId.split("-").slice(-1)[0]}
                                            </span>
                                            <span
                                                style={{
                                                    fontSize: "0.8em",
                                                    color: "var(--vscode-descriptionForeground)",
                                                    marginLeft: "auto",
                                                }}
                                            >
                                                <AudioValidationStatusIcon
                                                    isValidationInProgress={false}
                                                    isDisabled={
                                                        entry.attachment.isDeleted || hasError
                                                    }
                                                    currentValidations={currentValidations}
                                                    requiredValidations={
                                                        effectiveRequiredAudioValidations
                                                    }
                                                    isValidatedByCurrentUser={
                                                        isValidatedByCurrentUser
                                                    }
                                                    displayValidationText
                                                />
                                            </span>
                                        </div>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div
                            style={{
                                textAlign: "center",
                                padding: "40px",
                                color: "var(--vscode-descriptionForeground)",
                            }}
                        >
                            <div>No audio recordings found for this cell.</div>
                        </div>
                    )}
                </div>

                <div
                    style={{
                        marginTop: "16px",
                        paddingTop: "12px",
                        borderTop: "1px solid var(--vscode-editor-foreground)",
                        textAlign: "center",
                    }}
                >
                    <Button onClick={onClose} variant="outline">
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
};
