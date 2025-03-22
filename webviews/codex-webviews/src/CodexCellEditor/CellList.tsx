import { EditorCellContent, QuillCellContent, SpellCheckResponse } from "../../../../types";
import React, { useMemo, useCallback, useState, useEffect, useRef } from "react";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { CodexCellTypes } from "../../../../types/enums";
import { getEmptyCellTranslationStyle, CellTranslationState } from "./CellTranslationStyles";

export interface CellListProps {
    spellCheckResponse: SpellCheckResponse | null;
    translationUnits: QuillCellContent[];
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    vscode: any;
    textDirection: "ltr" | "rtl";
    cellDisplayMode: CELL_DISPLAY_MODES;
    isSourceText: boolean;
    windowHeight: number;
    headerHeight: number;
    alertColorCodes: { [cellId: string]: number };
    highlightedCellId: string | null;
    scrollSyncEnabled: boolean;
    translationQueue?: string[]; // Queue of cells waiting for translation
    currentProcessingCellId?: string; // Currently processing cell ID
    cellsInAutocompleteQueue?: string[]; // Cells queued for autocompletion
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellList] ${message}`, ...args);
    }
}

const CellList: React.FC<CellListProps> = ({
    translationUnits,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveHtml,
    vscode,
    textDirection,
    cellDisplayMode,
    isSourceText,
    windowHeight,
    headerHeight,
    spellCheckResponse,
    alertColorCodes,
    highlightedCellId,
    scrollSyncEnabled,
    translationQueue = [],
    currentProcessingCellId,
    cellsInAutocompleteQueue = [],
}) => {
    const numberOfEmptyCellsToRender = 1;
    
    // Add state to track completed translations
    const [completedTranslations, setCompletedTranslations] = useState<Set<string>>(new Set());
    const [allTranslationsComplete, setAllTranslationsComplete] = useState(false);
    
    // Move useRef hook to component level - this fixes React hooks rule violation
    const prevQueueRef = useRef<string[]>([]);

    // Store last request time to implement a simple request throttling
    const [lastRequestTime, setLastRequestTime] = useState(0);

    // Add debug logging for translation state tracking
    useEffect(() => {
        if (DEBUG_ENABLED) {
            debug("Translation tracking state updated:", {
                queue: translationQueue,
                processing: currentProcessingCellId,
                autocompleteQueue: cellsInAutocompleteQueue,
                completed: Array.from(completedTranslations),
                allComplete: allTranslationsComplete
            });
        }
    }, [translationQueue, currentProcessingCellId, cellsInAutocompleteQueue, completedTranslations, allTranslationsComplete]);

    const duplicateCellIds = useMemo(() => {
        const idCounts = new Map<string, number>();
        const duplicates = new Set<string>();

        translationUnits.forEach(({ cellMarkers }) => {
            const id = cellMarkers.join(" ");
            idCounts.set(id, (idCounts.get(id) || 0) + 1);
            if (idCounts.get(id)! > 1) {
                duplicates.add(id);
            }
        });

        return duplicates;
    }, [translationUnits]);
    
    // Convert arrays to Sets for faster lookups
    const translationQueueSet = useMemo(() => new Set(translationQueue), [translationQueue]);
    const autocompleteQueueSet = useMemo(() => new Set(cellsInAutocompleteQueue), [cellsInAutocompleteQueue]);
    
    // Optimized helper function to check if a cell is in the translation queue or currently processing
    const isCellInTranslationProcess = useCallback((cellId: string) => {
        return translationQueueSet.has(cellId) || 
               cellId === currentProcessingCellId || 
               autocompleteQueueSet.has(cellId);
    }, [translationQueueSet, currentProcessingCellId, autocompleteQueueSet]);
    
    // Track cells that move from processing to completed
    useEffect(() => {
        if (!currentProcessingCellId) return;
        
        if (DEBUG_ENABLED) {
            debug("Current processing cell updated:", currentProcessingCellId);
        }
        
        // When a cell is no longer the current processing cell, mark it as completed
        const checkForCompletion = () => {
            if (currentProcessingCellId) {
                if (DEBUG_ENABLED) {
                    debug("Cell completed:", currentProcessingCellId);
                }
                
                setCompletedTranslations(prev => {
                    const newSet = new Set(prev);
                    newSet.add(currentProcessingCellId);
                    return newSet;
                });
            }
        };
        
        // Set up cleanup function to run when currentProcessingCellId changes
        return () => {
            checkForCompletion();
        };
    }, [currentProcessingCellId]);

    // Initialize prevQueueRef when component mounts
    useEffect(() => {
        prevQueueRef.current = [...cellsInAutocompleteQueue];
    }, [cellsInAutocompleteQueue]);

    // Helper function to determine the translation state of a cell
    const getCellTranslationState = useCallback((cellId: string): 'waiting' | 'processing' | 'completed' | null => {
        // First check if this cell is completed - highest priority
        if (completedTranslations.has(cellId)) {
            return 'completed';
        }
        
        // If cell is not in any translation process and not completed, return null
        if (!isCellInTranslationProcess(cellId)) {
            return null;
        }
        
        // Check if this is the current processing cell (either single cell or autocomplete)
        if (cellId === currentProcessingCellId) {
            return 'processing';
        }
        
        // For cells in translation queue or autocomplete queue (waiting to be processed)
        // Using the faster Set-based lookups
        if (translationQueueSet.has(cellId) || autocompleteQueueSet.has(cellId)) {
            return 'waiting';
        }
        
        // Default fallback (shouldn't get here based on other checks)
        return null;
    }, [isCellInTranslationProcess, currentProcessingCellId, completedTranslations, 
        translationQueueSet, autocompleteQueueSet]);

    // Handle sparkle button click with throttling
    const handleCellTranslation = useCallback((cellId: string) => {
        // Skip if this cell is already being translated
        if (isCellInTranslationProcess(cellId)) {
            return;
        }
        
        // Simple throttling - prevent multiple requests within 500ms
        const now = Date.now();
        if (now - lastRequestTime < 500) {
            if (DEBUG_ENABLED) {
                debug("Translation request throttled - too soon after previous request");
            }
            return;
        }
        
        // Update last request time
        setLastRequestTime(now);
        
        // Call the global handler function
        if (typeof (window as any).handleSparkleButtonClick === 'function') {
            (window as any).handleSparkleButtonClick(cellId);
        } else {
            vscode.postMessage({
                command: "llmCompletion",
                content: {
                    currentLineId: cellId,
                    addContentToValue: true,
                },
            });
        }
    }, [isCellInTranslationProcess, vscode, lastRequestTime]);

    // When cells are added/removed from translation queue or completed
    useEffect(() => {
        try {
            // If all queues are empty and we have completed translations
            const noActiveTranslations = translationQueue.length === 0 && 
                                        currentProcessingCellId === undefined &&
                                        cellsInAutocompleteQueue.length === 0;
                                        
            if (noActiveTranslations && completedTranslations.size > 0) {
                // Only set to true if it wasn't already true
                if (!allTranslationsComplete) {
                    debug("All translations complete - starting fade timer");
                    setAllTranslationsComplete(true);
                    
                    // Reset completed translations after fade-out period
                    setTimeout(() => {
                        setCompletedTranslations(new Set());
                        setAllTranslationsComplete(false);
                        debug("Fade complete - reset state");
                    }, 1500); // 1.5s display + 0.5s fade
                }
            } else {
                setAllTranslationsComplete(false);
            }
        } catch (error) {
            console.error("Error in translation queue/completion monitoring:", error);
        }
    }, [translationQueue, currentProcessingCellId, cellsInAutocompleteQueue, completedTranslations]);

    // Also track changes in cellsInAutocompleteQueue to detect completed cells
    useEffect(() => {
        try {
            // Skip effect on first render or if queue is empty
            if (cellsInAutocompleteQueue.length === 0 && prevQueueRef.current.length === 0) {
                return;
            }
            
            // Check which cells were in the previous queue but not in the current one
            const removedCells = prevQueueRef.current.filter(cellId => 
                !cellsInAutocompleteQueue.includes(cellId)
            );
            
            // Mark removed cells as completed
            if (removedCells.length > 0) {
                if (DEBUG_ENABLED) {
                    debug("Cells completed from autocomplete queue:", removedCells);
                }
                
                setCompletedTranslations(prev => {
                    const newSet = new Set(prev);
                    removedCells.forEach(cellId => newSet.add(cellId));
                    return newSet;
                });
            }
            
            // Update the previous queue reference for next comparison
            prevQueueRef.current = [...cellsInAutocompleteQueue];
        } catch (error) {
            console.error("Error in autocomplete queue monitoring:", error);
        }
    }, [cellsInAutocompleteQueue]);

    // Helper function to generate appropriate cell label
    const generateCellLabel = useCallback(
        (cell: QuillCellContent, index: number): string => {
            // If cell already has a label, use it
            if (cell.cellLabel) {
                return cell.cellLabel;
            }

            // Don't use index as fallback for paratext cells
            if (cell.cellType === CodexCellTypes.PARATEXT) {
                return "";
            }

            // Check if this is a child cell
            const cellId = cell.cellMarkers[0];
            const cellIdParts = cellId.split(":");

            // Child cells have more than 2 segments in their ID (e.g., "1TH 1:6:1740475700855-sbcr37orm")
            if (cellIdParts.length > 2) {
                // Get the parent cell ID (e.g., "1TH 1:6")
                const parentCellId = cellIdParts.slice(0, 2).join(":");

                // Find the parent cell
                const parentCell = translationUnits.find(
                    (unit) => unit.cellMarkers[0] === parentCellId
                );

                if (parentCell) {
                    // Get parent's label
                    const parentLabel =
                        parentCell.cellLabel ||
                        (parentCell.cellType !== CodexCellTypes.PARATEXT
                            ? translationUnits.indexOf(parentCell).toString()
                            : "");

                    // Find all siblings (cells with the same parent)
                    const siblings = translationUnits.filter((unit) => {
                        const unitId = unit.cellMarkers[0];
                        const unitIdParts = unitId.split(":");
                        return (
                            unitIdParts.length > 2 &&
                            unitIdParts.slice(0, 2).join(":") === parentCellId
                        );
                    });

                    // Find this cell's index among its siblings
                    const childIndex =
                        siblings.findIndex((sibling) => sibling.cellMarkers[0] === cellId) + 1;

                    // Return label in format "parentLabel.childIndex"
                    return `${parentLabel}.${childIndex}`;
                }
            }

            // Default fallback for regular cells
            return index.toString();
        },
        [translationUnits]
    );

    const renderCellGroup = useCallback(
        (group: typeof translationUnits, startIndex: number) => (
            <span
                key={`group-${startIndex}`}
                className={`verse-group cell-display-${cellDisplayMode}`}
                style={{
                    direction: textDirection,
                    display: cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "inline" : "block",
                    backgroundColor: "transparent",
                }}
            >
                {group.map((cell, index) => {
                    const cellId = cell.cellMarkers.join(" ");
                    const hasDuplicateId = duplicateCellIds.has(cellId);
                    const generatedCellLabel = generateCellLabel(group[index], startIndex + index);
                    const cellMarkers = cell.cellMarkers;
                    const cellIdForTranslation = cellMarkers[0];
                    const translationState = getCellTranslationState(cellIdForTranslation);

                    return (
                        <span
                            key={startIndex + index}
                            style={{
                                display:
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? "inline"
                                        : "block",
                                verticalAlign: "middle",
                                backgroundColor: "transparent",
                            }}
                        >
                            <CellContentDisplay
                                cell={cell}
                                cellLabelOrGeneratedLabel={cell.cellLabel || generatedCellLabel} // Fixme: We should have a separate label for line numbers line numbers should be different the the label for the cell content
                                key={`cell-${cellMarkers[0]}`}
                                setContentBeingUpdated={setContentBeingUpdated}
                                vscode={vscode}
                                textDirection={textDirection}
                                isSourceText={isSourceText}
                                hasDuplicateId={hasDuplicateId}
                                alertColorCode={alertColorCodes[cellMarkers[0]]}
                                highlightedCellId={highlightedCellId}
                                scrollSyncEnabled={scrollSyncEnabled}
                                isInTranslationProcess={isCellInTranslationProcess(cellMarkers[0])}
                                translationState={translationState}
                                allTranslationsComplete={allTranslationsComplete}
                                handleCellTranslation={handleCellTranslation}
                            />
                        </span>
                    );
                })}
            </span>
        ),
        [
            cellDisplayMode,
            textDirection,
            setContentBeingUpdated,
            vscode,
            isSourceText,
            duplicateCellIds,
            highlightedCellId,
            scrollSyncEnabled,
            alertColorCodes,
            generateCellLabel,
            isCellInTranslationProcess,
            getCellTranslationState,
            allTranslationsComplete,
            handleCellTranslation
        ]
    );

    const openCellById = useCallback(
        (cellId: string, text: string) => {
            const cellToOpen = translationUnits.find((unit) => unit.cellMarkers[0] === cellId);

            if (cellToOpen) {
                debug("openCellById", { cellToOpen, text });
                setContentBeingUpdated({
                    cellMarkers: cellToOpen.cellMarkers,
                    cellContent: text,
                    cellChanged: true,
                    cellLabel: cellToOpen.cellLabel,
                });
            } else {
                vscode.postMessage({
                    command: "showErrorMessage",
                    text: `Cell with ID ${cellId} not found.`,
                });
            }
        },
        [translationUnits, setContentBeingUpdated, vscode]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;
        let emptyCellsRendered = 0;

        debug("translationUnits", { translationUnits });

        for (let i = 0; i < translationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType, cellLabel, timestamps, editHistory } =
                translationUnits[i];

            const checkIfCurrentCellIsChild = () => {
                const currentCellId = cellMarkers[0];
                const translationUnitsWithCurrentCellRemoved = translationUnits.filter(
                    ({ cellMarkers }) => cellMarkers[0] !== currentCellId
                );

                const currentCellWithLastIdSegmentRemoved = currentCellId
                    .split(":")
                    .slice(0, 2)
                    .join(":");
                return translationUnitsWithCurrentCellRemoved.some(
                    ({ cellMarkers }) => cellMarkers[0] === currentCellWithLastIdSegmentRemoved
                );
            };

            if (
                !isSourceText &&
                cellMarkers.join(" ") === contentBeingUpdated.cellMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                const cellIsChild = checkIfCurrentCellIsChild();
                const generatedCellLabel = generateCellLabel(translationUnits[i], i);

                result.push(
                    <span
                        key={cellMarkers.join(" ")}
                        style={{ display: "inline-flex", alignItems: "center" }}
                    >
                        <CellEditor
                            editHistory={editHistory}
                            spellCheckResponse={spellCheckResponse}
                            cellIsChild={cellIsChild}
                            cellMarkers={cellMarkers}
                            cellContent={cellContent}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel || generatedCellLabel}
                            cellTimestamps={timestamps}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={setContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            textDirection={textDirection}
                            openCellById={openCellById}
                        />
                    </span>
                );
                groupStartIndex = i + 1;
            } else if (cellContent?.trim()?.length === 0) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }

                // Only render empty cells in one-line-per-cell mode or if it's the next empty cell to render
                if (
                    cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ||
                    translationUnits[i - 1]?.cellContent?.trim()?.length > 0 ||
                    i === 0
                ) {
                    const generatedCellLabel = generateCellLabel(translationUnits[i], i);
                    const cellIdForTranslation = cellMarkers[0];
                    const isInProcess = isCellInTranslationProcess(cellIdForTranslation);
                    const translationState = getCellTranslationState(cellIdForTranslation);

                    const emptyCellDisplay =
                        cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ? (
                            <div
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    padding: "4px 4px 4px 12px",
                                    width: "calc(100% - 20px)",
                                    height: "21px",
                                    marginLeft: "10px",
                                    boxSizing: "border-box",
                                    ...getEmptyCellTranslationStyle(
                                        translationState as CellTranslationState,
                                        allTranslationsComplete
                                    )
                                }}
                            >
                                <div className="cell-header" style={{ display: "flex", minWidth: "80px" }}>
                                    <div className="cell-actions" style={{ 
                                        display: "flex", 
                                        alignItems: "center", 
                                        minWidth: "60px", 
                                        justifyContent: "flex-start",
                                        marginRight: "4px",
                                        marginLeft: "-4px"
                                    }}>
                                        <div className="action-button-container" style={{ 
                                            display: "flex", 
                                            gap: "8px", 
                                            minWidth: "50px",
                                            marginLeft: "4px",
                                            justifyContent: "flex-start",
                                            position: "relative"
                                        }}>
                                            {!isSourceText && (
                                                <div style={{ flexShrink: 0 }}>
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        style={{
                                                            height: "16px",
                                                            width: "16px",
                                                            padding: 0,
                                                            display: "flex",
                                                            alignItems: "center",
                                                            justifyContent: "center"
                                                        }}
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            e.preventDefault();
                                                            // Do nothing - button is just a visual indicator
                                                        }}
                                                    >
                                                        <span style={{ 
                                                            fontSize: "12px", 
                                                            color: "var(--vscode-descriptionForeground)",
                                                            fontWeight: "bold" 
                                                        }}>—</span>
                                                    </VSCodeButton>
                                                </div>
                                            )}
                                            <VSCodeButton
                                                appearance="icon"
                                                aria-label="Translate"
                                                onClick={() => handleCellTranslation(cellMarkers[0])}
                                                style={{
                                                    height: "16px",
                                                    width: "16px",
                                                    padding: 0,
                                                    display: "flex",
                                                    alignItems: "center",
                                                    justifyContent: "center",
                                                    position: "relative"
                                                }}
                                                disabled={isInProcess}
                                                title={isInProcess ? "Translation in progress" : "Translate this cell using AI"}
                                            >
                                                <i
                                                    className={`codicon ${isInProcess ? "codicon-loading codicon-modifier-spin" : "codicon-sparkle"}`}
                                                    style={{ fontSize: "12px" }}
                                                ></i>
                                            </VSCodeButton>
                                        </div>
                                    </div>
                                    <div className="cell-label" style={{ marginLeft: "4px", minWidth: "15px" }}>
                                        {(cellLabel || generatedCellLabel) && (
                                            <span className="cell-label-text">{cellLabel || generatedCellLabel}</span>
                                        )}
                                    </div>
                                </div>
                                <div style={{ 
                                    flex: "1", 
                                    width: "calc(100% - 80px)", 
                                    display: "flex",
                                    flexDirection: "column"
                                }}>
                                    <EmptyCellDisplay
                                        key={cellMarkers.join(" ")}
                                        cellMarkers={cellMarkers}
                                        cellLabel={""}  // Pass empty label since we're already showing it
                                        setContentBeingUpdated={setContentBeingUpdated}
                                        textDirection={textDirection}
                                        vscode={vscode}
                                        openCellById={openCellById}
                                    />
                                </div>
                            </div>
                        ) : (
                            <VSCodeButton
                                appearance="secondary"
                                style={{ 
                                    height: "15px",
                                    padding: "2px",
                                    ...getEmptyCellTranslationStyle(
                                        translationState as CellTranslationState,
                                        allTranslationsComplete
                                    )
                                }}
                                onClick={() => openCellById(cellMarkers[0], "")}
                            >
                                <i
                                    className="codicon codicon-plus"
                                    style={{ fontSize: "12px" }}
                                ></i>
                            </VSCodeButton>
                        );

                    result.push(emptyCellDisplay);
                    emptyCellsRendered++;
                }
                groupStartIndex = i + 1;
            } else {
                currentGroup.push(translationUnits[i]);
            }
        }

        if (currentGroup.length > 0) {
            result.push(renderCellGroup(currentGroup, groupStartIndex));
        }

        return result;
    }, [
        translationUnits,
        contentBeingUpdated,
        isSourceText,
        handleCloseEditor,
        handleSaveHtml,
        renderCellGroup,
        setContentBeingUpdated,
        textDirection,
        vscode,
        spellCheckResponse,
        openCellById,
        cellDisplayMode,
        generateCellLabel,
        handleCellTranslation,
        isCellInTranslationProcess,
        getCellTranslationState,
        allTranslationsComplete
    ]);

    // Debug log to see the structure of translationUnits
    useEffect(() => {
        if (DEBUG_ENABLED && translationUnits.length > 0) {
            console.log("Translation unit structure:", translationUnits[0]);
        }
    }, [translationUnits]);

    return (
        <div
            className="verse-list ql-editor"
            style={{
                direction: textDirection,
                overflowY: "auto",
                display: cellDisplayMode === CELL_DISPLAY_MODES.INLINE ? "inline-block" : "block",
                width: "100%",
                backgroundColor: "transparent",
                maxWidth: "100%",
                padding: "0 1rem",
                boxSizing: "border-box"
            }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo(CellList);
