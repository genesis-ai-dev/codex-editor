import {
    EditorCellContent,
    EditorPostMessages,
    QuillCellContent,
    SpellCheckResponse,
} from "../../../../types";
import React, { useMemo, useCallback, useState, useEffect, useRef, useContext } from "react";
import CellEditor from "./TextCellEditor";
import CellContentDisplay from "./CellContentDisplay";
import EmptyCellDisplay from "./EmptyCellDisplay";
import { CELL_DISPLAY_MODES } from "./CodexCellEditor";
import { WebviewApi } from "vscode-webview";
import { Button } from "../components/ui/button";
import { CodexCellTypes } from "../../../../types/enums";
import { getEmptyCellTranslationStyle, CellTranslationState } from "./CellTranslationStyles";
import AnimatedReveal from "../components/AnimatedReveal";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import CommentsBadge from "./CommentsBadge";

export interface CellListProps {
    spellCheckResponse: SpellCheckResponse | null;
    translationUnits: QuillCellContent[];
    fullDocumentTranslationUnits: QuillCellContent[]; // Full document for global line numbering
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
    successfulCompletions?: Set<string>; // Cells that completed successfully
    audioAttachments?: { [cellId: string]: boolean }; // Cells that have audio attachments
    isSaving?: boolean;
    saveError?: boolean; // Whether there was a save error/timeout
    saveRetryCount?: number; // Number of save retry attempts
    isCorrectionEditorMode?: boolean; // Whether correction editor mode is active
    fontSize?: number; // Font size for responsive styling
    // Derived, shared state to avoid per-cell auth/validation lookups
    currentUsername?: string | null;
    requiredValidations?: number;
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CellList] ${message}`, ...args);
    }
}

const CellList: React.FC<CellListProps> = ({
    translationUnits,
    fullDocumentTranslationUnits,
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
    successfulCompletions = new Set(),
    audioAttachments,
    isSaving = false,
    saveError = false,
    saveRetryCount = 0,
    isCorrectionEditorMode = false,
    fontSize = 14,
    currentUsername,
    requiredValidations,
}) => {
    const numberOfEmptyCellsToRender = 1;
    const { unsavedChanges, toggleFlashingBorder } = useContext(UnsavedChangesContext);
    // Add state to track completed translations
    const [completedTranslations, setCompletedTranslations] = useState<Set<string>>(new Set());
    const [allTranslationsComplete, setAllTranslationsComplete] = useState(false);

    // State to track unresolved comments count for each cell
    const [cellCommentsCount, setCellCommentsCount] = useState<Map<string, number>>(new Map());

    // Filter out merged cells if we're in correction editor mode for source text
    const filteredTranslationUnits = useMemo(() => {
        if (isSourceText && isCorrectionEditorMode) {
            return translationUnits.filter((unit) => {
                // Check if cell has merged metadata in the data property
                const cellData = unit.data as any;
                return !cellData?.merged;
            });
        }
        return translationUnits;
    }, [translationUnits, isSourceText, isCorrectionEditorMode]);
    // Use filtered units for all operations
    const workingTranslationUnits = filteredTranslationUnits;
    // State to track completed translations (only successful ones) - REMOVED: Now handled by parent
    const [lastRequestTime, setLastRequestTime] = useState(0);

    // Previous queue reference for comparison
    const prevQueueRef = useRef<string[]>([]);

    // Calculate footnote offset for each cell based on previous cells' footnote counts within the same chapter
    // This uses fullDocumentTranslationUnits to count across all subsections within a chapter
    const calculateFootnoteOffset = useCallback(
        (cellIndex: number): number => {
            if (cellIndex >= workingTranslationUnits.length) return 0;

            const currentCell = workingTranslationUnits[cellIndex];
            const currentCellId = currentCell.cellMarkers[0];

            // Extract chapter ID properly: "JUD 1:1" -> "JUD 1"
            const currentChapterId = currentCellId.split(":")[0]; // Gets "JUD 1" from "JUD 1:1"

            // Use fullDocumentTranslationUnits to count footnotes across the entire chapter
            // Find the current cell's index in the full document
            const fullDocumentCellIndex = fullDocumentTranslationUnits.findIndex(
                (cell) => cell.cellMarkers[0] === currentCellId
            );

            if (fullDocumentCellIndex === -1) return 0;

            // Count footnotes only in previous cells within the same chapter (across entire document)
            let footnoteCount = 0;
            for (let i = 0; i < fullDocumentCellIndex; i++) {
                const cell = fullDocumentTranslationUnits[i];
                const cellId = cell.cellMarkers[0];
                const cellChapterId = cellId.split(":")[0]; // Gets "JUD 1" from "JUD 1:1"

                // Only count footnotes if the cell is in the same chapter
                if (
                    cellChapterId === currentChapterId &&
                    cell.cellType !== CodexCellTypes.PARATEXT
                ) {
                    // Extract footnotes from this cell's content
                    const tempDiv = document.createElement("div");
                    tempDiv.innerHTML = cell.cellContent || "";
                    const footnoteMarkers = tempDiv.querySelectorAll("sup.footnote-marker");
                    footnoteCount += footnoteMarkers.length;
                }
            }

            return footnoteCount;
        },
        [workingTranslationUnits, fullDocumentTranslationUnits]
    );

    // Add debug logging for translation state tracking
    useEffect(() => {
        if (DEBUG_ENABLED) {
            debug("Translation tracking state updated:", {
                queue: translationQueue,
                processing: currentProcessingCellId,
                autocompleteQueue: cellsInAutocompleteQueue,
                completed: Array.from(successfulCompletions),
            });
        }
    }, [
        translationQueue,
        currentProcessingCellId,
        cellsInAutocompleteQueue,
        successfulCompletions,
    ]);

    const duplicateCellIds = useMemo(() => {
        const idCounts = new Map<string, number>();
        const duplicates = new Set<string>();

        workingTranslationUnits.forEach(({ cellMarkers }) => {
            const id = cellMarkers.join(" ");
            idCounts.set(id, (idCounts.get(id) || 0) + 1);
            if (idCounts.get(id)! > 1) {
                duplicates.add(id);
            }
        });

        return duplicates;
    }, [workingTranslationUnits]);

    // Convert arrays to Sets for faster lookups
    const translationQueueSet = useMemo(() => new Set(translationQueue), [translationQueue]);
    const autocompleteQueueSet = useMemo(
        () => new Set(cellsInAutocompleteQueue),
        [cellsInAutocompleteQueue]
    );

    // Optimized helper function to check if a cell is in the translation queue or currently processing
    const isCellInTranslationProcess = useCallback(
        (cellId: string) => {
            return (
                translationQueueSet.has(cellId) ||
                cellId === currentProcessingCellId ||
                autocompleteQueueSet.has(cellId)
            );
        },
        [translationQueueSet, currentProcessingCellId, autocompleteQueueSet]
    );

    // Track cells that move from processing to completed - DISABLED to prevent cancelled cells being marked as completed
    // This was causing cancelled cells to turn green instead of just clearing the border
    useEffect(() => {
        if (!currentProcessingCellId) return;

        if (DEBUG_ENABLED) {
            debug("Current processing cell updated:", currentProcessingCellId);
        }

        // NOTE: We don't automatically mark cells as completed when currentProcessingCellId changes
        // because this happens both when translation completes AND when it's cancelled.
        // Instead, we rely on the backend to explicitly tell us when cells are completed.
    }, [currentProcessingCellId]);

    // Initialize prevQueueRef when component mounts
    useEffect(() => {
        prevQueueRef.current = [...cellsInAutocompleteQueue];
    }, [cellsInAutocompleteQueue]);

    // Helper function to determine the translation state of a cell
    const getCellTranslationState = useCallback(
        (cellId: string): "waiting" | "processing" | "completed" | null => {
            // Check if this is the current processing cell first (highest priority)
            if (cellId === currentProcessingCellId) {
                return "processing";
            }

            // Check if cell is successfully completed BEFORE checking queue membership
            // This ensures completed cells show green even if they're still in queue data structures
            if (successfulCompletions.has(cellId)) {
                return "completed";
            }

            // For cells in translation queue or autocomplete queue (waiting to be processed)
            if (translationQueueSet.has(cellId) || autocompleteQueueSet.has(cellId)) {
                return "waiting";
            }

            // Default: no translation state
            return null;
        },
        [currentProcessingCellId, successfulCompletions, translationQueueSet, autocompleteQueueSet]
    );

    // Handle sparkle button click with throttling
    const handleCellTranslation = useCallback(
        (cellId: string) => {
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
            if (typeof (window as any).handleSparkleButtonClick === "function") {
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
        },
        [isCellInTranslationProcess, vscode, lastRequestTime]
    );

    // When cells are added/removed from translation queue or completed
    useEffect(() => {
        try {
            // If all queues are empty and we have successfully completed translations
            const noActiveTranslations =
                translationQueue.length === 0 &&
                currentProcessingCellId === undefined &&
                cellsInAutocompleteQueue.length === 0;

            // Only consider translations complete if we have successfully completed translations AND
            // there are no active translations AND no cells in any queue
            if (noActiveTranslations && successfulCompletions.size > 0) {
                // Only set to true if it wasn't already true
                if (DEBUG_ENABLED) {
                    debug("All translations complete - starting clear timer");
                }
                // The parent component will handle clearing the borders
            } else {
                if (DEBUG_ENABLED) {
                    debug(
                        "There are active translations or no successful completions, not all complete."
                    );
                }
            }
        } catch (error) {
            console.error("Error in translation queue/completion monitoring:", error);
        }
    }, [
        translationQueue,
        currentProcessingCellId,
        cellsInAutocompleteQueue,
        successfulCompletions,
    ]);

    // Also track changes in cellsInAutocompleteQueue to detect completed cells
    useEffect(() => {
        try {
            // Skip effect on first render or if queue is empty
            if (cellsInAutocompleteQueue.length === 0 && prevQueueRef.current.length === 0) {
                return;
            }

            // Check which cells were in the previous queue but not in the current one
            const removedCells = prevQueueRef.current.filter(
                (cellId) => !cellsInAutocompleteQueue.includes(cellId)
            );

            // Only mark removed cells as completed if we're still processing autocomplete
            // If autocomplete is stopped/cancelled, don't mark cells as completed
            if (removedCells.length > 0) {
                if (DEBUG_ENABLED) {
                    debug("Cells removed from autocomplete queue:", removedCells);
                }

                // Only mark as completed if autocomplete is still processing
                // This prevents cancelled cells from being marked as completed
                if (currentProcessingCellId !== undefined) {
                    if (DEBUG_ENABLED) {
                        debug("Marking cells as successfully completed:", removedCells);
                    }

                    // The parent component will handle marking cells as completed
                } else {
                    if (DEBUG_ENABLED) {
                        debug("Not marking cells as completed - no current processing cell");
                    }
                }
            }

            // Update the previous queue reference for next comparison
            prevQueueRef.current = [...cellsInAutocompleteQueue];
        } catch (error) {
            console.error("Error in autocomplete queue monitoring:", error);
        }
    }, [cellsInAutocompleteQueue, currentProcessingCellId]);

    // Helper function to generate appropriate cell label using global line numbers
    // Helper function to get the global visible cell number (skipping paratext cells)
    const getGlobalVisibleCellNumber = useCallback(
        (cell: QuillCellContent, allCells: QuillCellContent[]): number => {
            const cellIndex = allCells.findIndex(
                (unit) => unit.cellMarkers[0] === cell.cellMarkers[0]
            );

            if (cellIndex === -1) return 1; // Fallback if not found

            // Count non-paratext cells up to and including this one
            let visibleCellCount = 0;
            for (let i = 0; i <= cellIndex; i++) {
                const cellIdParts = allCells[i].cellMarkers[0].split(":");
                if (
                    allCells[i].cellType !== CodexCellTypes.PARATEXT &&
                    cellIdParts.length < 3 &&
                    !allCells[i].merged
                ) {
                    visibleCellCount++;
                }
            }

            return visibleCellCount;
        },
        []
    );

    const generateCellLabel = useCallback(
        (cell: QuillCellContent, currentCellsArray: QuillCellContent[]): string => {
            // If cell already has a label, use it
            if (cell.merged) {
                return "❌";
            }

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

                // Find the parent cell in the full document
                const parentCell = fullDocumentTranslationUnits.find(
                    (unit: QuillCellContent) => unit.cellMarkers[0] === parentCellId
                );

                if (parentCell) {
                    // Get parent's label using global line numbers
                    const parentLabel =
                        parentCell.cellLabel ||
                        (parentCell.cellType !== CodexCellTypes.PARATEXT
                            ? getGlobalVisibleCellNumber(parentCell, fullDocumentTranslationUnits)
                            : "");

                    // Find all siblings (cells with the same parent)
                    const siblings = fullDocumentTranslationUnits.filter(
                        (unit: QuillCellContent) => {
                            const unitId = unit.cellMarkers[0];
                            const unitIdParts = unitId.split(":");
                            return (
                                unitIdParts.length > 2 &&
                                unitIdParts.slice(0, 2).join(":") === parentCellId
                            );
                        }
                    );

                    // Find this cell's index among its siblings
                    const childIndex =
                        siblings.findIndex(
                            (sibling: QuillCellContent) => sibling.cellMarkers[0] === cellId
                        ) + 1;

                    // Return label in format "parentLabel.childIndex"
                    return `${parentLabel}.${childIndex}`;
                }
            }

            // Get global visible cell number (skipping paratext cells)
            return getGlobalVisibleCellNumber(cell, fullDocumentTranslationUnits).toString();
        },
        [fullDocumentTranslationUnits, getGlobalVisibleCellNumber]
    );

    // Helper function to determine if cell content is effectively empty
    const isCellContentEmpty = (cellContent: string | undefined): boolean => {
        if (!cellContent) return true;

        // Create a temporary div to parse HTML and extract text content
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = cellContent;
        const textContent = tempDiv.textContent || tempDiv.innerText || "";

        // Check if the text content contains only whitespace characters (including non-breaking spaces)
        // This regex matches any combination of:
        // - Regular spaces (\s)
        // - Non-breaking spaces (\u00A0)
        // - Other Unicode whitespace characters
        const onlyWhitespaceRegex = /^[\s\u00A0\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]*$/;

        return onlyWhitespaceRegex.test(textContent);
    };

    const openCellById = useCallback(
        (cellId: string) => {
            const cellToOpen = workingTranslationUnits.find(
                (unit) => unit.cellMarkers[0] === cellId
            );
            if (unsavedChanges || (isSourceText && !isCorrectionEditorMode)) {
                toggleFlashingBorder();
                return;
            }
            const documentUri =
                (vscode.getState() as any)?.documentUri || window.location.search.substring(1);

            if (cellToOpen) {
                debug("openCellById", { cellToOpen, text: cellToOpen.cellContent });
                setContentBeingUpdated({
                    cellMarkers: cellToOpen.cellMarkers,
                    cellContent: cellToOpen.cellContent,
                    cellChanged: true,
                    cellLabel: cellToOpen.cellLabel,
                    timestamps: cellToOpen.timestamps,
                    uri: documentUri,
                } as EditorCellContent);
                vscode.postMessage({
                    command: "setCurrentIdToGlobalState",
                    content: {
                        currentLineId: cellToOpen.cellMarkers[0],
                    },
                } as EditorPostMessages);
            } else {
                vscode.postMessage({
                    command: "showErrorMessage",
                    text: `Cell with ID ${cellId} not found.`,
                });
            }
        },
        [
            workingTranslationUnits,
            setContentBeingUpdated,
            vscode,
            unsavedChanges,
            isSourceText,
            isCorrectionEditorMode,
            toggleFlashingBorder,
        ]
    );

    const renderCellGroup = useCallback(
        (group: typeof workingTranslationUnits, startIndex: number) => (
            <span
                key={`group-${group[0]?.cellMarkers?.[0] ?? startIndex}`}
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
                    // Use the current translationUnits array for context, but generate global labels
                    const generatedCellLabel = generateCellLabel(cell, workingTranslationUnits);
                    const cellMarkers = cell.cellMarkers;
                    const cellIdForTranslation = cellMarkers[0];
                    const translationState = getCellTranslationState(cellIdForTranslation);

                    return (
                        <span
                            key={`${cellMarkers[0]}:${startIndex + index}`}
                            style={{
                                display:
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? "inline"
                                        : "block",
                                verticalAlign: "middle",
                                backgroundColor: "transparent",
                                opacity: cell.merged ? 0.5 : 1,
                            }}
                        >
                            <CellContentDisplay
                                cell={cell}
                                cellLabelOrGeneratedLabel={cell.cellLabel || generatedCellLabel} // Fixme: We should have a separate label for line numbers line numbers should be different the the label for the cell content
                                key={`cell-${cellMarkers[0]}`}
                                vscode={vscode}
                                textDirection={textDirection}
                                isSourceText={isSourceText}
                                hasDuplicateId={hasDuplicateId}
                                alertColorCode={alertColorCodes[cellMarkers[0]]}
                                highlightedCellId={highlightedCellId}
                                scrollSyncEnabled={scrollSyncEnabled}
                                isInTranslationProcess={isCellInTranslationProcess(cellMarkers[0])}
                                translationState={translationState}
                                allTranslationsComplete={successfulCompletions.size > 0} // Assuming all complete if there are successful completions
                                handleCellTranslation={handleCellTranslation}
                                handleCellClick={openCellById}
                                cellDisplayMode={cellDisplayMode}
                                audioAttachments={audioAttachments}
                                footnoteOffset={calculateFootnoteOffset(startIndex + index)}
                                isCorrectionEditorMode={isCorrectionEditorMode}
                                translationUnits={workingTranslationUnits}
                                unresolvedCommentsCount={cellCommentsCount.get(cellMarkers[0]) || 0}
                                currentUsername={currentUsername || undefined}
                                requiredValidations={requiredValidations}
                            />
                        </span>
                    );
                })}
            </span>
        ),
        [
            cellDisplayMode,
            textDirection,
            vscode,
            isSourceText,
            duplicateCellIds,
            highlightedCellId,
            scrollSyncEnabled,
            alertColorCodes,
            generateCellLabel,
            isCellInTranslationProcess,
            getCellTranslationState,
            successfulCompletions,
            handleCellTranslation,
            audioAttachments,
            calculateFootnoteOffset,
            isCorrectionEditorMode,
            workingTranslationUnits,
            cellCommentsCount,
            openCellById,
            currentUsername,
            requiredValidations,
        ]
    );

    const renderCells = useCallback(() => {
        const result = [];
        let currentGroup = [];
        let groupStartIndex = 0;
        let emptyCellsRendered = 0;

        debug("workingTranslationUnits", { workingTranslationUnits });

        for (let i = 0; i < workingTranslationUnits.length; i++) {
            const { cellMarkers, cellContent, cellType, cellLabel, timestamps, editHistory } =
                workingTranslationUnits[i];

            const checkIfCurrentCellIsChild = () => {
                const currentCellId = cellMarkers[0];
                const translationUnitsWithCurrentCellRemoved = workingTranslationUnits.filter(
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
                (!isSourceText || (isSourceText && isCorrectionEditorMode)) &&
                cellMarkers.join(" ") === contentBeingUpdated.cellMarkers?.join(" ")
            ) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }
                const cellIsChild = checkIfCurrentCellIsChild();
                // Use global line numbering
                const generatedCellLabel = generateCellLabel(
                    workingTranslationUnits[i],
                    workingTranslationUnits
                );

                result.push(
                    <span
                        key={`${cellMarkers.join(" ")}:editor`}
                        style={{ display: "inline-flex", alignItems: "center", width: "100%" }}
                    >
                        <CellEditor
                            cell={workingTranslationUnits[i]}
                            editHistory={editHistory}
                            spellCheckResponse={spellCheckResponse}
                            cellIsChild={cellIsChild}
                            cellMarkers={cellMarkers}
                            cellContent={cellContent}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel || generatedCellLabel}
                            cellTimestamps={timestamps}
                            prevEndTime={workingTranslationUnits[i - 1]?.timestamps?.endTime}
                            nextStartTime={workingTranslationUnits[i + 1]?.timestamps?.startTime}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={setContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            textDirection={textDirection}
                            openCellById={openCellById}
                            isSaving={isSaving}
                            saveError={saveError}
                            saveRetryCount={saveRetryCount}
                            footnoteOffset={calculateFootnoteOffset(i) + 1}
                        />
                    </span>
                );
                groupStartIndex = i + 1;
            } else if (isCellContentEmpty(cellContent)) {
                if (currentGroup.length > 0) {
                    result.push(renderCellGroup(currentGroup, groupStartIndex));
                    currentGroup = [];
                }

                // Only render empty cells in one-line-per-cell mode or if it's the next empty cell to render
                if (
                    cellDisplayMode === CELL_DISPLAY_MODES.ONE_LINE_PER_CELL ||
                    !isCellContentEmpty(workingTranslationUnits[i - 1]?.cellContent) ||
                    i === 0
                ) {
                    // Use global line numbering
                    const generatedCellLabel = generateCellLabel(
                        workingTranslationUnits[i],
                        workingTranslationUnits
                    );
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
                                    height:
                                        fontSize > 14
                                            ? fontSize <= 18
                                                ? "25px"
                                                : fontSize <= 22
                                                ? "29px"
                                                : fontSize <= 26
                                                ? "33px"
                                                : "37px"
                                            : "21px",
                                    boxSizing: "border-box",
                                    ...getEmptyCellTranslationStyle(
                                        translationState as CellTranslationState,
                                        successfulCompletions.size > 0
                                    ),
                                }}
                            >
                                <div style={{ display: "flex", width: "16px" }} />
                                <AnimatedReveal
                                    mode="swap"
                                    button={
                                        !isSourceText && (
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
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        e.preventDefault();
                                                        // Do nothing - button is just a visual indicator
                                                    }}
                                                >
                                                    <i
                                                        className="codicon codicon-dash"
                                                        style={{
                                                            fontSize: "12px",
                                                            color: "var(--vscode-descriptionForeground)",
                                                            fontWeight: "bold",
                                                        }}
                                                    ></i>
                                                </Button>
                                            </div>
                                        )
                                    }
                                    content={
                                        <Button
                                            variant="ghost"
                                            aria-label="Translate"
                                            onClick={() => handleCellTranslation(cellMarkers[0])}
                                            style={{
                                                height: "16px",
                                                width: "16px",
                                                padding: 0,
                                                display: "flex",
                                                alignItems: "center",
                                                justifyContent: "center",
                                                position: "relative",
                                            }}
                                            disabled={isInProcess}
                                            title={
                                                isInProcess
                                                    ? "Translation in progress"
                                                    : "Translate this cell using AI"
                                            }
                                        >
                                            <i
                                                className={`codicon ${
                                                    isInProcess
                                                        ? "codicon-loading codicon-modifier-spin"
                                                        : "codicon-sparkle"
                                                }`}
                                                style={{ fontSize: "12px" }}
                                            ></i>
                                        </Button>
                                    }
                                />
                                {(cellLabel || generatedCellLabel) && (
                                    <span
                                        className="cell-label-text"
                                        style={{ marginLeft: "10px" }}
                                    >
                                        {" "}
                                        {/* This is to account for the span that's for the {getAlertDot()} in the translated cells */}
                                        {cellLabel || generatedCellLabel}
                                    </span>
                                )}
                                <div
                                    style={{
                                        flex: "1",
                                        width: "calc(100% - 80px)",
                                        display: "flex",
                                        flexDirection: "column",
                                    }}
                                >
                                    <EmptyCellDisplay
                                        key={`${cellMarkers.join(" ")}:empty`}
                                        cellMarkers={cellMarkers}
                                        cellLabel={""} // Pass empty label since we're already showing it
                                        setContentBeingUpdated={setContentBeingUpdated}
                                        textDirection={textDirection}
                                        vscode={vscode}
                                        openCellById={openCellById}
                                        fontSize={fontSize}
                                    />
                                </div>
                                {/* Comments Badge positioned on the right */}
                                <div style={{ flexShrink: 0, marginLeft: "0.5rem" }}>
                                    <CommentsBadge
                                        cellId={cellMarkers[0]}
                                        unresolvedCount={cellCommentsCount.get(cellMarkers[0]) || 0}
                                    />
                                </div>
                            </div>
                        ) : (
                            <Button
                                style={{
                                    height: "15px",
                                    padding: "2px",
                                    marginTop:
                                        fontSize > 14
                                            ? fontSize <= 18
                                                ? "2px"
                                                : fontSize <= 22
                                                ? "4px"
                                                : fontSize <= 26
                                                ? "6px"
                                                : "8px"
                                            : "0px",
                                    marginBottom:
                                        fontSize > 14
                                            ? fontSize <= 18
                                                ? "2px"
                                                : fontSize <= 22
                                                ? "4px"
                                                : fontSize <= 26
                                                ? "6px"
                                                : "8px"
                                            : "0px",
                                    ...getEmptyCellTranslationStyle(
                                        translationState as CellTranslationState,
                                        successfulCompletions.size > 0
                                    ),
                                }}
                                onClick={() => openCellById(cellMarkers[0])}
                            >
                                <i
                                    className="codicon codicon-plus"
                                    style={{ fontSize: "12px" }}
                                ></i>
                            </Button>
                        );

                    result.push(emptyCellDisplay);
                    emptyCellsRendered++;
                }
                groupStartIndex = i + 1;
            } else {
                currentGroup.push(workingTranslationUnits[i]);
            }
        }

        if (currentGroup.length > 0) {
            result.push(renderCellGroup(currentGroup, groupStartIndex));
        }

        return result;
    }, [
        workingTranslationUnits,
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
        successfulCompletions,
        calculateFootnoteOffset,
        isCorrectionEditorMode,
        cellCommentsCount,
        isSaving,
        fontSize,
    ]);

    // Fetch comments count for all visible cells
    useEffect(() => {
        const fetchCommentsForAllCells = () => {
            // Only request counts for cells we don't have yet to avoid redundant traffic
            workingTranslationUnits.forEach((unit) => {
                const cellId = unit.cellMarkers[0];
                if (!cellCommentsCount.has(cellId)) {
                    const messageContent: EditorPostMessages = {
                        command: "getCommentsForCell",
                        content: {
                            cellId: cellId,
                        },
                    };
                    vscode.postMessage(messageContent);
                }
            });
        };

        if (workingTranslationUnits.length > 0) {
            fetchCommentsForAllCells();
        }
    }, [workingTranslationUnits, vscode, cellCommentsCount]);

    // Handle comments count responses
    useEffect(() => {
        const handleCommentsResponse = (event: MessageEvent) => {
            if (event.data.type === "commentsForCell") {
                const { cellId, unresolvedCount } = event.data.content;
                setCellCommentsCount((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(cellId, unresolvedCount || 0);
                    return newMap;
                });
            }
        };

        window.addEventListener("message", handleCommentsResponse);
        return () => window.removeEventListener("message", handleCommentsResponse);
    }, []);

    // Handle refresh comments request
    useEffect(() => {
        const handleRefreshComments = (event: MessageEvent) => {
            if (event.data.type === "refreshCommentCounts") {
                console.log("Refreshing comment counts due to comments file change");
                // Re-fetch comments count for all cells
                workingTranslationUnits.forEach((unit) => {
                    const cellId = unit.cellMarkers[0];
                    const messageContent: EditorPostMessages = {
                        command: "getCommentsForCell",
                        content: {
                            cellId: cellId,
                        },
                    };
                    vscode.postMessage(messageContent);
                });
            }
        };

        window.addEventListener("message", handleRefreshComments);
        return () => window.removeEventListener("message", handleRefreshComments);
    }, [workingTranslationUnits, vscode]);

    // Debug log to see the structure of translationUnits
    useEffect(() => {
        if (DEBUG_ENABLED && workingTranslationUnits.length > 0) {
            console.log("Translation unit structure:", workingTranslationUnits[0]);
        }
    }, [workingTranslationUnits]);

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
                boxSizing: "border-box",
                paddingTop: "1rem",
                paddingBottom: "4rem",
            }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo<CellListProps>(CellList);
