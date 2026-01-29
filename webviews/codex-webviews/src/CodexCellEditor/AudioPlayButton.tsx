import React, { useState, useRef, useEffect, useCallback } from "react";
import { WebviewApi } from "vscode-webview";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";
import { Timestamps } from "../../../../types";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { AudioControllerEvent, globalAudioController } from "../lib/audioController";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../lib/audioCache";
import { EditorPostMessages } from "../../../../types";

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

const AudioPlayButton: React.FC<{
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?:
        | "available"
        | "available-local"
        | "available-pointer"
        | "missing"
        | "deletedOnly"
        | "none";
    onOpenCell?: (cellId: string) => void;
    playerRef?: React.RefObject<ReactPlayerRef>;
    cellTimestamps?: Timestamps;
    shouldShowVideoPlayer?: boolean;
    videoUrl?: string;
    disabled?: boolean;
    isSourceText?: boolean;
    isCellLocked?: boolean;
    onLockedClick?: () => void;
}> = React.memo(
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

                // Handle audio attachments updates - clear current url and cache; fetch on next click
                if (message.type === "providerSendsAudioAttachments") {
                    // Clear cached audio data since selected audio might have changed
                    const { clearCachedAudio } = await import("../lib/audioCache");
                    clearCachedAudio(cellId);

                    if (audioUrl && audioUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(audioUrl);
                    }
                    setAudioUrl(null);
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
                                            // Seek video to cell's start timestamp, mute it, and start playback
                                            try {
                                                let seeked = false;

                                                // First try seekTo method if available
                                                if (
                                                    typeof playerRef.current.seekTo === "function"
                                                ) {
                                                    playerRef.current.seekTo(
                                                        cellTimestamps.startTime,
                                                        "seconds"
                                                    );
                                                    seeked = true;
                                                }

                                                // Try to find the video element for both seeking (fallback) and muting
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
                                                    // Try different ways to access the video element
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

                                                // Last resort: Try to find video element in the DOM
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

                                                // Mute and start video playback if we found the element
                                                if (videoElement) {
                                                    previousVideoMuteStateRef.current =
                                                        videoElement.muted;
                                                    videoElementRef.current = videoElement;
                                                    videoElement.muted = true;

                                                    // Start video playback
                                                    try {
                                                        await videoElement.play();
                                                    } catch (playError) {
                                                        // AbortError: play() was interrupted by pause() - ignore (race with VideoPlayer)
                                                        if (
                                                            playError instanceof Error &&
                                                            playError.name === "AbortError"
                                                        ) {
                                                            // Continue to audio setup; do not return
                                                        } else {
                                                            console.warn(
                                                                "Video play() failed, will wait for readiness:",
                                                                playError
                                                            );
                                                        }
                                                    }

                                                    // Wait for video to be ready before starting audio
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
                    state !== "available-pointer"
                ) {
                    // Locked cells: don't open editor to record/re-record.
                    // (Playback is handled in available/available-local/available-pointer states.)
                    if (isCellLocked && state !== "missing") {
                        onLockedClick?.();
                        return;
                    }

                    // For missing audio, just open the editor without auto-starting recording
                    if (state !== "missing" && !isCellLocked) {
                        try {
                            sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                        } catch (e) {
                            void e;
                        }
                    }
                    vscode.postMessage({
                        command: "setPreferredEditorTab",
                        content: { tab: "audio" },
                    } as any);
                    if (onOpenCell) onOpenCell(cellId);
                    return;
                }

                if (isPlaying) {
                    // Stop current audio
                    if (audioRef.current) {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                    stopVideoPlayback();
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
                        // Seek video to cell's start timestamp, mute it, and start playback
                        try {
                            let seeked = false;

                            // First try seekTo method if available
                            if (typeof playerRef.current.seekTo === "function") {
                                playerRef.current.seekTo(cellTimestamps.startTime, "seconds");
                                seeked = true;
                            }

                            // Try to find the video element for both seeking (fallback) and muting
                            const internalPlayer = playerRef.current.getInternalPlayer?.();

                            if (internalPlayer instanceof HTMLVideoElement) {
                                videoElement = internalPlayer;
                                if (!seeked) {
                                    videoElement.currentTime = cellTimestamps.startTime;
                                    seeked = true;
                                }
                            } else if (internalPlayer && typeof internalPlayer === "object") {
                                // Try different ways to access the video element
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

                            // Last resort: Try to find video element in the DOM
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

                            // Mute and start video playback if we found the element
                            if (videoElement) {
                                previousVideoMuteStateRef.current = videoElement.muted;
                                videoElementRef.current = videoElement;
                                videoElement.muted = true;

                                // Start video playback
                                try {
                                    await videoElement.play();
                                } catch (playError) {
                                    // AbortError: play() was interrupted by pause() - ignore (race with VideoPlayer)
                                    if (
                                        playError instanceof Error &&
                                        playError.name === "AbortError"
                                    ) {
                                        // Continue to audio setup; do not return
                                    } else {
                                        console.warn(
                                            "Video play() failed, will wait for readiness:",
                                            playError
                                        );
                                    }
                                }

                                // Wait for video to be ready before starting audio
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

        // Keep inline button in sync if this audio is stopped by global controller
        useEffect(() => {
            const handler = (e: AudioControllerEvent) => {
                if (audioRef.current && e.audio === audioRef.current) {
                    setIsPlaying(false);
                    stopVideoPlayback();
                }
            };
            globalAudioController.addListener(handler);
            return () => globalAudioController.removeListener(handler);
        }, [stopVideoPlayback]);

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

        // Decide icon color/style based on state
        const { iconClass, color, titleSuffix } = (() => {
            // If we already have audio bytes (from cache or just streamed), show Play regardless of pointer/local state
            if (audioUrl || getCachedAudioDataUrl(cellId)) {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : isPlaying
                        ? "codicon-debug-stop"
                        : "codicon-play",
                    color: "var(--vscode-charts-blue)",
                    titleSuffix: "(available)",
                } as const;
            }
            // Local file present but not yet loaded into memory
            if (state === "available-local") {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : isPlaying
                        ? "codicon-debug-stop"
                        : "codicon-play",
                    color: "var(--vscode-charts-blue)",
                    titleSuffix: "(local)",
                } as const;
            }
            // Available remotely/downloadable or pointer-only → show cloud
            if (state === "available" || state === "available-pointer") {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : "codicon-cloud-download", // cloud behind play
                    color: "var(--vscode-charts-blue)",
                    titleSuffix: state === "available-pointer" ? "(pointer)" : "(in cloud)",
                } as const;
            }
            if (state === "missing") {
                return {
                    iconClass: "codicon-warning",
                    color: "var(--vscode-errorForeground)",
                    titleSuffix: "(missing)",
                } as const;
            }
            // deletedOnly or none => show mic to begin recording
            return {
                iconClass: "codicon-mic",
                color: "var(--vscode-foreground)",
                titleSuffix: "(record)",
            } as const;
        })();

        return (
            <button
                onClick={handlePlayAudio}
                className="audio-play-button"
                title={
                    disabled
                        ? "Audio playback disabled - other type is playing"
                        : isLoading
                        ? "Preparing audio..."
                        : state === "available" || state === "available-pointer"
                        ? audioUrl || getCachedAudioDataUrl(cellId)
                            ? "Play"
                            : "Download"
                        : state === "available-local"
                        ? "Play"
                        : state === "missing"
                        ? "Missing audio"
                        : isCellLocked
                        ? "Cell is locked"
                        : "Record"
                }
                disabled={disabled}
                style={{
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
                    style={{ fontSize: "16px", position: "relative" }}
                />
            </button>
        );
    }
);

export default AudioPlayButton;
