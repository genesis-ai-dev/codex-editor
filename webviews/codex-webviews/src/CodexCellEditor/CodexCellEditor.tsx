import React, { useState, useEffect, useRef, useMemo, useContext, useCallback } from "react";
import ReactPlayer from "react-player";
import Quill from "quill";
import {
    QuillCellContent,
    EditorPostMessages,
    EditorCellContent,
    SpellCheckResponse,
    CustomNotebookMetadata,
    EditorReceiveMessages,
    CellIdGlobalState,
} from "../../../../types";
import { ChapterNavigationHeader } from "./ChapterNavigationHeader";
import CellList from "./CellList";
import { useVSCodeMessageHandler } from "./hooks/useVSCodeMessageHandler";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import VideoPlayer from "./VideoPlayer";
import registerQuillSpellChecker from "./react-quill-spellcheck";
import { getCleanedHtml } from "./react-quill-spellcheck/SuggestionBoxes";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import SourceCellContext from "./contextProviders/SourceCellContext";
import DuplicateCellResolver from "./DuplicateCellResolver";
import TimelineEditor from "./TimelineEditor";
import VideoTimelineEditor from "./VideoTimelineEditor";

import { getCellValueData } from "@sharedUtils";
import { isValidValidationEntry } from "./ValidationButton";
import "./TranslationAnimations.css";
import { CellTranslationState } from "./CellTranslationStyles";
import { getVSCodeAPI } from "../shared/vscodeApi";
import { Subsection } from "../lib/types";

// eslint-disable-next-line react-refresh/only-export-components
export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
    ONE_LINE_PER_CELL = "one-line-per-cell",
}

const DEBUG_ENABLED = false;

// Enhanced debug function with categories
function debug(category: string, message: string | object, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        const timestamp = new Date().toISOString().split("T")[1].slice(0, -1); // Get time part only
        const prefix = `[${timestamp}][CodexCellEditor:${category}]`;
        if (typeof message === "string") {
            if (args.length > 0) {
                console.log(`${prefix} ${message}`, ...args);
            } else {
                console.log(`${prefix} ${message}`);
            }
        } else {
            console.log(`${prefix}`, message, ...args);
        }
    }
}

// Define the structure for BibleBookInfo if it's not already globally available
interface BibleBookInfo {
    name: string;
    abbr: string;
    // Add other properties as needed based on your bible-books-lookup.json
    [key: string]: any;
}

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<QuillCellContent[]>([]);
    const [alertColorCodes, setAlertColorCodes] = useState<{
        [cellId: string]: number;
    }>({});
    const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);
    const [isWebviewReady, setIsWebviewReady] = useState(false);
    const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true);

    // Translation queue state for single cell translations
    const [translationQueue, setTranslationQueue] = useState<string[]>([]);
    // Flag to track if a cell is currently being translated
    const [isProcessingCell, setIsProcessingCell] = useState<boolean>(false);
    // Currently processing cell ID
    const [singleCellQueueProcessingId, setSingleCellQueueProcessingId] = useState<
        string | undefined
    >(undefined);

    // Keep track of cell content for detecting changes
    const cellContentMapRef = useRef<Map<string, string>>(new Map());

    // Basic state variables
    const [chapterNumber, setChapterNumber] = useState<number>(
        (window as any).initialData?.cachedChapter || 1
    );
    const [textDirection, setTextDirection] = useState<"ltr" | "rtl">(
        (window as any).initialData?.metadata?.textDirection || "ltr"
    );
    const [cellDisplayMode, setCellDisplayMode] = useState<CELL_DISPLAY_MODES>(
        (window as any).initialData?.metadata?.cellDisplayMode ||
            CELL_DISPLAY_MODES.ONE_LINE_PER_CELL
    );
    const [isSourceText, setIsSourceText] = useState<boolean>(false);
    const [isMetadataModalOpen, setIsMetadataModalOpen] = useState<boolean>(false);

    // Track if user has manually navigated away from the highlighted chapter in source files
    const [hasManuallyNavigatedAway, setHasManuallyNavigatedAway] = useState<boolean>(false);
    const [lastHighlightedChapter, setLastHighlightedChapter] = useState<number | null>(null);
    const [chapterWhenHighlighted, setChapterWhenHighlighted] = useState<number | null>(null);

    const [metadata, setMetadata] = useState<CustomNotebookMetadata>({
        videoUrl: "", // FIXME: use attachments instead of videoUrl
    } as CustomNotebookMetadata);
    const [videoUrl, setVideoUrl] = useState<string>("");
    const playerRef = useRef<ReactPlayer>(null);
    const [shouldShowVideoPlayer, setShouldShowVideoPlayer] = useState<boolean>(false);
    const { setSourceCellMap } = useContext(SourceCellContext);

    // Simplified state - now we just mirror the provider's state
    const [autocompletionState, setAutocompletionState] = useState<{
        isProcessing: boolean;
        totalCells: number;
        completedCells: number;
        currentCellId?: string;
        cellsToProcess: string[];
        progress: number;
    }>({
        isProcessing: false,
        totalCells: 0,
        completedCells: 0,
        currentCellId: undefined,
        cellsToProcess: [],
        progress: 0,
    });

    const [singleCellTranslationState, setSingleCellTranslationState] = useState<{
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    }>({
        isProcessing: false,
        cellId: undefined,
        progress: 0,
    });

    // Instead of separate state variables, use computed properties
    // These provide backward compatibility for any code that might use these variables
    const isAutocompletingChapter = autocompletionState.isProcessing;
    const totalCellsToAutoComplete = autocompletionState.totalCells;
    const cellsAutoCompleted = autocompletionState.completedCells;
    const autocompletionProgress = autocompletionState.progress;
    const currentProcessingCellId = autocompletionState.currentCellId;

    const isSingleCellTranslating = singleCellTranslationState.isProcessing;
    const singleCellId = singleCellTranslationState.cellId;
    const singleCellProgress = singleCellTranslationState.progress;

    // Required state variables that were removed
    const [spellCheckResponse, setSpellCheckResponse] = useState<SpellCheckResponse | null>(null);
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorCellContent>(
        {} as EditorCellContent
    );
    const [currentEditingCellId, setCurrentEditingCellId] = useState<string | null>(null);

    // Add a state for pending validations count
    const [pendingValidationsCount, setPendingValidationsCount] = useState(0);

    // Add a state for tracking validation application in progress
    const [isApplyingValidations, setIsApplyingValidations] = useState(false);

    // Add a state for bible book map
    const [bibleBookMap, setBibleBookMap] = useState<Map<string, BibleBookInfo> | undefined>(
        undefined
    );

    // Add these new state variables
    const [primarySidebarVisible, setPrimarySidebarVisible] = useState(true);
    const [fileStatus, setFileStatus] = useState<"dirty" | "syncing" | "synced" | "none">("none");
    const [editorPosition, setEditorPosition] = useState<
        "leftmost" | "rightmost" | "center" | "single" | "unknown"
    >("unknown");
    const [currentSubsectionIndex, setCurrentSubsectionIndex] = useState(0);

    // Add audio attachments state
    const [audioAttachments, setAudioAttachments] = useState<{ [cellId: string]: boolean }>({});

    // Add cells per page configuration
    const [cellsPerPage] = useState<number>((window as any).initialData?.cellsPerPage || 50);

    // Acquire VS Code API once at component initialization
    const vscode = useMemo(() => getVSCodeAPI(), []);

    // Initialize state store after webview is ready
    useEffect(() => {
        const handleWebviewReady = (event: MessageEvent) => {
            if (event.data.type === "webviewReady") {
                debug("init", "Webview is ready");
                setIsWebviewReady(true);
            }
        };
        window.addEventListener("message", handleWebviewReady);
        return () => window.removeEventListener("message", handleWebviewReady);
    }, []);

    // Listen for highlight messages from the extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "highlightCell") {
                // Set the highlighted cell ID (null clears the highlight)
                setHighlightedCellId(message.cellId);
                
                // Reset manual navigation tracking when highlight is cleared
                if (!message.cellId) {
                    setHasManuallyNavigatedAway(false);
                    setLastHighlightedChapter(null);
                    setChapterWhenHighlighted(null);
                }
            }

            // Add handler for pending validations updates
            if (message.type === "pendingValidationsUpdate") {
                setPendingValidationsCount(
                    message.type === "pendingValidationsUpdate" ? message.content.count : 0
                );

                // If validation count is zero, reset the applying state
                if (message.content.count === 0) {
                    setIsApplyingValidations(false);
                }
            }

            // Also listen for validation completion message
            if (message.type === "validationsApplied") {
                setIsApplyingValidations(false);
            }

            // Handle file status updates
            if (message.type === "updateFileStatus") {
                setFileStatus(message.status);
            }

            // Handle cells per page update
            if (message.type === "updateCellsPerPage") {
                // Force re-render by updating subsection when cells per page changes
                setCurrentSubsectionIndex(0);
                // You could also update cellsPerPage state here if needed
                // setCellsPerPage(message.cellsPerPage);
            }
        };
        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []);

    useEffect(() => {
        if (highlightedCellId && scrollSyncEnabled && isSourceText) {
            const cellId = highlightedCellId;
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            const newChapterNumber = parseInt(chapter) || 1;

            // Check if this is a new highlight (different chapter than last highlighted)
            const isNewHighlight = newChapterNumber !== lastHighlightedChapter;
            
            if (isNewHighlight) {
                // Reset the manual navigation flag for new highlights
                setHasManuallyNavigatedAway(false);
                setLastHighlightedChapter(newChapterNumber);
                setChapterWhenHighlighted(chapterNumber); // Remember current chapter when highlight was set
            }

            // Only auto-navigate if:
            // 1. User hasn't manually navigated away, OR this is a new highlight
            // 2. We're still on the same chapter as when the highlight was originally set (prevents conflicts)
            const shouldAutoNavigate = (!hasManuallyNavigatedAway || isNewHighlight) && 
                                     (isNewHighlight || chapterNumber === chapterWhenHighlighted);

            if (shouldAutoNavigate) {
            // Get all cells for the target chapter
            const allCellsForTargetChapter = translationUnits.filter((verse) => {
                const verseChapter = verse?.cellMarkers?.[0]?.split(" ")?.[1]?.split(":")[0];
                return verseChapter === newChapterNumber.toString();
            });

            // Find the index of the highlighted cell within the chapter
            const cellIndexInChapter = allCellsForTargetChapter.findIndex(
                (verse) => verse.cellMarkers[0] === cellId
            );

            // Calculate which subsection this cell belongs to
            let targetSubsectionIndex = 0;
            if (cellIndexInChapter >= 0 && cellsPerPage > 0) {
                targetSubsectionIndex = Math.floor(cellIndexInChapter / cellsPerPage);
            }

            // If chapter is changing, update chapter and subsection
            if (newChapterNumber !== chapterNumber) {
                setChapterNumber(newChapterNumber);
                setCurrentSubsectionIndex(targetSubsectionIndex);
            } else {
                // Same chapter, but check if we need to change subsection
                // Check if chapter has multiple pages (subsections)
                if (
                    allCellsForTargetChapter.length > cellsPerPage &&
                    targetSubsectionIndex !== currentSubsectionIndex
                ) {
                    setCurrentSubsectionIndex(targetSubsectionIndex);
                    }
                }
            }
        }
    }, [
        highlightedCellId,
        scrollSyncEnabled,
        chapterNumber,
        translationUnits,
        cellsPerPage,
        currentSubsectionIndex,
        isSourceText,
        hasManuallyNavigatedAway,
        lastHighlightedChapter,
        chapterWhenHighlighted,
    ]);

    // Track manual navigation away from highlighted chapter in source files
    useEffect(() => {
        if (isSourceText && highlightedCellId && lastHighlightedChapter !== null) {
            // If current chapter is different from the highlighted chapter, user navigated manually
            if (chapterNumber !== lastHighlightedChapter) {
                setHasManuallyNavigatedAway(true);
            }
        }
    }, [chapterNumber, isSourceText, highlightedCellId, lastHighlightedChapter]);

    // A "temp" video URL that is used to update the video URL in the metadata modal.
    // We need to use the client-side file picker, so we need to then pass the picked
    // video URL back to the extension so the user can save or cancel the change.
    const [tempVideoUrl, setTempVideoUrl] = useState<string>("");

    // Debug timestamp to track when a cell started processing
    const processingStartTimeRef = useRef<number | null>(null);

    const handleSetContentBeingUpdated = (content: EditorCellContent) => {
        debug("content", "Setting content being updated:", { cellId: content.cellMarkers?.[0] });
        setContentBeingUpdated(content);
        setCurrentEditingCellId(content.cellMarkers?.[0] || null);
    };

    // Add the removeHtmlTags function
    const removeHtmlTags = (text: string) => {
        const temp = document.createElement("div");
        temp.innerHTML = text;
        return temp.textContent || temp.innerText || "";
    };

    // Function to check alert codes
    const checkAlertCodes = () => {
        const cellContentAndId = translationUnits.map((unit) => ({
            text: removeHtmlTags(unit.cellContent),
            cellId: unit.cellMarkers[0],
        }));

        debug("alerts", "Checking alert codes for cells:", { count: cellContentAndId.length });
        vscode.postMessage({
            command: "getAlertCodes",
            content: cellContentAndId,
        } as EditorPostMessages);
    };

    useEffect(() => {
        checkAlertCodes();
    }, [translationUnits]);

    useVSCodeMessageHandler({
        setContent: (
            content: QuillCellContent[],
            isSourceText: boolean,
            sourceCellMap: { [k: string]: { content: string; versions: string[] } }
        ) => {
            setTranslationUnits(content);
            setIsSourceText(isSourceText);
            setSourceCellMap(sourceCellMap);
        },
        setSpellCheckResponse: setSpellCheckResponse,
        jumpToCell: (cellId) => {
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            const newChapterNumber = parseInt(chapter) || 1;

            // Reset subsection index when jumping to a cell
            if (newChapterNumber !== chapterNumber) {
                setCurrentSubsectionIndex(0);
            }

            setChapterNumber(newChapterNumber);
        },
        updateCell: (data) => {
            if (
                data.cellId !== "initialization" &&
                data.cellId !== "completion" &&
                data.newContent
            ) {
                debug(
                    "queue",
                    `Cell update received for: ${data.cellId}, current processing: ${singleCellQueueProcessingId}`
                );

                // Update the translation units first
                setTranslationUnits((prevUnits) =>
                    prevUnits.map((unit) =>
                        unit.cellMarkers[0] === data.cellId
                            ? {
                                  ...unit,
                                  cellContent: data.newContent,
                                  cellLabel: unit.cellLabel,
                              }
                            : unit
                    )
                );

                // Check if this is the cell we're currently processing
                if (data.cellId === singleCellQueueProcessingId) {
                    debug(
                        "queue",
                        `Cell translation completed: ${data.cellId}. Resetting processing state.`
                    );

                    // Reset processing state to allow the next cell to be processed
                    // Important: call both state updates in sequence to ensure they happen in the same render cycle
                    setSingleCellQueueProcessingId(undefined);
                    setIsProcessingCell(false);
                }
            }
        },

        // Add this for compatibility
        autocompleteChapterComplete: () => {
            debug("autocomplete", "Autocomplete chapter complete (legacy handler)");
        },

        // New handlers for provider-centric state management
        updateAutocompletionState: (state) => {
            debug("autocomplete", "Received autocompletion state from provider:", state);
            setAutocompletionState(state);
        },

        updateSingleCellTranslationState: (state) => {
            debug("autocomplete", "Received single cell translation state from provider:", state);
            setSingleCellTranslationState(state);
        },

        updateTextDirection: (direction) => {
            setTextDirection(direction);
        },
        updateNotebookMetadata: (newMetadata) => {
            setMetadata(newMetadata);
        },
        updateVideoUrl: (url: string) => {
            setTempVideoUrl(url);
        },
        setAlertColorCodes: setAlertColorCodes,
        recheckAlertCodes: () => {
            checkAlertCodes();
        },
        // Use cellError handler instead of showErrorMessage
        cellError: (data) => {
            debug(
                "queue",
                `Error with cell: ${data.cellId}, index: ${data.index}, total: ${data.totalCells}`
            );

            // If we're currently processing a cell that matches, assume it failed
            if (isProcessingCell && singleCellQueueProcessingId === data.cellId) {
                debug(
                    "queue",
                    `Handling error for currently processing cell: ${singleCellQueueProcessingId}`
                );
                handleTranslationError(singleCellQueueProcessingId);
            }
        },
        // Add the setChapterNumber handler
        setChapterNumber: (chapter) => {
            // Reset subsection index when chapter changes externally
            if (chapter !== chapterNumber) {
                setCurrentSubsectionIndex(0);
            }
            setChapterNumber(chapter);
        },
        setAudioAttachments: setAudioAttachments,
    });

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
        setIsSourceText((window as any).initialData?.isSourceText || false);
        setVideoUrl((window as any).initialData?.videoUrl || "");
        setMetadata((window as any).initialData?.metadata || {});

        // Add focus event listener
        window.addEventListener("focus", () => {
            // Ensure we have a valid URI before sending
            const uri = (window as any).initialData?.uri;
            if (uri) {
                vscode.postMessage({
                    command: "webviewFocused",
                    content: {
                        uri: uri,
                    },
                } as EditorPostMessages);
            }
        });
        return () => window.removeEventListener("focus", () => {});
    }, []);

    useEffect(() => {
        // Initialize Quill and register SpellChecker and SmartEdits only once
        registerQuillSpellChecker(Quill as any, vscode);
    }, []);

    const calculateTotalChapters = (units: QuillCellContent[]): number => {
        const sectionSet = new Set<string>();
        units.forEach((unit) => {
            const sectionNumber = unit.cellMarkers[0]?.split(" ")?.[1]?.split(":")?.[0];
            if (sectionNumber) {
                sectionSet.add(sectionNumber);
            }
        });
        return sectionSet.size;
    };

    // Add function to get subsections for a chapter
    const getSubsectionsForChapter = (chapterNum: number) => {
        // Filter cells for the specific chapter
        const cellsForChapter = translationUnits.filter((verse) => {
            const cellId = verse?.cellMarkers?.[0];
            const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
            const sectionCellNumber = sectionCellIdParts?.[0];
            return sectionCellNumber === chapterNum.toString();
        });

        // If no cells or cells fit in one page, no subsections needed
        if (cellsForChapter.length === 0 || cellsForChapter.length <= cellsPerPage) {
            return [];
        }

        // Calculate number of pages
        const totalPages = Math.ceil(cellsForChapter.length / cellsPerPage);
        const subsections: Subsection[] = [];

        for (let i = 0; i < totalPages; i++) {
            const startIndex = i * cellsPerPage + 1;
            const endIndex = Math.min((i + 1) * cellsPerPage, cellsForChapter.length);

            subsections.push({
                id: `page-${i}`,
                label: `${startIndex}-${endIndex}`,
                startIndex: i * cellsPerPage,
                endIndex: Math.min((i + 1) * cellsPerPage, cellsForChapter.length),
            });
        }

        return subsections;
    };

    const totalChapters = calculateTotalChapters(translationUnits);

    // Get all cells for the current chapter first
    const allCellsForChapter = translationUnits.filter((verse) => {
        const cellId = verse?.cellMarkers?.[0];
        const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
        const sectionCellNumber = sectionCellIdParts?.[0];
        return sectionCellNumber === chapterNumber.toString();
    });

    // Get the subsections for the current chapter
    const subsections = getSubsectionsForChapter(chapterNumber);

    // Apply pagination if there are subsections
    const translationUnitsForSection = useMemo(() => {
        if (subsections.length === 0) {
            // No pagination needed, return all cells for the chapter
            return allCellsForChapter;
        } else {
            // Apply pagination based on current subsection index
            const currentSubsection = subsections[currentSubsectionIndex];
            if (!currentSubsection) {
                // If somehow we have an invalid subsection index, default to first page
                return allCellsForChapter.slice(0, cellsPerPage);
            }
            return allCellsForChapter.slice(
                currentSubsection.startIndex,
                currentSubsection.endIndex
            );
        }
    }, [allCellsForChapter, subsections, currentSubsectionIndex, cellsPerPage]);

    const { setUnsavedChanges } = useContext(UnsavedChangesContext);

    const handleCloseEditor = () => {
        debug("editor", "Closing editor");
        setContentBeingUpdated({} as EditorCellContent);
        setUnsavedChanges(false);

        // Clear the global state to stop highlighting in source files
        vscode.postMessage({
            command: "setCurrentIdToGlobalState",
            content: {
                currentLineId: "", // Clear the cell ID
            },
        } as EditorPostMessages);

        // Request updated audio attachments when closing editor
        vscode.postMessage({
            command: "requestAudioAttachments",
        } as EditorPostMessages);
    };

    const handleSaveHtml = () => {
        const content = contentBeingUpdated;
        debug("editor", "Saving HTML content:", { cellId: content.cellMarkers?.[0], content });
        vscode.postMessage({
            command: "saveHtml",
            content: content,
        } as EditorPostMessages);
        checkAlertCodes();

        // Trigger reindexing after saving content
        // vscode.postMessage({
        //     command: "triggerReindexing",
        // } as EditorPostMessages);

        handleCloseEditor();
    };

    // State for current user - initialize with a default test username to ensure logic works
    const [username, setUsername] = useState<string | null>("test-user");

    // Fetch username from extension and add extensive debugging
    useEffect(() => {
        debug("auth", "Setting up username listener and requesting username");

        const handleMessage = (event: MessageEvent) => {
            try {
                debug("auth", "Message received:", event.data);
                const message = event.data;

                if (message.type === "setUsername" || message.command === "setUsername") {
                    const newUsername = message.username || message.value;
                    debug("auth", "Username set to:", newUsername);
                    setUsername(newUsername || "anonymous");
                } else if (message.type === "currentUsername") {
                    debug("auth", "Current username received:", message.content?.username);
                    setUsername(message.content?.username || "anonymous");
                } else if (message.type === "error" && message.errorType === "authentication") {
                    // Handle authentication errors by setting a default username
                    debug("auth", "Authentication error, using default username");
                    setUsername("anonymous");
                }
            } catch (error) {
                // Prevent any errors in message handling from breaking the component
                debug("auth", "Error handling message:", error);
            }
        };

        window.addEventListener("message", handleMessage);

        // Send requests with error handling
        try {
            vscode.postMessage({
                command: "getCurrentUsername",
            });

            debug("auth", "Requested username from extension");
        } catch (error) {
            debug("auth", "Error requesting username:", error);
            // Set default username if we can't even send the request
            setUsername("anonymous");
        }

        return () => window.removeEventListener("message", handleMessage);
    }, [vscode]); // Only run this once with vscode reference as the dependency

    // Debug effect to show when username changes
    useEffect(() => {
        if (DEBUG_ENABLED) {
            debug("auth", "Username changed:", { username });
            if (username) {
                debug("auth", "Recalculating counts due to username change");
            }
        }
    }, [username]);

    // Cells with no content (untranslated cells)
    const untranslatedCellsForSection = useMemo(() => {
        debug("autocomplete", "Calculating cells with no content...");

        const result = translationUnitsForSection.filter((unit) => {
            // Check if the cell is empty
            const hasNoContent = !unit.cellContent.trim();
            return hasNoContent;
        });

        debug("autocomplete", "Cells with no content:", result.length);
        return result;
    }, [translationUnitsForSection]);

    // Cells with no content or where the latest edit has no validators
    const untranslatedOrUnvalidatedUnitsForSection = useMemo(() => {
        debug(
            "autocomplete",
            "Calculating cells needing autocomplete (no content or no validators)..."
        );

        const result = translationUnitsForSection.filter((unit) => {
            // Check if the cell is empty
            const hasNoContent = !unit.cellContent.trim();

            // Get the latest edit
            const latestEdit =
                unit.editHistory && unit.editHistory.length > 0
                    ? unit.editHistory[unit.editHistory.length - 1]
                    : null;

            // Check if the latest edit has no active (non-deleted) validators
            const hasNoValidators =
                !latestEdit ||
                !latestEdit.validatedBy ||
                latestEdit.validatedBy.filter((v) => v && typeof v === "object" && !v.isDeleted)
                    .length === 0;

            return hasNoContent || hasNoValidators;
        });

        debug("autocomplete", "Cells with no content or no validators:", result.length);
        return result;
    }, [translationUnitsForSection]);

    // Cells with no content, no validators, or not validated by current user (but not fully validated)
    const untranslatedOrNotValidatedByCurrentUserUnitsForSection = useMemo(() => {
        const currentUsername = username || "anonymous";
        const VALIDATION_THRESHOLD = 2;

        const result = translationUnitsForSection.filter((unit, index) => {
            // Check if the cell is empty
            const hasNoContent = !unit.cellContent.trim();

            // Get the latest edit
            const latestEdit =
                unit.editHistory && unit.editHistory.length > 0
                    ? unit.editHistory[unit.editHistory.length - 1]
                    : null;

            // Check if the latest edit has no active (non-deleted) validators
            const activeValidators =
                latestEdit?.validatedBy?.filter(
                    (v) => v && typeof v === "object" && !v.isDeleted
                ) || [];
            const hasNoValidators = activeValidators.length === 0;

            // Check if cell is fully validated (exclude from this category)
            const isFullyValidated = activeValidators.length >= VALIDATION_THRESHOLD;

            // Check if the cell is not validated by the current user
            let notValidatedByCurrentUser = false;

            // Only check for user validation if we have a valid username and the cell has content
            if (latestEdit && currentUsername && !hasNoContent) {
                if (activeValidators.length === 0) {
                    // If there are no validators at all, current user hasn't validated it
                    notValidatedByCurrentUser = true;
                } else {
                    // If there are validators, check if current user is among them
                    const currentUserValidation = activeValidators.find(
                        (v) => v.username === currentUsername
                    );
                    notValidatedByCurrentUser = !currentUserValidation;
                }
            }

            // Include cell if it's empty, has no validators, or not validated by current user
            // BUT exclude fully validated cells (they go in their own category)
            const shouldInclude =
                (hasNoContent || hasNoValidators || notValidatedByCurrentUser) && !isFullyValidated;

            return shouldInclude;
        });

        return result;
    }, [translationUnitsForSection, username]);

    // Cells that are fully validated but not by the current user
    const fullyValidatedUnitsForSection = useMemo(() => {
        const VALIDATION_THRESHOLD = 2; // Require 2 checkmarks for full validation
        const currentUsername = username || "anonymous";

        const result = translationUnitsForSection.filter((unit, index) => {
            // Skip empty cells
            if (!unit.cellContent.trim()) {
                return false;
            }

            // Get the latest edit
            const latestEdit =
                unit.editHistory && unit.editHistory.length > 0
                    ? unit.editHistory[unit.editHistory.length - 1]
                    : null;

            if (!latestEdit) {
                return false;
            }

            // Count only active (non-deleted) validators
            const activeValidators =
                latestEdit.validatedBy?.filter((v) => v && typeof v === "object" && !v.isDeleted) ||
                [];

            // Check if cell has reached the validation threshold (is fully validated)
            const isFullyValidated = activeValidators.length >= VALIDATION_THRESHOLD;

            // Check if current user is among the validators
            const currentUserHasValidated = activeValidators.some(
                (v) => v.username === currentUsername
            );

            // Include cell if:
            // 1. It is fully validated (reached threshold) AND
            // 2. Current user has NOT validated it
            const shouldInclude = isFullyValidated && !currentUserHasValidated;

            return shouldInclude;
        });

        debug(
            "autocomplete",
            "Fully validated cells not validated by current user:",
            result.length
        );
        return result;
    }, [translationUnitsForSection, username]);

    // Update handler for file/chapter changes to recalculate cells needing autocomplete
    useEffect(() => {
        try {
            debug(
                "autocomplete",
                "Active document or section changed, recalculating autocomplete cells..."
            );
        } catch (error) {
            debug("autocomplete", "Error while handling document/section change", error);
        }
    }, [chapterNumber, translationUnits, translationUnitsForSection, username]);

    const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleAutocompleteChapter = (
        numberOfCells: number,
        includeEmptyCells: boolean,
        includeNotValidatedByAnyUser: boolean,
        includeNotValidatedByCurrentUser: boolean,
        includeFullyValidatedByOthers: boolean = false
    ) => {
        // Build the cell list based on selected options
        const cellsToAutocomplete: QuillCellContent[] = [];
        const cellIdsSeen = new Set<string>();

        // Helper function to add cells without duplicates
        const addCells = (cells: QuillCellContent[]) => {
            const newCells = cells.filter((cell) => {
                const cellId = cell.cellMarkers[0];
                if (cellIdsSeen.has(cellId)) {
                    return false;
                }
                cellIdsSeen.add(cellId);
                return true;
            });
            cellsToAutocomplete.push(...newCells);
        };

        // Add cells based on individual selections
        // We need to create specific filtered sets for each option to avoid overlaps

        if (includeEmptyCells) {
            // Add only empty cells
            addCells(untranslatedCellsForSection);
        }

        if (includeNotValidatedByAnyUser) {
            // Add cells with content but no validators (excluding empty cells if already added)
            const cellsWithContentButNoValidators = untranslatedOrUnvalidatedUnitsForSection.filter(
                (unit) => {
                    // Only include if it has content (not empty)
                    return unit.cellContent.trim() !== "";
                }
            );
            addCells(cellsWithContentButNoValidators);
        }

        if (includeNotValidatedByCurrentUser) {
            // Add cells not validated by current user BUT exclude fully validated cells
            const currentUsername = username || "anonymous";
            const VALIDATION_THRESHOLD = 2;

            const cellsNotValidatedByCurrentUser = translationUnitsForSection.filter((unit) => {
                // Must have content
                if (!unit.cellContent.trim()) {
                    return false;
                }

                // Get the latest edit
                const latestEdit =
                    unit.editHistory && unit.editHistory.length > 0
                        ? unit.editHistory[unit.editHistory.length - 1]
                        : null;

                if (!latestEdit) {
                    return false;
                }

                // Get active validators
                const activeValidators =
                    latestEdit.validatedBy?.filter(
                        (v) => v && typeof v === "object" && !v.isDeleted
                    ) || [];

                // Skip cells that are fully validated (regardless of who validated them)
                if (activeValidators.length >= VALIDATION_THRESHOLD) {
                    return false;
                }

                // Must have some validators (otherwise it would be in "no validators" category)
                if (activeValidators.length === 0) {
                    return false;
                }

                // Current user must not be among the validators
                return !activeValidators.some((v) => v.username === currentUsername);
            });

            addCells(cellsNotValidatedByCurrentUser);
        }

        // Add fully validated cells if requested
        if (includeFullyValidatedByOthers) {
            addCells(fullyValidatedUnitsForSection);
        }

        // Limit to the requested number of cells
        const selectedCells = cellsToAutocomplete.slice(0, numberOfCells);

        if (selectedCells.length === 0) {
            vscode.postMessage({
                command: "showInformationMessage",
                message: "No cells found matching the selected criteria.",
            });
            return;
        }

        vscode.postMessage({
            command: "requestAutocompleteChapter",
            content: selectedCells,
        });
    };

    const handleStopAutocomplete = () => {
        debug("autocomplete", "Stopping autocomplete chapter");

        // Just send the stop command, provider will update state
        vscode.postMessage({
            command: "stopAutocompleteChapter",
        } as EditorPostMessages);
    };

    const openSourceText = (sectionIdNumber: number) => {
        vscode.postMessage({
            command: "openSourceText",
            content: {
                chapterNumber: sectionIdNumber,
            },
        } as EditorPostMessages);
    };

    const OFFSET_SECONDS = 0; // just for testing purposes

    useEffect(() => {
        // Jump to the start time of the cell being edited
        if (playerRef.current && contentBeingUpdated.cellMarkers?.length > 0) {
            const cellId = contentBeingUpdated.cellMarkers[0];
            const startTime = parseTimestampFromCellId(cellId);
            if (startTime !== null) {
                debug("video", `Seeking to ${startTime} + ${OFFSET_SECONDS} seconds`);
                playerRef.current.seekTo(startTime + OFFSET_SECONDS, "seconds");
            }
        }
    }, [contentBeingUpdated, OFFSET_SECONDS]);

    // Helper function to parse timestamp from cellId
    const parseTimestampFromCellId = (cellId: string): number | null => {
        const match = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
        if (match && match[1]) {
            return parseFloat(match[1]);
        }
        return null;
    };

    // Dynamically set styles for .ql-editor
    const styleElement = document.createElement("style");
    styleElement.textContent = `
        .ql-editor {
            direction: ${textDirection} !important;
            text-align: ${textDirection === "rtl" ? "right" : "left"} !important;
        }
    `;
    document.head.appendChild(styleElement);

    const translationUnitsWithCurrentEditorContent = useMemo(() => {
        return translationUnitsForSection?.map((unit) => {
            if (unit.cellMarkers[0] === contentBeingUpdated.cellMarkers?.[0]) {
                return { ...unit, cellContent: contentBeingUpdated.cellContent };
            }
            return unit;
        });
    }, [contentBeingUpdated, translationUnitsForSection]);

    const handleMetadataChange = (key: string, value: string) => {
        setMetadata((prev) => {
            const updatedMetadata = { ...prev, [key]: value };
            debug("metadata", "Updated metadata:", updatedMetadata);
            return updatedMetadata;
        });
    };

    const handlePickFile = () => {
        vscode.postMessage({ command: "pickVideoFile" } as EditorPostMessages);
    };

    const handleSaveMetadata = () => {
        const updatedMetadata = { ...metadata };
        if (tempVideoUrl) {
            updatedMetadata.videoUrl = tempVideoUrl;
            setVideoUrl(tempVideoUrl);
            setTempVideoUrl("");
        }
        debug("metadata", "Saving metadata:", updatedMetadata);
        vscode.postMessage({
            command: "updateNotebookMetadata",
            content: updatedMetadata,
        } as EditorPostMessages);
        setIsMetadataModalOpen(false);
    };

    const handleUpdateVideoUrl = (url: string) => {
        setVideoUrl(url);
    };

    const [headerHeight, setHeaderHeight] = useState(0);
    const [windowHeight, setWindowHeight] = useState(window.innerHeight);
    const headerRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<HTMLDivElement>(null);
    const videoPlayerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleResize = () => {
            setWindowHeight(window.innerHeight);
            if (headerRef.current && navigationRef.current && videoPlayerRef.current) {
                const totalHeaderHeight =
                    headerRef.current.offsetHeight +
                    navigationRef.current.offsetHeight +
                    (shouldShowVideoPlayer ? videoPlayerRef.current.offsetHeight : 0);
                setHeaderHeight(totalHeaderHeight);
            }
        };

        window.addEventListener("resize", handleResize);
        handleResize(); // Initial calculation

        return () => window.removeEventListener("resize", handleResize);
    }, [shouldShowVideoPlayer]); // Add shouldShowVideoPlayer as a dependency

    useEffect(() => {
        vscode.postMessage({
            command: "updateCachedChapter",
            content: chapterNumber,
        } as EditorPostMessages);
    }, [chapterNumber]);

    const checkForDuplicateCells = (translationUnitsToCheck: QuillCellContent[]) => {
        const listOfCellIds = translationUnitsToCheck.map((unit) => unit.cellMarkers[0]);
        const uniqueCellIds = new Set(listOfCellIds);
        return uniqueCellIds.size !== listOfCellIds.length;
    };

    const getCurrentEditingCellId = () => currentEditingCellId;

    (window as any).getCurrentEditingCellId = getCurrentEditingCellId;

    const documentHasVideoAvailable = !!metadata.videoUrl;

    // Debug helper: Log info about translation units and their validation status
    useEffect(() => {
        if (translationUnitsForSection.length > 0) {
            debug("status", "Translation Units Status:", {
                total: translationUnitsForSection.length,
                unitsWithNoContent: translationUnitsForSection.filter(
                    (unit) => !unit.cellContent.trim()
                ).length,
                llmGeneratedUnits: translationUnitsForSection.filter((unit) => {
                    const cellValueData = getCellValueData(unit);
                    return cellValueData.editType === "llm-generation";
                }).length,
                unitsWithValidations: translationUnitsForSection.filter((unit) => {
                    const cellValueData = getCellValueData(unit);
                    return cellValueData.validatedBy && cellValueData.validatedBy.length > 0;
                }).length,
                currentUsername: username,
                unitsNeedingAutocomplete: untranslatedOrUnvalidatedUnitsForSection.length,
                unitsNeedingAutocompleteWithCurrentUser:
                    untranslatedOrNotValidatedByCurrentUserUnitsForSection.length,
            });
        }
    }, [
        translationUnitsForSection,
        username,
        untranslatedOrUnvalidatedUnitsForSection,
        untranslatedOrNotValidatedByCurrentUserUnitsForSection,
    ]);

    // Clean up when component unmounts
    useEffect(() => {
        return () => {
            // Cancel any in-progress autocompletion when component unmounts
            if (autocompletionState.isProcessing) {
                vscode.postMessage({
                    command: "stopAutocompleteChapter",
                } as EditorPostMessages);
            }
        };
    }, [autocompletionState.isProcessing]);

    // Handle cells in the queue sequentially
    useEffect(() => {
        if (translationQueue.length === 0) {
            // No items in queue
            return;
        }

        if (isProcessingCell) {
            // Already processing a cell
            debug(
                "queue",
                `Currently processing cell: ${singleCellQueueProcessingId}, queue: [${translationQueue.join(
                    ", "
                )}]`
            );
            return;
        }

        // Get the next cell to process
        const nextCellId = translationQueue[0];
        debug(
            "queue",
            `Processing next cell in queue: ${nextCellId}. Queue length: ${translationQueue.length}`
        );

        // First update the queue by removing the cell we're about to process
        // This is important to do first to avoid race conditions
        setTranslationQueue((prev) => {
            const remaining = prev.slice(1);
            debug("queue", `Updated queue after removing current cell: [${remaining.join(", ")}]`);
            return remaining;
        });

        // Set the processing start time for tracking
        processingStartTimeRef.current = Date.now();

        // Then update processing state
        setSingleCellQueueProcessingId(nextCellId);
        setIsProcessingCell(true);

        // Send the translation request - do this outside of state updates
        setTimeout(() => {
            debug("queue", `Sending translation request for: ${nextCellId}`);
            vscode.postMessage({
                command: "llmCompletion",
                content: {
                    currentLineId: nextCellId,
                    addContentToValue: true,
                },
            });
        }, 0);

        // Set up a safety timeout in case the cell never completes
        const safetyTimeout = setTimeout(() => {
            debug("queue", `Safety timeout for cell: ${nextCellId}`);
            if (singleCellQueueProcessingId === nextCellId && isProcessingCell) {
                debug("queue", "Forcing queue to continue");
                setSingleCellQueueProcessingId(undefined);
                setIsProcessingCell(false);
            }
        }, 30000); // 30 second timeout

        return () => clearTimeout(safetyTimeout);
    }, [translationQueue, isProcessingCell, singleCellQueueProcessingId]);

    // Add an additional safeguard to detect if a cell has been processing for too long
    useEffect(() => {
        if (!isProcessingCell) {
            // Reset the timer when not processing
            processingStartTimeRef.current = null;
            return;
        }

        // Set up an interval to check if we've been processing too long
        const checkInterval = setInterval(() => {
            if (processingStartTimeRef.current && isProcessingCell) {
                const processingTime = Date.now() - processingStartTimeRef.current;
                if (processingTime > 20000) {
                    // 20 seconds
                    debug(
                        "queue",
                        `Cell ${singleCellQueueProcessingId} has been processing for ${processingTime}ms, which seems excessive`
                    );
                }

                if (processingTime > 45000) {
                    // 45 seconds (before the 60s timeout)
                    debug(
                        "queue",
                        `WARNING: Cell ${singleCellQueueProcessingId} has been processing for ${processingTime}ms. Forcing reset.`
                    );
                    // Reset state to allow next cell to process
                    setSingleCellQueueProcessingId(undefined);
                    setIsProcessingCell(false);
                    processingStartTimeRef.current = null;
                }
            }
        }, 5000); // Check every 5 seconds

        return () => clearInterval(checkInterval);
    }, [isProcessingCell, singleCellQueueProcessingId]);

    // Simplify sparkle button handler to work with provider state
    const handleSparkleButtonClick = (cellId: string) => {
        debug("sparkle", `Sparkle button clicked for cell: ${cellId}`);

        // Add the cell to the queue instead of processing immediately
        setTranslationQueue((queue) => {
            // Check if this cell is already in the queue or is currently processing
            if (queue.includes(cellId) || cellId === singleCellQueueProcessingId) {
                debug("sparkle", `Cell already in queue or processing: ${cellId}`);
                return queue; // Return unchanged queue
            }

            // Check that the cell ID is valid
            if (!cellId || cellId.trim() === "") {
                debug("sparkle", "Invalid cell ID, skipping:", cellId);
                return queue;
            }

            debug(
                "sparkle",
                `Adding cell to translation queue: ${cellId}. Current queue length: ${queue.length}`
            );

            // Create a new queue with the cell added
            const newQueue = [...queue, cellId];

            // Debug info
            debug("sparkle", `Updated queue: [${newQueue.join(", ")}]`);
            return newQueue;
        });
    };

    // Error handler for failed translations
    const handleTranslationError = useCallback((cellId: string) => {
        debug("error", `Translation failed for cell: ${cellId}`);

        // Reset the processing state so the queue can continue
        setIsProcessingCell(false);
        setSingleCellQueueProcessingId(undefined);

        // Could show an error message here if desired
    }, []);

    // Handler to stop all single-cell translations
    const handleStopSingleCellTranslation = useCallback(() => {
        debug("translation", "Stopping pending cell translations");

        // Only clear the queue, but keep the currently processing cell active
        // This ensures the spinner continues showing for cells already being translated
        setTranslationQueue([]);

        // Don't reset processing state for the currently processing cell
        // We want to keep the spinner showing for that cell since a response will eventually come back

        debug(
            "translation",
            `Queue cleared. Currently processing cell (${singleCellQueueProcessingId}) will complete normally.`
        );
    }, [singleCellQueueProcessingId]);

    // Modify the existing code to expose this function
    useEffect(() => {
        // Make the sparkle button handler available to the CellList component
        (window as any).handleSparkleButtonClick = handleSparkleButtonClick;

        // Also make the error handler available
        (window as any).handleTranslationError = handleTranslationError;
    }, [handleTranslationError]);

    // Add a monitoring effect to detect stuck translations
    useEffect(() => {
        // If we're processing a cell, set up a timeout to detect if it gets stuck
        if (isProcessingCell && singleCellQueueProcessingId) {
            debug(
                "monitor",
                `Setting up stuck translation monitor for cell: ${singleCellQueueProcessingId}`
            );

            const stuckTimeout = setTimeout(() => {
                if (isProcessingCell && singleCellQueueProcessingId) {
                    debug(
                        "monitor",
                        `Cell translation appears stuck: ${singleCellQueueProcessingId}`
                    );

                    // Reset processing state to continue the queue
                    handleTranslationError(singleCellQueueProcessingId);
                }
            }, 60000); // 60 seconds should be more than enough for any normal translation

            return () => clearTimeout(stuckTimeout);
        }
    }, [isProcessingCell, singleCellQueueProcessingId, handleTranslationError]);

    // Add a special effect to detect content changes that might indicate a completed translation
    useEffect(() => {
        // If we're processing a cell, check if its content has changed
        if (isProcessingCell && singleCellQueueProcessingId) {
            const cell = translationUnits.find(
                (unit) => unit.cellMarkers[0] === singleCellQueueProcessingId
            );

            if (cell) {
                const previousContent = cellContentMapRef.current.get(singleCellQueueProcessingId);

                if (
                    previousContent !== undefined &&
                    previousContent !== cell.cellContent &&
                    cell.cellContent.trim().length > 0
                ) {
                    debug("content", "Content change detected:", {
                        cellId: singleCellQueueProcessingId,
                        previousLength: previousContent.length,
                        newLength: cell.cellContent.length,
                        preview: {
                            previous: previousContent.substring(0, 50),
                            current: cell.cellContent.substring(0, 50),
                        },
                    });

                    setSingleCellQueueProcessingId(undefined);
                    setIsProcessingCell(false);
                }

                cellContentMapRef.current.set(singleCellQueueProcessingId, cell.cellContent);
            }
        }

        // Keep our content map updated with all cells' content
        translationUnits.forEach((unit) => {
            if (unit.cellMarkers[0]) {
                cellContentMapRef.current.set(unit.cellMarkers[0], unit.cellContent);
            }
        });
    }, [translationUnits, isProcessingCell, singleCellQueueProcessingId]);

    const duplicateCellsExist = checkForDuplicateCells(translationUnits);

    // Add a function to apply all pending validations
    const applyPendingValidations = () => {
        setIsApplyingValidations(true);
        vscode.postMessage({
            command: "applyPendingValidations",
        });
    };

    // Update the clearPendingValidations function to make the Apply Validations button disappear
    const clearPendingValidations = (e: React.MouseEvent) => {
        // Stop propagation to prevent the main button click handler
        e.stopPropagation();

        // Set isApplyingValidations to true temporarily to hide the button immediately
        // This gives immediate visual feedback before the server responds
        setIsApplyingValidations(true);

        vscode.postMessage({
            command: "clearPendingValidations",
        });
    };

    // Listen for the bible book map from the provider
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "setBibleBookMap" && message.data) {
                debug("map", "Received Bible Book Map from provider", message.data);
                try {
                    // Convert the array of entries back into a Map
                    const newMap = new Map<string, BibleBookInfo>(message.data);
                    setBibleBookMap(newMap);
                    debug("map", "Successfully set Bible Book Map in state", newMap);
                } catch (error) {
                    console.error("Error processing bible book map data:", error);
                }
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    // Update toggle functions to use the shared VS Code API instance
    const togglePrimarySidebar = () => {
        console.log("togglePrimarySidebar");
        // Send the opposite of the current state as we're about to toggle it
        vscode.postMessage({
            command: "toggleSidebar",
            content: { isOpening: !primarySidebarVisible },
        });
        setPrimarySidebarVisible(!primarySidebarVisible);
    };

    // Define sidebar toggle button styles
    const menuToggleStyle: React.CSSProperties = {
        position: "fixed",
        top: "50%",
        transform: "translateY(-50%)",
        left: 0,
        width: "8px", // Thin initially
        height: "60px",
        backgroundColor: "var(--vscode-button-background)",
        opacity: 0.4,
        cursor: "pointer",
        zIndex: 1000,
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        transition: "all 0.3s cubic-bezier(0.2, 0, 0.2, 1)",
        boxShadow: "0 1px 3px rgba(0, 0, 0, 0.2)",
        borderRadius: "0 3px 3px 0", // Round only the right corners
    };

    const handleCloseCurrentDocument = () => {
        vscode.postMessage({
            command: "closeCurrentDocument",
        } as EditorPostMessages);
    };

    const handleTriggerSync = () => {
        if (vscode) {
            vscode.postMessage({ command: "triggerSync" } as EditorPostMessages);
        }
    };

    // Request editor position when component mounts
    useEffect(() => {
        if (vscode) {
            vscode.postMessage({ command: "getEditorPosition" });
        }
    }, [vscode]);

    // Listen for editor position and file status updates
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "editorPosition") {
                setEditorPosition(message.position);
            }
            if (message.type === "updateFileStatus") {
                setFileStatus(message.status);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    if (duplicateCellsExist) {
        return (
            <DuplicateCellResolver
                translationUnits={translationUnits}
                textDirection={textDirection}
                vscode={vscode}
            />
        );
    }

    return (
        <div className="cell-editor-container" style={{ direction: textDirection as any }}>
            {/* Menu toggle button */}
            <div
                className="sidebar-toggle menu-toggle"
                style={menuToggleStyle}
                onClick={togglePrimarySidebar}
                onMouseEnter={(e) => {
                    e.currentTarget.style.opacity = "0.8";
                    e.currentTarget.style.width = "22px";
                    e.currentTarget.style.boxShadow = "0 2px 6px rgba(0, 0, 0, 0.25)";
                    // Show the icon when hovering
                    const icon = e.currentTarget.querySelector(".codicon");
                    if (icon) {
                        (icon as HTMLElement).style.opacity = "1";
                    }
                }}
                onMouseLeave={(e) => {
                    e.currentTarget.style.opacity = "0.4";
                    e.currentTarget.style.width = "8px";
                    e.currentTarget.style.boxShadow = "0 1px 3px rgba(0, 0, 0, 0.2)";
                    // Hide the icon when not hovering
                    const icon = e.currentTarget.querySelector(".codicon");
                    if (icon) {
                        (icon as HTMLElement).style.opacity = "0";
                    }
                }}
            >
                <span
                    className={`codicon ${
                        primarySidebarVisible ? "codicon-chevron-left" : "codicon-chevron-right"
                    }`}
                    style={{
                        color: "var(--vscode-button-foreground)",
                        opacity: 0,
                        transition: "opacity 0.3s ease",
                        position: "absolute",
                        right: "4px",
                    }}
                ></span>
            </div>

            {/* Add some CSS to handle the hover effects better */}
            <style>{`
                .sidebar-toggle:hover .codicon {
                    opacity: 1 !important;
                }
            `}</style>

            <div className="codex-cell-editor">
                <div className="static-header" ref={headerRef}>
                    <div ref={navigationRef}>
                        <ChapterNavigationHeader
                            vscode={vscode}
                            chapterNumber={chapterNumber}
                            setChapterNumber={setChapterNumber}
                            totalChapters={totalChapters}
                            totalUntranslatedCells={untranslatedCellsForSection.length}
                            totalCellsToAutocomplete={
                                untranslatedOrUnvalidatedUnitsForSection.length
                            }
                            totalCellsWithCurrentUserOption={
                                untranslatedOrNotValidatedByCurrentUserUnitsForSection.length
                            }
                            totalFullyValidatedCells={fullyValidatedUnitsForSection.length}
                            setShouldShowVideoPlayer={setShouldShowVideoPlayer}
                            shouldShowVideoPlayer={shouldShowVideoPlayer}
                            unsavedChanges={!!contentBeingUpdated.cellContent}
                            onAutocompleteChapter={(
                                numberOfCells,
                                includeEmptyCells,
                                includeNotValidatedByAnyUser,
                                includeNotValidatedByCurrentUser,
                                includeFullyValidatedByOthers
                            ) => {
                                debug("autocomplete", "Autocomplete requested with:", {
                                    numberOfCells,
                                    includeEmptyCells,
                                    includeNotValidatedByAnyUser,
                                    includeNotValidatedByCurrentUser,
                                    includeFullyValidatedByOthers,
                                    countNoValidators:
                                        untranslatedOrUnvalidatedUnitsForSection.length,
                                    countWithCurrentUser:
                                        untranslatedOrNotValidatedByCurrentUserUnitsForSection.length,
                                });
                                handleAutocompleteChapter(
                                    numberOfCells,
                                    includeEmptyCells,
                                    includeNotValidatedByAnyUser,
                                    includeNotValidatedByCurrentUser,
                                    includeFullyValidatedByOthers
                                );
                            }}
                            onStopAutocomplete={handleStopAutocomplete}
                            isAutocompletingChapter={isAutocompletingChapter}
                            onSetTextDirection={(direction) => {
                                setTextDirection(direction);
                                vscode.postMessage({
                                    command: "updateTextDirection",
                                    direction,
                                } as EditorPostMessages);
                            }}
                            textDirection={textDirection}
                            onSetCellDisplayMode={setCellDisplayMode}
                            cellDisplayMode={cellDisplayMode}
                            isSourceText={isSourceText}
                            openSourceText={openSourceText}
                            documentHasVideoAvailable={documentHasVideoAvailable}
                            metadata={metadata}
                            tempVideoUrl={tempVideoUrl}
                            onMetadataChange={handleMetadataChange}
                            onSaveMetadata={handleSaveMetadata}
                            onPickFile={handlePickFile}
                            onUpdateVideoUrl={handleUpdateVideoUrl}
                            toggleScrollSync={() => setScrollSyncEnabled(!scrollSyncEnabled)}
                            scrollSyncEnabled={scrollSyncEnabled}
                            translationUnitsForSection={translationUnitsWithCurrentEditorContent}
                            isTranslatingCell={translationQueue.length > 0 || isProcessingCell}
                            onStopSingleCellTranslation={handleStopSingleCellTranslation}
                            bibleBookMap={bibleBookMap}
                            currentSubsectionIndex={currentSubsectionIndex}
                            setCurrentSubsectionIndex={setCurrentSubsectionIndex}
                            getSubsectionsForChapter={getSubsectionsForChapter}
                            editorPosition={editorPosition}
                            fileStatus={fileStatus}
                            onTriggerSync={handleTriggerSync}
                        />
                    </div>
                </div>
                {shouldShowVideoPlayer && videoUrl && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                        }}
                        ref={videoPlayerRef}
                    >
                        <VideoTimelineEditor
                            videoUrl={videoUrl}
                            translationUnitsForSection={translationUnitsWithCurrentEditorContent}
                            vscode={vscode}
                            playerRef={playerRef}
                        />
                    </div>
                )}
                <div
                    className="scrollable-content"
                    style={{ height: `calc(100vh - ${headerHeight}px)` }}
                >
                    <div className="editor-container">
                        <CellList
                            spellCheckResponse={spellCheckResponse}
                            translationUnits={translationUnitsForSection}
                            contentBeingUpdated={contentBeingUpdated}
                            setContentBeingUpdated={handleSetContentBeingUpdated}
                            handleCloseEditor={handleCloseEditor}
                            handleSaveHtml={handleSaveHtml}
                            vscode={vscode}
                            textDirection={textDirection}
                            cellDisplayMode={cellDisplayMode}
                            isSourceText={isSourceText}
                            windowHeight={windowHeight}
                            headerHeight={headerHeight}
                            alertColorCodes={alertColorCodes}
                            highlightedCellId={highlightedCellId}
                            scrollSyncEnabled={scrollSyncEnabled}
                            translationQueue={translationQueue}
                            currentProcessingCellId={
                                singleCellQueueProcessingId || autocompletionState.currentCellId
                            }
                            cellsInAutocompleteQueue={
                                autocompletionState.isProcessing
                                    ? autocompletionState.cellsToProcess
                                    : // Keep showing spinner for current processing cell even if autocomplete was canceled
                                    autocompletionState.currentCellId
                                    ? [autocompletionState.currentCellId]
                                    : []
                            }
                            audioAttachments={audioAttachments}
                        />
                    </div>
                </div>

                {/* Floating button to apply pending validations */}
                {pendingValidationsCount > 0 && !isApplyingValidations && (
                    <div
                        className="floating-apply-validations-button"
                        onClick={applyPendingValidations}
                        title={`Apply ${pendingValidationsCount} pending validation${
                            pendingValidationsCount > 1 ? "s" : ""
                        }`}
                    >
                        <span className="validation-count">{pendingValidationsCount}</span>
                        <i className="codicon codicon-check-all"></i>
                        <span className="button-text">Apply Validations</span>
                        <div
                            className="close-button"
                            onClick={clearPendingValidations}
                            title="Clear pending validations"
                        >
                            <i className="codicon codicon-close"></i>
                        </div>
                    </div>
                )}

                {/* Loading indicator while applying validations */}
                {isApplyingValidations && (
                    <div className="floating-apply-validations-button applying">
                        <i className="codicon codicon-loading spin"></i>
                        <span className="button-text">Applying...</span>
                    </div>
                )}
            </div>

            {/* Floating button to apply pending validations */}
            {!isSourceText && pendingValidationsCount > 0 && !isApplyingValidations && (
                <div
                    className="floating-apply-validations-button"
                    onClick={applyPendingValidations}
                    title={`Apply ${pendingValidationsCount} pending validation${
                        pendingValidationsCount > 1 ? "s" : ""
                    }`}
                >
                    {/* NOTE: styles for this component are hard-coded into the CodexCellEditorProvider.ts */}
                    <span className="validation-count">{pendingValidationsCount}</span>
                    <i className="codicon codicon-check-all"></i>
                    <span className="button-text">Apply Validations</span>
                    <div
                        className="close-button"
                        onClick={clearPendingValidations}
                        title="Clear pending validations"
                    >
                        <i className="codicon codicon-close"></i>
                    </div>
                </div>
            )}

            {/* Loading indicator while applying validations */}
            {isApplyingValidations && !isSourceText && (
                <div className="floating-apply-validations-button applying">
                    <i className="codicon codicon-loading spin"></i>
                    <span className="button-text">Applying...</span>
                </div>
            )}
        </div>
    );
};

export default CodexCellEditor;
