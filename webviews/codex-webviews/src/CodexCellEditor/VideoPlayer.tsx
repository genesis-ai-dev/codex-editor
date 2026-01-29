import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactPlayer from "react-player";
import { useSubtitleData } from "./utils/vttUtils";
import { QuillCellContent } from "../../../../types";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";

interface VideoPlayerProps {
    playerRef: React.RefObject<ReactPlayerRef>;
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    showSubtitles?: boolean;
    onTimeUpdate?: (time: number) => void;
    onPlay?: () => void;
    onPause?: () => void;
    autoPlay: boolean;
    playerHeight: number;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    playerRef,
    videoUrl,
    translationUnitsForSection,
    showSubtitles = true,
    onTimeUpdate,
    onPlay,
    onPause,
    autoPlay,
    playerHeight,
}) => {
    const { subtitleUrl } = useSubtitleData(translationUnitsForSection);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);

    // Check if the URL is a YouTube URL
    const isYouTubeUrl = videoUrl?.includes("youtube.com") || videoUrl?.includes("youtu.be");

    const handleError = (error: any) => {
        console.error("Video player error:", error);
        // ReactPlayer onError receives an error object or event
        if (error?.target?.error) {
            const videoError = error.target.error;
            if (videoError.code === 4) {
                setError("To use a local video, the file must be located in the project folder.");
            } else {
                setError(`Video player error: ${videoError.message || "Unknown error"}`);
            }
        } else if (error?.message) {
            setError(`Video player error: ${error.message}`);
        } else {
            setError("Failed to load video. Please check the video URL.");
        }
    };

    // React Player v3 uses standard HTML video events
    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const target = e.target as HTMLVideoElement;
        const currentTime = target.currentTime;
        onTimeUpdate?.(currentTime);
    };

    const handlePlay = () => {
        setPlaying(true);
        onPlay?.();
    };

    const handlePause = () => {
        setPlaying(false);
        onPause?.();
    };

    const handleReady = () => {
        // Player is ready, clear any previous errors
        setError(null);
        console.log("VideoPlayer: Player is ready");
        // Trigger autoPlay when player is ready
        if (autoPlay) {
            setPlaying(true);
        }
    };

    // Sync playing with autoPlay only when we intend to start; do not force pause when
    // autoPlay is false, so programmatic play (e.g. from AudioPlayButton) is not
    // interrupted and we avoid "play() request was interrupted by pause()" (AbortError).
    const prevVideoUrlRef = useRef(videoUrl);
    useEffect(() => {
        if (autoPlay && videoUrl) {
            setPlaying(true);
        } else if (prevVideoUrlRef.current !== videoUrl) {
            setPlaying(false);
            prevVideoUrlRef.current = videoUrl;
        }
    }, [videoUrl, autoPlay]);

    // Build config based on video type
    const playerConfig: Record<string, any> = {};
    if (isYouTubeUrl) {
        // YouTube config uses YouTubeVideoElement config structure
        playerConfig.youtube = {
            referrerPolicy: "strict-origin-when-cross-origin",
        };
    }

    // Helper function to get the actual video element from ReactPlayer ref
    const getVideoElement = useCallback((): HTMLVideoElement | null => {
        if (!playerRef.current) return null;

        // ReactPlayer v3 may return the video element directly, or we need to get it via getInternalPlayer
        const internalPlayer = playerRef.current.getInternalPlayer?.();
        if (internalPlayer instanceof HTMLVideoElement) {
            return internalPlayer;
        }

        // If getInternalPlayer returns an object, try to find the video element
        if (internalPlayer && typeof internalPlayer === "object") {
            const foundVideo =
                (internalPlayer as any).querySelector?.("video") ||
                (internalPlayer as any).video ||
                internalPlayer;
            if (foundVideo instanceof HTMLVideoElement) {
                return foundVideo;
            }
        }

        // Check if playerRef.current itself is a video element
        if (playerRef.current instanceof HTMLVideoElement) {
            return playerRef.current;
        }

        // Try to find video element in the DOM near the ref
        const wrapper = playerRef.current as any;
        const foundVideo =
            wrapper.querySelector?.("video") || wrapper.parentElement?.querySelector?.("video");
        if (foundVideo instanceof HTMLVideoElement) {
            return foundVideo;
        }

        return null;
    }, [playerRef]);

    // Add subtitle tracks for local videos (React Player v3 uses standard HTML video elements)
    useEffect(() => {
        if (subtitleUrl && showSubtitles && !isYouTubeUrl) {
            // Use a small delay to ensure ReactPlayer has mounted and the ref is available
            const timeoutId = setTimeout(() => {
                const videoElement = getVideoElement();
                if (!videoElement) return;

                // Remove existing tracks
                const existingTracks = videoElement.querySelectorAll("track");
                existingTracks.forEach((track) => track.remove());

                // Add subtitle track
                const track = document.createElement("track");
                track.kind = "subtitles";
                track.src = subtitleUrl;
                track.srclang = "en"; // FIXME: make this dynamic
                track.label = "English"; // FIXME: make this dynamic
                track.default = true;
                videoElement.appendChild(track);
            }, 100);

            return () => clearTimeout(timeoutId);
        }
    }, [subtitleUrl, showSubtitles, isYouTubeUrl, getVideoElement]);

    // Add direct timeupdate listener to video element for more frequent updates
    // This ensures audio synchronization works even if onProgress doesn't fire frequently enough
    useEffect(() => {
        if (!onTimeUpdate) return;

        let cleanup: (() => void) | null = null;

        const setupListener = () => {
            const videoElement = getVideoElement();
            if (!videoElement) {
                // Try again after a short delay if video element isn't ready
                const timeoutId = setTimeout(() => {
                    const delayedVideoElement = getVideoElement();
                    if (delayedVideoElement) {
                        const handleTimeUpdate = () => {
                            onTimeUpdate(delayedVideoElement.currentTime);
                        };
                        delayedVideoElement.addEventListener("timeupdate", handleTimeUpdate);
                        cleanup = () => {
                            delayedVideoElement.removeEventListener("timeupdate", handleTimeUpdate);
                        };
                    }
                }, 500);
                return () => clearTimeout(timeoutId);
            }

            const handleTimeUpdate = () => {
                onTimeUpdate(videoElement.currentTime);
            };

            videoElement.addEventListener("timeupdate", handleTimeUpdate);
            cleanup = () => {
                videoElement.removeEventListener("timeupdate", handleTimeUpdate);
            };
        };

        const initialCleanup = setupListener();
        return () => {
            if (cleanup) cleanup();
            if (initialCleanup) initialCleanup();
        };
    }, [onTimeUpdate, getVideoElement, videoUrl]);

    // Log video URL for debugging
    useEffect(() => {
        if (videoUrl) {
            console.log("VideoPlayer: videoUrl =", videoUrl);
        } else {
            console.warn("VideoPlayer: videoUrl is empty or undefined");
        }
    }, [videoUrl]);

    return (
        <div style={{ position: "relative" }}>
            <div
                className="player-wrapper"
                style={{ height: playerHeight || "auto", backgroundColor: "black" }}
            >
                {!videoUrl ? (
                    <div className="error-message" style={{ color: "white", padding: "20px" }}>
                        No video URL provided. Please set a video URL in the metadata.
                    </div>
                ) : error ? (
                    <div className="error-message" style={{ color: "white", padding: "20px" }}>
                        {error}
                    </div>
                ) : (
                    <ReactPlayer
                        key={subtitleUrl}
                        ref={playerRef}
                        src={videoUrl}
                        playing={playing}
                        controls={true}
                        width="100%"
                        height={playerHeight}
                        onError={handleError}
                        onReady={handleReady}
                        config={playerConfig}
                        onProgress={
                            // ReactPlayer v3 onProgress receives { playedSeconds, played, loaded, loadedSeconds }
                            // but TypeScript types incorrectly expect SyntheticEvent
                            ((state: { playedSeconds: number }) => {
                                // Handle time updates via onProgress for better compatibility
                                onTimeUpdate?.(state.playedSeconds);
                            }) as any
                        }
                        // Also listen to the video element's timeupdate event for more frequent updates
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={handlePlay}
                        onPause={handlePause}
                    />
                )}
            </div>
        </div>
    );
};

export default VideoPlayer;
