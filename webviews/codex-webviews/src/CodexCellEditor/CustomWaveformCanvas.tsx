import React, { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { Button } from "../components/ui/button";
import { Slider } from "../components/ui/slider";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../components/ui/select";
import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "../components/ui/accordion";
import { Badge } from "../components/ui/badge";
import { Play, Pause, Volume2, Volume1, VolumeX, Loader2, AlertTriangle } from "lucide-react";
import { cn } from "../lib/utils";

interface CustomWaveformCanvasProps {
    audioUrl: string;
    height?: number;
    backgroundColor?: string;
    waveColor?: string;
    progressColor?: string;
    cursorColor?: string;
    barWidth?: number;
    barGap?: number;
    barRadius?: number;
    showHover?: boolean;
    responsive?: boolean;
    normalize?: boolean;
    interact?: boolean;
    showControls?: boolean;
    showDebugInfo?: boolean;
}

const formatTime = (time: number): string => {
    if (!isFinite(time) || isNaN(time) || time < 0) return "0:00";
    const minutes = Math.floor(time / 60);
    const seconds = Math.floor(time % 60);
    return `${minutes}:${seconds.toString().padStart(2, "0")}`;
};

// Helper function to normalize colors and handle alpha transparency safely
const normalizeColor = (color: string): string => {
    if (!color || color.trim() === "") return "#000000";

    color = color.trim();

    // If it's already a hex color, return as-is
    if (color.startsWith("#")) {
        return color;
    }

    // Handle rgb/rgba colors by converting to hex
    const rgbaMatch = color.match(/rgba?\(([^)]+)\)/);
    if (rgbaMatch) {
        const values = rgbaMatch[1].split(",").map((v) => parseFloat(v.trim()));
        const r = Math.round(Math.max(0, Math.min(255, values[0] || 0)));
        const g = Math.round(Math.max(0, Math.min(255, values[1] || 0)));
        const b = Math.round(Math.max(0, Math.min(255, values[2] || 0)));

        return `#${r.toString(16).padStart(2, "0")}${g.toString(16).padStart(2, "0")}${b
            .toString(16)
            .padStart(2, "0")}`;
    }

    // Handle named colors by creating a temporary element to get computed color
    try {
        const div = document.createElement("div");
        div.style.color = color;
        document.body.appendChild(div);
        const computedColor = window.getComputedStyle(div).color;
        document.body.removeChild(div);

        if (computedColor && computedColor !== color) {
            return normalizeColor(computedColor);
        }
    } catch (e) {
        // Fall back to default if color parsing fails
    }

    // Return a safe default
    return "#000000";
};

// Helper function to create color with alpha
const colorWithAlpha = (color: string, alphaHex: string): string => {
    const normalizedColor = normalizeColor(color);
    return normalizedColor + alphaHex;
};

// Helper function to get theme-aware colors from CSS custom properties
const getThemeColors = (element: HTMLElement) => {
    const computedStyle = getComputedStyle(element);
    return {
        background:
            computedStyle.getPropertyValue("--waveform-background").trim() ||
            computedStyle.getPropertyValue("--color-background").trim() ||
            computedStyle.getPropertyValue("--vscode-editor-background").trim() ||
            "#ffffff",
        foreground:
            computedStyle.getPropertyValue("--waveform-foreground").trim() ||
            computedStyle.getPropertyValue("--color-foreground").trim() ||
            computedStyle.getPropertyValue("--vscode-editor-foreground").trim() ||
            "#1f2937",
        muted:
            computedStyle.getPropertyValue("--waveform-muted").trim() ||
            computedStyle.getPropertyValue("--color-muted").trim() ||
            computedStyle.getPropertyValue("--vscode-input-background").trim() ||
            "#f9fafb",
        mutedForeground:
            computedStyle.getPropertyValue("--waveform-muted-foreground").trim() ||
            computedStyle.getPropertyValue("--color-muted-foreground").trim() ||
            computedStyle.getPropertyValue("--vscode-descriptionForeground").trim() ||
            "#9ca3af",
        primary:
            computedStyle.getPropertyValue("--waveform-primary").trim() ||
            computedStyle.getPropertyValue("--color-primary").trim() ||
            computedStyle.getPropertyValue("--vscode-button-background").trim() ||
            "#3b82f6",
        border:
            computedStyle.getPropertyValue("--waveform-border").trim() ||
            computedStyle.getPropertyValue("--color-border").trim() ||
            computedStyle.getPropertyValue("--vscode-panel-border").trim() ||
            "#e5e7eb",
    };
};

export const CustomWaveformCanvas: React.FC<CustomWaveformCanvasProps> = ({
    audioUrl,
    height = 80,
    backgroundColor,
    waveColor,
    progressColor,
    cursorColor,
    barWidth = 3,
    barGap = 1,
    barRadius = 2,
    showHover = true,
    responsive = true,
    normalize = true,
    interact = true,
    showControls = true,
    showDebugInfo = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const animationRef = useRef<number>();

    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [peaks, setPeaks] = useState<number[]>([]);
    const [hoveredTime, setHoveredTime] = useState<number | null>(null);
    const [volume, setVolume] = useState(1);
    const [playbackRate, setPlaybackRate] = useState(1);
    const [canvasWidth, setCanvasWidth] = useState(800);
    const [themeColors, setThemeColors] = useState({
        background: "#ffffff",
        foreground: "#1f2937",
        muted: "#f9fafb",
        mutedForeground: "#9ca3af",
        primary: "#3b82f6",
        border: "#e5e7eb",
    });

    // Update theme colors when container is available
    useEffect(() => {
        if (containerRef.current) {
            const colors = getThemeColors(containerRef.current);
            setThemeColors(colors);
        }
    }, []);

    // Also update theme colors when the theme might change (e.g., dark/light mode toggle)
    useEffect(() => {
        if (!containerRef.current) return;

        const observer = new MutationObserver(() => {
            const colors = getThemeColors(containerRef.current!);
            setThemeColors(colors);
        });

        // Watch for class changes on body/html that might indicate theme changes
        observer.observe(document.body, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
        });
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class", "data-theme"],
        });

        return () => observer.disconnect();
    }, []);

    // Calculate number of bars based on canvas width
    const numberOfBars = useMemo(() => {
        return Math.floor(canvasWidth / (barWidth + barGap));
    }, [canvasWidth, barWidth, barGap]);

    // Resize observer for responsive canvas
    useEffect(() => {
        if (!responsive || !containerRef.current) return;

        const resizeObserver = new ResizeObserver((entries) => {
            for (const entry of entries) {
                const { width } = entry.contentRect;
                setCanvasWidth(width);
            }
        });

        resizeObserver.observe(containerRef.current);
        return () => resizeObserver.disconnect();
    }, [responsive]);

    // Generate peaks from audio buffer
    const generatePeaks = useCallback(
        async (audioBuffer: AudioBuffer, samples: number) => {
            const channelData = audioBuffer.getChannelData(0);
            const blockSize = Math.floor(channelData.length / samples);
            const peaks: number[] = [];

            for (let i = 0; i < samples; i++) {
                const start = blockSize * i;
                let sum = 0;
                let max = 0;

                for (let j = 0; j < blockSize; j++) {
                    const datum = Math.abs(channelData[start + j] || 0);
                    sum += datum;
                    if (datum > max) max = datum;
                }

                // Use RMS (Root Mean Square) for smoother visualization
                const rms = Math.sqrt(sum / blockSize);
                peaks.push((max + rms) / 2); // Blend max and RMS
            }

            // Normalize peaks
            if (normalize) {
                const maxPeak = Math.max(...peaks) || 1;
                return peaks.map((p) => p / maxPeak);
            }

            return peaks;
        },
        [normalize]
    );

    // Load and decode audio
    useEffect(() => {
        if (!audioUrl) return;

        let cancelled = false;
        setIsLoading(true);
        setError(null);

        const loadAudio = async () => {
            try {
                const response = await fetch(audioUrl);
                if (!response.ok) throw new Error("Failed to fetch audio");

                const arrayBuffer = await response.arrayBuffer();
                if (cancelled) return;

                const audioContext = new (window.AudioContext ||
                    (window as any).webkitAudioContext)();
                const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                if (cancelled) return;

                const generatedPeaks = await generatePeaks(audioBuffer, numberOfBars);
                if (cancelled) return;

                setPeaks(generatedPeaks);
                setIsLoading(false);
            } catch (err) {
                if (!cancelled) {
                    setError(err instanceof Error ? err.message : "Failed to load audio");
                    setIsLoading(false);
                }
            }
        };

        loadAudio();
        return () => {
            cancelled = true;
        };
    }, [audioUrl, numberOfBars, generatePeaks]);

    // Draw waveform
    const drawWaveform = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext("2d");
        if (!canvas || !ctx || peaks.length === 0) return;

        const dpr = window.devicePixelRatio || 1;
        canvas.width = canvasWidth * dpr;
        canvas.height = height * dpr;
        ctx.scale(dpr, dpr);

        // Use theme-aware colors, with prop overrides
        const colors = {
            background: backgroundColor || themeColors.background,
            wave: waveColor || themeColors.mutedForeground,
            progress: progressColor || themeColors.primary,
            cursor: cursorColor || themeColors.foreground,
        };

        // Clear canvas
        ctx.fillStyle = normalizeColor(colors.background);
        ctx.fillRect(0, 0, canvasWidth, height);

        const barCount = Math.min(peaks.length, numberOfBars);
        const progress = duration > 0 ? currentTime / duration : 0;

        // Draw bars
        for (let i = 0; i < barCount; i++) {
            const x = i * (barWidth + barGap);
            const barHeight = peaks[i] * height * 0.9;
            const y = (height - barHeight) / 2;
            const isPlayed = i / barCount <= progress;

            // Gradient effect
            const gradient = ctx.createLinearGradient(0, y, 0, y + barHeight);
            if (isPlayed) {
                gradient.addColorStop(0, normalizeColor(colors.progress));
                gradient.addColorStop(1, colorWithAlpha(colors.progress, "88"));
            } else {
                gradient.addColorStop(0, normalizeColor(colors.wave));
                gradient.addColorStop(1, colorWithAlpha(colors.wave, "44"));
            }

            ctx.fillStyle = gradient;

            // Draw rounded rectangles
            ctx.beginPath();
            ctx.roundRect(x, y, barWidth, barHeight, barRadius);
            ctx.fill();

            // Mirror effect (bottom half)
            ctx.globalAlpha = 0.5;
            ctx.beginPath();
            ctx.roundRect(x, height - y - barHeight, barWidth, barHeight, barRadius);
            ctx.fill();
            ctx.globalAlpha = 1;
        }

        // Draw hover cursor
        if (showHover && hoveredTime !== null && duration > 0) {
            const hoverX = (hoveredTime / duration) * canvasWidth;
            ctx.strokeStyle = normalizeColor(colors.cursor);
            ctx.lineWidth = 1;
            ctx.setLineDash([5, 5]);
            ctx.beginPath();
            ctx.moveTo(hoverX, 0);
            ctx.lineTo(hoverX, height);
            ctx.stroke();
            ctx.setLineDash([]);

            // Time tooltip
            ctx.fillStyle = normalizeColor(colors.cursor);
            ctx.font = "12px sans-serif";
            const timeText = formatTime(hoveredTime);
            const textWidth = ctx.measureText(timeText).width;
            const tooltipX = Math.min(
                Math.max(hoverX - textWidth / 2, 5),
                canvasWidth - textWidth - 5
            );

            ctx.fillStyle = normalizeColor(colors.background);
            ctx.fillRect(tooltipX - 4, 2, textWidth + 8, 18);
            ctx.fillStyle = normalizeColor(colors.cursor);
            ctx.fillText(timeText, tooltipX, 14);
        }
    }, [
        peaks,
        currentTime,
        duration,
        hoveredTime,
        canvasWidth,
        height,
        numberOfBars,
        barWidth,
        barGap,
        barRadius,
        backgroundColor,
        waveColor,
        progressColor,
        cursorColor,
        themeColors,
        showHover,
    ]);

    // Animation loop for smooth updates
    useEffect(() => {
        const animate = () => {
            if (audioRef.current && isPlaying) {
                setCurrentTime(audioRef.current.currentTime);
            }
            drawWaveform();
            animationRef.current = requestAnimationFrame(animate);
        };

        animate();
        return () => {
            if (animationRef.current) {
                cancelAnimationFrame(animationRef.current);
            }
        };
    }, [drawWaveform, isPlaying]);

    // Audio event handlers
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            setDuration(audio.duration);
            setIsLoading(false);
            setError(null);
        };
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => setIsPlaying(true);
        const handlePause = () => setIsPlaying(false);
        const handleError = () => {
            setError("Error loading audio. Please try a different file.");
            setIsLoading(false);
        };
        const handleCanPlay = () => setIsLoading(false);
        const handleWaiting = () => setIsLoading(true);
        const handlePlaying = () => setIsLoading(false);

        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("ended", handleEnded);
        audio.addEventListener("play", handlePlay);
        audio.addEventListener("pause", handlePause);
        audio.addEventListener("error", handleError);
        audio.addEventListener("canplay", handleCanPlay);
        audio.addEventListener("waiting", handleWaiting);
        audio.addEventListener("playing", handlePlaying);

        // Set initial values
        audio.volume = volume;
        audio.playbackRate = playbackRate;

        // If audio is already loaded (e.g. from cache)
        if (audio.readyState >= 2) {
            handleLoadedMetadata();
        }

        return () => {
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
            audio.removeEventListener("error", handleError);
            audio.removeEventListener("canplay", handleCanPlay);
            audio.removeEventListener("waiting", handleWaiting);
            audio.removeEventListener("playing", handlePlaying);
        };
    }, [volume, playbackRate]);

    const togglePlayPause = useCallback(() => {
        const audio = audioRef.current;
        if (!audio || error) return;

        if (isPlaying) {
            audio.pause();
        } else {
            audio.play().catch((e) => {
                console.error("Error playing audio:", e);
                setError("Could not play audio.");
            });
        }
    }, [isPlaying, error]);

    const handleSeekChange = useCallback(
        (value: number) => {
            const audio = audioRef.current;
            if (!audio || error) return;
            audio.currentTime = value;
            setCurrentTime(value);
        },
        [error]
    );

    const handleVolumeChange = useCallback((value: number) => {
        const audio = audioRef.current;
        if (!audio) return;
        audio.volume = value;
        setVolume(value);
    }, []);

    const handlePlaybackRateChange = useCallback((value: string) => {
        const newRate = parseFloat(value);
        const audio = audioRef.current;
        if (!audio) return;
        audio.playbackRate = newRate;
        setPlaybackRate(newRate);
    }, []);

    const handleCanvasClick = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (!interact || !audioRef.current || duration === 0 || error) return;

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left;
            const clickProgress = x / rect.width;
            const newTime = clickProgress * duration;

            handleSeekChange(newTime);
        },
        [interact, duration, error, handleSeekChange]
    );

    const handleCanvasMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            if (!showHover || duration === 0 || error) return;

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left;
            const hoverProgress = x / rect.width;
            setHoveredTime(hoverProgress * duration);
        },
        [showHover, duration, error]
    );

    const handleCanvasMouseLeave = useCallback(() => {
        setHoveredTime(null);
    }, []);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyPress = (e: KeyboardEvent) => {
            if (
                e.target instanceof HTMLInputElement ||
                e.target instanceof HTMLSelectElement ||
                e.target instanceof HTMLTextAreaElement ||
                (e.target instanceof HTMLElement && e.target.isContentEditable)
            ) {
                return;
            }

            switch (e.code) {
                case "Space":
                    e.preventDefault();
                    togglePlayPause();
                    break;
                case "ArrowLeft":
                    e.preventDefault();
                    handleSeekChange(Math.max(0, currentTime - 5));
                    break;
                case "ArrowRight":
                    e.preventDefault();
                    handleSeekChange(Math.min(duration, currentTime + 5));
                    break;
            }
        };

        window.addEventListener("keydown", handleKeyPress);
        return () => window.removeEventListener("keydown", handleKeyPress);
    }, [currentTime, duration, togglePlayPause, handleSeekChange]);

    const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
    return (
        <div
            className="waveform-canvas bg-[var(--vscode-editor-background)] p-4 rounded-lg shadow-md w-full"
            ref={containerRef}
        >
            {/* Canvas */}
            <div className="relative mb-4">
                {isLoading && (
                    <div className="absolute inset-0 flex items-center justify-center bg-[var(--vscode-editor-background)]/80 rounded z-10">
                        <Loader2 className="h-8 w-8 text-[var(--vscode-button-background)] animate-spin" />
                    </div>
                )}
                {error && !isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--vscode-errorForeground)]/10 rounded z-10 p-4">
                        <AlertTriangle className="h-8 w-8 text-[var(--vscode-errorForeground)] mb-2" />
                        <p className="text-[var(--vscode-errorForeground)] text-sm text-center">
                            {error}
                        </p>
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    style={{
                        width: "100%",
                        height: height,
                        cursor: interact && !error ? "pointer" : "default",
                        borderRadius: "0.25rem",
                        opacity: error ? 0.5 : 1,
                    }}
                    onClick={handleCanvasClick}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseLeave={handleCanvasMouseLeave}
                />
            </div>

            {/* Controls */}
            {showControls && (
                <div className="space-y-3">
                    <div className="flex flex-col sm:flex-row items-center gap-2 sm:gap-3">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded-full w-10 h-10 flex-shrink-0"
                            onClick={togglePlayPause}
                            disabled={isLoading || !!error}
                            title={isPlaying ? "Pause (Space)" : "Play (Space)"}
                        >
                            {isPlaying ? (
                                <Pause className="w-5 h-5" />
                            ) : (
                                <Play className="w-5 h-5" />
                            )}
                        </Button>

                        <Slider
                            value={[currentTime]}
                            max={duration || 1}
                            step={0.1}
                            onValueChange={(values: number[]) => handleSeekChange(values[0])}
                            disabled={isLoading || !!error}
                            className={cn(
                                "flex-grow",
                                "[&>span:nth-child(1)]:bg-[var(--vscode-button-background)]/20",
                                "[&>span>span]:bg-[var(--vscode-button-background)]",
                                "[&_[role=slider]]:bg-[var(--vscode-button-background)] [&_[role=slider]]:w-3.5 [&_[role=slider]]:h-3.5 [&_[role=slider]]:border-2 [&_[role=slider]]:border-[var(--vscode-editor-background)]"
                            )}
                        />
                        <div className="text-xs sm:text-sm text-[var(--vscode-foreground)] font-mono whitespace-nowrap tabular-nums flex-shrink-0">
                            {formatTime(currentTime)} / {formatTime(duration)}
                        </div>
                    </div>

                    <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
                        <div className="flex items-center gap-2">
                            <VolumeIcon
                                className="h-5 w-5 text-[var(--vscode-foreground)] cursor-pointer"
                                onClick={() => handleVolumeChange(volume > 0 ? 0 : 0.5)}
                            />
                            <Slider
                                value={[volume]}
                                max={1}
                                step={0.05}
                                onValueChange={(values: number[]) => handleVolumeChange(values[0])}
                                className={cn(
                                    "w-20 sm:w-24",
                                    "[&>span:nth-child(1)]:bg-[var(--vscode-button-background)]/20",
                                    "[&>span>span]:bg-[var(--vscode-button-background)]",
                                    "[&_[role=slider]]:bg-[var(--vscode-button-background)] [&_[role=slider]]:w-3 [&_[role=slider]]:h-3"
                                )}
                                disabled={isLoading || !!error}
                            />
                            <span className="text-xs text-[var(--vscode-foreground)] w-9 text-right tabular-nums">
                                {Math.round(volume * 100)}%
                            </span>
                        </div>

                        <div className="flex items-center gap-2">
                            <span className="text-xs text-[var(--vscode-foreground)]">Speed:</span>
                            <Select
                                value={String(playbackRate)}
                                onValueChange={handlePlaybackRateChange}
                                disabled={isLoading || !!error}
                            >
                                <SelectTrigger className="w-[75px] h-8 text-xs">
                                    <SelectValue placeholder="Speed" />
                                </SelectTrigger>
                                <SelectContent>
                                    {[0.5, 0.75, 1, 1.25, 1.5, 2].map((rate) => (
                                        <SelectItem key={rate} value={String(rate)}>
                                            {rate}x
                                        </SelectItem>
                                    ))}
                                </SelectContent>
                            </Select>
                        </div>
                    </div>
                    <div className="text-xs text-[var(--vscode-descriptionForeground)] text-center">
                        Space: Play/Pause • ←/→: Skip 5s
                    </div>
                </div>
            )}

            {/* Debug Information */}
            {showDebugInfo && (
                <Accordion type="single" collapsible className="w-full mt-4">
                    <AccordionItem value="debug-info">
                        <AccordionTrigger className="text-sm text-[var(--vscode-foreground)]">
                            Debug: Audio Information
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="space-y-2">
                                {error ? (
                                    <Badge variant="destructive">Error loading</Badge>
                                ) : isLoading ? (
                                    <Badge variant="outline">Loading...</Badge>
                                ) : (
                                    <Badge variant="secondary">Audio loaded</Badge>
                                )}
                                <div className="text-xs text-[var(--vscode-descriptionForeground)] space-y-1">
                                    <p>
                                        URL:{" "}
                                        {audioUrl.length > 50
                                            ? audioUrl.substring(0, 50) + "..."
                                            : audioUrl}
                                    </p>
                                    <p>Duration: {duration.toFixed(2)}s</p>
                                    <p>Current Time: {currentTime.toFixed(2)}s</p>
                                    <p>Volume: {volume.toFixed(2)}</p>
                                    <p>Playback Rate: {playbackRate}x</p>
                                    <p>Is Playing: {isPlaying.toString()}</p>
                                    <p>Peaks: {peaks.length} samples</p>
                                    <p>Canvas Width: {canvasWidth}px</p>
                                </div>
                            </div>
                        </AccordionContent>
                    </AccordionItem>
                </Accordion>
            )}

            <audio ref={audioRef} src={audioUrl} preload="metadata" className="hidden" />
        </div>
    );
};
