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
