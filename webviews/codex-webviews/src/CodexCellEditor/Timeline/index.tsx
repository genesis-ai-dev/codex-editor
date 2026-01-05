import React, { useContext, useEffect, useRef, useState } from "react";
import TimeLine, { TimelineReturn } from "./T";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./index.css";
import { TimeBlock } from "../../../../../types";
import ReactPlayer from "react-player";
import ZoomButton from "./ZoomButton";
import ScrollToContentContext from "../contextProviders/ScrollToContentContext";
import type { ReactPlayerRef } from "../types/reactPlayerTypes";

export interface TimelineProps {
    setAutoPlay: (autoPlay: boolean) => void;
    autoPlay: boolean;
    playerRef?: React.RefObject<ReactPlayerRef>;
    changeAreaShow: (beginingTimeShow: number, endTimeShow: number) => void;
    changeZoomLevel: (zoomLevel: number) => void;
    changeShift: (shift: number) => void;
    setAligns: (alignments: TimeBlock[]) => void;
    audioRef?: React.RefObject<HTMLAudioElement>;
    src: string;
    data: TimeBlock[];
    autoScroll: boolean;
    colors: {
        background: string;
        box: string;
        boxHover: string;
        selectedBox: string;
        playingBox: string;
        text: string;
        selectedText: string;
        tooltipBackground: string;
        tooltipText: string;
        scrollBarBackground: string;
        scrollBar: string;
        scrollBarHover: string;
    };
    paddingLeft?: number;
    disableResetButton?: boolean;
    disableSaveButton?: boolean;
    onSave: () => void;
    onReset: () => void;
    initialZoomLevel?: number; // Add this new prop
}

export default function Timeline(props: TimelineProps) {
    // const [scrollingIsTracking, setScrollingIsTracking] = useState(true);
    const [scrollPosition, setScrollPosition] = useState(0);
    let timeLine: TimelineReturn | undefined;
    let shift: number;
    let zoomLevel: number;
    let data: TimeBlock[];
    let beginingTimeShow: number;
    let endTimeShow: number;
    const canvas1 = useRef(null);
    const canvasAudio = useRef(null);
    const canvas2 = useRef(null);

    const { setContentToScrollTo, contentToScrollTo } = useContext(ScrollToContentContext);
    const changeAlignment = (z: TimeBlock[]) => {
        data = z;
        props.setAligns(z);
    };

    const changeZoomLevel = (z: number) => {
        props.changeZoomLevel(z);
        zoomLevel = z;
    };

    const changeShift = (s: number) => {
        props.changeShift(s);
        shift = s;
    };

    const changeAreaShow = (b: number, e: number) => {
        props.changeAreaShow(b, e);
        beginingTimeShow = b;
        endTimeShow = e;
    };

    const changeInScrollPosition = (position: number) => {
        setScrollPosition(position);
    };

    const defaultFunction = () => {};

    const drawTimeLine = (p: TimelineProps & { endTime: number }) => {
        timeLine = TimeLine({
            canvas: canvas1.current as unknown as HTMLCanvasElement,
            canvas2: canvas2.current as unknown as HTMLCanvasElement,
            alignments: p.data,
            endTime: p.endTime,
            setContentToScrollTo: (id) => {
                if (id && id !== contentToScrollTo) {
                    setContentToScrollTo(id);
                }
            },
            getPlayer: () => ({
                currentTime: props.playerRef?.current?.getCurrentTime?.() || 0,
                play: (currentTime: number) => {
                    props.playerRef?.current?.seekTo?.(currentTime);
                    // props.playerRef?.current?.forceUpdate();
                },
            }),
            changeAlignment: changeAlignment || defaultFunction,
            changeZoomLevel: changeZoomLevel || defaultFunction,
            changeInScrollPosition: changeInScrollPosition || defaultFunction,
            changeShift: changeShift || defaultFunction,
            tellAreaChangesToRectComponent: changeAreaShow || defaultFunction,
            options: {
                autoScroll: props.autoScroll,
                initialZoomLevel: props.initialZoomLevel, // Pass the prop through
                scrollingIsTracking: true,
                scrollPosition: scrollPosition,
                colors: {
                    background: props.colors?.background || "transparent",
                    box: props.colors?.box || "#a9a9a9",
                    boxHover: props.colors?.boxHover || "#80add6",
                    selectedBox: props.colors?.selectedBox || "#1890ff",
                    playingBox: props.colors?.playingBox || "#f0523f",
                    text: props.colors?.text || "#212b33",
                    selectedText: props.colors?.selectedText || "white",
                    tooltipBackground: props.colors?.tooltipBackground || "#474e54",
                    tooltipText: props.colors?.tooltipText || "white",
                    scrollBarBackground: props.colors?.scrollBarBackground || "#f1f3f9",
                    scrollBar: props.colors?.scrollBar || "#c2c9d6",
                    scrollBarHover: props.colors?.scrollBarHover || "#8f96a3",
                },
            },
        });
    };

    const resetTimeline = () => {
        if (props.data.length > 0 && props.src) {
            drawTimeLine({ ...props, endTime: props.playerRef?.current?.getDuration?.() || 0 });
        }
    };

    useEffect(() => {
        resetTimeline();
        return () => {
            if (timeLine) timeLine.cancelAnimate();
        };
    }, [props.data, props.src, props.initialZoomLevel]); // Add props.resetTimeline to the dependency array

    const style = {
        height: "90px",
        paddingLeft: props.paddingLeft,
        width: "100%",
    };

    const initialZoomLevel = props.initialZoomLevel || 1;
    return (
        <div style={{ display: "flex", flexDirection: "row" }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "end",
                    flexDirection: "column",
                    flex: 1,
                    // gap: "10px",
                    // padding: "10px",
                    backgroundColor: "var(--vscode-scrollbar-shadow)",
                }}
            >
                <VSCodeButton
                    style={{
                        display: "flex",
                        flex: 1,
                        borderRadius: 0,
                    }}
                    onClick={() => {
                        props.setAutoPlay(!props.autoPlay);
                    }}
                >
                    <i
                        className={`codicon codicon-${
                            props.autoPlay ? "run-errors" : "run-all-coverage"
                        }`}
                    ></i>
                </VSCodeButton>
                <ZoomButton
                    initialZoomLevel={initialZoomLevel}
                    changeZoomLevel={changeZoomLevel}
                    zoomIn={true}
                />

                <ZoomButton
                    initialZoomLevel={initialZoomLevel}
                    changeZoomLevel={changeZoomLevel}
                    zoomIn={false}
                />
            </div>
            <div style={style} className="timeline-editor">
                <div hidden>
                    <audio src={props.src} ref={props.audioRef || canvasAudio} />
                </div>
                <div className="wrap z-index-2">
                    <canvas style={{ display: "block" }} ref={canvas1}></canvas>
                </div>
                <div className="wrap z-index-1">
                    <canvas style={{ display: "block" }} ref={canvas2}></canvas>
                </div>
            </div>
            <div
                style={{
                    display: "flex",
                    justifyContent: "end",
                    flexDirection: "column",
                    flex: 1,
                    // gap: "10px",
                    // padding: "10px",
                    backgroundColor: "var(--vscode-scrollbar-shadow)",
                }}
            >
                <VSCodeButton
                    style={{
                        display: "flex",
                        flex: 1,
                        borderRadius: 0,
                    }}
                    appearance="secondary"
                    disabled={props.disableResetButton}
                    onClick={() => {
                        resetTimeline();
                        props.onReset();
                    }}
                >
                    <i className="codicon codicon-refresh"></i>
                </VSCodeButton>

                <VSCodeButton
                    style={{
                        display: "flex",
                        flex: 2,
                        borderRadius: 0,
                    }}
                    disabled={props.disableSaveButton}
                    onClick={() => {
                        props.onSave();
                    }}
                >
                    <i className="codicon codicon-save"></i>
                </VSCodeButton>
            </div>
        </div>
    );
}
