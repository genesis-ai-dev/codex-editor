import React, { useEffect, useState } from "react";
import Timeline from "./Timeline/index";
import { EditorPostMessages, TimeBlock } from "../../../../types";
import ReactPlayer from "react-player";

// React Player v3 returns HTMLVideoElement but may expose additional methods
interface ReactPlayerRef extends HTMLVideoElement {
    seekTo?: (amount: number, type?: "seconds" | "fraction") => void;
    getCurrentTime?: () => number;
    getSecondsLoaded?: () => number;
    getDuration?: () => number;
    getInternalPlayer?: (key?: string) => any;
}

interface TimelineEditorProps {
    playerRef: React.RefObject<ReactPlayerRef>;
    data: TimeBlock[];
    vscode: any;
    setAutoPlay: (autoPlay: boolean) => void;
    autoPlay: boolean;
    currentTime: number;
}

const getListOfTimeBlocksWithUpdatedTimes = (
    newTimeBlocks: TimeBlock[],
    oldTimeBlocks: TimeBlock[]
) => {
    const timeBlocksWithUpdates: TimeBlock[] = [];
    newTimeBlocks.forEach((newTimeBlock) => {
        const oldBlock = oldTimeBlocks.find((block) => block.id === newTimeBlock.id);

        if (oldBlock) {
            if (newTimeBlock.begin !== oldBlock.begin) {
                timeBlocksWithUpdates.push(newTimeBlock);
            } else if (newTimeBlock.end !== oldBlock.end) {
                timeBlocksWithUpdates.push(newTimeBlock);
            } else {
                return;
            }
        }
    });
    return timeBlocksWithUpdates;
};

const TimelineEditor: React.FC<TimelineEditorProps> = ({
    playerRef,
    data,
    vscode,

    setAutoPlay,
    autoPlay,
    currentTime,
}) => {
    const [timeBlocksWithUpdates, setTimeBlocksWithUpdates] = useState<TimeBlock[]>([]);
    const [zoomLevel, setZoomLevel] = useState(90);
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                maxWidth: "40rem",
                alignSelf: "center",
                width: "100%",
            }}
        >
            <Timeline
                autoPlay={autoPlay}
                setAutoPlay={setAutoPlay}
                initialZoomLevel={zoomLevel}
                changeAreaShow={(start: number, end: number) => {
                    // console.log({ start, end });
                }}
                changeZoomLevel={(zoomLevel: number) => {
                    setZoomLevel(zoomLevel);
                }}
                changeShift={(shift: number) => {
                    // console.log({ shift });
                }}
                setAligns={(alignments: TimeBlock[]) => {
                    const timeBlocksWithUpdates = getListOfTimeBlocksWithUpdatedTimes(
                        alignments,
                        data
                    );
                    setTimeBlocksWithUpdates(timeBlocksWithUpdates);
                }}
                playerRef={playerRef}
                // audioRef={playerRef}
                src={"..."}
                data={data}
                autoScroll
                colors={{
                    background: "transparent",
                    box: "#a9a9a9",
                    boxHover: "#80add6",
                    selectedBox: "#1890ff",
                    playingBox: "#f0523f",
                    text: "#212b33",
                    selectedText: "white",
                    tooltipBackground: "#474e54",
                    tooltipText: "white",
                    scrollBarBackground: "#f1f3f9",
                    scrollBar: "#c2c9d6",
                    scrollBarHover: "#8f96a3",
                }}
                disableResetButton={!(timeBlocksWithUpdates.length > 0)}
                onSave={() => {
                    vscode.postMessage({
                        command: "saveTimeBlocks",
                        content: timeBlocksWithUpdates,
                    }) as EditorPostMessages;
                }}
                onReset={() => {
                    setTimeBlocksWithUpdates([]);
                }}
                disableSaveButton={!(timeBlocksWithUpdates.length > 0)}
            />
        </div>
    );
};

export default TimelineEditor;
