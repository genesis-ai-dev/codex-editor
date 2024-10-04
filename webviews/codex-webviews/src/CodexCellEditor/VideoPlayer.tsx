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

    useEffect(() => {
        if (playerRef.current) {
            // @ts-expect-error: wrapper is not typed
            const height = playerRef.current.wrapper.clientHeight;
            setPlayerHeight(height);
        }
    }, [playerRef]);

    return (
        <div
            className="player-wrapper"
            style={{ height: playerHeight || "auto", backgroundColor: "black" }}
        >
            <ReactPlayer
                key={subtitleUrl} // Add the key prop with subtitleUrl as the value
                ref={playerRef}
                url={videoUrl}
                playing={true}
                controls={true}
                width="100%"
                // height={playerHeight || "auto"} // Set the height to the fixed value or "auto" if not available
                config={{
                    file: file,
                }}
            />
        </div>
    );
};

export default VideoPlayer;
