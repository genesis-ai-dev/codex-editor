import React, { useEffect, useRef, useState } from "react";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../lib/audioCache";
import type { WebviewApi } from "vscode-webview";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { Timestamps } from "../../../../types";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";

type AudioState =
    | "available"
    | "available-local"
    | "available-pointer"
    | "missing"
    | "deletedOnly"
    | "none";

interface AudioPlayButtonProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?: AudioState;
    onOpenCell?: (cellId: string) => void;
    playerRef?: React.RefObject<ReactPlayerRef>;
    cellTimestamps?: Timestamps;
    shouldShowVideoPlayer?: boolean;
    videoUrl?: string;
}

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

const AudioPlayButton: React.FC<AudioPlayButtonProps> = ({
    cellId,
    vscode,
    state = "available",
    onOpenCell,
    playerRef,
    cellTimestamps,
    shouldShowVideoPlayer = false,
    videoUrl,
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const pendingPlayRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const previousVideoMuteStateRef = useRef<boolean | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);

    useMessageHandler(
        "audioPlayButton",
        async (event: MessageEvent) => {
            const message = event.data;

            if (message.type === "providerSendsAudioAttachments") {
                // Only clear cached URL if this cell's availability actually changed to a different state
                const attachments = message.attachments || {};
                const newState = attachments[cellId];
                if (typeof newState !== "undefined") {
                    // Clear cached audio data since selected audio might have changed
                    const { clearCachedAudio } = await import("../lib/audioCache");
                    clearCachedAudio(cellId);

                    // If we previously had no audio URL and still don't, no-op; avoid churn
                    if (audioUrl && audioUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(audioUrl);
                    }
                    setAudioUrl(null);
                    setIsLoading(false);
                }
            }

            if (message.type === "providerSendsAudioData" && message.content.cellId === cellId) {
                if (message.content.audioData) {
                    // Store the old blob URL to revoke later, but only if audio element isn't using it
                    const oldBlobUrl = audioUrl && audioUrl.startsWith("blob:") ? audioUrl : null;

                    fetch(message.content.audioData)
                        .then((res) => res.blob())
                        .then(async (blob) => {
                            const blobUrl = URL.createObjectURL(blob);
                            try {
                                setCachedAudioDataUrl(cellId, message.content.audioData);
                            } catch {
                                // Ignore cache errors
                            }
                            setAudioUrl(blobUrl);
                            setIsLoading(false);
                            if (pendingPlayRef.current) {
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
                                            if (typeof playerRef.current.seekTo === "function") {
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
                                                    wrapper.parentElement?.querySelector?.("video");

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
                                                    // Video play() may fail due to autoplay restrictions, but we'll still wait for readiness
                                                    console.warn(
                                                        "Video play() failed, will wait for readiness:",
                                                        playError
                                                    );
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
                                            // Restore video mute state when audio ends
                                            if (
                                                shouldShowVideoPlayer &&
                                                previousVideoMuteStateRef.current !== null &&
                                                videoElementRef.current
                                            ) {
                                                try {
                                                    // Use the stored video element reference
                                                    videoElementRef.current.muted =
                                                        previousVideoMuteStateRef.current;
                                                } catch (error) {
                                                    console.error(
                                                        "Error restoring video mute state:",
                                                        error
                                                    );
                                                }
                                                previousVideoMuteStateRef.current = null;
                                                videoElementRef.current = null;
                                            }
                                        };
                                        audioRef.current.onerror = () => {
                                            console.error("Error playing audio for cell:", cellId);
                                            setIsPlaying(false);
                                        };
                                    }

                                    // Set the new blob URL as src
                                    audioRef.current.src = blobUrl;

                                    // Now safe to revoke the old blob URL if it exists and isn't being used
                                    if (oldBlobUrl && audioRef.current.src !== oldBlobUrl) {
                                        URL.revokeObjectURL(oldBlobUrl);
                                    }

                                    audioRef.current
                                        .play()
                                        .then(() => setIsPlaying(true))
                                        .catch(() => setIsPlaying(false));
                                } finally {
                                    pendingPlayRef.current = false;
                                }
                            } else {
                                // Not auto-playing, safe to revoke old blob URL now
                                if (
                                    oldBlobUrl &&
                                    (!audioRef.current || audioRef.current.src !== oldBlobUrl)
                                ) {
                                    URL.revokeObjectURL(oldBlobUrl);
                                }
                            }
                        })
                        .catch(() => setIsLoading(false));
                } else {
                    setAudioUrl(null);
                    setIsLoading(false);
                }
            }
        },
        [audioUrl, cellId, vscode, shouldShowVideoPlayer, videoUrl, playerRef, cellTimestamps]
    );

    useEffect(() => {
        return () => {
            // Only revoke blob URL if audio element isn't using it
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
        try {
            if (state !== "available") {
                // For missing audio, just open the editor without auto-starting recording
                if (state !== "missing") {
                    try {
                        sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                    } catch {
                        // no-op
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
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }
                setIsPlaying(false);
                // Restore video mute state when audio is manually stopped
                if (
                    shouldShowVideoPlayer &&
                    previousVideoMuteStateRef.current !== null &&
                    videoElementRef.current
                ) {
                    try {
                        // Use the stored video element reference
                        videoElementRef.current.muted = previousVideoMuteStateRef.current;
                    } catch (error) {
                        console.error("Error restoring video mute state:", error);
                    }
                    previousVideoMuteStateRef.current = null;
                    videoElementRef.current = null;
                }
            } else {
                if (!audioUrl) {
                    pendingPlayRef.current = true;
                    setIsLoading(true);
                    vscode.postMessage({
                        command: "requestAudioForCell",
                        content: { cellId },
                    } as any);
                    return;
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
                                // Video play() may fail due to autoplay restrictions, but we'll still wait for readiness
                                console.warn(
                                    "Video play() failed, will wait for readiness:",
                                    playError
                                );
                            }

                            // Wait for video to be ready before starting audio
                            await waitForVideoReady(videoElement);
                        }
                    } catch (error) {
                        console.error("Error seeking/muting/playing video:", error);
                    }
                }

                if (!audioRef.current) {
                    audioRef.current = new Audio();
                    audioRef.current.onended = () => {
                        setIsPlaying(false);
                        // Restore video mute state when audio ends
                        if (
                            shouldShowVideoPlayer &&
                            previousVideoMuteStateRef.current !== null &&
                            videoElementRef.current
                        ) {
                            try {
                                // Use the stored video element reference
                                videoElementRef.current.muted = previousVideoMuteStateRef.current;
                            } catch (error) {
                                console.error("Error restoring video mute state:", error);
                            }
                            previousVideoMuteStateRef.current = null;
                            videoElementRef.current = null;
                        }
                    };
                    audioRef.current.onerror = () => setIsPlaying(false);
                }

                audioRef.current.src = audioUrl;
                await audioRef.current.play();
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Error handling audio playback:", error);
            setIsPlaying(false);
        }
    };

    const { iconClass, color } = (() => {
        // If we already have an audio URL, always show Play (post-stream or cache)
        if (audioUrl) {
            return {
                iconClass: isPlaying ? "codicon-debug-stop" : "codicon-play",
                color: "var(--vscode-charts-blue)",
            } as const;
        }
        if (state === "available" || state === "available-local") {
            return {
                iconClass: isPlaying ? "codicon-debug-stop" : "codicon-play",
                color: "var(--vscode-charts-blue)",
            } as const;
        }
        if (state === "available-pointer") {
            return {
                iconClass: isPlaying ? "codicon-debug-stop" : "codicon-cloud-download",
                color: "var(--vscode-charts-blue)",
            } as const;
        }
        if (state === "missing") {
            return {
                iconClass: "codicon-warning",
                color: "var(--vscode-errorForeground)",
            } as const;
        }
        return { iconClass: "codicon-mic", color: "var(--vscode-foreground)" } as const;
    })();

    return (
        <button
            onClick={handlePlayAudio}
            className="audio-play-button p-[1px]"
            title={
                isLoading
                    ? "Preparing audio..."
                    : state === "available" || state === "available-local"
                    ? "Play"
                    : state === "available-pointer"
                    ? "Download"
                    : state === "missing"
                    ? "Missing audio"
                    : "Record"
            }
            disabled={false}
            style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color,
                opacity: isPlaying ? 1 : 0.8,
                transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? "1" : "0.8")}
        >
            <i
                className={`codicon ${iconClass}`}
                style={{ fontSize: "16px", position: "relative" }}
            />
        </button>
    );
};

export default React.memo(AudioPlayButton);
