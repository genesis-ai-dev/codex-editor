import React, { useState, useEffect } from "react";
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
        onPlay?.();
    };

    const handlePause = () => {
        onPause?.();
    };

    // Build config based on video type
    const playerConfig: Record<string, any> = {};
    if (isYouTubeUrl) {
        // YouTube config uses YouTubeVideoElement config structure
        playerConfig.youtube = {
            referrerPolicy: "strict-origin-when-cross-origin",
        };
    }

    // Add subtitle tracks for local videos (React Player v3 uses standard HTML video elements)
    useEffect(() => {
        if (subtitleUrl && showSubtitles && !isYouTubeUrl) {
            // Helper function to get the actual video element from ReactPlayer ref
            const getVideoElement = (): HTMLVideoElement | null => {
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

                // Last resort: check if playerRef.current itself is a video element
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
            };

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
    }, [subtitleUrl, showSubtitles, isYouTubeUrl, playerRef]);

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
                        ref={playerRef as React.RefObject<any>}
                        url={videoUrl}
                        controls={true}
                        width="100%"
                        height={playerHeight}
                        onError={handleError}
                        config={playerConfig}
                        onProgress={(state) => {
                            // Handle time updates via onProgress for better compatibility
                            onTimeUpdate?.(state.playedSeconds);
                        }}
                        onPlay={handlePlay}
                        onPause={handlePause}
                    />
                )}
            </div>
        </div>
    );
};

export default VideoPlayer;
