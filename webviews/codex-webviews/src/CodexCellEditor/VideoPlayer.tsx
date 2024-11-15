import React, { useEffect, useState } from "react";
import ReactPlayer, { Config } from "react-player";
import { useSubtitleData } from "./utils/vttUtils";
import { QuillCellContent } from "../../../../types";

interface VideoPlayerProps {
    playerRef: React.RefObject<ReactPlayer>;
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
    let file: Config["file"] = undefined;
    if (subtitleUrl && showSubtitles) {
        file = {
            tracks: [
                {
                    kind: "subtitles",
                    src: subtitleUrl,
                    srcLang: "en", // FIXME: make this dynamic
                    label: "English", // FIXME: make this dynamic
                    default: true,
                },
            ],
        };
    }
    const [error, setError] = useState<string | null>(null);

    const handleError = (e: any) => {
        console.error("Video player error:", e);
        if (e.target.error.code === 4) {
            setError("To use a local video, the file must be located in the project folder.");
        }
    };
    const handleProgress = (state: {
        played: number;
        playedSeconds: number;
        loaded: number;
        loadedSeconds: number;
    }) => {
        onTimeUpdate?.(state.playedSeconds);
    };

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
                        url={videoUrl}
                        playing={autoPlay}
                        volume={0}
                        controls={true}
                        width="100%"
                        height={playerHeight}
                        onError={handleError}
                        config={{
                            file: file,
                        }}
                        onProgress={handleProgress}
                    />
                )}
            </div>
        </div>
    );
};

export default VideoPlayer;
