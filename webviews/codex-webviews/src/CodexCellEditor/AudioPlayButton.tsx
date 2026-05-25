import React, { useState, useRef, useEffect } from "react";
import { WebviewApi } from "vscode-webview";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { type AudioControllerEvent, globalAudioController } from "../lib/audioController";
import {
    getCachedAudioDataUrl,
    setCachedAudioDataUrl,
    setCachedAttachmentAudioDataUrl,
    clearCachedAudio,
} from "../lib/audioCache";
import type { EditorPostMessages } from "../../../../types";
import { getCellListIcon, type AudioAvailability } from "./utils/audioViewMode";

type AudioState = AudioAvailability;

/**
 * Safely revokes an old blob URL after ensuring the audio element has loaded the new one.
 * This prevents ERR_FILE_NOT_FOUND errors when switching between cells quickly.
 */
const safelyRevokeOldBlobUrl = (
    audioElement: HTMLAudioElement,
    oldBlobUrl: string | null,
    newBlobUrl: string
): void => {
    if (!oldBlobUrl || !oldBlobUrl.startsWith("blob:")) {
        return;
    }

    if (
        audioElement.src === newBlobUrl &&
        audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
        if (audioElement.src !== oldBlobUrl) {
            URL.revokeObjectURL(oldBlobUrl);
        }
        return;
    }

    const revokeOldBlobUrl = () => {
        if (audioElement.src !== oldBlobUrl) {
            URL.revokeObjectURL(oldBlobUrl);
        }
    };

    const onLoadedData = () => {
        audioElement.removeEventListener("loadeddata", onLoadedData);
        audioElement.removeEventListener("canplay", onCanPlay);
        audioElement.removeEventListener("error", onError);
        revokeOldBlobUrl();
    };

    const onCanPlay = () => {
        audioElement.removeEventListener("loadeddata", onLoadedData);
        audioElement.removeEventListener("canplay", onCanPlay);
        audioElement.removeEventListener("error", onError);
        revokeOldBlobUrl();
    };

    const onError = () => {
        audioElement.removeEventListener("loadeddata", onLoadedData);
        audioElement.removeEventListener("canplay", onCanPlay);
        audioElement.removeEventListener("error", onError);
        // Don't revoke on error - the old blob URL might still be needed
    };

    audioElement.addEventListener("loadeddata", onLoadedData);
    audioElement.addEventListener("canplay", onCanPlay);
    audioElement.addEventListener("error", onError);

    setTimeout(() => {
        audioElement.removeEventListener("loadeddata", onLoadedData);
        audioElement.removeEventListener("canplay", onCanPlay);
        audioElement.removeEventListener("error", onError);
        revokeOldBlobUrl();
    }, 5000);
};

interface AudioPlayButtonProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?: AudioState;
    onOpenCell?: (cellId: string) => void;
    disabled?: boolean;
    isSourceText?: boolean;
    isCellLocked?: boolean;
    onLockedClick?: () => void;
}

/**
 * Inline cell-list audio play button.
 *
 * Plays ONLY the cell's recorded audio. Video playback is intentionally NOT
 * triggered here — the timeline-aware multi-cell overlay belongs to the
 * "Play Video" control inside the Timestamps tab of the cell editor (which
 * drives `useMultiCellAudioPlayback`). Coupling this button to the video
 * caused the wrong cells' audio to play and made it impossible to preview a
 * single cell's recording without scrubbing the video.
 */
const AudioPlayButton: React.FC<AudioPlayButtonProps> = React.memo(
    ({
        cellId,
        vscode,
        state = "available",
        onOpenCell,
        disabled = false,
        isSourceText = false,
        isCellLocked = false,
        onLockedClick,
    }) => {
        const [isPlaying, setIsPlaying] = useState(false);
        const [audioUrl, setAudioUrl] = useState<string | null>(null);
        const [isLoading, setIsLoading] = useState(false);
        const pendingPlayRef = useRef(false);
        const audioRef = useRef<HTMLAudioElement | null>(null);
        // Last `selectedAudioId` we observed for this cell on a broadcast.
        // `undefined` means "we haven't seen one yet" — used as a sentinel so the
        // first broadcast just initializes the ref instead of busting the cache.
        // Subsequent broadcasts whose value differs indicate a remote selection
        // change (e.g. a teammate's sync), and we must drop the `cellId`-keyed
        // cache so the next play fetches fresh bytes for the new attachment.
        const lastKnownSelectedAudioIdRef = useRef<string | null | undefined>(undefined);

        // Listen for audio data messages
        useMessageHandler(
            "cellContentDisplay-audioData",
            async (event: MessageEvent) => {
                const message = event.data;

                if (message.type === "providerSendsAudioAttachments") {
                    const incoming = message.attachments as Record<string, string> | undefined;
                    const newState = incoming?.[cellId];
                    if (
                        newState === "deletedOnly" ||
                        newState === "none" ||
                        newState === "missing" ||
                        newState === "available-pointer"
                    ) {
                        clearCachedAudio(cellId);

                        if (audioUrl && audioUrl.startsWith("blob:")) {
                            URL.revokeObjectURL(audioUrl);
                        }
                        setAudioUrl(null);
                    }

                    // Detect remote selection changes carried by sync broadcasts.
                    // Local select/deselect already fires `audioAttachmentSelected` with
                    // its own cache-bust path, so this only kicks in for sync-driven
                    // changes where no such event is sent.  Without this, the cell-list
                    // Play button would keep playing the previous attachment after sync.
                    const selections = (message as any).selections as
                        | Record<string, string | null>
                        | undefined;
                    if (
                        selections &&
                        Object.prototype.hasOwnProperty.call(selections, cellId)
                    ) {
                        const incomingSelection = selections[cellId];
                        const previousSelection = lastKnownSelectedAudioIdRef.current;
                        lastKnownSelectedAudioIdRef.current = incomingSelection;
                        if (
                            previousSelection !== undefined &&
                            previousSelection !== incomingSelection
                        ) {
                            clearCachedAudio(cellId);
                            if (audioRef.current) {
                                audioRef.current.pause();
                                audioRef.current.src = "";
                            }
                            if (audioUrl && audioUrl.startsWith("blob:")) {
                                URL.revokeObjectURL(audioUrl);
                            }
                            setAudioUrl(null);
                            setIsPlaying(false);
                            pendingPlayRef.current = false;
                        }
                    }
                    setIsLoading(false);
                }

                if (
                    message.type === "providerSendsAudioData" &&
                    message.content.cellId === cellId
                ) {
                    if (message.content.audioData) {
                        const oldBlobUrl =
                            audioUrl && audioUrl.startsWith("blob:") ? audioUrl : null;

                        fetch(message.content.audioData)
                            .then((res) => res.blob())
                            .then(async (blob) => {
                                const blobUrl = URL.createObjectURL(blob);
                                try {
                                    setCachedAudioDataUrl(cellId, message.content.audioData);
                                    if (message.content.audioId) {
                                        setCachedAttachmentAudioDataUrl(
                                            message.content.audioId,
                                            message.content.audioData
                                        );
                                    }
                                } catch {
                                    /* empty */
                                }
                                setAudioUrl(blobUrl);
                                setIsLoading(false);
                                if (pendingPlayRef.current) {
                                    try {
                                        if (!audioRef.current) {
                                            audioRef.current = new Audio();
                                            audioRef.current.onended = () => {
                                                setIsPlaying(false);
                                            };
                                            audioRef.current.onerror = () => {
                                                console.error(
                                                    "Error playing audio for cell:",
                                                    cellId
                                                );
                                                setIsPlaying(false);
                                            };
                                        }

                                        audioRef.current.src = blobUrl;

                                        safelyRevokeOldBlobUrl(
                                            audioRef.current,
                                            oldBlobUrl,
                                            blobUrl
                                        );

                                        globalAudioController
                                            .playExclusive(audioRef.current)
                                            .then(() => setIsPlaying(true))
                                            .catch((e) => {
                                                console.error(
                                                    "Error auto-playing audio for cell:",
                                                    e
                                                );
                                                setIsPlaying(false);
                                            });
                                    } finally {
                                        pendingPlayRef.current = false;
                                    }
                                } else {
                                    if (oldBlobUrl && audioRef.current) {
                                        audioRef.current.src = blobUrl;
                                        safelyRevokeOldBlobUrl(
                                            audioRef.current,
                                            oldBlobUrl,
                                            blobUrl
                                        );
                                    } else if (oldBlobUrl) {
                                        URL.revokeObjectURL(oldBlobUrl);
                                    }
                                }
                            })
                            .catch((error) => {
                                console.error("Error converting audio data:", error);
                                setIsLoading(false);
                            });
                    } else {
                        setAudioUrl(null);
                        setIsLoading(false);
                    }
                }
            },
            [audioUrl, cellId, vscode]
        );

        // Clean up blob URL on unmount
        useEffect(() => {
            return () => {
                if (audioUrl && audioUrl.startsWith("blob:")) {
                    if (!audioRef.current || audioRef.current.src !== audioUrl) {
                        URL.revokeObjectURL(audioUrl);
                    }
                }
                if (audioRef.current && isPlaying) {
                    audioRef.current.pause();
                }
            };
        }, [audioUrl, isPlaying]);

        const handlePlayAudio = async () => {
            if (disabled) {
                return;
            }

            try {
                // For any non-available state, open editor on audio tab and auto-start recording
                if (
                    state !== "available" &&
                    state !== "available-local" &&
                    state !== "available-pointer" &&
                    state !== "available-cached"
                ) {
                    // Locked cells: don't open editor to record/re-record.
                    // (Playback is handled in available/available-local/available-pointer states.)
                    if (isCellLocked && state !== "missing") {
                        onLockedClick?.();
                        return;
                    }

                    if (state === "unselected" && !isCellLocked) {
                        try {
                            sessionStorage.setItem(`open-audio-history-${cellId}`, "1");
                        } catch {
                            /* ignore */
                        }
                    } else if ((window as any).__autoRecordOnMicClick && state !== "missing") {
                        try {
                            sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                        } catch {
                            /* ignore */
                        }
                    }

                    vscode.postMessage({
                        command: "setPreferredEditorTab",
                        content: { tab: "audio" },
                    } as any);
                    if (onOpenCell) onOpenCell(cellId);
                    return;
                }

                // Download-only: if the audio is remote (pointer) and not yet cached,
                // just fetch it in the background without auto-playing.
                const isDownloadOnly =
                    state === "available-pointer" &&
                    !audioUrl &&
                    !getCachedAudioDataUrl(cellId);

                if (isPlaying) {
                    if (audioRef.current) {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                } else if (isDownloadOnly) {
                    setIsLoading(true);
                    pendingPlayRef.current = false;
                    vscode.postMessage({
                        command: "requestAudioForCell",
                        content: { cellId },
                    } as EditorPostMessages);
                } else {
                    // Try cached data first; only request if not cached
                    let effectiveUrl: string | null = audioUrl;
                    const oldBlobUrl =
                        audioUrl && audioUrl.startsWith("blob:") ? audioUrl : null;
                    if (!effectiveUrl) {
                        const cached = getCachedAudioDataUrl(cellId);
                        if (cached) {
                            pendingPlayRef.current = true;
                            setIsLoading(true);
                            try {
                                const res = await fetch(cached);
                                const blob = await res.blob();
                                const blobUrl = URL.createObjectURL(blob);
                                setAudioUrl(blobUrl);
                                effectiveUrl = blobUrl;
                                setIsLoading(false);
                            } catch {
                                pendingPlayRef.current = true;
                                setIsLoading(true);
                                vscode.postMessage({
                                    command: "requestAudioForCell",
                                    content: { cellId },
                                } as EditorPostMessages);
                                return;
                            }
                        } else {
                            pendingPlayRef.current = true;
                            setIsLoading(true);
                            vscode.postMessage({
                                command: "requestAudioForCell",
                                content: { cellId },
                            } as EditorPostMessages);
                            return;
                        }
                    }

                    if (!audioRef.current) {
                        audioRef.current = new Audio();
                        audioRef.current.onended = () => {
                            setIsPlaying(false);
                        };
                        audioRef.current.onerror = () => {
                            console.error("Error playing audio for cell:", cellId);
                            setIsPlaying(false);
                        };
                    }

                    const newBlobUrl = effectiveUrl || audioUrl || "";
                    audioRef.current.src = newBlobUrl;

                    if (
                        oldBlobUrl &&
                        oldBlobUrl !== newBlobUrl &&
                        newBlobUrl.startsWith("blob:")
                    ) {
                        safelyRevokeOldBlobUrl(audioRef.current, oldBlobUrl, newBlobUrl);
                    }

                    await globalAudioController.playExclusive(audioRef.current);
                    setIsPlaying(true);
                }
            } catch (error) {
                console.error("Error handling audio playback:", error);
                setIsPlaying(false);
            }
        };

        // Keep inline button in sync if this audio is stopped by the global controller
        // (e.g. user clicked another cell's play button).
        useEffect(() => {
            const handler = (e: AudioControllerEvent) => {
                if (audioRef.current && e.audio === audioRef.current) {
                    setIsPlaying(false);
                }
            };
            globalAudioController.addListener(handler);
            return () => globalAudioController.removeListener(handler);
        }, []);

        // Broadcast audio state changes to other webviews
        useEffect(() => {
            const webviewType = isSourceText ? "source" : "target";
            vscode.postMessage({
                command: "audioStateChanged",
                destination: "webview",
                content: {
                    type: "audioPlaying",
                    webviewType,
                    isPlaying,
                },
            } as any);
        }, [isPlaying, isSourceText, vscode]);

        const { iconClass, color } = getCellListIcon({
            state,
            hasAudioUrl: !!audioUrl || !!getCachedAudioDataUrl(cellId),
            isLoading,
            isPlaying,
        });

        return (
            <button
                onClick={handlePlayAudio}
                className="audio-play-button"
                title={
                    disabled
                        ? "Audio playback disabled - other type is playing"
                        : isLoading
                        ? "Preparing audio..."
                        : state === "available-pointer"
                        ? audioUrl || getCachedAudioDataUrl(cellId)
                            ? "Play"
                            : "Download"
                        : state === "available-local" ||
                          state === "available" ||
                          state === "available-cached"
                        ? "Play"
                        : state === "missing"
                        ? "Missing audio"
                        : isCellLocked
                        ? "Cell is locked"
                        : "Record"
                }
                disabled={disabled}
                style={{
                    position: "relative",
                    background: "none",
                    border: "none",
                    cursor: disabled ? "not-allowed" : "pointer",
                    padding: "1px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                    opacity: disabled ? 0.4 : isPlaying ? 1 : 0.8,
                    transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => {
                    e.stopPropagation();
                    if (!disabled) {
                        e.currentTarget.style.opacity = "1";
                    }
                }}
                onMouseLeave={(e) => {
                    e.stopPropagation();
                    e.currentTarget.style.opacity = disabled ? "0.4" : isPlaying ? "1" : "0.8";
                }}
            >
                <i className={`codicon ${iconClass}`} style={{ fontSize: "16px" }} />
            </button>
        );
    }
);

export default AudioPlayButton;
