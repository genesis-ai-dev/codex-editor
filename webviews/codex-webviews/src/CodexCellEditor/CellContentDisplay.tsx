import React, { useContext, useEffect, useRef, useState, useMemo } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    Timestamps,
    EditHistory,
    QuillCellContent,
} from "../../../../types";
import { HACKY_removeContiguousSpans } from "./utils";
import { CodexCellTypes } from "../../../../types/enums";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import { WebviewApi } from "vscode-webview";
import ValidationButton from "./ValidationButton";
import { Button } from "../components/ui/button";
import { getTranslationStyle, CellTranslationState } from "./CellTranslationStyles";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor"; // Import the cell display modes
import "./TranslationAnimations.css"; // Import the animation CSS
import AnimatedReveal from "../components/AnimatedReveal";
import { useTooltip } from "./contextProviders/TooltipContext";

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
    cellLabelOrGeneratedLabel: string;
    isInTranslationProcess?: boolean;
    translationState?: "waiting" | "processing" | "completed" | null;
    allTranslationsComplete?: boolean;
    handleCellTranslation?: (cellId: string) => void;
    handleCellClick: (cellId: string) => void;
    cellDisplayMode: CELL_DISPLAY_MODES;
    audioAttachments?: { [cellId: string]: boolean };
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
}> = ({ cellId, vscode }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    // Pre-load audio data when component mounts
    useEffect(() => {
        // Request audio data for this specific cell when component mounts
        vscode.postMessage({
            command: "requestAudioForCell",
            content: { cellId },
        } as EditorPostMessages);
        setIsLoading(true);
    }, [cellId, vscode]);

    // Listen for audio data messages
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
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
                            setAudioUrl(blobUrl);
                            setIsLoading(false);
                        })
                        .catch((error) => {
                            console.error("Error converting audio data:", error);
                            setIsLoading(false);
                        });
                }
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [cellId]); // Remove audioUrl from dependencies to prevent re-registration

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
            if (isPlaying) {
                // Stop current audio
                if (audioRef.current) {
                    audioRef.current.pause();
                    audioRef.current.currentTime = 0;
                }
                setIsPlaying(false);
            } else {
                // If we're still loading or don't have audio URL, just return
                if (!audioUrl || isLoading) {
                    return;
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

                audioRef.current.src = audioUrl;
                await audioRef.current.play();
                setIsPlaying(true);
            }
        } catch (error) {
            console.error("Error handling audio playback:", error);
            setIsPlaying(false);
        }
    };

    return (
        <button
            onClick={handlePlayAudio}
            className="audio-play-button"
            title={isPlaying ? "Stop audio" : isLoading ? "Loading audio..." : "Play audio"}
            disabled={isLoading || !audioUrl}
            style={{
                background: "none",
                border: "none",
                cursor: isLoading || !audioUrl ? "wait" : "pointer",
                padding: "4px",
                borderRadius: "4px",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                marginLeft: "8px",
                color: "var(--vscode-foreground)",
                opacity: isLoading || !audioUrl ? 0.5 : 0.7,
                transition: "opacity 0.2s",
            }}
            onMouseEnter={(e) => !isLoading && audioUrl && (e.currentTarget.style.opacity = "1")}
            onMouseLeave={(e) => !isLoading && audioUrl && (e.currentTarget.style.opacity = "0.7")}
        >
            <i
                className={`codicon ${
                    isLoading
                        ? "codicon-loading codicon-modifier-spin"
                        : isPlaying
                        ? "codicon-debug-stop"
                        : "codicon-play"
                }`}
                style={{ fontSize: "16px" }}
            />
        </button>
    );
};

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cell,
    vscode,
    textDirection,
    isSourceText,
    hasDuplicateId,
    alertColorCode,
    highlightedCellId,
    scrollSyncEnabled,
    cellLabelOrGeneratedLabel,
    isInTranslationProcess = false,
    translationState = null,
    allTranslationsComplete = false,
    handleCellTranslation,
    handleCellClick,
    cellDisplayMode,
    audioAttachments,
}) => {
    const { cellContent, timestamps, editHistory } = cell;
    const cellIds = cell.cellMarkers;
    const [fadingOut, setFadingOut] = useState(false);
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

            // Update marker text to show its position (1-based)
            const index = Array.from(markers).indexOf(marker);
            if (marker.textContent !== `${index + 1}`) {
                marker.textContent = `${index + 1}`;
            }
        });

        // Clean up listeners when component unmounts
        return () => {
            markers.forEach((marker) => {
                marker.removeEventListener("mouseenter", handleMarkerMouseEnter);
                marker.removeEventListener("mouseleave", handleMarkerMouseLeave);
            });
        };
    }, [cell.cellContent, showTooltip, hideTooltip]);

    // Handle fade-out effect when all translations complete
    useEffect(() => {
        if (allTranslationsComplete && translationState === "completed") {
            const timer = setTimeout(() => {
                setFadingOut(true);
            }, 2000);
            return () => clearTimeout(timer);
        } else if (!allTranslationsComplete) {
            setFadingOut(false);
        }
    }, [allTranslationsComplete, translationState]);

    useEffect(() => {
        debug("Before Scrolling to content highlightedCellId", {
            highlightedCellId,
            cellIds,
            isSourceText,
            scrollSyncEnabled,
        });
        if (
            highlightedCellId === cellIds[0] &&
            cellRef.current &&
            isSourceText &&
            scrollSyncEnabled
        ) {
            debug("Scrolling to content highlightedCellId", {
                highlightedCellId,
                cellIds,
                isSourceText,
            });
            cellRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [highlightedCellId]);

    // Function to process HTML content (now only used to extract footnote information if needed)
    const processHtmlContent = (
        html: string
    ): { footnotes: Array<{ id: string; content: string; position: number }> } => {
        if (!html) return { footnotes: [] };

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, "text/html");

            // Find all footnote markers
            const footnoteMarkers = doc.querySelectorAll("sup.footnote-marker");

            // Skip if no footnote markers
            if (footnoteMarkers.length === 0) {
                return { footnotes: [] };
            }

            // Create ordered map of footnotes based on their position in the document
            const orderedFootnotes: Array<{ id: string; content: string; position: number }> = [];

            // Collect markers and their positions
            footnoteMarkers.forEach((marker) => {
                if (!marker || !marker.textContent) return;

                const fnId = marker.textContent || "";
                const content = marker.getAttribute("data-footnote") || "";

                // Calculate the marker's position in the document
                const treeWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL);
                let position = 0;
                let current = treeWalker.nextNode();

                while (current && current !== marker) {
                    position++;
                    current = treeWalker.nextNode();
                }

                orderedFootnotes.push({
                    id: fnId,
                    content: content,
                    position: position,
                });
            });

            // Sort footnotes by their position in the document
            orderedFootnotes.sort((a, b) => {
                if (!a || !b) return 0;
                return a.position - b.position;
            });

            return { footnotes: orderedFootnotes };
        } catch (error) {
            console.error("Error processing HTML content:", error);
            return { footnotes: [] };
        }
    };

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

    const displayLabel =
        cellLabelOrGeneratedLabel ||
        (() => {
            const numbers = cellIds.map((id) => id.split(":").pop());
            const reference =
                numbers.length === 1 ? numbers[0] : `${numbers[0]}-${numbers[numbers.length - 1]}`;
            return reference?.slice(-3) ?? "";
        })();

    const AlertDot = ({ color }: { color: string }) => (
        <span
            style={{
                display: "inline-block",
                width: "5px",
                height: "5px",
                borderRadius: "50%",
                backgroundColor: color,
                marginLeft: "4px",
            }}
        />
    );

    const getAlertDot = () => {
        if (alertColorCode === -1) return null;

        const colors = {
            "0": "transparent",
            "1": "#FF6B6B",
            "2": "purple",
            "3": "white",
        } as const;
        return (
            <AlertDot
                color={colors[alertColorCode?.toString() as keyof typeof colors] || "transparent"}
            />
        );
    };

    const getBackgroundColor = () => {
        if (highlightedCellId === cellIds[0] && scrollSyncEnabled) {
            return "var(--vscode-editor-selectionBackground)";
        }
        return "transparent";
    };

    const getBorderColor = () => {
        if (highlightedCellId === cellIds[0] && scrollSyncEnabled) {
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

    // Function to check if we should show cell header elements
    const shouldShowHeaderElements = () => {
        return cellDisplayMode !== CELL_DISPLAY_MODES.INLINE;
    };

    // Function to render the content with footnote markers
    const renderContent = () => {
        return (
            <div
                ref={contentRef}
                className="cell-content"
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cell.cellContent || ""),
                }}
                onClick={() => {
                    hideTooltip();
                    handleCellClick(cellIds[0]);
                }}
            />
        );
    };

    return (
        <div
            ref={cellRef}
            className={`cell-content-display ${getAnimationClassName()}`}
            style={{
                backgroundColor: getBackgroundColor(),
                direction: textDirection,
                ...getBorderStyle(),
                display: "flex",
                alignItems: "flex-start",
                gap: "0.5rem",
                padding: "0.25rem",
                cursor: isSourceText ? "default" : "pointer",
                border: "1px solid transparent",
                borderRadius: "4px",
                overflow: "hidden",
                maxWidth: "100%",
                boxSizing: "border-box",
                transition: "border 0.3s ease",
                overflowWrap: "break-word",
                wordWrap: "break-word",
                wordBreak: "break-word",
            }}
        >
            <div
                className="cell-header"
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                }}
            >
                {cellDisplayMode !== CELL_DISPLAY_MODES.INLINE && (
                    <div
                        className="cell-actions"
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                        }}
                    >
                        <div
                            className="action-button-container"
                            style={{
                                display: "flex",
                                gap: "8px",
                            }}
                        >
                            <AnimatedReveal
                                mode="reveal"
                                button={
                                    !isSourceText &&
                                    SHOW_VALIDATION_BUTTON &&
                                    !isInTranslationProcess && (
                                        <div style={{ flexShrink: 0 }}>
                                            <ValidationButton
                                                cellId={cellIds[0]}
                                                cell={cell}
                                                vscode={vscode}
                                                isSourceText={isSourceText}
                                            />
                                        </div>
                                    )
                                }
                                content={
                                    !isSourceText && (
                                        <Button
                                            style={{
                                                height: "16px",
                                                width: "16px",
                                                padding: 0,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                position: "relative",
                                            }}
                                            onClick={
                                                isInTranslationProcess
                                                    ? handleStopTranslation
                                                    : handleSparkleButtonClick
                                            }
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
                                    )
                                }
                            />

                            {/* Audio Play Button */}
                            {audioAttachments && audioAttachments[cellIds[0]] && (
                                <div style={{ flexShrink: 0 }}>
                                    <AudioPlayButton cellId={cellIds[0]} vscode={vscode} />
                                </div>
                            )}
                        </div>
                        {getAlertDot()}
                    </div>
                )}
                <div
                    className={`cell-label ${
                        cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
                            ? "font-medium whitespace-nowrap min-w-fit leading-normal flex items-center h-full"
                            : ""
                    }`}
                >
                    {cellLabelOrGeneratedLabel && (
                        <span
                            className="cell-label-text"
                            style={{
                                ...(cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                    ? {
                                          fontSize: "0.7em",
                                          verticalAlign: "super",
                                          lineHeight: 1,
                                          opacity: 0.85,
                                          marginRight: "2px",
                                          fontWeight: "normal",
                                      }
                                    : {}),
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                maxWidth: "200px", // Adjust this value as needed
                                display: "block",
                            }}
                        >
                            {cellLabelOrGeneratedLabel}
                        </span>
                    )}
                </div>
            </div>

            {/* Render content with footnotes */}
            {renderContent()}
        </div>
    );
};

export default CellContentDisplay;
