import React, { useState, useRef, useEffect, useCallback } from "react";
import { WebviewApi } from "vscode-webview";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";
import { Timestamps } from "../../../../types";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { type AudioControllerEvent, globalAudioController } from "../lib/audioController";
import { getCachedAudioDataUrl, setCachedAudioDataUrl, setCachedAttachmentAudioDataUrl, clearCachedAudio } from "../lib/audioCache";
import type { EditorPostMessages } from "../../../../types";
import { getCellListIcon, type AudioAvailability } from "./utils/audioViewMode";

type AudioState = AudioAvailability;

/**
 * Waits for a video element to be ready for playback.
 * Returns a promise that resolves when the video has enough data to start playing.
 */
const waitForVideoReady = (
    videoElement: HTMLVideoElement,
    timeoutMs: number = 3000
): Promise<void> => {
    return new Promise((resolve) => {
        // If video is already ready, resolve immediately
        if (videoElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            resolve();
            return;
        }

        // Set up timeout fallback
        const timeoutId = setTimeout(() => {
            videoElement.removeEventListener("canplay", onCanPlay);
            videoElement.removeEventListener("loadeddata", onLoadedData);
            resolve(); // Resolve anyway after timeout
        }, timeoutMs);

        const onCanPlay = () => {
            clearTimeout(timeoutId);
            videoElement.removeEventListener("canplay", onCanPlay);
            videoElement.removeEventListener("loadeddata", onLoadedData);
            resolve();
        };

        const onLoadedData = () => {
            clearTimeout(timeoutId);
            videoElement.removeEventListener("canplay", onCanPlay);
            videoElement.removeEventListener("loadeddata", onLoadedData);
            resolve();
        };

        videoElement.addEventListener("canplay", onCanPlay);
        videoElement.addEventListener("loadeddata", onLoadedData);
    });
};

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

    // If the audio element is already using the new blob URL and it's loaded, revoke immediately
    if (
        audioElement.src === newBlobUrl &&
        audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA
    ) {
        if (audioElement.src !== oldBlobUrl) {
            URL.revokeObjectURL(oldBlobUrl);
        }
        return;
    }

    // Otherwise, wait for the audio element to load the new blob URL
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

    // Fallback timeout to prevent memory leaks
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
    state?: "available" | "available-local" | "available-pointer" | "missing" | "deletedOnly" | "none";
    onOpenCell?: (cellId: string) => void;
    playerRef?: React.RefObject<ReactPlayerRef>;
    cellTimestamps?: Timestamps;
    shouldShowVideoPlayer?: boolean;
    videoUrl?: string;
    disabled?: boolean;
    isSourceText?: boolean;
    isCellLocked?: boolean;
    onLockedClick?: () => void;
}

const AudioPlayButton: React.FC<AudioPlayButtonProps> = React.memo(
    ({
        cellId,
        vscode,
        state = "available",
        onOpenCell,
        playerRef,
        cellTimestamps,
        shouldShowVideoPlayer = false,
        videoUrl,
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
        const previousVideoMuteStateRef = useRef<boolean | null>(null);
        const videoElementRef = useRef<HTMLVideoElement | null>(null);

        // Helper function to stop video playback and restore mute state
        const stopVideoPlayback = useCallback(() => {
            if (
                shouldShowVideoPlayer &&
                previousVideoMuteStateRef.current !== null &&
                videoElementRef.current
            ) {
                try {
                    videoElementRef.current.pause();
                    videoElementRef.current.muted = previousVideoMuteStateRef.current;
                } catch (error) {
                    console.error("Error restoring video mute state:", error);
                }
                previousVideoMuteStateRef.current = null;
                videoElementRef.current = null;
            }
        }, [shouldShowVideoPlayer]);

        // Do not pre-load on mount; we will request on first click to avoid spinner churn

        // Listen for audio data messages
        useMessageHandler(
            "cellContentDisplay-audioData",
            async (event: MessageEvent) => {
                const message = event.data;

                if (message.type === "providerSendsAudioAttachments") {
                    const incoming = message.attachments as Record<string, string> | undefined;
                    const newState = incoming?.[cellId];
                    if (newState === "deletedOnly" || newState === "none" || newState === "missing" || newState === "available-pointer") {
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
                    if (selections && Object.prototype.hasOwnProperty.call(selections, cellId)) {
                        const incomingSelection = selections[cellId];
                        const previousSelection = lastKnownSelectedAudioIdRef.current;
                        lastKnownSelectedAudioIdRef.current = incomingSelection;
                        if (previousSelection !== undefined && previousSelection !== incomingSelection) {
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
                        // Store the old blob URL to revoke later, but only if audio element isn't using it
                        const oldBlobUrl =
                            audioUrl && audioUrl.startsWith("blob:") ? audioUrl : null;

                        // Convert base64 to blob URL
                        fetch(message.content.audioData)
                            .then((res) => res.blob())
                            .then(async (blob) => {
                                const blobUrl = URL.createObjectURL(blob);
                                try {
                                    setCachedAudioDataUrl(cellId, message.content.audioData);
                                    if (message.content.audioId) {
                                        setCachedAttachmentAudioDataUrl(message.content.audioId, message.content.audioData);
                                    }
                                } catch {
                                    /* empty */
                                }
                                setAudioUrl(blobUrl);
                                setIsLoading(false);
                                if (pendingPlayRef.current) {
                                    // Auto-play once the data arrives
                                    try {
                                        // Handle video seeking, muting, and playback if video is showing
                                        let videoElement: HTMLVideoElement | null = null;
                                        if (
                                            shouldShowVideoPlayer &&
                                            videoUrl &&
                                            playerRef?.current &&
                                            cellTimestamps?.startTime !== undefined
                                        ) {
                                            try {
                                                let seeked = false;
                                                if (
                                                    typeof playerRef.current.seekTo === "function"
                                                ) {
                                                    playerRef.current.seekTo(
                                                        cellTimestamps.startTime,
                                                        "seconds"
                                                    );
                                                    seeked = true;
                                                }
                                                const internalPlayer =
                                                    playerRef.current.getInternalPlayer?.();
                                                if (internalPlayer instanceof HTMLVideoElement) {
                                                    videoElement = internalPlayer;
                                                    if (!seeked) {
                                                        videoElement.currentTime =
                                                            cellTimestamps.startTime;
                                                        seeked = true;
                                                    }
                                                } else if (
                                                    internalPlayer &&
                                                    typeof internalPlayer === "object"
                                                ) {
                                                    const foundVideo =
                                                        (internalPlayer as any).querySelector?.(
                                                            "video"
                                                        ) ||
                                                        (internalPlayer as any).video ||
                                                        internalPlayer;
                                                    if (foundVideo instanceof HTMLVideoElement) {
                                                        videoElement = foundVideo;
                                                        if (!seeked) {
                                                            videoElement.currentTime =
                                                                cellTimestamps.startTime;
                                                            seeked = true;
                                                        }
                                                    }
                                                }
                                                if (!videoElement && playerRef.current) {
                                                    const wrapper = playerRef.current as any;
                                                    const foundVideo =
                                                        wrapper.querySelector?.("video") ||
                                                        wrapper.parentElement?.querySelector?.(
                                                            "video"
                                                        );
                                                    if (foundVideo instanceof HTMLVideoElement) {
                                                        videoElement = foundVideo;
                                                        if (!seeked) {
                                                            videoElement.currentTime =
                                                                cellTimestamps.startTime;
                                                            seeked = true;
                                                        }
                                                    }
                                                }
                                                if (videoElement) {
                                                    previousVideoMuteStateRef.current =
                                                        videoElement.muted;
                                                    videoElementRef.current = videoElement;
                                                    videoElement.muted = true;
                                                    try {
                                                        await videoElement.play();
                                                    } catch (playError) {
                                                        if (
                                                            playError instanceof Error &&
                                                            playError.name === "AbortError"
                                                        ) {
                                                            /* ignore */
                                                        } else {
                                                            console.warn(
                                                                "Video play() failed, will wait for readiness:",
                                                                playError
                                                            );
                                                        }
                                                    }
                                                    await waitForVideoReady(videoElement);
                                                }
                                            } catch (error) {
                                                console.error(
                                                    "Error seeking/muting/playing video:",
                                                    error
                                                );
                                            }
                                        }

                                        if (!audioRef.current) {
                                            audioRef.current = new Audio();
                                            audioRef.current.onended = () => {
                                                setIsPlaying(false);
                                                stopVideoPlayback();
                                            };
                                            audioRef.current.onerror = () => {
                                                console.error(
                                                    "Error playing audio for cell:",
                                                    cellId
                                                );
                                                setIsPlaying(false);
                                            };
                                        }

                                        // Set the new blob URL as src
                                        audioRef.current.src = blobUrl;

                                        // Safely revoke the old blob URL after the new one is loaded
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
                                    // Not auto-playing, but still wait for audio to load before revoking old blob URL
                                    if (oldBlobUrl && audioRef.current) {
                                        // Set the new blob URL as src
                                        audioRef.current.src = blobUrl;
                                        // Safely revoke the old blob URL after the new one is loaded
                                        safelyRevokeOldBlobUrl(
                                            audioRef.current,
                                            oldBlobUrl,
                                            blobUrl
                                        );
                                    } else if (oldBlobUrl) {
                                        // No audio element, safe to revoke immediately
                                        URL.revokeObjectURL(oldBlobUrl);
                                    }
                                }
                            })
                            .catch((error) => {
                                console.error("Error converting audio data:", error);
                                setIsLoading(false);
                            });
                    } else {
                        // No audio data - clear the audio URL and stop loading
                        setAudioUrl(null);
                        setIsLoading(false);
                    }
                }
            },
            [audioUrl, cellId, vscode, shouldShowVideoPlayer, videoUrl, playerRef, cellTimestamps]
        );

        // Clean up blob URL on unmount
        useEffect(() => {
            return () => {
                // Only revoke blob URL if audio element isn't using it
                if (audioUrl && audioUrl.startsWith("blob:")) {
                    if (!audioRef.current || audioRef.current.src !== audioUrl) {
                        URL.revokeObjectURL(audioUrl);
                    }
                }
                // Stop audio if playing when unmounting
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
                        } catch { /* ignore */ }
                    } else if ((window as any).__autoRecordOnMicClick && state !== "missing") {
                        try {
                            sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                        } catch { /* ignore */ }
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
                    // Stop current audio
                    if (audioRef.current) {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                    stopVideoPlayback();
                } else if (isDownloadOnly) {
                    setIsLoading(true);
                    pendingPlayRef.current = false;
                    vscode.postMessage({
                        command: "requestAudioForCell",
                        content: { cellId },
                    } as EditorPostMessages);
                } else {
                    // If we don't have audio yet, try cached data first; only request if not cached
                    let effectiveUrl: string | null = audioUrl;
                    const oldBlobUrl = audioUrl && audioUrl.startsWith("blob:") ? audioUrl : null;
                    if (!effectiveUrl) {
                        const cached = getCachedAudioDataUrl(cellId);
                        if (cached) {
                            pendingPlayRef.current = true;
                            setIsLoading(true);
                            try {
                                const res = await fetch(cached);
                                const blob = await res.blob();
                                const blobUrl = URL.createObjectURL(blob);
                                setAudioUrl(blobUrl); // update state for future plays
                                effectiveUrl = blobUrl; // use immediately for this play
                                setIsLoading(false);
                                // fall through to playback below
                            } catch {
                                // If cache hydration fails, request from provider
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

                    // Handle video seeking, muting, and playback if video is showing
                    let videoElement: HTMLVideoElement | null = null;
                    if (
                        shouldShowVideoPlayer &&
                        videoUrl &&
                        playerRef?.current &&
                        cellTimestamps?.startTime !== undefined
                    ) {
                        try {
                            let seeked = false;
                            if (typeof playerRef.current.seekTo === "function") {
                                playerRef.current.seekTo(cellTimestamps.startTime, "seconds");
                                seeked = true;
                            }
                            const internalPlayer = playerRef.current.getInternalPlayer?.();
                            if (internalPlayer instanceof HTMLVideoElement) {
                                videoElement = internalPlayer;
                                if (!seeked) {
                                    videoElement.currentTime = cellTimestamps.startTime;
                                    seeked = true;
                                }
                            } else if (internalPlayer && typeof internalPlayer === "object") {
                                const foundVideo =
                                    (internalPlayer as any).querySelector?.("video") ||
                                    (internalPlayer as any).video ||
                                    internalPlayer;
                                if (foundVideo instanceof HTMLVideoElement) {
                                    videoElement = foundVideo;
                                    if (!seeked) {
                                        videoElement.currentTime = cellTimestamps.startTime;
                                        seeked = true;
                                    }
                                }
                            }
                            if (!videoElement && playerRef.current) {
                                const wrapper = playerRef.current as any;
                                const foundVideo =
                                    wrapper.querySelector?.("video") ||
                                    wrapper.parentElement?.querySelector?.("video");
                                if (foundVideo instanceof HTMLVideoElement) {
                                    videoElement = foundVideo;
                                    if (!seeked) {
                                        videoElement.currentTime = cellTimestamps.startTime;
                                        seeked = true;
                                    }
                                }
                            }
                            if (videoElement) {
                                previousVideoMuteStateRef.current = videoElement.muted;
                                videoElementRef.current = videoElement;
                                videoElement.muted = true;
                                try {
                                    await videoElement.play();
                                } catch (playError) {
                                    if (
                                        playError instanceof Error &&
                                        playError.name === "AbortError"
                                    ) {
                                        /* ignore */
                                    } else {
                                        console.warn(
                                            "Video play() failed, will wait for readiness:",
                                            playError
                                        );
                                    }
                                }
                                await waitForVideoReady(videoElement);
                            }
                        } catch (error) {
                            console.error("Error seeking/muting/playing video:", error);
                        }
                    }

                    // Create or reuse audio element
                    if (!audioRef.current) {
                        audioRef.current = new Audio();
                        audioRef.current.onended = () => {
                            setIsPlaying(false);
                            stopVideoPlayback();
                        };
                        audioRef.current.onerror = () => {
                            console.error("Error playing audio for cell:", cellId);
                            setIsPlaying(false);
                        };
                    }

                    const newBlobUrl = effectiveUrl || audioUrl || "";
                    audioRef.current.src = newBlobUrl;

                    // Safely revoke the old blob URL after the new one is loaded (if we're switching blob URLs)
                    if (oldBlobUrl && oldBlobUrl !== newBlobUrl && newBlobUrl.startsWith("blob:")) {
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

        // Keep inline button in sync if this audio is stopped by global controller (e.g. user
        // clicked another cell's play). Do not call stopVideoPlayback() here: the new cell is
        // now in charge of the video; pausing here would fight with it and can cause a loop.
        useEffect(() => {
            const handler = (e: AudioControllerEvent) => {
                if (audioRef.current && e.audio === audioRef.current) {
                    setIsPlaying(false);
                    previousVideoMuteStateRef.current = null;
                    videoElementRef.current = null;
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
                          : state === "available-local" || state === "available" || state === "available-cached"
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
                <i
                    className={`codicon ${iconClass}`}
                    style={{ fontSize: "16px" }}
                />
            </button>
        );
    }
);

export default AudioPlayButton;