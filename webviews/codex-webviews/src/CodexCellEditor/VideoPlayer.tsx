import React, { useState, useEffect, useCallback, useRef } from "react";
import ReactPlayer from "react-player";
import { Languages } from "lucide-react";
import { useSubtitleData } from "./utils/vttUtils";
import { QuillCellContent } from "../../../../types";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuLabel,
    DropdownMenuRadioGroup,
    DropdownMenuRadioItem,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import { Button } from "../components/ui/button";

/** A selectable audio (dub) track exposed by an HLS stream. */
interface AudioTrackOption {
    id: string;
    label: string;
    language: string;
}

interface VideoPlayerProps {
    playerRef: React.RefObject<ReactPlayerRef>;
    videoUrl: string;
    translationUnitsForSection: QuillCellContent[];
    showSubtitles?: boolean;
    onTimeUpdate?: (time: number) => void;
    onPlay?: () => void;
    onPause?: () => void;
    autoPlay: boolean;
    playerHeight: number;
    /**
     * Ask the host to (re)resolve a playable URL. Used to recover from an
     * expired presigned stream URL: on a media error we request a fresh one
     * before surfacing an error to the user.
     */
    onRequestStreamUrl?: () => void;
}

const VideoPlayer: React.FC<VideoPlayerProps> = ({
    playerRef,
    videoUrl,
    translationUnitsForSection,
    showSubtitles = true,
    onTimeUpdate,
    onPlay,
    onPause,
    autoPlay,
    playerHeight,
    onRequestStreamUrl,
}) => {
    const { subtitleUrl } = useSubtitleData(translationUnitsForSection);
    const [error, setError] = useState<string | null>(null);
    const [playing, setPlaying] = useState(false);
    const [volume, setVolume] = useState(1);
    const lastVideoElementForVolumeRef = useRef<HTMLVideoElement | null>(null);

    // Alternate audio (dub) tracks carried by an HLS stream, plus which one is active.
    // These belong to the source video itself and are independent of the per-cell
    // recorded audio attachments (those play via separate <audio> elements and only
    // mute this <video>, so switching the source language here never touches them).
    const [audioTracks, setAudioTracks] = useState<AudioTrackOption[]>([]);
    const [activeAudioTrackId, setActiveAudioTrackId] = useState<string | null>(null);

    // Check if the URL is a YouTube URL
    const isYouTubeUrl = videoUrl?.includes("youtube.com") || videoUrl?.includes("youtu.be");

    // HLS streams (.m3u8) are the only sources that expose alternate audio tracks.
    const isHlsUrl = /\.m3u8(\?|#|$)/i.test(videoUrl || "");

    const handleError = (error: any) => {
        console.error("Video player error:", error);

        // A streamed (presigned) URL may have expired mid-watch, and an invalid
        // user-entered URL simply won't load. Defer recovery to the parent via
        // onRequestStreamUrl: it owns a guard that survives the player's
        // unmount/remount cycle, so it re-resolves once and then surfaces an
        // error instead of looping. (A guard here would reset on every remount.)
        // Only delegate genuine remote URLs — local/webview-resource and YouTube
        // errors are shown inline below and are not retried, so they can't loop.
        const isRemoteStreamUrl =
            /^https?:\/\//i.test(videoUrl) &&
            !/vscode-resource|vscode-cdn|vscode-webview/i.test(videoUrl) &&
            !isYouTubeUrl;
        if (onRequestStreamUrl && isRemoteStreamUrl) {
            onRequestStreamUrl();
            return;
        }

        // ReactPlayer onError receives an error object or event
        if (error?.target?.error) {
            const videoError = error.target.error;
            if (videoError.code === 4) {
                setError("To use a local video, the file must be located in the project folder.");
            } else {
                setError(`Video player error: ${videoError.message || "Unknown error"}`);
            }
        } else if (error?.message) {
            setError(`Video player error: ${error.message}`);
        } else {
            setError("Failed to load video. Please check the video URL.");
        }
    };

    // React Player v3 uses standard HTML video events
    const handleTimeUpdate = (e: React.SyntheticEvent<HTMLVideoElement>) => {
        const target = e.target as HTMLVideoElement;
        const currentTime = target.currentTime;
        onTimeUpdate?.(currentTime);
    };

    // Coalesce rapid play/pause events to avoid endless loop when switching cells quickly.
    // Only suppress events that come within a short window of the previous one.
    const lastPlayPauseTimeRef = useRef(0);
    const COALESCE_MS = 30;

    const handlePlay = () => {
        const now = Date.now();
        if (now - lastPlayPauseTimeRef.current < COALESCE_MS) return;
        lastPlayPauseTimeRef.current = now;
        setPlaying(true);
        onPlay?.();
    };

    const handlePause = () => {
        const now = Date.now();
        if (now - lastPlayPauseTimeRef.current < COALESCE_MS) return;
        lastPlayPauseTimeRef.current = now;
        setPlaying(false);
        onPause?.();
    };

    const handleReady = () => {
        setError(null);
        console.log("VideoPlayer: Player is ready");
        if (autoPlay) {
            setPlaying(true);
        }
    };

    const prevVideoUrlRef = useRef(videoUrl);
    useEffect(() => {
        if (autoPlay && videoUrl) {
            setPlaying(true);
        } else if (prevVideoUrlRef.current !== videoUrl) {
            setPlaying(false);
            prevVideoUrlRef.current = videoUrl;
        }
    }, [videoUrl, autoPlay]);

    // Build config based on video type
    const playerConfig: Record<string, any> = {};
    if (isYouTubeUrl) {
        // YouTube config uses YouTubeVideoElement config structure
        playerConfig.youtube = {
            referrerPolicy: "strict-origin-when-cross-origin",
        };
    }

    // Helper function to get the actual video element from ReactPlayer ref
    const getVideoElement = useCallback((): HTMLVideoElement | null => {
        if (!playerRef.current) return null;

        // ReactPlayer v3 may return the video element directly, or we need to get it via getInternalPlayer
        const internalPlayer = playerRef.current.getInternalPlayer?.();
        if (internalPlayer instanceof HTMLVideoElement) {
            return internalPlayer;
        }

        // If getInternalPlayer returns an object, try to find the video element
        if (internalPlayer && typeof internalPlayer === "object") {
            const foundVideo =
                (internalPlayer as any).querySelector?.("video") ||
                (internalPlayer as any).video ||
                internalPlayer;
            if (foundVideo instanceof HTMLVideoElement) {
                return foundVideo;
            }
        }

        // Check if playerRef.current itself is a video element
        if (playerRef.current instanceof HTMLVideoElement) {
            return playerRef.current;
        }

        // Try to find video element in the DOM near the ref
        const wrapper = playerRef.current as any;
        const foundVideo =
            wrapper.querySelector?.("video") || wrapper.parentElement?.querySelector?.("video");
        if (foundVideo instanceof HTMLVideoElement) {
            return foundVideo;
        }

        return null;
    }, [playerRef]);

    // For HLS, react-player renders an <hls-video> custom element whose ref carries a
    // standard AudioTrackList (populated by hls.js as the manifest parses). That element
    // is what we read alternate audio tracks from and toggle to switch languages — not the
    // inner <video>, which only sees the single track hls.js is currently feeding it.
    const getAudioTrackHost = useCallback((): (HTMLElement & { audioTracks?: any }) | null => {
        const node = playerRef.current as any;
        if (!node) return null;
        if (node.audioTracks && typeof node.audioTracks.addEventListener === "function") {
            return node;
        }
        // Fallback in case the ref points at a wrapper rather than the custom element.
        const host =
            node.querySelector?.("hls-video") || node.parentElement?.querySelector?.("hls-video");
        if (host?.audioTracks && typeof host.audioTracks.addEventListener === "function") {
            return host;
        }
        return null;
    }, [playerRef]);

    // Subscribe to the stream's audio tracks. The custom element and the manifest both
    // resolve asynchronously, so poll briefly until the AudioTrackList is reachable, then
    // let its addtrack/removetrack/change events keep our state in sync.
    useEffect(() => {
        if (!isHlsUrl) {
            setAudioTracks([]);
            setActiveAudioTrackId(null);
            return;
        }

        let trackList: (EventTarget & { length: number }) | null = null;
        let pollId: ReturnType<typeof setInterval> | null = null;
        let stopId: ReturnType<typeof setTimeout> | null = null;

        const syncFromList = () => {
            if (!trackList) return;
            const next: AudioTrackOption[] = [];
            let active: string | null = null;
            for (const t of Array.from(trackList as any) as any[]) {
                const id = String(t.id);
                next.push({ id, label: t.label || t.language || id, language: t.language || "" });
                if (t.enabled) active = id;
            }
            setAudioTracks(next);
            setActiveAudioTrackId(active);
        };

        const detach = () => {
            if (!trackList) return;
            trackList.removeEventListener("addtrack", syncFromList);
            trackList.removeEventListener("removetrack", syncFromList);
            trackList.removeEventListener("change", syncFromList);
            trackList = null;
        };

        const tryAttach = (): boolean => {
            const list = getAudioTrackHost()?.audioTracks;
            if (!list) return false;
            trackList = list;
            list.addEventListener("addtrack", syncFromList);
            list.addEventListener("removetrack", syncFromList);
            list.addEventListener("change", syncFromList);
            syncFromList();
            return true;
        };

        if (!tryAttach()) {
            pollId = setInterval(() => {
                if (tryAttach() && pollId) {
                    clearInterval(pollId);
                    pollId = null;
                }
            }, 200);
            // Give up polling after a while; a stream with no audio tracks is fine.
            stopId = setTimeout(() => {
                if (pollId) clearInterval(pollId);
            }, 10000);
        }

        return () => {
            if (pollId) clearInterval(pollId);
            if (stopId) clearTimeout(stopId);
            detach();
        };
    }, [isHlsUrl, videoUrl, getAudioTrackHost]);

    // Enable exactly the chosen track; the <hls-video> element relays this to hls.js.
    const handleSelectAudioTrack = useCallback(
        (id: string) => {
            const list = getAudioTrackHost()?.audioTracks;
            if (!list) return;
            for (const t of Array.from(list) as any[]) {
                const shouldEnable = String(t.id) === id;
                if (t.enabled !== shouldEnable) t.enabled = shouldEnable;
            }
            setActiveAudioTrackId(id);
        },
        [getAudioTrackHost]
    );

    // Own volume and re-apply on every render so it sticks despite something resetting the element.
    // Sync from native control via volumechange so user adjustments are kept in state.
    useEffect(() => {
        const videoElement = getVideoElement();
        if (!videoElement) return;

        const isNewElement = videoElement !== lastVideoElementForVolumeRef.current;
        if (isNewElement) {
            lastVideoElementForVolumeRef.current = videoElement;
            videoElement.volume = volume;
            const onVolumeChange = () => setVolume(videoElement.volume);
            videoElement.addEventListener("volumechange", onVolumeChange);
            return () => {
                videoElement.removeEventListener("volumechange", onVolumeChange);
                lastVideoElementForVolumeRef.current = null;
            };
        }
        videoElement.volume = volume;
    });

    // Add subtitle tracks for local videos (React Player v3 uses standard HTML video elements)
    useEffect(() => {
        if (subtitleUrl && showSubtitles && !isYouTubeUrl) {
            // Use a small delay to ensure ReactPlayer has mounted and the ref is available
            const timeoutId = setTimeout(() => {
                const videoElement = getVideoElement();
                if (!videoElement) return;

                // Remove existing tracks
                const existingTracks = videoElement.querySelectorAll("track");
                existingTracks.forEach((track) => track.remove());

                // Add subtitle track
                const track = document.createElement("track");
                track.kind = "subtitles";
                track.src = subtitleUrl;
                track.srclang = "en"; // FIXME: make this dynamic
                track.label = "English"; // FIXME: make this dynamic
                track.default = true;
                videoElement.appendChild(track);
            }, 100);

            return () => clearTimeout(timeoutId);
        }
    }, [subtitleUrl, showSubtitles, isYouTubeUrl, getVideoElement]);

    // Add direct timeupdate listener to video element for more frequent updates
    // This ensures audio synchronization works even if onProgress doesn't fire frequently enough
    useEffect(() => {
        if (!onTimeUpdate) return;

        let cleanup: (() => void) | null = null;

        const setupListener = () => {
            const videoElement = getVideoElement();
            if (!videoElement) {
                // Try again after a short delay if video element isn't ready
                const timeoutId = setTimeout(() => {
                    const delayedVideoElement = getVideoElement();
                    if (delayedVideoElement) {
                        const handleTimeUpdate = () => {
                            onTimeUpdate(delayedVideoElement.currentTime);
                        };
                        delayedVideoElement.addEventListener("timeupdate", handleTimeUpdate);
                        cleanup = () => {
                            delayedVideoElement.removeEventListener("timeupdate", handleTimeUpdate);
                        };
                    }
                }, 500);
                return () => clearTimeout(timeoutId);
            }

            const handleTimeUpdate = () => {
                onTimeUpdate(videoElement.currentTime);
            };

            videoElement.addEventListener("timeupdate", handleTimeUpdate);
            cleanup = () => {
                videoElement.removeEventListener("timeupdate", handleTimeUpdate);
            };
        };

        const initialCleanup = setupListener();
        return () => {
            if (cleanup) cleanup();
            if (initialCleanup) initialCleanup();
        };
    }, [onTimeUpdate, getVideoElement, videoUrl]);

    // Log video URL for debugging
    useEffect(() => {
        if (videoUrl) {
            console.log("VideoPlayer: videoUrl =", videoUrl);
        } else {
            console.warn("VideoPlayer: videoUrl is empty or undefined");
        }
    }, [videoUrl]);

    const audioLanguageLabel =
        audioTracks.find((track) => track.id === activeAudioTrackId)?.label ?? "Audio";

    return (
        <div style={{ position: "relative" }}>
            <div
                className="player-wrapper"
                style={{ height: playerHeight || "auto", backgroundColor: "black" }}
            >
                {!videoUrl ? (
                    <div className="error-message" style={{ color: "white", padding: "20px" }}>
                        No video URL provided. Please set a video URL in the metadata.
                    </div>
                ) : error ? (
                    <div className="error-message" style={{ color: "white", padding: "20px" }}>
                        {error}
                    </div>
                ) : (
                    <ReactPlayer
                        key={videoUrl}
                        ref={playerRef}
                        src={videoUrl}
                        playing={playing}
                        controls={true}
                        volume={volume}
                        width="100%"
                        height={playerHeight}
                        onError={handleError}
                        onReady={handleReady}
                        config={playerConfig}
                        onProgress={
                            // ReactPlayer v3 onProgress receives { playedSeconds, played, loaded, loadedSeconds }
                            // but TypeScript types incorrectly expect SyntheticEvent
                            ((state: { playedSeconds: number }) => {
                                // Handle time updates via onProgress for better compatibility
                                onTimeUpdate?.(state.playedSeconds);
                            }) as any
                        }
                        // Also listen to the video element's timeupdate event for more frequent updates
                        onTimeUpdate={handleTimeUpdate}
                        onPlay={handlePlay}
                        onPause={handlePause}
                    />
                )}
            </div>
            {videoUrl && !error && audioTracks.length > 1 && (
                <div style={{ position: "absolute", top: 8, right: 8, zIndex: 2 }}>
                    <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                            <Button
                                variant="secondary"
                                size="sm"
                                className="gap-1.5 bg-black/60 text-white hover:bg-black/80 backdrop-blur-sm"
                                title="Audio language"
                                data-testid="audio-language-selector"
                            >
                                <Languages className="size-4" />
                                {audioLanguageLabel}
                            </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent
                            align="end"
                            className="max-h-72 overflow-y-auto"
                        >
                            <DropdownMenuLabel>Audio language</DropdownMenuLabel>
                            <DropdownMenuRadioGroup
                                value={activeAudioTrackId ?? ""}
                                onValueChange={handleSelectAudioTrack}
                            >
                                {audioTracks.map((track) => (
                                    <DropdownMenuRadioItem key={track.id} value={track.id}>
                                        {track.label}
                                    </DropdownMenuRadioItem>
                                ))}
                            </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                    </DropdownMenu>
                </div>
            )}
        </div>
    );
};

export default VideoPlayer;
