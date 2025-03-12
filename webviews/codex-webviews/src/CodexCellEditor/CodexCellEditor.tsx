import React, { useState, useEffect, useRef, useMemo, useContext } from "react";
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
import ProgressNotification from './ProgressNotification';
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
    const [isAutocompletingChapter, setIsAutocompletingChapter] = useState<boolean>(false);
    const [totalCellsToAutoComplete, setTotalCellsToAutoComplete] = useState<number>(0);
    const [cellsAutoCompleted, setCellsAutoCompleted] = useState<number>(0);
    const [autocompletionProgress, setAutocompletionProgress] = useState<number | null>(null);
    const [currentProcessingCellId, setCurrentProcessingCellId] = useState<string | undefined>(undefined);
    const [cellsToProcess, setCellsToProcess] = useState<string[]>([]);

    // Initialize state store after webview is ready
    useEffect(() => {
        const handleWebviewReady = (event: MessageEvent) => {
            if (event.data.type === "webviewReady") {
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
            if (message.type === "highlightCell" && message.cellId) {
                setHighlightedCellId(message.cellId);
            }
        };
        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    useEffect(() => {
        if (highlightedCellId && scrollSyncEnabled) {
            const cellId = highlightedCellId;
            const chapter = cellId?.split(" ")[1]?.split(":")[0];
            setChapterNumber(parseInt(chapter) || 1);
        }
    }, [highlightedCellId]);

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

    const [spellCheckResponse, setSpellCheckResponse] = useState<SpellCheckResponse | null>(null);
    const [contentBeingUpdated, setContentBeingUpdated] = useState<EditorCellContent>(
        {} as EditorCellContent
    );
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
    const { extractTextFromHtml } = useQuillTextExtractor();

    const removeHtmlTags = (text: string) => {
        return extractTextFromHtml(text);
    };
    // A "temp" video URL that is used to update the video URL in the metadata modal.
    // We need to use the client-side file picker, so we need to then pass the picked
    // video URL back to the extension so the user can save or cancel the change.
    const [tempVideoUrl, setTempVideoUrl] = useState<string>("");
    // const [documentHasVideoAvailable, setDocumentHasVideoAvailable] = useState<boolean>(false);
    const [currentEditingCellId, setCurrentEditingCellId] = useState<string | null>(null);

    const handleSetContentBeingUpdated = (content: EditorCellContent) => {
        setContentBeingUpdated(content);
        setCurrentEditingCellId(content.cellMarkers?.[0] || null);
    };

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
        updateCell: (data: {
            cellId: string;
            newContent: string;
            progress: number;
            cellLabel?: string;
        }) => {
            console.log(`🔄 RECEIVED CELL UPDATE: Cell ${data.cellId}, Progress: ${Math.round(data.progress * 100)}%`);
            
            // Track if we've already processed a completion
            const hasReachedCompletion = cellsAutoCompleted >= totalCellsToAutoComplete && totalCellsToAutoComplete > 0;
            
            // Don't process updates if we've already completed
            if (hasReachedCompletion && (data.cellId === "completion" || data.progress >= 0.99)) {
                console.log("🛑 Ignoring update - already reached completion state");
                return;
            }
            
            // Update the cell content first
            if (data.cellId !== "initialization" && data.cellId !== "completion" && data.newContent) {
                setTranslationUnits((prevUnits) =>
                    prevUnits.map((unit) =>
                        unit.cellMarkers[0] === data.cellId
                            ? {
                                  ...unit,
                                  cellContent: data.newContent,
                                  cellLabel: data.cellLabel || unit.cellLabel,
                              }
                            : unit
                    )
                );
            }
            
            // Update the currently processing cell - ALWAYS do this regardless of whether content was updated
            if (data.cellId !== "initialization" && data.cellId !== "completion") {
                console.log(`🎯 Setting current processing cell: ${data.cellId}`);
                setCurrentProcessingCellId(data.cellId);
                
                // If this cell is in our list of cells to process, mark it as completed
                if (cellsToProcess.includes(data.cellId)) {
                    console.log(`✅ Marking cell ${data.cellId} as completed`);
                    // Remove this cell from the list of cells to process
                    setCellsToProcess((prev) => {
                        const updated = prev.filter(id => id !== data.cellId);
                        console.log(`📊 Cells remaining to process: ${updated.length}`);
                        return updated;
                    });
                    
                    // Directly increment completed cells count instead of waiting for derived state
                    setCellsAutoCompleted(prev => {
                        const newCount = prev + 1;
                        console.log(`📈 Updated completed cells: ${newCount}/${totalCellsToAutoComplete}`);
                        return newCount;
                    });
                }
            }
            
            // ALWAYS update progress regardless of any conditions
            // Special case: don't reset progress to 0 on completion or if we're in a completed state
            // This prevents re-showing the notification with 0 progress after completion
            if (data.cellId !== "completion" || data.progress > 0.9) {
                console.log(`📊 Updating progress: ${data.progress * 100}%`);
                setAutocompletionProgress(data.progress);
                
                // Only set autocompletingChapter to true if we're still in an active session
                // Don't re-trigger the autocompletion state if we've completed it
                if (!hasReachedCompletion) {
                    setIsAutocompletingChapter(true);
                }
            }
            
            // Force a re-render to update the UI
            // This uses a setTimeout of 0ms to push this to the next event loop
            setTimeout(() => {
                // If we saw a timestamp when a cell was completed, update the state again to force a re-render
                setAutocompletionProgress(currentProgress => {
                    // Just return the same value, but this will trigger a re-render
                    return currentProgress; 
                });
            }, 0);
            
            // Check if this appears to be the last cell (progress around 100%)
            if (data.progress >= 0.999) {
                console.log("🏁 Progress at 100%, scheduling reset of autocompletion state");
                
                // Force a little delay and then reset the state
                setTimeout(() => {
                    console.log("🔄 Resetting autocompletion state after completion");
                    // Don't reset to prevent false re-renders
                    setIsAutocompletingChapter(false);
                    // Don't reset progress to null - keep the last value
                }, 3000);
            }
        },
        autocompleteChapterComplete: () => {
            console.log("Received completion signal from server, resetting autocompletion state");
            
            // Mark as completed to prevent re-showing notifications
            completionStateRef.current = {
                hasCompleted: true,
                completionTimestamp: Date.now()
            };
            
            // Clear the safety timeout
            if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
                safetyTimeoutRef.current = null;
            }
            
            // Only set isAutocompletingChapter to false, but don't reset other state
            // This prevents showing 0/0 notifications
            setTimeout(() => {
                setIsAutocompletingChapter(false);
                
                // Refresh content
                vscode.postMessage({ command: "getContent" } as EditorPostMessages);
            }, 100);
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
        console.log("Autocomplete chapter", numberOfCells, includeNotValidatedByCurrentUser);
        
        // Choose which set of cells to use based on the include option
        const cellsToAutocomplete = includeNotValidatedByCurrentUser
            ? untranslatedOrNotValidatedByCurrentUserUnitsForSection.slice(0, numberOfCells)
            : untranslatedOrUnvalidatedUnitsForSection.slice(0, numberOfCells);
            
        console.log("Starting autocomplete with explicit state updates:");
        
        // Get array of cell IDs to track
        const cellIds = cellsToAutocomplete.map(cell => cell.cellMarkers[0]);
        
        // Reset completion state reference
        completionStateRef.current = {
            hasCompleted: false,
            completionTimestamp: null
        };
        
        // Force reset state first to ensure clean start
        setIsAutocompletingChapter(false);
        setAutocompletionProgress(null);
        setCellsAutoCompleted(0);
        setTotalCellsToAutoComplete(0);
        setCurrentProcessingCellId(undefined);
        setCellsToProcess([]);
        
        // Small delay to ensure state reset completes
        setTimeout(() => {
            // Set state variables explicitly with debugging
            setIsAutocompletingChapter(true);
            console.log("Set isAutocompletingChapter to:", true);
            
            setTotalCellsToAutoComplete(cellsToAutocomplete.length);
            console.log("Set totalCellsToAutoComplete to:", cellsToAutocomplete.length);
            
            setCellsAutoCompleted(0);
            console.log("Set cellsAutoCompleted to:", 0);
            
            // Set the cells to process
            setCellsToProcess(cellIds);
            console.log("Set cellsToProcess to:", cellIds);
            
            // Starting with a small non-zero value helps ensure the bar is visible
            setAutocompletionProgress(0.01);
            console.log("Set autocompletionProgress to:", 0.01);
            
            // Set a safety timeout to reset the state if no other mechanism does it
            const maxTimePerCell = 30000; // 30 seconds per cell as maximum
            const safetyTimeout = setTimeout(() => {
                console.log("Safety timeout triggered, resetting autocompletion state");
                setIsAutocompletingChapter(false);
                setAutocompletionProgress(null);
                setCellsAutoCompleted(0);
                setTotalCellsToAutoComplete(0);
                setCurrentProcessingCellId(undefined);
                setCellsToProcess([]);
            }, Math.max(60000, cellsToAutocomplete.length * maxTimePerCell)); // At least 60 seconds or more based on cell count
            
            // Store the timeout ID in a ref so we can clear it if needed
            if (safetyTimeoutRef.current) {
                clearTimeout(safetyTimeoutRef.current);
            }
            safetyTimeoutRef.current = safetyTimeout;
            
            vscode.postMessage({
                command: "requestAutocompleteChapter",
                content: cellsToAutocomplete,
            } as EditorPostMessages);
            
            // Debug log after all state changes
            setTimeout(() => {
                console.log("State after handleAutocompleteChapter:", {
                    isAutocompletingChapter,
                    autocompletionProgress,
                    totalCellsToAutoComplete,
                    cellsAutoCompleted,
                    cellsToProcess: cellIds
                });
            }, 0);
        }, 10);
    };

    const handleStopAutocomplete = () => {
        console.log("Stopping autocomplete chapter");
        
        // Clear the safety timeout
        if (safetyTimeoutRef.current) {
            clearTimeout(safetyTimeoutRef.current);
            safetyTimeoutRef.current = null;
        }
        
        setIsAutocompletingChapter(false);
        setAutocompletionProgress(null);
        setCellsAutoCompleted(0);
        setTotalCellsToAutoComplete(0);
        setCurrentProcessingCellId(undefined);
        setCellsToProcess([]);
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

    // const handleCloseMetadataModal = () => {
    //     setTempVideoUrl(""); // Reset temp video URL when closing without saving
    //     setIsMetadataModalOpen(false);
    // };

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

    // Add a ref to track the overall completion state
    const completionStateRef = useRef<{
        hasCompleted: boolean;
        completionTimestamp: number | null;
    }>({
        hasCompleted: false,
        completionTimestamp: null
    });

    // Update the useEffect that monitors completion
    useEffect(() => {
        // As a backup mechanism, check if all cells have been completed
        if (totalCellsToAutoComplete > 0 && cellsAutoCompleted >= totalCellsToAutoComplete) {
            console.log("All cells completed via useEffect check, resetting autocompletion state");
            
            // Mark as completed to prevent re-showing notifications
            completionStateRef.current = {
                hasCompleted: true,
                completionTimestamp: Date.now()
            };
            
            // Add a slight delay to avoid conflicts with other state updates
            const timer = setTimeout(() => {
                // Only reset isAutocompletingChapter to avoid showing 0/0 notifications
                setIsAutocompletingChapter(false);
            }, 300);
            
            // Clean up the timer
            return () => clearTimeout(timer);
        }
    }, [cellsAutoCompleted, totalCellsToAutoComplete]);

    // Modify the server message handler
    useEffect(() => {
        // This is a backup listener for server messages
        const handleServerMessages = (event: MessageEvent) => {
            const message = event.data;
            
            // Look for completion signal
            if (message.type === "providerCompletesChapterAutocompletion") {
                console.log("EXPLICIT COMPLETION SIGNAL RECEIVED, forcing reset of autocompletion state");
                
                // Mark as completed
                completionStateRef.current = {
                    hasCompleted: true,
                    completionTimestamp: Date.now()
                };
                
                // Only mark as not autocompletingChapter, but preserve current progress values
                // This prevents the notification from re-appearing with 0/0
                setIsAutocompletingChapter(false);
            }
            
            // Also look for cell updates with progress data
            if (message.type === "providerUpdatesCell" && message.content?.progress) {
                const progress = message.content.progress;
                console.log(`Server progress update: ${progress * 100}%`);
                
                // Check if we've recently marked as completed
                const hasRecentlyCompleted = 
                    completionStateRef.current.hasCompleted && 
                    completionStateRef.current.completionTimestamp && 
                    (Date.now() - completionStateRef.current.completionTimestamp) < 10000;
                
                // If we've already completed, don't process these updates
                if (hasRecentlyCompleted) {
                    console.log("Ignoring server progress update - already completed");
                    return;
                }
                
                // If progress is at or near 100%, force reset
                if (progress >= 0.999) {
                    console.log("Server reports 100% progress, forcing reset");
                    
                    // Mark as completed
                    completionStateRef.current = {
                        hasCompleted: true,
                        completionTimestamp: Date.now()
                    };
                    
                    setTimeout(() => {
                        setIsAutocompletingChapter(false);
                    }, 300);
                }
            }
        };
        
        window.addEventListener("message", handleServerMessages);
        return () => window.removeEventListener("message", handleServerMessages);
    }, []);

    // Add a reference to store the last progress value and timestamp
    const lastProgressRef = useRef<{ value: number | null; timestamp: number }>({ 
        value: null, 
        timestamp: Date.now() 
    });

    // Add an interval check to detect if autocompletion gets stuck
    useEffect(() => {
        // Only start monitoring if autocomplete is in progress
        if (!isAutocompletingChapter) {
            return;
        }
        
        console.log("Starting progress monitoring interval");
        
        // Check every 5 seconds if progress has stalled
        const intervalId = setInterval(() => {
            const currentTime = Date.now();
            const progressRef = lastProgressRef.current;
            
            // If no progress updates for 15 seconds and we're still in autocomplete mode
            if (progressRef.value !== null && 
                currentTime - progressRef.timestamp > 15000 && 
                isAutocompletingChapter) {
                
                console.log("No progress updates for 15+ seconds, force resetting state");
                
                // Force reset all state
                setIsAutocompletingChapter(false);
                setAutocompletionProgress(null);
                setCellsAutoCompleted(0);
                setTotalCellsToAutoComplete(0);
            }
        }, 5000);
        
        return () => clearInterval(intervalId);
    }, [isAutocompletingChapter]);

    // Update the progress reference whenever autocompletionProgress changes
    useEffect(() => {
        if (autocompletionProgress !== null) {
            lastProgressRef.current = {
                value: autocompletionProgress,
                timestamp: Date.now()
            };
        }
    }, [autocompletionProgress]);

    // Add debug effect to monitor autocomplete state changes
    useEffect(() => {
        console.log("Autocomplete State:", {
            isAutocompletingChapter,
            autocompletionProgress,
            totalCellsToAutoComplete,
            cellsAutoCompleted
        });
    }, [isAutocompletingChapter, autocompletionProgress, totalCellsToAutoComplete, cellsAutoCompleted]);

    // Add a new useEffect to handle calculating completedCells based on cellsToProcess
    useEffect(() => {
        if (isAutocompletingChapter && totalCellsToAutoComplete > 0) {
            // Calculate completed cells based on the cells that have been removed from cellsToProcess
            const completed = totalCellsToAutoComplete - cellsToProcess.length;
            
            // Only update if the calculated value is different from the current value
            if (completed !== cellsAutoCompleted) {
                console.log(`Updating cellsAutoCompleted based on cellsToProcess: ${completed}/${totalCellsToAutoComplete}`);
                setCellsAutoCompleted(completed);
            }
        }
    }, [cellsToProcess, isAutocompletingChapter, totalCellsToAutoComplete]);

    // Also, add a better listener for server messages about cell updates
    // Add this useEffect after the other message handlers
    useEffect(() => {
        const handleCellUpdateMessages = (event: MessageEvent) => {
            const message = event.data;
            
            // Look specifically for cell updates with progress info
            if (message.type === "providerUpdatesCell" && message.content) {
                // Extract the data we need
                const { cellId, progress, newContent } = message.content;
                
                console.log(`📡 Cell update message received: ${cellId}, Progress: ${Math.round((progress || 0) * 100)}%`);
                
                // Check if we're already completed
                const hasRecentlyCompleted = 
                    completionStateRef.current.hasCompleted && 
                    completionStateRef.current.completionTimestamp && 
                    (Date.now() - completionStateRef.current.completionTimestamp) < 10000;
                
                if (hasRecentlyCompleted) {
                    console.log("Ignoring cell update - already completed");
                    return;
                }
                
                // Update currently processing cell ID
                if (cellId && cellId !== "initialization" && cellId !== "completion") {
                    setCurrentProcessingCellId(cellId);
                    
                    // Track completed cells
                    if (cellsToProcess.includes(cellId)) {
                        console.log(`✅ Direct message handler marking cell ${cellId} as completed`);
                        setCellsToProcess(prev => {
                            const updated = prev.filter(id => id !== cellId);
                            return updated;
                        });
                        
                        // Directly update completed cells count
                        setCellsAutoCompleted(prev => {
                            const newValue = prev + 1;
                            console.log(`📊 Direct handler - Completed cells: ${newValue}/${totalCellsToAutoComplete}`);
                            return newValue;
                        });
                    }
                }
                
                // If we're at 100% progress, mark as completed
                if (typeof progress === 'number' && progress >= 0.999) {
                    completionStateRef.current = {
                        hasCompleted: true,
                        completionTimestamp: Date.now()
                    };
                    
                    // Set a timeout to turn off the notification
                    setTimeout(() => {
                        setIsAutocompletingChapter(false);
                    }, 300);
                }
                // Otherwise update progress normally
                else if (typeof progress === 'number' && !hasRecentlyCompleted) {
                    setAutocompletionProgress(progress);
                    setIsAutocompletingChapter(true);
                }
            }
        };
        
        window.addEventListener("message", handleCellUpdateMessages);
        return () => window.removeEventListener("message", handleCellUpdateMessages);
    }, [cellsToProcess, totalCellsToAutoComplete]);

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
                    />
                </div>
            </div>
            <ProgressNotification 
                progress={autocompletionProgress}
                totalCells={totalCellsToAutoComplete}
                completedCells={cellsAutoCompleted}
                isVisible={isAutocompletingChapter}
                currentCellId={currentProcessingCellId}
            />
        </div>
    );
};

export default CodexCellEditor;
