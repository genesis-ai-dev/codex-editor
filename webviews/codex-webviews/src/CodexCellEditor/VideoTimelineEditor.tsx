import React, { useRef, useState, useEffect } from "react";
import ReactPlayer from "react-player";
import VideoPlayer from "./VideoPlayer";
import TimelineEditor from "./TimelineEditor";
import { QuillCellContent, TimeBlock } from "../../../../types";

interface VideoTimelineEditorProps {
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    vscode: any;
    playerRef: React.RefObject<ReactPlayer>;
}

const VideoTimelineEditor: React.FC<VideoTimelineEditorProps> = ({
    videoUrl,
    translationUnitsForSection,
    vscode,
    playerRef,
}) => {
    // const playerRef = useRef<ReactPlayer>(null);
    const [autoPlay, setAutoPlay] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);

    // Add this function to handle seeking
    const handleSeek = (time: number) => {
        if (playerRef.current) {
            playerRef.current.seekTo(time, "seconds");
        }
    };

    const removeHtmlTags = (text: string) => {
        return text
            .replace(/<[^>]*>?/g, "")
            .replace(/\n/g, " ")
            .replace(/&nbsp;/g, " ");
    };

    const data: TimeBlock[] = translationUnitsForSection.map((unit) => ({
        begin: unit.timestamps?.startTime || 0,
        end: unit.timestamps?.endTime || 0,
        text: removeHtmlTags(unit.cellContent),
        id: unit.cellMarkers[0],
    }));

    const handleTimeUpdate = (time: number) => {
        setCurrentTime(time);
    };

    return (
        <div style={{ display: "flex", flexDirection: "column" }}>
            <VideoPlayer
                playerRef={playerRef}
                videoUrl={videoUrl}
                translationUnitsForSection={translationUnitsForSection}
                autoPlay={autoPlay}
                onTimeUpdate={handleTimeUpdate}
            />
            <TimelineEditor
                autoPlay={autoPlay}
                playerRef={playerRef}
                data={data}
                vscode={vscode}
                setAutoPlay={setAutoPlay}
                currentTime={currentTime}
            />
        </div>
    );
};

export default VideoTimelineEditor;
