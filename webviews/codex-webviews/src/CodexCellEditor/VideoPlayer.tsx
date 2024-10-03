import React from "react";
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
    // console.log("subtitleUrl in VideoPlayer", subtitleUrl);
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
    // console.log("file in VideoPlayer", file);
    return (
        <div className="player-wrapper">
            <ReactPlayer
                ref={playerRef}
                url={videoUrl}
                controls={true}
                width="100%"
                height="auto"
                config={{
                    file: file,
                }}
            />
        </div>
    );
};

export default VideoPlayer;
