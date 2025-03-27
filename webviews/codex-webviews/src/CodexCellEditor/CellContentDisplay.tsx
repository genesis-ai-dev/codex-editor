import React, { useContext, useEffect, useRef, useState } from "react";
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
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import ValidationButton from "./ValidationButton";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { getTranslationStyle, CellTranslationState } from "./CellTranslationStyles";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor"; // Import the cell display modes
import "./TranslationAnimations.css"; // Import the animation CSS
import AnimatedReveal from "../components/AnimatedReveal";

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
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cell,
    // setContentBeingUpdated,
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
}) => {
    const { cellContent, timestamps, editHistory } = cell;
    const cellIds = cell.cellMarkers;
    const [fadingOut, setFadingOut] = useState(false);

    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const cellRef = useRef<HTMLDivElement>(null);
    const { contentToScrollTo } = useContext(ScrollToContentContext);

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
            return "rgba(255, 255, 255, 0.1)";
        }
        return "transparent";
    };

    // Get the border style based on translation state
    const getBorderStyle = () => {
        if (hasDuplicateId) {
            return { borderColor: "red" };
        }

        // Return empty object if no translation state
        if (!translationState) {
            return {};
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

    return (
        <div
            ref={cellRef}
            className={`cell-content-display ${
                highlightedCellId === cellIds[0] ? "highlighted-cell" : ""
            } ${getAnimationClassName()}`}
            style={{
                backgroundColor: getBackgroundColor(),
                direction: textDirection,
                ...getBorderStyle(),
            }}
            onClick={() => handleCellClick(cellIds[0])}
        >
            <div className="cell-header">
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
                                        <VSCodeButton
                                            appearance="icon"
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
                                        </VSCodeButton>
                                    )
                                }
                            />
                        </div>
                        {getAlertDot()}
                    </div>
                )}
                <div className="cell-label">
                    {cellLabelOrGeneratedLabel && (
                        <span 
                            className="cell-label-text" 
                            style={
                                cellDisplayMode === CELL_DISPLAY_MODES.INLINE 
                                ? {
                                    fontSize: '0.7em',
                                    verticalAlign: 'super',
                                    lineHeight: 1,
                                    opacity: 0.85,
                                    marginRight: '2px',
                                    fontWeight: 'normal'
                                  }
                                : {}
                            }
                        >
                            {cellLabelOrGeneratedLabel}
                        </span>
                    )}
                </div>
            </div>
            <div
                className="cell-content"
                dangerouslySetInnerHTML={{
                    __html: HACKY_removeContiguousSpans(cellContent),
                }}
            ></div>
        </div>
    );
};

export default CellContentDisplay;
