import { useEffect, useRef, useCallback } from "react";
import { QuillCellContent } from "../../../../../types";
import { WebviewApi } from "vscode-webview";
import type { ReactPlayerRef } from "../types/reactPlayerTypes";
import { globalAudioController, AudioControllerEvent } from "../../lib/audioController";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../../lib/audioCache";
import { EditorPostMessages } from "../../../../../types";

interface CellAudioData {
    cellId: string;
    audioElement: HTMLAudioElement;
    startTime: number;
    endTime?: number;
    blobUrl: string;
    isPlaying: boolean;
}

type AudioAttachmentState =
    | "available"
    | "available-local"
    | "available-pointer"
    | "deletedOnly"
    | "none"
    | "missing";

interface UseMultiCellAudioPlaybackProps {
    translationUnitsForSection: QuillCellContent[];
    audioAttachments?: {
        [cellId: string]: AudioAttachmentState;
    };
    playerRef: React.RefObject<ReactPlayerRef>;
    vscode: WebviewApi<unknown>;
    isVideoPlaying: boolean;
    currentVideoTime: number;
    muteVideoWhenPlayingAudio?: boolean;
}

/**
 * Hook to manage multi-cell audio playback synchronized with video.
 * Plays recorded audio from cells at their correct timestamps when video plays.
 */
export function useMultiCellAudioPlayback({
    translationUnitsForSection,
    audioAttachments,
    playerRef,
    vscode,
    isVideoPlaying,
    currentVideoTime,
    muteVideoWhenPlayingAudio = true,
}: UseMultiCellAudioPlaybackProps): void {
    const audioElementsRef = useRef<Map<string, CellAudioData>>(new Map());
    const pendingRequestsRef = useRef<Set<string>>(new Set());
    const videoMuteStateRef = useRef<boolean | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const messageHandlerRef = useRef<((event: MessageEvent) => void) | null>(null);
    const isCleaningUpRef = useRef<boolean>(false);

    // Get video element helper
    const getVideoElement = useCallback((): HTMLVideoElement | null => {
        if (!playerRef.current) return null;

        const internalPlayer = playerRef.current.getInternalPlayer?.();
        if (internalPlayer instanceof HTMLVideoElement) {
            return internalPlayer;
        }

        if (internalPlayer && typeof internalPlayer === "object") {
            const foundVideo =
                (internalPlayer as any).querySelector?.("video") ||
                (internalPlayer as any).video ||
                internalPlayer;
            if (foundVideo instanceof HTMLVideoElement) {
                return foundVideo;
            }
        }

        // Last resort: Try to find video element in the DOM
        const wrapper = playerRef.current as any;
        const foundVideo =
            wrapper.querySelector?.("video") || wrapper.parentElement?.querySelector?.("video");
        if (foundVideo instanceof HTMLVideoElement) {
            return foundVideo;
        }

        return null;
    }, [playerRef]);

    // Clean up audio elements
    const cleanupAudioElements = useCallback(() => {
        isCleaningUpRef.current = true;
        try {
            audioElementsRef.current.forEach((data) => {
                try {
                    data.audioElement.pause();
                    data.audioElement.currentTime = 0;
                    data.audioElement.src = "";
                    if (data.blobUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(data.blobUrl);
                    }
                } catch (error) {
                    console.error(`Error cleaning up audio for cell ${data.cellId}:`, error);
                }
            });
            audioElementsRef.current.clear();
        } finally {
            isCleaningUpRef.current = false;
        }
    }, []);

    // Restore video mute state
    const restoreVideoMuteState = useCallback(() => {
        const videoElement = videoElementRef.current || getVideoElement();
        if (videoElement && videoMuteStateRef.current !== null) {
            try {
                videoElement.muted = videoMuteStateRef.current;
                videoMuteStateRef.current = null;
            } catch (error) {
                console.error("Error restoring video mute state:", error);
            }
        }
    }, [getVideoElement]);

    // Mute video audio
    const muteVideoAudio = useCallback(() => {
        const videoElement = videoElementRef.current || getVideoElement();
        if (videoElement && videoMuteStateRef.current === null) {
            try {
                videoMuteStateRef.current = videoElement.muted;
                videoElement.muted = true;
                videoElementRef.current = videoElement;
            } catch (error) {
                console.error("Error muting video audio:", error);
            }
        }
    }, [getVideoElement]);

    // Check if any audio is currently playing or should be playing
    const hasPlayingAudio = useCallback((currentTime?: number): boolean => {
        for (const data of audioElementsRef.current.values()) {
            // Check if audio is currently playing
            if (data.isPlaying && !data.audioElement.paused) {
                return true;
            }
            // Check if audio should be playing based on current video time
            if (currentTime !== undefined) {
                const tolerance = 0.1;
                const isPastStartTime = currentTime >= data.startTime - tolerance;
                const isBeforeEndTime = data.endTime === undefined || currentTime < data.endTime;
                if (isPastStartTime && isBeforeEndTime) {
                    return true;
                }
            }
        }
        return false;
    }, []);

    // Update mute state based on playing audio (only mute when user preference is true)
    const updateVideoMuteState = useCallback(
        (currentTime?: number) => {
            if (hasPlayingAudio(currentTime)) {
                if (muteVideoWhenPlayingAudio) {
                    muteVideoAudio();
                }
                // When muteVideoWhenPlayingAudio is false, leave video unmuted so video + recorded audio play together
            } else {
                restoreVideoMuteState();
            }
        },
        [hasPlayingAudio, muteVideoWhenPlayingAudio, muteVideoAudio, restoreVideoMuteState]
    );

    // Request audio for a cell
    const requestAudioForCell = useCallback(
        (cellId: string): Promise<string | null> => {
            return new Promise((resolve) => {
                // Check cache first
                const cached = getCachedAudioDataUrl(cellId);
                if (cached) {
                    resolve(cached);
                    return;
                }

                // Check if already requesting
                if (pendingRequestsRef.current.has(cellId)) {
                    // Wait for existing request
                    const checkInterval = setInterval(() => {
                        const cachedAfterWait = getCachedAudioDataUrl(cellId);
                        if (cachedAfterWait) {
                            clearInterval(checkInterval);
                            resolve(cachedAfterWait);
                        }
                    }, 100);

                    setTimeout(() => {
                        clearInterval(checkInterval);
                        if (!getCachedAudioDataUrl(cellId)) {
                            resolve(null);
                        }
                    }, 5000);
                    return;
                }

                pendingRequestsRef.current.add(cellId);

                let resolved = false;
                const timeout = setTimeout(() => {
                    if (!resolved) {
                        resolved = true;
                        pendingRequestsRef.current.delete(cellId);
                        if (messageHandlerRef.current) {
                            window.removeEventListener("message", messageHandlerRef.current);
                        }
                        resolve(null);
                    }
                }, 5000);

                const handler = (event: MessageEvent) => {
                    const message = event.data;
                    if (
                        message?.type === "providerSendsAudioData" &&
                        message.content?.cellId === cellId &&
                        !resolved
                    ) {
                        resolved = true;
                        clearTimeout(timeout);
                        pendingRequestsRef.current.delete(cellId);
                        window.removeEventListener("message", handler);

                        if (message.content.audioData) {
                            setCachedAudioDataUrl(cellId, message.content.audioData);
                            resolve(message.content.audioData);
                        } else {
                            resolve(null);
                        }
                    }
                };

                messageHandlerRef.current = handler;
                window.addEventListener("message", handler);

                vscode.postMessage({
                    command: "requestAudioForCell",
                    content: { cellId },
                } as EditorPostMessages);
            });
        },
        [vscode]
    );

    // Create audio element for a cell
    const createAudioElement = useCallback(
        async (cellId: string, startTime: number, endTime?: number): Promise<boolean> => {
            // Skip if already exists
            if (audioElementsRef.current.has(cellId)) {
                return true;
            }

            const audioDataUrl = await requestAudioForCell(cellId);
            if (!audioDataUrl) {
                return false;
            }

            try {
                const response = await fetch(audioDataUrl);
                if (!response.ok) {
                    throw new Error(`Failed to fetch audio: ${response.status} ${response.statusText}`);
                }
                const blob = await response.blob();
                const blobUrl = URL.createObjectURL(blob);

                const audioElement = new Audio();

                // Wait for audio to be ready before setting up handlers
                await new Promise<void>((resolve, reject) => {
                    const timeout = setTimeout(() => {
                        audioElement.removeEventListener("canplaythrough", onCanPlay);
                        audioElement.removeEventListener("canplay", onCanPlay);
                        audioElement.removeEventListener("loadeddata", onCanPlay);
                        audioElement.removeEventListener("error", onError);
                        // If timeout, check if we have at least some data
                        if (audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                            resolve();
                        } else {
                            reject(new Error("Audio loading timeout - not enough data loaded"));
                        }
                    }, 10000); // Increased timeout to 10 seconds

                    const onCanPlay = () => {
                        clearTimeout(timeout);
                        audioElement.removeEventListener("canplaythrough", onCanPlay);
                        audioElement.removeEventListener("canplay", onCanPlay);
                        audioElement.removeEventListener("loadeddata", onCanPlay);
                        audioElement.removeEventListener("error", onError);
                        resolve();
                    };

                    const onError = (e: Event) => {
                        clearTimeout(timeout);
                        audioElement.removeEventListener("canplaythrough", onCanPlay);
                        audioElement.removeEventListener("canplay", onCanPlay);
                        audioElement.removeEventListener("loadeddata", onCanPlay);
                        audioElement.removeEventListener("error", onError);
                        const error = audioElement.error;
                        reject(
                            new Error(
                                `Audio load error for cell ${cellId}: code ${error?.code || "unknown"} - ${error?.message || "unknown error"}`
                            )
                        );
                    };

                    // Listen for multiple events to catch when audio is ready
                    audioElement.addEventListener("canplaythrough", onCanPlay);
                    audioElement.addEventListener("canplay", onCanPlay);
                    audioElement.addEventListener("loadeddata", onCanPlay);
                    audioElement.addEventListener("error", onError);
                    audioElement.src = blobUrl;
                    audioElement.load();
                });

                const data: CellAudioData = {
                    cellId,
                    audioElement,
                    startTime,
                    endTime,
                    blobUrl,
                    isPlaying: false,
                };

                // Set up event handlers
                audioElement.onended = () => {
                    data.isPlaying = false;
                    updateVideoMuteState();
                };

                audioElement.onerror = (e) => {
                    // Don't log errors during cleanup (expected when clearing src)
                    if (isCleaningUpRef.current) {
                        return;
                    }
                    const error = audioElement.error;
                    // Skip logging "Empty src attribute" errors (code 4) - these are expected
                    // when src is cleared or during normal cleanup/reset operations
                    if (error?.code === 4 || !audioElement.src || audioElement.readyState === 0) {
                        data.isPlaying = false;
                        updateVideoMuteState();
                        return;
                    }
                    console.error(
                        `Error playing audio for cell ${cellId}:`,
                        error?.code || "unknown",
                        error?.message || "unknown error",
                        `readyState: ${audioElement.readyState}`,
                        `src: ${audioElement.src.substring(0, 50)}...`
                    );
                    data.isPlaying = false;
                    updateVideoMuteState();
                };

                audioElement.onplay = () => {
                    data.isPlaying = true;
                    updateVideoMuteState();
                };

                audioElement.onpause = () => {
                    data.isPlaying = false;
                    updateVideoMuteState();
                };

                audioElementsRef.current.set(cellId, data);

                return true;
            } catch (error) {
                console.error(`Error creating audio element for cell ${cellId}:`, error);
                return false;
            }
        },
        [requestAudioForCell, updateVideoMuteState]
    );

    // Initialize audio elements when video starts playing
    useEffect(() => {
        if (!isVideoPlaying) {
            return;
        }

        // Find cells with audio and timestamps
        const cellsWithAudio: Array<{
            cellId: string;
            startTime: number;
            endTime?: number;
        }> = [];

        for (const cell of translationUnitsForSection) {
            const cellId = cell.cellMarkers.join(" ");
            const audioState = audioAttachments?.[cellId];
            const timestamps = cell.audioTimestamps ??
                (cell.data?.audioStartTime !== undefined || cell.data?.audioEndTime !== undefined
                    ? {
                        startTime: cell.data.audioStartTime,
                        endTime: cell.data.audioEndTime,
                    }
                    : cell.timestamps);

            // Check if cell has audio available
            const hasAudio =
                audioState === "available" ||
                audioState === "available-local" ||
                audioState === "available-pointer";

            // Check if cell has timestamps
            const hasTimestamps = timestamps?.startTime !== undefined;

            if (hasAudio && hasTimestamps) {
                cellsWithAudio.push({
                    cellId,
                    startTime: timestamps.startTime!,
                    endTime: timestamps.endTime,
                });
            }
        }

        // Create or update audio elements for all cells
        const initializePromises = cellsWithAudio.map(async ({ cellId, startTime, endTime }) => {
            // Check if audio element already exists
            const existingData = audioElementsRef.current.get(cellId);
            if (existingData) {
                // Check if timestamps have changed
                const timestampsChanged =
                    existingData.startTime !== startTime || existingData.endTime !== endTime;

                if (timestampsChanged) {
                    // Stop and reset audio if it's currently playing
                    if (!existingData.audioElement.paused || existingData.isPlaying) {
                        try {
                            existingData.audioElement.pause();
                            existingData.audioElement.currentTime = 0;
                            existingData.isPlaying = false;
                        } catch (error) {
                            console.error(`Error stopping audio for cell ${cellId}:`, error);
                        }
                    }
                    // Update timestamps for existing element
                    existingData.startTime = startTime;
                    existingData.endTime = endTime;
                }
                return true;
            }
            // Create new audio element
            return createAudioElement(cellId, startTime, endTime);
        });

        Promise.all(initializePromises).catch((error) => {
            console.error("Error initializing audio elements:", error);
        });

        return () => {
            // Cleanup on unmount or when video stops
            cleanupAudioElements();
            restoreVideoMuteState();
        };
    }, [
        isVideoPlaying,
        translationUnitsForSection,
        audioAttachments,
        createAudioElement,
        cleanupAudioElements,
        restoreVideoMuteState,
    ]);

    // Debounce timer ref to prevent excessive calls during timeline dragging
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    // Function to check and start/stop audio based on current video time
    const checkAndStartAudio = useCallback(() => {
        if (!isVideoPlaying) {
            return;
        }

        const currentTime = currentVideoTime;
        const tolerance = 0.1; // 100ms tolerance for starting audio

        // Update mute state based on current time (mute if audio should be playing)
        updateVideoMuteState(currentTime);

        // Check if AudioPlayButton or other audio is playing (not multi-cell audio)
        const currentGlobalAudio = globalAudioController.getCurrent();
        if (currentGlobalAudio) {
            let isMultiCellAudio = false;
            audioElementsRef.current.forEach((data) => {
                if (data.audioElement === currentGlobalAudio) {
                    isMultiCellAudio = true;
                }
            });

            // If a non-multi-cell audio is playing, stop all multi-cell audio
            if (!isMultiCellAudio) {
                audioElementsRef.current.forEach((data) => {
                    if (data.audioElement !== currentGlobalAudio) {
                        try {
                            data.audioElement.pause();
                            data.audioElement.currentTime = 0;
                            data.isPlaying = false;
                        } catch (error) {
                            console.error(`Error stopping audio for cell ${data.cellId}:`, error);
                        }
                    }
                });
                updateVideoMuteState(currentTime);
                return; // Don't start new multi-cell audio if other audio is playing
            }
        }

        audioElementsRef.current.forEach((data) => {
            // Check if audio should start
            // Check if we're past the start time (with small tolerance for timing precision)
            // and haven't started playing yet
            const isPastStartTime = currentTime >= data.startTime - tolerance;
            const isBeforeEndTime = data.endTime === undefined || currentTime < data.endTime;
            const shouldStart =
                !data.isPlaying &&
                data.audioElement.paused &&
                isPastStartTime &&
                isBeforeEndTime;

            if (shouldStart) {
                // Check if audio element has an error
                if (data.audioElement.error) {
                    console.error(
                        `Audio element has error for cell ${data.cellId}:`,
                        `code ${data.audioElement.error.code}`,
                        data.audioElement.error.message
                    );
                    // Try to reload the audio
                    try {
                        data.audioElement.load();
                    } catch (reloadError) {
                        console.error(`Failed to reload audio for cell ${data.cellId}:`, reloadError);
                    }
                    return; // Skip this audio element
                }

                // Ensure audio is ready before playing
                if (data.audioElement.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
                    // Start audio playback
                    data.audioElement
                        .play()
                        .then(() => {
                            data.isPlaying = true;
                            updateVideoMuteState();
                        })
                        .catch((error) => {
                            // Suppress AbortError warnings - these are expected when pause() interrupts play()
                            // This commonly happens during rapid seeking or when cleanup occurs
                            if (error instanceof Error && error.name === "AbortError") {
                                // Mark as not playing but don't log the error
                                data.isPlaying = false;
                                updateVideoMuteState();
                                return;
                            }
                            const audioError = data.audioElement.error;
                            console.error(
                                `Error starting audio for cell ${data.cellId}:`,
                                error,
                                `Audio readyState: ${data.audioElement.readyState}`,
                                `Error code: ${audioError?.code}`,
                                `Error message: ${audioError?.message}`
                            );
                            // Mark as not playing
                            data.isPlaying = false;
                            updateVideoMuteState();
                        });
                } else {
                    // Wait for audio to be ready, then try again on next time update
                    // Remove any existing listener first
                    const onCanPlay = () => {
                        data.audioElement.removeEventListener("canplay", onCanPlay);
                        data.audioElement.removeEventListener("loadeddata", onCanPlay);
                        // Check again if we should still start
                        if (
                            !data.isPlaying &&
                            data.audioElement.paused &&
                            currentVideoTime >= data.startTime - tolerance &&
                            (data.endTime === undefined || currentVideoTime < data.endTime)
                        ) {
                            data.audioElement
                                .play()
                                .then(() => {
                                    data.isPlaying = true;
                                    updateVideoMuteState();
                                })
                                .catch((error) => {
                                    // Suppress AbortError warnings - these are expected when pause() interrupts play()
                                    if (error instanceof Error && error.name === "AbortError") {
                                        return;
                                    }
                                    const audioError = data.audioElement.error;
                                    console.error(
                                        `Error starting audio for cell ${data.cellId} after ready:`,
                                        error,
                                        `Error code: ${audioError?.code}`,
                                        `Error message: ${audioError?.message}`
                                    );
                                });
                        }
                    };
                    data.audioElement.addEventListener("canplay", onCanPlay);
                    data.audioElement.addEventListener("loadeddata", onCanPlay);
                }
            }

            // Stop audio if past end time
            if (
                data.isPlaying &&
                !data.audioElement.paused &&
                data.endTime !== undefined &&
                currentTime > data.endTime
            ) {
                data.audioElement.pause();
                data.audioElement.currentTime = 0;
                data.isPlaying = false;
                updateVideoMuteState();
            }
        });
    }, [currentVideoTime, isVideoPlaying, updateVideoMuteState]);

    // Handle video time updates - start audio at correct timestamps
    // Debounce to prevent excessive calls during timeline dragging
    useEffect(() => {
        // Clear any existing timer
        if (debounceTimerRef.current) {
            clearTimeout(debounceTimerRef.current);
        }

        // Debounce the check - only run after 50ms of no time updates
        // This prevents hundreds of calls when dragging the timeline slider
        debounceTimerRef.current = setTimeout(() => {
            checkAndStartAudio();
        }, 50);

        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [checkAndStartAudio]);

    // Also trigger playback check when translation units change (timestamps updated)
    useEffect(() => {
        if (isVideoPlaying) {
            checkAndStartAudio();
        }
    }, [translationUnitsForSection, isVideoPlaying, checkAndStartAudio]);

    // Stop all audio when video pauses
    useEffect(() => {
        if (!isVideoPlaying) {
            audioElementsRef.current.forEach((data) => {
                try {
                    data.audioElement.pause();
                    data.audioElement.currentTime = 0;
                    data.isPlaying = false;
                } catch (error) {
                    console.error(`Error stopping audio for cell ${data.cellId}:`, error);
                }
            });
            restoreVideoMuteState();
        }
    }, [isVideoPlaying, restoreVideoMuteState]);

    // Listen for global audio controller events to stop multi-cell playback
    useEffect(() => {
        const handler = (e: AudioControllerEvent) => {
            // Check if the stopped audio was one of our multi-cell audio elements
            const stoppedAudio = e.audio;
            let wasMultiCellAudio = false;

            audioElementsRef.current.forEach((data) => {
                if (data.audioElement === stoppedAudio) {
                    wasMultiCellAudio = true;
                }
            });

            // If a multi-cell audio was stopped OR if a different audio is now playing,
            // stop all multi-cell audio to ensure exclusive playback
            const currentAudio = globalAudioController.getCurrent();
            if (wasMultiCellAudio || (currentAudio && currentAudio !== stoppedAudio)) {
                audioElementsRef.current.forEach((data) => {
                    if (data.audioElement !== currentAudio) {
                        try {
                            data.audioElement.pause();
                            data.audioElement.currentTime = 0;
                            data.isPlaying = false;
                        } catch (error) {
                            console.error(`Error stopping audio for cell ${data.cellId}:`, error);
                        }
                    }
                });
                updateVideoMuteState();
            }
        };

        globalAudioController.addListener(handler);
        return () => globalAudioController.removeListener(handler);
    }, [updateVideoMuteState]);

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            cleanupAudioElements();
            restoreVideoMuteState();
            if (messageHandlerRef.current) {
                window.removeEventListener("message", messageHandlerRef.current);
            }
        };
    }, [cleanupAudioElements, restoreVideoMuteState]);
}

