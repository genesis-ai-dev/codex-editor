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
import "./TextCellEditorStyles.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import "./TextEditor.css";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import Quill from "quill";
import { WhisperTranscriptionClient } from "./WhisperTranscriptionClient";

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
} from "lucide-react";

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
}) => {
    const { setUnsavedChanges, showFlashingBorder, unsavedChanges } =
        useContext(UnsavedChangesContext);
    const { contentToScrollTo } = useContext(ScrollToContentContext);
    const { sourceCellMap } = useContext(SourceCellContext);
    const cellEditorRef = useRef<HTMLDivElement>(null);
    const sourceCellContent = sourceCellMap?.[cellMarkers[0]];
    const [editorContent, setEditorContent] = useState(cellContent);
    const [sourceText, setSourceText] = useState<string | null>(null);
    const [backtranslation, setBacktranslation] = useState<SavedBacktranslation | null>(null);
    const [isEditingBacktranslation, setIsEditingBacktranslation] = useState(false);
    const [editedBacktranslation, setEditedBacktranslation] = useState<string | null>(null);
    const [activeTab, setActiveTab] = useState<
        "source" | "backtranslation" | "footnotes" | "audio"
    >("source");
    const [footnotes, setFootnotes] = useState<
        Array<{ id: string; content: string; element?: HTMLElement }>
    >([]);
    const editorRef = useRef<HTMLDivElement>(null);
    const editorHandlesRef = useRef<EditorHandles | null>(null);

    // Audio-related state
    const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
    const [_audioUrl, _setAudioUrl] = useState<string | null>(null);
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

    // Use the internal state with validation
    const audioUrl = _audioUrl;
    const setAudioUrl = _setAudioUrl;

    // Safe setter for audio URL that prevents file paths
    const safeSetAudioUrl = (url: string | null) => {
        if (!url) {
            setAudioUrl(null);
            return;
        }

        // Only allow valid URL schemes
        if (url.startsWith("blob:") || url.startsWith("data:") || url.startsWith("http")) {
            setAudioUrl(url);
        } else {
            console.error(`[Audio] Blocked invalid audio URL (likely a file path): ${url}`);
            setRecordingStatus("Error: Invalid audio source");
            // Don't set the URL, wait for proper base64 data
        }
    };

    // Debug audio URL changes
    useEffect(() => {
        if (audioUrl) {
            console.log(`[Audio Debug] audioUrl changed for cell ${cellMarkers[0]}:`, audioUrl);
            console.trace(); // This will show the call stack
        }
    }, [audioUrl, cellMarkers]);

    // Add keyboard navigation for tabs
    const handleTabKeyDown = (
        event: React.KeyboardEvent<HTMLButtonElement>,
        tabName: "source" | "backtranslation" | "footnotes" | "audio"
    ) => {
        const tabs = ["source", "backtranslation", "footnotes", "audio"];
        const currentIndex = tabs.indexOf(activeTab);

        switch (event.key) {
            case "ArrowLeft": {
                event.preventDefault();
                const prevIndex = currentIndex > 0 ? currentIndex - 1 : tabs.length - 1;
                const prevTab = tabs[prevIndex];
                // Only navigate to enabled tabs
                if (prevTab === "source" && !sourceText) return;
                setActiveTab(prevTab as "source" | "backtranslation" | "footnotes" | "audio");
                break;
            }
            case "ArrowRight": {
                event.preventDefault();
                const nextIndex = currentIndex < tabs.length - 1 ? currentIndex + 1 : 0;
                const nextTab = tabs[nextIndex];
                // Only navigate to enabled tabs
                if (nextTab === "source" && !sourceText) return;
                setActiveTab(nextTab as "source" | "backtranslation" | "footnotes" | "audio");
                break;
            }
            case "Home":
                event.preventDefault();
                setActiveTab("source");
                break;
            case "End":
                event.preventDefault();
                setActiveTab("footnotes");
                break;
        }
    };

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

    useEffect(() => {
        setEditableLabel(cellLabel || "");
    }, [cellLabel]);

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
        setContentBeingUpdated({
            cellMarkers,
            cellContent: newContent,
            cellChanged: true,
            cellLabel: editableLabel,
        });
        setEditorContent(newContent);
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
            }
        };

        window.addEventListener("message", handleBacktranslationResponse);
        return () => window.removeEventListener("message", handleBacktranslationResponse);
    }, []);

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
            return;
        }

        // Fallback to session storage
        const storedFootnotes = sessionStorage.getItem(`footnotes-${cellMarkers[0]}`);
        if (storedFootnotes) {
            try {
                setFootnotes(JSON.parse(storedFootnotes));
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

                    return updatedFootnotes;
                });
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [cellMarkers, cell?.data?.footnotes]);

    // Function to parse footnotes from cell content
    const parseFootnotesFromContent = () => {
        if (!editorContent) return;

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(editorContent, "text/html");
            const footnoteElements = doc.querySelectorAll("sup.footnote-marker");

            if (footnoteElements.length === 0) {
                setFootnotes([]);
                return;
            }

            const extractedFootnotes: Array<{ id: string; content: string }> = [];
            const allElements = Array.from(doc.body.querySelectorAll("*"));

            footnoteElements.forEach((element) => {
                const id = element.textContent || "";
                const content = element.getAttribute("data-footnote") || "";
                const position = allElements.indexOf(element);

                if (id && content) {
                    extractedFootnotes.push({
                        id,
                        content,
                    });
                }
            });

            // Sort footnotes based on their DOM position
            extractedFootnotes.sort((a, b) => {
                const numA = parseInt((a.id || "").replace(/\D/g, "")) || 0;
                const numB = parseInt((b.id || "").replace(/\D/g, "")) || 0;
                return numA - numB;
            });

            setFootnotes(extractedFootnotes);
        } catch (error) {
            console.error("Error parsing footnotes:", error);
        }
    };

    // Parse footnotes when content changes
    useEffect(() => {
        parseFootnotesFromContent();
    }, [editorContent]);

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
                safeSetAudioUrl(url);
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

            // Clean up previous blob URL if it exists
            if (audioUrl && audioUrl.startsWith("blob:")) {
                URL.revokeObjectURL(audioUrl);
            }

            // Create a new blob URL for immediate playback
            const blobUrl = URL.createObjectURL(blob);
            safeSetAudioUrl(blobUrl);
            setAudioBlob(blob);
        };
        reader.readAsDataURL(blob);
    };

    const discardAudio = () => {
        if (audioUrl) {
            URL.revokeObjectURL(audioUrl);
        }
        safeSetAudioUrl(null);
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

            // Success - append transcribed text to cell content
            const transcribedText = result.text.trim();
            if (transcribedText) {
                // Get current content without HTML tags
                const currentContent = editorContent;
                const doc = new DOMParser().parseFromString(currentContent, "text/html");
                const currentText = doc.body.textContent || "";

                // Append transcribed text with a space if there's existing content
                const newText = currentText ? `${currentText} ${transcribedText}` : transcribedText;

                // Update the content as HTML
                const newContent = `<span>${newText}</span>`;
                handleContentUpdate(newContent);

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

    const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file && file.type.startsWith("audio/")) {
            setAudioBlob(file);

            // Clean up old URL if exists
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }

            const url = URL.createObjectURL(file);
            safeSetAudioUrl(url);
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

            // Handle audio attachments list
            if (message.type === "providerSendsAudioAttachments") {
                const audioPath = message.attachments[cellMarkers[0]];
                if (audioPath) {
                    // We have an audio file path, but don't use it directly
                    // Just update status - the actual data will come through providerSendsAudioData
                    setRecordingStatus("Loading audio...");
                    // Don't set audioUrl here! Wait for the base64 data
                }
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

                        // Clean up previous blob URL if it exists
                        if (audioUrl && audioUrl.startsWith("blob:")) {
                            URL.revokeObjectURL(audioUrl);
                        }

                        const blobUrl = URL.createObjectURL(blob);

                        setAudioBlob(blob);
                        safeSetAudioUrl(blobUrl);
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
                } else if (message.content.audioUrl) {
                    // Validate that this is a proper URL the webview can access
                    const url = message.content.audioUrl;
                    if (
                        url.startsWith("blob:") ||
                        url.startsWith("data:") ||
                        url.startsWith("http")
                    ) {
                        safeSetAudioUrl(url);
                        setRecordingStatus("Audio loaded");
                    } else {
                        // This is likely a file path, which won't work in the webview
                        console.error("Received invalid audio URL (file path?):", url);
                        setRecordingStatus("Error: Invalid audio URL");
                    }

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
    }, [cellMarkers, audioUrl]);

    // Clean up media recorder and stream on unmount
    useEffect(() => {
        return () => {
            if (mediaRecorder && mediaRecorder.state !== "inactive") {
                mediaRecorder.stop();
                mediaRecorder.stream.getTracks().forEach((track) => track.stop());
            }
            // Clean up blob URL if it exists
            if (audioUrl && audioUrl.startsWith("blob:")) {
                URL.revokeObjectURL(audioUrl);
            }
            // Clean up transcription client if active
            if (transcriptionClientRef.current) {
                transcriptionClientRef.current.abort();
                transcriptionClientRef.current = null;
            }
        };
    }, [mediaRecorder, audioUrl]);

    return (
        <Card className="w-full max-w-4xl shadow-xl" style={{ direction: textDirection }}>
            <CardHeader className="border-b p-4">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        {isEditorControlsExpanded ? (
                            <X
                                className="h-4 w-4 cursor-pointer"
                                onClick={() =>
                                    setIsEditorControlsExpanded(!isEditorControlsExpanded)
                                }
                            />
                        ) : (
                            <div
                                className="flex items-center gap-2 cursor-pointer"
                                onClick={() =>
                                    setIsEditorControlsExpanded(!isEditorControlsExpanded)
                                }
                            >
                                <span className="text-lg font-semibold">{cellMarkers[0]}</span>
                                {editableLabel && (
                                    <span className="text-sm text-muted-foreground">
                                        {editableLabel}
                                    </span>
                                )}
                                <Pencil className="h-4 w-4" />
                            </div>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        <TooltipProvider>
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
                        </TooltipProvider>
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
                        {unsavedChanges ? (
                            <>
                                <Button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleSaveHtml();
                                    }}
                                    variant="default"
                                    size="icon"
                                    title="Save changes"
                                >
                                    <Check className="h-4 w-4" />
                                </Button>
                                <Button
                                    onClick={handleCloseEditor}
                                    variant="ghost"
                                    size="icon"
                                    title="Discard changes"
                                >
                                    <X className="h-4 w-4" />
                                </Button>
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
                                setEditorContent(html);

                                debug("html", { html, cellMarkers, editableLabel });

                                setContentBeingUpdated({
                                    cellMarkers,
                                    cellContent: html,
                                    cellChanged: true,
                                    cellLabel: editableLabel,
                                });
                            }}
                            textDirection={textDirection}
                            ref={editorHandlesRef}
                        />
                    </div>
                </div>

                <Tabs
                    defaultValue={activeTab}
                    value={activeTab}
                    onValueChange={(value) =>
                        setActiveTab(value as "source" | "backtranslation" | "footnotes" | "audio")
                    }
                    className="w-full"
                >
                    <TabsList className="grid w-full grid-cols-4">
                        <TabsTrigger value="source" disabled={!sourceText}>
                            <FileCode className="mr-2 h-4 w-4" />
                            Source
                            {!sourceText && (
                                <span className="ml-2 h-2 w-2 rounded-full bg-gray-400" />
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="backtranslation">
                            <RotateCcw className="mr-2 h-4 w-4" />
                            Backtranslate
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
                            Footnotes
                            {footnotes.length > 0 && (
                                <Badge variant="secondary" className="ml-2 h-5 px-1.5">
                                    {footnotes.length}
                                </Badge>
                            )}
                        </TabsTrigger>
                        <TabsTrigger value="audio">
                            <Mic className="mr-2 h-4 w-4" />
                            Audio
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
                    </TabsList>

                    <TabsContent value="source">
                        <div className="content-section">
                            <div
                                className="prose prose-sm max-w-none"
                                dangerouslySetInnerHTML={{
                                    __html:
                                        sourceText !== null ? sourceText : "Loading source text...",
                                }}
                            />
                        </div>
                    </TabsContent>

                    <TabsContent value="backtranslation">
                        <div className="content-section space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-lg font-medium">Backtranslation</h3>
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
                                        disabled={!contentBeingUpdated.cellContent.trim()}
                                    >
                                        <RefreshCcw className="h-4 w-4" />
                                    </Button>
                                </div>
                            </div>

                            {backtranslation ? (
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
                                                Backtranslation will be available once you have text
                                                to translate.
                                            </p>
                                        </>
                                    )}
                                </div>
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
                                                    {index + 1}
                                                </Badge>
                                                <FootnoteDeleteButton
                                                    onConfirm={() => {
                                                        // Create DOM parser to edit the HTML directly
                                                        const parser = new DOMParser();
                                                        const doc = parser.parseFromString(
                                                            editorContent,
                                                            "text/html"
                                                        );

                                                        // Find and remove footnote markers
                                                        doc.querySelectorAll(
                                                            "sup.footnote-marker"
                                                        ).forEach((el) => {
                                                            if (el.textContent === footnote.id) {
                                                                el.remove();
                                                            }
                                                        });

                                                        // Update editor content
                                                        const updatedContent = doc.body.innerHTML;
                                                        handleContentUpdate(updatedContent);

                                                        // Force parse footnotes again
                                                        setTimeout(parseFootnotesFromContent, 50);
                                                    }}
                                                />
                                            </div>
                                            <div
                                                className="text-sm p-2 rounded bg-muted"
                                                contentEditable
                                                suppressContentEditableWarning
                                                dangerouslySetInnerHTML={{
                                                    __html: footnote.content,
                                                }}
                                                onBlur={(e) => {
                                                    const updatedContent =
                                                        e.currentTarget.innerHTML;

                                                    // Create DOM parser to edit the HTML directly
                                                    const parser = new DOMParser();
                                                    const doc = parser.parseFromString(
                                                        editorContent,
                                                        "text/html"
                                                    );

                                                    // Find and update footnote content attributes
                                                    doc.querySelectorAll(
                                                        "sup.footnote-marker"
                                                    ).forEach((el) => {
                                                        if (el.textContent === footnote.id) {
                                                            el.setAttribute(
                                                                "data-footnote",
                                                                updatedContent
                                                            );
                                                        }
                                                    });

                                                    // Update editor content
                                                    const newHtml = doc.body.innerHTML;
                                                    handleContentUpdate(newHtml);

                                                    // Update footnotes array for immediate UI feedback
                                                    setFootnotes(
                                                        footnotes.map((fn) =>
                                                            fn.id === footnote.id
                                                                ? { ...fn, content: updatedContent }
                                                                : fn
                                                        )
                                                    );
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
                                    {/* Audio player container matching reference design */}
                                    <div className="audio-player-container">
                                        <div className="audio-controls">
                                            <Button variant="outline" size="icon" disabled>
                                                <Play className="h-4 w-4" />
                                            </Button>
                                            <div className="flex-grow space-y-1">
                                                <div className="audio-filename">
                                                    sample_audio.mp3
                                                </div>
                                                <audio
                                                    controls
                                                    src={
                                                        audioUrl &&
                                                        (audioUrl.startsWith("blob:") ||
                                                            audioUrl.startsWith("data:") ||
                                                            audioUrl.startsWith("http"))
                                                            ? audioUrl
                                                            : undefined
                                                    }
                                                    className="w-full h-8"
                                                    onError={(e) => {
                                                        console.error(
                                                            "Error playing audio for cell:",
                                                            cellMarkers[0]
                                                        );
                                                        const audioElement =
                                                            e.currentTarget as HTMLAudioElement;
                                                        if (audioElement.error) {
                                                            console.error(
                                                                "Error handling audio playbook:",
                                                                audioElement.error
                                                            );
                                                        }
                                                        setRecordingStatus(
                                                            "Error loading audio file"
                                                        );

                                                        // Request audio attachments again to reload with proper base64 data
                                                        const messageContent: EditorPostMessages = {
                                                            command: "requestAudioForCell",
                                                            content: { cellId: cellMarkers[0] },
                                                        };
                                                        window.vscodeApi.postMessage(
                                                            messageContent
                                                        );
                                                    }}
                                                />
                                                <div className="flex justify-between items-center">
                                                    <span className="audio-time">0:14</span>
                                                    <span className="audio-time">0:45</span>
                                                </div>
                                            </div>
                                            <Button variant="ghost" size="icon">
                                                <Volume2 className="h-4 w-4" />
                                            </Button>
                                        </div>
                                    </div>

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
                                            <>
                                                <Button
                                                    onClick={() => setConfirmingDiscard(true)}
                                                    variant="outline"
                                                    size="sm"
                                                >
                                                    Remove Audio
                                                </Button>
                                                <Button
                                                    onClick={
                                                        isRecording ? stopRecording : startRecording
                                                    }
                                                    variant="outline"
                                                    size="sm"
                                                    className={isRecording ? "animate-pulse" : ""}
                                                >
                                                    {isRecording ? (
                                                        <>
                                                            <Square className="mr-2 h-4 w-4" />
                                                            Stop
                                                        </>
                                                    ) : (
                                                        <>Re-record / Load New</>
                                                    )}
                                                </Button>
                                                <Button
                                                    onClick={handleTranscribeAudio}
                                                    variant="default"
                                                    disabled={isTranscribing || !audioBlob}
                                                    className="flex-grow sm:flex-grow-0"
                                                >
                                                    {isTranscribing ? (
                                                        <>
                                                            <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                                                            Transcribing...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <MessageCircle className="mr-2 h-4 w-4" />
                                                            Transcribe
                                                        </>
                                                    )}
                                                </Button>
                                            </>
                                        )}
                                    </div>

                                    {/* Transcription section */}
                                    <div className="space-y-3">
                                        <h4 className="font-medium">Transcription</h4>

                                        {/* Transcription progress */}
                                        {(isTranscribing || transcriptionStatus) && (
                                            <div className="space-y-2">
                                                {isTranscribing && transcriptionProgress > 0 && (
                                                    <Progress
                                                        value={transcriptionProgress}
                                                        className="mb-2"
                                                    />
                                                )}
                                                {transcriptionStatus && (
                                                    <p className="text-sm text-center text-muted-foreground">
                                                        {transcriptionStatus}
                                                    </p>
                                                )}
                                            </div>
                                        )}

                                        {!isTranscribing && !transcriptionStatus && (
                                            <div className="p-4 border border-dashed rounded-lg text-center text-muted-foreground">
                                                {savedTranscription ? (
                                                    <div className="space-y-2 text-left">
                                                        <div className="text-sm font-medium">
                                                            Transcription:
                                                        </div>
                                                        <div className="text-sm">
                                                            {savedTranscription.content}
                                                        </div>
                                                        <div className="text-xs text-muted-foreground">
                                                            Language: {savedTranscription.language}{" "}
                                                            •{" "}
                                                            {new Date(
                                                                savedTranscription.timestamp
                                                            ).toLocaleString()}
                                                        </div>
                                                    </div>
                                                ) : (
                                                    "Audio loaded (sample_audio.mp3). Click 'Transcribe' to generate text."
                                                )}
                                            </div>
                                        )}
                                    </div>

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

export default CellEditor;
