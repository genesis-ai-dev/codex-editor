import { useRef, useEffect, useState, useContext, useCallback, useMemo } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    QuillCellContent,
    EditHistory,
    SpellCheckResponse,
    Timestamps,
    CustomNotebookMetadata,
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
import { globalAudioController } from "../lib/audioController";

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
import MicrophoneIcon from "../components/ui/icons/MicrophoneIcon";
import { Languages } from "lucide-react";

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
    metadata?: CustomNotebookMetadata;
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
    metadata,
}) => {
    const { setUnsavedChanges, showFlashingBorder, unsavedChanges } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    // Lock state is ONLY honored from top-level metadata.isLocked
    const isCellLocked = !!cell.metadata?.isLocked;
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
    const [audioDuration, setAudioDuration] = useState<number | null>(null);
    // While awaiting provider response, avoid showing "No audio attached" to prevent flicker
    const [audioFetchPending, setAudioFetchPending] = useState<boolean>(true);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [recordingStatus, setRecordingStatus] = useState<string>("");
    const [isAudioSaving, setIsAudioSaving] = useState<boolean>(false);
    const [countdown, setCountdown] = useState<number | null>(null);
    const [recordingStartTime, setRecordingStartTime] = useState<number | null>(null);
    const [recordingElapsedTime, setRecordingElapsedTime] = useState<number>(0);
    const audioSaveRequestIdRef = useRef<string | null>(null);
    const audioChunksRef = useRef<Blob[]>([]);
    const countdownIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const recordingTimerRef = useRef<NodeJS.Timeout | null>(null);
    const saveAudioToCellRef = useRef<((blob: Blob) => void) | null>(null);
    // Refs for synchronized audio/video playback
    const audioElementRef = useRef<HTMLAudioElement | null>(null);
    const videoElementRef = useRef<HTMLVideoElement | null>(null);
    const videoTimeUpdateHandlerRef = useRef<((e: Event) => void) | null>(null);
    const audioTimeUpdateHandlerRef = useRef<((e: Event) => void) | null>(null);
    const previousVideoMuteStateRef = useRef<boolean | null>(null);
    // Refs for combined audio playback
    const overlappingAudioUrlsRef = useRef<Map<string, string>>(new Map()); // Store blob URLs for cleanup
    // Legacy refs kept for cleanup compatibility (will be cleared but not actively used)
    const overlappingAudioElementsRef = useRef<Map<string, HTMLAudioElement>>(new Map());
    const overlappingAudioHandlersRef = useRef<Map<string, (e: Event) => void>>(new Map());
    const overlappingAudioDelaysRef = useRef<Map<string, number>>(new Map());
    const overlappingAudioOffsetsRef = useRef<Map<string, number>>(new Map());
    const audioBufferCacheRef = useRef<Map<string, AudioBuffer>>(new Map()); // Cache decoded AudioBuffers by blob URL
    const [combinedAudioBlobKey, setCombinedAudioBlobKey] = useState(0); // Force recalculation when timestamps change
    const [muteVideoAudioDuringPlayback, setMuteVideoAudioDuringPlayback] = useState(true);
    const previousAudioTimestampValuesRef = useRef<[number, number] | null>(null);
    const effectiveTimestampsRef = useRef<Timestamps | undefined>(undefined);
    const contentBeingUpdatedRef = useRef<EditorCellContent>(contentBeingUpdated);
    const [prevAudioTimestamps, setPrevAudioTimestamps] = useState<Timestamps | null>(null);
    const [nextAudioTimestamps, setNextAudioTimestamps] = useState<Timestamps | null>(null);
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
    const [isPlayAudioLoading, setIsPlayAudioLoading] = useState(false);
    const [hasAudioHistory, setHasAudioHistory] = useState<boolean>(false);
    const [audioHistoryCount, setAudioHistoryCount] = useState<number>(0);
    const [audioWarning, setAudioWarning] = useState<string | null>(null);

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

    const isSubtitlesType = metadata?.importerType === "subtitles";

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

    // Cleanup recording timers on unmount
    useEffect(() => {
        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
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

    // Calculate audio duration from audioBlob
    useEffect(() => {
        let cancelled = false;
        const calculateDuration = async () => {
            try {
                if (!audioBlob) {
                    setAudioDuration(null);
                    return;
                }

                const arrayBuffer = await audioBlob.arrayBuffer();
                if (cancelled) return;

                // Use a low-priority timeout to avoid blocking the UI thread
                setTimeout(async () => {
                    try {
                        if (cancelled) return;
                        const audioContext = new (window.AudioContext ||
                            (window as any).webkitAudioContext)();
                        const audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        if (cancelled) return;
                        if (isFinite(audioBuffer.duration) && audioBuffer.duration > 0) {
                            setAudioDuration(audioBuffer.duration);
                        } else {
                            setAudioDuration(null);
                        }
                        try {
                            audioContext.close();
                        } catch {
                            void 0;
                        }
                    } catch {
                        // Ignore decode errors
                        if (!cancelled) {
                            setAudioDuration(null);
                        }
                    }
                }, 100);
            } catch {
                // Ignore errors
                if (!cancelled) {
                    setAudioDuration(null);
                }
            }
        };

        calculateDuration();
        return () => {
            cancelled = true;
        };
    }, [audioBlob]);

    // Actual recording function - called after countdown completes
    const startActualRecording = useCallback(async () => {
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
                setRecordingStartTime(Date.now());
                setRecordingElapsedTime(0);
            };

            recorder.onstop = () => {
                setIsRecording(false);
                setRecordingStartTime(null);
                setRecordingElapsedTime(0);
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
                if (saveAudioToCellRef.current) {
                    saveAudioToCellRef.current(blob);
                }
                setShowRecorder(false);
            };

            recorder.start();
            setMediaRecorder(recorder);
        } catch (err) {
            setRecordingStatus("Microphone access denied");
            console.error("Error accessing microphone:", err);
            setCountdown(null);
        }
    }, [audioUrl]);

    // Countdown timer effect - handles 3→2→1→0 countdown before recording starts
    useEffect(() => {
        if (countdown === null || countdown < 0) {
            // Clean up interval if countdown is not active
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            return;
        }

        if (countdown === 0) {
            // Countdown finished, start actual recording
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            setCountdown(null);
            // Call the actual recording start function
            startActualRecording();
            return;
        }

        // Set up interval to decrement countdown every second
        countdownIntervalRef.current = setInterval(() => {
            setCountdown((prev) => {
                if (prev === null || prev <= 0) {
                    return null;
                }
                const next = prev - 1;
                setRecordingStatus(next > 0 ? `Starting in ${next}...` : "Starting...");
                return next;
            });
        }, 1000);

        return () => {
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
        };
    }, [countdown, startActualRecording]);

    // Recording elapsed time tracker - updates every 100ms while recording
    useEffect(() => {
        if (!isRecording || recordingStartTime === null) {
            // Reset elapsed time when not recording
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
            setRecordingElapsedTime(0);
            return;
        }

        // Update elapsed time every 100ms for smooth progress bar
        recordingTimerRef.current = setInterval(() => {
            const elapsed = (Date.now() - recordingStartTime) / 1000;
            setRecordingElapsedTime(elapsed);
        }, 100);

        return () => {
            if (recordingTimerRef.current) {
                clearInterval(recordingTimerRef.current);
                recordingTimerRef.current = null;
            }
        };
    }, [isRecording, recordingStartTime]);

    // Helper function to request audio timestamps for a cell
    const requestCellAudioTimestamps = useCallback((cellId: string): Promise<Timestamps | null> => {
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
                    message?.type === "providerSendsCellAudioTimestamps" &&
                    message.content?.cellId === cellId
                ) {
                    if (!resolved) {
                        resolved = true;
                        clearTimeout(timeout);
                        window.removeEventListener("message", handler);
                        resolve(message.content.audioTimestamps || null);
                    }
                }
            };

            window.addEventListener("message", handler);
            window.vscodeApi.postMessage({
                command: "requestCellAudioTimestamps",
                content: { cellId },
            } as EditorPostMessages);
        });
    }, []);

    // Fetch previous/next cell audio timestamps
    useEffect(() => {
        let cancelled = false;

        const fetchAudioTimestamps = async () => {
            const promises: Promise<void>[] = [];

            if (prevCellId) {
                promises.push(
                    requestCellAudioTimestamps(prevCellId).then((timestamps) => {
                        if (!cancelled) {
                            setPrevAudioTimestamps(timestamps);
                        }
                    })
                );
            } else {
                setPrevAudioTimestamps(null);
            }

            if (nextCellId) {
                promises.push(
                    requestCellAudioTimestamps(nextCellId).then((timestamps) => {
                        if (!cancelled) {
                            setNextAudioTimestamps(timestamps);
                        }
                    })
                );
            } else {
                setNextAudioTimestamps(null);
            }

            await Promise.all(promises);
        };

        fetchAudioTimestamps();

        return () => {
            cancelled = true;
        };
    }, [prevCellId, nextCellId, requestCellAudioTimestamps]);

    // Refresh adjacent cell audio timestamps when their audio attachment state changes
    useEffect(() => {
        let cancelled = false;

        const refreshAdjacentTimestamps = async () => {
            const promises: Promise<void>[] = [];

            // Refresh previous cell timestamps if it has audio available
            if (
                prevCellId &&
                (audioAttachments?.[prevCellId] === "available" ||
                    audioAttachments?.[prevCellId] === "available-local" ||
                    audioAttachments?.[prevCellId] === "available-pointer")
            ) {
                promises.push(
                    requestCellAudioTimestamps(prevCellId).then((timestamps) => {
                        if (!cancelled) {
                            setPrevAudioTimestamps(timestamps);
                        }
                    })
                );
            }

            // Refresh next cell timestamps if it has audio available
            if (
                nextCellId &&
                (audioAttachments?.[nextCellId] === "available" ||
                    audioAttachments?.[nextCellId] === "available-local" ||
                    audioAttachments?.[nextCellId] === "available-pointer")
            ) {
                promises.push(
                    requestCellAudioTimestamps(nextCellId).then((timestamps) => {
                        if (!cancelled) {
                            setNextAudioTimestamps(timestamps);
                        }
                    })
                );
            }

            await Promise.all(promises);
        };

        refreshAdjacentTimestamps();

        return () => {
            cancelled = true;
        };
    }, [prevCellId, nextCellId, audioAttachments, requestCellAudioTimestamps]);

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
            const audioTs = contentBeingUpdated.cellAudioTimestamps;
            if (
                audioTs &&
                (typeof audioTs.startTime === "number" || typeof audioTs.endTime === "number")
            ) {
                const messageContent: EditorPostMessages = {
                    command: "updateCellAudioTimestamps",
                    content: {
                        cellId: cellMarkers[0],
                        timestamps: audioTs,
                    },
                };
                window.vscodeApi.postMessage(messageContent);
                // Optimistically clear staged audio timestamps - will be re-cleared by effect if needed
                const { cellAudioTimestamps, ...restAfterAudio } = contentBeingUpdated;
                setContentBeingUpdated(restAfterAudio as EditorCellContent);
            }
        }, 0);
    };

    // Timestamp editing bounds and effective state
    const previousEndBound = typeof prevEndTime === "number" ? prevEndTime : 0;
    const nextStartBound =
        typeof nextStartTime === "number" ? nextStartTime : Number.POSITIVE_INFINITY;
    const effectiveTimestamps: Timestamps | undefined =
        contentBeingUpdated.cellTimestamps ?? cellTimestamps;
    const effectiveAudioTimestamps: Timestamps | undefined = useMemo(() => {
        return (
            contentBeingUpdated.cellAudioTimestamps ??
            cell.audioTimestamps ??
            (cell.data?.audioStartTime !== undefined || cell.data?.audioEndTime !== undefined
                ? {
                      startTime: cell.data.audioStartTime,
                      endTime: cell.data.audioEndTime,
                  }
                : undefined)
        );
    }, [contentBeingUpdated.cellAudioTimestamps, cell.audioTimestamps, cell.data]);

    // Keep refs updated so saveAudioToCell can read current state when updating audio timestamps
    useEffect(() => {
        effectiveTimestampsRef.current = effectiveTimestamps;
    }, [effectiveTimestamps]);
    useEffect(() => {
        contentBeingUpdatedRef.current = contentBeingUpdated;
    }, [contentBeingUpdated]);

    // Reset previous audio timestamp values ref when effectiveAudioTimestamps changes
    useEffect(() => {
        if (effectiveAudioTimestamps) {
            const start = effectiveAudioTimestamps.startTime ?? 0;
            const end = effectiveAudioTimestamps.endTime ?? 0;
            previousAudioTimestampValuesRef.current = [start, end];
        } else {
            previousAudioTimestampValuesRef.current = null;
        }
    }, [effectiveAudioTimestamps]);

    // Initialize or sync audio timestamps when Timestamps tab is opened with current cell audio
    useEffect(() => {
        // Only run when Timestamps tab is active
        if (activeTab !== "timestamps") {
            return;
        }

        if (!audioBlob || !audioDuration || audioDuration <= 0) {
            return;
        }

        // Stored audio timestamps duration (if any) — compare to current audio duration
        const storedDuration = effectiveAudioTimestamps
            ? (effectiveAudioTimestamps.endTime ?? 0) - (effectiveAudioTimestamps.startTime ?? 0)
            : 0;
        const durationMismatch = Math.abs(storedDuration - audioDuration) > 0.01;

        // Initialize when no audio timestamps, or overwrite when current audio duration differs (e.g. new recording)
        const shouldUpdate =
            (!effectiveAudioTimestamps && !contentBeingUpdated.cellAudioTimestamps) ||
            durationMismatch;

        if (shouldUpdate) {
            // Use effectiveTimestamps startTime if available, otherwise use 0
            const startTime = effectiveTimestamps?.startTime ?? 0;
            const endTime = startTime + audioDuration;

            const initialAudioTimestamps: Timestamps = {
                startTime: Number(startTime.toFixed(3)),
                endTime: Number(endTime.toFixed(3)),
            };

            setContentBeingUpdated({
                ...contentBeingUpdated,
                cellAudioTimestamps: initialAudioTimestamps,
            });

            // Immediately save audio timestamps to provider so adjacent cells can see them
            const messageContent: EditorPostMessages = {
                command: "updateCellAudioTimestamps",
                content: {
                    cellId: cellMarkers[0],
                    timestamps: initialAudioTimestamps,
                },
            };
            window.vscodeApi.postMessage(messageContent);
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [
        activeTab,
        audioBlob,
        audioDuration,
        effectiveAudioTimestamps,
        effectiveTimestamps,
        prevCellId,
        nextCellId,
        requestCellAudioTimestamps,
    ]);

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

    const hasPrevAudioAvailable =
        !!prevCellId &&
        (audioAttachments?.[prevCellId] === "available" ||
            audioAttachments?.[prevCellId] === "available-local" ||
            audioAttachments?.[prevCellId] === "available-pointer");
    const hasNextAudioAvailable =
        !!nextCellId &&
        (audioAttachments?.[nextCellId] === "available" ||
            audioAttachments?.[nextCellId] === "available-local" ||
            audioAttachments?.[nextCellId] === "available-pointer");
    const canPlayAudioWithVideo =
        Boolean(audioBlob) || hasPrevAudioAvailable || hasNextAudioAvailable;

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

    // Helper function to clean up all overlapping audio (simplified - mainly for URL cleanup)
    const cleanupOverlappingAudio = useCallback(() => {
        // Clean up any remaining blob URLs
        overlappingAudioUrlsRef.current.forEach((url) => {
            URL.revokeObjectURL(url);
        });
        overlappingAudioUrlsRef.current.clear();
        overlappingAudioElementsRef.current.clear();
        overlappingAudioHandlersRef.current.clear();
        overlappingAudioDelaysRef.current.clear();
        overlappingAudioOffsetsRef.current.clear();
    }, []);

    /**
     * Convert AudioBuffer to WAV format blob
     */
    const audioBufferToWav = useCallback((buffer: AudioBuffer): ArrayBuffer => {
        const length = buffer.length;
        const numberOfChannels = buffer.numberOfChannels;
        const sampleRate = buffer.sampleRate;
        const arrayBuffer = new ArrayBuffer(44 + length * numberOfChannels * 2);
        const view = new DataView(arrayBuffer);

        // WAV header
        const writeString = (offset: number, string: string) => {
            for (let i = 0; i < string.length; i++) {
                view.setUint8(offset + i, string.charCodeAt(i));
            }
        };

        let offset = 0;
        writeString(offset, "RIFF");
        offset += 4;
        view.setUint32(offset, 36 + length * numberOfChannels * 2, true);
        offset += 4;
        writeString(offset, "WAVE");
        offset += 4;
        writeString(offset, "fmt ");
        offset += 4;
        view.setUint32(offset, 16, true);
        offset += 4;
        view.setUint16(offset, 1, true);
        offset += 2;
        view.setUint16(offset, numberOfChannels, true);
        offset += 2;
        view.setUint32(offset, sampleRate, true);
        offset += 4;
        view.setUint32(offset, sampleRate * numberOfChannels * 2, true);
        offset += 4;
        view.setUint16(offset, numberOfChannels * 2, true);
        offset += 2;
        view.setUint16(offset, 16, true);
        offset += 2;
        writeString(offset, "data");
        offset += 4;
        view.setUint32(offset, length * numberOfChannels * 2, true);
        offset += 4;

        // Convert float samples to 16-bit PCM
        for (let i = 0; i < length; i++) {
            for (let channel = 0; channel < numberOfChannels; channel++) {
                const sample = Math.max(-1, Math.min(1, buffer.getChannelData(channel)[i]));
                view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
                offset += 2;
            }
        }

        return arrayBuffer;
    }, []);

    /**
     * Combine multiple audio segments into a single audio blob
     * Uses Web Audio API to decode, extract portions, and concatenate audio
     */
    const combineAudioSegments = useCallback(
        async (
            segments: Array<{
                blob: Blob;
                startTime: number; // When this segment should start in the final audio (relative to timeline start)
                offsetInAudio: number; // Offset within the source audio blob to start from
                duration: number; // Duration to extract from the source audio
            }>,
            totalDuration: number, // Total duration of the final combined audio
            sampleRate: number = 44100
        ): Promise<Blob> => {
            const audioContext = new (window.AudioContext || (window as any).webkitAudioContext)({
                sampleRate,
            });

            // Create a buffer for the final combined audio
            const totalSamples = Math.ceil(totalDuration * sampleRate);
            const combinedBuffer = audioContext.createBuffer(1, totalSamples, sampleRate);
            const combinedData = combinedBuffer.getChannelData(0);

            // Process each segment
            for (let segIndex = 0; segIndex < segments.length; segIndex++) {
                const segment = segments[segIndex];
                try {
                    // Check cache first - use blob size + first few bytes as key
                    let audioBuffer: AudioBuffer | undefined;
                    const blobKey = `${segment.blob.size}-${segment.blob.type}`;

                    // Try to get from cache
                    audioBuffer = audioBufferCacheRef.current.get(blobKey);

                    if (!audioBuffer) {
                        // Decode the audio blob
                        const arrayBuffer = await segment.blob.arrayBuffer();
                        audioBuffer = await audioContext.decodeAudioData(arrayBuffer);
                        // Cache it
                        audioBufferCacheRef.current.set(blobKey, audioBuffer);
                    }

                    // Use the actual sample rate from the decoded audio buffer
                    const sourceSampleRate = audioBuffer.sampleRate;

                    // Calculate where this segment should be placed in the combined buffer (using target sample rate)
                    const startSample = Math.floor(segment.startTime * sampleRate);

                    // Calculate source audio positions using the source audio's sample rate
                    const sourceStartSample = Math.floor(segment.offsetInAudio * sourceSampleRate);
                    const sourceDurationSamples = Math.floor(segment.duration * sourceSampleRate);
                    const sourceEndSample = Math.min(
                        sourceStartSample + sourceDurationSamples,
                        audioBuffer.length
                    );
                    const actualSourceSamples = sourceEndSample - sourceStartSample;

                    // Calculate how many samples we need in the combined buffer (using target sample rate)
                    const targetDurationSamples = Math.floor(segment.duration * sampleRate);
                    const segmentSamples = Math.min(
                        targetDurationSamples,
                        totalSamples - startSample
                    );

                    // Extract the portion we need from the source audio
                    const sourceData = audioBuffer.getChannelData(0);

                    // Mix the audio data into the combined buffer with sample rate conversion
                    if (sourceSampleRate === sampleRate) {
                        // Same sample rate - direct mix
                        for (let i = 0; i < segmentSamples && startSample + i < totalSamples; i++) {
                            const sourceIndex = sourceStartSample + i;
                            if (sourceIndex < sourceData.length && sourceIndex < sourceEndSample) {
                                // Add to existing value to mix overlapping segments
                                combinedData[startSample + i] += sourceData[sourceIndex];
                            }
                        }
                    } else {
                        // Different sample rate - resample using linear interpolation
                        const ratio = sourceSampleRate / sampleRate;
                        for (let i = 0; i < segmentSamples && startSample + i < totalSamples; i++) {
                            const sourceIndexFloat = sourceStartSample + i * ratio;
                            const sourceIndex = Math.floor(sourceIndexFloat);
                            const nextIndex = Math.min(sourceIndex + 1, sourceEndSample - 1);

                            if (sourceIndex < sourceData.length && sourceIndex < sourceEndSample) {
                                let sampleValue: number;
                                if (
                                    nextIndex > sourceIndex &&
                                    nextIndex < sourceEndSample &&
                                    sourceIndexFloat !== sourceIndex
                                ) {
                                    // Linear interpolation
                                    const fraction = sourceIndexFloat - sourceIndex;
                                    sampleValue =
                                        sourceData[sourceIndex] * (1 - fraction) +
                                        sourceData[nextIndex] * fraction;
                                } else {
                                    // No interpolation needed (exact match or at boundary)
                                    sampleValue = sourceData[sourceIndex];
                                }
                                // Add to existing value to mix overlapping segments
                                combinedData[startSample + i] += sampleValue;
                            }
                        }
                    }
                } catch (error) {
                    console.warn("Error processing audio segment:", error);
                    // Continue with other segments even if one fails
                }
            }

            // Normalize the audio to prevent clipping when multiple segments overlap
            let maxAmplitude = 0;
            for (let i = 0; i < totalSamples; i++) {
                const absValue = Math.abs(combinedData[i]);
                if (absValue > maxAmplitude) {
                    maxAmplitude = absValue;
                }
            }

            // If the maximum amplitude exceeds 1.0, normalize to prevent clipping
            if (maxAmplitude > 1.0) {
                const normalizationFactor = 1.0 / maxAmplitude;
                for (let i = 0; i < totalSamples; i++) {
                    combinedData[i] *= normalizationFactor;
                }
            }

            // Convert the combined buffer back to a blob
            const wavBuffer = audioBufferToWav(combinedBuffer);
            return new Blob([wavBuffer], { type: "audio/wav" });
        },
        [audioBufferToWav]
    );

    // Memoized combined audio blob - combines current cell + overlapping segments
    // Created on-demand in handlePlayAudioWithVideo and cached
    const combinedAudioBlobRef = useRef<Blob | null>(null);
    const combinedAudioBlobKeyRef = useRef<string>("");

    // Generate a key for the current audio configuration to detect changes
    const getCombinedAudioKey = useCallback(() => {
        const startTime = effectiveTimestamps?.startTime;
        const endTime = effectiveTimestamps?.endTime;
        const audioStart = effectiveAudioTimestamps?.startTime;
        const audioEnd = effectiveAudioTimestamps?.endTime;
        const prevAudioStart = prevAudioTimestamps?.startTime ?? prevStartTime;
        const prevAudioEnd = prevAudioTimestamps?.endTime ?? prevEndTime;
        const nextAudioStart = nextAudioTimestamps?.startTime ?? nextStartTime;
        const nextAudioEnd = nextAudioTimestamps?.endTime ?? nextEndTime;
        return `${audioBlob ? "hasCurrent" : "noCurrent"}-${prevCellId || "none"}-${
            nextCellId || "none"
        }-${startTime}-${endTime}-${audioStart}-${audioEnd}-${prevAudioStart}-${prevAudioEnd}-${nextAudioStart}-${nextAudioEnd}-${combinedAudioBlobKey}`;
    }, [
        audioBlob,
        prevCellId,
        nextCellId,
        effectiveTimestamps,
        effectiveAudioTimestamps,
        prevStartTime,
        prevEndTime,
        prevAudioTimestamps,
        nextStartTime,
        nextEndTime,
        nextAudioTimestamps,
        combinedAudioBlobKey,
    ]);

    // Debounced handler to invalidate combined audio blob cache when timestamps change
    const debouncedInvalidateCombinedAudio = useMemo(() => {
        let timeoutId: NodeJS.Timeout | null = null;
        return () => {
            if (timeoutId) {
                clearTimeout(timeoutId);
            }
            timeoutId = setTimeout(() => {
                // Invalidate cache by updating the key
                setCombinedAudioBlobKey((prev) => prev + 1);
                combinedAudioBlobRef.current = null;
                combinedAudioBlobKeyRef.current = "";
            }, 2000); // 2 second debounce
        };
    }, []);

    // Handler to play audio blob with synchronized video playback
    const handlePlayAudioWithVideo = useCallback(async () => {
        // Validate prerequisites
        const startTime = effectiveTimestamps?.startTime;
        const endTime = effectiveTimestamps?.endTime;

        if (startTime === undefined || endTime === undefined) {
            console.warn("Timestamps are not available");
            return;
        }

        if (endTime <= startTime) {
            console.warn("Invalid timestamps: endTime must be greater than startTime");
            return;
        }

        setIsPlayAudioLoading(true);
        try {
            // Clean up any existing playback
            if (audioElementRef.current) {
                if (audioTimeUpdateHandlerRef.current) {
                    audioElementRef.current.removeEventListener(
                        "timeupdate",
                        audioTimeUpdateHandlerRef.current
                    );
                    audioTimeUpdateHandlerRef.current = null;
                }
                const currentUrl = overlappingAudioUrlsRef.current.get("combined");
                if (currentUrl) {
                    URL.revokeObjectURL(currentUrl);
                    overlappingAudioUrlsRef.current.delete("combined");
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

            // Collect all audio segments that need to be combined
            const totalDuration = endTime - startTime;
            const segments: Array<{
                blob: Blob;
                startTime: number;
                offsetInAudio: number;
                duration: number;
            }> = [];

            // Check if we have a cached combined blob for this configuration
            const currentKey = getCombinedAudioKey();
            let combinedBlob = combinedAudioBlobRef.current;

            if (!combinedBlob || combinedAudioBlobKeyRef.current !== currentKey) {
                // Need to create new combined blob
                // Collect segments

                // Current cell audio
                if (audioBlob) {
                    const resolvedAudioStartTime = effectiveAudioTimestamps?.startTime ?? startTime;
                    const resolvedAudioEndTime = effectiveAudioTimestamps?.endTime ?? endTime;
                    const playStartTime = Math.max(resolvedAudioStartTime, startTime);
                    const playEndTime = Math.min(resolvedAudioEndTime, endTime);

                    if (playEndTime > playStartTime) {
                        const offsetInAudio = playStartTime - resolvedAudioStartTime;
                        const duration = playEndTime - playStartTime;
                        const startTimeInCombined = playStartTime - startTime;

                        segments.push({
                            blob: audioBlob,
                            startTime: startTimeInCombined,
                            offsetInAudio,
                            duration,
                        });
                    }
                }

                // Previous cell audio - use audio timestamps if available, fallback to video timestamps
                if (prevCellId) {
                    const prevAudioStart = prevAudioTimestamps?.startTime ?? prevStartTime;
                    const prevAudioEnd = prevAudioTimestamps?.endTime ?? prevEndTime;

                    if (
                        typeof prevAudioStart === "number" &&
                        typeof prevAudioEnd === "number" &&
                        startTime < prevAudioEnd
                    ) {
                        const prevBlob = await requestAudioBlob(prevCellId);
                        if (prevBlob) {
                            const playStartTime = Math.max(prevAudioStart, startTime);
                            const playEndTime = Math.min(prevAudioEnd, endTime);

                            if (playEndTime > playStartTime) {
                                const offsetInAudio = playStartTime - prevAudioStart;
                                const duration = playEndTime - playStartTime;
                                const startTimeInCombined = playStartTime - startTime;

                                segments.push({
                                    blob: prevBlob,
                                    startTime: startTimeInCombined,
                                    offsetInAudio,
                                    duration,
                                });
                            }
                        }
                    }
                }

                // Next cell audio - use audio timestamps if available, fallback to video timestamps
                if (nextCellId) {
                    const nextAudioStart = nextAudioTimestamps?.startTime ?? nextStartTime;
                    const nextAudioEnd = nextAudioTimestamps?.endTime ?? nextEndTime;

                    if (
                        typeof nextAudioStart === "number" &&
                        typeof nextAudioEnd === "number" &&
                        endTime > nextAudioStart
                    ) {
                        const nextBlob = await requestAudioBlob(nextCellId);
                        if (nextBlob) {
                            const playStartTime = Math.max(nextAudioStart, startTime);
                            const playEndTime = Math.min(nextAudioEnd, endTime);

                            if (playEndTime > playStartTime) {
                                const offsetInAudio = playStartTime - nextAudioStart;
                                const duration = playEndTime - playStartTime;
                                const startTimeInCombined = playStartTime - startTime;

                                segments.push({
                                    blob: nextBlob,
                                    startTime: startTimeInCombined,
                                    offsetInAudio,
                                    duration,
                                });
                            }
                        }
                    }
                }

                // Combine segments if we have any
                if (segments.length > 0) {
                    try {
                        combinedBlob = await combineAudioSegments(segments, totalDuration);
                        combinedAudioBlobRef.current = combinedBlob;
                        combinedAudioBlobKeyRef.current = currentKey;
                        setAudioWarning(null);
                    } catch (error) {
                        console.error("Error combining audio segments:", error);
                        combinedBlob = null;
                    }
                } else {
                    setAudioWarning("No audio available in the current video timestamp range");
                    return;
                }
            }

            if (!combinedBlob) {
                console.warn("No combined audio blob available");
                return;
            }

            // Helper function to clean up all audio and video
            const cleanupAll = () => {
                if (audioElementRef.current) {
                    if (audioTimeUpdateHandlerRef.current) {
                        audioElementRef.current.removeEventListener(
                            "timeupdate",
                            audioTimeUpdateHandlerRef.current
                        );
                        audioTimeUpdateHandlerRef.current = null;
                    }
                    const combinedUrl = overlappingAudioUrlsRef.current.get("combined");
                    if (combinedUrl) {
                        URL.revokeObjectURL(combinedUrl);
                        overlappingAudioUrlsRef.current.delete("combined");
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

            // Create single audio element from combined blob
            const audioUrl = URL.createObjectURL(combinedBlob);
            overlappingAudioUrlsRef.current.set("combined", audioUrl);
            const audio = new Audio(audioUrl);
            audioElementRef.current = audio;

            // Set up audio event handlers
            audio.onended = () => {
                if (!videoElementRef.current) {
                    cleanupAll();
                }
            };
            audio.onerror = () => {
                const error = audio.error;
                // Only log if it's a real error (not just unsupported format - code 4)
                // MediaError codes: 1=ABORTED, 2=NETWORK, 3=DECODE, 4=SRC_NOT_SUPPORTED
                if (error && error.code !== 4) {
                    const errorMessage = error.message
                        ? `Error loading combined audio: ${error.message}`
                        : "Error loading combined audio";
                    console.warn(errorMessage);
                }
            };

            // Set up timeupdate listener to stop at endTime
            const audioTimeUpdateHandler = (e: Event) => {
                const target = e.target as HTMLAudioElement;
                if (target.currentTime >= totalDuration) {
                    target.pause();
                    if (audioTimeUpdateHandlerRef.current) {
                        target.removeEventListener("timeupdate", audioTimeUpdateHandlerRef.current);
                        audioTimeUpdateHandlerRef.current = null;
                    }
                    cleanupAll();
                }
            };

            audioTimeUpdateHandlerRef.current = audioTimeUpdateHandler;
            audio.addEventListener("timeupdate", audioTimeUpdateHandler);

            // Wait for audio to be ready
            await new Promise<void>((resolve, reject) => {
                const handleLoadedMetadata = () => {
                    audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
                    audio.removeEventListener("error", handleError);
                    resolve();
                };

                const handleError = () => {
                    audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
                    audio.removeEventListener("error", handleError);
                    const error = audio.error;
                    const errorMessage = error?.message || "Error loading combined audio";
                    reject(new Error(errorMessage));
                };

                if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) {
                    handleLoadedMetadata();
                } else {
                    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
                    audio.addEventListener("error", handleError);
                }
            });

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

                        // Check if we're already past the end time (shouldn't happen, but be safe)
                        if (videoElement.currentTime >= endTime) {
                            // Already past end time, don't play
                            videoElement.pause();
                            cleanupAll();
                        } else {
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
                                    cleanupAll();
                                }
                            };

                            // Start video playback first, then set up the handler
                            // This prevents the handler from firing and pausing before play() resolves
                            try {
                                await videoElement.play();

                                // Only set up the handler after play() succeeds
                                // This prevents race conditions where pause() interrupts play()
                                videoTimeUpdateHandlerRef.current = timeUpdateHandler;
                                videoElement.addEventListener("timeupdate", timeUpdateHandler);
                            } catch (playError) {
                                // Suppress AbortError warnings - these are expected when pause() interrupts play()
                                // This can happen if cleanup is called while play() is pending
                                if (
                                    playError instanceof Error &&
                                    playError.name !== "AbortError" &&
                                    playError.name !== "NotAllowedError"
                                ) {
                                    console.warn("Video play() failed:", playError);
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error("Error setting up video playback:", error);
                }
            }

            // Play the combined audio using globalAudioController to prevent duplicate playback
            // This ensures useMultiCellAudioPlayback knows audio is already playing
            try {
                await globalAudioController.playExclusive(audio);
            } catch (playError) {
                if (
                    playError instanceof Error &&
                    playError.name !== "AbortError" &&
                    playError.name !== "NotAllowedError"
                ) {
                    console.error("Error playing combined audio:", playError);
                    cleanupAll();
                }
            }
        } finally {
            setIsPlayAudioLoading(false);
        }
    }, [
        audioBlob,
        effectiveTimestamps,
        effectiveAudioTimestamps,
        shouldShowVideoPlayer,
        videoUrl,
        playerRef,
        muteVideoAudioDuringPlayback,
        prevCellId,
        prevStartTime,
        prevEndTime,
        prevAudioTimestamps,
        nextCellId,
        nextStartTime,
        nextEndTime,
        nextAudioTimestamps,
        requestAudioBlob,
        combineAudioSegments,
        getCombinedAudioKey,
    ]);

    useEffect(() => {
        setEditableLabel(cellLabel || "");
    }, [cellLabel]);

    // Cleanup audio/video playback on unmount or when cell changes
    useEffect(() => {
        // Capture refs for cleanup
        const audioElement = audioElementRef.current;
        const audioHandler = audioTimeUpdateHandlerRef.current;
        const audioUrls = overlappingAudioUrlsRef.current;
        const audioBufferCache = audioBufferCacheRef.current;

        return () => {
            // Clean up audio element
            if (audioElement) {
                if (audioHandler) {
                    audioElement.removeEventListener("timeupdate", audioHandler);
                }
                const combinedUrl = audioUrls.get("combined");
                if (combinedUrl) {
                    URL.revokeObjectURL(combinedUrl);
                    audioUrls.delete("combined");
                }
                audioElement.pause();
                audioElement.src = "";
            }
            // Clear combined audio blob cache
            combinedAudioBlobRef.current = null;
            combinedAudioBlobKeyRef.current = "";
            // Clear audio buffer cache when cell changes
            audioBufferCache.clear();

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

    // Clear staged audio timestamps when persisted values update to match (after successful save)
    useEffect(() => {
        const staged = contentBeingUpdated.cellAudioTimestamps;
        const persisted = cell.audioTimestamps;

        // Only clear if we have staged audio timestamps and they match the persisted values
        if (staged && persisted) {
            const startMatch =
                (staged.startTime ?? undefined) === (persisted.startTime ?? undefined);
            const endMatch = (staged.endTime ?? undefined) === (persisted.endTime ?? undefined);

            if (startMatch && endMatch) {
                // Audio timestamps match - clear staged changes
                const { cellAudioTimestamps, ...rest } = contentBeingUpdated;
                setContentBeingUpdated(rest as EditorCellContent);
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cell.audioTimestamps, contentBeingUpdated.cellAudioTimestamps]);

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
    const startRecording = () => {
        // Prevent recording if cell is locked
        if (isCellLocked) {
            setRecordingStatus("Cannot record: cell is locked");
            return;
        }

        // If already recording or countdown active, do nothing (stopRecording handles stopping)
        if (isRecording || countdown !== null) {
            return;
        }

        // Check if timestamps are available
        if (!cellTimestamps?.startTime || !cellTimestamps?.endTime) {
            setRecordingStatus("Cannot record: video timestamps not available for this cell");
            return;
        }

        // Start countdown from 3
        setCountdown(3);
        setRecordingStatus("Starting in 3...");
    };

    const stopRecording = () => {
        // Cancel countdown if in progress
        if (countdown !== null) {
            setCountdown(null);
            setRecordingStatus("");
            if (countdownIntervalRef.current) {
                clearInterval(countdownIntervalRef.current);
                countdownIntervalRef.current = null;
            }
            return;
        }

        // Stop actual recording
        if (mediaRecorder && mediaRecorder.state !== "inactive") {
            mediaRecorder.stop();
        }

        // Clean up timers
        if (recordingTimerRef.current) {
            clearInterval(recordingTimerRef.current);
            recordingTimerRef.current = null;
        }
        setRecordingStartTime(null);
        setRecordingElapsedTime(0);
    };

    const saveAudioToCell = useCallback(
        (blob: Blob) => {
            setIsAudioSaving(true);
            setRecordingStatus("Saving audio…");

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
                const allowedExtensions = new Set([
                    "webm",
                    "wav",
                    "mp3",
                    "m4a",
                    "ogg",
                    "aac",
                    "flac",
                ]);
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
                let durationSec: number | undefined;
                try {
                    const arrayBuf = await blob.arrayBuffer();
                    // Decode to PCM to obtain duration and channels
                    const audioCtx = new (window.AudioContext ||
                        (window as any).webkitAudioContext)({
                        sampleRate: 48000,
                    } as any);
                    const decoded = await audioCtx.decodeAudioData(arrayBuf.slice(0));
                    durationSec = decoded.duration;
                    const channels = decoded.numberOfChannels;
                    // Approximated bitrate in kbps: size(bytes)*8 / duration(seconds) / 1000
                    const bitrateKbps =
                        durationSec > 0
                            ? Math.round((blob.size * 8) / durationSec / 1000)
                            : undefined;
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

                // Update Timestamps tab with current cell audio so it stays in sync after recording
                if (typeof durationSec === "number" && durationSec > 0) {
                    const startTime = effectiveTimestampsRef.current?.startTime ?? 0;
                    const endTime = startTime + durationSec;
                    const newAudioTimestamps: Timestamps = {
                        startTime: Number(startTime.toFixed(3)),
                        endTime: Number(endTime.toFixed(3)),
                    };
                    setContentBeingUpdated({
                        ...contentBeingUpdatedRef.current,
                        cellAudioTimestamps: newAudioTimestamps,
                    });
                    window.vscodeApi.postMessage({
                        command: "updateCellAudioTimestamps",
                        content: {
                            cellId: cellMarkers[0],
                            timestamps: newAudioTimestamps,
                        },
                    });
                }

                // Send to provider to save file
                const requestId =
                    typeof crypto !== "undefined" &&
                    typeof (crypto as any).randomUUID === "function"
                        ? (crypto as any).randomUUID()
                        : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
                audioSaveRequestIdRef.current = requestId;

                const messageContent: EditorPostMessages = {
                    command: "saveAudioAttachment",
                    requestId,
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
        },
        [cellMarkers, setContentBeingUpdated]
    );

    // Keep ref updated with saveAudioToCell function
    useEffect(() => {
        saveAudioToCellRef.current = saveAudioToCell;
    }, [saveAudioToCell]);

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
        // Prevent uploading if cell is locked
        if (isCellLocked) {
            setRecordingStatus("Cannot upload: cell is locked");
            // Reset the input so the same file can't be selected again
            event.target.value = "";
            return;
        }

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
        // If requested by list view, auto-record (only if cell is not locked)
        // Do not auto-open any tab. If auto-recording was requested, start in background without changing tabs.
        try {
            const autoRecord = sessionStorage.getItem(`start-audio-recording-${cellMarkers[0]}`);
            if (autoRecord && !isCellLocked) {
                setShowRecorder(true);
                setTimeout(() => {
                    startRecording();
                    sessionStorage.removeItem(`start-audio-recording-${cellMarkers[0]}`);
                }, 300);
            } else if (autoRecord && isCellLocked) {
                // Clear the auto-record flag if cell is locked
                sessionStorage.removeItem(`start-audio-recording-${cellMarkers[0]}`);
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
                const reqId = message?.content?.requestId as string | undefined;
                const pendingReqId = audioSaveRequestIdRef.current;
                // If provider echoes a requestId, only clear saving for the matching request.
                if (reqId && pendingReqId && reqId !== pendingReqId) {
                    return;
                }

                setIsAudioSaving(false);
                audioSaveRequestIdRef.current = null;

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

    const currentAudioTimestampSlider = () => {
        if (!audioBlob || !audioDuration) {
            return null;
        }

        const currentStart =
            effectiveAudioTimestamps?.startTime ?? effectiveTimestamps?.startTime ?? 0;
        const currentEnd =
            effectiveAudioTimestamps?.endTime ??
            (currentStart && currentStart + audioDuration) ??
            audioDuration;

        // Calculate bounds: min = 0 or prevStartTime, max = audioDuration or nextEndTime
        const audioMinBound = typeof prevStartTime === "number" ? Math.max(0, prevStartTime) : 0;
        const audioMaxBound = typeof nextEndTime === "number" ? nextEndTime : audioDuration;

        // Initialize previous values ref if needed
        if (previousAudioTimestampValuesRef.current === null) {
            previousAudioTimestampValuesRef.current = [currentStart, currentEnd];
        }

        return (
            <>
                <Slider
                    min={audioMinBound}
                    max={audioMaxBound}
                    value={[currentStart, currentEnd]}
                    step={0.001}
                    className="audio-timestamp-slider"
                    onValueChange={(vals: number[]) => {
                        const [newStart, newEnd] = vals;
                        const prev = previousAudioTimestampValuesRef.current;
                        if (!prev) {
                            previousAudioTimestampValuesRef.current = [newStart, newEnd];
                            return;
                        }

                        const [prevStart, prevEnd] = prev;
                        const prevDuration = prevEnd - prevStart;

                        // Calculate which handle moved and by how much
                        const startDelta = newStart - prevStart;
                        const endDelta = newEnd - prevEnd;

                        // Determine which handle was dragged (the one that moved more)
                        let offset: number;
                        if (Math.abs(startDelta) > Math.abs(endDelta)) {
                            // Start handle was dragged
                            offset = startDelta;
                        } else {
                            // End handle was dragged
                            offset = endDelta;
                        }

                        // Apply the same offset to both handles (synchronized block movement)
                        let newClampedStart = prevStart + offset;
                        let newClampedEnd = prevEnd + offset;

                        // Clamp to bounds
                        newClampedStart = Math.max(
                            audioMinBound,
                            Math.min(newClampedStart, audioMaxBound - prevDuration)
                        );
                        newClampedEnd = Math.min(
                            audioMaxBound,
                            Math.max(newClampedEnd, audioMinBound + prevDuration)
                        );

                        // Ensure duration is maintained
                        if (newClampedEnd - newClampedStart !== prevDuration) {
                            // If clamping changed the duration, adjust to maintain it
                            if (newClampedStart + prevDuration <= audioMaxBound) {
                                newClampedEnd = newClampedStart + prevDuration;
                            } else if (newClampedEnd - prevDuration >= audioMinBound) {
                                newClampedStart = newClampedEnd - prevDuration;
                            } else {
                                // If we can't maintain duration, use the new values but ensure valid range
                                newClampedStart = Math.max(audioMinBound, newClampedStart);
                                newClampedEnd = Math.min(audioMaxBound, newClampedEnd);
                                if (newClampedEnd <= newClampedStart) {
                                    newClampedEnd = newClampedStart + 0.001;
                                }
                            }
                        }

                        previousAudioTimestampValuesRef.current = [newClampedStart, newClampedEnd];

                        const updatedAudioTimestamps: Timestamps = {
                            startTime: Number(newClampedStart.toFixed(3)),
                            endTime: Number(newClampedEnd.toFixed(3)),
                        };

                        setContentBeingUpdated({
                            ...contentBeingUpdated,
                            cellAudioTimestamps: updatedAudioTimestamps,
                            cellChanged: true,
                        });
                        setUnsavedChanges(true);
                        // Invalidate combined audio blob cache after debounce
                        debouncedInvalidateCombinedAudio();
                    }}
                />
                <div className="flex justify-between text-xs text-muted-foreground mt-4">
                    <span>Min: {formatTime(audioMinBound)}</span>
                    <span>Max: {formatTime(audioMaxBound)}</span>
                </div>
            </>
        );
    };

    const currentTimestampSlider = () => {
        if (
            isSubtitlesType &&
            effectiveTimestamps &&
            (effectiveTimestamps.startTime !== undefined ||
                effectiveTimestamps.endTime !== undefined)
        ) {
            return (
                <>
                    <Slider
                        min={extendedMinBound}
                        max={Math.max(
                            extendedMaxBound,
                            effectiveTimestamps.endTime ?? extendedMinBound
                        )}
                        value={[
                            Math.max(
                                extendedMinBound,
                                effectiveTimestamps.startTime ?? extendedMinBound
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
                            const clampedStart = Math.max(extendedMinBound, Math.min(start, end));
                            const clampedEnd = Math.min(
                                extendedMaxBound,
                                Math.max(end, clampedStart)
                            );
                            const updatedTimestamps: Timestamps = {
                                ...effectiveTimestamps,
                                startTime: Number(clampedStart.toFixed(3)),
                                endTime: Number(clampedEnd.toFixed(3)),
                            };
                            setContentBeingUpdated({
                                ...contentBeingUpdated,
                                cellTimestamps: updatedTimestamps,
                                cellChanged: true,
                            });
                            setUnsavedChanges(true);
                            // Invalidate combined audio blob cache after debounce
                            debouncedInvalidateCombinedAudio();
                        }}
                    />
                </>
            );
        } else if (
            !isSubtitlesType &&
            effectiveTimestamps &&
            (effectiveTimestamps.startTime !== undefined ||
                effectiveTimestamps.endTime !== undefined)
        ) {
            return (
                <>
                    <Slider
                        min={Math.max(0, previousEndBound)}
                        max={Math.max(computedMaxBound, effectiveTimestamps.endTime ?? 0)}
                        value={[
                            Math.max(
                                Math.max(0, previousEndBound),
                                effectiveTimestamps.startTime ?? 0
                            ),
                            Math.min(
                                nextStartBound,
                                effectiveTimestamps.endTime ?? effectiveTimestamps.startTime ?? 0
                            ),
                        ]}
                        step={0.001}
                        onValueChange={(vals: number[]) => {
                            const [start, end] = vals;
                            const clampedStart = Math.max(
                                Math.max(0, previousEndBound),
                                Math.min(start, end)
                            );
                            const clampedEnd = Math.min(
                                nextStartBound,
                                Math.max(end, clampedStart)
                            );
                            const updatedTimestamps: Timestamps = {
                                ...effectiveTimestamps,
                                startTime: Number(clampedStart.toFixed(3)),
                                endTime: Number(clampedEnd.toFixed(3)),
                            };
                            setContentBeingUpdated({
                                ...contentBeingUpdated,
                                cellTimestamps: updatedTimestamps,
                                cellChanged: true,
                            });
                            setUnsavedChanges(true);
                            // Invalidate combined audio blob cache after debounce
                            debouncedInvalidateCombinedAudio();
                        }}
                    />
                    <div className="flex justify-between text-xs text-muted-foreground mt-2">
                        <span>Min: {formatTime(Math.max(0, previousEndBound))}</span>
                        <span>Max: {formatTime(computedMaxBound)}</span>
                    </div>
                </>
            );
        } else {
            return null;
        }
    };

    const effectiveDuration = (nextEndTime ?? 0) - (prevStartTime ?? 0);

    const previousTimestampWidth = () => {
        const prevAudioDuration = (prevEndTime ?? 0) - (prevStartTime ?? 0);

        if (prevAudioDuration > effectiveDuration) {
            return 100;
        }

        return (prevAudioDuration / (extendedMaxBound - extendedMinBound)) * 100;
    };

    const previousAudioTimestampWidth = () => {
        if (!prevAudioTimestamps?.startTime || !prevAudioTimestamps?.endTime) {
            return 0;
        }

        const videoRangeStart = prevStartTime ?? 0;
        const videoRangeEnd = nextEndTime ?? 0;
        const videoRange = videoRangeEnd - videoRangeStart;

        if (videoRange <= 0) {
            return 0;
        }

        // Calculate the actual start and end positions within the video range
        const audioStart = Math.max(videoRangeStart, prevAudioTimestamps.startTime);
        const audioEnd = Math.min(videoRangeEnd, prevAudioTimestamps.endTime);

        // If audio starts after video range or ends before it starts, return 0
        if (audioStart >= videoRangeEnd || audioEnd <= videoRangeStart) {
            return 0;
        }

        const visibleDuration = audioEnd - audioStart;
        const width = (visibleDuration / videoRange) * 100;

        // Cap at 100% to prevent overflow
        return Math.min(100, Math.max(0, width));
    };

    const previousAudioTimestampOffset = () => {
        const videoRangeStart = prevStartTime ?? 0;
        const videoRangeEnd = nextEndTime ?? 0;
        const videoRange = videoRangeEnd - videoRangeStart;

        if (videoRange <= 0 || !prevAudioTimestamps?.startTime) {
            return 0;
        }

        // Calculate the actual start position (clipped to video range)
        const audioStart = Math.max(videoRangeStart, prevAudioTimestamps.startTime);
        const audioStartPosition = audioStart - videoRangeStart;
        return (audioStartPosition / videoRange) * 100;
    };

    const nextTimestampWidth = () => {
        const nextAudioDuration = (nextEndTime ?? 0) - (nextStartTime ?? 0);

        if (nextAudioDuration > effectiveDuration) {
            return 100;
        }

        return (nextAudioDuration / (extendedMaxBound - extendedMinBound)) * 100;
    };

    const nextAudioTimestampWidth = () => {
        if (!nextAudioTimestamps?.startTime || !nextAudioTimestamps?.endTime) {
            return 0;
        }

        const videoRangeStart = prevStartTime ?? 0;
        const videoRangeEnd = nextEndTime ?? 0;
        const videoRange = videoRangeEnd - videoRangeStart;

        if (videoRange <= 0) {
            return 0;
        }

        // Calculate the actual start and end positions within the video range
        const audioStart = Math.max(videoRangeStart, nextAudioTimestamps.startTime);
        const audioEnd = Math.min(videoRangeEnd, nextAudioTimestamps.endTime);

        // If audio starts after video range or ends before it starts, return 0
        if (audioStart >= videoRangeEnd || audioEnd <= videoRangeStart) {
            return 0;
        }

        const visibleDuration = audioEnd - audioStart;
        const width = (visibleDuration / videoRange) * 100;

        // Cap at 100% to prevent overflow
        return Math.min(100, Math.max(0, width));
    };

    const nextAudioTimestampOffset = () => {
        const videoRangeStart = prevStartTime ?? 0;
        const videoRangeEnd = nextEndTime ?? 0;
        const videoRange = videoRangeEnd - videoRangeStart;

        if (videoRange <= 0 || !nextAudioTimestamps?.startTime) {
            return 0;
        }

        // Calculate the actual start position (clipped to video range)
        const audioStart = Math.max(videoRangeStart, nextAudioTimestamps.startTime);
        const audioStartPosition = audioStart - videoRangeStart;
        return (audioStartPosition / videoRange) * 100;
    };

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
                                        onClick={() => {
                                            if (cell.metadata?.isLocked) return;
                                            editorHandlesRef.current?.autocomplete();
                                        }}
                                        variant="ghost"
                                        size="icon"
                                        title="Autocomplete with AI"
                                        disabled={cell.metadata?.isLocked ?? false}
                                        className={
                                            cell.metadata?.isLocked
                                                ? "opacity-50 cursor-not-allowed"
                                                : ""
                                        }
                                    >
                                        <Sparkles
                                            className={`h-4 w-4 ${
                                                cell.metadata?.isLocked ? "opacity-50" : ""
                                            }`}
                                        />
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
                            <div
                                className={cn(
                                    "content-section",
                                    isSubtitlesType ? "px-7 py-4 space-y-4" : "p-4"
                                )}
                            >
                                <div className="flex justify-between">
                                    <h3 className="text-lg font-medium">Timestamps</h3>
                                    {isSubtitlesType && (
                                        <div className="flex flex-col items-end gap-2">
                                            <div className="flex items-center gap-1">
                                                <Languages className="w-4 h-4 text-muted-foreground/80" />
                                                <span className="w-16 h-[4px] rounded-full bg-primary"></span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <MicrophoneIcon className="w-4 h-4 text-muted-foreground/80" />
                                                <span className="w-16 h-[4px] rounded-full bg-[#ff9500]"></span>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {effectiveTimestamps &&
                                (effectiveTimestamps.startTime !== undefined ||
                                    effectiveTimestamps.endTime !== undefined) ? (
                                    <div className="space-y-4">
                                        {/* Scrubber with clamped handles */}
                                        <div className="space-y-2 mt-1">
                                            {/* Previous cell slider - read-only */}
                                            {isSubtitlesType &&
                                                typeof prevStartTime === "number" &&
                                                typeof prevEndTime === "number" &&
                                                prevStartTime < prevEndTime && (
                                                    <div className="flex flex-col space-y-1 w-full">
                                                        <label className="text-sm font-medium text-muted-foreground">
                                                            Previous cell range
                                                        </label>
                                                        <div
                                                            className="flex flex-col space-y-1 relative"
                                                            style={{
                                                                width: `${previousTimestampWidth()}%`,
                                                            }}
                                                        >
                                                            <Slider
                                                                disabled
                                                                min={prevStartTime}
                                                                max={prevEndTime}
                                                                value={[prevStartTime, prevEndTime]}
                                                                step={0.001}
                                                                className="opacity-60"
                                                            />
                                                            <div className="flex min-w-max text-xs text-muted-foreground">
                                                                <span>
                                                                    End: {formatTime(prevEndTime)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                            {/* Previous audio slider - read-only */}
                                            {audioBlob &&
                                                audioDuration &&
                                                prevAudioTimestamps &&
                                                typeof prevAudioTimestamps.startTime === "number" &&
                                                typeof prevAudioTimestamps.endTime === "number" &&
                                                prevAudioTimestamps.startTime <
                                                    prevAudioTimestamps.endTime && (
                                                    <div className="flex flex-col -mt-[0.25rem] w-full overflow-hidden">
                                                        <div
                                                            className="flex flex-col space-y-1 relative"
                                                            style={{
                                                                width: `${previousAudioTimestampWidth()}%`,
                                                                marginLeft: `${previousAudioTimestampOffset()}%`,
                                                                maxWidth: `calc(100% - ${previousAudioTimestampOffset()}%)`,
                                                            }}
                                                        >
                                                            <Slider
                                                                disabled
                                                                min={prevAudioTimestamps.startTime}
                                                                max={prevAudioTimestamps.endTime}
                                                                value={[
                                                                    prevAudioTimestamps.startTime,
                                                                    prevAudioTimestamps.endTime,
                                                                ]}
                                                                step={0.001}
                                                                className="opacity-60 audio-timestamp-slider"
                                                            />
                                                            <div className="flex min-w-max text-xs text-muted-foreground">
                                                                <span>
                                                                    End:{" "}
                                                                    {formatTime(
                                                                        prevAudioTimestamps.endTime
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                            <div
                                                className={cn(
                                                    "flex flex-col rounded-md",
                                                    isSubtitlesType
                                                        ? "-mx-[1rem] px-[1rem] border border-muted-foreground/30"
                                                        : "mx-0 px-0"
                                                )}
                                            >
                                                {isSubtitlesType && (
                                                    <label className="text-sm font-medium text-muted-foreground mt-1">
                                                        Current Cell Range
                                                    </label>
                                                )}
                                                {/* Current cell slider */}
                                                <div className="flex flex-col justify-center w-full mt-4">
                                                    {currentTimestampSlider()}
                                                </div>

                                                {/* Current audio slider */}
                                                {audioBlob && audioDuration && isSubtitlesType && (
                                                    <div className="flex flex-col justify-center space-y-1 mt-[1.5rem] mb-1 w-full">
                                                        {currentAudioTimestampSlider()}
                                                    </div>
                                                )}
                                                <div className="flex items-center my-2 rounded-lg">
                                                    <div className="text-sm flex flex-col items-start gap-1 w-full">
                                                        <div
                                                            className={cn(
                                                                "flex items-center gap-1 w-full",
                                                                isSubtitlesType
                                                                    ? "justify-between"
                                                                    : "justify-end mt-4"
                                                            )}
                                                        >
                                                            {isSubtitlesType ? (
                                                                <div className="flex gap-1 items-center text-sm text-muted-foreground">
                                                                    <Languages className="w-4 h-4 text-muted-foreground/80" />

                                                                    {effectiveTimestamps.startTime !==
                                                                        undefined &&
                                                                    effectiveTimestamps.endTime !==
                                                                        undefined &&
                                                                    (effectiveTimestamps.endTime as number) >
                                                                        (effectiveTimestamps.startTime as number)
                                                                        ? `${formatTime(
                                                                              effectiveTimestamps.startTime as number
                                                                          )} → ${formatTime(
                                                                              effectiveTimestamps.endTime as number
                                                                          )}`
                                                                        : ""}
                                                                </div>
                                                            ) : (
                                                                <div className="text-sm text-muted-foreground">
                                                                    Duration:
                                                                </div>
                                                            )}
                                                            <div>
                                                                {effectiveTimestamps.startTime !==
                                                                    undefined &&
                                                                effectiveTimestamps.endTime !==
                                                                    undefined &&
                                                                (effectiveTimestamps.endTime as number) >
                                                                    (effectiveTimestamps.startTime as number)
                                                                    ? `${(
                                                                          (effectiveTimestamps.endTime as number) -
                                                                          (effectiveTimestamps.startTime as number)
                                                                      ).toFixed(3)}s`
                                                                    : "Invalid duration"}
                                                            </div>
                                                        </div>
                                                        {effectiveAudioTimestamps && (
                                                            <div className="flex justify-between items-center gap-1 w-full">
                                                                <div className="flex items-center gap-1">
                                                                    <MicrophoneIcon className="w-4 h-4 text-muted-foreground/80" />

                                                                    {effectiveAudioTimestamps.startTime !==
                                                                        undefined &&
                                                                    effectiveAudioTimestamps.endTime !==
                                                                        undefined &&
                                                                    (effectiveAudioTimestamps.endTime as number) >
                                                                        (effectiveAudioTimestamps.startTime as number)
                                                                        ? `${formatTime(
                                                                              effectiveAudioTimestamps.startTime as number
                                                                          )} → ${formatTime(
                                                                              effectiveAudioTimestamps.endTime as number
                                                                          )}`
                                                                        : ""}
                                                                </div>
                                                                <div>
                                                                    {effectiveAudioTimestamps.startTime !==
                                                                        undefined &&
                                                                    effectiveAudioTimestamps.endTime !==
                                                                        undefined &&
                                                                    (effectiveAudioTimestamps.endTime as number) >
                                                                        (effectiveAudioTimestamps.startTime as number)
                                                                        ? `${(
                                                                              (effectiveAudioTimestamps.endTime as number) -
                                                                              (effectiveAudioTimestamps.startTime as number)
                                                                          ).toFixed(3)}s`
                                                                        : "Invalid duration"}
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>

                                            {/* Next cell slider - read-only */}
                                            {isSubtitlesType &&
                                                typeof nextStartTime === "number" &&
                                                typeof nextEndTime === "number" &&
                                                nextStartTime < nextEndTime && (
                                                    <div className="flex flex-col justify-end items-end space-y-1 w-full">
                                                        <label className="text-sm font-medium text-muted-foreground">
                                                            Next cell range
                                                        </label>
                                                        <div
                                                            className="flex flex-col items-end space-y-1 relative"
                                                            style={{
                                                                width: `${nextTimestampWidth()}%`,
                                                            }}
                                                        >
                                                            <Slider
                                                                disabled
                                                                min={Math.max(0, nextStartTime)}
                                                                max={Math.max(
                                                                    nextEndTime,
                                                                    nextStartTime + 0.001
                                                                )}
                                                                value={[nextStartTime, nextEndTime]}
                                                                step={0.001}
                                                                className="opacity-60"
                                                            />
                                                            <div className="flex min-w-max text-xs text-muted-foreground">
                                                                <span>
                                                                    Start:{" "}
                                                                    {formatTime(nextStartTime)}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                            {/* Next audio slider - read-only */}
                                            {audioBlob &&
                                                audioDuration &&
                                                nextAudioTimestamps &&
                                                typeof nextAudioTimestamps.startTime === "number" &&
                                                typeof nextAudioTimestamps.endTime === "number" &&
                                                nextAudioTimestamps.startTime <
                                                    nextAudioTimestamps.endTime && (
                                                    <div className="flex flex-col justify-end items-start -mt-[0.25rem] w-full overflow-hidden">
                                                        <div
                                                            className="flex flex-col items-end space-y-1 relative"
                                                            style={{
                                                                width: `${nextAudioTimestampWidth()}%`,
                                                                marginLeft: `${nextAudioTimestampOffset()}%`,
                                                                maxWidth: `calc(100% - ${nextAudioTimestampOffset()}%)`,
                                                            }}
                                                        >
                                                            <Slider
                                                                disabled
                                                                min={Math.max(
                                                                    0,
                                                                    nextAudioTimestamps.startTime
                                                                )}
                                                                max={Math.max(
                                                                    nextAudioTimestamps.endTime,
                                                                    nextAudioTimestamps.startTime +
                                                                        0.001
                                                                )}
                                                                value={[
                                                                    nextAudioTimestamps.startTime,
                                                                    nextAudioTimestamps.endTime,
                                                                ]}
                                                                step={0.001}
                                                                className="opacity-60 audio-timestamp-slider"
                                                            />
                                                            <div className="flex min-w-max text-xs text-muted-foreground">
                                                                <span>
                                                                    Start:{" "}
                                                                    {formatTime(
                                                                        nextAudioTimestamps.startTime
                                                                    )}
                                                                </span>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                        </div>

                                        <div className="flex justify-between">
                                            <div className="flex gap-2">
                                                {isSubtitlesType && (
                                                    <Button
                                                        onClick={handlePlayAudioWithVideo}
                                                        variant="default"
                                                        size="sm"
                                                        disabled={
                                                            !canPlayAudioWithVideo ||
                                                            (effectiveTimestamps?.endTime ?? 0) -
                                                                (effectiveTimestamps?.startTime ??
                                                                    0) <=
                                                                0 ||
                                                            !shouldShowVideoPlayer ||
                                                            isPlayAudioLoading
                                                        }
                                                    >
                                                        {isPlayAudioLoading ? (
                                                            <Loader2 className="mr-1 h-4 w-4 animate-spin" />
                                                        ) : (
                                                            <Play className="mr-1 h-4 w-4" />
                                                        )}
                                                        Play
                                                    </Button>
                                                )}
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
                                            {isSubtitlesType && (
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
                                            )}
                                        </div>
                                        {audioWarning && (
                                            <div className="text-sm text-red-500">
                                                {audioWarning}
                                            </div>
                                        )}
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
                                        {(!audioUrl || showRecorder) && (
                                            <div className="bg-[var(--vscode-editor-background)] p-3 rounded-md shadow-sm">
                                                <div className="flex items-center justify-center text-[var(--vscode-foreground)] text-sm">
                                                    {!showRecorder &&
                                                    audioAttachments &&
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
                                                        (() => {
                                                            // Calculate target duration from cell timestamps
                                                            const targetDuration =
                                                                cellTimestamps?.startTime !==
                                                                    undefined &&
                                                                cellTimestamps?.endTime !==
                                                                    undefined
                                                                    ? cellTimestamps.endTime -
                                                                      cellTimestamps.startTime
                                                                    : null;

                                                            // Calculate progress percentage
                                                            const progressPercentage =
                                                                targetDuration &&
                                                                recordingElapsedTime > 0
                                                                    ? Math.min(
                                                                          100,
                                                                          (recordingElapsedTime /
                                                                              targetDuration) *
                                                                              100
                                                                      )
                                                                    : 0;

                                                            // Determine if recording should stop filling (over 100%)
                                                            const shouldStopFilling =
                                                                progressPercentage >= 100;

                                                            return (
                                                                <div className="flex flex-col items-center gap-4 w-full">
                                                                    {/* Circular Button */}
                                                                    <Button
                                                                        onClick={
                                                                            isRecording ||
                                                                            countdown !== null
                                                                                ? stopRecording
                                                                                : startRecording
                                                                        }
                                                                        disabled={
                                                                            isCellLocked ||
                                                                            !targetDuration
                                                                        }
                                                                        className={cn(
                                                                            "h-24 w-24 rounded-full text-2xl font-bold transition-all",
                                                                            isRecording
                                                                                ? "animate-pulse border-red-500 bg-red-600 hover:bg-red-700"
                                                                                : countdown !== null
                                                                                ? "border-green-500 bg-green-500 hover:bg-green-600"
                                                                                : "bg-blue-600 hover:bg-blue-700",
                                                                            isCellLocked ||
                                                                                !targetDuration
                                                                                ? "opacity-50 cursor-not-allowed"
                                                                                : ""
                                                                        )}
                                                                        title={
                                                                            isCellLocked
                                                                                ? "Cannot record: cell is locked"
                                                                                : !targetDuration
                                                                                ? "Cannot record: video timestamps not available"
                                                                                : isRecording
                                                                                ? "Stop Recording"
                                                                                : countdown !== null
                                                                                ? `Starting in ${countdown}...`
                                                                                : "Start Recording"
                                                                        }
                                                                    >
                                                                        {isRecording ? (
                                                                            <Mic className="h-8 w-8" />
                                                                        ) : countdown !== null ? (
                                                                            countdown
                                                                        ) : (
                                                                            <Mic className="h-8 w-8" />
                                                                        )}
                                                                    </Button>

                                                                    {/* Progress Bar */}
                                                                    {targetDuration ? (
                                                                        <div className="w-full space-y-2">
                                                                            <div className="relative w-full h-3 bg-blue-200/60 rounded-full overflow-hidden">
                                                                                <div
                                                                                    className="h-full rounded-full transition-all duration-100"
                                                                                    style={{
                                                                                        width: `${
                                                                                            shouldStopFilling
                                                                                                ? 100
                                                                                                : progressPercentage
                                                                                        }%`,
                                                                                        backgroundColor:
                                                                                            progressPercentage <=
                                                                                            90
                                                                                                ? "rgb(234, 179, 8)" // yellow-500
                                                                                                : progressPercentage <=
                                                                                                  99
                                                                                                ? "rgb(34, 197, 94)" // green-500
                                                                                                : "rgb(239, 68, 68)", // red-500
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                            <div className="flex justify-between text-xs text-muted-foreground">
                                                                                <span>
                                                                                    {isRecording ||
                                                                                    recordingElapsedTime >
                                                                                        0
                                                                                        ? `${recordingElapsedTime.toFixed(
                                                                                              3
                                                                                          )}s`
                                                                                        : "0s"}
                                                                                </span>
                                                                                <span>
                                                                                    Timestamp Length
                                                                                </span>
                                                                                <span>
                                                                                    {targetDuration.toFixed(
                                                                                        1
                                                                                    )}
                                                                                    s
                                                                                </span>
                                                                            </div>
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-xs text-muted-foreground text-center">
                                                                            Video timestamps not
                                                                            available for this cell
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })()
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        <div className="flex flex-wrap items-center justify-center gap-2 mt-3 px-2">
                                            <Button
                                                variant="outline"
                                                className="flex items-center justify-center h-8 px-2 text-xs"
                                                disabled={isCellLocked}
                                                title={
                                                    isCellLocked
                                                        ? "Cannot upload: cell is locked"
                                                        : "Upload audio file"
                                                }
                                                onClick={() => {
                                                    if (isCellLocked) return;
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
                                            onShowRecorder={() => {
                                                setShowRecorder(true);
                                                // Reset recording state when re-recording
                                                setCountdown(null);
                                                setRecordingStartTime(null);
                                                setRecordingElapsedTime(0);
                                                if (countdownIntervalRef.current) {
                                                    clearInterval(countdownIntervalRef.current);
                                                    countdownIntervalRef.current = null;
                                                }
                                                if (recordingTimerRef.current) {
                                                    clearInterval(recordingTimerRef.current);
                                                    recordingTimerRef.current = null;
                                                }
                                            }}
                                            disabled={!audioBlob}
                                            validationStatusProps={audioValidationIconProps}
                                            audioValidationPopoverProps={
                                                audioValidationPopoverProps
                                            }
                                            targetDurationSeconds={
                                                isSubtitlesType &&
                                                cellTimestamps?.startTime !== undefined &&
                                                cellTimestamps?.endTime !== undefined
                                                    ? cellTimestamps.endTime -
                                                      cellTimestamps.startTime
                                                    : undefined
                                            }
                                            audioDurationSeconds={
                                                isSubtitlesType
                                                    ? audioDuration ?? undefined
                                                    : undefined
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
                                                    {isAudioSaving && (
                                                        <Loader2 className="h-3 w-3 mr-2 animate-spin" />
                                                    )}
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
