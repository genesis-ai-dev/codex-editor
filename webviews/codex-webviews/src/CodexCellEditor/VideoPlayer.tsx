import React, { useEffect, useState } from "react";
import ReactPlayer, { Config } from "react-player";
import { useSubtitleData } from "./utils/vttUtils";
import { QuillCellContent } from "../../../../types";

interface VideoPlayerProps {
    playerRef: React.RefObject<ReactPlayer>;
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    showSubtitles?: boolean;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    playerRef,
    videoUrl,
    translationUnitsForSection,
    showSubtitles = true,
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
    const [playerHeight, setPlayerHeight] = useState<number | undefined>(undefined);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (playerRef.current) {
            // @ts-expect-error: wrapper is not typed
            const height = playerRef.current.wrapper.clientHeight;
            setPlayerHeight(height);
        }
    }, [playerRef]);

    const handleError = (e: any) => {
        console.error("Video player error:", e);
        if (e.target.error.code === 4) {
            setError("To use a local video, the file must be located in the project folder.");
        }
    };

    return (
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
                    playing={true}
                    controls={true}
                    width="100%"
                    onError={handleError}
                    config={{
                        file: file,
                    }}
                />
            )}
        </div>
    );
};

export default VideoPlayer;
