import React, { useEffect, useRef, useState } from "react";
import type { WebviewApi } from "vscode-webview";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

type AudioState = "available" | "missing" | "deletedOnly" | "none";

interface AudioPlayButtonProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?: AudioState;
    onOpenCell?: (cellId: string) => void;
}

const AudioPlayButton: React.FC<AudioPlayButtonProps> = ({
    cellId,
    vscode,
    state = "available",
    onOpenCell,
}) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const pendingPlayRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useMessageHandler(
        "audioPlayButton",
        (event: MessageEvent) => {
            const message = event.data;

            if (message.type === "providerSendsAudioAttachments") {
                if (audioUrl && audioUrl.startsWith("blob:")) {
                    URL.revokeObjectURL(audioUrl);
                }
                setAudioUrl(null);
                setIsLoading(false);
            }

            if (message.type === "providerSendsAudioData" && message.content.cellId === cellId) {
                if (message.content.audioData) {
                    if (audioUrl && audioUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(audioUrl);
                    }

                    fetch(message.content.audioData)
                        .then((res) => res.blob())
                        .then((blob) => {
                            const blobUrl = URL.createObjectURL(blob);
                            setAudioUrl(blobUrl);
                            setIsLoading(false);
                            if (pendingPlayRef.current) {
                                try {
                                    if (!audioRef.current) {
                                        audioRef.current = new Audio();
                                        audioRef.current.onended = () => setIsPlaying(false);
                                        audioRef.current.onerror = () => {
                                            console.error("Error playing audio for cell:", cellId);
                                            setIsPlaying(false);
                                        };
                                    }
                                    audioRef.current.src = blobUrl;
                                    audioRef.current
                                        .play()
                                        .then(() => setIsPlaying(true))
                                        .catch(() => setIsPlaying(false));
                                } finally {
                                    pendingPlayRef.current = false;
                                }
                            }
                        })
                        .catch(() => setIsLoading(false));
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
            if (audioRef.current && isPlaying) {
                audioRef.current.pause();
            }
        };
    }, [audioUrl, isPlaying]);

    const handlePlayAudio = async () => {
        try {
            if (state !== "available") {
                // For missing audio, just open the editor without auto-starting recording
                if (state !== "missing") {
                    try {
                        sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                    } catch {
                        // no-op
                    }
                }
                vscode.postMessage({
                    command: "setPreferredEditorTab",
                    content: { tab: "audio" },
                } as any);
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
                if (!audioUrl) {
                    pendingPlayRef.current = true;
                    setIsLoading(true);
                    vscode.postMessage({
                        command: "requestAudioForCell",
                        content: { cellId },
                    } as any);
                    return;
                }

                if (!audioRef.current) {
                    audioRef.current = new Audio();
                    audioRef.current.onended = () => setIsPlaying(false);
                    audioRef.current.onerror = () => setIsPlaying(false);
                }

                audioRef.current.src = audioUrl;
                await audioRef.current.play();
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Error handling audio playback:", error);
            setIsPlaying(false);
        }
    };

    const { iconClass, color } = (() => {
        if (state === "available") {
            return {
                iconClass: isPlaying ? "codicon-debug-stop" : "codicon-play",
                color: "var(--vscode-charts-blue)",
            } as const;
        }
        if (state === "missing") {
            return {
                iconClass: "codicon-warning",
                color: "var(--vscode-errorForeground)",
            } as const;
        }
        return { iconClass: "codicon-mic", color: "var(--vscode-foreground)" } as const;
    })();

    return (
        <button
            onClick={handlePlayAudio}
            className="audio-play-button p-[1px]"
            title={
                isLoading
                    ? "Preparing audio..."
                    : state === "available"
                    ? "Play"
                    : state === "missing"
                    ? "Missing audio"
                    : "Record"
            }
            disabled={false}
            style={{
                background: "none",
                border: "none",
                cursor: "pointer",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                color,
                opacity: isPlaying ? 1 : 0.8,
                transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => (e.currentTarget.style.opacity = isPlaying ? "1" : "0.8")}
        >
            <i
                className={`codicon ${iconClass}`}
                style={{ fontSize: "16px", position: "relative" }}
            />
        </button>
    );
};

export default React.memo(AudioPlayButton);
