import React, {
    useRef,
    useEffect,
    useMemo,
    useState,
    useContext,
    forwardRef,
    useImperativeHandle,
} from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import registerQuillSpellChecker, {
    getCleanedHtml,
    QuillSpellChecker,
} from "./react-quill-spellcheck";
import { EditHistory, EditorPostMessages, SpellCheckResponse } from "../../../../types";
import { EditMapUtils, isValueEdit } from "../../../../src/utils/editMapUtils";
import { EditType } from "../../../../types/enums";

import "./Editor.css"; // Editor styles including footnote selection
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import ReactPlayer from "react-player";
import { diffWords } from "diff";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { processHtmlContent, updateFootnoteNumbering } from "./footnoteUtils";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

const icons: any = Quill.import("ui/icons");
// Assuming you have access to the VSCode API here
const vscode: any = (window as any).vscodeApi;

// Register the QuillSpellChecker with the VSCode API
registerQuillSpellChecker(Quill, vscode);
// Removed custom icon registrations for non-native buttons

// Define the shape of content change callback
export interface EditorContentChanged {
    html: string;
}

// Use Quill's native header dropdown instead of custom cycle buttons

export interface EditorProps {
    currentLineId: string;
    initialValue?: string;
    editHistory: EditHistory[];
    onChange?: (changes: EditorContentChanged) => void;
    onDirtyChange?: (dirty: boolean, rawHtml: string) => void;
    spellCheckResponse?: SpellCheckResponse | null;
    textDirection: "ltr" | "rtl";
    setIsEditingFootnoteInline: (isEditing: boolean) => void;
    isEditingFootnoteInline: boolean;
    footnoteOffset?: number;
}

// Fix the imports with correct typing
const Inline = Quill.import("blots/inline") as any;

// Update class definitions
class AutocompleteFormat extends Inline {
    static blotName = "autocomplete";
    static tagName = "span";
}

class OpenLibraryFormat extends Inline {
    static blotName = "openLibrary";
    static tagName = "span";
}

// Define Footnote Format
class FootnoteFormat extends Inline {
    static blotName = "footnote";
    static tagName = "sup";

    static create(value: string): HTMLElement {
        const node = super.create();
        // Store the footnote content directly in the data-footnote attribute
        node.setAttribute("data-footnote", value || "");
        node.classList.add("footnote-marker");
        // The actual text content will be set by CellContentDisplay to the footnote's position
        return node;
    }

    static formats(node: HTMLElement): string {
        return node.getAttribute("data-footnote") || "";
    }
}

// Register formats
Quill.register({
    "formats/autocomplete": AutocompleteFormat,
    "formats/openLibrary": OpenLibraryFormat,
    "formats/footnote": FootnoteFormat,
});

const DEBUG_ENABLED = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_ENABLED) {
        console.log(`[Editor] ${message}`, ...args);
    }
}

// Export interface for imperative handle
export interface EditorHandles {
    autocomplete: () => void;
    openLibrary: () => void;
    showEditHistory: () => void;
    getSelectionText: () => string;
    addFootnote: () => void;
    editFootnote: (footnoteId: string, content: string) => void;
    updateContent: (content: string) => void;
    renumberFootnotes: () => void;
}

/**
 * Processes Quill content for saving, converting first paragraph to span
 * and preserving subsequent paragraphs
 */
function processQuillContentForSaving(htmlContent: string): string {
    if (!htmlContent || htmlContent.trim() === "") {
        return "";
    }

    debug("[processQuillContentForSaving] Input:", htmlContent);

    try {
        // Create a temporary DOM element for proper HTML parsing
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = htmlContent;

        // Clean up any inline styles and selection classes from footnote markers
        const footnoteMarkers = tempDiv.querySelectorAll("sup.footnote-marker");
        footnoteMarkers.forEach((marker) => {
            const htmlMarker = marker as HTMLElement;
            // Remove inline styles that might have been added during selection
            htmlMarker.style.backgroundColor = "";
            htmlMarker.style.color = "";
            // Remove the style attribute entirely if it's empty
            if (htmlMarker.getAttribute("style") === "") {
                htmlMarker.removeAttribute("style");
            }
            // Also remove the selection class in case it persists
            htmlMarker.classList.remove("footnote-selected");
        });

        // Get all paragraph elements
        const paragraphs = tempDiv.querySelectorAll("p");

        debug("[processQuillContentForSaving] Found paragraphs:", paragraphs.length);

        if (paragraphs.length === 0) {
            // No paragraphs found, wrap content in span
            const result = tempDiv.innerHTML ? `<span>${tempDiv.innerHTML}</span>` : "";
            debug("[processQuillContentForSaving] No paragraphs, result:", result);
            return result;
        }

        if (paragraphs.length === 1) {
            // Single paragraph: convert to span
            const content = paragraphs[0].innerHTML;
            // Check if there's actual content beyond just spaces
            const hasRealContent = content.trim().length > 0;
            const result = hasRealContent ? `<span>${content}</span>` : "";
            debug("[processQuillContentForSaving] Single paragraph, result:", result);
            return result;
        }

        // Multiple paragraphs: first becomes span, others remain paragraphs
        const processedElements: string[] = [];

        paragraphs.forEach((p, index) => {
            const content = p.innerHTML;
            // Only include paragraphs that have actual content beyond spaces
            const hasRealContent = content.trim().length > 0;
            debug(`[processQuillContentForSaving] Processing paragraph ${index}:`, content);
            if (hasRealContent) {
                if (index === 0) {
                    // First paragraph becomes a span
                    const spanElement = `<span>${content}</span>`;
                    processedElements.push(spanElement);
                    debug(`[processQuillContentForSaving] First paragraph as span:`, spanElement);
                } else {
                    // Subsequent paragraphs remain as paragraphs
                    const pElement = `<p>${content}</p>`;
                    processedElements.push(pElement);
                    debug(`[processQuillContentForSaving] Subsequent paragraph:`, pElement);
                }
            }
        });

        const result = processedElements.join("");
        debug("[processQuillContentForSaving] Final result:", result);
        return result;
    } catch (error) {
        console.warn("Error processing Quill content, falling back to simple processing:", error);

        // Enhanced fallback using regex
        const cleaned = htmlContent.trim();
        debug("[processQuillContentForSaving] Fallback processing:", cleaned);

        // Count paragraphs using regex
        const paragraphMatches = cleaned.match(/<p[^>]*>[\s\S]*?<\/p>/g);
        const paragraphCount = paragraphMatches ? paragraphMatches.length : 0;

        debug("[processQuillContentForSaving] Fallback paragraph count:", paragraphCount);

        if (paragraphCount === 0) {
            return cleaned ? `<span>${cleaned}</span>` : "";
        }

        if (paragraphCount === 1) {
            // Single paragraph case
            const match = cleaned.match(/<p[^>]*>([\s\S]*?)<\/p>/);
            if (match) {
                const content = match[1];
                // Check if there's actual content beyond just spaces
                const hasRealContent = content.trim().length > 0;
                return hasRealContent ? `<span>${content}</span>` : "";
            }
            return cleaned ? `<span>${cleaned}</span>` : "";
        }

        // Multiple paragraphs: process each
        if (paragraphMatches) {
            const processedParagraphs = paragraphMatches
                .map((paragraph, index) => {
                    const match = paragraph.match(/<p[^>]*>([\s\S]*?)<\/p>/);
                    if (match) {
                        const content = match[1];
                        // Only include paragraphs with real content
                        const hasRealContent = content.trim().length > 0;
                        if (hasRealContent) {
                            return index === 0 ? `<span>${content}</span>` : `<p>${content}</p>`;
                        }
                    }
                    return "";
                })
                .filter((p) => p !== "");

            const result = processedParagraphs.join("");
            debug("[processQuillContentForSaving] Fallback result:", result);
            return result;
        }

        return cleaned;
    }
}

// Function to check if Quill editor is empty
function isQuillEmpty(quill: Quill | null) {
    if (!quill) return true;
    const delta = quill.getContents();
    const text = delta.ops?.reduce((text, op) => {
        return text + (op.insert ? op.insert : "");
    }, "");
    return text?.trim().length === 0;
}

// Wrap the Editor component in forwardRef instead of default export
const Editor = forwardRef<EditorHandles, EditorProps>((props, ref) => {
    const { setIsEditingFootnoteInline, isEditingFootnoteInline } = props;
    const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
    const [isToolbarVisible, setIsToolbarVisible] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [wordsToAdd, setWordsToAdd] = useState<string[]>([]);
    const [isEditorEmpty, setIsEditorEmpty] = useState(true);
    const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([]);
    const initialContentRef = useRef<string>("");
    // Header selection now uses Quill's native dropdown; no local label state needed
    const { setUnsavedChanges } = useContext(UnsavedChangesContext);
    const quillRef = useRef<Quill | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);

    const [currentAuthor, setCurrentAuthor] = useState<string>(
        (window as any).initialData?.userInfo?.username || "anonymous"
    );

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [historyTab, setHistoryTab] = useState<"history" | "llm-previews">("history");
    const [editHistoryForCell, setEditHistoryForCell] = useState<EditHistory[]>(props.editHistory);

    const [footnoteCount, setFootnoteCount] = useState(1);
    const [characterCount, setCharacterCount] = useState(0);

    // Track the baseline content for dirty checking (updated when LLM content is set)
    const quillInitialContentRef = useRef<string>("");

    // Track whether current content is LLM-generated and needs explicit save to be considered "user content"
    const isLLMContentNeedingApprovalRef = useRef<boolean>(false);

    // Inline footnote editing states (for both creating and editing)
    const [editingFootnoteId, setEditingFootnoteId] = useState("");
    const [editingFootnoteContent, setEditingFootnoteContent] = useState("");
    const [isCreatingNewFootnote, setIsCreatingNewFootnote] = useState(false);
    const [footnoteWord, setFootnoteWord] = useState("");
    const [cursorPositionForFootnote, setCursorPositionForFootnote] = useState(0);
    const [originalCellContent, setOriginalCellContent] = useState("");
    const [skipOnChange, setSkipOnChange] = useState(false);

    // Handle keyboard events for inline footnote editing
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape" && isEditingFootnoteInline) {
                setIsEditingFootnoteInline(false);
                setIsCreatingNewFootnote(false);
            }
        };

        if (isEditingFootnoteInline) {
            document.addEventListener("keydown", handleKeyDown);
        }

        return () => {
            document.removeEventListener("keydown", handleKeyDown);
        };
    }, [isEditingFootnoteInline]);

    // Initialize Quill editor
    useEffect(() => {
        if (editorRef.current && !quillRef.current) {
            const quill = new Quill(editorRef.current, {
                theme: "snow",
                placeholder: "Start writing...",
                modules: {
                    toolbar: {
                        container: TOOLBAR_OPTIONS,
                    },
                    keyboard: {
                        bindings: {
                            "list autofill": false, // This disables the automatic list creation
                            tab: {
                                key: "tab",
                                // When the tab key is pressed, skip the on change logic.
                                handler: () => {
                                    setSkipOnChange(true);

                                    return true;
                                },
                            },
                        },
                    },
                    spellChecker: {},
                },
            });
            // Apply minimal direct styles; rely on CSS file for look-and-feel
            const toolbar = editorRef.current.querySelector(".ql-toolbar");
            const container = editorRef.current.querySelector(".ql-container");

            if (toolbar) {
                // Keep transitions smooth; primary styling handled in CSS
                toolbar.setAttribute("style", "transition: all 0.2s ease; overflow: hidden;");
            }

            // Add paste event listener to handle paste operations
            quill.root.addEventListener("paste", () => {
                // Set unsaved changes immediately when paste is detected
                setUnsavedChanges(true);

                // Use setTimeout to ensure the paste operation completes, then process content
                setTimeout(() => {
                    if (quillRef.current && props.onChange) {
                        const content = quillRef.current.root.innerHTML;
                        debug("Paste content processing", {
                            content,
                            isEmpty: isQuillEmpty(quillRef.current),
                        });

                        // Process the content using the improved processing function
                        const contentIsEmpty = isQuillEmpty(quillRef.current);
                        const finalContent = contentIsEmpty
                            ? ""
                            : processQuillContentForSaving(getCleanedHtml(content));

                        debug("Paste finalContent", { finalContent, contentIsEmpty });

                        // Call onChange to update contentBeingUpdated
                        props.onChange({
                            html: finalContent,
                        });
                    }
                }, 50); // Slightly longer timeout to ensure paste is complete
            });

            // Add Microsoft Word-style footnote deletion behavior
            let selectedFootnoteMarker: Element | null = null;

            const handleFootnoteDeletion = (event: KeyboardEvent) => {
                if (!quillRef.current || (event.key !== "Backspace" && event.key !== "Delete")) {
                    return;
                }

                const selection = quillRef.current.getSelection();
                if (!selection) return;

                // Look for footnote markers in the editor content
                const allFootnotes = quillRef.current.root.querySelectorAll(".footnote-marker");
                if (allFootnotes.length === 0) return;

                // Get the current cursor position
                const [leaf] = quillRef.current.getLeaf(selection.index);
                if (!leaf || !leaf.domNode) return;

                let footnoteMarker: Element | null = null;
                const element = leaf.domNode as Element;

                debug("Footnote deletion attempt", {
                    key: event.key,
                    selectionIndex: selection.index,
                    elementTag: element.tagName,
                    elementClass: element.className,
                    totalFootnotes: allFootnotes.length,
                });

                // Simple approach: check if we're directly in a footnote marker
                if (element.classList?.contains("footnote-marker")) {
                    footnoteMarker = element;
                    debug("Found footnote marker directly", { marker: footnoteMarker });
                } else {
                    // Check parent elements up the tree
                    let parent = element.parentElement;
                    while (parent && !footnoteMarker) {
                        if (parent.classList?.contains("footnote-marker")) {
                            footnoteMarker = parent;
                            debug("Found footnote marker in parent", { marker: footnoteMarker });
                            break;
                        }
                        parent = parent.parentElement;
                    }

                    // If still not found, check all footnotes to see if cursor is adjacent
                    if (!footnoteMarker) {
                        for (const footnote of allFootnotes) {
                            const footnoteIndex = quillRef.current.getIndex(footnote as any);

                            // Check if cursor is right before or after this footnote
                            if (event.key === "Delete" && selection.index === footnoteIndex) {
                                footnoteMarker = footnote;
                                debug("Found footnote marker with Delete key", {
                                    marker: footnoteMarker,
                                });
                                break;
                            } else if (
                                event.key === "Backspace" &&
                                selection.index === footnoteIndex + 1
                            ) {
                                footnoteMarker = footnote;
                                debug("Found footnote marker with Backspace key", {
                                    marker: footnoteMarker,
                                });
                                break;
                            }
                        }
                    }
                }

                if (!footnoteMarker) {
                    debug("No footnote marker found");
                    return;
                }

                debug("Processing footnote marker", {
                    marker: footnoteMarker,
                    isSelected: selectedFootnoteMarker === footnoteMarker,
                    selectedMarker: selectedFootnoteMarker,
                });

                // If this footnote is already selected, delete it
                if (selectedFootnoteMarker === footnoteMarker) {
                    event.preventDefault();

                    debug("Deleting footnote marker", { marker: footnoteMarker });

                    // Remove the footnote marker
                    footnoteMarker.remove();
                    selectedFootnoteMarker = null;

                    // Trigger content change and renumber footnotes
                    setTimeout(() => {
                        if (quillRef.current && props.onChange) {
                            const content = quillRef.current.root.innerHTML;
                            const cleanedContents = getCleanedHtml(content);
                            props.onChange({ html: cleanedContents });
                        }

                        // Renumber remaining footnotes (now preserves cursor automatically)
                        setTimeout(() => {
                            if (quillRef.current) {
                                renumberFootnotes();
                                debug("Footnote deletion completed");
                            }
                        }, 10);
                    }, 10);

                    return;
                }

                // First time: select the footnote marker
                event.preventDefault();
                selectedFootnoteMarker = footnoteMarker;

                // Add visual selection styling using CSS class
                footnoteMarker.classList.add("footnote-selected");

                // Clear selection after a delay if no further deletion occurs
                setTimeout(() => {
                    if (selectedFootnoteMarker === footnoteMarker) {
                        footnoteMarker.classList.remove("footnote-selected");
                        selectedFootnoteMarker = null;
                    }
                }, 3000); // Clear selection after 3 seconds
            };

            // Add keyboard event listener for footnote deletion and selection clearing
            const handleKeyDown = (event: KeyboardEvent) => {
                // Handle footnote deletion
                if (event.key === "Backspace" || event.key === "Delete") {
                    handleFootnoteDeletion(event);
                } else {
                    // Clear footnote selection on any other key press
                    if (selectedFootnoteMarker) {
                        selectedFootnoteMarker.classList.remove("footnote-selected");
                        selectedFootnoteMarker = null;
                    }
                }
            };

            quill.root.addEventListener("keydown", handleKeyDown);

            // Clear footnote selection on click
            const clearFootnoteSelection = () => {
                if (selectedFootnoteMarker) {
                    selectedFootnoteMarker.classList.remove("footnote-selected");
                    selectedFootnoteMarker = null;
                }
            };

            quill.root.addEventListener("click", clearFootnoteSelection);

            quillRef.current = quill;

            if (props.initialValue) {
                quill.root.innerHTML = props.initialValue;

                // Position cursor at the end of the content for immediate editing
                setTimeout(() => {
                    // Set cursor to the end of the text
                    const textLength = quill.getLength();
                    quill.setSelection(textLength - 1, 0); // -1 because Quill includes a trailing newline
                    quill.focus(); // Ensure editor has focus

                    // Renumber footnotes to ensure proper chronological order on load
                    renumberFootnotes();
                }, 100);
            }
            // Store initial content when editor is mounted (baseline for dirty - never overwrite in handler)
            const mountedHtml = quill.root.innerHTML;
            initialContentRef.current = mountedHtml;
            quillInitialContentRef.current = mountedHtml;

            // Check if initial content is LLM-generated (needs explicit save) at mount
            if (props.editHistory && props.editHistory.length > 0) {
                const latestEdit = props.editHistory[props.editHistory.length - 1];
                if (
                    latestEdit.type === EditType.LLM_GENERATION ||
                    latestEdit.type === EditType.LLM_EDIT
                ) {
                    const isPreviewEdit = (latestEdit as any).preview === true;
                    if (isPreviewEdit) {
                        isLLMContentNeedingApprovalRef.current = true;
                        debug("Editor initialized with LLM content needing approval", {
                            latestEdit,
                        });
                    } else {
                        isLLMContentNeedingApprovalRef.current = false;
                        debug("Editor initialized with saved LLM content (no approval needed)", {
                            latestEdit,
                        });
                    }
                }
            }

            // Add text-change event listener with source parameter
            quill.on("text-change", (delta: any, oldDelta: any, source: string) => {
                // Skip on change so the tab key doesn't trigger dirty state logic.
                if (skipOnChange) {
                    setSkipOnChange(false);
                    return;
                }

                const content = quill.root.innerHTML;

                // Update character count
                const textContent = quill.getText();
                const charCount = textContent.trim().length;
                setCharacterCount(charCount);

                // If we're editing a footnote, just update the footnote content state
                if (isEditingFootnoteInline) {
                    setEditingFootnoteContent(content);
                    return;
                }

                // Skip dirty checking for non-user changes (API/silent changes from LLM, etc.)
                // Only user-initiated changes should trigger dirty state logic
                if (source !== "user") {
                    // Still call onChange for programmatic changes
                    if (props.onChange) {
                        const contentIsEmpty = isQuillEmpty(quill);
                        const finalContent = contentIsEmpty
                            ? ""
                            : processQuillContentForSaving(getCleanedHtml(content));
                        props.onChange({
                            html: finalContent,
                        });
                    }
                    return;
                }

                // Normal cell content editing logic (user-initiated changes only)
                const initialQuillContent = "<p><br></p>";
                const baseline = quillInitialContentRef.current;

                // Primary: any difference from baseline means dirty (ensures first keystroke always registers)
                let isDirty = content !== baseline;

                if (!isDirty && baseline === initialQuillContent) {
                    // Started empty: any non-empty content is dirty
                    isDirty = !isQuillEmpty(quill) && content !== initialQuillContent;
                }
                if (!isDirty && content && content !== "<p><br></p>" && content !== baseline) {
                    isDirty = true;
                }

                // Critical: If content is LLM-generated and hasn't been explicitly saved by user,
                // keep it marked as dirty even if it matches baseline
                if (!isDirty && isLLMContentNeedingApprovalRef.current) {
                    isDirty = true;
                    debug("Marking as dirty because LLM content needs approval");
                }

                debug("isDirty", {
                    isDirty,
                    content,
                    initialContentRefCurrent: initialContentRef.current,
                    quillInitialContent: quillInitialContentRef.current,
                    isLLMContentNeedingApproval: isLLMContentNeedingApprovalRef.current,
                    isQuillEmpty: isQuillEmpty(quill),
                });

                // Notify parent about dirty state changes using raw Quill HTML
                props.onDirtyChange?.(isDirty, content);

                if (isDirty) {
                    setUnsavedChanges(true);
                    if (props.onChange) {
                        const contentIsEmpty = isQuillEmpty(quill);
                        const finalContent = contentIsEmpty
                            ? ""
                            : processQuillContentForSaving(getCleanedHtml(content));

                        debug("finalContent", { finalContent, contentIsEmpty });

                        props.onChange({
                            html: finalContent,
                        });
                    }
                    // Header selection handled by native dropdown
                }
            });

            // Save edit history on unmount and cleanup
            return () => {
                if (quillRef.current) {
                    const finalContent = quillRef.current.root.innerHTML;
                    if (finalContent !== initialContentRef.current) {
                        setEditHistory((prev) => {
                            const newEntry = {
                                before: initialContentRef.current,
                                after: finalContent,
                                timestamp: Date.now(),
                                author: currentAuthor,
                            };
                            return [...prev, newEntry];
                        });
                    }

                    // Clear any selected footnotes
                    const selectedFootnotes =
                        quillRef.current.root.querySelectorAll(".footnote-selected");
                    selectedFootnotes.forEach((footnote) => {
                        footnote.classList.remove("footnote-selected");
                    });

                    // Clean up spell checker
                    const spellChecker = quillRef.current.getModule(
                        "spellChecker"
                    ) as QuillSpellChecker;
                    if (spellChecker) {
                        spellChecker.dispose();
                    }

                    // Clear the reference
                    quillRef.current = null;
                }
            };
        }
    }, []); // Empty dependency array

    // Removed custom header cycle logic in favor of native dropdown

    // Revert content if necessary
    const revertedValue = useMemo(() => {
        if (!props.initialValue) return "";
        return props.initialValue
            ?.replace(/^<span>/, "<p>")
            .replace(/<\/span>/, "</p>")
            .replace(/\n$/, "");
    }, [props.initialValue]);

    // Apply reverted value if editor is empty
    useEffect(() => {
        if (quillRef.current && revertedValue !== undefined) {
            const quill = quillRef.current;
            if (isQuillEmpty(quill) && revertedValue) {
                quill.root.innerHTML = revertedValue;
                quill.setSelection(quill.getLength(), 0);

                // Update character count when content is set
                const textContent = quill.getText();
                const charCount = textContent.trim().length;
                setCharacterCount(charCount);

                // Renumber footnotes to ensure proper chronological order
                setTimeout(() => {
                    renumberFootnotes();
                }, 100);
            }
        }
    }, [revertedValue]);

    const llmCompletion = async () => {
        window.vscodeApi.postMessage({
            command: "llmCompletion",
            content: {
                currentLineId: props.currentLineId,
            },
        } as EditorPostMessages);
    };

    const handleAddWords = () => {
        if (wordsToAdd.length > 0) {
            window.vscodeApi.postMessage({
                command: "addWord",
                words: wordsToAdd,
            });
        }
        setShowModal(false);
    };

    // Add message listener for prompt response
    useMessageHandler(
        "editor-promptResponse",
        (event: MessageEvent) => {
            if (quillRef.current) {
                const quill = quillRef.current;
                if (event.data.type === "providerSendsPromptedEditResponse") {
                    const editedContent = event.data.content;
                    // Use Quill's API to set content with "api" source (not "user")
                    quill.clipboard.dangerouslyPasteHTML(editedContent, "api");

                    // Update baseline for dirty checking - LLM content is the new "initial" state
                    quillInitialContentRef.current = quill.root.innerHTML;

                    // Mark as LLM content needing approval
                    isLLMContentNeedingApprovalRef.current = true;

                    // Manually update all state for programmatic changes
                    const textContent = quill.getText();
                    const charCount = textContent.trim().length;
                    setCharacterCount(charCount);

                    // Call onChange with processed content
                    const contentIsEmpty = isQuillEmpty(quill);
                    const finalContent = contentIsEmpty
                        ? ""
                        : processQuillContentForSaving(getCleanedHtml(quill.root.innerHTML));
                    props.onChange?.({ html: finalContent });

                    // Mark as dirty to ensure save button appears
                    props.onDirtyChange?.(true, quill.root.innerHTML);
                    setUnsavedChanges(true);
                } else if (event.data.type === "providerSendsLLMCompletionResponse") {
                    const completionText = event.data.content.completion;
                    const completionCellId = event.data.content.cellId;

                    // Validate that the completion is for the current cell
                    if (completionCellId === props.currentLineId) {
                        // Use Quill's API to set content with "api" source (not "user")
                        quill.clipboard.dangerouslyPasteHTML(completionText, "api");

                        // Update baseline for dirty checking - LLM content is the new "initial" state
                        quillInitialContentRef.current = quill.root.innerHTML;

                        // Mark as LLM content needing approval
                        isLLMContentNeedingApprovalRef.current = true;

                        // Manually update all state for programmatic changes
                        const textContent = quill.getText();
                        const charCount = textContent.trim().length;
                        setCharacterCount(charCount);

                        // Call onChange with processed content
                        const contentIsEmpty = isQuillEmpty(quill);
                        const finalContent = contentIsEmpty
                            ? ""
                            : processQuillContentForSaving(getCleanedHtml(quill.root.innerHTML));
                        props.onChange?.({ html: finalContent });

                        // Mark as dirty to ensure save button appears
                        props.onDirtyChange?.(true, quill.root.innerHTML);
                        setUnsavedChanges(true);
                    } else {
                        console.warn(
                            `LLM completion received for cell ${completionCellId} but current cell is ${props.currentLineId}. Ignoring completion.`
                        );
                    }
                }
                // No-op: header selection managed by native dropdown
            }
        },
        [props.currentLineId, props.onChange, props.onDirtyChange, setUnsavedChanges]
    );

    // Removed header label sync effect

    // Add function to strip HTML tags and decode entities
    const stripHtmlAndDecode = (html: string): string => {
        const temp = document.createElement("div");
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || "";
    };

    // Function to get clean text from selection, excluding footnote markers
    const getCleanTextFromSelection = (selection: any): string => {
        if (!quillRef.current || !selection || selection.length === 0) {
            return "";
        }

        const quill = quillRef.current;

        // Get the HTML content of the selection
        const htmlContent = quill.getSemanticHTML(selection.index, selection.length);

        // Create a temporary div to parse the HTML
        const tempDiv = document.createElement("div");
        tempDiv.innerHTML = htmlContent;

        // Remove all footnote markers from the content
        tempDiv.querySelectorAll("sup.footnote-marker").forEach((marker) => {
            marker.remove();
        });

        // Return the clean text content
        return (tempDiv.textContent || tempDiv.innerText || "").trim();
    };

    // Add function to generate diff HTML
    const generateDiffHtml = (oldText: string, newText: string): string => {
        // Helper to escape text for safe HTML insertion
        const escapeHtml = (text: string): string =>
            text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

        // Strip HTML tags (but decode entities to get true text content)
        const cleanOldText = stripHtmlAndDecode(oldText);
        const cleanNewText = stripHtmlAndDecode(newText);

        const diff = diffWords(cleanOldText, cleanNewText);
        return diff
            .map((part) => {
                const safe = escapeHtml(part.value);
                if (part.added) {
                    return `<span style="background-color: var(--vscode-diffEditor-insertedTextBackground); text-decoration: none;">${safe}</span>`;
                }
                if (part.removed) {
                    return `<span style="background-color: var(--vscode-diffEditor-removedTextBackground); text-decoration: line-through;">${safe}</span>`;
                }
                return safe;
            })
            .join("");
    };

    // Cancel footnote editing and restore original content
    const cancelFootnoteEditing = () => {
        if (!quillRef.current) return;

        // Restore original cell content to the main editor
        quillRef.current.root.innerHTML = originalCellContent;

        // Reset all footnote editing state
        setIsEditingFootnoteInline(false);
        setIsCreatingNewFootnote(false);
        setEditingFootnoteId("");
        setEditingFootnoteContent("");
        setOriginalCellContent("");
    };

    // Handle adding a footnote
    const handleAddFootnote = () => {
        if (!quillRef.current) return;

        const quill = quillRef.current;
        const selection = quill.getSelection(true);

        if (selection) {
            let selectedText = "";
            let cursorPosition = selection.index;

            // Check if there's selected text
            if (selection.length > 0) {
                // Get clean text from selection, excluding any footnote markers
                // This handles the case where selected text contains existing footnotes
                const cleanedText = getCleanTextFromSelection(selection);

                const trimmedText = cleanedText.trimEnd();
                const spacesRemoved = cleanedText.length - trimmedText.length;
                selectedText = trimmedText;

                // Adjust cursor position to account for removed trailing spaces
                cursorPosition = selection.index + selection.length - spacesRemoved;
            } else {
                // No selection, find the word to the left of cursor
                const text = quill.getText();

                // Find the start of the word before the cursor
                let wordStart = cursorPosition;
                while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
                    wordStart--;
                }

                // Extract the word
                selectedText = text.substring(wordStart, cursorPosition);
            }

            // Check for punctuation after cursor position and adjust footnote placement
            const text = quill.getText();
            const punctuationRegex = /[.,;:!?'")\]}/]/;

            // Look ahead for punctuation immediately after the current position
            if (
                cursorPosition < text.length &&
                punctuationRegex.test(text.charAt(cursorPosition))
            ) {
                // Move footnote position after the punctuation
                cursorPosition++;

                // If there are multiple consecutive punctuation marks, move past all of them
                while (
                    cursorPosition < text.length &&
                    punctuationRegex.test(text.charAt(cursorPosition))
                ) {
                    cursorPosition++;
                }
            }
            // Also check if we're immediately before punctuation (word boundary case)
            else if (selection.length === 0 && cursorPosition < text.length) {
                let checkPos = cursorPosition;
                // Skip any whitespace
                while (checkPos < text.length && /\s/.test(text.charAt(checkPos))) {
                    checkPos++;
                }
                // If we find punctuation after whitespace, move footnote after the punctuation
                if (checkPos < text.length && punctuationRegex.test(text.charAt(checkPos))) {
                    cursorPosition = checkPos + 1;
                    // Move past any additional consecutive punctuation
                    while (
                        cursorPosition < text.length &&
                        punctuationRegex.test(text.charAt(cursorPosition))
                    ) {
                        cursorPosition++;
                    }
                }
            }

            // Check if we're placing a footnote adjacent to existing footnotes and ensure proper spacing
            const htmlContent = quill.root.innerHTML;
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlContent, "text/html");

            // Get the text content and see if there are footnote markers near our insertion point
            const textBeforeInsertion = quill.getText(0, cursorPosition);
            const textAfterInsertion = quill.getText(cursorPosition);

            // Check if there's a footnote marker immediately before our position
            const hasFootnoteBefore =
                /<sup[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>[^<]*<\/sup>$/m.test(
                    quill.root.innerHTML.substring(0, quill.getLeaf(cursorPosition)[1])
                );

            // Check if there's a footnote marker immediately after our position
            const hasFootnoteAfter =
                /^<sup[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>[^<]*<\/sup>/m.test(
                    quill.root.innerHTML.substring(quill.getLeaf(cursorPosition)[1])
                );

            // Note: The spacing between consecutive footnotes will be handled by renumberFootnotes()
            // which runs after the footnote is created

            // Store original content before switching to footnote editing
            setOriginalCellContent(quill.root.innerHTML);

            // Generate a temporary unique ID for the new footnote (will be renumbered later)
            const tempId = `fn${Date.now()}`;

            // Set up for creating a new footnote
            setIsCreatingNewFootnote(true);
            setCursorPositionForFootnote(cursorPosition);
            setEditingFootnoteId(tempId);

            // Prepare footnote content using Quill API to avoid formatting issues
            setFootnoteWord(selectedText);

            // Clear the editor and build content properly
            quill.setText("");

            if (selectedText.trim()) {
                // Insert the word in italics followed by colon and space
                quill.insertText(0, selectedText, { italic: true });
                quill.insertText(selectedText.length, ": ");

                // Clear any formatting and set cursor after the colon and space
                quill.setSelection(selectedText.length + 2);
                quill.format("italic", false); // Ensure no italic formatting for subsequent text
            }

            // Store the current content
            setEditingFootnoteContent(quill.root.innerHTML);

            setIsEditingFootnoteInline(true);
        }
    };

    // Function to renumber all footnotes based on their document position and clean up spacing
    const renumberFootnotes = () => {
        if (!quillRef.current) return;

        const quill = quillRef.current;

        // Preserve cursor position before processing (guard for test stubs)
        const currentSelection =
            typeof (quill as any).getSelection === "function"
                ? (quill as any).getSelection()
                : null;

        // Use the proper HTML processing utility for consistent behavior
        const processedHtml = processHtmlContent(quill.root.innerHTML);

        // Update the editor content with processed HTML
        quill.root.innerHTML = processedHtml;

        // Update footnote numbering starting from the footnote offset for section-based numbering
        updateFootnoteNumbering(quill.root, props.footnoteOffset || 1, false);

        // Force Quill to recognize the content change (guard for test env stubs)
        try {
            (quill as any)?.history?.clear?.();
        } catch {
            /* ignore */
        }
        try {
            (quill as any)?.update?.();
        } catch {
            /* ignore */
        }

        // Restore cursor position after processing
        if (currentSelection && typeof (quill as any).setSelection === "function") {
            const textLength = quill.getLength();
            const safePosition = Math.min(Math.max(0, currentSelection.index), textLength - 1);
            (quill as any).setSelection(safePosition, 0);
        }

        // Emit a content change event to ensure everything is synchronized
        try {
            (quill as any)?.emitter?.emit?.("text-change", null, null, "api");
        } catch {
            /* ignore */
        }
    };

    // Save footnote content (for both creating new and editing existing)
    const saveFootnoteContent = () => {
        if (!quillRef.current) return;

        const quill = quillRef.current;

        // Get the current footnote content from the main editor
        const currentFootnoteContent = quill.root.innerHTML;

        if (isCreatingNewFootnote) {
            // Restore original content first
            quill.root.innerHTML = originalCellContent;

            // Creating a new footnote - insert at the saved cursor position
            quill.insertText(cursorPositionForFootnote, editingFootnoteId, {
                footnote: currentFootnoteContent,
            });

            // Set cursor after the footnote
            quill.setSelection(cursorPositionForFootnote + editingFootnoteId.length);
        } else {
            // Editing existing footnote - restore original content first
            quill.root.innerHTML = originalCellContent;

            // Now update the footnote in the restored content
            const parser = new DOMParser();
            const doc = parser.parseFromString(quill.root.innerHTML, "text/html");

            // Find and update footnote content attributes
            doc.querySelectorAll("sup.footnote-marker").forEach((el) => {
                if (el.textContent === editingFootnoteId) {
                    el.setAttribute("data-footnote", currentFootnoteContent);
                }
            });

            const newHtml = doc.body.innerHTML;
            quill.root.innerHTML = newHtml;
        }

        // Renumber all footnotes based on document position
        renumberFootnotes();

        // Trigger change event to save content
        setUnsavedChanges(true);

        // Trigger the onChange callback to notify the parent
        if (props.onChange) {
            props.onChange({ html: quill.root.innerHTML });
        }

        // Reset editing state
        setIsEditingFootnoteInline(false);
        setIsCreatingNewFootnote(false);
        setEditingFootnoteId("");
        setEditingFootnoteContent("");
        setOriginalCellContent("");
    };

    // Handle editing an existing footnote
    const handleEditFootnote = (footnoteId: string, content: string) => {
        if (!quillRef.current) return;

        const quill = quillRef.current;

        // Store original content before switching to footnote editing
        setOriginalCellContent(quill.root.innerHTML);

        setEditingFootnoteId(footnoteId);
        setEditingFootnoteContent(content);
        setIsCreatingNewFootnote(false);

        // Switch main editor to footnote content
        quill.root.innerHTML = content;

        setIsEditingFootnoteInline(true);
    };

    // Expose imperative methods
    useImperativeHandle(ref, () => ({
        autocomplete: () => {
            window.vscodeApi.postMessage({
                command: "llmCompletion",
                content: { currentLineId: props.currentLineId, addContentToValue: false },
            });
        },
        openLibrary: () => {
            const quill = quillRef.current!;
            const words = quill
                .getText()
                .split(/[\s\n.,!?]+/)
                .filter((w) => w.length > 0)
                .filter((w, i, self) => self.indexOf(w) === i);
            setWordsToAdd(words);
            setShowModal(true);
        },
        showEditHistory: () => {
            setEditHistoryForCell(props.editHistory);
            setShowHistoryModal(true);
        },
        getSelectionText: () => {
            if (!quillRef.current) return "";
            const selection = quillRef.current.getSelection();
            if (selection && selection.length > 0) {
                return quillRef.current.getText(selection.index, selection.length).trim();
            }
            return "";
        },
        addFootnote: () => {
            handleAddFootnote();
        },
        editFootnote: (footnoteId: string, content: string) => {
            handleEditFootnote(footnoteId, content);
        },
        updateContent: (content: string) => {
            if (quillRef.current) {
                quillRef.current.root.innerHTML = content;
                setUnsavedChanges(true);

                // Update character count when content is updated externally
                const textContent = quillRef.current.getText();
                const charCount = textContent.trim().length;
                setCharacterCount(charCount);

                // Clean up footnote spacing and renumber
                setTimeout(() => {
                    renumberFootnotes();
                }, 50);

                // Trigger the onChange callback to notify the parent
                if (props.onChange) {
                    props.onChange({ html: content });
                }

                // Header selection handled by native dropdown
            }
        },
        renumberFootnotes: () => {
            renumberFootnotes();

            // Trigger change event and callback after renumbering
            setUnsavedChanges(true);
            if (props.onChange && quillRef.current) {
                props.onChange({ html: quillRef.current.root.innerHTML });
            }
        },
    }));

    // Add CSS styles for toolbar visibility and Quill overrides
    useEffect(() => {
        const styleId = "quill-toolbar-styles";
        const existingStyle = document.getElementById(styleId);

        if (!existingStyle) {
            const style = document.createElement("style");
            style.id = styleId;
            style.textContent = `
                .toolbar-hidden .ql-toolbar {
                    display: none;
                }
                .toolbar-visible .ql-toolbar {
                    display: block;
                }
                .ql-editor {
                    white-space: normal !important;
                    background-color: var(--vscode-editor-background) !important;
                    color: var(--vscode-editor-foreground) !important;
                }
                .quill-toolbar-icon {
                    font-size: 16px !important;
                }

                @keyframes pulse {
                    0%, 100% { opacity: 1; }
                    50% { opacity: 0.5; }
                }
            `;
            document.head.appendChild(style);
        }

        return () => {
            const styleElement = document.getElementById(styleId);
            if (styleElement) {
                styleElement.remove();
            }
        };
    }, []);

    return (
        <>
            {/* Footnote editing header when in footnote mode */}
            {isEditingFootnoteInline && (
                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        marginBottom: "8px",
                        padding: "8px 12px",
                        backgroundColor: "var(--vscode-list-hoverBackground)",
                        borderRadius: "4px",
                    }}
                >
                    <h4 style={{ margin: 0, color: "var(--vscode-editor-foreground)" }}>
                        {isCreatingNewFootnote
                            ? `Creating Footnote: ${editingFootnoteId}`
                            : `Editing Footnote: ${editingFootnoteId}`}
                    </h4>
                    <div style={{ display: "flex", gap: "8px" }}>
                        <button
                            onClick={cancelFootnoteEditing}
                            style={{
                                padding: "4px 8px",
                                border: "1px solid var(--vscode-button-border)",
                                backgroundColor: "var(--vscode-button-secondaryBackground)",
                                color: "var(--vscode-button-secondaryForeground)",
                                borderRadius: "2px",
                                cursor: "pointer",
                                fontSize: "0.9em",
                            }}
                        >
                            Cancel
                        </button>
                        <button
                            onClick={saveFootnoteContent}
                            style={{
                                padding: "4px 8px",
                                border: "1px solid var(--vscode-button-border)",
                                backgroundColor: "var(--vscode-button-background)",
                                color: "var(--vscode-button-foreground)",
                                borderRadius: "2px",
                                cursor: "pointer",
                                fontSize: "0.9em",
                            }}
                        >
                            {isCreatingNewFootnote ? "Create Footnote" : "Save Changes"}
                        </button>
                    </div>
                </div>
            )}

            {isEditingFootnoteInline && (
                /* Reference content display when editing footnote */
                <div
                    style={{
                        border: "1px dashed var(--vscode-descriptionForeground)",
                        borderRadius: "4px",
                        padding: "12px",
                        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                        color: "var(--vscode-descriptionForeground)",
                        minHeight: "60px",
                        marginBottom: "12px",
                        opacity: 0.8,
                    }}
                >
                    <div
                        style={{
                            fontSize: "0.85em",
                            color: "var(--vscode-descriptionForeground)",
                            marginBottom: "8px",
                            fontStyle: "italic",
                            fontWeight: "bold",
                            textTransform: "uppercase",
                            letterSpacing: "0.5px",
                        }}
                    >
                        📄 Cell Content (Read-Only Reference)
                    </div>
                    <div
                        style={{
                            fontSize: "0.9em",
                            lineHeight: "1.4",
                            pointerEvents: "none",
                            userSelect: "none",
                        }}
                        dangerouslySetInnerHTML={{ __html: originalCellContent }}
                    />
                </div>
            )}
            {!isEditingFootnoteInline && (
                <div className="flex justify-end">
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => setIsToolbarVisible(!isToolbarVisible)}
                        title={
                            isToolbarVisible ? "Hide Formatting Toolbar" : "Show Formatting Toolbar"
                        }
                        className="mb-1 hover:opacity-80 transition-opacity duration-200"
                    >
                        <i
                            className={`codicon ${
                                isToolbarVisible ? "codicon-chevron-up" : "codicon-tools"
                            }`}
                        ></i>
                    </VSCodeButton>
                </div>
            )}
            <div
                className={`relative transition-all duration-300 ease-in-out ${
                    isToolbarVisible || isEditingFootnoteInline
                        ? "toolbar-visible"
                        : "toolbar-hidden"
                }`}
            >
                <div
                    ref={editorRef}
                    className="quill-editor-container"
                    style={
                        isEditingFootnoteInline
                            ? {
                                  border: "2px solid var(--vscode-focusBorder)",
                                  borderRadius: "4px",
                                  backgroundColor: "var(--vscode-editor-background)",
                                  padding: "4px",
                                  minHeight: "120px",
                              }
                            : {}
                    }
                ></div>
                <div
                    style={{
                        display: "flex",
                        justifyContent: "flex-end",
                        alignItems: "center",
                        marginTop: "4px",
                        padding: "2px 4px",
                        fontSize: "0.8em",
                        color: "var(--vscode-descriptionForeground)",
                        backgroundColor: "transparent",
                    }}
                >
                    <span>{characterCount} characters</span>
                </div>
            </div>
            {showHistoryModal && (
                <div
                    style={{
                        position: "fixed",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        backgroundColor: "var(--vscode-editor-background)",
                        padding: "20px",
                        border: "1px solid var(--vscode-editor-foreground)",
                        borderRadius: "4px",
                        zIndex: 1000,
                        maxHeight: "80vh",
                        overflowY: "auto",
                        minWidth: "300px",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            justifyContent: "space-between",
                            alignItems: "center",
                            marginBottom: "16px",
                        }}
                    >
                        <h3>Edit History</h3>
                        <button
                            onClick={() => setShowHistoryModal(false)}
                            style={{
                                background: "none",
                                border: "none",
                                cursor: "pointer",
                                color: "var(--vscode-editor-foreground)",
                                width: "fit-content",
                                flexShrink: 0,
                            }}
                        >
                            <i className="codicon codicon-close"></i>
                        </button>
                    </div>
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                            <button
                                onClick={() => setHistoryTab("history")}
                                style={{
                                    backgroundColor:
                                        historyTab === "history"
                                            ? "var(--vscode-button-background)"
                                            : "transparent",
                                    color:
                                        historyTab === "history"
                                            ? "var(--vscode-button-foreground)"
                                            : "var(--vscode-editor-foreground)",
                                    border: "1px solid var(--vscode-editor-foreground)",
                                    borderRadius: 4,
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                }}
                            >
                                History
                            </button>
                            <button
                                onClick={() => setHistoryTab("llm-previews")}
                                style={{
                                    backgroundColor:
                                        historyTab === "llm-previews"
                                            ? "var(--vscode-button-background)"
                                            : "transparent",
                                    color:
                                        historyTab === "llm-previews"
                                            ? "var(--vscode-button-foreground)"
                                            : "var(--vscode-editor-foreground)",
                                    border: "1px solid var(--vscode-editor-foreground)",
                                    borderRadius: 4,
                                    padding: "4px 8px",
                                    cursor: "pointer",
                                }}
                            >
                                LLM Previews
                            </button>
                        </div>

                        {editHistoryForCell && editHistoryForCell.length > 0 ? (
                            [...editHistoryForCell]
                                .filter(isValueEdit)
                                .reverse()
                                .filter((entry, index, array) => {
                                    // Separate tabs: previews vs non-previews
                                    const isPreview =
                                        (entry as any).preview === true ||
                                        (entry.type === "llm-generation" &&
                                            (entry as any).preview === true);
                                    if (historyTab === "llm-previews") {
                                        return isPreview;
                                    } else {
                                        // Main history: exclude previews; keep non-preview LLM edits
                                        return !isPreview;
                                    }
                                })
                                .filter((entry, index, array) => {
                                    // In the main history, still hide llm-generation entries that are identical to the next user-edit
                                    if (historyTab === "llm-previews") return true;
                                    const nextEntry = array[index - 1];
                                    return !(
                                        entry.type === "llm-generation" &&
                                        nextEntry?.type === "user-edit" &&
                                        entry.value === nextEntry.value
                                    );
                                })
                                .map((entry, index, array) => {
                                    const previousEntry = array[index + 1];

                                    // Determine display styling by edit type
                                    const type = (entry as any).type as string;
                                    const typeLabelMap: Record<string, string> = {
                                        "initial-import": "Initial Import",
                                        "user-edit": "User Edit",
                                        "llm-generation": "LLM Suggestion",
                                        "llm-edit": "LLM Edit",
                                        merge: "Merge",
                                    };
                                    const typeBorderColorMap: Record<string, string> = {
                                        "initial-import":
                                            "var(--vscode-editorGutter-modifiedBackground)",
                                        "user-edit": "var(--vscode-editorGutter-addedBackground)",
                                        "llm-generation":
                                            "var(--vscode-editorGutter-deletedBackground)",
                                        "llm-edit": "var(--vscode-editorGutter-modifiedBackground)",
                                        merge: "var(--vscode-editorGutter-modifiedBackground)",
                                    };
                                    const typeLabel = typeLabelMap[type] || type || "Edit";
                                    const typeBorderColor =
                                        typeBorderColorMap[type] ||
                                        "var(--vscode-editorGutter-modifiedBackground)";

                                    // For initial import or when no previous entry exists, show a diff from empty → value
                                    const diffHtml = previousEntry
                                        ? generateDiffHtml(
                                              previousEntry.value as string,
                                              entry.value as string
                                          )
                                        : generateDiffHtml("", entry.value as string);

                                    // Check if this is the most recent entry that matches the initial value
                                    const isCurrentVersion =
                                        entry.value === props.initialValue &&
                                        !array
                                            .slice(0, index)
                                            .some((e) => e.value === props.initialValue);

                                    return (
                                        <div
                                            key={index}
                                            style={{
                                                padding: "8px",
                                                border: "1px solid var(--vscode-editor-foreground)",
                                                // borderRadius: "4px",
                                                borderLeft: `4px solid ${typeBorderColor}`,
                                                paddingLeft: "12px",
                                                backgroundColor: isCurrentVersion
                                                    ? "var(--vscode-editor-selectionBackground)"
                                                    : "transparent",
                                            }}
                                        >
                                            <div
                                                style={{
                                                    marginBottom: "4px",
                                                    fontSize: "0.9em",
                                                    color: "var(--vscode-descriptionForeground)",
                                                    display: "flex",
                                                    justifyContent: "space-between",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                }}
                                            >
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        alignItems: "center",
                                                        gap: "8px",
                                                    }}
                                                >
                                                    {new Date(entry.timestamp).toLocaleString()} by{" "}
                                                    {entry.author}
                                                    <span
                                                        style={{
                                                            fontSize: "0.75em",
                                                            padding: "2px 6px",
                                                            borderRadius: "9px",
                                                            backgroundColor:
                                                                "var(--vscode-badge-background)",
                                                            color: "var(--vscode-badge-foreground)",
                                                            border: `1px solid ${typeBorderColor}`,
                                                            textAlign: "center",
                                                        }}
                                                    >
                                                        {typeLabel}
                                                    </span>
                                                </div>
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        gap: "8px",
                                                        alignItems: "center",
                                                    }}
                                                >
                                                    {isCurrentVersion ? (
                                                        <span
                                                            style={{
                                                                fontSize: "0.8em",
                                                                padding: "2px 6px",
                                                                backgroundColor:
                                                                    "var(--vscode-badge-background)",
                                                                color: "var(--vscode-badge-foreground)",
                                                                borderRadius: "4px",
                                                            }}
                                                        >
                                                            Current Version
                                                        </span>
                                                    ) : (
                                                        <button
                                                            onClick={() => {
                                                                if (quillRef.current) {
                                                                    // When selecting a version, use the original HTML
                                                                    quillRef.current.root.innerHTML =
                                                                        entry.value as string; // TypeScript now knows this is string
                                                                    setShowHistoryModal(false);
                                                                    // Trigger the text-change event to update state
                                                                    quillRef.current.update();
                                                                }
                                                            }}
                                                            style={{
                                                                background: "none",
                                                                border: "none",
                                                                cursor: "pointer",
                                                                color: "var(--vscode-button-foreground)",
                                                                backgroundColor:
                                                                    "var(--vscode-button-background)",
                                                                padding: "4px 8px",
                                                                borderRadius: "4px",
                                                                fontSize: "0.9em",
                                                                display: "flex",
                                                                alignItems: "center",
                                                                gap: "4px",
                                                            }}
                                                        >
                                                            <i className="codicon codicon-edit"></i>
                                                            Edit
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                            <div style={{ marginBottom: "8px" }}>
                                                <div
                                                    style={{
                                                        whiteSpace: "pre-wrap",
                                                        backgroundColor:
                                                            "var(--vscode-editor-findMatchHighlightBackground)",
                                                        padding: "4px",
                                                        borderRadius: "2px",
                                                    }}
                                                    dangerouslySetInnerHTML={{ __html: diffHtml }}
                                                />
                                            </div>
                                        </div>
                                    );
                                })
                        ) : (
                            <div
                                style={{
                                    textAlign: "center",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                            >
                                No edit history available
                            </div>
                        )}
                    </div>
                </div>
            )}
            {showModal && (
                <div
                    style={{
                        position: "fixed",
                        top: "50%",
                        left: "50%",
                        transform: "translate(-50%, -50%)",
                        backgroundColor: "var(--vscode-editor-background)",
                        padding: "20px",
                        border: "1px solid var(--vscode-editor-foreground)",
                        borderRadius: "4px",
                        zIndex: 1000,
                    }}
                >
                    <h3>Add Words to Dictionary</h3>
                    <p style={{ margin: "10px 0" }}>
                        {wordsToAdd.length > 0
                            ? `Add all words to the dictionary?`
                            : "No words found in the content."}
                    </p>
                    <div
                        style={{
                            display: "flex",
                            gap: "10px",
                            justifyContent: "flex-end",
                            marginTop: "20px",
                        }}
                    >
                        <button onClick={() => setShowModal(false)}>Cancel</button>
                        {wordsToAdd.length > 0 && (
                            <button onClick={handleAddWords}>Add Words</button>
                        )}
                    </div>
                </div>
            )}
        </>
    );
});

// Existing constants and interfaces
const TOOLBAR_OPTIONS = [
    [{ header: [false, 1, 2, 3] }],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
];

// Add interface for edit history
interface EditHistoryEntry {
    before: string;
    after: string;
    timestamp: number;
    author?: string;
}

export default Editor;
