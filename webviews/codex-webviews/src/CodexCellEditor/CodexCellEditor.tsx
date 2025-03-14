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
import ChapterNavigation from "./ChapterNavigation";
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
import { useQuillTextExtractor } from "./hooks/useQuillTextExtractor";
import { initializeStateStore } from "../../../../src/stateStore";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import { CodexCellTypes } from "types/enums";
import { getCellValueData } from "./utils/shareUtils";
import { isValidValidationEntry } from "./ValidationButton";
const vscode = acquireVsCodeApi();
(window as any).vscodeApi = vscode;

// eslint-disable-next-line react-refresh/only-export-components
export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
    ONE_LINE_PER_CELL = "one-line-per-cell",
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[CodexCellEditor] ${message}`, ...args);
    }
}

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<QuillCellContent[]>([]);
    const [alertColorCodes, setAlertColorCodes] = useState<{
        [cellId: string]: number;
    }>({});
    const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);
    const [isWebviewReady, setIsWebviewReady] = useState(false);
    const { setContentToScrollTo } = useContext(ScrollToContentContext);
    const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true);
    
    // Translation queue state for single cell translations
    const [translationQueue, setTranslationQueue] = useState<string[]>([]);
    // Flag to track if a cell is currently being translated
    const [isProcessingCell, setIsProcessingCell] = useState<boolean>(false);
    // Currently processing cell ID
    const [singleCellQueueProcessingId, setSingleCellQueueProcessingId] = useState<string | undefined>(undefined);
    
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
        progress: 0
    });
    
    const [singleCellTranslationState, setSingleCellTranslationState] = useState<{
        isProcessing: boolean;
        cellId?: string;
        progress: number;
    }>({
        isProcessing: false,
        cellId: undefined,
        progress: 0
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
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorCellContent>({} as EditorCellContent);
    const [currentEditingCellId, setCurrentEditingCellId] = useState<string | null>(null);
    
    // A "temp" video URL that is used to update the video URL in the metadata modal.
    // We need to use the client-side file picker, so we need to then pass the picked
    // video URL back to the extension so the user can save or cancel the change.
    const [tempVideoUrl, setTempVideoUrl] = useState<string>("");
    
    // Debug timestamp to track when a cell started processing
    const processingStartTimeRef = useRef<number | null>(null);
    
    const handleSetContentBeingUpdated = (content: EditorCellContent) => {
        setContentBeingUpdated(content);
        setCurrentEditingCellId(content.cellMarkers?.[0] || null);
    };
    
    // Add the removeHtmlTags function
    const removeHtmlTags = (text: string) => {
        const temp = document.createElement('div');
        temp.innerHTML = text;
        return temp.textContent || temp.innerText || '';
    };
    
    // Function to check alert codes
    const checkAlertCodes = () => {
        const cellContentAndId = translationUnits.map((unit) => ({
            text: removeHtmlTags(unit.cellContent),
            cellId: unit.cellMarkers[0],
        }));

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
            setChapterNumber(parseInt(chapter) || 1);
        },
        updateCell: (data) => {
            if (data.cellId !== "initialization" && data.cellId !== "completion" && data.newContent) {
                console.log(`Cell update received for: ${data.cellId}, current processing: ${singleCellQueueProcessingId}`);
                
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
                    console.log(`Cell translation completed: ${data.cellId}. Resetting processing state.`);
                    
                    // Reset processing state to allow the next cell to be processed
                    // Important: call both state updates in sequence to ensure they happen in the same render cycle
                    setSingleCellQueueProcessingId(undefined);
                    setIsProcessingCell(false);
                }
            }
        },
        
        // Add this for compatibility
        autocompleteChapterComplete: () => {
            console.log("Autocomplete chapter complete (legacy handler)");
        },
        
        // New handlers for provider-centric state management
        updateAutocompletionState: (state) => {
            console.log("Received autocompletion state from provider:", state);
            setAutocompletionState(state);
        },
        
        updateSingleCellTranslationState: (state) => {
            console.log("Received single cell translation state from provider:", state);
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
            console.log(`Error with cell: ${data.cellId}, index: ${data.index}, total: ${data.totalCells}`);
            
            // If we're currently processing a cell that matches, assume it failed
            if (isProcessingCell && singleCellQueueProcessingId === data.cellId) {
                console.log(`Handling error for currently processing cell: ${singleCellQueueProcessingId}`);
                handleTranslationError(singleCellQueueProcessingId);
            }
        },
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

    const totalChapters = calculateTotalChapters(translationUnits);

    const translationUnitsForSection = translationUnits.filter((verse) => {
        const cellId = verse?.cellMarkers?.[0];
        const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
        const sectionCellNumber = sectionCellIdParts?.[0];
        return sectionCellNumber === chapterNumber.toString();
    });

    const { setUnsavedChanges } = useContext(UnsavedChangesContext);

    const handleCloseEditor = () => {
        setContentBeingUpdated({} as EditorCellContent);
        setUnsavedChanges(false);
    };

    const handleSaveHtml = () => {
        const content = contentBeingUpdated;
        debug("content", content);
        vscode.postMessage({
            command: "saveHtml",
            content: content,
        } as EditorPostMessages);
        checkAlertCodes();
        handleCloseEditor();
    };

    // State for current user - initialize with a default test username to ensure logic works
    const [username, setUsername] = useState<string | null>("test-user");
    
    // Fetch username from extension and add extensive debugging
    useEffect(() => {
        console.log("Setting up username listener and requesting username");
        
        const handleMessage = (event: MessageEvent) => {
            console.log("Message received:", event.data);
            const message = event.data;
            
            if (message.type === "setUsername" || message.command === "setUsername") {
                const newUsername = message.username || message.value;
                console.log("Username set to:", newUsername);
                setUsername(newUsername);
            } else if (message.type === "currentUsername") {
                console.log("Current username received:", message.content.username);
                setUsername(message.content.username);
            }
        };
        
        window.addEventListener("message", handleMessage);
        
        // Request username from extension using both possible commands
        vscode.postMessage({
            command: "requestUsername"
        });
        
        vscode.postMessage({
            command: "getCurrentUsername"
        });
        
        console.log("Requested username from extension");
        return () => window.removeEventListener("message", handleMessage);
    }, []);
    
    // Debug effect to show when username changes
    useEffect(() => {
        console.log("Username changed to:", username);
        
        // Force recalculation of counts when username changes
        if (username) {
            console.log("Recalculating counts due to username change");
        }
    }, [username]);

    // Cells with no content or where the latest edit has no validators
    const untranslatedOrUnvalidatedUnitsForSection = useMemo(() => {
        console.log("Calculating cells needing autocomplete (no content or no validators)...");
        
        const result = translationUnitsForSection.filter((unit) => {
            // Check if the cell is empty
            const hasNoContent = !unit.cellContent.trim();
            
            // Get the latest edit
            const latestEdit = unit.editHistory && unit.editHistory.length > 0 
                ? unit.editHistory[unit.editHistory.length - 1] 
                : null;
            
            // Check if the latest edit has no validators
            const hasNoValidators = latestEdit && 
                (!latestEdit.validatedBy || latestEdit.validatedBy.length === 0);
            
            return hasNoContent || hasNoValidators;
        });
        
        console.log('Cells with no content or no validators:', result.length);
        return result;
    }, [translationUnitsForSection]);
    
    // Cells with no content, no validators, or not validated by current user
    const untranslatedOrNotValidatedByCurrentUserUnitsForSection = useMemo(() => {
        const currentUsername = username;
        console.log("Calculating cells including not validated by current user...");
        console.log("Current username:", currentUsername);
        console.log("Total cells to process:", translationUnitsForSection.length);
        
        // For debugging, show details of each cell's validation
        translationUnitsForSection.forEach((unit, index) => {
            const latestEdit = unit.editHistory && unit.editHistory.length > 0 
                ? unit.editHistory[unit.editHistory.length - 1] 
                : null;
                
            console.log(`Cell ${index + 1} details:`, {
                content: unit.cellContent.substring(0, 30) + (unit.cellContent.length > 30 ? "..." : ""),
                hasContent: !!unit.cellContent.trim(),
                hasLatestEdit: !!latestEdit,
                hasValidators: latestEdit && latestEdit.validatedBy && latestEdit.validatedBy.length > 0,
                validatorCount: latestEdit?.validatedBy?.length || 0,
                validators: latestEdit?.validatedBy?.map(v => ({
                    username: v.username,
                    isDeleted: v.isDeleted,
                    isCurrentUser: v.username === currentUsername
                })) || []
            });
        });
        
        const result = translationUnitsForSection.filter((unit, index) => {
            // Check if the cell is empty
            const hasNoContent = !unit.cellContent.trim();
            
            // Get the latest edit
            const latestEdit = unit.editHistory && unit.editHistory.length > 0 
                ? unit.editHistory[unit.editHistory.length - 1] 
                : null;
            
            // Check if the latest edit has no validators
            const hasNoValidators = latestEdit && 
                (!latestEdit.validatedBy || latestEdit.validatedBy.length === 0);
            
            // Check if the cell is not validated by the current user
            let notValidatedByCurrentUser = false;
            
            if (latestEdit && latestEdit.validatedBy && latestEdit.validatedBy.length > 0 && currentUsername) {
                // Cell is not validated by current user if:
                // 1. Current user is not in the validatedBy array, OR
                // 2. Current user is in the array but with isDeleted=true
                const currentUserValidation = latestEdit.validatedBy.find(
                    v => v.username === currentUsername
                );
                
                notValidatedByCurrentUser = !currentUserValidation || currentUserValidation.isDeleted;
                
                // Debug information
                if (currentUserValidation) {
                    console.log(`Cell ${index + 1} validation for user ${currentUsername}:`, {
                        hasValidation: !!currentUserValidation,
                        isDeleted: currentUserValidation.isDeleted,
                        shouldInclude: notValidatedByCurrentUser
                    });
                } else {
                    console.log(`Cell ${index + 1} has no validation for user ${currentUsername}, should include:`, true);
                }
            }
            
            const shouldInclude = hasNoContent || hasNoValidators || notValidatedByCurrentUser;
            console.log(`Cell ${index + 1} inclusion decision:`, {
                hasNoContent,
                hasNoValidators,
                notValidatedByCurrentUser,
                shouldInclude
            });
            
            return shouldInclude;
        });
        
        console.log('Cells including not validated by current user:', result.length);
        return result;
    }, [translationUnitsForSection, username]);

    // Update handler for file/chapter changes to recalculate cells needing autocomplete
    useEffect(() => {
        console.log("Active document or section changed, recalculating autocomplete cells...");
        
        // Log all cell details for debugging
        if (translationUnitsForSection.length > 0) {
            console.log("Current translation units:", 
                translationUnitsForSection.map((unit, index) => {
                    const latestEdit = unit.editHistory && unit.editHistory.length > 0 
                        ? unit.editHistory[unit.editHistory.length - 1] 
                        : null;
                    
                    return {
                        index,
                        hasContent: !!unit.cellContent.trim(),
                        editCount: unit.editHistory?.length || 0,
                        validatorCount: latestEdit?.validatedBy?.length || 0,
                        validators: latestEdit?.validatedBy?.map(v => ({
                            username: v.username,
                            isDeleted: v.isDeleted
                        }))
                    };
                })
            );
        }
    }, [chapterNumber, translationUnits, translationUnitsForSection, username]);

    const safetyTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    const handleAutocompleteChapter = (numberOfCells: number, includeNotValidatedByCurrentUser: boolean) => {
        console.log("Requesting autocomplete chapter:", numberOfCells, includeNotValidatedByCurrentUser);
        
        // Choose which set of cells to use based on the include option
        const cellsToAutocomplete = includeNotValidatedByCurrentUser
            ? untranslatedOrNotValidatedByCurrentUserUnitsForSection.slice(0, numberOfCells)
            : untranslatedOrUnvalidatedUnitsForSection.slice(0, numberOfCells);
        
        // Send the request to the provider - it will handle all state updates
        vscode.postMessage({
            command: "requestAutocompleteChapter",
            content: cellsToAutocomplete,
        } as EditorPostMessages);
    };

    const handleStopAutocomplete = () => {
        console.log("Stopping autocomplete chapter");
        
        // Just send the stop command, provider will update state
        vscode.postMessage({
            command: "stopAutocompleteChapter"
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
                console.log(`Seeking to ${startTime} + ${OFFSET_SECONDS} seconds`);
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
            console.log("Updated metadata:", updatedMetadata);
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
        console.log("Saving metadata:", updatedMetadata);
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

    const duplicateCellsExist = checkForDuplicateCells(translationUnits);

    if (duplicateCellsExist) {
        return (
            <DuplicateCellResolver
                translationUnits={translationUnits}
                textDirection={textDirection}
                vscode={vscode}
            />
        );
    }

    const getCurrentEditingCellId = () => currentEditingCellId;

    (window as any).getCurrentEditingCellId = getCurrentEditingCellId;

    const documentHasVideoAvailable = !!metadata.videoUrl;

    // Debug helper: Log info about translation units and their validation status
    useEffect(() => {
        if (translationUnitsForSection.length > 0) {
            console.log('Debug: Translation Units Status:');
            console.log('Total units:', translationUnitsForSection.length);
            
            const unitsWithNoContent = translationUnitsForSection.filter(unit => !unit.cellContent.trim()).length;
            console.log('Units with no content:', unitsWithNoContent);
            
            const llmGeneratedUnits = translationUnitsForSection.filter(unit => {
                const cellValueData = getCellValueData(unit);
                return cellValueData.editType === "llm-generation";
            }).length;
            console.log('LLM generated units:', llmGeneratedUnits);
            
            const unitsWithValidations = translationUnitsForSection.filter(unit => {
                const cellValueData = getCellValueData(unit);
                return cellValueData.validatedBy && cellValueData.validatedBy.length > 0;
            }).length;
            console.log('Units with validations:', unitsWithValidations);
            
            console.log('Current username:', username);
            console.log('Units needing autocomplete (no content or no validators):', untranslatedOrUnvalidatedUnitsForSection.length);
            console.log('Units needing autocomplete (including not validated by current user):', untranslatedOrNotValidatedByCurrentUserUnitsForSection.length);
        }
    }, [translationUnitsForSection, username, untranslatedOrUnvalidatedUnitsForSection, untranslatedOrNotValidatedByCurrentUserUnitsForSection]);

    // Add debugging for counts at render time
    console.log("RENDER COUNTS:", {
        noValidatorsCount: untranslatedOrUnvalidatedUnitsForSection.length,
        withCurrentUserCount: untranslatedOrNotValidatedByCurrentUserUnitsForSection.length,
        username
    });

    // Clean up when component unmounts
    useEffect(() => {
        return () => {
            // Cancel any in-progress autocompletion when component unmounts
            if (autocompletionState.isProcessing) {
                vscode.postMessage({
                    command: "stopAutocompleteChapter"
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
            console.log(`Currently processing cell: ${singleCellQueueProcessingId}, queue: [${translationQueue.join(', ')}]`);
            return;
        }
        
        // Get the next cell to process
        const nextCellId = translationQueue[0];
        console.log(`Processing next cell in queue: ${nextCellId}. Queue length: ${translationQueue.length}`);
        
        // First update the queue by removing the cell we're about to process
        // This is important to do first to avoid race conditions
        setTranslationQueue(prev => {
            const remaining = prev.slice(1);
            console.log(`Updated queue after removing current cell: [${remaining.join(', ')}]`);
            return remaining;
        });
        
        // Set the processing start time for tracking
        processingStartTimeRef.current = Date.now();
        
        // Then update processing state
        setSingleCellQueueProcessingId(nextCellId);
        setIsProcessingCell(true);
        
        // Send the translation request - do this outside of state updates
        setTimeout(() => {
            console.log(`Sending translation request for: ${nextCellId}`);
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
            console.log(`Safety timeout for cell: ${nextCellId}`);
            if (singleCellQueueProcessingId === nextCellId && isProcessingCell) {
                console.log("Forcing queue to continue");
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
                if (processingTime > 20000) { // 20 seconds
                    console.log(`Cell ${singleCellQueueProcessingId} has been processing for ${processingTime}ms, which seems excessive`);
                }
                
                if (processingTime > 45000) { // 45 seconds (before the 60s timeout)
                    console.log(`WARNING: Cell ${singleCellQueueProcessingId} has been processing for ${processingTime}ms. Forcing reset.`);
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
        console.log(`Sparkle button clicked for cell: ${cellId}`);
        
        // Add the cell to the queue instead of processing immediately
        setTranslationQueue(queue => {
            // Check if this cell is already in the queue or is currently processing
            if (queue.includes(cellId) || cellId === singleCellQueueProcessingId) {
                console.log(`Cell already in queue or processing: ${cellId}`);
                return queue; // Return unchanged queue
            }
            
            // Check that the cell ID is valid
            if (!cellId || cellId.trim() === '') {
                console.log("Invalid cell ID, skipping:", cellId);
                return queue;
            }
            
            console.log(`Adding cell to translation queue: ${cellId}. Current queue length: ${queue.length}`);
            
            // Create a new queue with the cell added
            const newQueue = [...queue, cellId];
            
            // Debug info
            console.log(`Updated queue: [${newQueue.join(', ')}]`);
            return newQueue;
        });
    };

    // Error handler for failed translations
    const handleTranslationError = useCallback((cellId: string) => {
        console.log(`Translation failed for cell: ${cellId}`);
        
        // Reset the processing state so the queue can continue
        setIsProcessingCell(false);
        setSingleCellQueueProcessingId(undefined);
        
        // Could show an error message here if desired
    }, []);
    
    // Handler to stop all single-cell translations
    const handleStopSingleCellTranslation = useCallback(() => {
        console.log("Stopping pending cell translations");
        
        // Only clear the queue, but keep the currently processing cell active
        // This ensures the spinner continues showing for cells already being translated
        setTranslationQueue([]);
        
        // Don't reset processing state for the currently processing cell
        // We want to keep the spinner showing for that cell since a response will eventually come back
        
        console.log(`Queue cleared. Currently processing cell (${singleCellQueueProcessingId}) will complete normally.`);
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
            console.log(`Setting up stuck translation monitor for cell: ${singleCellQueueProcessingId}`);
            
            const stuckTimeout = setTimeout(() => {
                if (isProcessingCell && singleCellQueueProcessingId) {
                    console.log(`Cell translation appears stuck: ${singleCellQueueProcessingId}`);
                    
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
            // Find this cell in the current translation units
            const cell = translationUnits.find(unit => unit.cellMarkers[0] === singleCellQueueProcessingId);
            
            if (cell) {
                // Get previous content (if we've seen this cell before)
                const previousContent = cellContentMapRef.current.get(singleCellQueueProcessingId);
                
                // If we have previous content and it's different from current, the translation likely completed
                if (previousContent !== undefined && 
                    previousContent !== cell.cellContent && 
                    cell.cellContent.trim().length > 0) {
                    
                    console.log(`Detected content change for cell ${singleCellQueueProcessingId}!`);
                    console.log(`Previous: "${previousContent.substring(0, 50)}..."`);
                    console.log(`Current: "${cell.cellContent.substring(0, 50)}..."`);
                    
                    // Content has changed, mark translation as complete
                    console.log(`Cell content changed - assuming translation complete for ${singleCellQueueProcessingId}`);
                    setSingleCellQueueProcessingId(undefined);
                    setIsProcessingCell(false);
                }
                
                // Always update our content map with the latest
                cellContentMapRef.current.set(singleCellQueueProcessingId, cell.cellContent);
            }
        }
        
        // Keep our content map updated with all cells' content
        translationUnits.forEach(unit => {
            if (unit.cellMarkers[0]) {
                cellContentMapRef.current.set(unit.cellMarkers[0], unit.cellContent);
            }
        });
    }, [translationUnits, isProcessingCell, singleCellQueueProcessingId]);

    return (
        <div className="codex-cell-editor">
            <div className="static-header" ref={headerRef}>
                <div ref={navigationRef}>
                    <ChapterNavigation
                        chapterNumber={chapterNumber}
                        setChapterNumber={setChapterNumber}
                        totalChapters={totalChapters}
                        unsavedChanges={!!contentBeingUpdated.cellContent}
                        onAutocompleteChapter={(numberOfCells, includeNotValidatedByCurrentUser) => {
                            console.log("Autocomplete requested with:", { 
                                numberOfCells, 
                                includeNotValidatedByCurrentUser,
                                countNoValidators: untranslatedOrUnvalidatedUnitsForSection.length,
                                countWithCurrentUser: untranslatedOrNotValidatedByCurrentUserUnitsForSection.length 
                            });
                            handleAutocompleteChapter(numberOfCells, includeNotValidatedByCurrentUser);
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
                        totalCellsToAutocomplete={untranslatedOrUnvalidatedUnitsForSection.length}
                        totalCellsWithCurrentUserOption={untranslatedOrNotValidatedByCurrentUserUnitsForSection.length}
                        setShouldShowVideoPlayer={setShouldShowVideoPlayer}
                        shouldShowVideoPlayer={shouldShowVideoPlayer}
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
                    />
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
            </div>
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
                        currentProcessingCellId={singleCellQueueProcessingId}
                        cellsInAutocompleteQueue={autocompletionState.isProcessing ? 
                            autocompletionState.cellsToProcess : 
                            // Keep showing spinner for current processing cell even if autocomplete was canceled
                            (autocompletionState.currentCellId ? [autocompletionState.currentCellId] : [])
                        }
                    />
                </div>
            </div>
        </div>
    );
};

export default CodexCellEditor;
