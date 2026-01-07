import { useRef, useEffect, useState, useContext, useCallback } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    QuillCellContent,
    EditHistory,
    SpellCheckResponse,
    Timestamps,
} from "../../../../types";
import type { ReactPlayerRef } from "./types/reactPlayerTypes";
import Editor, { EditorHandles } from "./Editor";
import { getCleanedHtml } from "./react-quill-spellcheck";
import { CodexCellTypes } from "../../../../types/enums";
import { AddParatextButton } from "./AddParatextButton";
import ReactMarkdown from "react-markdown";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import { WhisperTranscriptionClient } from "./WhisperTranscriptionClient";
import AudioWaveformWithTranscription from "./AudioWaveformWithTranscription";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";
import SourceTextDisplay from "./SourceTextDisplay";
import { AudioHistoryViewer } from "./AudioHistoryViewer";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { getCachedAudioDataUrl, setCachedAudioDataUrl } from "../lib/audioCache";

// ShadCN UI components
import { Button } from "../components/ui/button";
import { Card, CardContent, CardHeader } from "../components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "../components/ui/tabs";
import { Textarea } from "../components/ui/textarea";
import { Input } from "../components/ui/input";
import { Badge } from "../components/ui/badge";
import { Progress } from "../components/ui/progress";
import { Separator } from "../components/ui/separator";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
    Dialog,
    DialogContent,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "../components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "../components/ui/popover";
import "./TextCellEditor-overrides.css";
import { Slider } from "../components/ui/slider";

const USE_AUDIO_TAB = true;

// Icons from lucide-react (already installed with ShadCN)
import {
    Pencil,
    Book,
    Sparkles,
    History,
    ListFilter,
    Settings,
    X,
    Check,
    FileCode,
    RefreshCcw,
    ListOrdered,
    Mic,
    Play,
    Trash2,
    CircleDotDashed,
    MessageCircle,
    Loader2,
    Volume2,
    Pin,
    Copy,
    Square,
    FolderOpen,
    NotebookPen,
    RotateCcw,
    Clock,
    ArrowLeft,
    Upload,
    Tag,
} from "lucide-react";
import { cn } from "../lib/utils";
import CommentsBadge from "./CommentsBadge";
import { Checkbox } from "../components/ui/checkbox";

// Define interface for saved backtranslation
interface SavedBacktranslation {
    backtranslation: string;
    originalText?: string;
    timestamp?: number;
}

interface SimilarCell {
    cellId: string;
    score: number;
}

interface Footnote {
    id: string;
    content: string;
    position?: number;
}

interface CellEditorProps {
    cellMarkers: string[];
    cellContent: string;
    cellIndex: number;
    cellType: CodexCellTypes;
    spellCheckResponse: SpellCheckResponse | null;
    contentBeingUpdated: EditorCellContent;
    setContentBeingUpdated: (content: EditorCellContent) => void;
    handleCloseEditor: () => void;
    handleSaveHtml: () => void;
    textDirection: "ltr" | "rtl";
    cellLabel?: string;
    cellTimestamps: Timestamps | undefined;
    cellIsChild: boolean;
    openCellById: (cellId: string) => void;
    editHistory: EditHistory[];
    cell: QuillCellContent;
    isSaving?: boolean;
    saveError?: boolean;
    saveRetryCount?: number;
    footnoteOffset?: number;
    prevEndTime?: number;
    nextStartTime?: number;
    prevCellId?: string;
    prevStartTime?: number;
    nextCellId?: string;
    nextEndTime?: number;
    audioAttachments?: {
        [cellId: string]:
            | "available"
            | "available-local"
            | "available-pointer"
            | "deletedOnly"
            | "none"
            | "missing";
    };
    requiredValidations?: number;
    requiredAudioValidations?: number;
    currentUsername?: string | null;
    vscode?: any;
    isSourceText?: boolean;
    isAuthenticated?: boolean;
    playerRef?: React.RefObject<ReactPlayerRef>;
    videoUrl?: string;
    shouldShowVideoPlayer?: boolean;
}

// Simple ISO-639-1 to ISO-639-3 mapping for common languages; default to 'eng'
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

function toIso3(code: string | undefined): string {
    if (!code) return "eng";
    const norm = code.toLowerCase();
    if (norm.length === 2) return ISO2_TO_ISO3[norm] ?? "eng";
    return norm; // assume already ISO-639-3
}

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[TextCellEditor] ${message}`, ...args);
    }
}

// Footnote delete confirmation button component
const FootnoteDeleteButton: React.FC<{ onConfirm: () => void }> = ({ onConfirm }) => {
    const [isDeleting, setIsDeleting] = useState(false);

    if (isDeleting) {
        return (
            <div className="flex items-center gap-1">
                <Button
                    onClick={() => {
                        onConfirm();
                        setIsDeleting(false);
                    }}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Confirm Delete"
                >
                    <Check className="h-4 w-4 text-green-600" />
                </Button>
                <Button
                    onClick={() => setIsDeleting(false)}
                    variant="ghost"
                    size="icon"
                    className="h-6 w-6"
                    title="Cancel"
                >
                    <X className="h-4 w-4 text-red-600" />
                </Button>
            </div>
        );
    }

    return (
        <Button
            onClick={() => setIsDeleting(true)}
            variant="ghost"
            size="icon"
            className="h-6 w-6"
            title="Delete Footnote"
        >
            <Trash2 className="h-4 w-4" />
        </Button>
    );
};

const CellEditor: React.FC<CellEditorProps> = ({
    cellMarkers,
    cellContent,
    editHistory,
    cellIndex,
    cellType,
    spellCheckResponse,
    contentBeingUpdated,
    setContentBeingUpdated,
    handleCloseEditor,
    handleSaveHtml,
    textDirection,
    cellLabel,
    cellTimestamps,
    cellIsChild,
    openCellById,
    cell,
    isSaving = false,
    saveError = false,
    saveRetryCount = 0,
    footnoteOffset = 1,
    prevEndTime,
    nextStartTime,
    prevCellId,
    prevStartTime,
    nextCellId,
    nextEndTime,
    audioAttachments,
    requiredValidations,
    requiredAudioValidations,
    currentUsername,
    vscode,
    isSourceText,
    isAuthenticated,
    playerRef,
    videoUrl,
    shouldShowVideoPlayer,
}) => {
    const { setUnsavedChanges, showFlashingBorder, unsavedChanges } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    const [editorContent, setEditorContent] = useState(cellContent);
    const [isTextDirty, setIsTextDirty] = useState(false);
    const [showOfflineModal, setShowOfflineModal] = useState(false);
    const [showAuthModal, setShowAuthModal] = useState(false);

    // Sync editor content when cell content changes (e.g., from translation)
    useEffect(() => {
        setEditorContent(cellContent);
    }, [cellContent]);
    const handleAuthModalSignIn = () => {
        window.vscodeApi.postMessage({
            command: "openLoginFlow",
        });
        setShowAuthModal(false);
    };

    const handleAuthModalClose = () => {
        setShowAuthModal(false);
    };

    const handleOfflineModalClose = () => {
        setShowOfflineModal(false);
    };

    const [sourceText, setSourceText] = useState<string | null>(null);
    const [backtranslation, setBacktranslation] = useState<SavedBacktranslation | null>(null);
    const [isEditingBacktranslation, setIsEditingBacktranslation] = useState(false);
    const [editedBacktranslation, setEditedBacktranslation] = useState<string | null>(null);
    const [isGeneratingBacktranslation, setIsGeneratingBacktranslation] = useState(false);
    const [backtranslationProgress, setBacktranslationProgress] = useState(0);
    const [activeTab, setActiveTab] = useState<
        "editLabel" | "source" | "footnotes" | "audio" | "timestamps"
    >(() => {
        try {
            const id = cellMarkers[0];
            if (sessionStorage.getItem(`start-audio-recording-${id}`)) {
                return "audio";
            }
            const stored = sessionStorage.getItem("preferred-editor-tab");
            if (
                stored === "source" ||
                stored === "footnotes" ||
                stored === "audio" ||
                stored === "timestamps"
            ) {
                return stored as "source" | "footnotes" | "audio" | "timestamps";
            }
        } catch {
            // no-op
        }
        return "source";
    });

    // Load preferred tab from provider on mount
    useEffect(() => {
        window.vscodeApi.postMessage({ command: "getPreferredEditorTab" });
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const [footnotes, setFootnotes] = useState<
        Array<{ id: string; content: string; element?: HTMLElement }>
    >([]);
    const [isEditingFootnoteInline, setIsEditingFootnoteInline] = useState(false);
    const [showAudioHistory, setShowAudioHistory] = useState(false);
    const editorHandlesRef = useRef<EditorHandles | null>(null);

    // Add ref to track debounce timeout for footnote parsing
    const footnoteParseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Audio-related state
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    // While awaiting provider response, avoid showing "No audio attached" to prevent flicker
    const [audioFetchPending, setAudioFetchPending] = useState<boolean>(true);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [recordingStatus, setRecordingStatus] = useState<string>("");
    const audioChunksRef = useRef<Blob[]>([]);
    // Refs for synchronized audio/video playback
    const audioElementRef = useRef<HTMLAudioElement | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const videoTimeUpdateHandlerRef = useRef<((e: Event) => void) | null>(null);
    const audioTimeUpdateHandlerRef = useRef<((e: Event) => void) | null>(null);
    const startOverlappingAudioHandlerRef = useRef<((e: Event) => void) | null>(null);
    const previousVideoMuteStateRef = useRef<boolean | null>(null);
    // Refs for mixed audio playback (multiple overlapping cells)
    const overlappingAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const overlappingAudioHandlersRef = useRef<Map<string, (e: Event) => void>>(new Map());
    const overlappingAudioUrlsRef = useRef<Map<string, string>>(new Map());
    const overlappingAudioDelaysRef = useRef<Map<string, number>>(new Map()); // Delay in seconds before starting overlapping audio
    const [muteVideoAudioDuringPlayback, setMuteVideoAudioDuringPlayback] = useState(true);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);
    const [showRecorder, setShowRecorder] = useState(() => {
        try {
            const id = cellMarkers[0];
            return !!sessionStorage.getItem(`start-audio-recording-${id}`);
        } catch {
            return false;
        }
    });
    const [isAudioLoading, setIsAudioLoading] = useState(false);
    const [hasAudioHistory, setHasAudioHistory] = useState<boolean>(false);
    const [audioHistoryCount, setAudioHistoryCount] = useState<number>(0);

    // Transcription state
    const [isTranscribing, setIsTranscribing] = useState(false);
    const [transcriptionProgress, setTranscriptionProgress] = useState(0);
    const [transcriptionStatus, setTranscriptionStatus] = useState<string>("");
    const [savedTranscription, setSavedTranscription] = useState<{
        content: string;
        timestamp: number;
        language?: string;
    } | null>(null);
    const transcriptionClientRef = useRef<WhisperTranscriptionClient | null>(null);
    const [asrConfig, setAsrConfig] = useState<{
        endpoint: string;
        provider: string;
        model: string;
        language: string; // ISO-639-3 expected by MMS; may be ISO-639-1 and mapped
        phonetic: boolean;
        authToken?: string;
    } | null>(null);

    // Helper to smoothly center the editor. Coalesces multiple calls and
    // performs a single smooth scroll after layout settles.
    const scrollTimeoutRef = useRef<number | null>(null);
    const scrollRafRef = useRef<number | null>(null);

    // Compute audio validation icon props once for this render (after audio state is declared)
    const { iconProps: audioValidationIconProps } = useAudioValidationStatus({
        cell: cell as any,
        currentUsername: currentUsername || null,
        requiredAudioValidations:
            requiredAudioValidations ?? (window as any)?.initialData?.validationCountAudio ?? null,
        isSourceText: isSourceText ?? false,
        disabled: !audioBlob,
        displayValidationText: true,
    });
    const audioValidationPopoverProps = {
        cellId: cell.cellMarkers[0],
        cell: cell,
        vscode: vscode,
        isSourceText: isSourceText ?? false,
        currentUsername: currentUsername,
        requiredAudioValidations:
            requiredAudioValidations ??
            (window as any)?.initialData?.validationCountAudio ??
            undefined,
    };

    const centerEditor = useCallback(() => {
        const el = cellEditorRef.current;
        if (!el) return;

        // Cancel any pending schedule to avoid jitter from duplicate calls
        if (scrollTimeoutRef.current) {
            clearTimeout(scrollTimeoutRef.current);
            scrollTimeoutRef.current = null;
        }
        if (scrollRafRef.current) {
            cancelAnimationFrame(scrollRafRef.current);
            scrollRafRef.current = null;
        }

        // Wait a short time for layout changes (images, waveform, etc.) to settle
        scrollTimeoutRef.current = window.setTimeout(() => {
            scrollRafRef.current = requestAnimationFrame(() => {
                el.scrollIntoView({ behavior: "smooth", block: "center", inline: "nearest" });
                scrollRafRef.current = null;
            });
            scrollTimeoutRef.current = null;
        }, 120);
    }, []);

    // Cleanup any pending timers/frames on unmount
    useEffect(() => {
        return () => {
            if (scrollTimeoutRef.current) clearTimeout(scrollTimeoutRef.current);
            if (scrollRafRef.current) cancelAnimationFrame(scrollRafRef.current);
        };
    }, []);

    // Effect to always derive audioUrl from audioBlob
    useEffect(() => {
        if (audioBlob) {
            const url = URL.createObjectURL(audioBlob);
            setAudioUrl(url);
            return () => {
                URL.revokeObjectURL(url);
            };
        } else {
            setAudioUrl(null);
        }
    }, [audioBlob]);

    useEffect(() => {
        if (showFlashingBorder && cellEditorRef.current) {
            debug("Scrolling to content in showFlashingBorder", {
                showFlashingBorder,
                cellEditorRef,
            });
            centerEditor();
        }
    }, [showFlashingBorder, centerEditor]);

    useEffect(() => {
        if (contentToScrollTo && contentToScrollTo === cellMarkers[0] && cellEditorRef.current) {
            debug("Scrolling to content", { contentToScrollTo, cellMarkers });
            centerEditor();
        }
    }, [contentToScrollTo, centerEditor]);

    const [editableLabel, setEditableLabel] = useState(cellLabel || "");
    const [similarCells, setSimilarCells] = useState<SimilarCell[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [activeSearchPosition, setActiveSearchPosition] = useState<number | null>(null);
    const [isEditorControlsExpanded, setIsEditorControlsExpanded] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [showAdvancedControls, setShowAdvancedControls] = useState(false);
    const [unresolvedCommentsCount, setUnresolvedCommentsCount] = useState<number>(0);
    const [showDiscardModal, setShowDiscardModal] = useState(false);

    // Global Escape-to-close handler
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            if (event.key !== "Escape") return;

            // Close Audio History overlay if open
            if (showAudioHistory) {
                event.preventDefault();
                setShowAudioHistory(false);
                return;
            }

            // If the discard modal is visible, Escape should cancel it and return to editor
            if (showDiscardModal) {
                event.preventDefault();
                setShowDiscardModal(false);
                return;
            }

            // If there are unsaved changes, show discard confirmation
            event.preventDefault();
            if (unsavedChanges) {
                setShowDiscardModal(true);
            } else {
                handleCloseEditor();
            }
        };

        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
        // Include dependencies that influence behavior
    }, [unsavedChanges, showAudioHistory, showDiscardModal, handleCloseEditor]);

    const handleSaveCell = () => {
        // Merge the latest label into the content payload used by saveHtml
        setContentBeingUpdated({
            ...contentBeingUpdated,
            cellMarkers,
            cellLabel: editableLabel,
        });

        // Persist label changes via provider even if text content did not change
        if ((editableLabel ?? "") !== (cellLabel ?? "")) {
            window.vscodeApi.postMessage({
                command: "updateCellLabel",
                content: {
                    cellId: cellMarkers[0],
                    cellLabel: editableLabel,
                },
            } as EditorPostMessages);
        }

        // Defer the actual save to ensure state updates are applied
        setTimeout(() => {
            handleSaveHtml();
            const ts = contentBeingUpdated.cellTimestamps;
            if (ts && (typeof ts.startTime === "number" || typeof ts.endTime === "number")) {
                const messageContent: EditorPostMessages = {
                    command: "updateCellTimestamps",
                    content: {
                        cellId: cellMarkers[0],
                        timestamps: ts,
                    },
                };
                window.vscodeApi.postMessage(messageContent);
                // Optimistically clear staged timestamps - will be re-cleared by effect if needed
                const { cellTimestamps, ...rest } = contentBeingUpdated;
                setContentBeingUpdated(rest as EditorCellContent);
            }
        }, 0);
    };

    // Timestamp editing bounds and effective state
    const previousEndBound = typeof prevEndTime === "number" ? prevEndTime : 0;
    const nextStartBound =
        typeof nextStartTime === "number" ? nextStartTime : Number.POSITIVE_INFINITY;
    const effectiveTimestamps: Timestamps | undefined =
        contentBeingUpdated.cellTimestamps ?? cellTimestamps;

    // Extended bounds for overlapping ranges
    const extendedMinBound =
        typeof prevStartTime === "number" ? prevStartTime : Math.max(0, previousEndBound);
    const extendedMaxBound =
        typeof nextEndTime === "number"
            ? nextEndTime
            : Number.isFinite(nextStartBound)
            ? nextStartBound
            : Math.max(
                  effectiveTimestamps?.endTime ?? 0,
                  (effectiveTimestamps?.startTime ?? 0) + 10
              );

    const computedMaxBound = Number.isFinite(nextStartBound)
        ? nextStartBound
        : Math.max(effectiveTimestamps?.endTime ?? 0, (effectiveTimestamps?.startTime ?? 0) + 10);

    // Helper function to request audio blob for a cell
    const requestAudioBlob = useCallback((cellId: string): Promise<Blob | null> => {
        return new Promise((resolve) => {
            let resolved = false;
            const timeout = setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.removeEventListener("message", handler);
                    resolve(null);
                }
            }, 5000);

            const handler = (event: MessageEvent) => {
                const message = event.data;
                if (
                    message?.type === "providerSendsAudioData" &&
                    message.content?.cellId === cellId
                ) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        window.removeEventListener("message", handler);
                        if (message.content.audioData) {
                            fetch(message.content.audioData)
                                .then((res) => res.blob())
                                .then((blob) => resolve(blob))
                                .catch(() => resolve(null));
                        } else {
                            resolve(null);
                        }
                    }
                }
            };

            window.addEventListener("message", handler);
            window.vscodeApi.postMessage({
                command: "requestAudioForCell",
                content: { cellId },
            } as EditorPostMessages);
        });
    }, []);

    // Helper function to clean up all overlapping audio
    const cleanupOverlappingAudio = useCallback(() => {
        // Clean up overlapping audio elements
        overlappingAudioElementsRef.current.forEach((audio, cellId) => {
            const handler = overlappingAudioHandlersRef.current.get(cellId);
            if (handler) {
                audio.removeEventListener("timeupdate", handler);
                overlappingAudioHandlersRef.current.delete(cellId);
            }
            audio.pause();
            audio.src = "";
            const url = overlappingAudioUrlsRef.current.get(cellId);
            if (url) {
                URL.revokeObjectURL(url);
                overlappingAudioUrlsRef.current.delete(cellId);
            }
        });
        overlappingAudioElementsRef.current.clear();
        overlappingAudioDelaysRef.current.clear();
    }, []);

    // Handler to play audio blob with synchronized video playback
    const handlePlayAudioWithVideo = useCallback(async () => {
        // Validate prerequisites
        if (!audioBlob) {
            console.warn("No audio blob available to play");
            return;
        }

        const startTime = effectiveTimestamps?.startTime;
        const endTime = effectiveTimestamps?.endTime;
        const duration = (endTime ?? 0) - (startTime ?? 0);

        if (startTime === undefined || endTime === undefined) {
            console.warn("Timestamps are not available");
            return;
        }

        if (endTime <= startTime) {
            console.warn("Invalid timestamps: endTime must be greater than startTime");
            return;
        }

        // Clean up any existing playback
        cleanupOverlappingAudio();

        if (audioElementRef.current) {
            if (audioTimeUpdateHandlerRef.current) {
                audioElementRef.current.removeEventListener(
                    "timeupdate",
                    audioTimeUpdateHandlerRef.current
                );
                audioTimeUpdateHandlerRef.current = null;
            }
            audioElementRef.current.pause();
            audioElementRef.current.src = "";
            audioElementRef.current = null;
        }

        if (videoElementRef.current && videoTimeUpdateHandlerRef.current) {
            videoElementRef.current.removeEventListener(
                "timeupdate",
                videoTimeUpdateHandlerRef.current
            );
            videoTimeUpdateHandlerRef.current = null;
        }

        // Determine which cells overlap with current cell's range
        const needsPreviousAudio =
            prevCellId &&
            typeof prevStartTime === "number" &&
            typeof prevEndTime === "number" &&
            startTime < prevEndTime;
        const needsNextAudio =
            nextCellId &&
            typeof nextStartTime === "number" &&
            typeof nextEndTime === "number" &&
            endTime > nextStartTime;

        // Request overlapping audio blobs
        const audioPromises: Promise<{ cellId: string; blob: Blob | null }>[] = [];
        if (needsPreviousAudio && prevCellId) {
            audioPromises.push(
                requestAudioBlob(prevCellId).then((blob) => ({
                    cellId: prevCellId!,
                    blob,
                }))
            );
        }
        if (needsNextAudio && nextCellId) {
            audioPromises.push(
                requestAudioBlob(nextCellId).then((blob) => ({
                    cellId: nextCellId!,
                    blob,
                }))
            );
        }

        // Wait for all audio requests (don't block if some fail)
        const overlappingAudios = await Promise.all(audioPromises);

        // Helper function to clean up all audio and video
        const cleanupAll = () => {
            cleanupOverlappingAudio();
            if (audioElementRef.current) {
                if (audioTimeUpdateHandlerRef.current) {
                    audioElementRef.current.removeEventListener(
                        "timeupdate",
                        audioTimeUpdateHandlerRef.current
                    );
                    audioTimeUpdateHandlerRef.current = null;
                }
                if (startOverlappingAudioHandlerRef.current) {
                    audioElementRef.current.removeEventListener(
                        "timeupdate",
                        startOverlappingAudioHandlerRef.current
                    );
                    startOverlappingAudioHandlerRef.current = null;
                }
                const currentUrl = overlappingAudioUrlsRef.current.get("current");
                if (currentUrl) {
                    URL.revokeObjectURL(currentUrl);
                    overlappingAudioUrlsRef.current.delete("current");
                }
                audioElementRef.current.pause();
                audioElementRef.current.src = "";
                audioElementRef.current = null;
            }

            // Restore video mute state and clean up video
            if (videoElementRef.current) {
                if (previousVideoMuteStateRef.current !== null) {
                    videoElementRef.current.muted = previousVideoMuteStateRef.current;
                    previousVideoMuteStateRef.current = null;
                }
                if (videoTimeUpdateHandlerRef.current) {
                    videoElementRef.current.removeEventListener(
                        "timeupdate",
                        videoTimeUpdateHandlerRef.current
                    );
                    videoTimeUpdateHandlerRef.current = null;
                }
                videoElementRef.current.pause();
                videoElementRef.current = null;
            }
        };

        // Create audio element for current cell
        const audioUrl = URL.createObjectURL(audioBlob);
        overlappingAudioUrlsRef.current.set("current", audioUrl);
        const audio = new Audio(audioUrl);
        audioElementRef.current = audio;

        let currentAudioErrorHandled = false;
        audio.onended = cleanupAll;
        audio.onerror = () => {
            if (!currentAudioErrorHandled) {
                currentAudioErrorHandled = true;
                const error = audio.error;
                // Only log if it's a real error (not just unsupported format - code 4)
                // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
                if (error && error.code !== 4) {
                    const errorMessage = error.message
                        ? `Error loading current cell audio: ${error.message}`
                        : "Error loading current cell audio";
                    console.warn(errorMessage);
                }
                cleanupAll();
            }
        };

        // Handle video playback if available
        if (
            shouldShowVideoPlayer &&
            videoUrl &&
            playerRef?.current &&
            startTime !== undefined &&
            endTime !== undefined
        ) {
            try {
                let videoElement: HTMLVideoElement | null = null;
                let seeked = false;

                // First try seekTo method if available
                if (typeof playerRef.current.seekTo === "function") {
                    playerRef.current.seekTo(startTime, "seconds");
                    seeked = true;
                }

                // Try to find the video element
                const internalPlayer = playerRef.current.getInternalPlayer?.();

                if (internalPlayer instanceof HTMLVideoElement) {
                    videoElement = internalPlayer;
                    if (!seeked) {
                        videoElement.currentTime = startTime;
                        seeked = true;
                    }
                } else if (internalPlayer && typeof internalPlayer === "object") {
                    // Try different ways to access the video element
                    const foundVideo =
                        (internalPlayer as any).querySelector?.("video") ||
                        (internalPlayer as any).video ||
                        internalPlayer;

                    if (foundVideo instanceof HTMLVideoElement) {
                        videoElement = foundVideo;
                        if (!seeked) {
                            videoElement.currentTime = startTime;
                            seeked = true;
                        }
                    }
                }

                // Last resort: Try to find video element in the DOM
                if (!videoElement && playerRef.current) {
                    const wrapper = playerRef.current as any;
                    const foundVideo =
                        wrapper.querySelector?.("video") ||
                        wrapper.parentElement?.querySelector?.("video");

                    if (foundVideo instanceof HTMLVideoElement) {
                        videoElement = foundVideo;
                        if (!seeked) {
                            videoElement.currentTime = startTime;
                            seeked = true;
                        }
                    }
                }

                // If we found the video element, mute it and set up playback
                if (videoElement) {
                    videoElementRef.current = videoElement;
                    previousVideoMuteStateRef.current = videoElement.muted;
                    // Only mute if checkbox is checked
                    videoElement.muted = muteVideoAudioDuringPlayback;

                    // Set up timeupdate listener to pause at endTime
                    const timeUpdateHandler = (e: Event) => {
                        const target = e.target as HTMLVideoElement;
                        if (target.currentTime >= endTime) {
                            target.pause();
                            if (videoTimeUpdateHandlerRef.current) {
                                target.removeEventListener(
                                    "timeupdate",
                                    videoTimeUpdateHandlerRef.current
                                );
                                videoTimeUpdateHandlerRef.current = null;
                            }
                        }
                    };

                    videoTimeUpdateHandlerRef.current = timeUpdateHandler;
                    videoElement.addEventListener("timeupdate", timeUpdateHandler);

                    // Start video playback
                    try {
                        await videoElement.play();
                    } catch (playError) {
                        console.warn("Video play() failed:", playError);
                    }
                }
            } catch (error) {
                console.error("Error setting up video playback:", error);
            }
        }

        // Set up overlapping audio elements
        const overlappingAudioReadyPromises: Promise<void>[] = [];
        for (const { cellId, blob } of overlappingAudios) {
            if (!blob) {
                // Audio not available for this overlapping cell - skip silently
                // This is expected when some cells don't have audio recorded yet
                continue;
            }

            let playStartTime: number;
            let playEndTime: number;

            if (
                cellId === prevCellId &&
                typeof prevStartTime === "number" &&
                typeof prevEndTime === "number"
            ) {
                // Previous cell: play overlapping portion
                playStartTime = Math.max(prevStartTime, startTime);
                playEndTime = Math.min(prevEndTime, endTime);
            } else if (
                cellId === nextCellId &&
                typeof nextStartTime === "number" &&
                typeof nextEndTime === "number"
            ) {
                // Next cell: play overlapping portion
                playStartTime = Math.max(nextStartTime, startTime);
                playEndTime = Math.min(nextEndTime, endTime);
            } else {
                continue;
            }

            if (playEndTime <= playStartTime) continue;

            const overlappingUrl = URL.createObjectURL(blob);
            overlappingAudioUrlsRef.current.set(cellId, overlappingUrl);
            const overlappingAudio = new Audio(overlappingUrl);
            overlappingAudioElementsRef.current.set(cellId, overlappingAudio);

            // Calculate offset within the cell's audio
            const cellStartTime =
                cellId === prevCellId
                    ? typeof prevStartTime === "number"
                        ? prevStartTime
                        : 0
                    : typeof nextStartTime === "number"
                    ? nextStartTime
                    : 0;
            const offsetInCell = playStartTime - cellStartTime;
            const durationInPlayback = playEndTime - playStartTime;

            // Calculate delay: when should this overlapping audio start relative to current cell's start
            // If playStartTime > startTime, we need to delay by the difference
            const delay = Math.max(0, playStartTime - startTime);
            overlappingAudioDelaysRef.current.set(cellId, delay);

            // Track if error handler has already run to prevent infinite loops
            let errorHandled = false;
            let isReady = false;

            // Helper function to clean up this overlapping audio
            const cleanupOverlappingAudioForCell = () => {
                if (errorHandled) return; // Prevent infinite loop
                errorHandled = true;

                const handler = overlappingAudioHandlersRef.current.get(cellId);
                if (handler && overlappingAudio) {
                    try {
                        overlappingAudio.removeEventListener("timeupdate", handler);
                    } catch (e) {
                        // Ignore errors during cleanup
                    }
                    overlappingAudioHandlersRef.current.delete(cellId);
                }
                try {
                    overlappingAudio.pause();
                    overlappingAudio.src = "";
                } catch (e) {
                    // Ignore errors during cleanup
                }
                const url = overlappingAudioUrlsRef.current.get(cellId);
                if (url) {
                    URL.revokeObjectURL(url);
                    overlappingAudioUrlsRef.current.delete(cellId);
                }
                overlappingAudioElementsRef.current.delete(cellId);
            };

            // Set up error handler (only log if not already handled by promise rejection)
            overlappingAudio.onerror = () => {
                if (!errorHandled) {
                    errorHandled = true;
                    const error = overlappingAudio.error;
                    // Only log if it's a real error (not just unsupported format - code 4)
                    // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
                    if (error && error.code !== 4) {
                        const errorMessage = error.message
                            ? `Error loading overlapping audio for cell ${cellId}: ${error.message}`
                            : `Error loading overlapping audio for cell ${cellId}`;
                        console.warn(errorMessage);
                    }
                    cleanupOverlappingAudioForCell();
                }
            };

            // Set up timeupdate listener to stop at the calculated end time
            const overlappingHandler = (e: Event) => {
                const target = e.target as HTMLAudioElement;
                // Check if we've reached the end of the overlapping portion
                if (target.currentTime >= offsetInCell + durationInPlayback) {
                    target.pause();
                    const handler = overlappingAudioHandlersRef.current.get(cellId);
                    if (handler) {
                        target.removeEventListener("timeupdate", handler);
                        overlappingAudioHandlersRef.current.delete(cellId);
                    }
                }
            };

            overlappingAudioHandlersRef.current.set(cellId, overlappingHandler);
            overlappingAudio.addEventListener("timeupdate", overlappingHandler);

            // Create a promise that resolves when audio is ready to play
            const readyPromise = new Promise<void>((resolve, reject) => {
                const handleLoadedMetadata = () => {
                    try {
                        if (
                            offsetInCell >= 0 &&
                            offsetInCell < overlappingAudio.duration &&
                            !errorHandled
                        ) {
                            overlappingAudio.currentTime = offsetInCell;
                            isReady = true;
                            overlappingAudio.removeEventListener(
                                "loadedmetadata",
                                handleLoadedMetadata
                            );
                            overlappingAudio.removeEventListener("error", handleError);
                            resolve();
                        } else {
                            console.warn(
                                `Invalid offset ${offsetInCell} for audio duration ${overlappingAudio.duration} in cell ${cellId}`
                            );
                            overlappingAudio.removeEventListener(
                                "loadedmetadata",
                                handleLoadedMetadata
                            );
                            overlappingAudio.removeEventListener("error", handleError);
                            cleanupOverlappingAudioForCell();
                            reject(new Error(`Invalid offset for cell ${cellId}`));
                        }
                    } catch (error) {
                        console.error(
                            `Error setting currentTime for overlapping audio ${cellId}:`,
                            error
                        );
                        overlappingAudio.removeEventListener(
                            "loadedmetadata",
                            handleLoadedMetadata
                        );
                        overlappingAudio.removeEventListener("error", handleError);
                        cleanupOverlappingAudioForCell();
                        reject(error);
                    }
                };

                const handleError = () => {
                    if (!errorHandled) {
                        overlappingAudio.removeEventListener(
                            "loadedmetadata",
                            handleLoadedMetadata
                        );
                        overlappingAudio.removeEventListener("error", handleError);
                        errorHandled = true;
                        // Don't log here - let onerror handler log it
                        const error = overlappingAudio.error;
                        const errorMessage =
                            error?.message || `Error loading audio for cell ${cellId}`;
                        cleanupOverlappingAudioForCell();
                        reject(new Error(errorMessage));
                    }
                };

                // If already loaded, handle immediately
                if (overlappingAudio.readyState >= HTMLMediaElement.HAVE_METADATA) {
                    handleLoadedMetadata();
                } else {
                    overlappingAudio.addEventListener("loadedmetadata", handleLoadedMetadata);
                    overlappingAudio.addEventListener("error", handleError);
                }
            });

            overlappingAudioReadyPromises.push(readyPromise);
        }

        // Set up timeupdate listener to stop current cell audio at endTime
        const audioTimeUpdateHandler = (e: Event) => {
            const target = e.target as HTMLAudioElement;
            if (target.currentTime >= duration) {
                target.pause();
                cleanupAll();
            }
        };

        audioTimeUpdateHandlerRef.current = audioTimeUpdateHandler;
        audio.addEventListener("timeupdate", audioTimeUpdateHandler);

        // Start all audio playback simultaneously
        try {
            // Wait for current cell audio to be ready
            const currentAudioReady = new Promise<void>((resolve, reject) => {
                const handleCanPlay = () => {
                    audio.removeEventListener("canplay", handleCanPlay);
                    audio.removeEventListener("error", handleError);
                    resolve();
                };

                const handleError = () => {
                    if (!currentAudioErrorHandled) {
                        audio.removeEventListener("canplay", handleCanPlay);
                        audio.removeEventListener("error", handleError);
                        currentAudioErrorHandled = true;
                        const error = audio.error;
                        // Don't log here - let onerror handler log it
                        const errorMessage = error?.message || "Error loading current cell audio";
                        reject(new Error(errorMessage));
                    }
                };

                if (audio.readyState >= HTMLMediaElement.HAVE_ENOUGH_DATA) {
                    resolve();
                } else {
                    audio.addEventListener("canplay", handleCanPlay);
                    audio.addEventListener("error", handleError);
                }
            });

            // Wait for all overlapping audio to be ready before starting playback
            const readyResults = await Promise.allSettled([
                currentAudioReady,
                ...overlappingAudioReadyPromises,
            ]);

            // Check if current audio failed to load
            const currentAudioResult = readyResults[0];
            if (currentAudioResult.status === "rejected") {
                // Error already logged by onerror handler or promise rejection handler
                cleanupAll();
                return; // Exit early if current audio fails to load
            }

            // Start current cell audio
            try {
                await audio.play();
            } catch (playError) {
                if (
                    !currentAudioErrorHandled &&
                    playError instanceof Error &&
                    playError.name !== "AbortError" &&
                    playError.name !== "NotAllowedError"
                ) {
                    currentAudioErrorHandled = true;
                    console.error("Error playing current cell audio:", playError);
                }
                cleanupAll();
                return; // Exit early if current audio fails to play
            }

            // Start overlapping audio elements at their correct timestamps
            const overlappingPlayPromises: Promise<void>[] = [];
            const startOverlappingAudio = (overlappingAudio: HTMLAudioElement, cellId: string) => {
                return overlappingAudio.play().catch((error) => {
                    // Only log if it's a real error (not just user interruption)
                    if (error.name !== "AbortError" && error.name !== "NotAllowedError") {
                        console.warn(`Error playing overlapping audio for ${cellId}:`, error);
                    }
                    // Clean up on play error
                    const handler = overlappingAudioHandlersRef.current.get(cellId);
                    if (handler) {
                        try {
                            overlappingAudio.removeEventListener("timeupdate", handler);
                        } catch (e) {
                            // Ignore cleanup errors
                        }
                        overlappingAudioHandlersRef.current.delete(cellId);
                    }
                    try {
                        overlappingAudio.pause();
                        overlappingAudio.src = "";
                    } catch (e) {
                        // Ignore cleanup errors
                    }
                    const url = overlappingAudioUrlsRef.current.get(cellId);
                    if (url) {
                        URL.revokeObjectURL(url);
                        overlappingAudioUrlsRef.current.delete(cellId);
                    }
                    overlappingAudioElementsRef.current.delete(cellId);
                });
            };

            // Use a timeupdate listener on the current audio to trigger overlapping audio at the right time
            const startOverlappingAudioHandler = (e: Event) => {
                const target = e.target as HTMLAudioElement;
                const currentPlaybackTime = target.currentTime;

                // Check each overlapping audio to see if it's time to start it
                overlappingAudioElementsRef.current.forEach((overlappingAudio, cellId) => {
                    // Only try to play if the audio is still in the map (not removed due to error)
                    if (!overlappingAudioElementsRef.current.has(cellId)) return;

                    const delay = overlappingAudioDelaysRef.current.get(cellId);
                    if (delay === undefined) return; // Already started

                    // Check if it's time to start this overlapping audio
                    // Use a small threshold (0.05s) to account for timing precision
                    if (currentPlaybackTime >= delay - 0.05 && overlappingAudio.paused) {
                        // Remove delay from ref since we're starting it now
                        overlappingAudioDelaysRef.current.delete(cellId);

                        // Start playing this overlapping audio
                        startOverlappingAudio(overlappingAudio, cellId);
                    }
                });

                // If all overlapping audio has started, remove this listener
                if (overlappingAudioDelaysRef.current.size === 0) {
                    target.removeEventListener("timeupdate", startOverlappingAudioHandler);
                    startOverlappingAudioHandlerRef.current = null;
                }
            };

            // Start overlapping audio that should start immediately (delay = 0 or very small)
            overlappingAudioElementsRef.current.forEach((overlappingAudio, cellId) => {
                if (!overlappingAudioElementsRef.current.has(cellId)) return;

                const delay = overlappingAudioDelaysRef.current.get(cellId) ?? 0;

                if (delay <= 0.05) {
                    // Start immediately
                    overlappingAudioDelaysRef.current.delete(cellId);
                    overlappingPlayPromises.push(startOverlappingAudio(overlappingAudio, cellId));
                }
            });

            // Add listener to start delayed overlapping audio at the right times
            if (overlappingAudioDelaysRef.current.size > 0) {
                startOverlappingAudioHandlerRef.current = startOverlappingAudioHandler;
                audio.addEventListener("timeupdate", startOverlappingAudioHandler);
            }

            // Wait for immediately-starting overlapping audio to start (don't fail if some fail)
            await Promise.allSettled(overlappingPlayPromises);
        } catch (playError) {
            console.error("Error playing audio:", playError);
            cleanupAll();
        }
    }, [
        audioBlob,
        effectiveTimestamps,
        shouldShowVideoPlayer,
        videoUrl,
        playerRef,
        muteVideoAudioDuringPlayback,
        prevCellId,
        prevStartTime,
        prevEndTime,
        nextCellId,
        nextStartTime,
        nextEndTime,
        requestAudioBlob,
        cleanupOverlappingAudio,
    ]);

    useEffect(() => {
        setEditableLabel(cellLabel || "");
    }, [cellLabel]);

    // Cleanup audio/video playback on unmount or when cell changes
    useEffect(() => {
        return () => {
            // Clean up audio element
            if (audioElementRef.current) {
                if (audioTimeUpdateHandlerRef.current) {
                    audioElementRef.current.removeEventListener(
                        "timeupdate",
                        audioTimeUpdateHandlerRef.current
                    );
                    audioTimeUpdateHandlerRef.current = null;
                }
                audioElementRef.current.pause();
                audioElementRef.current.src = "";
                audioElementRef.current = null;
            }

            // Clean up video element listeners and restore mute state
            if (videoElementRef.current) {
                if (videoTimeUpdateHandlerRef.current) {
                    videoElementRef.current.removeEventListener(
                        "timeupdate",
                        videoTimeUpdateHandlerRef.current
                    );
                    videoTimeUpdateHandlerRef.current = null;
                }
                if (previousVideoMuteStateRef.current !== null) {
                    videoElementRef.current.muted = previousVideoMuteStateRef.current;
                    previousVideoMuteStateRef.current = null;
                }
                videoElementRef.current = null;
            }
        };
    }, [cellMarkers]);

    // Fetch comments count for this cell
    // Comments count now handled by CellList.tsx batched requests

    // Handle comments count response
    // Ensure editor reacts to both single and batched responses
    useMessageHandler(
        "textCellEditor-commentsResponse",
        (event: MessageEvent) => {
            const message = event.data;
            // Single-cell response shape
            if (message.type === "commentsForCell" && message.content?.cellId === cellMarkers[0]) {
                setUnresolvedCommentsCount(message.content.unresolvedCount || 0);
                return;
            }
            // Batched response shape: { [cellId]: count }
            if (message.type === "commentsForCells" && message.content) {
                const count = message.content[cellMarkers[0]];
                if (typeof count === "number") {
                    setUnresolvedCommentsCount(count);
                }
            }
        },
        [cellMarkers]
    );

    // Proactively request the comment count for this cell on mount/change
    useEffect(() => {
        try {
            const messageContent: EditorPostMessages = {
                command: "getCommentsForCells",
                content: { cellIds: [cellMarkers[0]] },
            } as EditorPostMessages;
            window.vscodeApi.postMessage(messageContent);
        } catch {
            // no-op
        }
    }, [cellMarkers]);

    const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditableLabel(e.target.value);
        setUnsavedChanges(true);
    };

    const discardLabelChanges = () => {
        const originalLabel = cellLabel ?? "";
        setEditableLabel(originalLabel);

        // If label was staged in contentBeingUpdated, revert it as well
        if ((contentBeingUpdated.cellLabel ?? "") !== originalLabel) {
            setContentBeingUpdated({
                ...contentBeingUpdated,
                cellMarkers,
                cellLabel: originalLabel,
            });
        }

        // Preserve Save visibility if editor text or timestamps are still dirty
        const a = contentBeingUpdated.cellTimestamps;
        const b = cellTimestamps;
        const timestampsDirty =
            !!a &&
            ((a.startTime ?? undefined) !== (b?.startTime ?? undefined) ||
                (a.endTime ?? undefined) !== (b?.endTime ?? undefined));

        setUnsavedChanges(Boolean(isTextDirty || timestampsDirty));
    };

    useMessageHandler(
        "textCellEditor-similarCellsResponse",
        (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSimilarCellIdsResponse") {
                setSimilarCells(message.content);
            }
        },
        []
    );

    const makeChild = async () => {
        const parentCellId = cellMarkers[0];
        const newChildId = await generateChildCellId(parentCellId);

        const startTime = cellTimestamps?.startTime;
        const endTime = cellTimestamps?.endTime;
        let childStartTime;

        if (startTime && endTime) {
            const deltaTime = endTime - startTime;
            childStartTime = startTime + deltaTime / 2;

            const messageContentToUpdateParentTimeStamps: EditorPostMessages = {
                command: "updateCellTimestamps",
                content: {
                    cellId: cellMarkers[0],
                    timestamps: {
                        startTime: startTime,
                        endTime: childStartTime - 0.001,
                    },
                },
            };
            window.vscodeApi.postMessage(messageContentToUpdateParentTimeStamps);
        }

        const messageContent: EditorPostMessages = {
            command: "makeChildOfCell",
            content: {
                newCellId: newChildId,
                referenceCellId: parentCellId,
                direction: "below",
                cellType: cellType,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const addParatextCell = (addDirection: "above" | "below") => {
        const parentCellId = cellMarkers[0];

        const newChildId = `${parentCellId}:paratext-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;

        const startTime = cellTimestamps?.startTime;
        const endTime = cellTimestamps?.endTime;
        let childStartTime;

        if (startTime && endTime) {
            const deltaTime = endTime - startTime;
            childStartTime = startTime + deltaTime / 2;

            const messageContentToUpdateParentTimeStamps: EditorPostMessages = {
                command: "updateCellTimestamps",
                content: {
                    cellId: parentCellId,
                    timestamps: {
                        startTime: startTime,
                        endTime: childStartTime - 0.001,
                    },
                },
            };
            window.vscodeApi.postMessage(messageContentToUpdateParentTimeStamps);
        }
        const messageContent: EditorPostMessages = {
            command: "makeChildOfCell",
            content: {
                newCellId: newChildId,
                referenceCellId: parentCellId,
                direction: addDirection,
                cellType: CodexCellTypes.PARATEXT,
                data: {
                    startTime: childStartTime,
                    endTime: endTime,
                },
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const deleteCell = () => {
        const messageContent: EditorPostMessages = {
            command: "deleteCell",
            content: {
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
        handleCloseEditor();
    };
    const cellHasContent =
        getCleanedHtml(contentBeingUpdated.cellContent).replace(/\s/g, "") !== "";

    const handleContentUpdate = (newContent: string) => {
        // Clean spell check markup before updating content
        const cleanedContent = getCleanedHtml(newContent);

        setContentBeingUpdated({
            cellMarkers,
            cellContent: cleanedContent,
            cellChanged: true,
            cellLabel: editableLabel,
        });
        setEditorContent(cleanedContent);
    };

    // Combine dirty flags to drive Save visibility
    useEffect(() => {
        const labelDirty = (editableLabel ?? "") !== (cellLabel ?? "");
        const timestampsDirty = (() => {
            const a = contentBeingUpdated.cellTimestamps;
            const b = cellTimestamps;
            // Only treat timestamps as dirty if user has staged any timestamps in contentBeingUpdated
            if (!a) return false;
            return (
                (a.startTime ?? undefined) !== (b?.startTime ?? undefined) ||
                (a.endTime ?? undefined) !== (b?.endTime ?? undefined)
            );
        })();

        setUnsavedChanges(Boolean(isTextDirty || labelDirty || timestampsDirty));
    }, [
        isTextDirty,
        editableLabel,
        cellLabel,
        contentBeingUpdated.cellTimestamps,
        cellTimestamps,
        setUnsavedChanges,
    ]);

    // Clear staged timestamps when prop updates to match (after successful save)
    useEffect(() => {
        const staged = contentBeingUpdated.cellTimestamps;
        const prop = cellTimestamps;

        // Only clear if we have staged timestamps and they match the prop
        if (staged && prop) {
            const startMatch = (staged.startTime ?? undefined) === (prop.startTime ?? undefined);
            const endMatch = (staged.endTime ?? undefined) === (prop.endTime ?? undefined);

            if (startMatch && endMatch) {
                // Timestamps match - clear staged changes
                const { cellTimestamps, ...rest } = contentBeingUpdated;
                setContentBeingUpdated(rest as EditorCellContent);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cellTimestamps, contentBeingUpdated.cellTimestamps]);

    // Add effect to fetch source text
    useEffect(() => {
        // Only fetch source text for non-paratext and non-child cells
        if (cellType !== CodexCellTypes.PARATEXT && !cellIsChild) {
            const messageContent: EditorPostMessages = {
                command: "getSourceText",
                content: {
                    cellId: cellMarkers[0],
                },
            };
            window.vscodeApi.postMessage(messageContent);
        } else {
            // Clear source text for paratext or child cells
            setSourceText(null);
        }
    }, [cellMarkers, cellType, cellIsChild]);

    // Add effect to handle source text response
    useMessageHandler(
        "textCellEditor-sourceTextResponse",
        (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSourceText") {
                setSourceText(message.content);
            }
        },
        []
    );

    // Pseudo progress bar for backtranslation generation
    useEffect(() => {
        let interval: NodeJS.Timeout;

        if (isGeneratingBacktranslation && backtranslationProgress < 85) {
            interval = setInterval(() => {
                setBacktranslationProgress((prev) => {
                    // Slow increments that get slower as we approach 85%
                    const increment = Math.max(0.5, 3 - prev / 30);
                    return Math.min(85, prev + increment);
                });
            }, 200); // Update every 200ms
        }

        return () => {
            if (interval) {
                clearInterval(interval);
            }
        };
    }, [isGeneratingBacktranslation, backtranslationProgress]);

    useMessageHandler(
        "textCellEditor-backtranslationResponse",
        (event: MessageEvent) => {
            const message = event.data;
            if (
                message.type === "providerSendsBacktranslation" ||
                message.type === "providerSendsExistingBacktranslation" ||
                message.type === "providerSendsUpdatedBacktranslation" ||
                message.type === "providerConfirmsBacktranslationSet"
            ) {
                setBacktranslation(message.content || null);
                setEditedBacktranslation(message.content?.backtranslation || null);

                // Complete the progress bar and reset loading state
                if (isGeneratingBacktranslation) {
                    setBacktranslationProgress(100);
                    setTimeout(() => {
                        setIsGeneratingBacktranslation(false);
                        setBacktranslationProgress(0);
                    }, 500); // Brief delay to show completion
                }
            }
        },
        [isGeneratingBacktranslation]
    );

    useEffect(() => {
        // Fetch existing backtranslation when component mounts
        const messageContent: EditorPostMessages = {
            command: "getBacktranslation",
            content: {
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
    }, [cellMarkers]);

    const handleGenerateBacktranslation = () => {
        // Start loading state
        setIsGeneratingBacktranslation(true);
        setBacktranslationProgress(0);

        const messageContent: EditorPostMessages = {
            command: "generateBacktranslation",
            content: {
                text: contentBeingUpdated.cellContent,
                cellId: cellMarkers[0],
            },
        };
        window.vscodeApi.postMessage(messageContent);
    };

    const handleSaveBacktranslation = () => {
        const messageContent: EditorPostMessages = {
            command: "setBacktranslation",
            content: {
                cellId: cellMarkers[0],
                originalText: contentBeingUpdated.cellContent,
                userBacktranslation: editedBacktranslation || "", // Ensure non-null string
            },
        };
        window.vscodeApi.postMessage(messageContent);
        setIsEditingBacktranslation(false);
    };

    const handlePinCell = () => {
        setIsPinned(!isPinned);
        window.vscodeApi.postMessage({
            command: "executeCommand",
            content: {
                command: "parallelPassages.pinCellById",
                args: [cellMarkers[0]],
            },
        });
    };

    const handleOpenCellById = useCallback(
        (cellId: string, text: string) => {
            // First, save the current cell if there are unsaved changes
            if (unsavedChanges) {
                handleSaveHtml();
            }
            // Then, open the new cell and set its content
            openCellById(cellId);

            // Update the local state with the new content
            setContentBeingUpdated({
                cellMarkers,
                cellContent: text,
                cellChanged: true,
                cellLabel: editableLabel,
            });

            // Update the editor content
            setEditorContent(text);

            // Ensure the editor block scrolls fully into view when opened programmatically
            requestAnimationFrame(() => {
                if (cellEditorRef.current) {
                    cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
                }
            });
        },
        [unsavedChanges, handleSaveHtml, openCellById, setContentBeingUpdated, setEditorContent]
    );

    useMessageHandler(
        "textCellEditor-openCellById",
        (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "openCellById") {
                handleOpenCellById(message.cellId, message.text);
            }
        },
        [handleOpenCellById]
    );

    // Add effect to initialize footnotes from the document
    useEffect(() => {
        // First try to get footnotes from cell data
        if (cell?.data?.footnotes) {
            setFootnotes(cell.data.footnotes);
            // Re-parse to ensure correct chronological ordering (debounced)
            parseFootnotesFromContent();
            return;
        }

        // Fallback to session storage
        const storedFootnotes = sessionStorage.getItem(`footnotes-${cellMarkers[0]}`);
        if (storedFootnotes) {
            try {
                setFootnotes(JSON.parse(storedFootnotes));
                // Re-parse to ensure correct chronological ordering (debounced)
                parseFootnotesFromContent();
            } catch (e) {
                console.error("Error parsing stored footnotes:", e);
            }
        }
    }, [cellMarkers, cell?.data?.footnotes]);

    // Function to parse footnotes from cell content with debouncing to prevent race conditions
    const parseFootnotesFromContent = useCallback(() => {
        // Clear any existing timeout to implement debouncing
        if (footnoteParseTimeoutRef.current) {
            clearTimeout(footnoteParseTimeoutRef.current);
        }

        // Debounce the actual parsing to prevent race conditions during save operations
        footnoteParseTimeoutRef.current = setTimeout(() => {
            if (!editorContent) return;

            try {
                const parser = new DOMParser();
                // Clean spell check markup before parsing
                const cleanedContent = getCleanedHtml(editorContent);
                const doc = parser.parseFromString(cleanedContent, "text/html");
                const footnoteElements = doc.querySelectorAll("sup.footnote-marker");

                if (footnoteElements.length === 0) {
                    setFootnotes([]);
                    return;
                }

                const extractedFootnotes: Array<{ id: string; content: string; position: number }> =
                    [];

                footnoteElements.forEach((element) => {
                    const id = element.textContent || "";
                    const rawContent = element.getAttribute("data-footnote") || "";
                    // Clean spell check markup from footnote content as well
                    const content = getCleanedHtml(rawContent);

                    // Calculate the actual position of this element in the document
                    const treeWalker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_ALL);
                    let position = 0;
                    let current = treeWalker.nextNode();

                    while (current && current !== element) {
                        position++;
                        current = treeWalker.nextNode();
                    }

                    if (id && content) {
                        extractedFootnotes.push({
                            id,
                            content,
                            position,
                        });
                    }
                });

                // Sort footnotes based on their actual DOM position (chronological order)
                extractedFootnotes.sort((a, b) => a.position - b.position);

                setFootnotes(extractedFootnotes);
            } catch (error) {
                console.error("Error parsing footnotes:", error);
            }
        }, 50); // 50ms debounce delay to prevent race conditions
    }, [editorContent]);

    // Parse footnotes when content changes
    useEffect(() => {
        parseFootnotesFromContent();
    }, [editorContent]);

    // Cleanup timeout on unmount to prevent memory leaks
    useEffect(() => {
        return () => {
            if (footnoteParseTimeoutRef.current) {
                clearTimeout(footnoteParseTimeoutRef.current);
            }
        };
    }, []);

    // Message handlers using centralized dispatcher
    useMessageHandler(
        "textCellEditor-preferredTab",
        (event: MessageEvent) => {
            if (event.data && event.data.type === "preferredEditorTab") {
                // If this open was specifically forced to audio for recording, ignore
                try {
                    const id = cellMarkers[0];
                    if (sessionStorage.getItem(`start-audio-recording-${id}`)) {
                        return;
                    }
                } catch {
                    // no-op
                }

                const preferred = event.data.tab as typeof activeTab;

                if (
                    event.data.tab === "editLabel" &&
                    (cellType === CodexCellTypes.PARATEXT || cellType === CodexCellTypes.MILESTONE)
                ) {
                    setActiveTab("source");
                } else {
                    setActiveTab(preferred);
                }

                try {
                    sessionStorage.setItem("preferred-editor-tab", preferred);
                } catch {
                    // no-op
                }

                if (preferred === "audio") {
                    setTimeout(centerEditor, 50);
                    setTimeout(centerEditor, 250);
                }
            }
        },
        [cellMarkers, centerEditor]
    );

    // Listen for storeFootnote messages
    useMessageHandler(
        "textCellEditor-footnoteStored",
        (event: MessageEvent) => {
            if (
                event.data.type === "footnoteStored" &&
                event.data.content.cellId === cellMarkers[0]
            ) {
                const newFootnote = {
                    id: event.data.content.footnoteId,
                    content: event.data.content.content,
                };

                setFootnotes((prev) => {
                    // Check if footnote with this ID already exists
                    const exists = prev.some((fn) => fn.id === newFootnote.id);
                    const updatedFootnotes = exists
                        ? prev.map((fn) => (fn.id === newFootnote.id ? newFootnote : fn))
                        : [...prev, newFootnote];

                    // Re-parse to ensure correct chronological ordering (debounced)
                    parseFootnotesFromContent();

                    return updatedFootnotes;
                });
            }
        },
        [cellMarkers, parseFootnotesFromContent]
    );

    // Smart tab switching - currently, keep user on Source even if no source text
    // (backtranslation tab was removed; no automatic switching needed)

    // Audio recording functions

    // Audio recording functions
    const startRecording = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setRecordingStatus("Microphone not supported in this browser");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                audio: {
                    // Request high-quality capture suitable for later WAV conversion during export
                    sampleRate: 48000,
                    sampleSize: 24, // May be ignored by some browsers; best-effort
                    channelCount: 1,
                    echoCancellation: false,
                    noiseSuppression: false,
                    autoGainControl: false,
                },
            });

            const mediaRecorderOptions: MediaRecorderOptions = {};
            try {
                if (typeof MediaRecorder !== "undefined") {
                    if (MediaRecorder.isTypeSupported?.("audio/webm;codecs=opus")) {
                        mediaRecorderOptions.mimeType = "audio/webm;codecs=opus";
                    } else if (MediaRecorder.isTypeSupported?.("audio/webm")) {
                        mediaRecorderOptions.mimeType = "audio/webm";
                    }
                }
            } catch {
                // no-op, fall back to default mimeType
            }
            // Increase bitrate for higher quality Opus encoding
            mediaRecorderOptions.audioBitsPerSecond = 256000; // 256 kbps

            const recorder = new MediaRecorder(stream, mediaRecorderOptions);

            audioChunksRef.current = [];

            recorder.ondataavailable = (e) => {
                if (e.data.size > 0) {
                    audioChunksRef.current.push(e.data);
                }
            };

            recorder.onstart = () => {
                setIsRecording(true);
                setRecordingStatus("Recording...");
            };

            recorder.onstop = () => {
                setIsRecording(false);
                // Keep Blob type simple to avoid downstream extension parsing issues
                const blob = new Blob(audioChunksRef.current, { type: "audio/webm" });
                setAudioBlob(blob);

                // Clean up old URL if exists
                if (audioUrl) {
                    URL.revokeObjectURL(audioUrl);
                }

                const url = URL.createObjectURL(blob);
                setAudioUrl(url);
                setRecordingStatus("Recording complete");

                // Stop all tracks to release microphone
                stream.getTracks().forEach((track) => track.stop());

                // Save audio to cell data
                saveAudioToCell(blob);
                setShowRecorder(false);
            };

            recorder.start();
            setMediaRecorder(recorder);
        } catch (err) {
            setRecordingStatus("Microphone access denied");
            console.error("Error accessing microphone:", err);
        }
    };

    const stopRecording = () => {
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }
    };

    const saveAudioToCell = (blob: Blob) => {
        // Generate a unique ID for the audio file
        const normalizedCellId = cellMarkers[0].replace(/\s+/g, "-").toLowerCase();
        const uniqueId = `audio-${normalizedCellId}-${Date.now()}-${Math.random()
            .toString(36)
            .substr(2, 9)}`;
        const documentSegment = cellMarkers[0].split(" ")[0]; // Extract "JUD" from "JUD 1:1"

        // Normalize file extension from MIME type
        const normalizeExtension = (mimeType: string): string => {
            if (!mimeType || !mimeType.includes("/")) return "webm";

            let ext = mimeType.split("/")[1] || "webm";

            // Remove codec parameters (e.g., "webm;codecs=opus" -> "webm")
            ext = ext.split(";")[0];

            // Normalize non-standard MIME types (e.g., "x-m4a" -> "m4a")
            if (ext.startsWith("x-")) {
                ext = ext.substring(2);
            }

            // Handle common MIME type aliases
            if (ext === "mp4" || ext === "mpeg") {
                return "m4a";
            }

            // Validate against supported formats
            const allowedExtensions = new Set(["webm", "wav", "mp3", "m4a", "ogg", "aac", "flac"]);
            return allowedExtensions.has(ext) ? ext : "webm";
        };

        const fileExtension = normalizeExtension(blob.type);

        // Convert blob to base64 for transfer to provider
        const reader = new FileReader();
        reader.onloadend = async () => {
            const base64data = reader.result as string;

            // Attempt to compute simple metadata using Web Audio API (best-effort)
            let meta: any = {
                mimeType: blob.type || undefined,
                sizeBytes: blob.size,
            };
            try {
                const arrayBuf = await blob.arrayBuffer();
                // Decode to PCM to obtain duration and channels
                const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)({
                    sampleRate: 48000,
                } as any);
                const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
                const durationSec = decoded.duration;
                const channels = decoded.numberOfChannels;
                // Approximated bitrate in kbps: size(bytes)*8 / duration(seconds) / 1000
                const bitrateKbps =
                    durationSec > 0 ? Math.round((blob.size * 8) / durationSec / 1000) : undefined;
                meta = {
                    ...meta,
                    sampleRate: decoded.sampleRate,
                    channels,
                    durationSec,
                    bitrateKbps,
                };
                try {
                    audioCtx.close();
                } catch {
                    void 0;
                }
            } catch {
                // ignore metadata decode errors
            }
            // Send to provider to save file
            const messageContent: EditorPostMessages = {
                command: "saveAudioAttachment",
                content: {
                    cellId: cellMarkers[0],
                    audioData: base64data,
                    audioId: uniqueId,
                    fileExtension: fileExtension,
                    metadata: meta,
                },
            };

            window.vscodeApi.postMessage(messageContent);

            // Store the audio ID temporarily
            sessionStorage.setItem(`audio-id-${cellMarkers[0]}`, uniqueId);

            // Set the audioBlob (audioUrl will be derived automatically)
            setAudioBlob(blob);
        };
        reader.readAsDataURL(blob);
    };

    const discardAudio = () => {
        // Clean up audioBlob and audioUrl
        setAudioBlob(null);
        setRecordingStatus("");

        // Cancel any ongoing transcription
        if (transcriptionClientRef.current) {
            transcriptionClientRef.current.abort();
            transcriptionClientRef.current = null;
        }
        setIsTranscribing(false);
        setTranscriptionProgress(0);
        setTranscriptionStatus("");

        // Get the stored audio ID if it exists
        const audioId = sessionStorage.getItem(`audio-id-${cellMarkers[0]}`);

        // Clear session storage
        sessionStorage.removeItem(`audio-${cellMarkers[0]}`);
        sessionStorage.removeItem(`audio-id-${cellMarkers[0]}`);

        // If we have an audio ID, notify provider to delete the file
        if (audioId) {
            const messageContent: EditorPostMessages = {
                command: "deleteAudioAttachment",
                content: {
                    cellId: cellMarkers[0],
                    audioId: audioId,
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
    };

    // Request ASR config on mount
    useEffect(() => {
        window.vscodeApi.postMessage({ command: "getAsrConfig" });
    }, []);

    // Handle ASR config response
    useMessageHandler("textCellEditor-asrConfig", (event: MessageEvent) => {
        const message = event.data;
        if (message.type === "asrConfig") {
            setAsrConfig(message.content);
        }
    });

    const handleTranscribeAudio = async () => {
        // Check connectivity first
        if (!navigator.onLine) {
            setShowOfflineModal(true);
            return;
        }

        // Check authentication
        if (!isAuthenticated) {
            setShowAuthModal(true);
            return;
        }

        if (!audioBlob) {
            setTranscriptionStatus("No audio to transcribe");
            return;
        }

        setIsTranscribing(true);
        setTranscriptionProgress(0);
        setTranscriptionStatus("Connecting to transcription service...");

        try {
            // Notify parent UI to show loading effect on this source cell
            try {
                window.postMessage(
                    {
                        type: "transcriptionState",
                        content: { cellId: cellMarkers[0], inProgress: true },
                    },
                    "*"
                );
            } catch {
                /* ignore */
            }
            // Create transcription client using configured endpoint from backend
            const wsEndpoint = asrConfig?.endpoint;
            if (!wsEndpoint) {
                throw new Error("ASR endpoint not configured. Please check your ASR settings.");
            }
            const client = new WhisperTranscriptionClient(wsEndpoint, asrConfig?.authToken);
            transcriptionClientRef.current = client;

            client.onError = (error) => {
                setTranscriptionStatus(`Error: ${error}`);
            };

            // Perform transcription
            const result = await client.transcribe(audioBlob);

            // Success - save transcription but don't automatically insert
            const transcribedText = result.text.trim();
            if (transcribedText) {
                // Save transcription to cell metadata
                const audioId = sessionStorage.getItem(`audio-id-${cellMarkers[0]}`);
                if (audioId) {
                    const transcriptionData = {
                        content: transcribedText,
                        timestamp: Date.now(),
                    };

                    // Save to cell metadata via provider
                    const messageContent: EditorPostMessages = {
                        command: "updateCellAfterTranscription",
                        content: {
                            cellId: cellMarkers[0],
                            transcribedText: transcribedText,
                            language: "unknown",
                        },
                    };
                    window.vscodeApi.postMessage(messageContent);

                    // Update local state
                    setSavedTranscription(transcriptionData);
                }

                setTranscriptionStatus("Transcription complete");
            } else {
                setTranscriptionStatus("No speech detected in audio");
            }
        } catch (error) {
            console.error("Transcription error:", error);
            setTranscriptionStatus(
                `Transcription failed: ${error instanceof Error ? error.message : "Unknown error"}`
            );
            try {
                window.vscodeApi.postMessage({
                    command: "showErrorMessage",
                    text: `Transcription failed for ${cellMarkers[0]}: ${
                        error instanceof Error ? error.message : String(error)
                    }`,
                });
            } catch {
                /* ignore messaging errors */
            }
        } finally {
            setIsTranscribing(false);
            transcriptionClientRef.current = null;

            // Clear UI loading effect
            try {
                window.postMessage(
                    {
                        type: "transcriptionState",
                        content: { cellId: cellMarkers[0], inProgress: false },
                    },
                    "*"
                );
            } catch {
                /* ignore */
            }

            // Clear status after a delay, but keep savedTranscription
            setTimeout(() => {
                setTranscriptionStatus("");
                setTranscriptionProgress(0);
            }, 5000);
        }
    };

    const handleInsertTranscription = () => {
        if (!savedTranscription) return;

        // Get current content text-only (we intentionally simplify to keep codebase simple)
        const currentContent = editorContent;
        const doc = new DOMParser().parseFromString(currentContent, "text/html");
        const currentText = doc.body.textContent || "";

        // Build HTML with transcription visually de-emphasized
        const transcriptionSpan = `<span data-transcription="true" style="opacity:0.6" title="Transcription">${savedTranscription.content}</span>`;
        const newContent = currentText
            ? `<span>${currentText} </span>${transcriptionSpan}`
            : transcriptionSpan;

        // Update the editor content directly using the editor's updateContent method
        if (editorHandlesRef.current) {
            editorHandlesRef.current.updateContent(newContent);
        }

        // Also update the local state
        handleContentUpdate(newContent);

        setTranscriptionStatus("Transcription inserted into cell");

        // Clear status after a delay
        setTimeout(() => {
            setTranscriptionStatus("");
        }, 3000);
    };

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];

        if (file && (file.type.startsWith("audio/") || file.type.startsWith("video/"))) {
            console.log("Valid audio file detected, setting audio blob");
            setAudioBlob(file);

            // Clean up old URL if exists
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }

            // Don't create blob URLs anymore - just use the Blob directly
            setRecordingStatus("Audio file loaded");

            // Save to cell
            saveAudioToCell(file);
            // After saving, return to playback view
            setShowRecorder(false);
        } else {
            setRecordingStatus("Please select a valid audio file");
        }
    };

    // Preload audio when audio tab is accessed
    const preloadAudioForTab = useCallback(() => {
        // If we already have a freshly recorded blob, don't fetch again
        if (audioBlob) return;
        // If cached from this session, hydrate synchronously without re-requesting
        try {
            const cached = getCachedAudioDataUrl(cellMarkers[0]);
            if (cached) {
                (async () => {
                    const resp = await fetch(cached);
                    const blob = await resp.blob();
                    setAudioBlob(blob);
                    setShowRecorder(false);
                    setRecordingStatus("Audio loaded");
                    setIsAudioLoading(false);
                    setAudioFetchPending(false);
                })();
                return;
            }
        } catch {
            /* empty */
        }
        // Skip requesting audio when we know there are no attachments for this cell
        if (audioAttachments && audioAttachments[cellMarkers[0]] === "none") {
            setIsAudioLoading(false);
            setAudioFetchPending(false);
            setShowRecorder(true);
            return;
        }
        // Respect auto-download toggle: only fetch when enabled or when the file is already local
        const autoInit = (window as any).__autoDownloadAudioOnOpenInitialized;
        const autoFlag = (window as any).__autoDownloadAudioOnOpen;
        // Default to false if not initialized to match disk default
        const shouldAutoDownload = autoInit ? !!autoFlag : false;
        const stateForCell = audioAttachments?.[cellMarkers[0]];
        const isLocal = stateForCell === "available-local";
        if (shouldAutoDownload || isLocal) {
            setAudioFetchPending(true);
            setIsAudioLoading(true);
            const messageContent: EditorPostMessages = {
                command: "requestAudioForCell",
                content: { cellId: cellMarkers[0] },
            };
            window.vscodeApi.postMessage(messageContent);
        } else {
            // Do not auto-fetch; wait for user click (AudioPlayButton will send request)
            setIsAudioLoading(false);
            setAudioFetchPending(false);
        }
    }, [cellMarkers, audioBlob, audioAttachments]);

    // Load existing audio when component mounts
    useEffect(() => {
        // Don't try to load from session storage or cell data directly
        // Just request audio attachments from the provider which will send proper base64 data
        preloadAudioForTab();
        // Also request audio history to determine if History button should be shown
        window.vscodeApi.postMessage({
            command: "getAudioHistory",
            content: { cellId: cellMarkers[0] },
        });
        // If requested by list view, auto-record
        // Do not auto-open any tab. If auto-recording was requested, start in background without changing tabs.
        try {
            const autoRecord = sessionStorage.getItem(`start-audio-recording-${cellMarkers[0]}`);
            if (autoRecord) {
                setShowRecorder(true);
                setTimeout(() => {
                    startRecording();
                    sessionStorage.removeItem(`start-audio-recording-${cellMarkers[0]}`);
                }, 300);
            }
        } catch {
            // no-op
        }
    }, [preloadAudioForTab, cellMarkers]);

    // When switching to a new cell, ensure the editor is fully visible
    useEffect(() => {
        centerEditor();
    }, [cellMarkers, centerEditor]);

    // If the provider toggles auto-download while this cell is open, fetch immediately
    useMessageHandler("providerUpdatesNotebookMetadataForWebview", (event: MessageEvent) => {
        try {
            const msg = event.data as any;
            if (msg?.content?.autoDownloadAudioOnOpen === true) {
                preloadAudioForTab();
            }
        } catch {
            /* no-op */
        }
    });

    // (Cache hydration handled in preloadAudioForTab to avoid double-renders)

    // Handle audio data response
    useMessageHandler(
        "textCellEditor-audioResponse",
        async (event: MessageEvent) => {
            const message = event.data;

            // Handle audio availability updates specifically for this cell
            if (message.type === "providerSendsAudioAttachments") {
                // Clear cached audio data since selected audio might have changed
                const { clearCachedAudio } = await import("../lib/audioCache");
                clearCachedAudio(cellMarkers[0]);

                // If we already have local audio (e.g., just recorded) or are loading, don't disrupt UI
                if (audioBlob || isAudioLoading) {
                    return;
                }

                const availability = (message.attachments || {}) as Record<
                    string,
                    "available" | "available-local" | "available-pointer" | "deletedOnly" | "none"
                >;
                const stateForCell = availability[cellMarkers[0]];

                const autoInit = (window as any).__autoDownloadAudioOnOpenInitialized;
                const autoFlag = (window as any).__autoDownloadAudioOnOpen;
                const shouldAutoDownload = autoInit ? !!autoFlag : false;

                if (
                    (stateForCell === "available" ||
                        stateForCell === "available-local" ||
                        stateForCell === "available-pointer") &&
                    shouldAutoDownload
                ) {
                    setIsAudioLoading(true);
                    const messageContent: EditorPostMessages = {
                        command: "requestAudioForCell",
                        content: { cellId: cellMarkers[0] },
                    };
                    window.vscodeApi.postMessage(messageContent);
                } else if (stateForCell === "none" || stateForCell === "deletedOnly") {
                    // No usable audio for this cell; keep recorder visible and settle state
                    setIsAudioLoading(false);
                    setAudioFetchPending(false);
                    setShowRecorder(true);
                }
            }

            // Handle specific audio data
            if (
                message.type === "providerSendsAudioData" &&
                message.content.cellId === cellMarkers[0]
            ) {
                if (message.content.audioData) {
                    try {
                        // Show loading only when there is actual audio to fetch
                        setIsAudioLoading(true);
                        const base64Response = await fetch(message.content.audioData);
                        const blob = await base64Response.blob();
                        setAudioBlob(blob);
                        // cache base64 for future openings in this session
                        try {
                            setCachedAudioDataUrl(cellMarkers[0], message.content.audioData);
                        } catch {
                            /* empty */
                        }
                        // If recorder was showing because there was no audio previously,
                        // switch to waveform automatically once audio is available
                        setShowRecorder(false);
                        setRecordingStatus("Audio loaded");
                        setIsAudioLoading(false);
                        setAudioFetchPending(false);
                        setTimeout(centerEditor, 50);
                        setTimeout(centerEditor, 250);
                        if (message.content.transcription) {
                            setSavedTranscription({
                                content: message.content.transcription.content,
                                timestamp: message.content.transcription.timestamp,
                                language: message.content.transcription.language,
                            });
                        }
                        if (message.content.audioId) {
                            sessionStorage.setItem(
                                `audio-id-${cellMarkers[0]}`,
                                message.content.audioId
                            );
                        }
                    } catch (error) {
                        console.error("Error converting audio data to blob:", error);
                        setRecordingStatus("Error loading audio");
                        setIsAudioLoading(false);
                    }
                } else {
                    // No audio — prepare recorder but do not switch tabs automatically
                    setIsAudioLoading(false);
                    setAudioFetchPending(false);
                    setShowRecorder(true);
                }
            }

            // Handle save confirmation
            if (
                message.type === "audioAttachmentSaved" &&
                message.content.cellId === cellMarkers[0]
            ) {
                if (message.content.success) {
                    setRecordingStatus("Audio saved successfully");
                } else {
                    setRecordingStatus(
                        `Error saving audio: ${message.content.error || "Unknown error"}`
                    );
                }
                // Refresh audio history after save
                window.vscodeApi.postMessage({
                    command: "getAudioHistory",
                    content: { cellId: cellMarkers[0] },
                });
                // If no audio present locally (e.g., selection failed/was missing), request current audio
                if (!audioBlob) {
                    const msg: EditorPostMessages = {
                        command: "requestAudioForCell",
                        content: { cellId: cellMarkers[0] },
                    };
                    window.vscodeApi.postMessage(msg);
                }
            }

            // Handle delete confirmation
            if (
                message.type === "audioAttachmentDeleted" &&
                message.content.cellId === cellMarkers[0]
            ) {
                if (message.content.success) {
                    setRecordingStatus("Audio deleted");
                } else {
                    setRecordingStatus(
                        `Error deleting audio: ${message.content.error || "Unknown error"}`
                    );
                }
                // Refresh audio history after delete
                window.vscodeApi.postMessage({
                    command: "getAudioHistory",
                    content: { cellId: cellMarkers[0] },
                });
            }
            // Handle restore confirmation
            if (
                message.type === "audioAttachmentRestored" &&
                message.content.cellId === cellMarkers[0]
            ) {
                // Mark that the next history response should auto-close the modal once
                (window as any).__codexAutoCloseHistoryOnce = true;
                // Refresh audio history after restore
                window.vscodeApi.postMessage({
                    command: "getAudioHistory",
                    content: { cellId: cellMarkers[0] },
                });
            }
        },
        [cellMarkers, audioBlob, isAudioLoading, centerEditor]
    );

    const displayEditableLabel = () => {
        if (editableLabel !== "") {
            return editableLabel;
        }

        return <span className="font-normal text-base text-gray-500 italic">Enter label...</span>;
    };

    // Listen for audio history responses and update hasAudioHistory
    useMessageHandler(
        "textCellEditor-audioHistoryResponse",
        (event: MessageEvent) => {
            const message = event.data;
            if (
                message.type === "audioHistoryReceived" &&
                message.content.cellId === cellMarkers[0]
            ) {
                const history = message.content.audioHistory || [];
                setHasAudioHistory(history.length > 0);
                setAudioHistoryCount(history.length);

                // If we just restored an audio (previously none loaded),
                // auto-close history and request the current audio so the waveform appears
                const hasAvailable = history.some((h: any) => !h.attachment?.isDeleted);
                if (hasAvailable && !audioBlob && (window as any).__codexAutoCloseHistoryOnce) {
                    (window as any).__codexAutoCloseHistoryOnce = false;
                    setShowAudioHistory(false);
                    const messageContent: EditorPostMessages = {
                        command: "requestAudioForCell",
                        content: { cellId: cellMarkers[0] },
                    };
                    window.vscodeApi.postMessage(messageContent);
                }
            }
        },
        [cellMarkers, audioBlob, showAudioHistory]
    );

    // Clean up media recorder and stream on unmount
    useEffect(() => {
        return () => {
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            }
            // Clean up transcription client if active
            if (transcriptionClientRef.current) {
                transcriptionClientRef.current.abort();
                transcriptionClientRef.current = null;
            }
        };
    }, [mediaRecorder]);

    return (
        <Card className="w-full max-w-4xl shadow-xl" style={{ direction: textDirection }}>
            <CardHeader className="border-b p-4 flex flex-row flex-nowrap items-center justify-between gap-3 space-y-0">
                <div className="flex flex-row flex-wrap items-center justify-between gap-3">
                    <div className="flex flex-col justify-center gap-2 pr-3">
                        <div
                            className="flex items-center gap-2"
                            role="button"
                            aria-label="Cell id and label"
                        >
                            {cellType !== CodexCellTypes.PARATEXT &&
                                cellType !== CodexCellTypes.MILESTONE && (
                                    <div
                                        className="flex items-center gap-x-1"
                                        title="Edit cell label"
                                    >
                                        <span className="text-lg font-semibold muted-foreground">
                                            {displayEditableLabel()}
                                        </span>
                                        <Button
                                            variant="ghost"
                                            size="icon"
                                            title="Edit label"
                                            onClick={() => {
                                                setActiveTab("editLabel");
                                            }}
                                        >
                                            <i
                                                className="codicon codicon-edit"
                                                style={{
                                                    fontSize: "0.9em",
                                                }}
                                            ></i>
                                        </Button>
                                    </div>
                                )}
                            <CommentsBadge
                                cellId={cellMarkers[0]}
                                unresolvedCount={unresolvedCommentsCount}
                            />
                        </div>
                    </div>
                    <div className="flex items-center gap-3 ml-auto pl-3 md:pl-4 flex-shrink-0" />
                </div>
                <div className="flex items-center gap-2">
                    {/* Right-aligned utility buttons: AI, History, Settings */}
                    <div className="flex items-center gap-2 mr-2">
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => editorHandlesRef.current?.autocomplete()}
                                        variant="ghost"
                                        size="icon"
                                        title="Autocomplete with AI"
                                    >
                                        <Sparkles className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Autocomplete with AI</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => editorHandlesRef.current?.showEditHistory()}
                                        variant="ghost"
                                        size="icon"
                                        title="Show Edit History"
                                    >
                                        <History className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Show Edit History</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        <Popover open={showAdvancedControls} onOpenChange={setShowAdvancedControls}>
                            <PopoverTrigger asChild>
                                <Button variant="ghost" size="icon" title="Advanced Controls">
                                    <Settings className="h-4 w-4" />
                                </Button>
                            </PopoverTrigger>
                            <PopoverContent align="end" className="w-auto p-2 space-x-1 space-y-0">
                                <div className="flex items-center gap-1">
                                    <AddParatextButton
                                        cellId={cellMarkers[0]}
                                        cellTimestamps={cellTimestamps}
                                    />
                                    {cellType !== CodexCellTypes.PARATEXT && !cellIsChild && (
                                        <Button
                                            onClick={makeChild}
                                            variant="ghost"
                                            size="icon"
                                            title="Add Child Cell"
                                        >
                                            <ListOrdered className="h-4 w-4" />
                                        </Button>
                                    )}
                                    {!sourceCellContent && (
                                        <ConfirmationButton
                                            icon="trash"
                                            onClick={deleteCell}
                                            disabled={cellHasContent}
                                        />
                                    )}
                                    <Button
                                        onClick={handlePinCell}
                                        variant="ghost"
                                        size="icon"
                                        title={
                                            isPinned
                                                ? "Unpin from Parallel View"
                                                : "Pin in Parallel View"
                                        }
                                        className={isPinned ? "text-blue-500" : ""}
                                    >
                                        <Pin className="h-4 w-4" />
                                    </Button>
                                </div>
                            </PopoverContent>
                        </Popover>
                    </div>
                    <div className="flex items-center gap-1">
                        {unsavedChanges ? (
                            <>
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveCell();
                                    }}
                                    variant="default"
                                    size="icon"
                                    title={"Save changes"}
                                    disabled={(isSaving && !saveError) || isEditingFootnoteInline}
                                >
                                    {isSaving && !saveError ? (
                                        <Loader2 className="h-4 w-4 animate-spin" />
                                    ) : (
                                        <Check className="h-4 w-4" />
                                    )}
                                </Button>
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        setShowDiscardModal(true);
                                    }}
                                    variant="destructive"
                                    size="icon"
                                    title={"Discard changes and close"}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                            </>
                        ) : (
                            <Button
                                onClick={handleCloseEditor}
                                variant="ghost"
                                size="icon"
                                title="Close"
                            >
                                <X className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
                </div>
                {/* Advanced controls now appear in a popover; no inline layout shift */}
            </CardHeader>

            {/* Discard confirmation modal */}
            <Dialog open={showDiscardModal} onOpenChange={setShowDiscardModal}>
                <DialogContent>
                    <DialogHeader>
                        <DialogTitle>Discard changes?</DialogTitle>
                    </DialogHeader>
                    <div className="text-sm text-muted-foreground">
                        This will close the editor and discard all unsaved changes.
                    </div>
                    <DialogFooter>
                        <Button variant="secondary" onClick={() => setShowDiscardModal(false)}>
                            Cancel
                        </Button>
                        <Button
                            variant="destructive"
                            onClick={() => {
                                // Explicitly discard local edits and refresh content
                                setShowDiscardModal(false);
                                // Clear any staged edits in parent state so preview reverts
                                setContentBeingUpdated({} as EditorCellContent);
                                // Reset unsaved flag in context
                                setUnsavedChanges(false);
                                // Ask provider to resend current content from disk/source
                                window.vscodeApi.postMessage({
                                    command: "getContent",
                                } as EditorPostMessages);
                                // Finally close the editor UI
                                handleCloseEditor();
                            }}
                        >
                            Discard
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <CardContent className="p-4 space-y-4">
                <div
                    className={`flex items-start gap-2 ${
                        showFlashingBorder
                            ? "ring-2 ring-blue-500 ring-opacity-50 animate-pulse rounded-lg p-2"
                            : ""
                    }`}
                    ref={cellEditorRef}
                >
                    <div className="flex-1">
                        <Editor
                            currentLineId={cellMarkers[0]}
                            key={`${cellIndex}-quill`}
                            initialValue={editorContent}
                            spellCheckResponse={spellCheckResponse}
                            editHistory={editHistory}
                            onChange={({ html }) => {
                                // Clean spell check markup before processing
                                const cleanedHtml = getCleanedHtml(html);
                                setEditorContent(cleanedHtml);

                                debug("html", { html: cleanedHtml, cellMarkers, editableLabel });

                                setContentBeingUpdated({
                                    cellMarkers,
                                    cellContent: cleanedHtml,
                                    cellChanged: true,
                                    cellLabel: editableLabel,
                                });
                            }}
                            onDirtyChange={(dirty) => {
                                setIsTextDirty(dirty);
                            }}
                            textDirection={textDirection}
                            ref={editorHandlesRef}
                            setIsEditingFootnoteInline={setIsEditingFootnoteInline}
                            isEditingFootnoteInline={isEditingFootnoteInline}
                            footnoteOffset={footnoteOffset}
                        />
                    </div>
                </div>

                <Tabs
                    value={activeTab || "__none__"}
                    onValueChange={(value) => {
                        const tabValue = value as
                            | "editLabel"
                            | "source"
                            | "footnotes"
                            | "timestamps"
                            | "audio";

                        setActiveTab(tabValue);
                        // Persist preferred tab in VS Code workspace cache
                        window.vscodeApi.postMessage({
                            command: "setPreferredEditorTab",
                            content: { tab: tabValue },
                        });

                        // Refresh selection when opening footnotes tab to avoid stale state
                        if (tabValue === "footnotes") {
                            try {
                                const sel = editorHandlesRef.current?.getSelectionText?.() || "";
                                (window as any).__codexFootnoteSelection = sel; // ephemeral cache if needed later
                            } catch {
                                // no-op
                            }
                        }

                        // Preload audio when audio tab is selected
                        if (tabValue === "audio") {
                            preloadAudioForTab();
                        }
                    }}
                    className="w-full"
                >
                    <TabsList
                        className="flex w-full"
                        style={{ justifyContent: "stretch", display: "flex" }}
                    >
                        {cellType !== CodexCellTypes.PARATEXT &&
                            cellType !== CodexCellTypes.MILESTONE && (
                                <TabsTrigger value="editLabel">
                                    <Tag className="mr-2 h-4 w-4" />
                                </TabsTrigger>
                            )}
                        <TabsTrigger value="source">
                            <FileCode className="mr-2 h-4 w-4" />
                            {!sourceText && (
                                <span className="ml-2 h-2 w-2 rounded-full bg-gray-400" />
                            )}
                            {backtranslation && (
                                <span
                                    className="ml-2 h-2 w-2 rounded-full bg-green-400"
                                    title="Backtranslation available"
                                />
                            )}
                            {!backtranslation && cellHasContent && (
                                <span
                                    className="ml-2 h-2 w-2 rounded-full bg-yellow-400"
                                    title="Generate backtranslation"
                                />
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="footnotes">
                            <NotebookPen className="mr-2 h-4 w-4" />
                            {footnotes.length > 0 && (
                                <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                                    {footnotes.length}
                                </Badge>
                            )}
                        </TabsTrigger>
                        {cellTimestamps &&
                            (cellTimestamps.startTime !== undefined ||
                                cellTimestamps.endTime !== undefined) && (
                                <TabsTrigger value="timestamps">
                                    <Clock className="mr-2 h-4 w-4" />
                                    <span
                                        className="ml-2 h-2 w-2 rounded-full bg-blue-400"
                                        title="Timestamps available"
                                    />
                                </TabsTrigger>
                            )}
                        {USE_AUDIO_TAB && (
                            <TabsTrigger value="audio">
                                <Mic className="mr-2 h-4 w-4" />

                                {audioUrl &&
                                    (audioUrl.startsWith("blob:") ||
                                        audioUrl.startsWith("data:") ||
                                        audioUrl.startsWith("http")) && (
                                        <span
                                            className="ml-2 h-2 w-2 rounded-full bg-green-400"
                                            title="Audio attached"
                                        />
                                    )}
                            </TabsTrigger>
                        )}
                    </TabsList>

                    {cellType !== CodexCellTypes.PARATEXT &&
                        cellType !== CodexCellTypes.MILESTONE && (
                            <TabsContent value="editLabel">
                                <div className="space-y-6">
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="text"
                                            value={editableLabel}
                                            defaultValue={cellLabel}
                                            onChange={handleLabelChange}
                                            placeholder="Enter label..."
                                            className="flex-1"
                                        />
                                        <RotateCcw
                                            className="h-4 w-4 cursor-pointer"
                                            onClick={() => {
                                                setIsEditorControlsExpanded(
                                                    !isEditorControlsExpanded
                                                );
                                                discardLabelChanges();
                                            }}
                                        />
                                    </div>
                                </div>
                            </TabsContent>
                        )}
                    <TabsContent value="source">
                        <div className="space-y-6">
                            {/* Source Text */}
                            <div>
                                <h4 className="text-sm font-medium mb-2 text-muted-foreground">
                                    Source Text
                                </h4>
                                <SourceTextDisplay
                                    content={sourceText || ""}
                                    footnoteOffset={footnoteOffset}
                                />
                            </div>

                            {/* Backtranslation Section */}
                            <div className="space-y-4">
                                <div className="flex items-center justify-between">
                                    <h4 className="text-sm font-medium text-muted-foreground">
                                        Backtranslation
                                    </h4>
                                    <div className="flex items-center gap-2">
                                        {backtranslation && !isEditingBacktranslation && (
                                            <Button
                                                onClick={() => setIsEditingBacktranslation(true)}
                                                variant="ghost"
                                                size="icon"
                                                title="Edit Backtranslation"
                                            >
                                                <Pencil className="h-4 w-4" />
                                            </Button>
                                        )}
                                        <Button
                                            onClick={handleGenerateBacktranslation}
                                            variant="ghost"
                                            size="icon"
                                            title="Generate Backtranslation"
                                            disabled={
                                                !cellHasContent || isGeneratingBacktranslation
                                            }
                                        >
                                            {isGeneratingBacktranslation ? (
                                                <Loader2 className="h-4 w-4 animate-spin" />
                                            ) : (
                                                <RefreshCcw className="h-4 w-4" />
                                            )}
                                        </Button>
                                    </div>
                                </div>

                                {/* Loading indicator for backtranslation generation */}
                                {isGeneratingBacktranslation && (
                                    <div className="space-y-3">
                                        <div className="text-center">
                                            <p className="text-sm text-muted-foreground mb-2">
                                                Generating backtranslation...
                                            </p>
                                            <Progress
                                                value={backtranslationProgress}
                                                className="w-full"
                                            />
                                            <p className="text-xs text-muted-foreground mt-1">
                                                {Math.round(backtranslationProgress)}%
                                            </p>
                                        </div>
                                    </div>
                                )}

                                {!isGeneratingBacktranslation && backtranslation ? (
                                    <>
                                        {isEditingBacktranslation ? (
                                            <div className="space-y-3">
                                                <Textarea
                                                    value={editedBacktranslation || ""}
                                                    onChange={(e) =>
                                                        setEditedBacktranslation(e.target.value)
                                                    }
                                                    className="min-h-[150px]"
                                                    placeholder="Enter backtranslation text..."
                                                />
                                                <div className="flex gap-2 justify-end">
                                                    <Button
                                                        onClick={handleSaveBacktranslation}
                                                        size="sm"
                                                        title="Save Backtranslation"
                                                    >
                                                        Save
                                                    </Button>
                                                    <Button
                                                        onClick={() =>
                                                            setIsEditingBacktranslation(false)
                                                        }
                                                        variant="secondary"
                                                        size="sm"
                                                        title="Cancel Editing"
                                                    >
                                                        Cancel
                                                    </Button>
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="p-4 rounded-lg bg-muted">
                                                <ReactMarkdown className="prose prose-sm max-w-none">
                                                    {backtranslation.backtranslation}
                                                </ReactMarkdown>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    !isGeneratingBacktranslation && (
                                        <div className="text-center p-6 text-muted-foreground bg-muted/50 rounded-lg">
                                            {cellHasContent ? (
                                                <>
                                                    <p>
                                                        No backtranslation available for this text.
                                                    </p>
                                                    <p className="mt-2">
                                                        Click the refresh button to generate one.
                                                    </p>
                                                </>
                                            ) : (
                                                <>
                                                    <p>Add content to this cell first.</p>
                                                    <p className="mt-2">
                                                        Backtranslation will be available once you
                                                        have text to translate.
                                                    </p>
                                                </>
                                            )}
                                        </div>
                                    )
                                )}
                            </div>
                        </div>
                    </TabsContent>

                    {activeTab === "footnotes" && (
                        <TabsContent value="footnotes">
                            <div className="content-section">
                                {/* Add Footnote action surfaced here with selection-aware hint - hide when already creating */}
                                {!isEditingFootnoteInline && (
                                    <div className="flex items-center justify-between mb-3">
                                        <div className="text-xs text-muted-foreground">
                                            {(() => {
                                                const sel =
                                                    editorHandlesRef.current?.getSelectionText?.() ||
                                                    "";
                                                return sel
                                                    ? `Selected: "${sel.slice(0, 40)}${
                                                          sel.length > 40 ? "…" : ""
                                                      }"`
                                                    : "Select text in the editor to attach a footnote (optional).";
                                            })()}
                                        </div>
                                        <Button
                                            size="sm"
                                            onClick={() => editorHandlesRef.current?.addFootnote()}
                                            disabled={!editorHandlesRef.current}
                                        >
                                            <NotebookPen className="mr-2 h-4 w-4" />
                                            {(() => {
                                                const sel =
                                                    editorHandlesRef.current?.getSelectionText?.() ||
                                                    "";
                                                return sel
                                                    ? `Add footnote to selection`
                                                    : `Add footnote`;
                                            })()}
                                        </Button>
                                    </div>
                                )}

                                {footnotes.length > 0 ? (
                                    <div className="space-y-3">
                                        {footnotes.map((footnote, index) => (
                                            <Card key={footnote.id} className="p-4">
                                                <div className="flex items-center justify-between mb-2">
                                                    <Badge variant="outline" className="font-mono">
                                                        {index + footnoteOffset}
                                                    </Badge>
                                                    <div className="flex gap-1">
                                                        <Button
                                                            onClick={() => {
                                                                editorHandlesRef.current?.editFootnote(
                                                                    footnote.id,
                                                                    footnote.content
                                                                );
                                                            }}
                                                            variant="ghost"
                                                            size="icon"
                                                            className="h-6 w-6"
                                                            title="Edit Footnote"
                                                        >
                                                            <Pencil className="h-4 w-4" />
                                                        </Button>
                                                        <FootnoteDeleteButton
                                                            onConfirm={() => {
                                                                // Create DOM parser to edit the HTML directly
                                                                const parser = new DOMParser();
                                                                // Clean spell check markup before parsing
                                                                const cleanedContent =
                                                                    getCleanedHtml(editorContent);
                                                                const doc = parser.parseFromString(
                                                                    cleanedContent,
                                                                    "text/html"
                                                                );

                                                                // Find and remove footnote markers by matching content
                                                                // Since footnote.id is the display number, we need to match by content
                                                                doc.querySelectorAll(
                                                                    "sup.footnote-marker"
                                                                ).forEach((el) => {
                                                                    const rawFootnoteContent =
                                                                        el.getAttribute(
                                                                            "data-footnote"
                                                                        ) || "";
                                                                    const cleanedFootnoteContent =
                                                                        getCleanedHtml(
                                                                            rawFootnoteContent
                                                                        );
                                                                    // Match by cleaned footnote content since that's what's used in parsing
                                                                    if (
                                                                        cleanedFootnoteContent ===
                                                                        footnote.content
                                                                    ) {
                                                                        el.remove();
                                                                    }
                                                                });

                                                                // Update editor content with cleaned content
                                                                const updatedContent =
                                                                    doc.body.innerHTML;

                                                                // Update both the local state and the actual Quill editor
                                                                handleContentUpdate(updatedContent);

                                                                // Also update the actual Quill editor directly
                                                                setTimeout(() => {
                                                                    if (editorHandlesRef.current) {
                                                                        editorHandlesRef.current.updateContent(
                                                                            updatedContent
                                                                        );
                                                                        // Renumber footnotes to maintain chronological order
                                                                        setTimeout(() => {
                                                                            editorHandlesRef.current?.renumberFootnotes();
                                                                            // Parse footnotes again after renumbering (debounced)
                                                                            parseFootnotesFromContent();
                                                                        }, 50);
                                                                    }
                                                                }, 10);
                                                            }}
                                                        />
                                                    </div>
                                                </div>
                                                <div
                                                    className="text-sm p-2 rounded bg-muted"
                                                    dangerouslySetInnerHTML={{
                                                        // Clean spell check markup from footnote content before displaying
                                                        __html: getCleanedHtml(footnote.content),
                                                    }}
                                                />
                                            </Card>
                                        ))}
                                    </div>
                                ) : (
                                    <div className="text-center p-8 text-muted-foreground">
                                        <p>No footnotes in this cell yet.</p>
                                        <p className="mt-2">Use the button above to add one.</p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    )}

                    {activeTab === "timestamps" && (
                        <TabsContent value="timestamps">
                            <div className="content-section space-y-4">
                                <h3 className="text-lg font-medium">Timestamps</h3>

                                {effectiveTimestamps &&
                                (effectiveTimestamps.startTime !== undefined ||
                                    effectiveTimestamps.endTime !== undefined) ? (
                                    <div className="space-y-4">
                                        {/* Scrubber with clamped handles */}
                                        <div className="space-y-4">
                                            {/* Previous cell slider - read-only */}
                                            {typeof prevStartTime === "number" &&
                                                typeof prevEndTime === "number" &&
                                                prevStartTime < prevEndTime && (
                                                    <div className="space-y-2 opacity-60">
                                                        <label className="text-sm font-medium text-muted-foreground">
                                                            Previous cell range
                                                        </label>
                                                        <Slider
                                                            disabled
                                                            min={Math.max(0, prevStartTime)}
                                                            max={Math.max(
                                                                prevEndTime,
                                                                prevStartTime + 0.001
                                                            )}
                                                            value={[prevStartTime, prevEndTime]}
                                                            step={0.001}
                                                        />
                                                        <div className="flex justify-between text-xs text-muted-foreground">
                                                            <span>{formatTime(prevStartTime)}</span>
                                                            <span>{formatTime(prevEndTime)}</span>
                                                        </div>
                                                    </div>
                                                )}

                                            {/* Current cell slider */}
                                            <div className="space-y-2">
                                                <label className="text-sm font-medium">
                                                    Adjust range
                                                </label>
                                                <Slider
                                                    min={extendedMinBound}
                                                    max={Math.max(
                                                        extendedMaxBound,
                                                        effectiveTimestamps.endTime ??
                                                            extendedMinBound
                                                    )}
                                                    value={[
                                                        Math.max(
                                                            extendedMinBound,
                                                            effectiveTimestamps.startTime ??
                                                                extendedMinBound
                                                        ),
                                                        Math.min(
                                                            extendedMaxBound,
                                                            effectiveTimestamps.endTime ??
                                                                effectiveTimestamps.startTime ??
                                                                extendedMaxBound
                                                        ),
                                                    ]}
                                                    step={0.001}
                                                    onValueChange={(vals: number[]) => {
                                                        const [start, end] = vals;
                                                        const clampedStart = Math.max(
                                                            extendedMinBound,
                                                            Math.min(start, end)
                                                        );
                                                        const clampedEnd = Math.min(
                                                            extendedMaxBound,
                                                            Math.max(end, clampedStart)
                                                        );
                                                        const updatedTimestamps: Timestamps = {
                                                            ...effectiveTimestamps,
                                                            startTime: Number(
                                                                clampedStart.toFixed(3)
                                                            ),
                                                            endTime: Number(clampedEnd.toFixed(3)),
                                                        };
                                                        setContentBeingUpdated({
                                                            ...contentBeingUpdated,
                                                            cellTimestamps: updatedTimestamps,
                                                            cellChanged: true,
                                                        });
                                                        setUnsavedChanges(true);
                                                    }}
                                                />
                                                <div className="flex justify-between text-xs text-muted-foreground">
                                                    <span>Min: {formatTime(extendedMinBound)}</span>
                                                    <span>Max: {formatTime(extendedMaxBound)}</span>
                                                </div>
                                            </div>

                                            {/* Next cell slider - read-only */}
                                            {typeof nextStartTime === "number" &&
                                                typeof nextEndTime === "number" &&
                                                nextStartTime < nextEndTime && (
                                                    <div className="space-y-2 opacity-60">
                                                        <label className="text-sm font-medium text-muted-foreground">
                                                            Next cell range
                                                        </label>
                                                        <Slider
                                                            disabled
                                                            min={Math.max(0, nextStartTime)}
                                                            max={Math.max(
                                                                nextEndTime,
                                                                nextStartTime + 0.001
                                                            )}
                                                            value={[nextStartTime, nextEndTime]}
                                                            step={0.001}
                                                        />
                                                        <div className="flex justify-between text-xs text-muted-foreground">
                                                            <span>{formatTime(nextStartTime)}</span>
                                                            <span>{formatTime(nextEndTime)}</span>
                                                        </div>
                                                    </div>
                                                )}
                                        </div>

                                        <div className="flex items-center justify-between p-3 bg-muted rounded-lg">
                                            <div className="text-sm">
                                                <span className="font-medium">Duration:</span>{" "}
                                                {effectiveTimestamps.startTime !== undefined &&
                                                effectiveTimestamps.endTime !== undefined &&
                                                (effectiveTimestamps.endTime as number) >
                                                    (effectiveTimestamps.startTime as number)
                                                    ? `${(
                                                          (effectiveTimestamps.endTime as number) -
                                                          (effectiveTimestamps.startTime as number)
                                                      ).toFixed(3)}s`
                                                    : "Invalid duration"}
                                            </div>
                                            <div className="text-sm text-muted-foreground">
                                                {effectiveTimestamps.startTime !== undefined &&
                                                effectiveTimestamps.endTime !== undefined &&
                                                (effectiveTimestamps.endTime as number) >
                                                    (effectiveTimestamps.startTime as number)
                                                    ? `(${formatTime(
                                                          effectiveTimestamps.startTime as number
                                                      )} → ${formatTime(
                                                          effectiveTimestamps.endTime as number
                                                      )})`
                                                    : ""}
                                            </div>
                                        </div>

                                        <div className="flex justify-between">
                                            <div className="flex gap-2">
                                                <Button
                                                    onClick={handlePlayAudioWithVideo}
                                                    variant="default"
                                                    size="sm"
                                                    disabled={
                                                        !audioBlob ||
                                                        (effectiveTimestamps?.endTime ?? 0) -
                                                            (effectiveTimestamps?.startTime ?? 0) <=
                                                            0 ||
                                                        !shouldShowVideoPlayer
                                                    }
                                                >
                                                    <Play className="mr-1 h-4 w-4" />
                                                    Play
                                                </Button>
                                                <Button
                                                    onClick={() => {
                                                        // Clear timestamps
                                                        setContentBeingUpdated({
                                                            ...contentBeingUpdated,
                                                            cellTimestamps: undefined,
                                                        });
                                                    }}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <RotateCcw className="mr-1 h-4 w-4" />
                                                    Revert
                                                </Button>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <Checkbox
                                                    id="mute-video-audio-during-playback"
                                                    checked={muteVideoAudioDuringPlayback}
                                                    onCheckedChange={(checked) =>
                                                        setMuteVideoAudioDuringPlayback(
                                                            checked === true
                                                        )
                                                    }
                                                />
                                                <label
                                                    htmlFor="mute-video-audio-during-playback"
                                                    className="text-sm cursor-pointer"
                                                >
                                                    Mute video
                                                </label>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="text-center p-8 text-muted-foreground">
                                        <p>No timestamps available for this cell.</p>
                                        <p className="mt-2">
                                            Timestamps are typically imported from subtitle files or
                                            video content.
                                        </p>
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    )}

                    {activeTab === "audio" && (
                        <TabsContent value="audio">
                            <div className="content-section space-y-6">
                                <h3 className="text-lg font-medium">Audio Recording</h3>

                                {showRecorder ||
                                !audioUrl ||
                                !(
                                    audioUrl.startsWith("blob:") ||
                                    audioUrl.startsWith("data:") ||
                                    audioUrl.startsWith("http")
                                ) ? (
                                    <div className="bg-[var(--vscode-editor-background)] p-3 sm:p-4 rounded-md shadow w-full">
                                        {!audioUrl && (
                                            <div className="bg-[var(--vscode-editor-background)] p-3 rounded-md shadow-sm">
                                                <div className="flex items-center justify-center h-20 text-[var(--vscode-foreground)] text-sm">
                                                    {audioAttachments &&
                                                    (audioAttachments[cellMarkers[0]] ===
                                                        "available" ||
                                                        audioAttachments[cellMarkers[0]] ===
                                                            "available-pointer") ? (
                                                        <div className="flex flex-col items-center gap-2">
                                                            {isAudioLoading || audioFetchPending ? (
                                                                <Button
                                                                    disabled
                                                                    className="h-9 px-3 text-sm opacity-80 cursor-default"
                                                                >
                                                                    <i className="codicon codicon-sync codicon-modifier-spin mr-1" />
                                                                    Downloading audio...
                                                                </Button>
                                                            ) : (
                                                                <Button
                                                                    onClick={() => {
                                                                        setIsAudioLoading(true);
                                                                        setAudioFetchPending(true);
                                                                        const messageContent: EditorPostMessages =
                                                                            {
                                                                                command:
                                                                                    "requestAudioForCell",
                                                                                content: {
                                                                                    cellId: cellMarkers[0],
                                                                                },
                                                                            };
                                                                        window.vscodeApi.postMessage(
                                                                            messageContent
                                                                        );
                                                                    }}
                                                                    className="h-9 px-3 text-sm"
                                                                >
                                                                    <i className="codicon codicon-cloud-download mr-1" />
                                                                    Click to download
                                                                </Button>
                                                            )}
                                                            {(() => {
                                                                const autoInit = (window as any)
                                                                    .__autoDownloadAudioOnOpenInitialized;
                                                                const autoFlag = (window as any)
                                                                    .__autoDownloadAudioOnOpen;
                                                                if (autoInit && !!autoFlag)
                                                                    return null;
                                                                return (
                                                                    <div className="text-xs text-muted-foreground">
                                                                        You can enable auto-download
                                                                        in settings
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    ) : (
                                                        <span>
                                                            No audio attached to this cell yet.
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap items-center justify-center gap-2 mt-3 px-2">
                                            <Button
                                                onClick={
                                                    isRecording ? stopRecording : startRecording
                                                }
                                                variant={isRecording ? "secondary" : "default"}
                                                className={`h-8 px-2 text-xs ${
                                                    isRecording ? "animate-pulse" : ""
                                                }`}
                                            >
                                                {isRecording ? (
                                                    <>
                                                        <Square className="h-3 w-3 mr-1" />
                                                        Stop Recording
                                                    </>
                                                ) : (
                                                    <>
                                                        <CircleDotDashed className="h-3 w-3 mr-1" />
                                                        Start Recording
                                                    </>
                                                )}
                                            </Button>

                                            <Button
                                                variant="outline"
                                                className="flex items-center justify-center h-8 px-2 text-xs"
                                                onClick={() => {
                                                    document
                                                        .getElementById("audio-file-input")
                                                        ?.click();
                                                }}
                                            >
                                                <Upload className="h-3 w-3 mr-1" />
                                                Upload
                                            </Button>
                                            <input
                                                id="audio-file-input"
                                                type="file"
                                                accept="audio/*,video/*"
                                                onChange={handleFileUpload}
                                                placeholder=""
                                                className="hidden"
                                            />

                                            {hasAudioHistory && (
                                                <div className="relative inline-block">
                                                    <Button
                                                        onClick={() => setShowAudioHistory(true)}
                                                        variant="outline"
                                                        size="sm"
                                                        className="h-8 px-2 text-xs"
                                                        title="Audio History"
                                                    >
                                                        <History className="h-3 w-3" />
                                                        <span className="ml-1">History</span>
                                                    </Button>
                                                    {audioHistoryCount > 0 && (
                                                        <span
                                                            className="absolute -top-2 -right-2 inline-flex items-center justify-center rounded-full"
                                                            style={{
                                                                minWidth: "1.25rem",
                                                                height: "1.1rem",
                                                                padding: "0 6px",
                                                                backgroundColor:
                                                                    "var(--vscode-badge-background)",
                                                                color: "var(--vscode-badge-foreground)",
                                                                border: "1px solid var(--vscode-panel-border)",
                                                                fontSize: "0.7rem",
                                                                fontWeight: 700,
                                                                lineHeight: 1,
                                                            }}
                                                        >
                                                            {audioHistoryCount}
                                                        </span>
                                                    )}
                                                </div>
                                            )}

                                            {audioUrl && !isRecording && (
                                                <Button
                                                    variant="outline"
                                                    className="h-8 px-2 text-xs"
                                                    onClick={() => setShowRecorder(false)}
                                                >
                                                    <ArrowLeft className="h-3 w-3 mr-2" />
                                                    Back
                                                </Button>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="space-y-4">
                                        <AudioWaveformWithTranscription
                                            audioUrl={audioUrl || ""}
                                            audioBlob={audioBlob}
                                            transcription={savedTranscription}
                                            isTranscribing={isTranscribing}
                                            transcriptionProgress={transcriptionProgress}
                                            onTranscribe={handleTranscribeAudio}
                                            onInsertTranscription={handleInsertTranscription}
                                            onRequestRemove={() => setConfirmingDiscard(true)}
                                            onShowHistory={() => setShowAudioHistory(true)}
                                            historyCount={audioHistoryCount}
                                            onShowRecorder={() => setShowRecorder(true)}
                                            disabled={!audioBlob}
                                            validationStatusProps={audioValidationIconProps}
                                            audioValidationPopoverProps={
                                                audioValidationPopoverProps
                                            }
                                        />

                                        {confirmingDiscard && (
                                            <div className="flex flex-wrap items-center justify-center gap-2 mt-2 p-3 bg-[var(--vscode-editor-background)] border border-[var(--vscode-panel-border)] rounded-md">
                                                <p className="text-sm text-[var(--vscode-foreground)] mr-4">
                                                    Are you sure you want to remove this audio?
                                                </p>
                                                <Button
                                                    onClick={() => {
                                                        discardAudio();
                                                        setConfirmingDiscard(false);
                                                    }}
                                                    variant="destructive"
                                                    size="sm"
                                                    className="h-8 px-2"
                                                >
                                                    <Check className="mr-2 h-4 w-4" />
                                                    Confirm
                                                </Button>
                                                <Button
                                                    onClick={() => setConfirmingDiscard(false)}
                                                    variant="outline"
                                                    size="sm"
                                                    className="h-8 px-2"
                                                >
                                                    <X className="mr-2 h-4 w-4" />
                                                    Cancel
                                                </Button>
                                            </div>
                                        )}

                                        {transcriptionStatus && (
                                            <p className="text-sm text-center text-muted-foreground">
                                                {transcriptionStatus}
                                            </p>
                                        )}

                                        {recordingStatus &&
                                            recordingStatus !== "Audio loaded" &&
                                            !isTranscribing && (
                                                <Badge
                                                    variant={
                                                        isRecording ? "destructive" : "secondary"
                                                    }
                                                    className={`self-center ${
                                                        isRecording ? "animate-pulse" : ""
                                                    }`}
                                                >
                                                    {recordingStatus}
                                                </Badge>
                                            )}
                                    </div>
                                )}
                            </div>
                        </TabsContent>
                    )}
                </Tabs>
                <div className="text-sm font-light text-gray-500 w-full text-right">
                    {cellMarkers[0]}
                </div>
            </CardContent>

            {/* Audio History Viewer Modal */}
            {showAudioHistory && (
                <AudioHistoryViewer
                    cellId={cellMarkers[0]}
                    vscode={window.vscodeApi}
                    currentUsername={(window as any)?.initialData?.username || null}
                    requiredAudioValidations={
                        (window as any)?.initialData?.validationCountAudio ?? undefined
                    }
                    onClose={() => setShowAudioHistory(false)}
                />
            )}

            <Dialog open={showAuthModal} onOpenChange={handleAuthModalClose}>
                <DialogContent>
                    <DialogHeader className="sm:text-center">
                        <DialogTitle>Sign in to use AI transcription</DialogTitle>
                    </DialogHeader>
                    <DialogFooter className="flex-col sm:justify-center sm:flex-col">
                        <Button onClick={handleAuthModalSignIn}>Sign In</Button>
                        <Button variant="secondary" onClick={handleAuthModalClose}>
                            Cancel
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>

            <Dialog open={showOfflineModal} onOpenChange={handleOfflineModalClose}>
                <DialogContent>
                    <DialogHeader className="sm:text-center">
                        <DialogTitle>Connect to the internet to use AI transcription</DialogTitle>
                    </DialogHeader>
                    <DialogFooter className="flex-col sm:justify-center sm:flex-col">
                        <Button variant="secondary" onClick={handleOfflineModalClose}>
                            Close
                        </Button>
                    </DialogFooter>
                </DialogContent>
            </Dialog>
        </Card>
    );
};

// Helper function to format time in MM:SS.mmm format
const formatTime = (timeInSeconds: number): string => {
    const minutes = Math.floor(timeInSeconds / 60);
    const seconds = Math.floor(timeInSeconds % 60);
    const milliseconds = Math.floor((timeInSeconds % 1) * 1000);
    return `${minutes.toString().padStart(2, "0")}:${seconds
        .toString()
        .padStart(2, "0")}.${milliseconds.toString().padStart(3, "0")}`;
};

export default CellEditor;
