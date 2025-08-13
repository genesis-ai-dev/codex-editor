import { useRef, useEffect, useState, useContext, useCallback } from "react";
import {
    EditorCellContent,
    EditorPostMessages,
    QuillCellContent,
    EditHistory,
    SpellCheckResponse,
    Timestamps,
} from "../../../../types";
import Editor, { EditorContentChanged, EditorHandles } from "./Editor";
import { getCleanedHtml } from "./react-quill-spellcheck";
import createQuillDeltaOpsFromHtml from "./react-quill-spellcheck";
import createQuillDeltaFromDeltaOps from "./react-quill-spellcheck";
import { CodexCellTypes } from "../../../../types/enums";
import { AddParatextButton } from "./AddParatextButton";
import ReactMarkdown from "react-markdown";
// import "./TextCellEditorStyles.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
// import "./TextEditor.css";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import Quill from "quill";
import { WhisperTranscriptionClient } from "./WhisperTranscriptionClient";
import AudioWaveformWithTranscription from "./AudioWaveformWithTranscription";
import SourceTextDisplay from "./SourceTextDisplay";

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
    TypeIcon,
    Pin,
    Copy,
    Square,
    FolderOpen,
    NotebookPen,
    Save,
    RotateCcw,
    Clock,
} from "lucide-react";
import { cn } from "../lib/utils";
import CommentsBadge from "./CommentsBadge";

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
    footnoteOffset?: number;
    prevEndTime?: number;
    nextStartTime?: number;
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
    footnoteOffset = 1,
    prevEndTime,
    nextStartTime,
}) => {
    const { setUnsavedChanges, showFlashingBorder, unsavedChanges } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    const [editorContent, setEditorContent] = useState(cellContent);

    // Sync editor content when cell content changes (e.g., from translation)
    useEffect(() => {
        setEditorContent(cellContent);
    }, [cellContent]);
    const [sourceText, setSourceText] = useState<string | null>(null);
    const [backtranslation, setBacktranslation] = useState<SavedBacktranslation | null>(null);
    const [isEditingBacktranslation, setIsEditingBacktranslation] = useState(false);
    const [editedBacktranslation, setEditedBacktranslation] = useState<string | null>(null);
    const [isGeneratingBacktranslation, setIsGeneratingBacktranslation] = useState(false);
    const [backtranslationProgress, setBacktranslationProgress] = useState(0);
    const [activeTab, setActiveTab] = useState<
        "source" | "backtranslation" | "footnotes" | "audio" | "timestamps"
    >("source");
    const [footnotes, setFootnotes] = useState<
        Array<{ id: string; content: string; element?: HTMLElement }>
    >([]);
    const [isEditingFootnoteInline, setIsEditingFootnoteInline] = useState(false);
    const editorHandlesRef = useRef<EditorHandles | null>(null);

    // Add ref to track debounce timeout for footnote parsing
    const footnoteParseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // Audio-related state
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [recordingStatus, setRecordingStatus] = useState<string>("");
    const audioChunksRef = useRef<Blob[]>([]);
    const [confirmingDiscard, setConfirmingDiscard] = useState(false);

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
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "center" });
        }
    }, [showFlashingBorder]);

    useEffect(() => {
        if (contentToScrollTo && contentToScrollTo === cellMarkers[0] && cellEditorRef.current) {
            debug("Scrolling to content", { contentToScrollTo, cellMarkers });
            cellEditorRef.current.scrollIntoView({ behavior: "smooth", block: "start" });
        }
    }, [contentToScrollTo]);

    const [editableLabel, setEditableLabel] = useState(cellLabel || "");
    const [similarCells, setSimilarCells] = useState<SimilarCell[]>([]);
    const [showSuggestions, setShowSuggestions] = useState(false);
    const [cursorPosition, setCursorPosition] = useState(0);
    const [activeSearchPosition, setActiveSearchPosition] = useState<number | null>(null);
    const [isEditorControlsExpanded, setIsEditorControlsExpanded] = useState(false);
    const [isPinned, setIsPinned] = useState(false);
    const [showAdvancedControls, setShowAdvancedControls] = useState(false);
    const [unresolvedCommentsCount, setUnresolvedCommentsCount] = useState<number>(0);

    const handleSaveCell = () => {
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
        }
    };

    // Timestamp editing bounds and effective state
    const previousEndBound = typeof prevEndTime === "number" ? prevEndTime : 0;
    const nextStartBound =
        typeof nextStartTime === "number" ? nextStartTime : Number.POSITIVE_INFINITY;
    const effectiveTimestamps: Timestamps | undefined =
        contentBeingUpdated.cellTimestamps ?? cellTimestamps;
    const computedMaxBound = Number.isFinite(nextStartBound)
        ? nextStartBound
        : Math.max(effectiveTimestamps?.endTime ?? 0, (effectiveTimestamps?.startTime ?? 0) + 10);

    useEffect(() => {
        setEditableLabel(cellLabel || "");
    }, [cellLabel]);

    // Fetch comments count for this cell
    useEffect(() => {
        const fetchCommentsCount = () => {
            const messageContent: EditorPostMessages = {
                command: "getCommentsForCell",
                content: {
                    cellId: cellMarkers[0],
                },
            };
            window.vscodeApi.postMessage(messageContent);
        };

        fetchCommentsCount();
    }, [cellMarkers]);

    // Handle comments count response
    useEffect(() => {
        const handleCommentsResponse = (event: MessageEvent) => {
            if (
                event.data.type === "commentsForCell" &&
                event.data.content.cellId === cellMarkers[0]
            ) {
                setUnresolvedCommentsCount(event.data.content.unresolvedCount);
            }
        };

        window.addEventListener("message", handleCommentsResponse);
        return () => window.removeEventListener("message", handleCommentsResponse);
    }, [cellMarkers]);

    const handleLabelChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setEditableLabel(e.target.value);
    };

    const handleLabelBlur = () => {
        // Update the cell label in the notebook data
        const messageContent: EditorPostMessages = {
            command: "updateCellLabel",
            content: {
                cellId: cellMarkers[0],
                cellLabel: editableLabel,
            },
        };
        window.vscodeApi.postMessage(messageContent);

        // Update local state
        setContentBeingUpdated({
            cellMarkers,
            cellContent: contentBeingUpdated.cellContent,
            cellChanged: contentBeingUpdated.cellChanged,
            cellLabel: editableLabel,
        });
    };

    const handleLabelSave = () => {
        handleLabelBlur();
    };

    useEffect(() => {
        const handleSimilarCellsResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSimilarCellIdsResponse") {
                setSimilarCells(message.content);
            }
        };

        window.addEventListener("message", handleSimilarCellsResponse);
        return () => window.removeEventListener("message", handleSimilarCellsResponse);
    }, []);

    const makeChild = () => {
        const parentCellId = cellMarkers[0];
        const newChildId = generateChildCellId(parentCellId);

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
    useEffect(() => {
        const handleSourceTextResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsSourceText") {
                setSourceText(message.content);
            }
        };

        window.addEventListener("message", handleSourceTextResponse);
        return () => window.removeEventListener("message", handleSourceTextResponse);
    }, []);

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

    useEffect(() => {
        const handleBacktranslationResponse = (event: MessageEvent) => {
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
        };

        window.addEventListener("message", handleBacktranslationResponse);
        return () => window.removeEventListener("message", handleBacktranslationResponse);
    }, [isGeneratingBacktranslation]);

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
        },
        [unsavedChanges, handleSaveHtml, openCellById, setContentBeingUpdated, setEditorContent]
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "openCellById") {
                handleOpenCellById(message.cellId, message.text);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []); // Empty dependency array means this effect runs once on mount

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

        // Listen for storeFootnote messages
        const handleMessage = (event: MessageEvent) => {
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
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
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

    // Smart tab switching - switch to an available tab if current becomes unavailable
    useEffect(() => {
        // If source tab is active but no source text, switch to backtranslation or footnotes
        if (activeTab === "source" && !sourceText) {
            setActiveTab("backtranslation");
        }
    }, [activeTab, sourceText]);

    // Audio recording functions
    const startRecording = async () => {
        if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
            setRecordingStatus("Microphone not supported in this browser");
            return;
        }

        try {
            const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
            const recorder = new MediaRecorder(stream);

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
        const uniqueId = `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
        const documentSegment = cellMarkers[0].split(" ")[0]; // Extract "JUD" from "JUD 1:1"

        // Determine file extension based on blob type
        const fileExtension = blob.type.split("/")[1] || "webm"; // Default to webm

        // Convert blob to base64 for transfer to provider
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result as string;

            // Send to provider to save file
            const messageContent: EditorPostMessages = {
                command: "saveAudioAttachment",
                content: {
                    cellId: cellMarkers[0],
                    audioData: base64data,
                    audioId: uniqueId,
                    fileExtension: fileExtension,
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

    const handleTranscribeAudio = async () => {
        if (!audioBlob) {
            setTranscriptionStatus("No audio to transcribe");
            return;
        }

        setIsTranscribing(true);
        setTranscriptionProgress(0);
        setTranscriptionStatus("Connecting to transcription service...");

        try {
            // Create transcription client
            const client = new WhisperTranscriptionClient(
                "wss://ryderwishart--whisper-websocket-transcription-fastapi-asgi.modal.run/ws/transcribe"
            );
            transcriptionClientRef.current = client;

            // Set up progress handler
            client.onProgress = (message, percentage) => {
                setTranscriptionStatus(message);
                setTranscriptionProgress(percentage);
            };

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
                        language: result.language,
                    };

                    // Save to cell metadata via provider
                    const messageContent: EditorPostMessages = {
                        command: "updateCellAfterTranscription",
                        content: {
                            cellId: cellMarkers[0],
                            transcribedText: transcribedText,
                            language: result.language || "unknown",
                        },
                    };
                    window.vscodeApi.postMessage(messageContent);

                    // Update local state
                    setSavedTranscription(transcriptionData);
                }

                setTranscriptionStatus(`Transcription complete (${result.language})`);
            } else {
                setTranscriptionStatus("No speech detected in audio");
            }
        } catch (error) {
            console.error("Transcription error:", error);
            setTranscriptionStatus(
                `Transcription failed: ${error instanceof Error ? error.message : "Unknown error"}`
            );
        } finally {
            setIsTranscribing(false);
            transcriptionClientRef.current = null;

            // Clear status after a delay, but keep savedTranscription
            setTimeout(() => {
                setTranscriptionStatus("");
                setTranscriptionProgress(0);
            }, 5000);
        }
    };

    const handleInsertTranscription = () => {
        if (!savedTranscription) return;

        // Get current content from the editor
        const currentContent = editorContent;
        const doc = new DOMParser().parseFromString(currentContent, "text/html");
        const currentText = doc.body.textContent || "";

        // Append transcribed text with a space if there's existing content
        const newText = currentText
            ? `${currentText} ${savedTranscription.content}`
            : savedTranscription.content;

        // Update the content as HTML
        const newContent = `<span>${newText}</span>`;

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
        if (file && file.type.startsWith("audio/")) {
            setAudioBlob(file);

            // Clean up old URL if exists
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }

            // Don't create blob URLs anymore - just use the Blob directly
            setRecordingStatus("Audio file loaded");

            // Save to cell
            saveAudioToCell(file);
        } else {
            setRecordingStatus("Please select a valid audio file");
        }
    };

    // Load existing audio when component mounts
    useEffect(() => {
        // Don't try to load from session storage or cell data directly
        // Just request audio attachments from the provider which will send proper base64 data
        const messageContent: EditorPostMessages = {
            command: "requestAudioForCell",
            content: { cellId: cellMarkers[0] },
        };
        window.vscodeApi.postMessage(messageContent);
    }, [cellMarkers]);

    // Handle audio data response
    useEffect(() => {
        const handleAudioResponse = async (event: MessageEvent) => {
            const message = event.data;

            // Handle audio attachments list (no longer set audioUrl from file path)
            if (message.type === "providerSendsAudioAttachments") {
                // No-op: we only care about actual audio data
            }

            // Handle specific audio data
            if (
                message.type === "providerSendsAudioData" &&
                message.content.cellId === cellMarkers[0]
            ) {
                if (message.content.audioData) {
                    try {
                        // Convert base64 to blob to avoid CSP issues
                        const base64Response = await fetch(message.content.audioData);
                        const blob = await base64Response.blob();
                        setAudioBlob(blob); // This will trigger the effect above to set audioUrl
                        setRecordingStatus("Audio loaded");

                        // Check for existing transcription in the audio attachment metadata
                        if (message.content.transcription) {
                            setSavedTranscription({
                                content: message.content.transcription.content,
                                timestamp: message.content.transcription.timestamp,
                                language: message.content.transcription.language,
                            });
                        }

                        // Store the audio ID
                        if (message.content.audioId) {
                            sessionStorage.setItem(
                                `audio-id-${cellMarkers[0]}`,
                                message.content.audioId
                            );
                        }
                    } catch (error) {
                        console.error("Error converting audio data to blob:", error);
                        setRecordingStatus("Error loading audio");
                    }
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
            }
        };

        window.addEventListener("message", handleAudioResponse);
        return () => window.removeEventListener("message", handleAudioResponse);
    }, [cellMarkers]);

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
            <CardHeader className="border-b p-4 flex flex-row flex-nowrap items-center justify-between">
                <div className="flex flex-row flex-wrap items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isEditorControlsExpanded ? (
                            <X
                                className="h-4 w-4 cursor-pointer"
                                onClick={() =>
                                    setIsEditorControlsExpanded(!isEditorControlsExpanded)
                                }
                            />
                        ) : (
                            <div className="flex items-center gap-2 cursor-pointer">
                                <div className="flex items-center gap-1">
                                    <span className="text-lg font-semibold">{cellMarkers[0]}</span>
                                    {editableLabel && (
                                        <span className="text-sm text-muted-foreground">
                                            {editableLabel}
                                        </span>
                                    )}
                                    <Pencil
                                        onClick={() =>
                                            setIsEditorControlsExpanded(!isEditorControlsExpanded)
                                        }
                                        className="h-4 w-4"
                                    />
                                </div>
                                <CommentsBadge
                                    cellId={cellMarkers[0]}
                                    unresolvedCount={unresolvedCommentsCount}
                                />
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => editorHandlesRef.current?.openLibrary()}
                                        variant="ghost"
                                        size="icon"
                                        title="Add All Words to Dictionary"
                                    >
                                        <Book className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Add All Words to Dictionary</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider> */}
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
                        <TooltipProvider>
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <Button
                                        onClick={() => editorHandlesRef.current?.addFootnote()}
                                        variant="ghost"
                                        size="icon"
                                        title="Add Footnote"
                                    >
                                        <NotebookPen className="h-4 w-4" />
                                    </Button>
                                </TooltipTrigger>
                                <TooltipContent>
                                    <p>Add Footnote</p>
                                </TooltipContent>
                            </Tooltip>
                        </TooltipProvider>
                        {showAdvancedControls ? (
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
                        ) : (
                            <Button
                                onClick={() => setShowAdvancedControls(!showAdvancedControls)}
                                variant="ghost"
                                size="icon"
                                title="Show Advanced Controls"
                            >
                                <Settings className="h-4 w-4" />
                            </Button>
                        )}
                    </div>
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
                                title={isSaving ? "Saving..." : "Save changes"}
                                disabled={isSaving || isEditingFootnoteInline}
                            >
                                {isSaving ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                ) : (
                                    <Check className="h-4 w-4" />
                                )}
                            </Button>
                            <ConfirmationButton
                                icon="trash"
                                onClick={handleCloseEditor}
                                disabled={isSaving || isEditingFootnoteInline}
                            />
                        </>
                    ) : (
                        <Button
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCloseEditor();
                            }}
                            variant="ghost"
                            size="icon"
                            title="Close editor"
                        >
                            <X className="h-4 w-4" />
                        </Button>
                    )}
                </div>
            </CardHeader>

            <CardContent className="p-4 space-y-4">
                {isEditorControlsExpanded && (
                    <div className="space-y-4 pb-4 border-b">
                        <div className="flex items-center gap-2">
                            <Input
                                type="text"
                                value={editableLabel}
                                onChange={handleLabelChange}
                                onBlur={handleLabelBlur}
                                placeholder="Enter label..."
                                className="flex-1"
                            />
                            <Button
                                onClick={handleLabelSave}
                                variant="ghost"
                                size="icon"
                                title="Save Label"
                            >
                                <Save className="h-4 w-4" />
                            </Button>
                        </div>
                    </div>
                )}

                <div
                    className={`flex items-start gap-2 ${
                        showFlashingBorder
                            ? "ring-2 ring-blue-500 ring-opacity-50 animate-pulse rounded-lg p-2"
                            : ""
                    }`}
                    ref={cellEditorRef}
                >
                    <TypeIcon className="h-5 w-5 mt-2 text-muted-foreground flex-shrink-0" />
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
                            textDirection={textDirection}
                            ref={editorHandlesRef}
                            setIsEditingFootnoteInline={setIsEditingFootnoteInline}
                            isEditingFootnoteInline={isEditingFootnoteInline}
                            footnoteOffset={footnoteOffset}
                        />
                    </div>
                </div>

                <Tabs
                    defaultValue={activeTab}
                    value={activeTab}
                    onValueChange={(value) =>
                        setActiveTab(
                            value as
                                | "source"
                                | "backtranslation"
                                | "footnotes"
                                | "timestamps"
                                | "audio"
                        )
                    }
                    className="w-full"
                >
                    <TabsList
                        className="flex w-full"
                        style={{ justifyContent: "stretch", display: "flex" }}
                    >
                        <TabsTrigger value="source">
                            <FileCode className="mr-2 h-4 w-4" />

                            {!sourceText && (
                                <span className="ml-2 h-2 w-2 rounded-full bg-gray-400" />
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="backtranslation">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            {backtranslation && (
                                <span
                                    className="ml-2 h-2 w-2 rounded-full bg-green-400"
                                    title="Backtranslation available"
                                />
                            )}
                            {!backtranslation && contentBeingUpdated.cellContent.trim() && (
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

                    <TabsContent value="source">
                        <SourceTextDisplay
                            content={sourceText || ""}
                            footnoteOffset={footnoteOffset}
                        />
                    </TabsContent>

                    <TabsContent value="backtranslation">
                        <div className="content-section space-y-4">
                            <div className="flex items-center justify-between">
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
                                            !contentBeingUpdated.cellContent.trim() ||
                                            isGeneratingBacktranslation
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
                                    <div className="text-center p-8 text-muted-foreground">
                                        {contentBeingUpdated.cellContent.trim() ? (
                                            <>
                                                <p>No backtranslation available for this text.</p>
                                                <p className="mt-2">
                                                    Click the refresh button to generate a
                                                    backtranslation.
                                                </p>
                                            </>
                                        ) : (
                                            <>
                                                <p>Add content to this cell first.</p>
                                                <p className="mt-2">
                                                    Backtranslation will be available once you have
                                                    text to translate.
                                                </p>
                                            </>
                                        )}
                                    </div>
                                )
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="footnotes">
                        <div className="content-section">
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
                                    <p className="mt-2 flex items-center justify-center gap-2">
                                        Use the footnote button <NotebookPen className="h-4 w-4" />{" "}
                                        in the editor toolbar to add footnotes.
                                    </p>
                                </div>
                            )}
                        </div>
                    </TabsContent>

                    <TabsContent value="timestamps">
                        <div className="content-section space-y-4">
                            <h3 className="text-lg font-medium">Timestamps</h3>

                            {effectiveTimestamps &&
                            (effectiveTimestamps.startTime !== undefined ||
                                effectiveTimestamps.endTime !== undefined) ? (
                                <div className="space-y-4">
                                    {/* Scrubber with clamped handles */}
                                    <div className="space-y-2">
                                        <label className="text-sm font-medium">Adjust range</label>
                                        <Slider
                                            min={Math.max(0, previousEndBound)}
                                            max={Math.max(
                                                computedMaxBound,
                                                effectiveTimestamps.endTime ?? 0
                                            )}
                                            value={[
                                                Math.max(
                                                    Math.max(0, previousEndBound),
                                                    effectiveTimestamps.startTime ?? 0
                                                ),
                                                Math.min(
                                                    nextStartBound,
                                                    effectiveTimestamps.endTime ??
                                                        effectiveTimestamps.startTime ??
                                                        0
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
                                            }}
                                        />
                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <span>
                                                Min: {formatTime(Math.max(0, previousEndBound))}
                                            </span>
                                            <span>Max: {formatTime(computedMaxBound)}</span>
                                        </div>
                                        <div className="flex justify-end">
                                            <Button
                                                size="sm"
                                                variant="secondary"
                                                onClick={() => {
                                                    if (!contentBeingUpdated.cellTimestamps) return;
                                                    const messageContent: EditorPostMessages = {
                                                        command: "updateCellTimestamps",
                                                        content: {
                                                            cellId: cellMarkers[0],
                                                            timestamps:
                                                                contentBeingUpdated.cellTimestamps,
                                                        },
                                                    };
                                                    window.vscodeApi.postMessage(messageContent);
                                                }}
                                            >
                                                Save timestamps
                                            </Button>
                                        </div>
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

                                    <div className="flex gap-2">
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
                                            <Trash2 className="mr-2 h-4 w-4" />
                                            Clear Timestamps
                                        </Button>
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

                    <TabsContent value="audio">
                        <div className="content-section space-y-6">
                            <h3 className="text-lg font-medium">Audio Recording</h3>

                            {!audioUrl ||
                            !(
                                audioUrl.startsWith("blob:") ||
                                audioUrl.startsWith("data:") ||
                                audioUrl.startsWith("http")
                            ) ? (
                                <div className="space-y-4">
                                    <p className="text-center text-muted-foreground">
                                        No audio attached to this cell yet.
                                    </p>
                                    <div className="flex flex-col sm:flex-row gap-3 justify-center">
                                        <Button
                                            onClick={isRecording ? stopRecording : startRecording}
                                            variant={isRecording ? "secondary" : "default"}
                                            className={isRecording ? "animate-pulse" : ""}
                                        >
                                            {isRecording ? (
                                                <>
                                                    <Square className="mr-2 h-4 w-4" />
                                                    Stop Recording
                                                </>
                                            ) : (
                                                <>
                                                    <CircleDotDashed className="mr-2 h-4 w-4" />
                                                    Start Recording
                                                </>
                                            )}
                                        </Button>

                                        <div className="flex items-center gap-2">
                                            <Separator orientation="vertical" className="h-8" />
                                            <span className="text-sm text-muted-foreground">
                                                or
                                            </span>
                                            <Separator orientation="vertical" className="h-8" />
                                        </div>

                                        <label className="cursor-pointer">
                                            <input
                                                type="file"
                                                accept="audio/*"
                                                onChange={handleFileUpload}
                                                className="sr-only"
                                            />
                                            <Button variant="outline" asChild>
                                                <span>
                                                    <FolderOpen className="mr-2 h-4 w-4" />
                                                    Upload Audio File
                                                </span>
                                            </Button>
                                        </label>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    {/* New Waveform Component with integrated transcription */}
                                    <AudioWaveformWithTranscription
                                        audioUrl={audioUrl}
                                        audioBlob={audioBlob}
                                        transcription={savedTranscription}
                                        isTranscribing={isTranscribing}
                                        transcriptionProgress={transcriptionProgress}
                                        onTranscribe={handleTranscribeAudio}
                                        onInsertTranscription={handleInsertTranscription}
                                        disabled={!audioBlob}
                                    />

                                    {/* Action buttons */}
                                    <div className="flex flex-wrap gap-2">
                                        {confirmingDiscard ? (
                                            <>
                                                <Button
                                                    onClick={() => {
                                                        discardAudio();
                                                        setConfirmingDiscard(false);
                                                    }}
                                                    variant="destructive"
                                                    size="sm"
                                                >
                                                    <Check className="mr-2 h-4 w-4" />
                                                    Confirm
                                                </Button>
                                                <Button
                                                    onClick={() => setConfirmingDiscard(false)}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    <X className="mr-2 h-4 w-4" />
                                                    Cancel
                                                </Button>
                                            </>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2 w-full">
                                                <Button
                                                    onClick={() => setConfirmingDiscard(true)}
                                                    variant="outline"
                                                    size="sm"
                                                    className="w-full"
                                                >
                                                    <Trash2 className="h-4 w-4" />
                                                    <span className="inline ml-2">
                                                        Remove Audio
                                                    </span>
                                                </Button>
                                                <Button
                                                    onClick={
                                                        isRecording ? stopRecording : startRecording
                                                    }
                                                    variant="outline"
                                                    size="sm"
                                                    className={cn(
                                                        "w-full",
                                                        isRecording && "animate-pulse"
                                                    )}
                                                >
                                                    {isRecording ? (
                                                        <>
                                                            <Square className="h-4 w-4" />
                                                            <span className="inline ml-2">
                                                                Stop
                                                            </span>
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Mic className="h-4 w-4" />
                                                            <span className="inline ml-2">
                                                                Re-record / Load New
                                                            </span>
                                                        </>
                                                    )}
                                                </Button>
                                            </div>
                                        )}
                                    </div>

                                    {/* Native audio player for verification (temporary) */}
                                    <details className="mt-4">
                                        <summary className="text-sm text-muted-foreground cursor-pointer">
                                            Debug: Native Audio Player
                                        </summary>
                                        <div className="mt-2 p-3 bg-muted rounded-lg">
                                            <audio
                                                controls
                                                src={audioUrl || undefined}
                                                className="w-full"
                                                style={{ height: "40px" }}
                                            />
                                            <p className="text-xs text-muted-foreground mt-2 break-all">
                                                Source:{" "}
                                                {audioUrl
                                                    ? `URL: ${audioUrl}`
                                                    : audioBlob
                                                    ? `Blob: ${audioBlob.type} (${audioBlob.size} bytes)`
                                                    : "No audio"}
                                            </p>
                                            <p className="text-xs text-muted-foreground mt-1">
                                                Debug URL: {audioUrl || "None"}
                                            </p>
                                        </div>
                                    </details>

                                    {/* Status messages */}
                                    {transcriptionStatus && (
                                        <p className="text-sm text-center text-muted-foreground">
                                            {transcriptionStatus}
                                        </p>
                                    )}

                                    {recordingStatus && !isTranscribing && (
                                        <Badge
                                            variant={isRecording ? "destructive" : "secondary"}
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
                </Tabs>
            </CardContent>
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
