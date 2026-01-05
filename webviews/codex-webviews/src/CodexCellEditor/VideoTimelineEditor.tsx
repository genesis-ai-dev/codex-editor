import React, { useRef, useState, useEffect } from "react";
import ReactPlayer from "react-player";
import VideoPlayer from "./VideoPlayer";
import TimelineEditor from "./TimelineEditor";
import { QuillCellContent, TimeBlock } from "../../../../types";
import { useMouse } from "@uidotdev/usehooks";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

// React Player v3 returns HTMLVideoElement but may expose additional methods
interface ReactPlayerRef extends HTMLVideoElement {
    seekTo?: (amount: number, type?: "seconds" | "fraction") => void;
    getCurrentTime?: () => number;
    getSecondsLoaded?: () => number;
    getDuration?: () => number;
    getInternalPlayer?: (key?: string) => any;
}

interface VideoTimelineEditorProps {
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    vscode: any;
    playerRef: React.RefObject<ReactPlayerRef>;
}

const VideoTimelineEditor: React.FC<VideoTimelineEditorProps> = ({
    videoUrl,
    translationUnitsForSection,
    vscode,
    playerRef,
}) => {
    const [playerHeight, setPlayerHeight] = useState<number>(300);
    const [isDragging, setIsDragging] = useState(false);
    const [mouse] = useMouse();
    const [startY, setStartY] = useState(0);
    const [startHeight, setStartHeight] = useState(0);

    const handleMouseDown = (e: React.MouseEvent) => {
        setIsDragging(true);
        setStartY(e.clientY);
        setStartHeight(playerHeight || 0);
    };

    useEffect(() => {
        const handleMouseMove = () => {
            if (isDragging) {
                const deltaY = mouse.y - startY;
                const newHeight = Math.max(200, startHeight + deltaY); // Minimum height of 200px
                setPlayerHeight(newHeight);
            }
        };

        const handleMouseUp = () => {
            setIsDragging(false);
        };

        if (isDragging) {
            document.addEventListener("mousemove", handleMouseMove);
            document.addEventListener("mouseup", handleMouseUp);
        }

        return () => {
            document.removeEventListener("mousemove", handleMouseMove);
            document.removeEventListener("mouseup", handleMouseUp);
        };
    }, [isDragging, mouse.y, startY, startHeight]);
    // const playerRef = useRef<ReactPlayer>(null);
    const [autoPlay, setAutoPlay] = useState(true);
    const [currentTime, setCurrentTime] = useState(0);

    // Add this function to handle seeking
    const handleSeek = (time: number) => {
        if (playerRef.current) {
            playerRef.current.seekTo?.(time, "seconds");
        }
    };

    const removeHtmlTags = (text: string) => {
        return text
            .replace(/<[^>]*>?/g, "")
            .replace(/\n/g, " ")
            .replace(/&nbsp; ?/g, " ");
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
                playerHeight={playerHeight}
            />
            <TimelineEditor
                autoPlay={autoPlay}
                playerRef={playerRef}
                data={data}
                vscode={vscode}
                setAutoPlay={setAutoPlay}
                currentTime={currentTime}
            />
            <div
                style={{
                    width: "100%",
                    backgroundColor: "var(--vscode-scrollbar-shadow)",
                    cursor: "ns-resize",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
                onMouseDown={handleMouseDown}
            >
                <VSCodeButton
                    appearance="icon"
                    style={{
                        padding: 0,
                        width: "100%",
                        borderRadius: 0,
                        height: "10px",
                    }}
                >
                    <i className="codicon codicon-grabber" />
                </VSCodeButton>
            </div>
        </div>
    );
};

export default VideoTimelineEditor;
