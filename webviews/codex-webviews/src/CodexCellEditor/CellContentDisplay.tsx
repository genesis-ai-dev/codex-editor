import React, { useContext, useEffect, useRef, useState, useMemo } from "react";
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
    footnoteOffset?: number; // Starting footnote number for this cell
    isCorrectionEditorMode?: boolean; // Whether correction editor mode is active
    translationUnits?: QuillCellContent[]; // Full list of translation units for finding previous cell
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
    footnoteOffset = 0,
    isCorrectionEditorMode = false,
    translationUnits = [],
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

        // Find the previous cell
        const previousCell = translationUnits[currentIndex - 1];
        const currentCell = translationUnits[currentIndex];

        if (!previousCell || !currentCell) {
            console.error("Could not find previous or current cell");
            return;
        }

        // Send confirmation request to VS Code instead of using window.confirm
        vscode.postMessage({
            command: "confirmCellMerge",
            content: {
                currentCellId: currentCell.cellMarkers[0],
                previousCellId: previousCell.cellMarkers[0],
                currentContent: currentCell.cellContent,
                previousContent: previousCell.cellContent,
                message:
                    "Are you sure you want to merge this cell with the previous cell? This action cannot be undone.",
            },
        } as any);
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

    // Function to render the content with footnote markers and proper spacing
    const renderContent = () => {
        // Use the proper HTML processing utility instead of hacky approach
        const processedHtml = processHtmlContent(cell.cellContent || "");

        return (
            <div
                ref={contentRef}
                className="cell-content"
                dangerouslySetInnerHTML={{
                    __html: processedHtml,
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

                            {/* Merge Button - only show in correction editor mode for source text */}
                            {isSourceText && isCorrectionEditorMode && (
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
                                            className="codicon codicon-combine"
                                            style={{ fontSize: "12px" }}
                                        />
                                    </Button>
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
