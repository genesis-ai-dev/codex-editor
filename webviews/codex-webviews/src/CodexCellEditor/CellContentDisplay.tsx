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

const SHOW_VALIDATION_BUTTON = true;
interface CellContentDisplayProps {
    cell: QuillCellContent;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    vscode: WebviewApi<unknown>;
    textDirection: "ltr" | "rtl";
    isSourceText: boolean;
    hasDuplicateId: boolean;
    alertColorCode: number | undefined;
    highlightedCellId?: string | null;
    scrollSyncEnabled: boolean;
    cellLabelOrGeneratedLabel: string;
    isInTranslationProcess?: boolean;
    translationState?: 'waiting' | 'processing' | 'completed' | null;
    allTranslationsComplete?: boolean;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellContentDisplay] ${message}`, ...args);
    }
}

const CellContentDisplay: React.FC<CellContentDisplayProps> = ({
    cell,
    setContentBeingUpdated,
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
}) => {
    const { cellContent, timestamps, editHistory } = cell;
    const cellIds = cell.cellMarkers;
    const [fadingOut, setFadingOut] = useState(false);

    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);

    const cellRef = useRef<HTMLDivElement>(null);
    const { contentToScrollTo } = useContext(ScrollToContentContext);

    // Handle fade-out effect when all translations complete
    useEffect(() => {
        if (allTranslationsComplete && translationState === 'completed') {
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

    const handleVerseClick = () => {
        if (unsavedChanges || isSourceText) {
            toggleFlashingBorder();
            return;
        }

        const documentUri =
            (vscode.getState() as any)?.documentUri || window.location.search.substring(1);

        // First update the content
        setContentBeingUpdated({
            cellMarkers: cellIds,
            cellContent,
            cellChanged: unsavedChanges,
            cellLabel: cellLabelOrGeneratedLabel,
            timestamps,
            uri: documentUri,
        } as EditorCellContent);

        // Then notify the extension about the current cell and document
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: {
                currentLineId: cellIds[0],
            },
        } as EditorPostMessages);
    };

    // Handler for stopping translation when clicked on the spinner
    const handleStopTranslation = (e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent the cell click handler from firing
        
        // If we're in a translation process, stop it
        if (isInTranslationProcess) {
            // Stop autocomplete chapter
            vscode.postMessage({
                command: "stopAutocompleteChapter"
            } as EditorPostMessages);
            
            // Also stop single cell translations
            vscode.postMessage({
                command: "stopSingleCellTranslation"
            } as any); // Use any type to bypass type checking
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
        
        if (!translationState || fadingOut) {
            return {};
        }
        
        let borderColor = "transparent";
        let borderStyle = "solid";
        let opacity = 1;
        
        if (translationState === 'waiting') {
            borderColor = "#ff6b6b"; // Red
        } else if (translationState === 'processing') {
            borderColor = "#ffc14d"; // Yellow
        } else if (translationState === 'completed') {
            borderColor = "#4caf50"; // Green
        }
        
        // Let CSS handle most of the styling through classes
        // Just return minimal inline styles needed
        return { 
            borderColor, 
            borderStyle, 
            borderWidth: "2px",
            transition: "border-color 0.3s ease, opacity 0.8s ease",
            opacity: fadingOut ? 0 : 1
        };
    };

    // Get the CSS class based on translation state
    const getTranslationStateClass = () => {
        if (!translationState) return '';
        
        if (fadingOut) return 'cell-translation-fading';
        
        if (translationState === 'waiting') {
            return 'cell-translation-waiting';
        } else if (translationState === 'processing') {
            return 'cell-translation-processing';
        } else if (translationState === 'completed') {
            return 'cell-translation-completed';
        }
        
        return '';
    };

    return (
        <div
            ref={cellRef}
            className={`cell-content-display ${
                highlightedCellId === cellIds[0] ? "highlighted-cell" : ""
            } ${getTranslationStateClass()}`}
            style={{
                backgroundColor: getBackgroundColor(),
                direction: textDirection,
                ...getBorderStyle()
            }}
            onClick={handleVerseClick}
        >
            <div className="cell-header">
                <div className="cell-actions">
                    <div className="action-button-container">
                        {!isSourceText && isInTranslationProcess && (
                            <VSCodeButton
                                appearance="icon"
                                onClick={handleStopTranslation}
                                style={{ 
                                    height: "16px",
                                    width: "16px",
                                    padding: 0,
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center"
                                }}
                            >
                                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                            </VSCodeButton>
                        )}
                        {!isSourceText && SHOW_VALIDATION_BUTTON && !isInTranslationProcess && (
                            <ValidationButton
                                cellId={cellIds[0]}
                                cell={cell}
                                vscode={vscode}
                                isSourceText={isSourceText}
                            />
                        )}
                    </div>
                    {getAlertDot()}
                </div>
                <div className="cell-label">
                    {cellLabelOrGeneratedLabel && (
                        <span className="cell-label-text">{cellLabelOrGeneratedLabel}</span>
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
