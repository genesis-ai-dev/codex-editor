import React, { useContext, useEffect, useRef, useState, useMemo, useCallback } from "react";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../lib/audioCache";
import { globalAudioController, type AudioControllerEvent } from "../lib/audioController";
import {
    EditorCellContent,
    EditorPostMessages,
    Timestamps,
    EditHistory,
    QuillCellContent,
} from "../../../../types";
import { processHtmlContent, updateFootnoteNumbering } from "./footnoteUtils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";
import ValidationButton from "./ValidationButton";
import AudioValidationButton from "./AudioValidationButton";
import { shouldDisableValidation } from "@sharedUtils";
import { Button } from "../components/ui/button";
import { getTranslationStyle, CellTranslationState } from "./CellTranslationStyles";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor"; // Import the cell display modes
import "./TranslationAnimations.css"; // Import the animation CSS
import { useTooltip } from "./contextProviders/TooltipContext";
import CommentsBadge from "./CommentsBadge";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import ReactMarkdown from "react-markdown";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import { MessageCircle } from "lucide-react";

const SHOW_VALIDATION_BUTTON = true;
interface CellContentDisplayProps {
    cell: QuillCellContent;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    alertColorCode: number | undefined;
    highlightedCellId?: string | null;
    scrollSyncEnabled: boolean;
    lineNumber: string;
    label?: string;
    lineNumbersEnabled?: boolean;
    isInTranslationProcess?: boolean;
    translationState?: "waiting" | "processing" | "completed" | null;
    allTranslationsComplete?: boolean;
    handleCellTranslation?: (cellId: string) => void;
    handleCellClick: (cellId: string) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    audioAttachments?: {
        [cellId: string]:
            | "available"
            | "available-local"
            | "available-pointer"
            | "deletedOnly"
            | "none"
            | "missing";
    };
    footnoteOffset?: number; // Starting footnote number for this cell
    isCorrectionEditorMode?: boolean; // Whether correction editor mode is active
    translationUnits?: QuillCellContent[]; // Full list of translation units for finding previous cell
    unresolvedCommentsCount?: number; // Number of unresolved comments for this cell
    // Derived, shared state to avoid per-cell lookups
    currentUsername?: string;
    requiredValidations?: number;
    requiredAudioValidations?: number;
    isAuthenticated?: boolean;
    isAudioOnly?: boolean;
    showInlineBacktranslations?: boolean;
    backtranslation?: any;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
}

// Audio Play Button Component
const AudioPlayButton: React.FC<{
    cellId: string;
    vscode: WebviewApi<unknown>;
    state?:
        | "available"
        | "available-local"
        | "available-pointer"
        | "missing"
        | "deletedOnly"
        | "none";
    onOpenCell?: (cellId: string) => void;
}> = React.memo(({ cellId, vscode, state = "available", onOpenCell }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const pendingPlayRef = useRef(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Do not pre-load on mount; we will request on first click to avoid spinner churn

    // Listen for audio data messages
    useMessageHandler(
        "cellContentDisplay-audioData",
        (event: MessageEvent) => {
            const message = event.data;

            // Handle audio attachments updates - clear current url; fetch on next click
            if (message.type === "providerSendsAudioAttachments") {
                if (audioUrl && audioUrl.startsWith("blob:")) {
                    URL.revokeObjectURL(audioUrl);
                }
                setAudioUrl(null);
                setIsLoading(false);
            }

            if (message.type === "providerSendsAudioData" && message.content.cellId === cellId) {
                if (message.content.audioData) {
                    // Clean up previous URL if exists
                    if (audioUrl && audioUrl.startsWith("blob:")) {
                        URL.revokeObjectURL(audioUrl);
                    }

                    // Convert base64 to blob URL
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
                                // Auto-play once the data arrives
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
                                    globalAudioController
                                        .playExclusive(audioRef.current)
                                        .then(() => setIsPlaying(true))
                                        .catch((e) => {
                                            console.error("Error auto-playing audio for cell:", e);
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
                    // No audio data - clear the audio URL and stop loading
                    setAudioUrl(null);
                    setIsLoading(false);
                }
            }
        },
        [audioUrl, cellId, vscode]
    ); // Add vscode to dependencies

    // Clean up blob URL on unmount
    useEffect(() => {
        return () => {
            if (audioUrl && audioUrl.startsWith("blob:")) {
                URL.revokeObjectURL(audioUrl);
            }
            // Stop audio if playing when unmounting
            if (audioRef.current && isPlaying) {
                audioRef.current.pause();
            }
        };
    }, [audioUrl, isPlaying]);

    const handlePlayAudio = async () => {
        try {
            // For any non-available state, open editor on audio tab and auto-start recording
            if (
                state !== "available" &&
                state !== "available-local" &&
                state !== "available-pointer"
            ) {
                // For missing audio, just open the editor without auto-starting recording
                if (state !== "missing") {
                    try {
                        sessionStorage.setItem(`start-audio-recording-${cellId}`, "1");
                    } catch (e) {
                        void e;
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
                // Stop current audio
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }
                setIsPlaying(false);
            } else {
                // If we don't have audio yet, try cached data first; only request if not cached
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
                            setAudioUrl(blobUrl); // update state for future plays
                            effectiveUrl = blobUrl; // use immediately for this play
                            setIsLoading(false);
                            // fall through to playback below
                        } catch {
                            // If cache hydration fails, request from provider
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

                // Create or reuse audio element
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

    // Keep inline button in sync if this audio is stopped by global controller
    useEffect(() => {
        const handler = (e: AudioControllerEvent) => {
            if (audioRef.current && e.audio === audioRef.current) {
                setIsPlaying(false);
            }
        };
        globalAudioController.addListener(handler);
        return () => globalAudioController.removeListener(handler);
    }, []);

    // Decide icon color/style based on state
    const { iconClass, color, titleSuffix } = (() => {
        // If we already have audio bytes (from cache or just streamed), show Play regardless of pointer/local state
        if (audioUrl || getCachedAudioDataUrl(cellId)) {
            return {
                iconClass: isLoading
                    ? "codicon-loading codicon-modifier-spin"
                    : isPlaying
                    ? "codicon-debug-stop"
                    : "codicon-play",
                color: "var(--vscode-charts-blue)",
                titleSuffix: "(available)",
            } as const;
        }
        // Local file present but not yet loaded into memory
        if (state === "available-local") {
            return {
                iconClass: isLoading
                    ? "codicon-loading codicon-modifier-spin"
                    : isPlaying
                    ? "codicon-debug-stop"
                    : "codicon-play",
                color: "var(--vscode-charts-blue)",
                titleSuffix: "(local)",
            } as const;
        }
        // Available remotely/downloadable or pointer-only → show cloud
        if (state === "available" || state === "available-pointer") {
            return {
                iconClass: isLoading
                    ? "codicon-loading codicon-modifier-spin"
                    : "codicon-cloud-download", // cloud behind play
                color: "var(--vscode-charts-blue)",
                titleSuffix: state === "available-pointer" ? "(pointer)" : "(in cloud)",
            } as const;
        }
        if (state === "missing") {
            return {
                iconClass: "codicon-warning",
                color: "var(--vscode-errorForeground)",
                titleSuffix: "(missing)",
            } as const;
        }
        // deletedOnly or none => show mic to begin recording
        return {
            iconClass: "codicon-mic",
            color: "var(--vscode-foreground)",
            titleSuffix: "(record)",
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
});

// Cell Label Text Component
const CellLabelText: React.FC<{
    label: string;
    cellDisplayMode: CELL_DISPLAY_MODES;
    forceLabelTopRow: boolean;
}> = React.memo(({ label, cellDisplayMode, forceLabelTopRow }) => {
    return (
        <div
            className="cell-label-text text-primary inline-block text-right relative -top-[2px] ml-px"
            style={{
                fontWeight:
                    cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ? 500 : "normal",
                lineHeight: 1.2,
                overflowWrap: "anywhere",
                flexBasis: forceLabelTopRow ? "100%" : "auto",
            }}
            title={label}
        >
            {label}
        </div>
    );
});

const CellContentDisplay: React.FC<CellContentDisplayProps> = React.memo(
    ({
        cell,
        vscode,
        textDirection,
        isSourceText,
        hasDuplicateId,
        alertColorCode,
        highlightedCellId,
        scrollSyncEnabled,
        lineNumber,
        label,
        lineNumbersEnabled = true,
        isInTranslationProcess = false,
        translationState = null,
        allTranslationsComplete = false,
        handleCellTranslation,
        handleCellClick,
        cellDisplayMode,
        audioAttachments,
        footnoteOffset = 0,
        isCorrectionEditorMode = false,
        translationUnits = [],
        unresolvedCommentsCount: initialUnresolvedCommentsCount = 0,
        currentUsername,
        requiredValidations,
        requiredAudioValidations,
        isAuthenticated = false,
        isAudioOnly = false,
        showInlineBacktranslations = false,
        backtranslation,
    }) => {
        // const { cellContent, timestamps, editHistory } = cell; // I don't think we use this
        const cellIds = cell.cellMarkers;
        const [fadingOut, setFadingOut] = useState(false);
        const [showSparkleButton, setShowSparkleButton] = useState(false);
        const [showAuthModal, setShowAuthModal] = useState(false);
        const [showOfflineModal, setShowOfflineModal] = useState(false);
        const { showTooltip, hideTooltip } = useTooltip();

        const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

        const cellRef = useRef<HTMLDivElement>(null);
        const contentRef = useRef<HTMLDivElement>(null);

        // Effect to attach event listeners to footnote markers
        useEffect(() => {
            if (!contentRef.current) return;

            // Find all footnote markers in the rendered content
            const markers = contentRef.current.querySelectorAll("sup.footnote-marker");

            // Function to show tooltip on hover
            const handleMarkerMouseEnter = (e: Event) => {
                const marker = e.currentTarget as HTMLElement;
                const content = marker.getAttribute("data-footnote") || "";
                const rect = marker.getBoundingClientRect();

                // Position at the top center of the marker
                const x = rect.left + rect.width / 2;
                const y = rect.top;

                showTooltip(<div dangerouslySetInnerHTML={{ __html: content }} />, x, y);
            };

            // Function to hide tooltip when mouse leaves
            const handleMarkerMouseLeave = () => {
                hideTooltip();
            };

            // Attach listeners to all markers
            markers.forEach((marker) => {
                marker.addEventListener("mouseenter", handleMarkerMouseEnter);
                marker.addEventListener("mouseleave", handleMarkerMouseLeave);
            });

            // Use the proper footnote numbering utility
            if (contentRef.current) {
                updateFootnoteNumbering(contentRef.current, footnoteOffset + 1, false);
            }

            // Clean up listeners when component unmounts
            return () => {
                markers.forEach((marker) => {
                    marker.removeEventListener("mouseenter", handleMarkerMouseEnter);
                    marker.removeEventListener("mouseleave", handleMarkerMouseLeave);
                });
            };
        }, [cell.cellContent, showTooltip, hideTooltip, footnoteOffset]);

        // Handle fade-out effect when all translations complete - DISABLED to prevent glitches
        useEffect(() => {
            // Completely disable fading to prevent any glitches during translation
            setFadingOut(false);
        }, [allTranslationsComplete, translationState, isInTranslationProcess]);

        // Note: comments counts are provided by parent (`CellList`) to avoid per-cell fetches

        // Helper function to check if this cell should be highlighted
        // Handles parent/child cell matching: child cells in target should highlight parent cells in source
        const checkShouldHighlight = useCallback((): boolean => {
            return cellIds.some((cellId) => {
                if (!highlightedCellId || !cellId) return false;

                // Exact match
                if (highlightedCellId === cellId) return true;

                // If highlighted cell is a child (3+ parts), check if this is the parent
                const highlightedParts = highlightedCellId.split(":");
                const cellParts = cellId.split(":");

                if (highlightedParts.length >= 3 && cellParts.length === 2) {
                    // Compare parent portion: "BOOK CHAPTER:VERSE"
                    const highlightedParent = highlightedParts.slice(0, 2).join(":");
                    return highlightedParent === cellId;
                }

                return false;
            });
        }, [cellIds, highlightedCellId]);

        useEffect(() => {
            debug("Before Scrolling to content highlightedCellId", {
                highlightedCellId,
                cellIds,
                isSourceText,
                scrollSyncEnabled,
            });

            const shouldHighlight = checkShouldHighlight();

            if (shouldHighlight && cellRef.current && isSourceText && scrollSyncEnabled) {
                debug("Scrolling to content highlightedCellId", {
                    highlightedCellId,
                    cellIds,
                    isSourceText,
                });
                cellRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
            }
        }, [cellIds, checkShouldHighlight, highlightedCellId, isSourceText, scrollSyncEnabled]);

        // Handler for stopping translation when clicked on the spinner
        const handleStopTranslation = (e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent the cell click handler from firing

            // If we're in a translation process, stop it
            if (isInTranslationProcess) {
                // Stop autocomplete chapter
                vscode.postMessage({
                    command: "stopAutocompleteChapter",
                } as EditorPostMessages);

                // Also stop single cell translations
                vscode.postMessage({
                    command: "stopSingleCellTranslation",
                } as any); // Use any type to bypass type checking
            }
        };

        // Handler for sparkle button click
        const handleSparkleButtonClick = (e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent the cell click handler from firing

            // Check if user is offline
            if (!navigator.onLine) {
                setShowOfflineModal(true);
                return;
            }

            // Check if user is authenticated
            if (!isAuthenticated) {
                setShowAuthModal(true);
                return;
            }

            // Skip if already in translation process
            if (isInTranslationProcess) return;

            // Call the handleCellTranslation function if available
            if (handleCellTranslation && cellIds.length > 0) {
                handleCellTranslation(cellIds[0]);
            } else {
                // Fallback if handleCellTranslation is not provided
                if (typeof (window as any).handleSparkleButtonClick === "function") {
                    (window as any).handleSparkleButtonClick(cellIds[0]);
                } else {
                    vscode.postMessage({
                        command: "llmCompletion",
                        content: {
                            currentLineId: cellIds[0],
                            addContentToValue: true,
                        },
                    });
                }
            }
        };

        const handleCancelMerge = (e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent the cell click handler from firing
            vscode.postMessage({
                command: "cancelMerge",
                content: { cellId: cellIds[0] },
            } as any);
        };

        // Handler for merging cell with previous cell
        const handleMergeWithPrevious = (e: React.MouseEvent) => {
            e.stopPropagation(); // Prevent the cell click handler from firing

            // Find the current cell index in the unpaginated list
            const currentCellId = cellIds[0];
            const currentIndex = translationUnits.findIndex(
                (unit) => unit.cellMarkers[0] === currentCellId
            );

            if (currentIndex === -1) {
                console.error("Current cell not found in translation units");
                return;
            }

            if (currentIndex === 0) {
                // Send error message to VS Code instead of using alert
                vscode.postMessage({
                    command: "showErrorMessage",
                    text: "Cannot merge: This is the first cell.",
                } as any);
                return;
            }

            // Find the most recent non-merged cell to merge into
            let targetCellIndex = currentIndex - 1;
            let targetCell = translationUnits[targetCellIndex];

            // Skip any cells that are already merged
            while (targetCellIndex >= 0 && targetCell?.merged) {
                targetCellIndex--;
                targetCell = translationUnits[targetCellIndex];
            }

            // Check if we found a valid target cell
            if (targetCellIndex < 0 || !targetCell) {
                vscode.postMessage({
                    command: "showErrorMessage",
                    text: "Cannot merge: No non-merged cell found to merge into.",
                } as any);
                return;
            }

            const currentCell = translationUnits[currentIndex];

            if (!targetCell || !currentCell) {
                console.error("Could not find target or current cell");
                return;
            }

            // Send confirmation request to VS Code instead of using window.confirm
            vscode.postMessage({
                command: "confirmCellMerge",
                content: {
                    currentCellId: currentCell.cellMarkers[0],
                    previousCellId: targetCell.cellMarkers[0],
                    currentContent: currentCell.cellContent,
                    previousContent: targetCell.cellContent,
                    message:
                        "Are you sure you want to merge this cell with the previous non-merged cell? This action cannot be undone.",
                },
            } as any);
        };

        // Line numbers are always generated and shown at the beginning of each line
        // Labels are optional and shown after line numbers when present

        // TODO: This was used for spell checking primarily. Will leave in for now but
        // will not render it when it is undefined.
        const AlertDot = ({ color }: { color: string }) => (
            <span
                style={{
                    display: "inline-block",
                    width: "5px",
                    height: "5px",
                    borderRadius: "50%",
                    backgroundColor: color,
                    marginLeft: "1px",
                }}
            />
        );

        const getAlertDot = () => {
            if (alertColorCode === -1 || alertColorCode === undefined) return null;

            const colors = {
                "0": "transparent",
                "1": "#FF6B6B",
                "2": "purple",
                "3": "white",
            } as const;
            return (
                <AlertDot
                    color={
                        colors[alertColorCode?.toString() as keyof typeof colors] || "transparent"
                    }
                />
            );
        };

        const getBackgroundColor = () => {
            if (checkShouldHighlight() && scrollSyncEnabled) {
                return "var(--vscode-editor-selectionBackground)";
            }
            return "transparent";
        };

        const getBorderColor = () => {
            if (checkShouldHighlight() && scrollSyncEnabled) {
                return "var(--vscode-editor-selectionHighlightBorder)";
            }
            return "transparent";
        };

        // Get the border style based on translation state
        const getBorderStyle = () => {
            if (hasDuplicateId) {
                return { borderColor: "red" };
            }

            // Explicitly reset border properties when no translation state
            if (!translationState) {
                return {
                    border: "1px solid transparent",
                    borderColor: "transparent",
                };
            }

            // Determine if we're in inline mode based on the cellDisplayMode prop
            const isInlineMode = cellDisplayMode === CELL_DISPLAY_MODES.INLINE;

            // Get the translation style from our new utility
            return getTranslationStyle(
                fadingOut ? ("fading" as CellTranslationState) : translationState,
                isInlineMode
            );
        };

        // We don't need the CSS class anymore since we're using inline styles
        // But we do need to handle any className returned from getTranslationStyle for animations
        const getAnimationClassName = () => {
            // Determine if we're in inline mode based on the cellDisplayMode prop
            const isInlineMode = cellDisplayMode === CELL_DISPLAY_MODES.INLINE;

            // Get the translation style which may include a className
            const style = getTranslationStyle(
                fadingOut ? ("fading" as CellTranslationState) : translationState,
                isInlineMode
            );

            return style.className || "";
        };

        // Decide when the label should occupy the full top row
        const forceLabelTopRow: boolean = false;

        // Function to check if we should show cell header elements
        const shouldShowHeaderElements = () => {
            return cellDisplayMode !== CELL_DISPLAY_MODES.INLINE;
        };

        const handleAuthModalLogIn = () => {
            vscode.postMessage({
                command: "openLoginFlow",
            });
            setShowAuthModal(false);
            setShowSparkleButton(false);
        };

        const handleAuthModalClose = () => {
            setShowAuthModal(false);
            setShowSparkleButton(false);
        };

        const handleToggleCellLock = () => {
            const cellId = cellIds[0];
            const newIsLocked = !(cell.metadata?.isLocked ?? false);
            vscode.postMessage({
                command: "updateCellIsLocked",
                content: {
                    cellId,
                    isLocked: newIsLocked,
                },
            } as EditorPostMessages);
        };

        const handleCellContentClick = () => {
            hideTooltip();
            if (!(cell.metadata?.isLocked ?? false)) {
                handleCellClick(cellIds[0]);
            }
        };

        const handleOpenComments = (cellId: string) => {
            // Send message to open comments tab and navigate to this cell
            vscode.postMessage({
                command: "openCommentsForCell",
                content: {
                    cellId: cellId,
                },
            });
        };

        const handleOfflineModalClose = () => {
            setShowOfflineModal(false);
            setShowSparkleButton(false);
        };

        // Function to render the content with footnote markers and proper spacing
        const renderContent = () => {
            // Handle empty cell case
            if (
                (!cell.cellContent || cell.cellContent.trim() === "") &&
                // don't show empty cell for source text with audio only
                (!isSourceText || !isAudioOnly)
            ) {
                return (
                    <div
                        ref={contentRef}
                        className="cell-content empty-cell-content"
                        style={{
                            color: "var(--vscode-descriptionForeground)",
                            fontStyle: "italic",
                            opacity: 0.8,
                        }}
                    >
                        {isSourceText ? "No text" : "Click to translate"}
                    </div>
                );
            }

            // Use the proper HTML processing utility
            const processedHtml = processHtmlContent(cell.cellContent || "");

            const hasTimestamps = Boolean(
                cell.timestamps &&
                    (cell.timestamps.startTime !== undefined ||
                        cell.timestamps.endTime !== undefined)
            );

            if (!hasTimestamps) {
                return (
                    <div
                        ref={contentRef}
                        className="cell-content"
                        dangerouslySetInnerHTML={{
                            __html: processedHtml,
                        }}
                        onClick={handleCellContentClick}
                    />
                );
            }

            // Render content with timestamp display when timestamps are present
            return (
                <div
                    onClick={handleCellContentClick}
                    style={{ display: "flex", flexDirection: "column", gap: "0.5rem" }}
                >
                    <div
                        ref={contentRef}
                        className="cell-content"
                        dangerouslySetInnerHTML={{
                            __html: processedHtml,
                        }}
                    />
                    {cell.timestamps &&
                        (cell.timestamps.startTime !== undefined ||
                            cell.timestamps.endTime !== undefined) && (
                            <div
                                className="timestamp-display"
                                style={{
                                    fontSize: "0.75rem",
                                    color: "var(--vscode-descriptionForeground)",
                                    marginTop: "0.25rem",
                                    fontFamily: "monospace",
                                    opacity: 0.8,
                                    textAlign: "start",
                                    width: "100%",
                                }}
                            >
                                {cell.timestamps.startTime !== undefined &&
                                cell.timestamps.endTime !== undefined ? (
                                    <span>
                                        {formatTime(cell.timestamps.startTime)} →{" "}
                                        {formatTime(cell.timestamps.endTime)}
                                    </span>
                                ) : cell.timestamps.startTime !== undefined ? (
                                    <span>Start: {formatTime(cell.timestamps.startTime)}</span>
                                ) : cell.timestamps.endTime !== undefined ? (
                                    <span>End: {formatTime(cell.timestamps.endTime)}</span>
                                ) : null}
                            </div>
                        )}
                </div>
            );
        };

        const audioState = audioAttachments?.[cellIds[0]] as any;

        return (
            <div
                ref={cellRef}
                className={`cell-content-display my-4 group ${getAnimationClassName()}`}
                style={{
                    backgroundColor: getBackgroundColor(),
                    direction: textDirection,
                    ...getBorderStyle(),
                    display: "flex",
                    alignItems: "baseline",
                    gap: isSourceText ? "0.25rem" : "0.0625rem",
                    padding: "0.25rem",
                    cursor: isSourceText && !isCorrectionEditorMode ? "default" : "pointer",
                    border: "1px solid transparent",
                    borderRadius: "4px",
                    overflow: "visible",
                    maxWidth: "100%",
                    boxSizing: "border-box",
                    transition: "border 0.3s ease",
                    overflowWrap: "break-word",
                    wordWrap: "break-word",
                    wordBreak: "break-word",
                }}
            >
                <div className="flex flex-col gap-[0.25rem]">
                    {lineNumbersEnabled && label ? (
                        <div
                            data-testid="buffer-spacer-for-label"
                            style={{
                                display: "flex",
                                flex: 1,
                            }}
                            className="invisible"
                        >
                            <CellLabelText
                                label={lineNumber}
                                cellDisplayMode={cellDisplayMode}
                                forceLabelTopRow={forceLabelTopRow}
                            />
                        </div>
                    ) : null}
                    <div className="cell-header flex justify-start items-start shrink-0 gap-[1px]">
                        {cellDisplayMode !== CELL_DISPLAY_MODES.INLINE && (
                            <div
                                className={`cell-actions flex justify-start items-center ${
                                    lineNumbersEnabled ? "flex-col gap-[0.25rem]" : "flex-row"
                                }`}
                                onMouseOver={(e) => {
                                    e.stopPropagation();
                                    setShowSparkleButton(true);
                                }}
                                onMouseOut={(e) => {
                                    e.stopPropagation();
                                    setShowSparkleButton(false);
                                }}
                            >
                                <div className="action-button-container flex items-center gap-1">
                                    {!isSourceText && (
                                        <>
                                            <Button
                                                style={{
                                                    height: "16px",
                                                    width: "16px",
                                                    padding: 0,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    position: "relative",
                                                    opacity: showSparkleButton ? 1 : 0,
                                                    transform: `translateX(${
                                                        showSparkleButton ? "0" : "20px"
                                                    }) scale(${showSparkleButton ? 1 : 0})`,
                                                    transition:
                                                        "all 0.2s ease-in-out, transform 0.2s cubic-bezier(.68,-0.75,.27,1.75)",
                                                    visibility: showSparkleButton
                                                        ? "visible"
                                                        : "hidden",
                                                }}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    handleSparkleButtonClick(e);
                                                }}
                                            >
                                                <i
                                                    className={`codicon ${
                                                        isInTranslationProcess
                                                            ? "codicon-loading codicon-modifier-spin"
                                                            : "codicon-sparkle"
                                                    }`}
                                                    style={{ fontSize: "12px" }}
                                                ></i>
                                            </Button>
                                            <Dialog
                                                open={showAuthModal}
                                                onOpenChange={handleAuthModalClose}
                                            >
                                                <DialogContent>
                                                    <DialogHeader className="sm:text-center">
                                                        <DialogTitle>
                                                            Log in to translate using AI
                                                        </DialogTitle>
                                                        <DialogDescription></DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter className="flex-col sm:justify-center sm:flex-col">
                                                        <Button onClick={handleAuthModalLogIn}>
                                                            Log In
                                                        </Button>
                                                        <Button
                                                            variant="secondary"
                                                            onClick={handleAuthModalClose}
                                                        >
                                                            Cancel
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                            <Dialog
                                                open={showOfflineModal}
                                                onOpenChange={handleOfflineModalClose}
                                            >
                                                <DialogContent>
                                                    <DialogHeader className="sm:text-center">
                                                        <DialogTitle>
                                                            Connect to the internet to use AI translation
                                                        </DialogTitle>
                                                        <DialogDescription></DialogDescription>
                                                    </DialogHeader>
                                                    <DialogFooter className="flex-col sm:justify-center sm:flex-col">
                                                        <Button
                                                            variant="secondary"
                                                            onClick={handleOfflineModalClose}
                                                        >
                                                            Close
                                                        </Button>
                                                    </DialogFooter>
                                                </DialogContent>
                                            </Dialog>
                                        </>
                                    )}
                                    {lineNumber && lineNumbersEnabled && (
                                        <div
                                            className="cell-line-number whitespace-nowrap text-right mr-[0.25rem]"
                                            style={{
                                                fontWeight: 500,
                                                lineHeight: 1.2,
                                                minWidth: isSourceText ? "3ch" : "1.6ch",
                                                color: "var(--vscode-descriptionForeground)",
                                                fontSize: "0.9em",
                                            }}
                                            title={`Line ${lineNumber}`}
                                        >
                                            {lineNumber}
                                        </div>
                                    )}
                                    {/* Audio Validation Button - show for non-source text only */}
                                    {!isSourceText && SHOW_VALIDATION_BUTTON && (
                                        <div className="flex items-center justify-center gap-x-px">
                                            <AudioValidationButton
                                                cellId={cellIds[0]}
                                                cell={cell}
                                                vscode={vscode}
                                                isSourceText={isSourceText}
                                                currentUsername={currentUsername}
                                                requiredAudioValidations={requiredAudioValidations}
                                                setShowSparkleButton={setShowSparkleButton}
                                                disabled={
                                                    isInTranslationProcess ||
                                                    audioState === "none" ||
                                                    audioState === "deletedOnly"
                                                }
                                                disabledReason={
                                                    isInTranslationProcess
                                                        ? "Translation in progress"
                                                        : audioState === "none" ||
                                                          audioState === "deletedOnly"
                                                        ? "Audio validation requires audio"
                                                        : undefined
                                                }
                                            />
                                        </div>
                                    )}
                                    {/* Audio Play Button - show for both source and non-source text */}
                                    {audioAttachments &&
                                        audioAttachments[cellIds[0]] !== undefined &&
                                        (() => {
                                            // For source text: show the button for available or missing; hide when none/deletedOnly
                                            if (
                                                isSourceText &&
                                                !(
                                                    audioState === "available" ||
                                                    audioState === "available-local" ||
                                                    audioState === "available-pointer" ||
                                                    audioState === "missing"
                                                )
                                            )
                                                return null;

                                            return (
                                                <AudioPlayButton
                                                    cellId={cellIds[0]}
                                                    vscode={vscode}
                                                    state={audioState}
                                                    onOpenCell={(id) => {
                                                        // Use force variant to ensure editor opens even with unsaved state
                                                        const open =
                                                            (window as any).openCellByIdForce ||
                                                            (window as any).openCellById;
                                                        if (typeof open === "function") open(id);
                                                    }}
                                                />
                                            );
                                        })()}
                                    {/* Validation Button - show for non-source text only */}
                                    {!isSourceText && SHOW_VALIDATION_BUTTON && (
                                        <div className="flex flex-col items-center justify-center">
                                            <ValidationButton
                                                cellId={cellIds[0]}
                                                cell={cell}
                                                vscode={vscode}
                                                isSourceText={isSourceText}
                                                currentUsername={currentUsername}
                                                requiredValidations={requiredValidations}
                                                setShowSparkleButton={setShowSparkleButton}
                                                disabled={
                                                    isInTranslationProcess ||
                                                    shouldDisableValidation(
                                                        cell.cellContent,
                                                        audioAttachments?.[cellIds[0]] as any
                                                    )
                                                }
                                                disabledReason={(() => {
                                                    if (isInTranslationProcess) {
                                                        return "Translation in progress";
                                                    }
                                                    const audioState = audioAttachments?.[
                                                        cellIds[0]
                                                    ] as any;
                                                    return shouldDisableValidation(
                                                        cell.cellContent,
                                                        audioState
                                                    )
                                                        ? "Validation disabled: no text"
                                                        : undefined;
                                                })()}
                                            />
                                        </div>
                                    )}

                                    {/* Merge Button - only show in correction editor mode for source text */}
                                    {isSourceText &&
                                        isCorrectionEditorMode &&
                                        !cell.merged &&
                                        (() => {
                                            // Check if this is the first cell - if so, don't show merge button
                                            const currentCellId = cellIds[0];
                                            const currentIndex = translationUnits?.findIndex(
                                                (unit) => unit.cellMarkers[0] === currentCellId
                                            );
                                            const isFirstCell = currentIndex === 0;

                                            return !isFirstCell;
                                        })() && (
                                            <div style={{ flexShrink: 0 }}>
                                                <Button
                                                    variant="ghost"
                                                    style={{
                                                        height: "16px",
                                                        width: "16px",
                                                        padding: 0,
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                    }}
                                                    onClick={handleMergeWithPrevious}
                                                    title="Merge with previous cell"
                                                >
                                                    <i
                                                        className="codicon codicon-merge"
                                                        style={{ fontSize: "12px" }}
                                                    />
                                                </Button>
                                            </div>
                                        )}
                                    {isSourceText && isCorrectionEditorMode && cell.merged && (
                                        <div style={{ flexShrink: 0 }}>
                                            <Button
                                                variant="ghost"
                                                style={{
                                                    height: "16px",
                                                    width: "16px",
                                                    padding: 0,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                }}
                                                onClick={handleCancelMerge}
                                                title="Cancel merge"
                                            >
                                                <i
                                                    className="codicon codicon-debug-step-back"
                                                    style={{ fontSize: "12px" }}
                                                />
                                            </Button>
                                        </div>
                                    )}
                                </div>
                                {getAlertDot()}
                            </div>
                        )}
                    </div>
                </div>

                {/* Right side: wrappable label + content */}
                <div
                    className={`relative flex flex-wrap items-baseline gap-[0.25rem] flex-1 min-w-0 ${
                        lineNumbersEnabled ? "flex-col" : "flex-row"
                    }`}
                    onClick={handleCellContentClick}
                >
                    {/* Cell label - shown after line number when present */}
                    {label && (
                        <CellLabelText
                            label={label}
                            cellDisplayMode={cellDisplayMode}
                            forceLabelTopRow={forceLabelTopRow}
                        />
                    )}
                    <div
                        className={`flex-1 min-w-0 min-h-[1rem] ${
                            lineNumbersEnabled ? "pr-[0.25rem]" : "px-[0.25rem]"
                        }`}
                        title={
                            !(cell.metadata?.isLocked ?? false) ? "Click to edit" : "Cell is locked"
                        }
                    >
                        {renderContent()}

                        {/* Inline backtranslation display */}
                        {showInlineBacktranslations && backtranslation?.backtranslation && (
                            <div
                                style={{
                                    marginTop: "0.25rem",
                                    paddingLeft: "0.5rem",
                                    fontSize: "0.85em",
                                    fontStyle: "italic",
                                    color: "var(--vscode-descriptionForeground)",
                                    opacity: 0.8,
                                    borderLeft: "2px solid var(--vscode-editorWidget-border)",
                                }}
                            >
                                <ReactMarkdown
                                    className="prose prose-sm max-w-none"
                                    components={{
                                        p: ({ children }) => <span>{children}</span>,
                                    }}
                                >
                                    {backtranslation.backtranslation}
                                </ReactMarkdown>
                            </div>
                        )}
                    </div>
                </div>

                {/* Comments Badge positioned at far right of row */}
                <div
                    className="flex flex-col items-center self-center gap-[2px] w-[2rem]"
                    style={{ flexShrink: 0, marginLeft: "0.5rem" }}
                >
                    {initialUnresolvedCommentsCount > 0 ? (
                        <CommentsBadge
                            cellId={cellIds[0]}
                            unresolvedCount={initialUnresolvedCommentsCount}
                        />
                    ) : (
                        <Button
                            title="Open comments"
                            variant="ghost"
                            className="invisible group-hover:visible hover:bg-secondary/80 p-1 rounded-md group-hover:transition-colors h-auto"
                            onClick={() => handleOpenComments(cellIds[0])}
                        >
                            <MessageCircle className="w-4 h-4" />
                        </Button>
                    )}
                    <Button
                        title="Toggle cell lock"
                        variant="ghost"
                        className="p-1 h-[18px]"
                        onClick={handleToggleCellLock}
                    >
                        {!(cell.metadata?.isLocked ?? false) ? (
                            <i
                                className="codicon codicon-unlock invisible group-hover:visible"
                                style={{ fontSize: "1.2em" }}
                            />
                        ) : (
                            <i className="codicon codicon-lock" style={{ fontSize: "1.2em" }} />
                        )}
                    </Button>
                </div>
            </div>
        );
    }
);

// Helper function to format time in MM:SS.mmm format
const formatTime = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
    return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
};

export default CellContentDisplay;
