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
import { CodexCellTypes } from "../../../../types/enums";
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

import {
    getCellValueData,
    cellHasAudioUsingAttachments,
    computeValidationStats,
    computeProgressPercents,
} from "@sharedUtils";
import { isValidValidationEntry } from "./validationUtils";
import "./TranslationAnimations.css";
import { CellTranslationState } from "./CellTranslationStyles";
import { getVSCodeAPI } from "../shared/vscodeApi";
import { Subsection, ProgressPercentages } from "../lib/types";
import { ABTestVariantSelector } from "./components/ABTestVariantSelector";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { WhisperTranscriptionClient, type AsrMeta } from "./WhisperTranscriptionClient";

// eslint-disable-next-line react-refresh/only-export-components
export enum CELL_DISPLAY_MODES {
    INLINE = "inline",
    ONE_LINE_PER_CELL = "one-line-per-cell",
}

const DEBUG_ENABLED = false; // todo: turn this on and clean up the functions that are getting called thousands of times, probably once per cell

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

const CodexCellEditor: React.FC = () => {
    const [translationUnits, setTranslationUnits] = useState<QuillCellContent[]>([]);
    const [alertColorCodes, setAlertColorCodes] = useState<{
        [cellId: string]: number;
    }>({});
    const [highlightedCellId, setHighlightedCellId] = useState<string | null>(null);
    const [isWebviewReady, setIsWebviewReady] = useState(false);
    const [scrollSyncEnabled, setScrollSyncEnabled] = useState(true);

    // State for tracking successful completions
    const [successfulCompletions, setSuccessfulCompletions] = useState<Set<string>>(new Set());

    // State for tracking translation queue
    const [translationQueue, setTranslationQueue] = useState<string[]>([]);
    const [singleCellQueueProcessingId, setSingleCellQueueProcessingId] = useState<
        string | undefined
    >();
    const [isProcessingCell, setIsProcessingCell] = useState(false);

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
    
    // Backtranslation inline display state
    const [showInlineBacktranslations, setShowInlineBacktranslations] = useState<boolean>(
        (window as any).initialData?.metadata?.showInlineBacktranslations || false
    );
    const [backtranslationsMap, setBacktranslationsMap] = useState<Map<string, any>>(new Map());

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
    // Validation configuration (required validations) – requested once and derived for children
    const [requiredValidations, setRequiredValidations] = useState<number | null>(
        (window as any)?.initialData?.validationCount ?? null
    );

    const [requiredAudioValidations, setRequiredAudioValidations] = useState<number | null>(
        (window as any)?.initialData?.validationCountAudio ?? null
    );

    // Track cells currently transcribing audio (to show the same loading effect as translations)
    const [transcribingCells, setTranscribingCells] = useState<Set<string>>(new Set());

    // Temporary font size for preview - only applied when dropdown is open
    const [tempFontSize, setTempFontSize] = useState<number | null>(null);

    // Add a state for bible book map
    const [bibleBookMap, setBibleBookMap] = useState<Map<string, BibleBookInfo> | undefined>(
        undefined
    );

    // Add these new state variables
    const [primarySidebarVisible, setPrimarySidebarVisible] = useState(true);
    const [fileStatus, setFileStatus] = useState<"dirty" | "syncing" | "synced" | "none">("none");
    const [isSaving, setIsSaving] = useState(false);
    const [saveError, setSaveError] = useState(false);
    const [saveRetryCount, setSaveRetryCount] = useState(0);
    const saveTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const SAVE_TIMEOUT_MS = 10000; // 10 seconds
    const MAX_SAVE_RETRIES = 3; // Maximum number of retry attempts
    const [editorPosition, setEditorPosition] = useState<
        "leftmost" | "rightmost" | "center" | "single" | "unknown"
    >("unknown");
    const [currentSubsectionIndex, setCurrentSubsectionIndex] = useState(0);

    // Add audio attachments state
    const [audioAttachments, setAudioAttachments] = useState<{
        [cellId: string]:
            | "available"
            | "available-local"
            | "available-pointer"
            | "deletedOnly"
            | "none"
            | "missing";
    }>({});

    // Add cells per page configuration
    const [cellsPerPage] = useState<number>((window as any).initialData?.cellsPerPage || 50);

    // Add correction editor mode state
    const [isCorrectionEditorMode, setIsCorrectionEditorMode] = useState<boolean>(false);

    // A/B testing state
    const [abTestState, setAbTestState] = useState<{
        isActive: boolean;
        variants: string[];
        cellId: string;
        testId: string;
        names?: string[];
        winRates?: any;
        abProbability?: number;
    }>({
        isActive: false,
        variants: [],
        cellId: "",
        testId: "",
    });

    // Acquire VS Code API once at component initialization
    const vscode = useMemo(() => getVSCodeAPI(), []);

    // Batch transcription handler
    useMessageHandler(
        "codexCellEditor-startBatchTranscription",
        (event: MessageEvent) => {
            const message = event.data as EditorReceiveMessages;
            if (message.type !== "startBatchTranscription") return;
            const run = async () => {
                try {
                    // Fetch ASR config
                    const asrConfig = await new Promise<{
                        endpoint: string;
                        provider: string;
                        model: string;
                        language: string;
                        phonetic: boolean;
                        authToken?: string;
                    }>((resolve, reject) => {
                        let resolved = false;
                        const onMsg = (ev: MessageEvent) => {
                            if (ev.data?.type === "asrConfig") {
                                window.removeEventListener("message", onMsg);
                                resolved = true;
                                const config = ev.data.content;
                                console.log(`[BatchTranscription] Received ASR config: endpoint=${config.endpoint}, hasToken=${!!config.authToken}`);
                                resolve(config);
                            }
                        };
                        window.addEventListener("message", onMsg);
                        vscode.postMessage({ command: "getAsrConfig" });
                        setTimeout(() => {
                            if (!resolved) {
                                window.removeEventListener("message", onMsg);
                                // Reject instead of using hardcoded fallback - let backend provide endpoint
                                reject(
                                    new Error(
                                        "Timeout waiting for ASR config from backend. Please check your ASR settings."
                                    )
                                );
                            }
                        }, 5000);
                    });

                    const toIso3 = (code?: string) => {
                        const ISO2_TO_ISO3: Record<string, string> = {
                            en: "eng",
                            fr: "fra",
                            es: "spa",
                            de: "deu",
                            pt: "por",
                            it: "ita",
                            nl: "nld",
                            ru: "rus",
                            zh: "zho",
                            ja: "jpn",
                            ko: "kor",
                        };
                        if (!code) return "eng";
                        const norm = code.toLowerCase();
                        return norm.length === 2 ? ISO2_TO_ISO3[norm] ?? "eng" : norm;
                    };

                    const wsEndpoint =
                        asrConfig.endpoint ||
                        "wss://ryderwishart--asr-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe";

                    const targetCount = Math.max(0, message.content.count | 0);
                    const specificCellId: string | undefined = (message as any)?.content?.cellId;
                    let completed = 0;
                    for (const unit of translationUnits) {
                        if (targetCount > 0 && completed >= targetCount) break;
                        const cellId = unit.cellMarkers[0];
                        if (specificCellId && cellId !== specificCellId) {
                            continue; // Only transcribe the requested cell
                        }
                        // Quick skip if we know there's no audio
                        if (audioAttachments && audioAttachments[cellId] === "none") {
                            continue;
                        }
                        // Request audio for cell
                        const audioInfo = await new Promise<{
                            audioData: string | null;
                            hasTranscription: boolean;
                        }>((resolve) => {
                            let resolved = false;
                            const handler = (ev: MessageEvent) => {
                                if (
                                    ev.data?.type === "providerSendsAudioData" &&
                                    ev.data.content?.cellId === cellId
                                ) {
                                    window.removeEventListener("message", handler);
                                    resolved = true;
                                    resolve({
                                        audioData: ev.data.content.audioData || null,
                                        hasTranscription: !!ev.data.content.transcription,
                                    });
                                }
                            };
                            window.addEventListener("message", handler);
                            vscode.postMessage({
                                command: "requestAudioForCell",
                                content: { cellId },
                            } as EditorPostMessages);
                            // Timeout after 5s
                            setTimeout(() => {
                                if (!resolved) {
                                    window.removeEventListener("message", handler);
                                    resolve({ audioData: null, hasTranscription: false });
                                }
                            }, 5000);
                        });
                        if (!audioInfo.audioData) continue; // no audio to transcribe
                        if (audioInfo.hasTranscription) continue; // already transcribed

                        // Convert data URL to Blob
                        const blob = await (await fetch(audioInfo.audioData)).blob();

                        // Build meta
                        const mime = blob.type || "audio/webm";
                        const provider = (asrConfig.provider || "mms").toLowerCase();
                        let meta: AsrMeta = { type: "meta", mime };
                        if (provider === "mms") {
                            meta = {
                                type: "meta",
                                provider: "mms",
                                model: asrConfig.model || "facebook/mms-1b-all",
                                mime,
                                language: toIso3(asrConfig.language || "eng"),
                                task: "transcribe",
                                phonetic: !!asrConfig.phonetic,
                            };
                        }

                        // Transcribe
                        console.log(`[BatchTranscription] Creating client for cell ${cellId}: endpoint=${wsEndpoint}, hasToken=${!!asrConfig.authToken}`);
                        const client = new WhisperTranscriptionClient(
                            wsEndpoint,
                            asrConfig.authToken
                        );
                        try {
                            // Mark cell as transcribing for UI feedback
                            setTranscribingCells((prev) => {
                                const next = new Set(prev);
                                next.add(cellId);
                                return next;
                            });
                            const result = await client.transcribe(blob, meta, 30000);
                            const text = (result.text || "").trim();
                            if (text) {
                                vscode.postMessage({
                                    command: "updateCellAfterTranscription",
                                    content: {
                                        cellId,
                                        transcribedText: text,
                                        language: result.language || "unknown",
                                    },
                                } as unknown as EditorPostMessages);

                                // If editing a source file, also update the cell's main text content
                                if (isSourceText) {
                                    // Insert transcription with a subtle visual cue (reduced opacity)
                                    const html = `<span data-transcription="true" style="opacity:0.6" title="Transcription">${text}</span>`;
                                    vscode.postMessage({
                                        command: "saveHtml",
                                        content: {
                                            cellMarkers: [cellId],
                                            cellContent: html,
                                            cellChanged: true,
                                        },
                                    } as unknown as EditorPostMessages);
                                }
                                completed += 1;
                            }
                        } catch (err) {
                            console.error("Batch transcription failed for", cellId, err);
                            vscode.postMessage({
                                command: "showErrorMessage",
                                text: `Transcription failed for ${cellId}: ${
                                    err instanceof Error ? err.message : String(err)
                                }`,
                            } as any);
                        } finally {
                            // Clear transcribing state for this cell
                            setTranscribingCells((prev) => {
                                const next = new Set(prev);
                                next.delete(cellId);
                                return next;
                            });
                        }
                    }
                } catch (e) {
                    console.error("Error during batch transcription:", e);
                }
            };
            run();
        },
        [translationUnits, vscode]
    );

    // Handle local UI messages about single-cell transcription state from editors
    useMessageHandler(
        "codexCellEditor-transcriptionState",
        (event: MessageEvent) => {
            const message = event.data;
            if (message?.type === "transcriptionState" && message?.content?.cellId) {
                const { cellId, inProgress } = message.content as {
                    cellId: string;
                    inProgress: boolean;
                };
                setTranscribingCells((prev) => {
                    const next = new Set(prev);
                    if (inProgress) next.add(cellId);
                    else next.delete(cellId);
                    return next;
                });
            }
        },
        []
    );

    // A/B test variant selection handler
    const handleVariantSelected = (selectedIndex: number, selectionTimeMs: number) => {
        if (!abTestState.isActive) return;

        const selectedVariant = abTestState.variants[selectedIndex];
        debug("ab-test", `User selected variant ${selectedIndex}:`, selectedVariant);

        // Apply the selected variant
        applyVariantToCell(
            abTestState.cellId,
            selectedVariant,
            abTestState.testId,
            selectedIndex,
            abTestState.variants.length,
            selectionTimeMs
        );

        // Casual confirmation with variant name if available
        const variantName = (abTestState as any).names?.[selectedIndex];
        if (variantName) {
            vscode.postMessage({
                command: "showInfo",
                text: `Applied translation from ${variantName}.`,
            } as any);
        }

        // Keep A/B modal open to show names and stats; user can close manually
        // Do not allow re-vote (selector component already blocks further clicks)
    };

    const handleDismissABTest = () => {
        debug("ab-test", "A/B test dismissed");
        setAbTestState({
            isActive: false,
            variants: [],
            cellId: "",
            testId: "",
        });
    };

    // Helper function to apply a variant to a cell
    const applyVariantToCell = (
        cellId: string,
        variant: string,
        testId: string | undefined,
        selectedIndex: number,
        totalVariants: number,
        selectionTimeMs: number = 0
    ) => {
        debug("ab-test", `Applying variant ${selectedIndex} to cell ${cellId}:`, variant);

        // Update the translation units with the selected variant
        setTranslationUnits((prevUnits) =>
            prevUnits.map((unit) =>
                unit.cellMarkers[0] === cellId
                    ? {
                          ...unit,
                          cellContent: variant,
                          cellLabel: unit.cellLabel,
                      }
                    : unit
            )
        );

        // If this is the cell currently being edited, update contentBeingUpdated too
        if (contentBeingUpdated.cellMarkers?.[0] === cellId) {
            debug("ab-test", `Updating contentBeingUpdated for currently editing cell: ${cellId}`);
            setContentBeingUpdated((prev) => ({
                ...prev,
                cellContent: variant,
                cellChanged: true,
            }));
        }

        // If this is the cell we're currently processing, reset processing state
        if (cellId === singleCellQueueProcessingId) {
            debug("ab-test", `Translation completed for processing cell: ${cellId}`);
            setSingleCellQueueProcessingId(undefined);
            setIsProcessingCell(false);
        }

        // Add to successful completions
        setSuccessfulCompletions((prev) => {
            const newSet = new Set(prev);
            newSet.add(cellId);
            return newSet;
        });

        // Send feedback to backend about the selection
        if (testId) {
            vscode.postMessage({
                command: "selectABTestVariant",
                content: {
                    cellId,
                    selectedIndex,
                    testId,
                    selectionTimeMs: selectionTimeMs || 0,
                    names: (abTestState as any).names,
                },
            } as unknown as EditorPostMessages);
        }
    };

    // Initialize state store after webview is ready
    useMessageHandler(
        "codexCellEditor-webviewReady",
        (event: MessageEvent) => {
            if (event.data.type === "webviewReady") {
                debug("init", "Webview is ready");
                setIsWebviewReady(true);
            }
        },
        []
    );

    // Listen for highlight messages from the extension
    useMessageHandler(
        "codexCellEditor-highlightAndValidation",
        (event: MessageEvent) => {
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

            // Handle correction editor mode changes from provider
            if (message.type === "correctionEditorModeChanged") {
                setIsCorrectionEditorMode(message.enabled);
            }

            // Handle metadata refresh requests (font size, text direction, etc.)
            if (message.type === "refreshFontSizes" || message.type === "refreshMetadata") {
                // Clear temporary font size to ensure new metadata takes effect
                setTempFontSize(null);
                // Request updated content to get the new font sizes and metadata
                vscode.postMessage({ command: "getContent" } as EditorPostMessages);
            }
        },
        [vscode]
    );

    // Handle batch backtranslations response
    useMessageHandler(
        "codexCellEditor-batchBacktranslations",
        (event: MessageEvent) => {
            const message = event.data as EditorReceiveMessages;
            if (message.type === "providerSendsBatchBacktranslations") {
                const newMap = new Map(backtranslationsMap);
                Object.entries(message.content).forEach(([cellId, backtranslation]) => {
                    newMap.set(cellId, backtranslation);
                });
                setBacktranslationsMap(newMap);
            }
        },
        [backtranslationsMap]
    );

    // Handle individual backtranslation updates (created/edited)
    useMessageHandler(
        "codexCellEditor-backtranslationUpdate",
        (event: MessageEvent) => {
            const message = event.data as EditorReceiveMessages;
            if (
                message.type === "providerSendsBacktranslation" ||
                message.type === "providerSendsUpdatedBacktranslation" ||
                message.type === "providerSendsExistingBacktranslation"
            ) {
                if (message.content && message.content.cellId) {
                    const newMap = new Map(backtranslationsMap);
                    newMap.set(message.content.cellId, message.content);
                    setBacktranslationsMap(newMap);
                }
            }
        },
        [backtranslationsMap]
    );

    // Fetch backtranslations when toggle is enabled or visible cells change
    useEffect(() => {
        if (showInlineBacktranslations && translationUnits.length > 0) {
            const cellIds = translationUnits
                .filter((cell) => cell.cellMarkers && cell.cellMarkers.length > 0)
                .map((cell) => cell.cellMarkers[0]);
            
            if (cellIds.length > 0) {
                vscode.postMessage({
                    command: "getBatchBacktranslations",
                    content: { cellIds },
                } as EditorPostMessages);
            }
        }
    }, [showInlineBacktranslations, translationUnits, vscode]);

    // Toggle inline backtranslations
    const toggleInlineBacktranslations = useCallback(() => {
        const newValue = !showInlineBacktranslations;
        setShowInlineBacktranslations(newValue);
        
        // Update metadata in the backend
        vscode.postMessage({
            command: "updateNotebookMetadata",
            content: { showInlineBacktranslations: newValue },
        } as EditorPostMessages);
    }, [showInlineBacktranslations, vscode]);

    // Listen for validation count updates (initial value comes bundled with content)
    useMessageHandler(
        "codexCellEditor-validationConfig",
        (event: MessageEvent) => {
            const message = event.data;
            if (message?.type === "validationCount") {
                setRequiredValidations(message.content);
            }
            if (message?.type === "validationCountAudio") {
                setRequiredAudioValidations(message.content);
            }
            if (message?.type === "configurationChanged") {
                // Configuration changes now send validationCount directly, no need to re-request
                console.log("Configuration changed - validation count will be sent directly");
            }
        },
        []
    );

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
            const shouldAutoNavigate =
                (!hasManuallyNavigatedAway || isNewHighlight) &&
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

    // useEffect(() => {
    // // TODO: we are removing spell check for now until someone needs it
    //     checkAlertCodes();
    // }, [translationUnits]);

    // Clear successful completions after a delay when all translations are complete
    useEffect(() => {
        const noActiveTranslations =
            translationQueue.length === 0 &&
            !singleCellQueueProcessingId &&
            !autocompletionState.currentCellId;

        if (noActiveTranslations && successfulCompletions.size > 0) {
            debug("translation", "All translations complete, scheduling border clear");

            // Clear the successful completions after 1.5 seconds to hide the green borders
            const timer = setTimeout(() => {
                debug("translation", "Clearing successful completions");
                setSuccessfulCompletions(new Set());
            }, 1500);

            return () => clearTimeout(timer);
        }
    }, [
        translationQueue,
        singleCellQueueProcessingId,
        autocompletionState.currentCellId,
        successfulCompletions,
    ]);

    useVSCodeMessageHandler({
        setContent: (
            content: QuillCellContent[],
            isSourceText: boolean,
            sourceCellMap: { [k: string]: { content: string; versions: string[] } }
        ) => {
            setTranslationUnits(content);
            setIsSourceText(isSourceText);
            setSourceCellMap(sourceCellMap);

            // If we're currently saving, this content update likely means the save completed
            if (isSaving) {
                debug("editor", "Content updated during save - save completed");

                // Clear the timeout timer
                if (saveTimeoutRef.current) {
                    clearTimeout(saveTimeoutRef.current);
                    saveTimeoutRef.current = null;
                }

                // Reset save state
                setIsSaving(false);
                setSaveError(false);
                setSaveRetryCount(0);
                handleCloseEditor();
            }
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

        updateSingleCellQueueState: (state) => {
            // Always update the queue with the latest state from the provider
            setTranslationQueue(state.cellsToProcess);
            setSingleCellQueueProcessingId(state.currentCellId);
            setIsProcessingCell(state.isProcessing);
        },

        updateCellTranslationCompletion: (
            cellId: string,
            success: boolean,
            cancelled?: boolean,
            error?: string
        ) => {
            debug(
                "translation",
                `Cell ${cellId} translation completion: success=${success}, cancelled=${cancelled}, error=${error}`
            );

            if (success) {
                // Cell completed successfully - add to successful completions
                debug("translation", `Cell ${cellId} completed successfully`);
                setSuccessfulCompletions((prev) => {
                    const newSet = new Set(prev);
                    newSet.add(cellId);
                    return newSet;
                });
            } else if (cancelled) {
                // Cell was cancelled - make sure it's not in successful completions
                debug("translation", `Cell ${cellId} was cancelled`);
                setSuccessfulCompletions((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(cellId);
                    return newSet;
                });
            } else if (error) {
                // Cell had an error - make sure it's not in successful completions
                debug("translation", `Cell ${cellId} had error: ${error}`);
                setSuccessfulCompletions((prev) => {
                    const newSet = new Set(prev);
                    newSet.delete(cellId);
                    return newSet;
                });
            }
        },

        updateTextDirection: (direction) => {
            setTextDirection(direction);
        },
        updateNotebookMetadata: (newMetadata) => {
            setMetadata(newMetadata);
            // Clear temporary font size when metadata updates to ensure new font size takes effect
            setTempFontSize(null);
            // Update text direction when metadata changes (for global text direction updates)
            if (newMetadata.textDirection) {
                setTextDirection(newMetadata.textDirection);
            }
        },
        updateVideoUrl: (url: string) => {
            setTempVideoUrl(url);
        },
        setAlertColorCodes: setAlertColorCodes,
        recheckAlertCodes: () => {
            // checkAlertCodes(); // TODO: we are removing spell check for now until someone needs it
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
        showABTestVariants: (data) => {
            const { variants, cellId, testId, names, abProbability } = data as any;
            const count = Array.isArray(variants) ? variants.length : 0;
            debug("ab-test", "Received A/B test variants:", { cellId, count });

            if (!Array.isArray(variants) || count === 0 || !cellId) return;

            // Determine if all variants are effectively identical (normalize whitespace)
            const norm = (s: string) => (s || "").replace(/\s+/g, " ").trim();
            const allIdentical = variants.every((v: string) => norm(v) === norm(variants[0]));

            if (count > 1 && !allIdentical) {
                // Show A/B selector UI
                setAbTestState({ isActive: true, variants, cellId, testId, names, abProbability });
                return;
            }

            // Otherwise, auto-apply first variant quietly (no modal)
            applyVariantToCell(cellId, variants[0], testId, 0, count);
        },
    });

    useEffect(() => {
        vscode.postMessage({ command: "getContent" } as EditorPostMessages);
        setIsSourceText((window as any).initialData?.isSourceText || false);
        setVideoUrl((window as any).initialData?.videoUrl || "");
        setMetadata((window as any).initialData?.metadata || {});
        setIsCorrectionEditorMode((window as any).initialData?.isCorrectionEditorMode || false);

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

    // Helper function to get global line number for a cell (skips paratext and child cells)
    const getGlobalLineNumber = (cell: QuillCellContent, allUnits: QuillCellContent[]): number => {
        const cellIndex = allUnits.findIndex((unit) => unit.cellMarkers[0] === cell.cellMarkers[0]);

        if (cellIndex === -1) return 0;

        // Count non-paratext, non-child cells up to and including this one
        let lineNumber = 0;
        for (let i = 0; i <= cellIndex; i++) {
            const cellIdParts = allUnits[i].cellMarkers[0].split(":");
            if (allUnits[i].cellType !== CodexCellTypes.PARATEXT && cellIdParts.length < 3) {
                lineNumber++;
            }
        }

        return lineNumber;
    };

    // Helper function to check if a paratext cell belongs to a chapter/section
    const isParatextForChapter = (cell: QuillCellContent, chapterNum: number): boolean => {
        if (cell.cellType !== CodexCellTypes.PARATEXT) return false;

        const cellId = cell.cellMarkers[0];
        const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
        const sectionCellNumber = sectionCellIdParts?.[0];
        return sectionCellNumber === chapterNum.toString();
    };

    // Add function to get subsections for a chapter based on content cells (excluding paratext)
    const getSubsectionsForChapter = (chapterNum: number) => {
        // Filter cells for the specific chapter
        const cellsForChapter = translationUnits.filter((verse) => {
            const cellId = verse?.cellMarkers?.[0];
            const sectionCellIdParts = cellId?.split(" ")?.[1]?.split(":");
            const sectionCellNumber = sectionCellIdParts?.[0];
            return sectionCellNumber === chapterNum.toString();
        });

        if (cellsForChapter.length === 0) {
            return [];
        }

        // Filter out only source/target content cells (non-paratext) for pagination counting
        const contentCells = cellsForChapter.filter((cell) => {
            return cell.cellType !== "paratext";
        });

        // If content cells fit in one page, no subsections needed
        if (contentCells.length <= cellsPerPage) {
            return [];
        }

        // Calculate number of pages based on content cells
        const totalPages = Math.ceil(contentCells.length / cellsPerPage);
        const subsections: Subsection[] = [];

        for (let i = 0; i < totalPages; i++) {
            const startContentIndex = i * cellsPerPage;
            const endContentIndex = Math.min((i + 1) * cellsPerPage, contentCells.length);

            // Get the range of content cells for this page
            const pageContentCells = contentCells.slice(startContentIndex, endContentIndex);
            const firstContentCell = pageContentCells[0];
            const lastContentCell = pageContentCells[pageContentCells.length - 1];

            // Create a generic label based on cell position/index rather than specific ID format
            const startCellNumber = startContentIndex + 1; // 1-based indexing
            const endCellNumber = endContentIndex;

            // Find the positions of the first and last content cells in the full chapter
            const firstContentPosition = cellsForChapter.findIndex(
                (cell) => cell.cellMarkers[0] === firstContentCell.cellMarkers[0]
            );
            const lastContentPosition = cellsForChapter.findIndex(
                (cell) => cell.cellMarkers[0] === lastContentCell.cellMarkers[0]
            );

            // Get the content cell IDs for this page for quick lookup
            const contentCellIds = new Set(pageContentCells.map((cell) => cell.cellMarkers[0]));

            // Find the actual start and end indices by expanding to include related paratext cells
            let startCellIndex = firstContentPosition;
            let endCellIndex = lastContentPosition + 1;

            // Special handling for the first page: include all leading paratext
            if (i === 0) {
                // For the first page, start from the beginning to capture all leading paratext
                startCellIndex = 0;
            } else {
                // For subsequent pages, expand backward to include any paratext cells
                while (startCellIndex > 0) {
                    const prevCell = cellsForChapter[startCellIndex - 1];

                    // Include if it's paratext for this chapter
                    if ((prevCell.cellType as string) === "paratext") {
                        startCellIndex--;
                        continue;
                    }

                    // Stop expanding if we hit another content cell that's not on this page
                    if (
                        (prevCell.cellType as string) !== "paratext" &&
                        !contentCellIds.has(prevCell.cellMarkers[0])
                    ) {
                        break;
                    }

                    startCellIndex--;
                }
            }

            // Expand forward to include any paratext cells that should be with the last content cell
            while (endCellIndex < cellsForChapter.length) {
                const nextCell = cellsForChapter[endCellIndex];

                // Include if it's paratext for this chapter
                if ((nextCell.cellType as string) === "paratext") {
                    endCellIndex++;
                    continue;
                }

                // Stop expanding if we hit another content cell that's not on this page
                if (
                    (nextCell.cellType as string) !== "paratext" &&
                    !contentCellIds.has(nextCell.cellMarkers[0])
                ) {
                    break;
                }

                endCellIndex++;
            }

            subsections.push({
                id: `page-${i}`,
                label: `${startCellNumber}-${endCellNumber}`,
                startIndex: startCellIndex,
                endIndex: endCellIndex,
            });
        }

        return subsections;
    };

    const totalChapters = calculateTotalChapters(translationUnits);

    // Calculate progress for each chapter based on translation and validation status
    const calculateChapterProgress = useCallback(
        (chapterNum: number): ProgressPercentages => {
            // Filter cells for the specific chapter (excluding paratext and merged cells)
            const cellsForChapter = translationUnits.filter((cell) => {
                const cellId = cell?.cellMarkers?.[0];
                if (!cellId || cellId.startsWith("paratext-") || cell.merged) {
                    return false;
                }
                const sectionCellIdParts = cellId.split(" ")?.[1]?.split(":");
                const sectionCellNumber = sectionCellIdParts?.[0];
                return sectionCellNumber === chapterNum.toString();
            });

            const totalCells = cellsForChapter.length;
            if (totalCells === 0) {
                return {
                    percentTranslationsCompleted: 0,
                    percentAudioTranslationsCompleted: 0,
                    percentFullyValidatedTranslations: 0,
                    percentAudioValidatedTranslations: 0,
                    percentTextValidatedTranslations: 0,
                };
            }

            // Count cells with content (translated)
            const cellsWithValues = cellsForChapter.filter(
                (cell) =>
                    cell.cellContent &&
                    cell.cellContent.trim().length > 0 &&
                    cell.cellContent !== "<span></span>"
            ).length;

            const cellsWithAudioValues = cellsForChapter.filter((cell) =>
                cellHasAudioUsingAttachments(
                    (cell as any).attachments,
                    (cell as any).metadata?.selectedAudioId
                )
            ).length;

            // Calculate validation data using the same logic as navigation provider
            const cellWithValidatedData = cellsForChapter.map((cell) => getCellValueData(cell));

            const minimumValidationsRequired = requiredValidations ?? 1;
            const minimumAudioValidationsRequired = requiredAudioValidations ?? 1;

            const { validatedCells, audioValidatedCells, fullyValidatedCells } =
                computeValidationStats(
                    cellWithValidatedData,
                    minimumValidationsRequired,
                    minimumAudioValidationsRequired
                );

            return computeProgressPercents(
                totalCells,
                cellsWithValues,
                cellsWithAudioValues,
                validatedCells,
                audioValidatedCells,
                fullyValidatedCells
            );
        },
        [translationUnits, requiredValidations, requiredAudioValidations]
    );

    // Calculate progress for all chapters
    const allChapterProgress = useMemo(() => {
        const progress: Record<number, ProgressPercentages> = {};
        for (let i = 1; i <= totalChapters; i++) {
            progress[i] = calculateChapterProgress(i);
        }
        return progress;
    }, [calculateChapterProgress, totalChapters]);

    // Get all cells for the current chapter first
    const allCellsForChapter = translationUnits.filter((verse) => {
        const cellId = verse?.cellMarkers?.[0];

        // Handle paratext cells specially - they should be included based on context
        if (cellId?.startsWith("paratext-")) {
            // For now, include all paratext cells when viewing any chapter
            // This ensures leading paratext (like the Tigrinya intro) is visible
            return true;
        }

        // For regular cells, check if they belong to the current chapter
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

        // No-op: provider proactively updates audio attachments; do not request here
    };

    const handleSaveHtml = () => {
        // Avoid sending a stale/mismatched uri from contentBeingUpdated.
        // Not doing this causes a warning in the console when saving timestamps
        // or cell labels.
        const { uri, ...rest } = contentBeingUpdated;
        const content = rest as EditorCellContent;
        const cellId = content.cellMarkers?.[0];
        const isRetry = saveError;
        const currentRetryCount = isRetry ? saveRetryCount : 0;

        debug("editor", "Saving HTML content:", {
            cellId,
            isRetry,
            retryCount: currentRetryCount,
            content,
        });

        // Check if we've exceeded max retries
        if (isRetry && currentRetryCount >= MAX_SAVE_RETRIES) {
            debug("editor", "Maximum save retries exceeded", {
                cellId,
                retryCount: currentRetryCount,
            });
            // Show a more permanent error state but still allow manual retry
            vscode.postMessage({
                command: "showErrorMessage",
                text: `Save failed after ${MAX_SAVE_RETRIES} attempts.`,
            } as EditorPostMessages);
            return;
        }

        // Clear any existing timeout
        if (saveTimeoutRef.current) {
            clearTimeout(saveTimeoutRef.current);
        }

        // Reset error state and show saving spinner
        setSaveError(false);
        setIsSaving(true);

        // Start timeout timer
        saveTimeoutRef.current = setTimeout(() => {
            debug("editor", "Save operation timed out", { cellId, attempt: currentRetryCount + 1 });
            setIsSaving(false);
            setSaveError(true);
            setSaveRetryCount((prev) => prev + 1);
        }, SAVE_TIMEOUT_MS);

        vscode.postMessage({
            command: "saveHtml",
            content: content,
        } as EditorPostMessages);
        checkAlertCodes();
    };

    // State for current user - initialize with a default test username to ensure logic works
    const [username, setUsername] = useState<string | null>("test-user");

    // Fetch username from extension and add extensive debugging
    useEffect(() => {
        debug("auth", "Setting up username listener and requesting username");
        // Username now comes bundled with initial content, no separate request needed
        debug("auth", "Username will be provided with initial content");
    }, [vscode]); // Only run this once with vscode reference as the dependency

    useMessageHandler(
        "codexCellEditor-username",
        (event: MessageEvent) => {
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
        },
        []
    );

    // Handle bundled metadata from initial content (username and validation count)
    useMessageHandler(
        "codexCellEditor-bundledMetadata",
        (event: MessageEvent) => {
            if (event.data.type === "providerSendsInitialContent") {
                if (event.data.username !== undefined) {
                    setUsername(event.data.username);
                }
                if (event.data.validationCount !== undefined) {
                    setRequiredValidations(event.data.validationCount);
                }
                if (event.data.validationCountAudio !== undefined) {
                    setRequiredAudioValidations(event.data.validationCountAudio);
                }
            }
        },
        []
    );

    // Cleanup save timeout on unmount
    useEffect(() => {
        return () => {
            if (saveTimeoutRef.current) {
                clearTimeout(saveTimeoutRef.current);
            }
        };
    }, []);

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
            const hasNoContent = isCellContentEmpty(unit.cellContent);
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
            const hasNoContent = isCellContentEmpty(unit.cellContent);

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
            const hasNoContent = isCellContentEmpty(unit.cellContent);

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
            if (isCellContentEmpty(unit.cellContent)) {
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
                    return !isCellContentEmpty(unit.cellContent);
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
                if (isCellContentEmpty(unit.cellContent)) {
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
    useEffect(() => {
        const styleElement = document.createElement("style");
        // Use temporary font size if available, otherwise use metadata font size
        const currentFontSize = tempFontSize !== null ? tempFontSize : metadata?.fontSize || 14;
        styleElement.textContent = `
            .ql-editor {
                direction: ${textDirection} !important;
                text-align: ${textDirection === "rtl" ? "right" : "left"} !important;
                font-size: ${currentFontSize}px !important;
            }
        `;
        document.head.appendChild(styleElement);

        return () => {
            // Clean up the style element when component unmounts or dependencies change
            if (styleElement.parentNode) {
                styleElement.parentNode.removeChild(styleElement);
            }
        };
    }, [textDirection, metadata?.fontSize, tempFontSize]);

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

    // Handler for temporary font size changes (for preview)
    const handleTempFontSizeChange = (fontSize: number) => {
        setTempFontSize(fontSize);
    };

    // Handler for when dropdown closes - save the font size to metadata
    const handleFontSizeSave = (fontSize: number) => {
        setTempFontSize(null); // Clear temporary font size
        handleMetadataChange("fontSize", fontSize.toString());

        // Save the metadata with local source marking
        const updatedMetadata = { ...metadata, fontSize, fontSizeSource: "local" };
        vscode.postMessage({
            command: "updateNotebookMetadata",
            content: updatedMetadata,
        } as EditorPostMessages);
    };

    const [headerHeight, setHeaderHeight] = useState(0);
    const [windowHeight, setWindowHeight] = useState(window.innerHeight);
    const headerRef = useRef<HTMLDivElement>(null);
    const navigationRef = useRef<HTMLDivElement>(null);
    const videoPlayerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const measureHeights = () => {
            const headerOffset = headerRef.current?.offsetHeight || 0;
            const videoOffset =
                shouldShowVideoPlayer && videoPlayerRef.current
                    ? videoPlayerRef.current.offsetHeight
                    : 0;
            setHeaderHeight(headerOffset + videoOffset);
        };

        const handleResize = () => {
            setWindowHeight(window.innerHeight);
            measureHeights();
        };

        const resizeObserver = new ResizeObserver(() => {
            measureHeights();
        });

        if (headerRef.current) resizeObserver.observe(headerRef.current);
        if (videoPlayerRef.current) resizeObserver.observe(videoPlayerRef.current);

        window.addEventListener("resize", handleResize);
        // Initial measurement after mount
        measureHeights();

        return () => {
            window.removeEventListener("resize", handleResize);
            resizeObserver.disconnect();
        };
    }, [shouldShowVideoPlayer]);

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
                unitsWithNoContent: translationUnitsForSection.filter((unit) =>
                    isCellContentEmpty(unit.cellContent)
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

    // No-op: provider proactively sends audio attachment status; no fallback request from webview

    // Simplify sparkle button handler to work with provider state
    const handleSparkleButtonClick = (cellId: string) => {
        // Check that the cell ID is valid
        if (!cellId || cellId.trim() === "") {
            return;
        }

        // Send directly to backend - let backend handle all queue management
        vscode.postMessage({
            command: "llmCompletion",
            content: {
                currentLineId: cellId,
                addContentToValue: true,
            },
        } as EditorPostMessages);
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
        // Use the new robust message to stop single cell translations
        // This will handle both the new queue system and the legacy system
        vscode.postMessage({
            command: "stopSingleCellTranslation",
        } as EditorPostMessages);
    }, [vscode]);

    // Modify the existing code to expose this function
    useEffect(() => {
        // Make the sparkle button handler available to the CellList component
        (window as any).handleSparkleButtonClick = handleSparkleButtonClick;

        // Also make the error handler available
        (window as any).handleTranslationError = handleTranslationError;
    }, [handleTranslationError]);

    // Removed frontend stuck translation monitoring - backend handles this

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
                    !isCellContentEmpty(cell.cellContent)
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
    useMessageHandler(
        "codexCellEditor-bibleBookMap",
        (event: MessageEvent) => {
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
        },
        []
    );

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
    useMessageHandler(
        "codexCellEditor-editorPosition",
        (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "editorPosition") {
                setEditorPosition(message.position);
            }
            if (message.type === "updateFileStatus") {
                setFileStatus(message.status);
            }
        },
        []
    );

    if (duplicateCellsExist) {
        return (
            <DuplicateCellResolver
                translationUnits={translationUnits}
                textDirection={textDirection}
                vscode={vscode}
                lineNumbersEnabled={metadata?.lineNumbersEnabled ?? true}
            />
        );
    }

    return (
        <div
            className="cell-editor-container max-w-full overflow-hidden"
            style={{ direction: textDirection as any }}
        >
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
                <div
                    className="static-header bg-background shadow-md"
                    ref={headerRef}
                    style={{ position: "sticky", top: 0, zIndex: 1000 }}
                >
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
                                // Save the text direction with local source marking (similar to font size)
                                const updatedMetadata = {
                                    ...metadata,
                                    textDirection: direction,
                                    textDirectionSource: "local",
                                };
                                vscode.postMessage({
                                    command: "updateNotebookMetadata",
                                    content: updatedMetadata,
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
                            showInlineBacktranslations={showInlineBacktranslations}
                            onToggleInlineBacktranslations={toggleInlineBacktranslations}
                            getSubsectionsForChapter={getSubsectionsForChapter}
                            editorPosition={editorPosition}
                            fileStatus={fileStatus}
                            onTriggerSync={handleTriggerSync}
                            isCorrectionEditorMode={isCorrectionEditorMode}
                            chapterProgress={allChapterProgress}
                            allCellsForChapter={allCellsForChapter}
                            onTempFontSizeChange={handleTempFontSizeChange}
                            onFontSizeSave={handleFontSizeSave}
                            requiredValidations={requiredValidations ?? undefined}
                            requiredAudioValidations={requiredAudioValidations ?? undefined}
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
                    style={{ height: `calc(100vh - ${headerHeight}px)`, overflowY: "auto" }}
                >
                    <div className="editor-container max-w-full overflow-hidden">
                        <CellList
                            spellCheckResponse={spellCheckResponse}
                            translationUnits={translationUnitsForSection}
                            fullDocumentTranslationUnits={translationUnits}
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
                            successfulCompletions={successfulCompletions}
                            audioAttachments={audioAttachments}
                            isAudioOnly={Boolean(metadata?.audioOnly)}
                            isSaving={isSaving}
                            saveError={saveError}
                            saveRetryCount={saveRetryCount}
                            isCorrectionEditorMode={isCorrectionEditorMode}
                            fontSize={
                                tempFontSize !== null ? tempFontSize : metadata?.fontSize || 14
                            }
                            lineNumbersEnabled={metadata?.lineNumbersEnabled ?? true}
                            currentUsername={username}
                            requiredValidations={requiredValidations ?? undefined}
                            requiredAudioValidations={requiredAudioValidations ?? undefined}
                            transcribingCells={transcribingCells}
                            showInlineBacktranslations={showInlineBacktranslations}
                            backtranslationsMap={backtranslationsMap}
                        />
                    </div>
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
                {!isSourceText && isApplyingValidations && (
                    <div className="floating-apply-validations-button applying">
                        <i className="codicon codicon-loading spin"></i>
                        <span className="button-text">Applying...</span>
                    </div>
                )}
            </div>

            {/* A/B Test Variant Selection Modal */}
            {abTestState.isActive && (
                <ABTestVariantSelector
                    variants={abTestState.variants}
                    cellId={abTestState.cellId}
                    testId={abTestState.testId}
                    names={(abTestState as any).names}
                    abProbability={(abTestState as any).abProbability}
                    onVariantSelected={(idx, ms) => handleVariantSelected(idx, ms)}
                    onDismiss={handleDismissABTest}
                />
            )}

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
