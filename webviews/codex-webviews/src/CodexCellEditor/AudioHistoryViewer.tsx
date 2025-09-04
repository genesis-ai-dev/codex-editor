import React, { useState, useEffect, useRef } from "react";
import { Button } from "../components/ui/button";
import { Play, Pause, RotateCcw, Trash2, Download, Clock, User, CheckCircle, Circle } from "lucide-react";
import { WebviewApi } from "vscode-webview";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

interface AudioHistoryEntry {
    attachmentId: string;
    attachment: {
        url: string;
        type: string;
        createdAt: number;
        updatedAt: number;
        isDeleted: boolean;
    };
}

interface AudioHistoryViewerProps {
    cellId: string;
    vscode: WebviewApi<unknown>;
    onClose: () => void;
}

export const AudioHistoryViewer: React.FC<AudioHistoryViewerProps> = ({
    cellId,
    vscode,
    onClose
}) => {
    const [audioHistory, setAudioHistory] = useState<AudioHistoryEntry[]>([]);
    const [playingId, setPlayingId] = useState<string | null>(null);
    const [audioUrls, setAudioUrls] = useState<Map<string, string>>(new Map());
    const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
    const [selectedAudioId, setSelectedAudioId] = useState<string | null>(null);
    const [hasExplicitSelection, setHasExplicitSelection] = useState<boolean>(false);
    const audioRefs = useRef<Map<string, HTMLAudioElement>>(new Map());

    // Request audio history when component mounts
    useEffect(() => {
        vscode.postMessage({
            command: "getAudioHistory",
            content: { cellId }
        });
    }, [cellId, vscode]);

    // Listen for audio history response
    useMessageHandler("audioHistoryViewer", (event: MessageEvent) => {
        const message = event.data;
        if (message.type === "audioHistoryReceived" && message.content.cellId === cellId) {
            setAudioHistory(message.content.audioHistory);
            // Use the currentAttachmentId from the backend (this reflects the actual selection state)
            setSelectedAudioId(message.content.currentAttachmentId);
            setHasExplicitSelection(message.content.hasExplicitSelection);
        }
        if (message.type === "audioAttachmentRestored" && message.content.cellId === cellId) {
            // Refresh audio history after restoration
            vscode.postMessage({
                command: "getAudioHistory",
                content: { cellId }
            });
        }
        if (message.type === "audioAttachmentSelected" && message.content.cellId === cellId) {
            if (message.content.success) {
                // Immediately update the selected state
                setSelectedAudioId(message.content.audioId);
                setHasExplicitSelection(true);
            }
        }
        if (message.type === "providerSendsAudioData") {
            const { cellId: audioCellId, audioId, audioData } = message.content;
            if (audioCellId === cellId && audioData) {
                // Convert base64 to blob URL
                fetch(audioData)
                    .then(res => res.blob())
                    .then(blob => {
                        const blobUrl = URL.createObjectURL(blob);
                        setAudioUrls(prev => new Map(prev).set(audioId, blobUrl));
                        setLoadingIds(prev => {
                            const next = new Set(prev);
                            next.delete(audioId);
                            return next;
                        });
                    })
                    .catch(console.error);
            }
        }
    }, [cellId, vscode]);

    // Clean up blob URLs on unmount
    useEffect(() => {
        return () => {
            audioUrls.forEach(url => {
                if (url.startsWith("blob:")) {
                    URL.revokeObjectURL(url);
                }
            });
            audioRefs.current.forEach(audio => {
                audio.pause();
            });
        };
    }, [audioUrls]);

    const handlePlayAudio = async (attachmentId: string) => {
        try {
            // Stop any currently playing audio
            if (playingId && playingId !== attachmentId) {
                const currentAudio = audioRefs.current.get(playingId);
                if (currentAudio) {
                    currentAudio.pause();
                    currentAudio.currentTime = 0;
                }
            }

            if (playingId === attachmentId) {
                // Stop current audio
                const audio = audioRefs.current.get(attachmentId);
                if (audio) {
                    audio.pause();
                    audio.currentTime = 0;
                }
                setPlayingId(null);
                return;
            }

            // Request audio data if not already loaded
            if (!audioUrls.has(attachmentId)) {
                setLoadingIds(prev => new Set(prev).add(attachmentId));
                vscode.postMessage({
                    command: "requestAudioForCell",
                    content: { cellId, audioId: attachmentId }
                });
                return;
            }

            const audioUrl = audioUrls.get(attachmentId);
            if (!audioUrl) return;

            let audio = audioRefs.current.get(attachmentId);
            if (!audio) {
                audio = new Audio();
                audio.onended = () => setPlayingId(null);
                audio.onerror = () => {
                    console.error("Error playing audio:", attachmentId);
                    setPlayingId(null);
                };
                audioRefs.current.set(attachmentId, audio);
            }

            audio.src = audioUrl;
            await audio.play();
            setPlayingId(attachmentId);
        } catch (error) {
            console.error("Error handling audio playback:", error);
            setPlayingId(null);
        }
    };

    const handleRestoreAudio = (attachmentId: string) => {
        vscode.postMessage({
            command: "restoreAudioAttachment",
            content: {
                cellId,
                audioId: attachmentId
            }
        });
    };

    const handleDeleteAudio = (attachmentId: string) => {
        vscode.postMessage({
            command: "deleteAudioAttachment",
            content: {
                cellId,
                audioId: attachmentId
            }
        });
        // Refresh history after deletion
        setTimeout(() => {
            vscode.postMessage({
                command: "getAudioHistory",
                content: { cellId }
            });
        }, 100);
    };

    const handleSelectAudio = (attachmentId: string) => {
        vscode.postMessage({
            command: "selectAudioAttachment",
            content: {
                cellId,
                audioId: attachmentId
            }
        });
    };

    // Helper function to determine current attachment (latest non-deleted)
    const getCurrentAttachment = (history: AudioHistoryEntry[]) => {
        const nonDeleted = history.filter(entry => !entry.attachment.isDeleted);
        if (nonDeleted.length === 0) return null;
        
        // Sort by updatedAt (newest first)
        nonDeleted.sort((a, b) => (b.attachment.updatedAt || 0) - (a.attachment.updatedAt || 0));
        return nonDeleted[0];
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleString(undefined, {
            year: 'numeric',
            month: 'short',
            day: 'numeric',
            hour: '2-digit',
            minute: '2-digit'
        });
    };

    const getLatestAttachment = () => {
        return audioHistory.find(entry => !entry.attachment.isDeleted);
    };

    const currentAttachment = getLatestAttachment();

    return (
        <div style={{
            position: "fixed",
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            backgroundColor: "rgba(0, 0, 0, 0.5)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            zIndex: 1000
        }}>
            <div style={{
                backgroundColor: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-panel-border)",
                borderRadius: "8px",
                padding: "20px",
                maxWidth: "680px",
                maxHeight: "80vh",
                overflow: "auto",
                width: "92%",
                boxShadow: "0 10px 24px rgba(0,0,0,0.3)"
            }}>
                <div style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    marginBottom: "16px",
                    borderBottom: "1px solid var(--vscode-editor-foreground)",
                    paddingBottom: "12px"
                }}>
                    <h3 style={{ margin: 0, color: "var(--vscode-editor-foreground)" }}>
                        Audio History for {cellId}
                    </h3>
                    <button
                        onClick={onClose}
                        style={{
                            background: "transparent",
                            border: "none",
                            cursor: "pointer",
                            color: "var(--vscode-editor-foreground)",
                            fontSize: "18px"
                        }}
                    >
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>

                <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                    {audioHistory.length > 0 ? (
                        audioHistory.map((entry, index) => {
                            const isCurrent = entry === currentAttachment; // Latest non-deleted
                            const isSelected = selectedAudioId === entry.attachmentId; // Currently active (either explicit or automatic)
                            const isPlaying = playingId === entry.attachmentId;
                            const isLoading = loadingIds.has(entry.attachmentId);

                            return (
                                <div
                                    key={entry.attachmentId}
                                    style={{
                                        padding: "12px",
                                        border: "1px solid var(--vscode-panel-border)",
                                        borderRadius: "6px",
                                        backgroundColor: entry.attachment.isDeleted
                                            ? "var(--vscode-inputValidation-errorBackground)"
                                            : isCurrent
                                            ? "var(--vscode-editor-selectionBackground)"
                                            : "var(--vscode-editorWidget-background)",
                                        opacity: entry.attachment.isDeleted ? 0.9 : 1
                                    }}
                                >
                                    <div style={{
                                        display: "flex",
                                        justifyContent: "space-between",
                                        alignItems: "center",
                                        marginBottom: "8px"
                                    }}>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "8px",
                                            fontSize: "0.95em",
                                            color: "var(--vscode-foreground)"
                                        }}>
                                            <Clock size={14} />
                                            <span>Created: {formatDate(entry.attachment.createdAt)}</span>
                                            {entry.attachment.updatedAt !== entry.attachment.createdAt && (
                                                <span>• Updated: {formatDate(entry.attachment.updatedAt)}</span>
                                            )}
                                        </div>
                                        <div style={{
                                            display: "flex",
                                            alignItems: "center",
                                            gap: "4px"
                                        }}>
                                            {isSelected && (
                                                <span style={{
                                                    backgroundColor: "var(--vscode-badge-background)",
                                                    color: "var(--vscode-badge-foreground)",
                                                    padding: "2px 6px",
                                                    borderRadius: "3px",
                                                    fontSize: "0.8em",
                                                    fontWeight: "bold"
                                                }}>
                                                    SELECTED
                                                </span>
                                            )}
                                            {isCurrent && !hasExplicitSelection && (
                                                <span style={{
                                                    backgroundColor: "var(--vscode-editorInfo-foreground)",
                                                    color: "var(--vscode-editor-background)",
                                                    padding: "2px 6px",
                                                    borderRadius: "3px",
                                                    fontSize: "0.8em",
                                                    fontWeight: "bold"
                                                }}>
                                                    CURRENT
                                                </span>
                                            )}
                                            {entry.attachment.isDeleted && (
                                                <span style={{
                                                    backgroundColor: "var(--vscode-inputValidation-errorBorder)",
                                                    color: "var(--vscode-editor-background)",
                                                    padding: "2px 6px",
                                                    borderRadius: "3px",
                                                    fontSize: "0.8em",
                                                    fontWeight: "bold"
                                                }}>
                                                    DELETED
                                                </span>
                                            )}
                                        </div>
                                    </div>

                                    <div style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "8px",
                                        flexWrap: "wrap"
                                    }}>
                                        <Button
                                            size="sm"
                                            variant="outline"
                                            onClick={() => handlePlayAudio(entry.attachmentId)}
                                            disabled={isLoading}
                                        >
                                            {isLoading ? (
                                                <span>Loading...</span>
                                            ) : isPlaying ? (
                                                <>
                                                    <Pause className="h-4 w-4 mr-1" />
                                                    Stop
                                                </>
                                            ) : (
                                                <>
                                                    <Play className="h-4 w-4 mr-1" />
                                                    Play
                                                </>
                                            )}
                                        </Button>

                                        {!entry.attachment.isDeleted && (
                                            <Button
                                                size="sm"
                                                variant={isSelected ? "default" : "outline"}
                                                onClick={() => handleSelectAudio(entry.attachmentId)}
                                                disabled={isSelected}
                                            >
                                                {isSelected ? (
                                                    <CheckCircle className="h-4 w-4 mr-1" />
                                                ) : (
                                                    <Circle className="h-4 w-4 mr-1" />
                                                )}
                                                {isSelected ? "Selected" : "Select"}
                                            </Button>
                                        )}

                                        {entry.attachment.isDeleted ? (
                                            <Button
                                                size="sm"
                                                variant="outline"
                                                onClick={() => handleRestoreAudio(entry.attachmentId)}
                                            >
                                                <RotateCcw className="h-4 w-4 mr-1" />
                                                Restore
                                            </Button>
                                        ) : (
                                            !isSelected && (
                                                <Button
                                                    size="sm"
                                                    variant="outline"
                                                    onClick={() => handleDeleteAudio(entry.attachmentId)}
                                                >
                                                    <Trash2 className="h-4 w-4 mr-1" />
                                                    Delete
                                                </Button>
                                            )
                                        )}

                                        <span style={{
                                            fontSize: "0.8em",
                                            color: "var(--vscode-descriptionForeground)",
                                            marginLeft: "auto"
                                        }}>
                                            ID: {entry.attachmentId.split('-').slice(-1)[0]}
                                        </span>
                                    </div>
                                </div>
                            );
                        })
                    ) : (
                        <div style={{
                            textAlign: "center",
                            padding: "40px",
                            color: "var(--vscode-descriptionForeground)"
                        }}>
                            <div>No audio recordings found for this cell.</div>
                        </div>
                    )}
                </div>

                <div style={{
                    marginTop: "16px",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--vscode-editor-foreground)",
                    textAlign: "center"
                }}>
                    <Button onClick={onClose} variant="outline">
                        Close
                    </Button>
                </div>
            </div>
        </div>
    );
};
