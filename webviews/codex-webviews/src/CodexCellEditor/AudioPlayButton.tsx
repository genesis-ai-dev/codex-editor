import React, { useEffect, useRef, useState } from "react";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../lib/audioCache";
import { globalAudioController, type AudioControllerEvent } from "../lib/audioController";
import type { WebviewApi } from "vscode-webview";
import type { EditorPostMessages } from "../../../../types";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

type AudioState =
    | "available"
    | "available-local"
    | "available-pointer"
    | "missing"
    | "deletedOnly"
    | "none";

interface AudioPlayButtonProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?: AudioState;
    onOpenCell?: (cellId: string) => void;
    isCellLocked?: boolean;
    onLockedClick?: () => void;
}

const AudioPlayButton: React.FC<AudioPlayButtonProps> = React.memo(
    ({ cellId, vscode, state = "available", onOpenCell, isCellLocked = false, onLockedClick }) => {
        const [isPlaying, setIsPlaying] = useState(false);
        const [audioUrl, setAudioUrl] = useState<string | null>(null);
        const [isLoading, setIsLoading] = useState(false);
        const pendingPlayRef = useRef(false);
        const audioRef = useRef<HTMLAudioElement | null>(null);

        useMessageHandler(
            "cellContentDisplay-audioData",
            async (event: MessageEvent) => {
                const message = event.data;

                if (message.type === "providerSendsAudioAttachments") {
                    const { clearCachedAudio } = await import("../lib/audioCache");
                    clearCachedAudio(cellId);

                    if (audioUrl && audioUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(audioUrl);
                    }
                    setAudioUrl(null);
                    setIsLoading(false);
                }

                if (
                    message.type === "providerSendsAudioData" &&
                    message.content.cellId === cellId
                ) {
                    if (message.content.audioData) {
                        if (audioUrl && audioUrl.startsWith("blob:")) {
                            URL.revokeObjectURL(audioUrl);
                        }

                        fetch(message.content.audioData)
                            .then((res) => res.blob())
                            .then((blob) => {
                                const blobUrl = URL.createObjectURL(blob);
                                try {
                                    setCachedAudioDataUrl(cellId, message.content.audioData);
                                } catch {
                                    /* empty */
                                }
                                setAudioUrl(blobUrl);
                                setIsLoading(false);
                                if (pendingPlayRef.current) {
                                    try {
                                        if (!audioRef.current) {
                                            audioRef.current = new Audio();
                                            audioRef.current.onended = () => setIsPlaying(false);
                                            audioRef.current.onerror = () => {
                                                console.error(
                                                    "Error playing audio for cell:",
                                                    cellId
                                                );
                                                setIsPlaying(false);
                                            };
                                        }
                                        audioRef.current.src = blobUrl;
                                        globalAudioController
                                            .playExclusive(audioRef.current)
                                            .then(() => setIsPlaying(true))
                                            .catch((e) => {
                                                console.error(
                                                    "Error auto-playing audio for cell:",
                                                    e
                                                );
                                                setIsPlaying(false);
                                            });
                                    } finally {
                                        pendingPlayRef.current = false;
                                    }
                                }
                            })
                            .catch((error) => {
                                console.error("Error converting audio data:", error);
                                setIsLoading(false);
                            });
                    } else {
                        setAudioUrl(null);
                        setIsLoading(false);
                    }
                }
            },
            [audioUrl, cellId, vscode]
        );

        useEffect(() => {
            return () => {
                if (audioUrl && audioUrl.startsWith("blob:")) {
                    URL.revokeObjectURL(audioUrl);
                }
            };
        }, [audioUrl]);

        useEffect(() => {
            return () => {
                audioRef.current?.pause();
            };
        }, []);

        const handlePlayAudio = async () => {
            try {
                if (
                    state !== "available" &&
                    state !== "available-local" &&
                    state !== "available-pointer"
                ) {
                    if (isCellLocked && state !== "missing") {
                        onLockedClick?.();
                        return;
                    }

                    if (state !== "missing" && !isCellLocked) {
                        try {
                            sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                        } catch (e) {
                            void e;
                        }
                    }
                    vscode.postMessage({
                        command: "setPreferredEditorTab",
                        content: { tab: "audio" },
                    } as EditorPostMessages);
                    if (onOpenCell) onOpenCell(cellId);
                    return;
                }

                if (isPlaying) {
                    if (audioRef.current) {
                        audioRef.current.pause();
                        audioRef.current.currentTime = 0;
                    }
                    setIsPlaying(false);
                } else {
                    let effectiveUrl: string | null = audioUrl;
                    if (!effectiveUrl) {
                        const cached = getCachedAudioDataUrl(cellId);
                        if (cached) {
                            pendingPlayRef.current = true;
                            setIsLoading(true);
                            try {
                                const res = await fetch(cached);
                                const blob = await res.blob();
                                const blobUrl = URL.createObjectURL(blob);
                                setAudioUrl(blobUrl);
                                effectiveUrl = blobUrl;
                                setIsLoading(false);
                            } catch {
                                pendingPlayRef.current = true;
                                setIsLoading(true);
                                vscode.postMessage({
                                    command: "requestAudioForCell",
                                    content: { cellId },
                                } as EditorPostMessages);
                                return;
                            }
                        } else {
                            pendingPlayRef.current = true;
                            setIsLoading(true);
                            vscode.postMessage({
                                command: "requestAudioForCell",
                                content: { cellId },
                            } as EditorPostMessages);
                            return;
                        }
                    }

                    if (!audioRef.current) {
                        audioRef.current = new Audio();
                        audioRef.current.onended = () => setIsPlaying(false);
                        audioRef.current.onerror = () => {
                            console.error("Error playing audio for cell:", cellId);
                            setIsPlaying(false);
                        };
                    }

                    audioRef.current.src = effectiveUrl || audioUrl || "";
                    await globalAudioController.playExclusive(audioRef.current);
                    setIsPlaying(true);
                }
            } catch (error) {
                console.error("Error handling audio playback:", error);
                setIsPlaying(false);
            }
        };

        useEffect(() => {
            const handler = (e: AudioControllerEvent) => {
                if (audioRef.current && e.audio === audioRef.current) {
                    setIsPlaying(false);
                }
            };
            globalAudioController.addListener(handler);
            return () => globalAudioController.removeListener(handler);
        }, []);

        const { iconClass, color } = (() => {
            if (state === "missing") {
                return {
                    iconClass: "codicon-warning",
                    color: "var(--vscode-errorForeground)",
                } as const;
            }
            if (audioUrl || getCachedAudioDataUrl(cellId)) {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : isPlaying
                          ? "codicon-debug-stop"
                          : "codicon-play",
                    color: "var(--vscode-charts-blue)",
                } as const;
            }
            if (state === "available-local") {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : isPlaying
                          ? "codicon-debug-stop"
                          : "codicon-play",
                    color: "var(--vscode-charts-blue)",
                } as const;
            }
            if (state === "available" || state === "available-pointer") {
                return {
                    iconClass: isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : "codicon-cloud-download",
                    color: "var(--vscode-charts-blue)",
                } as const;
            }
            return {
                iconClass: "codicon-mic",
                color: "var(--vscode-foreground)",
            } as const;
        })();

        return (
            <button
                onClick={handlePlayAudio}
                className="audio-play-button"
                title={
                    isLoading
                        ? "Preparing audio..."
                        : state === "available" || state === "available-pointer"
                          ? audioUrl || getCachedAudioDataUrl(cellId)
                            ? "Play"
                            : "Download"
                          : state === "available-local"
                            ? "Play"
                            : state === "missing"
                              ? "Missing audio"
                              : isCellLocked
                                ? "Cell is locked"
                                : "Record"
                }
                disabled={false}
                style={{
                    background: "none",
                    border: "none",
                    cursor: "pointer",
                    padding: "1px",
                    borderRadius: "4px",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    color,
                    opacity: isPlaying ? 1 : 0.8,
                    transition: "opacity 0.2s",
                }}
                onMouseEnter={(e) => {
                    e.stopPropagation();
                    e.currentTarget.style.opacity = "1";
                }}
                onMouseLeave={(e) => {
                    e.stopPropagation();
                    e.currentTarget.style.opacity = isPlaying ? "1" : "0.8";
                }}
            >
                <i
                    className={`codicon ${iconClass}`}
                    style={{ fontSize: "16px", position: "relative" }}
                />
            </button>
        );
    }
);

export default AudioPlayButton;
