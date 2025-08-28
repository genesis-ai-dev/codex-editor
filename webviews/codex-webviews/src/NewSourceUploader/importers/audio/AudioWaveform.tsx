import React, { useEffect, useRef, useState, useCallback } from "react";
import { Button } from "../../../components/ui/button";
import { Slider } from "../../../components/ui/slider";
import { Label } from "../../../components/ui/label";
import { Play, Pause, Plus, X, Scissors } from "lucide-react";
import { Badge } from "../../../components/ui/badge";

interface AudioSegment {
    startSec: number;
    endSec: number;
}

interface AudioWaveformProps {
    file: File;
    segments: AudioSegment[];
    onSegmentsChange: (segments: AudioSegment[]) => void;
    silenceThreshold?: number;
    minSilenceDuration?: number;
}

export const AudioWaveform: React.FC<AudioWaveformProps> = ({
    file,
    segments,
    onSegmentsChange,
    silenceThreshold = -40, // dB
    minSilenceDuration = 0.5, // seconds
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [audioContext] = useState(
        () => new (window.AudioContext || (window as any).webkitAudioContext)()
    );
    const [isPlaying, setIsPlaying] = useState(false);
    const [playbackSource, setPlaybackSource] = useState<AudioBufferSourceNode | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [hoveredSegment, setHoveredSegment] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [draggedSplit, setDraggedSplit] = useState<number | null>(null);

    // Load and decode audio file
    useEffect(() => {
        const loadAudio = async () => {
            try {
                const arrayBuffer = await file.arrayBuffer();
                const buffer = await audioContext.decodeAudioData(arrayBuffer);
                setAudioBuffer(buffer);
                setDuration(buffer.duration);

                // Auto-detect silence if no segments exist
                if (segments.length === 1 && !isFinite(segments[0].endSec)) {
                    detectSilence(buffer);
                }
            } catch (error) {
                console.error("Failed to decode audio:", error);
            }
        };
        loadAudio();
    }, [file]);

    // Detect silence in audio buffer
    const detectSilence = useCallback(
        (buffer: AudioBuffer) => {
            const channelData = buffer.getChannelData(0);
            const sampleRate = buffer.sampleRate;
            const windowSize = Math.floor(sampleRate * 0.05); // 50ms windows
            const threshold = Math.pow(10, silenceThreshold / 20); // Convert dB to linear
            const minSilenceSamples = Math.floor(minSilenceDuration * sampleRate);

            const silenceRegions: Array<{ start: number; end: number }> = [];
            let inSilence = false;
            let silenceStart = 0;
            let silenceSamples = 0;

            for (let i = 0; i < channelData.length; i += windowSize) {
                // Calculate RMS of window
                let sum = 0;
                const windowEnd = Math.min(i + windowSize, channelData.length);
                for (let j = i; j < windowEnd; j++) {
                    sum += channelData[j] * channelData[j];
                }
                const rms = Math.sqrt(sum / (windowEnd - i));

                if (rms < threshold) {
                    // In silence
                    if (!inSilence) {
                        inSilence = true;
                        silenceStart = i;
                        silenceSamples = windowSize;
                    } else {
                        silenceSamples += windowSize;
                    }
                } else {
                    // Not in silence
                    if (inSilence && silenceSamples >= minSilenceSamples) {
                        silenceRegions.push({
                            start: silenceStart / sampleRate,
                            end: i / sampleRate,
                        });
                    }
                    inSilence = false;
                    silenceSamples = 0;
                }
            }

            // Handle trailing silence
            if (inSilence && silenceSamples >= minSilenceSamples) {
                silenceRegions.push({
                    start: silenceStart / sampleRate,
                    end: channelData.length / sampleRate,
                });
            }

            // Convert silence regions to segments
            const newSegments: AudioSegment[] = [];
            let lastEnd = 0;

            for (const silence of silenceRegions) {
                if (silence.start > lastEnd + 0.1) {
                    // Minimum segment duration 100ms
                    newSegments.push({
                        startSec: lastEnd,
                        endSec: silence.start,
                    });
                }
                lastEnd = silence.end;
            }

            // Add final segment if needed
            if (lastEnd < buffer.duration - 0.1) {
                newSegments.push({
                    startSec: lastEnd,
                    endSec: buffer.duration,
                });
            }

            // If no segments found, keep the whole file as one segment
            if (newSegments.length === 0) {
                newSegments.push({
                    startSec: 0,
                    endSec: buffer.duration,
                });
            }

            onSegmentsChange(newSegments);
        },
        [silenceThreshold, minSilenceDuration, onSegmentsChange]
    );

    // Draw waveform
    useEffect(() => {
        if (!audioBuffer || !canvasRef.current) return;

        const canvas = canvasRef.current;
        const ctx = canvas.getContext("2d");
        if (!ctx) return;

        // Set canvas size
        const rect = canvas.getBoundingClientRect();
        canvas.width = rect.width * window.devicePixelRatio;
        canvas.height = rect.height * window.devicePixelRatio;
        ctx.scale(window.devicePixelRatio, window.devicePixelRatio);

        const width = rect.width;
        const height = rect.height;
        const channelData = audioBuffer.getChannelData(0);
        const step = Math.ceil(channelData.length / width);
        const amplitude = height / 2;

        // Clear canvas
        ctx.fillStyle = "#f3f4f6";
        ctx.fillRect(0, 0, width, height);

        // Draw segments background
        segments.forEach((segment, index) => {
            const x = (segment.startSec / duration) * width;
            const w = ((segment.endSec - segment.startSec) / duration) * width;

            if (hoveredSegment === index) {
                ctx.fillStyle = "rgba(59, 130, 246, 0.1)";
            } else {
                ctx.fillStyle = index % 2 === 0 ? "rgba(0, 0, 0, 0.02)" : "rgba(0, 0, 0, 0.05)";
            }
            ctx.fillRect(x, 0, w, height);
        });

        // Draw waveform
        ctx.beginPath();
        ctx.strokeStyle = "#3b82f6";
        ctx.lineWidth = 1;

        for (let i = 0; i < width; i++) {
            let min = 1.0;
            let max = -1.0;

            for (let j = 0; j < step; j++) {
                const datum = channelData[i * step + j];
                if (datum < min) min = datum;
                if (datum > max) max = datum;
            }

            ctx.moveTo(i, amplitude + min * amplitude);
            ctx.lineTo(i, amplitude + max * amplitude);
        }

        ctx.stroke();

        // Draw segment boundaries
        segments.forEach((segment, index) => {
            if (index > 0) {
                const x = (segment.startSec / duration) * width;
                ctx.strokeStyle = "#ef4444";
                ctx.lineWidth = 2;
                ctx.setLineDash([5, 3]);
                ctx.beginPath();
                ctx.moveTo(x, 0);
                ctx.lineTo(x, height);
                ctx.stroke();
                ctx.setLineDash([]);
            }
        });

        // Draw playback position
        if (isPlaying && currentTime > 0) {
            const x = (currentTime / duration) * width;
            ctx.strokeStyle = "#10b981";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, height);
            ctx.stroke();
        }
    }, [audioBuffer, segments, duration, hoveredSegment, isPlaying, currentTime]);

    // Handle canvas click to add split
    const handleCanvasClick = useCallback(
        (event: React.MouseEvent<HTMLCanvasElement>) => {
            if (!canvasRef.current || !duration || isDragging) return;

            const rect = canvasRef.current.getBoundingClientRect();
            const x = event.clientX - rect.left;
            const clickTime = (x / rect.width) * duration;

            // Find which segment was clicked
            const segmentIndex = segments.findIndex(
                (seg) => clickTime >= seg.startSec && clickTime <= seg.endSec
            );

            if (segmentIndex >= 0) {
                // Split the segment at click point
                const segment = segments[segmentIndex];
                const newSegments = [...segments];
                newSegments.splice(
                    segmentIndex,
                    1,
                    { startSec: segment.startSec, endSec: clickTime },
                    { startSec: clickTime, endSec: segment.endSec }
                );
                onSegmentsChange(newSegments);
            }
        },
        [segments, duration, isDragging, onSegmentsChange]
    );

    // Handle removing a split
    const removeSplit = useCallback(
        (index: number) => {
            if (segments.length <= 1) return;

            const newSegments = [...segments];
            if (index > 0) {
                // Merge with previous segment
                newSegments[index - 1].endSec = newSegments[index].endSec;
                newSegments.splice(index, 1);
            } else if (index < segments.length - 1) {
                // Merge with next segment
                newSegments[index + 1].startSec = newSegments[index].startSec;
                newSegments.splice(index, 1);
            }
            onSegmentsChange(newSegments);
        },
        [segments, onSegmentsChange]
    );

    // Play a specific segment
    const playSegment = useCallback(
        async (segment: AudioSegment) => {
            if (!audioBuffer) return;

            // Stop current playback
            if (playbackSource) {
                playbackSource.stop();
                setPlaybackSource(null);
            }

            const source = audioContext.createBufferSource();
            source.buffer = audioBuffer;
            source.connect(audioContext.destination);

            const duration = segment.endSec - segment.startSec;
            source.start(0, segment.startSec, duration);

            setPlaybackSource(source);
            setIsPlaying(true);

            source.onended = () => {
                setIsPlaying(false);
                setPlaybackSource(null);
            };
        },
        [audioBuffer, audioContext, playbackSource]
    );

    // Stop playback
    const stopPlayback = useCallback(() => {
        if (playbackSource) {
            playbackSource.stop();
            setPlaybackSource(null);
            setIsPlaying(false);
        }
    }, [playbackSource]);

    return (
        <div className="space-y-4">
            {/* Controls */}
            <div className="flex gap-4 items-center">
                <div className="flex-1 space-y-2">
                    <Label>Silence Threshold (dB)</Label>
                    <Slider
                        value={[silenceThreshold]}
                        onValueChange={([val]) => detectSilence(audioBuffer!)}
                        min={-60}
                        max={-20}
                        step={1}
                        className="flex-1"
                    />
                </div>
                <div className="flex-1 space-y-2">
                    <Label>Min Silence Duration (s)</Label>
                    <Slider
                        value={[minSilenceDuration]}
                        onValueChange={([val]) => detectSilence(audioBuffer!)}
                        min={0.1}
                        max={2}
                        step={0.1}
                        className="flex-1"
                    />
                </div>
                <Button
                    onClick={() => audioBuffer && detectSilence(audioBuffer)}
                    variant="outline"
                    disabled={!audioBuffer}
                >
                    <Scissors className="mr-2 h-4 w-4" />
                    Auto-Split
                </Button>
            </div>

            {/* Waveform */}
            <div className="relative">
                <canvas
                    ref={canvasRef}
                    className="w-full h-32 border rounded cursor-crosshair"
                    onClick={handleCanvasClick}
                />
                <div className="absolute top-2 right-2 flex gap-2">
                    <Badge>{segments.length} segments</Badge>
                    <Badge variant="outline">{duration.toFixed(1)}s</Badge>
                </div>
            </div>

            {/* Segment list */}
            <div className="space-y-1 max-h-40 overflow-y-auto">
                {segments.map((segment, index) => (
                    <div
                        key={index}
                        className="flex items-center gap-2 p-1 hover:bg-gray-50 rounded"
                        onMouseEnter={() => setHoveredSegment(index)}
                        onMouseLeave={() => setHoveredSegment(null)}
                    >
                        <Badge variant="outline" className="font-mono text-xs">
                            {index + 1}
                        </Badge>
                        <span className="font-mono text-sm flex-1">
                            {segment.startSec.toFixed(2)}s - {segment.endSec.toFixed(2)}s
                        </span>
                        <span className="text-xs text-muted-foreground">
                            ({(segment.endSec - segment.startSec).toFixed(2)}s)
                        </span>
                        <Button size="sm" variant="ghost" onClick={() => playSegment(segment)}>
                            {isPlaying ? (
                                <Pause className="h-3 w-3" />
                            ) : (
                                <Play className="h-3 w-3" />
                            )}
                        </Button>
                        {segments.length > 1 && (
                            <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => removeSplit(index)}
                                className="text-destructive hover:text-destructive"
                            >
                                <X className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                ))}
            </div>
        </div>
    );
};

export default AudioWaveform;
