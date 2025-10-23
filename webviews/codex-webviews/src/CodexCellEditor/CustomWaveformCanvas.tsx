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
    audioBlob?: Blob | null;
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
    audioBlob,
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
    const DEBUG_LOGS = false;
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const animationRef = useRef<number>();

    const [duration, setDuration] = useState(0);
    const [currentTime, setCurrentTime] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [peaks, setPeaks] = useState<number[]>([]);
    const [hoveredTime, setHoveredTime] = useState<number | null>(null);
    const [isDragging, setIsDragging] = useState(false);
    // Smooth preview updates using a RAF throttle so dragging feels responsive without excessive rerenders
    const previewRafRef = useRef<number | null>(null);
    const pendingPreviewTimeRef = useRef<number | null>(null);
    const requestPreviewUpdate = useCallback((time: number) => {
        pendingPreviewTimeRef.current = time;
        if (previewRafRef.current == null) {
            previewRafRef.current = requestAnimationFrame(() => {
                if (pendingPreviewTimeRef.current != null) {
                    setHoveredTime(pendingPreviewTimeRef.current);
                    pendingPreviewTimeRef.current = null;
                }
                if (previewRafRef.current != null) {
                    cancelAnimationFrame(previewRafRef.current);
                }
                previewRafRef.current = null;
            });
        }
    }, []);
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

    // Decode audio when audio data becomes available (but defer expensive operations)
    useEffect(() => {
        let cancelled = false;
        const decode = async () => {
            try {
                let arrayBuffer: ArrayBuffer | null = null;
                if (audioBlob) {
                    arrayBuffer = await audioBlob.arrayBuffer();
                } else if (audioUrl) {
                    const response = await fetch(audioUrl);
                    if (!response.ok) return;
                    arrayBuffer = await response.arrayBuffer();
                }
                if (!arrayBuffer) return;
                if (cancelled) return;
                
                // Use a low-priority timeout to avoid blocking the UI thread
                setTimeout(async () => {
                    try {
                        if (cancelled) return;
                        const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)();
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        if (cancelled) return;
                        if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
                            setDuration(audioBuffer.duration);
                            setCurrentTime(0);
                        }
                        const generatedPeaks = await generatePeaks(audioBuffer, numberOfBars);
                        if (cancelled) return;
                        setPeaks(generatedPeaks);
                        hasLoadedRef.current = true;
                    } catch {
                        // Ignore; will retry on interaction
                    }
                }, 100); // Small delay to avoid blocking cell opening
            } catch {
                // Ignore; will retry on interaction
            }
        };
        if (audioBlob || audioUrl) decode();
        return () => {
            cancelled = true;
        };
    }, [audioUrl, audioBlob, numberOfBars, generatePeaks]);

    // On-demand loader for audio element and peaks
    const hasLoadedRef = useRef(false); // peaks/duration decoded
    const hasSetSrcRef = useRef(false); // <audio> src assigned

    const ensureAudioSrcSet = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;
        if (!hasSetSrcRef.current && audioUrl) {
            audio.src = audioUrl;
            hasSetSrcRef.current = true;
        }
    }, [audioUrl]);

    const ensurePeaksLoaded = useCallback(async () => {
        if (hasLoadedRef.current) return;
        
        // Wait for the automatic decoding to complete (it should already be in progress)
        return new Promise<void>((resolve) => {
            const checkLoaded = () => {
                if (hasLoadedRef.current) {
                    resolve();
                } else {
                    setTimeout(checkLoaded, 50);
                }
            };
            checkLoaded();
        });
    }, []);

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
        // During drag, reflect the previewed time in the visualization so blue/gray update in real time
        const displayTime = isDragging && hoveredTime != null ? hoveredTime : currentTime;
        const progress = duration > 0 ? displayTime / duration : 0;

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

        // Draw prominent progress line (also when progress is 0)
        if (duration > 0) {
            const progressX = progress * canvasWidth;
            
            // Draw a thick progress line
            ctx.strokeStyle = normalizeColor(colors.progress);
            ctx.lineWidth = 3;
            ctx.globalAlpha = 0.8;
            ctx.setLineDash([]);
            ctx.beginPath();
            ctx.moveTo(progressX, 0);
            ctx.lineTo(progressX, height);
            ctx.stroke();
            
            // Add a subtle glow effect
            ctx.shadowColor = normalizeColor(colors.progress);
            ctx.shadowBlur = 6;
            ctx.strokeStyle = normalizeColor(colors.progress);
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(progressX, 0);
            ctx.lineTo(progressX, height);
            ctx.stroke();
            
            // Reset shadow and alpha
            ctx.shadowBlur = 0;
            ctx.globalAlpha = 1;
        }

        // Draw hover/drag preview cursor and time tooltip
        if ((showHover || isDragging) && hoveredTime !== null && duration > 0) {
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

    // Animation loop for visual updates AND time updates (backup for timeupdate event)
    useEffect(() => {
        const animate = () => {
            // Backup time update in case timeupdate event doesn't fire
            // Only update during normal playback, not during loading
            if (audioRef.current && isPlaying && !isLoading && isFinite(duration) && duration > 0) {
                const audioCurrentTime = audioRef.current.currentTime;
                if (isFinite(audioCurrentTime) && audioCurrentTime >= 0 && audioCurrentTime !== currentTime) {
                    // Throttle updates to prevent rapid traversal
                    const timeDiff = Math.abs(audioCurrentTime - currentTime);
                    if (timeDiff >= 0.1) { // Only update if difference is significant (100ms)
                        setCurrentTime(audioCurrentTime);
                    }
                }
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
    }, [drawWaveform, isPlaying, currentTime, isLoading, duration]);

    // Audio event handlers
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const handleLoadedMetadata = () => {
            const audioDuration = audio.duration;
            if (DEBUG_LOGS) console.log("Audio metadata loaded, duration:", audioDuration);
            // If we already have a valid duration from decoded buffer, just ensure not loading
            if (isFinite(duration) && duration > 0 && duration !== Infinity) {
                setIsLoading(false);
                return;
            }
            
            // Validate duration
            if (isFinite(audioDuration) && audioDuration > 0 && audioDuration !== Infinity) {
                setDuration(audioDuration);
                setIsLoading(false);
                setError(null);
                setCurrentTime(0); // Reset current time to prevent fast traversal
                if (DEBUG_LOGS) console.log("✅ Duration set successfully:", audioDuration);
            } else {
                if (DEBUG_LOGS) console.warn("⚠️ Invalid audio duration:", audioDuration, "readyState:", audio.readyState);
                // For base64 data URLs, duration might not be available until later
                let retryCount = 0;
                const retryDuration = () => {
                    retryCount++;
                    if (retryCount > 20) { // Stop after 2 seconds
                        // As a fallback, if we decoded buffers already, use that duration instead of erroring
                        if (duration > 0 && isFinite(duration) && duration !== Infinity) {
                            setIsLoading(false);
                            return;
                        } else {
                            if (DEBUG_LOGS) console.error("❌ Failed to get audio duration after retries");
                            setIsLoading(false);
                            return;
                        }
                    }
                    
                    if (isFinite(audio.duration) && audio.duration > 0 && audio.duration !== Infinity) {
                        setDuration(audio.duration);
                        setIsLoading(false);
                        setError(null);
                        setCurrentTime(0); // Reset current time
                        if (DEBUG_LOGS) console.log("✅ Duration set after retry:", audio.duration);
                    } else {
                        setTimeout(retryDuration, 100);
                    }
                };
                retryDuration();
            }
        };
        const handleEnded = () => setIsPlaying(false);
        const handlePlay = () => {
            setIsPlaying(true);
            setIsLoading(false);
            setError(null);
        };
        const handlePause = () => setIsPlaying(false);
        const handleError = () => {
            // Ignore spurious errors before we intentionally set a src
            if (!hasSetSrcRef.current) {
                return;
            }
            setError("Error loading audio. Please try a different file.");
            setIsLoading(false);
        };
        const handleDurationChange = () => {
            const audioDuration = audio.duration;
            if (isFinite(audioDuration) && audioDuration > 0 && audioDuration !== Infinity) {
                setDuration(audioDuration);
                setIsLoading(false);
                setError(null);
                setCurrentTime(0); // Reset current time
                if (DEBUG_LOGS) console.log("✅ Duration updated:", audioDuration);
            }
        };
        
        const handleCanPlay = () => {
            setIsLoading(false);
            // Sometimes duration becomes available at canplay instead of loadedmetadata
            if (audio.duration && isFinite(audio.duration) && audio.duration > 0 && duration === 0) {
                setDuration(audio.duration);
                setCurrentTime(0); // Reset current time
                console.log("✅ Duration loaded:", audio.duration);
            }
        };
        
        const handleWaiting = () => {
            // Only show loading while actively playing/buffering
            if (isPlaying && audio.readyState < 3) {
                setIsLoading(true);
            }
        };
        
        const handlePlaying = () => {
            setIsLoading(false);
            // Final fallback - sometimes duration is only available when playing starts
            if (audio.duration && isFinite(audio.duration) && audio.duration > 0 && duration === 0) {
                setDuration(audio.duration);
                setCurrentTime(0); // Reset current time
                console.log("✅ Duration loaded:", audio.duration);
            }
        };
        
        const handleTimeUpdate = () => {
            // Only update time if audio is properly loaded and not in loading phase
            if (isLoading || !isFinite(duration) || duration <= 0) {
                return;
            }
            
            const newTime = audio.currentTime;
            if (isFinite(newTime) && newTime >= 0) {
                setCurrentTime(newTime);
            }
        };

        audio.addEventListener("loadedmetadata", handleLoadedMetadata);
        audio.addEventListener("durationchange", handleDurationChange);
        audio.addEventListener("timeupdate", handleTimeUpdate);
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
        audio.autoplay = false;

        // If audio is already loaded (e.g. from cache)
        if (audio.readyState >= 2) {
            handleLoadedMetadata();
        }
        
        // Do not auto-load on URL changes; we lazy-load on first interaction

        return () => {
            audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
            audio.removeEventListener("durationchange", handleDurationChange);
            audio.removeEventListener("timeupdate", handleTimeUpdate);
            audio.removeEventListener("ended", handleEnded);
            audio.removeEventListener("play", handlePlay);
            audio.removeEventListener("pause", handlePause);
            audio.removeEventListener("error", handleError);
            audio.removeEventListener("canplay", handleCanPlay);
            audio.removeEventListener("waiting", handleWaiting);
            audio.removeEventListener("playing", handlePlaying);
        };
    }, [volume, playbackRate, duration]);

    // Handle audio URL changes
    useEffect(() => {
        const audio = audioRef.current;
        if (!audio || !audioUrl) {
            return;
        }
        // Do nothing on URL change; we now lazy-load on demand
    }, [audioUrl]);

    const togglePlayPause = useCallback(async () => {
        const audio = audioRef.current;
        
        // More lenient conditions - only block for critical issues
        if (!audio || error) {
            return;
        }
        
        // Ensure audio and peaks are loaded on first play
        if (!hasLoadedRef.current) {
            await ensurePeaksLoaded();
        }
        ensureAudioSrcSet();

        if (isPlaying) {
            audio.pause();
        } else {
            // Ensure playback rate is correct before playing
            audio.playbackRate = playbackRate;
            try {
                await audio.play();
            } catch (e) {
                // Auto-play may be blocked; try resuming AudioContext then retry once
                try {
                    const ctx = (window as any).AudioContext ? new (window as any).AudioContext() : null;
                    if (ctx && ctx.state === "suspended") {
                        await ctx.resume();
                    }
                } catch {}
                try {
                    await audio.play();
                } catch (err) {
                    console.error("Error playing audio:", err);
                    setError("Could not play audio.");
                }
            }
        }
    }, [isPlaying, error, isLoading, duration, playbackRate, ensurePeaksLoaded, ensureAudioSrcSet]);

    const handleSeekChange = useCallback(
        (value: number) => {
            const audio = audioRef.current;
            if (!audio || error || !isFinite(value) || value < 0) {
                return;
            }
            
            // Clamp the value to valid range
            const clampedValue = Math.max(0, Math.min(duration || 0, value));
            
            try {
                audio.currentTime = clampedValue;
                setCurrentTime(clampedValue);
            } catch (e) {
                console.error("Error seeking audio:", e);
            }
        },
        [error, duration]
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
            if (!interact || !audioRef.current || !isFinite(duration) || duration <= 0 || error) {
                return;
            }

            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left;
            const clickProgress = Math.max(0, Math.min(1, x / rect.width)); // Clamp between 0 and 1
            const newTime = clickProgress * duration;

            handleSeekChange(newTime);
        },
        [interact, duration, error, handleSeekChange]
    );

    // End dragging on mouse up anywhere in the window
    useEffect(() => {
        const handleMouseUp = (e: MouseEvent) => {
            if (isDragging && interact && !error && isFinite(duration) && duration > 0) {
                // Commit the previewed time once dragging ends
                const commitTime = Math.max(0, Math.min(duration, hoveredTime ?? currentTime));
                handleSeekChange(commitTime);
            }
            setIsDragging(false);
        };
        window.addEventListener("mouseup", handleMouseUp);
        return () => window.removeEventListener("mouseup", handleMouseUp);
    }, [isDragging, hoveredTime, duration, interact, error, handleSeekChange, currentTime]);

    const handleCanvasMouseMove = useCallback(
        (e: React.MouseEvent<HTMLCanvasElement>) => {
            const rect = canvasRef.current?.getBoundingClientRect();
            if (!rect) return;

            const x = e.clientX - rect.left;
            const progress = Math.max(0, Math.min(1, x / rect.width));
            const timeAtCursor = progress * duration;

            if (isDragging && interact && !error && isFinite(duration) && duration > 0) {
                // During drag, update only a local preview (throttled)
                requestPreviewUpdate(timeAtCursor);
            } else if (showHover && duration !== 0 && !error) {
                requestPreviewUpdate(timeAtCursor);
            }
        },
        [showHover, duration, error, isDragging, interact, handleSeekChange, requestPreviewUpdate]
    );

    const handleCanvasMouseLeave = useCallback(() => {
        setHoveredTime(null);
        setIsDragging(false);
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

    // Remove verbose logs that could impact performance

    const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;
    return (
        <div
            className="waveform-canvas bg-[var(--vscode-editor-background)] p-4 rounded-lg shadow-md w-full"
            ref={containerRef}
        >
            {/* Canvas */}
            <div className="relative mb-4 pl-12 pb-5">
                {/* No spinner overlay to avoid flicker; keep UI calm */}
                {error && !isLoading && (
                    <div className="absolute inset-0 flex flex-col items-center justify-center bg-[var(--vscode-errorForeground)]/10 rounded z-10 p-4">
                        <AlertTriangle className="h-8 w-8 text-[var(--vscode-errorForeground)] mb-2" />
                        <p className="text-[var(--vscode-errorForeground)] text-sm text-center">
                            {error}
                        </p>
                    </div>
                )}
                {/* Overlay play/pause button on left-center of waveform */}
                {!error && (
                    <div className="absolute inset-y-0 left-2 flex items-center z-20 pointer-events-none">
                        <Button
                            size="icon"
                            variant="ghost"
                            className="bg-[var(--vscode-button-background)] hover:bg-[var(--vscode-button-hoverBackground)] text-[var(--vscode-button-foreground)] rounded-full w-9 h-9 pointer-events-auto"
                            onClick={togglePlayPause}
                            disabled={!!error || isLoading}
                            title={
                                isLoading && hasLoadedRef.current
                                    ? "Downloading audio..."
                                    : isPlaying
                                        ? "Pause (Space)"
                                        : "Play (Space)"
                            }
                        >
                            {isPlaying ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                        </Button>
                    </div>
                )}
                {/* Overlay time text at bottom-right of waveform */}
                {!error && (
                    <div className="absolute bottom-0 right-2 z-20 pointer-events-none text-xs sm:text-sm text-[var(--vscode-foreground)] font-mono whitespace-nowrap tabular-nums">
                        {formatTime(currentTime)} / {formatTime(duration)}
                    </div>
                )}
                <canvas
                    ref={canvasRef}
                    style={{
                        width: "100%",
                        height: height,
                        cursor: interact && !error ? (isDragging ? "grabbing" : "grab") : "default",
                        borderRadius: "0.25rem",
                        opacity: error ? 0.5 : 1,
                    }}
                    onClick={async (e) => {
                        // On click, always place the marker (seek), even if not playing
                        if (interact && !error) {
                            if (!hasLoadedRef.current) {
                                await ensurePeaksLoaded();
                            }
                            ensureAudioSrcSet();
                            handleCanvasClick(e);
                        }
                    }}
                    onMouseMove={handleCanvasMouseMove}
                    onMouseLeave={handleCanvasMouseLeave}
                    onMouseDown={async (e) => {
                        if (!interact || error) return;
                        if (!hasLoadedRef.current) {
                            await ensurePeaksLoaded();
                        }
                        ensureAudioSrcSet();
                        if (!isFinite(duration) || duration <= 0) return;
                        setIsDragging(true);
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const x = e.clientX - rect.left;
                        const progress = Math.max(0, Math.min(1, x / rect.width));
                        const newTime = progress * duration;
                        // Start with a preview; commit on mouseup
                        requestPreviewUpdate(newTime);
                    }}
                    onTouchStart={async (e) => {
                        if (!interact || error) return;
                        if (!hasLoadedRef.current) {
                            await ensurePeaksLoaded();
                        }
                        ensureAudioSrcSet();
                        if (!isFinite(duration) || duration <= 0) return;
                        setIsDragging(true);
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const touch = e.touches[0];
                        const x = touch.clientX - rect.left;
                        const progress = Math.max(0, Math.min(1, x / rect.width));
                        const newTime = progress * duration;
                        requestPreviewUpdate(newTime);
                    }}
                    onTouchMove={(e) => {
                        const rect = canvasRef.current?.getBoundingClientRect();
                        if (!rect) return;
                        const touch = e.touches[0];
                        const x = touch.clientX - rect.left;
                        const progress = Math.max(0, Math.min(1, x / rect.width));
                        const newTime = progress * duration;
                        if (isDragging && interact && !error && isFinite(duration) && duration > 0) {
                            requestPreviewUpdate(newTime);
                        }
                    }}
                    onTouchEnd={() => {
                        if (isDragging && interact && !error && isFinite(duration) && duration > 0 && hoveredTime != null) {
                            const commitTime = Math.max(0, Math.min(duration, hoveredTime));
                            handleSeekChange(commitTime);
                        }
                        setIsDragging(false);
                    }}
                />
            </div>

            {/* Controls */}
            {showControls && (
                <div className="space-y-3">
                    {/* Play button and time are overlaid on the canvas above */}

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
                                    "py-3 select-none",
                                    "[&>span:nth-child(1)]:bg-[var(--vscode-button-background)]/20",
                                    "[&>span>span]:bg-[var(--vscode-button-background)]",
                                    "[&>span:nth-child(1)]:cursor-pointer",
                                    "[&_[role=slider]]:bg-[var(--vscode-button-background)] [&_[role=slider]]:w-3 [&_[role=slider]]:h-3 [&_[role=slider]]:cursor-grab [&_[role=slider]]:active:cursor-grabbing",
                                    "cursor-pointer"
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

            {/* Debug Information (hidden by default) */}
            {false && showDebugInfo && (
                <Accordion type="single" collapsible className="w-full mt-4">
                    <AccordionItem value="debug-info">
                        <AccordionTrigger className="text-sm text-[var(--vscode-foreground)]">
                            Debug: Audio Information
                        </AccordionTrigger>
                        <AccordionContent>
                            <div className="space-y-2">
                                {error ? (
                                    <Badge variant="destructive">Error loading</Badge>
                                ) : isLoading ? null : null}
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

            <audio ref={audioRef} src="" preload="none" className="hidden" />
        </div>
    );
};
