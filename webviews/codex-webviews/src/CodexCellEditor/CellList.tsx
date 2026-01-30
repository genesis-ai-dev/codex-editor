import {
    EditorCellContent,
    EditorPostMessages,
    QuillCellContent,
    SpellCheckResponse,
    MilestoneIndex,
    CustomNotebookMetadata,
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
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import CommentsBadge from "./CommentsBadge";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { sanitizeQuillHtml } from "./utils";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";

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
    highlightedGlobalReferences: string[];
    highlightedCellId?: string | null; // Optional cellId for fallback matching when globalReferences is empty
    scrollSyncEnabled: boolean;
    translationQueue?: string[]; // Queue of cells waiting for translation
    currentProcessingCellId?: string; // Currently processing cell ID
    cellsInAutocompleteQueue?: string[]; // Cells queued for autocompletion
    successfulCompletions?: Set<string>; // Cells that completed successfully
    audioAttachments?: {
        [cellId: string]:
            | "available"
            | "available-local"
            | "available-pointer"
            | "deletedOnly"
            | "none"
            | "missing";
    }; // Cells that have audio attachments
    isSaving?: boolean;
    saveError?: boolean; // Whether there was a save error/timeout
    saveErrorMessage?: string | null; // Error message to display when save fails
    saveRetryCount?: number; // Number of save retry attempts
    isCorrectionEditorMode?: boolean; // Whether correction editor mode is active
    fontSize?: number; // Font size for responsive styling
    lineNumbersEnabled?: boolean; // Whether line numbers should be shown
    // Derived, shared state to avoid per-cell auth/validation lookups
    currentUsername?: string | null;
    requiredValidations?: number;
    requiredAudioValidations?: number;
    isAuthenticated?: boolean;
    userAccessLevel?: number;
    // Cells currently undergoing audio transcription
    transcribingCells?: Set<string>;
    isAudioOnly?: boolean;
    showInlineBacktranslations?: boolean;
    backtranslationsMap?: Map<string, any>;
    // Milestone-based pagination props for global line numbering
    milestoneIndex?: MilestoneIndex | null;
    currentMilestoneIndex?: number;
    currentSubsectionIndex?: number;
    cellsPerPage?: number;
    // Video player props
    playerRef?: React.RefObject<ReactPlayerRef>;
    shouldShowVideoPlayer?: boolean;
    videoUrl?: string;
    // Audio playback state from other webview type
    isOtherTypeAudioPlaying?: boolean;
    metadata?: CustomNotebookMetadata;
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
    highlightedGlobalReferences,
    highlightedCellId,
    scrollSyncEnabled,
    translationQueue = [],
    currentProcessingCellId,
    cellsInAutocompleteQueue = [],
    successfulCompletions = new Set(),
    audioAttachments,
    isSaving = false,
    saveError = false,
    saveErrorMessage = null,
    saveRetryCount = 0,
    isCorrectionEditorMode = false,
    fontSize = 14,
    lineNumbersEnabled = true,
    currentUsername,
    requiredValidations,
    requiredAudioValidations,
    transcribingCells,
    userAccessLevel,
    isAudioOnly = false,
    showInlineBacktranslations = false,
    backtranslationsMap = new Map(),
    isAuthenticated = false,
    milestoneIndex = null,
    playerRef,
    shouldShowVideoPlayer = false,
    videoUrl,
    currentMilestoneIndex = 0,
    currentSubsectionIndex = 0,
    cellsPerPage = 50,
    isOtherTypeAudioPlaying = false,
    metadata,
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
        let filtered = translationUnits;

        // Filter out merged cells if we're in correction editor mode for source text
        if (isSourceText && isCorrectionEditorMode) {
            filtered = filtered.filter((unit) => {
                // Check if cell has merged metadata in the data property
                const cellData = unit.data as any;
                return !cellData?.merged;
            });
        }

        // Filter out milestone cells from the view (they remain in JSON)
        filtered = filtered.filter((unit) => unit.cellType !== CodexCellTypes.MILESTONE);

        return filtered;
    }, [translationUnits, isSourceText, isCorrectionEditorMode]);
    // Use filtered units for all operations
    const workingTranslationUnits = filteredTranslationUnits;
    // State to track completed translations (only successful ones) - REMOVED: Now handled by parent
    const [lastRequestTime, setLastRequestTime] = useState(0);

    // Previous queue reference for comparison
    const prevQueueRef = useRef<string[]>([]);

    // Calculate footnote offset for each cell based on previous cells' footnote counts within the same milestone
    // This counts footnotes from previous subsections (pages) in the same milestone
    const calculateFootnoteOffset = useCallback(
        (cellIndex: number): number => {
            if (cellIndex >= workingTranslationUnits.length) return 0;

            const currentCell = workingTranslationUnits[cellIndex];
            const currentCellId = currentCell.cellMarkers[0];

            // Get the milestone index for the current cell from its metadata
            // Cells have milestoneIndex stored in metadata.data.milestoneIndex
            const currentMilestoneIdx =
                (currentCell.data as any)?.milestoneIndex ??
                (currentCell.metadata as any)?.data?.milestoneIndex;

            // If we have milestone index and milestone info, use milestone-based counting
            if (
                currentMilestoneIdx !== undefined &&
                currentMilestoneIdx !== null &&
                milestoneIndex &&
                currentMilestoneIdx < milestoneIndex.milestones.length
            ) {
                // Use fullDocumentTranslationUnits which should now contain all cells in the milestone
                // Find the current cell's index in the full milestone
                const fullMilestoneCellIndex = fullDocumentTranslationUnits.findIndex(
                    (cell) => cell.cellMarkers[0] === currentCellId
                );

                if (fullMilestoneCellIndex === -1) {
                    // Cell not found in full milestone, fall back to counting from current page
                    let footnoteCount = 0;
                    for (let i = 0; i < cellIndex; i++) {
                        const cell = workingTranslationUnits[i];
                        if (cell.cellType !== CodexCellTypes.MILESTONE) {
                            const tempDiv = document.createElement("div");
                            tempDiv.innerHTML = cell.cellContent || "";
                            const footnoteMarkers = tempDiv.querySelectorAll("sup.footnote-marker");
                            footnoteCount += footnoteMarkers.length;
                        }
                    }
                    return footnoteCount;
                }

                // Count footnotes from all previous cells in the same milestone (including previous pages)
                let footnoteCount = 0;
                for (let i = 0; i < fullMilestoneCellIndex; i++) {
                    const cell = fullDocumentTranslationUnits[i];

                    // Get the milestone index for this cell
                    const cellMilestoneIdx =
                        (cell.data as any)?.milestoneIndex ??
                        (cell.metadata as any)?.data?.milestoneIndex;

                    // Only count footnotes if the cell is in the same milestone
                    // Include paratext cells in the same milestone for footnote numbering continuity
                    if (
                        cellMilestoneIdx === currentMilestoneIdx &&
                        cell.cellType !== CodexCellTypes.MILESTONE
                    ) {
                        // Extract footnotes from this cell's content
                        const tempDiv = document.createElement("div");
                        tempDiv.innerHTML = cell.cellContent || "";
                        const footnoteMarkers = tempDiv.querySelectorAll("sup.footnote-marker");
                        footnoteCount += footnoteMarkers.length;
                    }
                }

                return footnoteCount;
            }

            return 0;
        },
        [
            workingTranslationUnits,
            fullDocumentTranslationUnits,
            milestoneIndex,
            currentMilestoneIndex,
            currentSubsectionIndex,
            cellsPerPage,
        ]
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
            // Show processing effect for source cells being transcribed
            if (isSourceText && transcribingCells?.has(cellId)) {
                return "processing";
            }
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
        [
            currentProcessingCellId,
            successfulCompletions,
            translationQueueSet,
            autocompleteQueueSet,
            isSourceText,
            transcribingCells,
        ]
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

    // Helper function to get cell identifier (prefer globalReferences, fallback to cellMarkers)
    const getCellIdentifier = useCallback((cell: QuillCellContent): string => {
        // Prefer globalReferences (new format after migration)
        const globalRefs = cell.data?.globalReferences;
        if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
            return globalRefs[0];
        }
        // Fallback to cellMarkers for backward compatibility
        return cell.cellMarkers[0] || "";
    }, []);

    // Helper function to check if a cell is a child cell
    const isChildCell = useCallback(
        (cell: QuillCellContent): boolean => {
            // Check if this is a child cell by checking metadata.parentId (new UUID format)
            if (cell.data?.parentId !== undefined) {
                return true;
            }
            // Legacy: also check ID format for backward compatibility during migration
            const cellId = getCellIdentifier(cell);
            return Boolean(cellId && cellId.split(":").length > 2);
        },
        [getCellIdentifier]
    );

    // Calculate offset for current page based on milestone/subsection indices
    const calculateLineNumberOffset = useCallback((): number => {
        if (!milestoneIndex || milestoneIndex.milestones.length === 0) {
            return 0;
        }

        let offset = 0;

        // Add cells from all previous milestones
        for (let i = 0; i < currentMilestoneIndex && i < milestoneIndex.milestones.length; i++) {
            offset += milestoneIndex.milestones[i].cellCount;
        }

        // Add cells from previous subsections in current milestone
        if (
            currentSubsectionIndex > 0 &&
            currentMilestoneIndex < milestoneIndex.milestones.length
        ) {
            const currentMilestone = milestoneIndex.milestones[currentMilestoneIndex];
            const effectiveCellsPerPage = milestoneIndex.cellsPerPage || cellsPerPage;
            // Calculate how many cells are in previous subsections
            offset += currentSubsectionIndex * effectiveCellsPerPage;
        }

        return offset;
    }, [milestoneIndex, currentMilestoneIndex, currentSubsectionIndex, cellsPerPage]);

    // Helper function to get the chapter-based verse number (skipping paratext cells)
    // Now uses globalReferences and includes offset for pagination
    const getChapterBasedVerseNumber = useCallback(
        (cell: QuillCellContent, allCells: QuillCellContent[]): number => {
            const cellIdentifier = getCellIdentifier(cell);
            if (!cellIdentifier) return 1; // Fallback if no identifier

            const cellIndex = allCells.findIndex(
                (unit) => getCellIdentifier(unit) === cellIdentifier
            );

            if (cellIndex === -1) return 1; // Fallback if not found

            // Count non-paratext, non-milestone, non-child cells up to and including this one
            let visibleCellCount = 0;
            for (let i = 0; i <= cellIndex; i++) {
                const unit = allCells[i];
                if (
                    unit.cellType !== CodexCellTypes.PARATEXT &&
                    unit.cellType !== CodexCellTypes.MILESTONE &&
                    !isChildCell(unit) &&
                    !unit.merged
                ) {
                    visibleCellCount++;
                }
            }

            // Add offset for pagination (cells from previous milestones/subsections)
            const offset = calculateLineNumberOffset();
            return visibleCellCount + offset;
        },
        [getCellIdentifier, isChildCell, calculateLineNumberOffset]
    );

    const generateCellLabel = useCallback(
        (cell: QuillCellContent, currentCellsArray: QuillCellContent[]): string => {
            // If cell already has a label, use it
            if (cell.merged) {
                return "❌";
            }
            if (cell.deleted) {
                return "❌";
            }

            // Don't use index as fallback for paratext cells
            if (cell.cellType === CodexCellTypes.PARATEXT) {
                return "";
            }

            // Don't show line number for milestone cells
            if (cell.cellType === CodexCellTypes.MILESTONE) {
                return "";
            }

            // Check if this is a child cell
            if (isChildCell(cell)) {
                // Get the parent cell ID
                const parentId = cell.data?.parentId;
                const cellIdentifier = getCellIdentifier(cell);

                let parentCellId: string | undefined;

                // Try to get parent ID from metadata first (new UUID format)
                if (parentId) {
                    parentCellId = parentId;
                } else {
                    // Legacy: extract parent ID from cell identifier format
                    const cellIdParts = cellIdentifier.split(":");
                    if (cellIdParts.length > 2) {
                        parentCellId = cellIdParts.slice(0, 2).join(":");
                    }
                }

                if (parentCellId) {
                    // Find the parent cell in the full document using globalReferences or cellMarkers
                    const parentCell = fullDocumentTranslationUnits.find(
                        (unit: QuillCellContent) => {
                            const unitId = getCellIdentifier(unit);
                            return unitId === parentCellId || unit.cellMarkers[0] === parentCellId;
                        }
                    );

                    if (parentCell) {
                        // Get parent's label using chapter-based verse numbers
                        const parentLabel =
                            parentCell.cellLabel ||
                            (parentCell.cellType !== CodexCellTypes.PARATEXT
                                ? getChapterBasedVerseNumber(
                                      parentCell,
                                      fullDocumentTranslationUnits
                                  )
                                : "");

                        // Find all siblings (cells with the same parent)
                        const siblings = fullDocumentTranslationUnits.filter(
                            (unit: QuillCellContent) => {
                                const unitParentId = unit.data?.parentId;
                                if (unitParentId) {
                                    return unitParentId === parentCellId;
                                }
                                // Legacy: check ID format
                                const unitId = getCellIdentifier(unit);
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
                                (sibling: QuillCellContent) =>
                                    getCellIdentifier(sibling) === cellIdentifier
                            ) + 1;

                        // Return label in format "parentLabel.childIndex"
                        return `${parentLabel}.${childIndex}`;
                    }
                }
            }

            // Get chapter-based verse number (skipping paratext cells)
            return getChapterBasedVerseNumber(cell, fullDocumentTranslationUnits).toString();
        },
        [fullDocumentTranslationUnits, getChapterBasedVerseNumber, getCellIdentifier, isChildCell]
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

            if (cellToOpen) {
                debug("openCellById", { cellToOpen, text: cellToOpen.cellContent });
                setContentBeingUpdated({
                    cellMarkers: cellToOpen.cellMarkers,
                    cellContent: cellToOpen.cellContent,
                    cellChanged: true,
                    cellLabel: cellToOpen.cellLabel,
                    timestamps: cellToOpen.timestamps,
                    cellAudioTimestamps: cellToOpen.audioTimestamps,
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

    // expose to children via window
    (window as any).openCellById = openCellById;

    // Force-open variant used by toolbar icons (saves first if needed)
    const openCellByIdForce = useCallback(
        (cellId: string) => {
            const cellToOpen = workingTranslationUnits.find(
                (unit) => unit.cellMarkers[0] === cellId
            );
            if (!cellToOpen) return;

            // Save current edits if needed
            if (unsavedChanges) {
                try {
                    handleSaveHtml();
                } catch {
                    console.error("Error saving current edits before opening cell by id force");
                }
            }

            setContentBeingUpdated({
                cellMarkers: cellToOpen.cellMarkers,
                cellContent: cellToOpen.cellContent,
                cellChanged: true,
                cellLabel: cellToOpen.cellLabel,
                timestamps: cellToOpen.timestamps,
                cellAudioTimestamps: cellToOpen.audioTimestamps,
            } as EditorCellContent);

            vscode.postMessage({
                command: "setCurrentIdToGlobalState",
                content: {
                    currentLineId: cellToOpen.cellMarkers[0],
                },
            } as EditorPostMessages);
        },
        [workingTranslationUnits, setContentBeingUpdated, vscode, unsavedChanges, handleSaveHtml]
    );

    (window as any).openCellByIdForce = openCellByIdForce;

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
                                lineNumber={generatedCellLabel}
                                label={cell.cellLabel}
                                lineNumbersEnabled={lineNumbersEnabled}
                                key={`cell-${cellMarkers[0]}`}
                                vscode={vscode}
                                textDirection={textDirection}
                                isSourceText={isSourceText}
                                hasDuplicateId={hasDuplicateId}
                                alertColorCode={alertColorCodes[cellMarkers[0]]}
                                highlightedGlobalReferences={highlightedGlobalReferences}
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
                                playerRef={playerRef}
                                shouldShowVideoPlayer={shouldShowVideoPlayer}
                                videoUrl={videoUrl}
                                requiredAudioValidations={requiredAudioValidations}
                                isAuthenticated={isAuthenticated}
                                userAccessLevel={userAccessLevel}
                                isAudioOnly={isAudioOnly}
                                showInlineBacktranslations={showInlineBacktranslations}
                                backtranslation={backtranslationsMap.get(cellMarkers[0])}
                                isOtherTypeAudioPlaying={isOtherTypeAudioPlaying}
                            />
                        </span>
                    );
                })}
            </span>
        ),
        [
            cellDisplayMode,
            textDirection,
            showInlineBacktranslations,
            backtranslationsMap,
            vscode,
            isSourceText,
            duplicateCellIds,
            highlightedGlobalReferences,
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
            requiredAudioValidations,
            isAuthenticated,
            userAccessLevel,
            isAudioOnly,
            lineNumbersEnabled,
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
                            cellContent={sanitizeQuillHtml(cellContent)}
                            cellIndex={i}
                            cellType={cellType}
                            cellLabel={cellLabel ?? generatedCellLabel}
                            cellTimestamps={timestamps}
                            prevEndTime={workingTranslationUnits[i - 1]?.timestamps?.endTime}
                            nextStartTime={workingTranslationUnits[i + 1]?.timestamps?.startTime}
                            prevCellId={workingTranslationUnits[i - 1]?.cellMarkers[0]}
                            prevStartTime={workingTranslationUnits[i - 1]?.timestamps?.startTime}
                            nextCellId={workingTranslationUnits[i + 1]?.cellMarkers[0]}
                            nextEndTime={workingTranslationUnits[i + 1]?.timestamps?.endTime}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={setContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            textDirection={textDirection}
                            openCellById={openCellById}
                            isSaving={isSaving}
                            saveError={saveError}
                            saveErrorMessage={saveErrorMessage}
                            saveRetryCount={saveRetryCount}
                            footnoteOffset={calculateFootnoteOffset(i) + 1}
                            audioAttachments={audioAttachments}
                            requiredValidations={requiredValidations}
                            requiredAudioValidations={requiredAudioValidations}
                            currentUsername={currentUsername || undefined}
                            vscode={vscode}
                            isSourceText={isSourceText}
                            isAuthenticated={isAuthenticated}
                            playerRef={playerRef}
                            videoUrl={videoUrl}
                            shouldShowVideoPlayer={shouldShowVideoPlayer}
                            metadata={metadata}
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

                    // Render using the same component as non-empty cells for perfect alignment
                    result.push(
                        <span
                            key={`${cellMarkers[0]}:${i}`}
                            style={{
                                display:
                                    cellDisplayMode === CELL_DISPLAY_MODES.INLINE
                                        ? "inline"
                                        : "block",
                                verticalAlign: "middle",
                                backgroundColor: "transparent",
                                opacity: workingTranslationUnits[i].merged ? 0.5 : 1,
                            }}
                        >
                            <CellContentDisplay
                                cell={workingTranslationUnits[i]}
                                lineNumber={generatedCellLabel}
                                label={cellLabel}
                                lineNumbersEnabled={lineNumbersEnabled}
                                key={`cell-${cellMarkers[0]}:empty`}
                                vscode={vscode}
                                textDirection={textDirection}
                                isSourceText={isSourceText}
                                hasDuplicateId={false}
                                alertColorCode={alertColorCodes[cellMarkers[0]]}
                                highlightedGlobalReferences={highlightedGlobalReferences}
                                highlightedCellId={highlightedCellId}
                                scrollSyncEnabled={scrollSyncEnabled}
                                isInTranslationProcess={isCellInTranslationProcess(cellMarkers[0])}
                                translationState={getCellTranslationState(cellMarkers[0])}
                                allTranslationsComplete={successfulCompletions.size > 0}
                                handleCellTranslation={handleCellTranslation}
                                handleCellClick={openCellById}
                                cellDisplayMode={cellDisplayMode}
                                audioAttachments={audioAttachments as any}
                                footnoteOffset={calculateFootnoteOffset(i)}
                                isCorrectionEditorMode={isCorrectionEditorMode}
                                translationUnits={workingTranslationUnits}
                                unresolvedCommentsCount={cellCommentsCount.get(cellMarkers[0]) || 0}
                                currentUsername={currentUsername || undefined}
                                requiredValidations={requiredValidations}
                                requiredAudioValidations={requiredAudioValidations}
                                isAuthenticated={isAuthenticated}
                                userAccessLevel={userAccessLevel}
                                isAudioOnly={isAudioOnly}
                                showInlineBacktranslations={showInlineBacktranslations}
                                backtranslation={backtranslationsMap.get(cellMarkers[0])}
                                playerRef={playerRef}
                                shouldShowVideoPlayer={shouldShowVideoPlayer}
                                videoUrl={videoUrl}
                                isOtherTypeAudioPlaying={isOtherTypeAudioPlaying}
                            />
                        </span>
                    );
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
        isSourceText,
        isCorrectionEditorMode,
        contentBeingUpdated,
        generateCellLabel,
        spellCheckResponse,
        setContentBeingUpdated,
        handleCloseEditor,
        handleSaveHtml,
        textDirection,
        openCellById,
        isSaving,
        saveError,
        saveRetryCount,
        calculateFootnoteOffset,
        renderCellGroup,
        cellDisplayMode,
        lineNumbersEnabled,
        vscode,
        alertColorCodes,
        highlightedGlobalReferences,
        scrollSyncEnabled,
        isCellInTranslationProcess,
        getCellTranslationState,
        successfulCompletions.size,
        handleCellTranslation,
        audioAttachments,
        cellCommentsCount,
        currentUsername,
        requiredValidations,
        requiredAudioValidations,
        isAudioOnly,
        isAuthenticated,
    ]);

    // Fetch comments count for all visible cells (batched)
    useEffect(() => {
        const fetchCommentsForAllCells = () => {
            // Get all cell IDs we don't have comments for yet
            const missingCellIds = workingTranslationUnits
                .map((unit) => unit.cellMarkers[0])
                .filter((cellId) => !cellCommentsCount.has(cellId));

            if (missingCellIds.length > 0) {
                const messageContent: EditorPostMessages = {
                    command: "getCommentsForCells",
                    content: {
                        cellIds: missingCellIds,
                    },
                };
                vscode.postMessage(messageContent);
            }
        };

        if (workingTranslationUnits.length > 0) {
            fetchCommentsForAllCells();
        }
    }, [workingTranslationUnits, vscode, cellCommentsCount]);

    // Handle comments count responses (both single and batched)
    useMessageHandler(
        "cellList-commentsResponse",
        (event: MessageEvent) => {
            if (event.data.type === "commentsForCell") {
                const { cellId, unresolvedCount } = event.data.content;
                setCellCommentsCount((prev) => {
                    const newMap = new Map(prev);
                    newMap.set(cellId, unresolvedCount || 0);
                    return newMap;
                });
            } else if (event.data.type === "commentsForCells") {
                const commentsMap = event.data.content;
                setCellCommentsCount((prev) => {
                    const newMap = new Map(prev);
                    Object.entries(commentsMap).forEach(([cellId, count]) => {
                        newMap.set(cellId, (count as number) || 0);
                    });
                    return newMap;
                });
            }
        },
        []
    );

    // Handle refresh comments request (batched)
    useMessageHandler(
        "cellList-refreshComments",
        (event: MessageEvent) => {
            if (event.data.type === "refreshCommentCounts") {
                debug("Refreshing comment counts due to comments file change");
                // Re-fetch comments count for all visible cells in one batch
                const allCellIds = workingTranslationUnits.map((unit) => unit.cellMarkers[0]);
                if (allCellIds.length > 0) {
                    const messageContent: EditorPostMessages = {
                        command: "getCommentsForCells",
                        content: {
                            cellIds: allCellIds,
                        },
                    };
                    vscode.postMessage(messageContent);
                    // Clear existing counts to force refresh
                    setCellCommentsCount(new Map());
                }
            }
        },
        [workingTranslationUnits, vscode]
    );

    // Debug log to see the structure of translationUnits
    useEffect(() => {
        if (DEBUG_ENABLED && workingTranslationUnits.length > 0) {
            debug("Translation unit structure:", workingTranslationUnits[0]);
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
                // Keep minimal breathing room above the first cell to match prior layout
                paddingTop: "0.25rem",
                paddingBottom: "4rem",
            }}
        >
            {renderCells()}
        </div>
    );
};

export default React.memo<CellListProps>(CellList);
