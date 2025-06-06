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
import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { AddParatextButton } from "./AddParatextButton";
import ReactMarkdown from "react-markdown";
import "./TextCellEditorStyles.css";
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import "./TextEditor.css";
import SourceCellContext from "./contextProviders/SourceCellContext";
import ConfirmationButton from "./ConfirmationButton";
import { generateChildCellId } from "../../../../src/providers/codexCellEditorProvider/utils/cellUtils";
import ScrollToContentContext from "./contextProviders/ScrollToContentContext";
import { VSCodeCheckbox } from "@vscode/webview-ui-toolkit/react";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
import Quill from "quill";

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
            <div style={{ display: "flex", alignItems: "center" }}>
                <button
                    className="footnote-confirm"
                    onClick={() => {
                        onConfirm();
                        setIsDeleting(false);
                    }}
                    title="Confirm Delete"
                    style={{ marginRight: "4px", color: "var(--vscode-debugIcon-startForeground)" }}
                >
                    <i className="codicon codicon-check"></i>
                </button>
                <button
                    className="footnote-cancel"
                    onClick={() => setIsDeleting(false)}
                    title="Cancel"
                    style={{ color: "var(--vscode-debugIcon-stopForeground)" }}
                >
                    <i className="codicon codicon-close"></i>
                </button>
            </div>
        );
    }

    return (
        <button
            className="footnote-delete"
            onClick={() => setIsDeleting(true)}
            title="Delete Footnote"
        >
            <i className="codicon codicon-trash"></i>
        </button>
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
    const [audioUrl, setAudioUrl] = useState<string | null>(null);
    const [isRecording, setIsRecording] = useState(false);
    const [mediaRecorder, setMediaRecorder] = useState<MediaRecorder | null>(null);
    const [recordingStatus, setRecordingStatus] = useState<string>("");
    const audioChunksRef = useRef<Blob[]>([]);

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
        // Convert blob to base64 for storage
        const reader = new FileReader();
        reader.onloadend = () => {
            const base64data = reader.result as string;
            // Store audio data in session storage temporarily
            sessionStorage.setItem(`audio-${cellMarkers[0]}`, base64data);

            // Notify that audio has been attached
            setRecordingStatus("Audio saved to cell");
        };
        reader.readAsDataURL(blob);
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
            setAudioUrl(url);
            setRecordingStatus("Audio file loaded");

            // Save to cell
            saveAudioToCell(file);
        } else {
            setRecordingStatus("Please select a valid audio file");
        }
    };

    // Load existing audio when component mounts
    useEffect(() => {
        // Check session storage first
        const storedAudio = sessionStorage.getItem(`audio-${cellMarkers[0]}`);
        if (storedAudio) {
            fetch(storedAudio)
                .then((res) => res.blob())
                .then((blob) => {
                    setAudioBlob(blob);
                    if (audioUrl) {
                        URL.revokeObjectURL(audioUrl);
                    }
                    const url = URL.createObjectURL(blob);
                    setAudioUrl(url);
                    setRecordingStatus("Audio loaded from cache");
                });
        }

        // Also request audio attachments from the provider
        const messageContent: EditorPostMessages = {
            command: "requestAudioAttachments",
        };
        window.vscodeApi.postMessage(messageContent);
    }, [cellMarkers]);

    // Handle audio data response
    useEffect(() => {
        const handleAudioResponse = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "providerSendsAudioAttachments") {
                const audioPath = message.attachments[cellMarkers[0]];
                if (audioPath) {
                    // We have an audio file path, but in webview we can't directly access files
                    // We would need the provider to send the actual data
                    setRecordingStatus("Audio file attached to cell");
                }
            }
        };

        window.addEventListener("message", handleAudioResponse);
        return () => window.removeEventListener("message", handleAudioResponse);
    }, [cellMarkers]);

    // Cleanup audio URL on unmount
    useEffect(() => {
        return () => {
            if (audioUrl) {
                URL.revokeObjectURL(audioUrl);
            }
        };
    }, [audioUrl]);

    return (
        <div ref={cellEditorRef} className="cell-editor" style={{ direction: textDirection }}>
            <div className="editor-controls-header">
                <div
                    className="header-content"
                    onClick={() => setIsEditorControlsExpanded(!isEditorControlsExpanded)}
                    style={{ cursor: "pointer" }}
                >
                    {isEditorControlsExpanded ? (
                        <i className="codicon codicon-close"></i>
                    ) : (
                        <div className="header-label">
                            <h3></h3>
                            {editableLabel} <i className="codicon codicon-edit"></i>
                        </div>
                    )}
                </div>
                <div className="action-buttons">
                    <VSCodeButton
                        onClick={() => editorHandlesRef.current?.openLibrary()}
                        appearance="icon"
                        title="Add All Words to Dictionary"
                    >
                        <i className="codicon codicon-book"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={() => editorHandlesRef.current?.autocomplete()}
                        appearance="icon"
                        title="Autocomplete with AI"
                    >
                        <i className="codicon codicon-sparkle"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={() => editorHandlesRef.current?.showEditHistory()}
                        appearance="icon"
                        title="Show Edit History"
                    >
                        <i className="codicon codicon-history"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        onClick={() => editorHandlesRef.current?.addFootnote()}
                        appearance="icon"
                        title="Add Footnote"
                    >
                        <i className="codicon codicon-note"></i>
                    </VSCodeButton>
                    {showAdvancedControls ? (
                        <div>
                            <AddParatextButton
                                cellId={cellMarkers[0]}
                                cellTimestamps={cellTimestamps}
                            />
                            {cellType !== CodexCellTypes.PARATEXT && !cellIsChild && (
                                <VSCodeButton
                                    onClick={makeChild}
                                    appearance="icon"
                                    title="Add Child Cell"
                                >
                                    <i className="codicon codicon-type-hierarchy-sub"></i>
                                </VSCodeButton>
                            )}
                            {!sourceCellContent && (
                                <ConfirmationButton
                                    icon="trash"
                                    onClick={deleteCell}
                                    disabled={cellHasContent}
                                />
                            )}
                            <VSCodeButton
                                onClick={handlePinCell}
                                appearance="icon"
                                title={
                                    isPinned ? "Unpin from Parallel View" : "Pin in Parallel View"
                                }
                                style={{
                                    backgroundColor: isPinned
                                        ? "var(--vscode-button-background)"
                                        : "transparent",
                                    color: isPinned
                                        ? "var(--vscode-button-foreground)"
                                        : "var(--vscode-editor-foreground)",
                                    marginLeft: "auto", // This pushes it to the right
                                }}
                            >
                                <i
                                    className={`codicon ${
                                        isPinned ? "codicon-pinned" : "codicon-pin"
                                    }`}
                                ></i>
                            </VSCodeButton>
                        </div>
                    ) : (
                        <VSCodeButton
                            onClick={() => setShowAdvancedControls(!showAdvancedControls)}
                            appearance="icon"
                            title="Show Advanced Controls"
                        >
                            <i className="codicon codicon-gear"></i>
                        </VSCodeButton>
                    )}
                    {unsavedChanges ? (
                        <>
                            <VSCodeButton
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleSaveHtml();
                                }}
                                appearance="primary"
                                className="save-button"
                            >
                                <i className="codicon codicon-check"></i>
                            </VSCodeButton>
                            <CloseButtonWithConfirmation
                                handleDeleteButtonClick={handleCloseEditor}
                            />
                        </>
                    ) : (
                        <VSCodeButton
                            onClick={(e) => {
                                e.stopPropagation();
                                handleCloseEditor();
                            }}
                            appearance="icon"
                            className="close-button"
                        >
                            <i className="codicon codicon-close"></i>
                        </VSCodeButton>
                    )}
                </div>
            </div>

            {isEditorControlsExpanded && (
                <div className="expanded-controls">
                    <div className="input-group">
                        <div className="input-row">
                            <input
                                type="text"
                                value={editableLabel}
                                onChange={handleLabelChange}
                                onBlur={handleLabelBlur}
                                placeholder="Label"
                                className="label-input"
                            />
                            <VSCodeButton
                                onClick={handleLabelSave}
                                appearance="icon"
                                title="Save Label"
                            >
                                <i className="codicon codicon-save"></i>
                            </VSCodeButton>
                        </div>
                    </div>
                </div>
            )}

            <div className={`text-editor ${showFlashingBorder ? "flashing-border" : ""}`}>
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

            <div className="tabs">
                <div className="tab-buttons" role="tablist">
                    <button
                        className={`tab-button ${activeTab === "source" ? "active" : ""} ${
                            !sourceText ? "disabled" : ""
                        }`}
                        onClick={() => sourceText && setActiveTab("source")}
                        role="tab"
                        aria-selected={activeTab === "source"}
                        aria-controls="source-panel"
                        id="source-tab"
                        disabled={!sourceText}
                        title={sourceText ? "View source text" : "No source text available"}
                        onKeyDown={(e) => handleTabKeyDown(e, "source")}
                    >
                        <i className="codicon codicon-file-code"></i>
                        <span className="tab-label">Source</span>
                        {!sourceText && <span className="tab-status">•</span>}
                    </button>
                    <button
                        className={`tab-button ${activeTab === "backtranslation" ? "active" : ""} ${
                            !backtranslation && !contentBeingUpdated.cellContent.trim()
                                ? "disabled"
                                : ""
                        }`}
                        onClick={() => setActiveTab("backtranslation")}
                        role="tab"
                        aria-selected={activeTab === "backtranslation"}
                        aria-controls="backtranslation-panel"
                        id="backtranslation-tab"
                        title={
                            backtranslation
                                ? "View backtranslation"
                                : contentBeingUpdated.cellContent.trim()
                                ? "Generate backtranslation"
                                : "Add content to enable backtranslation"
                        }
                        onKeyDown={(e) => handleTabKeyDown(e, "backtranslation")}
                    >
                        <i className="codicon codicon-sync"></i>
                        <span className="tab-label">Backtranslate</span>
                        {backtranslation && (
                            <span className="tab-badge" title="Backtranslation available">
                                ✓
                            </span>
                        )}
                        {!backtranslation && contentBeingUpdated.cellContent.trim() && (
                            <span className="tab-status" title="Generate backtranslation">
                                !
                            </span>
                        )}
                    </button>
                    <button
                        className={`tab-button ${activeTab === "footnotes" ? "active" : ""}`}
                        onClick={() => setActiveTab("footnotes")}
                        role="tab"
                        aria-selected={activeTab === "footnotes"}
                        aria-controls="footnotes-panel"
                        id="footnotes-tab"
                        title={
                            footnotes.length > 0
                                ? `View ${footnotes.length} footnote${
                                      footnotes.length === 1 ? "" : "s"
                                  }`
                                : "No footnotes yet"
                        }
                        onKeyDown={(e) => handleTabKeyDown(e, "footnotes")}
                    >
                        <i className="codicon codicon-note"></i>
                        <span className="tab-label">Footnotes</span>
                        {footnotes.length > 0 && (
                            <span
                                className="tab-badge footnote-count"
                                title={`${footnotes.length} footnote${
                                    footnotes.length === 1 ? "" : "s"
                                }`}
                            >
                                {footnotes.length}
                            </span>
                        )}
                    </button>
                    <button
                        className={`tab-button ${activeTab === "audio" ? "active" : ""}`}
                        onClick={() => setActiveTab("audio")}
                        role="tab"
                        aria-selected={activeTab === "audio"}
                        aria-controls="audio-panel"
                        id="audio-tab"
                        title={audioUrl ? "Audio attached" : "Record or attach audio"}
                        onKeyDown={(e) => handleTabKeyDown(e, "audio")}
                    >
                        <i className="codicon codicon-mic"></i>
                        <span className="tab-label">Audio</span>
                        {audioUrl && (
                            <span className="tab-badge" title="Audio attached">
                                ✓
                            </span>
                        )}
                    </button>
                </div>
            </div>

            <div className="tab-content">
                {activeTab === "source" && (
                    <div
                        className="source-text-content"
                        role="tabpanel"
                        id="source-panel"
                        aria-labelledby="source-tab"
                        dangerouslySetInnerHTML={{
                            __html: sourceText !== null ? sourceText : "Loading source text...",
                        }}
                    />
                )}
                {activeTab === "backtranslation" && (
                    <div
                        className="backtranslation-section"
                        role="tabpanel"
                        id="backtranslation-panel"
                        aria-labelledby="backtranslation-tab"
                    >
                        <div className="backtranslation-header">
                            <h3>Backtranslation</h3>
                            <div className="backtranslation-actions">
                                {backtranslation && !isEditingBacktranslation && (
                                    <VSCodeButton
                                        onClick={() => setIsEditingBacktranslation(true)}
                                        appearance="icon"
                                        title="Edit Backtranslation"
                                    >
                                        <i className="codicon codicon-edit"></i>
                                    </VSCodeButton>
                                )}
                                <VSCodeButton
                                    onClick={handleGenerateBacktranslation}
                                    appearance="icon"
                                    title="Generate Backtranslation"
                                    disabled={!contentBeingUpdated.cellContent.trim()}
                                >
                                    <i className="codicon codicon-refresh"></i>
                                </VSCodeButton>
                            </div>
                        </div>

                        <div className="backtranslation-body">
                            {backtranslation ? (
                                <>
                                    {isEditingBacktranslation ? (
                                        <div className="backtranslation-edit-container">
                                            <textarea
                                                value={editedBacktranslation || ""}
                                                onChange={(e) =>
                                                    setEditedBacktranslation(e.target.value)
                                                }
                                                className="backtranslation-editor"
                                                placeholder="Enter backtranslation text..."
                                            />
                                            <div className="backtranslation-edit-actions">
                                                <VSCodeButton
                                                    onClick={handleSaveBacktranslation}
                                                    title="Save Backtranslation"
                                                >
                                                    Save
                                                </VSCodeButton>
                                                <VSCodeButton
                                                    onClick={() =>
                                                        setIsEditingBacktranslation(false)
                                                    }
                                                    appearance="secondary"
                                                    title="Cancel Editing"
                                                >
                                                    Cancel
                                                </VSCodeButton>
                                            </div>
                                        </div>
                                    ) : (
                                        <div className="backtranslation-content">
                                            <ReactMarkdown>
                                                {backtranslation.backtranslation}
                                            </ReactMarkdown>
                                        </div>
                                    )}
                                </>
                            ) : (
                                <div className="backtranslation-empty">
                                    {contentBeingUpdated.cellContent.trim() ? (
                                        <>
                                            <p>No backtranslation available for this text.</p>
                                            <p>
                                                Click the refresh button to generate a
                                                backtranslation.
                                            </p>
                                        </>
                                    ) : (
                                        <>
                                            <p>Add content to this cell first.</p>
                                            <p>
                                                Backtranslation will be available once you have text
                                                to translate.
                                            </p>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>
                )}
                {activeTab === "footnotes" && (
                    <div
                        className="footnotes-content"
                        role="tabpanel"
                        id="footnotes-panel"
                        aria-labelledby="footnotes-tab"
                    >
                        {footnotes.length > 0 ? (
                            <div className="footnotes-list">
                                {footnotes.map((footnote, index) => (
                                    <div key={footnote.id} className="footnote-item">
                                        <div className="footnote-header">
                                            <strong className="footnote-id">{index + 1}</strong>
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
                                            className="footnote-content"
                                            contentEditable
                                            suppressContentEditableWarning
                                            dangerouslySetInnerHTML={{ __html: footnote.content }}
                                            onBlur={(e) => {
                                                const updatedContent = e.currentTarget.innerHTML;

                                                // Create DOM parser to edit the HTML directly
                                                const parser = new DOMParser();
                                                const doc = parser.parseFromString(
                                                    editorContent,
                                                    "text/html"
                                                );

                                                // Find and update footnote content attributes
                                                doc.querySelectorAll("sup.footnote-marker").forEach(
                                                    (el) => {
                                                        if (el.textContent === footnote.id) {
                                                            el.setAttribute(
                                                                "data-footnote",
                                                                updatedContent
                                                            );
                                                        }
                                                    }
                                                );

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
                                        ></div>
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="empty-footnotes">
                                <p>No footnotes in this cell yet.</p>
                                <p>
                                    Use the footnote button (
                                    <i className="codicon codicon-note"></i>) in the editor toolbar
                                    to add footnotes.
                                </p>
                            </div>
                        )}
                    </div>
                )}
                {activeTab === "audio" && (
                    <div
                        className="audio-content"
                        role="tabpanel"
                        id="audio-panel"
                        aria-labelledby="audio-tab"
                    >
                        <div className="audio-section">
                            <div className="audio-header">
                                <h3>Audio Recording</h3>
                            </div>

                            <div className="audio-controls">
                                {!audioUrl ? (
                                    <div className="no-audio">
                                        <p>No audio attached to this cell yet.</p>
                                        <div className="audio-actions">
                                            <VSCodeButton
                                                onClick={
                                                    isRecording ? stopRecording : startRecording
                                                }
                                                appearance={isRecording ? "secondary" : "primary"}
                                                className={isRecording ? "recording-button" : ""}
                                            >
                                                <i
                                                    className={`codicon ${
                                                        isRecording
                                                            ? "codicon-stop-circle"
                                                            : "codicon-record"
                                                    }`}
                                                ></i>
                                                {isRecording ? "Stop Recording" : "Start Recording"}
                                            </VSCodeButton>
                                            <VSCodeDivider />
                                            <label className="file-upload-label">
                                                <input
                                                    type="file"
                                                    accept="audio/*"
                                                    onChange={handleFileUpload}
                                                    style={{ display: "none" }}
                                                />
                                                <VSCodeButton appearance="secondary">
                                                    <i className="codicon codicon-folder-opened"></i>
                                                    Upload Audio File
                                                </VSCodeButton>
                                            </label>
                                        </div>
                                    </div>
                                ) : (
                                    <div className="audio-player-section">
                                        <audio controls src={audioUrl} className="audio-player" />
                                        <div className="audio-player-actions">
                                            <VSCodeButton
                                                onClick={() => {
                                                    if (audioUrl) {
                                                        URL.revokeObjectURL(audioUrl);
                                                    }
                                                    setAudioUrl(null);
                                                    setAudioBlob(null);
                                                    setRecordingStatus("");
                                                    sessionStorage.removeItem(
                                                        `audio-${cellMarkers[0]}`
                                                    );
                                                }}
                                                appearance="secondary"
                                                title="Remove audio"
                                            >
                                                <i className="codicon codicon-trash"></i>
                                                Remove Audio
                                            </VSCodeButton>
                                            <VSCodeButton
                                                onClick={
                                                    isRecording ? stopRecording : startRecording
                                                }
                                                appearance="secondary"
                                                className={isRecording ? "recording-button" : ""}
                                                title="Record new audio"
                                            >
                                                <i
                                                    className={`codicon ${
                                                        isRecording
                                                            ? "codicon-stop-circle"
                                                            : "codicon-record"
                                                    }`}
                                                ></i>
                                                {isRecording ? "Stop" : "Re-record"}
                                            </VSCodeButton>
                                        </div>
                                    </div>
                                )}

                                {recordingStatus && (
                                    <div
                                        className={`recording-status ${
                                            isRecording ? "recording" : ""
                                        }`}
                                    >
                                        {recordingStatus}
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default CellEditor;
