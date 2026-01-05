import React, { useState, useEffect } from "react";
import ReactPlayer from "react-player";
import type { Config } from "react-player/dist/types";
import { useSubtitleData } from "./utils/vttUtils";
import { QuillCellContent } from "../../../../types";

// React Player v3 returns HTMLVideoElement but may expose additional methods
interface ReactPlayerRef extends HTMLVideoElement {
    seekTo?: (amount: number, type?: "seconds" | "fraction") => void;
    getCurrentTime?: () => number;
    getSecondsLoaded?: () => number;
    getDuration?: () => number;
    getInternalPlayer?: (key?: string) => any;
}

interface VideoPlayerProps {
    playerRef: React.RefObject<ReactPlayerRef>;
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    showSubtitles?: boolean;
    onTimeUpdate?: (time: number) => void;
    autoPlay: boolean;
    playerHeight: number;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    playerRef,
    videoUrl,
    translationUnitsForSection,
    showSubtitles = true,
    onTimeUpdate,
    autoPlay,
    playerHeight,
}) => {
    const { subtitleUrl } = useSubtitleData(translationUnitsForSection);
    const [error, setError] = useState<string | null>(null);

    // Check if the URL is a YouTube URL
    const isYouTubeUrl = videoUrl?.includes("youtube.com") || videoUrl?.includes("youtu.be");

    const handleError = (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
        console.error("Video player error:", e);
        const target = e.target as HTMLVideoElement;
        if (target?.error?.code === 4) {
            setError("To use a local video, the file must be located in the project folder.");
        } else {
            setError(`Video player error: ${target?.error?.message || "Unknown error"}`);
        }
    };

    // React Player v3 uses standard HTML video events
    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const target = e.target as HTMLVideoElement;
        const currentTime = target.currentTime;
        onTimeUpdate?.(currentTime);
    };

    // Build config based on video type
    const playerConfig: Config = {};
    if (isYouTubeUrl) {
        // YouTube config uses YouTubeVideoElement config structure
        playerConfig.youtube = {
            referrerPolicy: "strict-origin-when-cross-origin",
        } as any; // Type assertion needed as YouTubeVideoElement config type may vary
    }

    // Add subtitle tracks for local videos (React Player v3 uses standard HTML video elements)
    useEffect(() => {
        if (subtitleUrl && showSubtitles && !isYouTubeUrl && playerRef.current) {
            const videoElement = playerRef.current;

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
        }
    }, [subtitleUrl, showSubtitles, isYouTubeUrl]);

    return (
        <div style={{ position: "relative" }}>
            <div
                className="player-wrapper"
                style={{ height: playerHeight || "auto", backgroundColor: "black" }}
            >
                {error ? (
                    <div className="error-message" style={{ color: "white", padding: "20px" }}>
                        {error}
                    </div>
                ) : (
                    <ReactPlayer
                        key={subtitleUrl}
                        ref={playerRef}
                        src={videoUrl}
                        controls={true}
                        width="100%"
                        height={playerHeight}
                        onError={handleError}
                        config={playerConfig}
                        onTimeUpdate={handleTimeUpdate}
                    />
                )}
            </div>
        </div>
    );
};

export default VideoPlayer;
