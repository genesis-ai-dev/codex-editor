import React, { useEffect, useState } from "react";
import { CustomWaveformCanvas } from "./CustomWaveformCanvas.tsx";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { MessageCircle, Copy, Loader2 } from "lucide-react";

interface AudioWaveformWithTranscriptionProps {
    audioUrl: string;
    audioBlob?: Blob | null;
    transcription?: {
        content: string;
        timestamp: number;
        language?: string;
    } | null;
    isTranscribing: boolean;
    transcriptionProgress: number;
    onTranscribe: () => void;
    onInsertTranscription: () => void;
    disabled?: boolean;
}

const AudioWaveformWithTranscription: React.FC<AudioWaveformWithTranscriptionProps> = ({
    audioUrl,
    audioBlob,
    transcription,
    isTranscribing,
    transcriptionProgress,
    onTranscribe,
    onInsertTranscription,
    disabled = false,
}) => {
    const [dataUrl, setDataUrl] = useState<string>("");

    useEffect(() => {
        if (audioBlob) {
            const reader = new FileReader();
            reader.onloadend = () => {
                setDataUrl(reader.result as string);
            };
            reader.readAsDataURL(audioBlob);
        } else if (audioUrl && audioUrl.startsWith("data:")) {
            setDataUrl(audioUrl);
        } else {
            setDataUrl("");
        }
    }, [audioBlob, audioUrl]);

    return (
        <div className="bg-[var(--vscode-editor-background)] p-4 sm:p-6 rounded-lg shadow-md w-full">
            <div className="mb-4 bg-[var(--vscode-editorWarning-foreground)]/10 border border-[var(--vscode-editorWarning-foreground)]/20 rounded-lg p-3">
                <div className="flex items-start gap-2">
                    <div className="text-[var(--vscode-editorWarning-foreground)] mt-0.5">
                        <svg
                            xmlns="http://www.w3.org/2000/svg"
                            width="16"
                            height="16"
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        >
                            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
                            <line x1="12" y1="9" x2="12" y2="13" />
                            <line x1="12" y1="17" x2="12.01" y2="17" />
                        </svg>
                    </div>
                </div>
            </div>

            {/* Transcription Section */}
            <div className="mb-4">
                {isTranscribing ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2">
                            <Loader2 className="h-4 w-4 animate-spin text-[var(--vscode-button-background)]" />
                            <span className="text-sm text-[var(--vscode-foreground)]">
                                Transcribing... {Math.round(transcriptionProgress)}%
                            </span>
                        </div>
                        {transcriptionProgress > 0 && (
                            <div className="w-full bg-[var(--vscode-editor-background)] rounded-full h-2">
                                <div
                                    className="bg-[var(--vscode-button-background)] h-2 rounded-full transition-all duration-300"
                                    style={{ width: `${transcriptionProgress}%` }}
                                />
                            </div>
                        )}
                    </div>
                ) : transcription ? (
                    <div className="space-y-3">
                        <div className="bg-[var(--vscode-editor-background)] p-4 rounded-lg border border-[var(--vscode-panel-border)]">
                            <p className="text-sm text-[var(--vscode-foreground)] leading-relaxed mb-2">
                                {transcription.content}
                            </p>
                            {transcription.language && (
                                <Badge variant="secondary" className="text-xs">
                                    {transcription.language}
                                </Badge>
                            )}
                        </div>
                        <Button
                            onClick={onInsertTranscription}
                            disabled={disabled}
                            className="w-full bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)]"
                        >
                            <Copy className="mr-2 h-4 w-4" />
                            Insert Transcription
                        </Button>
                    </div>
                ) : (
                    <Button
                        onClick={onTranscribe}
                        disabled={disabled || (!audioUrl && !audioBlob)}
                        variant="outline"
                        className="w-full justify-center text-[var(--vscode-button-background)] border-[var(--vscode-button-background)]/20 hover:bg-[var(--vscode-button-background)]/10"
                    >
                        <MessageCircle className="mr-2 h-4 w-4" />
                        Click to transcribe audio
                    </Button>
                )}
            </div>

            {/* Waveform */}
            <div className="bg-[var(--vscode-editor-background)] p-4 rounded-lg shadow">
                {dataUrl && dataUrl.startsWith("data:") ? (
                    <CustomWaveformCanvas
                        audioUrl={dataUrl}
                        height={60}
                        showControls={true}
                        showDebugInfo={false}
                    />
                ) : (
                    <div className="flex items-center justify-center h-16 text-[var(--vscode-foreground)] text-sm">
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading waveform...
                    </div>
                )}
            </div>
        </div>
    );
};

export default AudioWaveformWithTranscription;
