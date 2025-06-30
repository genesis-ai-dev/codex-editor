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
// import "./TextEditor.css"; // Override the default Quill styles so spans flow
import UnsavedChangesContext from "./contextProviders/UnsavedChangesContext";
import ReactPlayer from "react-player";
import { diffWords } from "diff";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

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

// Define the header cycle
const HEADER_CYCLE = [
    { label: "Normal", value: false },
    { label: "H1", value: 1 },
    { label: "H2", value: 2 },
    { label: "H3", value: 3 },
] as const;

export interface EditorProps {
    currentLineId: string;
    initialValue?: string;
    editHistory: EditHistory[];
    onChange?: (changes: EditorContentChanged) => void;
    spellCheckResponse?: SpellCheckResponse | null;
    textDirection: "ltr" | "rtl";
    setIsEditingFootnoteInline: (isEditing: boolean) => void;
    isEditingFootnoteInline: boolean;
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
    addFootnote: () => void;
    editFootnote: (footnoteId: string, content: string) => void;
    updateContent: (content: string) => void;
    renumberFootnotes: () => void;
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
    const [headerLabel, setHeaderLabel] = useState<string>("Normal"); // Track header label
    const { setUnsavedChanges } = useContext(UnsavedChangesContext);
    const quillRef = useRef<Quill | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);

    const [currentAuthor, setCurrentAuthor] = useState<string>(
        (window as any).initialData?.userInfo?.username || "anonymous"
    );

    const [showHistoryModal, setShowHistoryModal] = useState(false);
    const [editHistoryForCell, setEditHistoryForCell] = useState<EditHistory[]>(props.editHistory);

    const [footnoteCount, setFootnoteCount] = useState(1);
    const [characterCount, setCharacterCount] = useState(0);

    // Inline footnote editing states (for both creating and editing)
    const [editingFootnoteId, setEditingFootnoteId] = useState("");
    const [editingFootnoteContent, setEditingFootnoteContent] = useState("");
    const [isCreatingNewFootnote, setIsCreatingNewFootnote] = useState(false);
    const [footnoteWord, setFootnoteWord] = useState("");
    const [cursorPositionForFootnote, setCursorPositionForFootnote] = useState(0);
    const [originalCellContent, setOriginalCellContent] = useState("");

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
                        handlers: {
                            headerStyleLeft: () => handleHeaderChange("prev"),
                            headerStyleRight: () => handleHeaderChange("next"),
                            headerStyleLabel: () => {}, // No-op handler for the label
                        },
                    },
                    keyboard: {
                        bindings: {
                            "list autofill": false, // This disables the automatic list creation
                        },
                    },
                    spellChecker: {},
                },
            });

            // Add custom button HTML
            const leftButton = document.querySelector(".ql-headerStyleLeft");
            const labelButton = document.querySelector(".ql-headerStyleLabel");
            const rightButton = document.querySelector(".ql-headerStyleRight");

            if (leftButton && labelButton && rightButton) {
                leftButton.innerHTML =
                    '<i class="codicon codicon-chevron-left" style="color: var(--vscode-editor-foreground)"></i>';
                labelButton.innerHTML = `<span class="header-style-label" style="color: var(--vscode-editor-foreground)">${headerLabel}</span>`;
                rightButton.innerHTML =
                    '<i class="codicon codicon-chevron-right" style="color: var(--vscode-editor-foreground)"></i>';
            }

            // Apply Quill toolbar styling with CSS-in-JS for !important overrides
            const toolbar = editorRef.current.querySelector(".ql-toolbar");
            const container = editorRef.current.querySelector(".ql-container");

            if (toolbar) {
                // Apply styles that need !important
                const toolbarStyles = `
                    border: none !important;
                    padding: 2px !important;
                    transition: all 0.3s ease;
                    overflow: hidden;
                `;
                toolbar.setAttribute("style", toolbarStyles);

                // Style toolbar buttons
                const buttons = toolbar.querySelectorAll("button");
                buttons.forEach((button) => {
                    const buttonStyles = `
                        width: 24px !important;
                        height: 24px !important;
                        padding: 2px !important;
                    `;
                    button.setAttribute("style", buttonStyles);
                });

                // Style toolbar formats
                const qlHeaderStyleLabel = toolbar.querySelectorAll(".ql-headerStyleLabel");
                qlHeaderStyleLabel.forEach((format) => {
                    format.setAttribute("style", "max-width: fit-content !important;");
                });
                const formats = toolbar.querySelectorAll(".ql-formats");
                formats.forEach((format) => {
                    format.setAttribute(
                        "style",
                        "margin-right: 6px !important; display: flex; flex-flow: row nowrap;"
                    );
                });

                // Style SVG icons
                const svgs = toolbar.querySelectorAll("svg");
                svgs.forEach((svg) => {
                    const svgStyles = `
                        width: 16px !important;
                        height: 16px !important;
                    `;
                    svg.setAttribute("style", svgStyles);
                });

                // Style pickers
                const pickers = toolbar.querySelectorAll(".ql-picker");
                pickers.forEach((picker) => {
                    const pickerStyles = `
                        height: 24px !important;
                        line-height: 24px !important;
                        font-size: 12px !important;
                    `;
                    picker.setAttribute("style", pickerStyles);
                });

                // Style picker labels
                const pickerLabels = toolbar.querySelectorAll(".ql-picker-label");
                pickerLabels.forEach((label) => {
                    label.setAttribute("style", "padding: 0 4px !important;");
                });
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

                        // Process the content using the same logic as text-change
                        const cleanedContents = getCleanedHtml(content);

                        const arrayOfParagraphs = cleanedContents
                            .trim()
                            .split("</p>")
                            .map((p) => p.trim())
                            .filter((p) => p !== "");

                        const finalParagraphs = arrayOfParagraphs.map((p) =>
                            p.startsWith("<p>") ? `${p}</p>` : `<p>${p}</p>`
                        );

                        const firstParagraph = finalParagraphs[0] || "";
                        const restOfParagraphs = finalParagraphs.slice(1) || [];
                        const firstParagraphWithoutP = firstParagraph.trim().slice(3, -4);
                        const contentIsEmpty = isQuillEmpty(quillRef.current);

                        const finalContent = contentIsEmpty
                            ? ""
                            : [`<span>${firstParagraphWithoutP}</span>`, ...restOfParagraphs].join(
                                  ""
                              );

                        debug("Paste finalContent", { finalContent, contentIsEmpty });

                        // Call onChange to update contentBeingUpdated
                        props.onChange({
                            html: finalContent,
                        });
                    }
                }, 50); // Slightly longer timeout to ensure paste is complete
            });

            quillRef.current = quill;

            if (props.initialValue) {
                quill.root.innerHTML = props.initialValue;
                
                // Renumber footnotes to ensure proper chronological order on load
                setTimeout(() => {
                    renumberFootnotes();
                }, 100);
            }
            // Store initial content when editor is mounted
            initialContentRef.current = quill.root.innerHTML;
            let isFirstLoad = true;
            let quillInitialContent = "";

            // Add text-change event listener
            quill.on("text-change", () => {
                if (isFirstLoad) {
                    quillInitialContent = quill.root.innerHTML;
                    isFirstLoad = false;
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

                // Normal cell content editing logic
                const initialQuillContent = "<p><br></p>";
                let isDirty = false;

                // More robust dirty checking
                if (quillInitialContent !== initialQuillContent) {
                    isDirty = content !== quillInitialContent;
                } else {
                    // If we started with empty content, any non-empty content is dirty
                    isDirty = !isQuillEmpty(quill) && content !== initialQuillContent;
                }

                // Additional check: if content is significantly different from initial, it's dirty
                if (
                    !isDirty &&
                    content &&
                    content !== "<p><br></p>" &&
                    content !== quillInitialContent
                ) {
                    isDirty = true;
                }

                debug("isDirty", {
                    isDirty,
                    content,
                    initialContentRefCurrent: initialContentRef.current,
                    quillInitialContent,
                    isQuillEmpty: isQuillEmpty(quill),
                });

                if (isDirty) {
                    setUnsavedChanges(true);
                    if (props.onChange) {
                        const cleanedContents = getCleanedHtml(content);

                        const arrayOfParagraphs = cleanedContents
                            .trim()
                            .split("</p>")
                            .map((p) => p.trim())
                            .filter((p) => p !== "");

                        const finalParagraphs = arrayOfParagraphs.map((p) =>
                            p.startsWith("<p>") ? `${p}</p>` : `<p>${p}</p>`
                        );

                        const firstParagraph = finalParagraphs[0] || "";
                        const restOfParagraphs = finalParagraphs.slice(1) || [];
                        const firstParagraphWithoutP = firstParagraph.trim().slice(3, -4);
                        const contentIsEmpty = isQuillEmpty(quill);

                        const finalContent = contentIsEmpty
                            ? ""
                            : [`<span>${firstParagraphWithoutP}</span>`, ...restOfParagraphs].join(
                                  ""
                              );

                        debug("finalContent", { finalContent, contentIsEmpty });

                        props.onChange({
                            html: finalContent,
                        });
                    }
                    updateHeaderLabel();
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

    // Function to update the header label based on current formatting
    const updateHeaderLabel = () => {
        if (quillRef.current) {
            const currentHeader = quillRef.current.getFormat().header;
            const header = HEADER_CYCLE.find((h) => h.value === currentHeader) || HEADER_CYCLE[0];
            setHeaderLabel(header.label);
        }
    };

    // Initialize header label on mount
    useEffect(() => {
        updateHeaderLabel();
    }, []);

    // Handle header change via buttons
    const handleHeaderChange = (direction: "prev" | "next") => {
        if (!quillRef.current) return;

        const currentHeaderValue = quillRef.current.getFormat().header;
        const currentIndex = HEADER_CYCLE.findIndex(
            (h) => h.value === currentHeaderValue || (h.value === false && !currentHeaderValue)
        );

        let nextIndex: number;

        if (direction === "next") {
            nextIndex = (currentIndex + 1) % HEADER_CYCLE.length;
        } else {
            nextIndex = (currentIndex - 1 + HEADER_CYCLE.length) % HEADER_CYCLE.length;
        }

        const newHeader = HEADER_CYCLE[nextIndex];
        quillRef.current.format("header", newHeader.value);
        setHeaderLabel(newHeader.label); // Update the label immediately
    };

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
    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (quillRef.current) {
                const quill = quillRef.current;
                if (event.data.type === "providerSendsPromptedEditResponse") {
                    quill.root.innerHTML = event.data.content;
                } else if (event.data.type === "providerSendsLLMCompletionResponse") {
                    const completionText = event.data.content.completion;
                    quill.root.innerHTML = completionText; // Clear existing content
                    props.onChange?.({ html: quill.root.innerHTML });
                    setUnsavedChanges(true);
                }
                updateHeaderLabel(); // Update header label after external changes
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, []);

    // **New useEffect to update the header label in the toolbar**
    useEffect(() => {
        const labelElement = document.querySelector(".header-style-label");
        if (labelElement) {
            labelElement.textContent = headerLabel;
        }
    }, [headerLabel]);

    // Add function to strip HTML tags and decode entities
    const stripHtmlAndDecode = (html: string): string => {
        const temp = document.createElement("div");
        temp.innerHTML = html;
        return temp.textContent || temp.innerText || "";
    };

    // Add function to generate diff HTML
    const generateDiffHtml = (oldText: string, newText: string): string => {
        // Strip HTML from both texts before comparing
        const cleanOldText = stripHtmlAndDecode(oldText);
        const cleanNewText = stripHtmlAndDecode(newText);

        const diff = diffWords(cleanOldText, cleanNewText);
        return diff
            .map((part) => {
                if (part.added) {
                    return `<span style="background-color: var(--vscode-diffEditor-insertedTextBackground); text-decoration: none;">${part.value}</span>`;
                }
                if (part.removed) {
                    return `<span style="background-color: var(--vscode-diffEditor-removedTextBackground); text-decoration: line-through;">${part.value}</span>`;
                }
                return part.value;
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
                // Get the selected text and trim trailing spaces
                selectedText = quill.getText(selection.index, selection.length);
                const trimmedText = selectedText.trimEnd();
                const spacesRemoved = selectedText.length - trimmedText.length;
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
            if (cursorPosition < text.length && punctuationRegex.test(text.charAt(cursorPosition))) {
                // Move footnote position after the punctuation
                cursorPosition++;
                
                // If there are multiple consecutive punctuation marks, move past all of them
                while (cursorPosition < text.length && punctuationRegex.test(text.charAt(cursorPosition))) {
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
                    while (cursorPosition < text.length && punctuationRegex.test(text.charAt(cursorPosition))) {
                        cursorPosition++;
                    }
                }
            }

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
                // Set cursor after the colon and space
                quill.setSelection(selectedText.length + 2);
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
        let htmlContent = quill.root.innerHTML;

        // First, clean up any spaces immediately before footnote markers
        // This regex finds spaces before <sup class="footnote-marker"> elements
        htmlContent = htmlContent.replace(/\s+(<sup[^>]*class="[^"]*footnote-marker[^"]*"[^>]*>)/g, '$1');

        // Parse the cleaned HTML
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlContent, "text/html");

        // Find all footnote markers in document order
        const footnoteMarkers = Array.from(doc.querySelectorAll("sup.footnote-marker"));

        // Renumber them based on their position in the document
        footnoteMarkers.forEach((marker, index) => {
            const newId = `fn${index + 1}`;
            marker.textContent = newId;
        });

        // Update the editor content with renumbered and cleaned footnotes
        const newHtml = doc.body.innerHTML;
        
        // Force Quill to update by setting the content and triggering an update
        quill.root.innerHTML = newHtml;
        
        // Force Quill to recognize the content change
        quill.history.clear();
        quill.update();
        
        // Emit a content change event to ensure everything is synchronized
        quill.emitter.emit('text-change', null, null, 'api');
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
                content: { currentLineId: props.currentLineId },
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

                // Update header label after content change
                updateHeaderLabel();
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
                            {isCreatingNewFootnote ? "Add Footnote" : "Save Changes"}
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
            <div
                className={`relative transition-all duration-300 ease-in-out ${
                    isToolbarVisible || isEditingFootnoteInline
                        ? "toolbar-visible"
                        : "toolbar-hidden"
                }`}
            >
                {!isEditingFootnoteInline && (
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
                )}

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
                        borderTop: "1px solid var(--vscode-widget-border)",
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
                        {editHistoryForCell && editHistoryForCell.length > 0 ? (
                            [...editHistoryForCell]
                                .reverse()
                                // Filter out llm-generation entries that have the same content as the next user-edit
                                .filter((entry, index, array) => {
                                    const nextEntry = array[index - 1]; // Since array is reversed, previous entry is next chronologically
                                    return !(
                                        entry.type === "llm-generation" &&
                                        nextEntry?.type === "user-edit" &&
                                        entry.cellValue === nextEntry.cellValue
                                    );
                                })
                                .map((entry, index, array) => {
                                    const previousEntry = array[index + 1];
                                    const diffHtml = previousEntry
                                        ? generateDiffHtml(previousEntry.cellValue, entry.cellValue)
                                        : stripHtmlAndDecode(entry.cellValue);

                                    // Check if this is the most recent entry that matches the initial value
                                    const isCurrentVersion =
                                        entry.cellValue === props.initialValue &&
                                        !array
                                            .slice(0, index)
                                            .some((e) => e.cellValue === props.initialValue);

                                    return (
                                        <div
                                            key={index}
                                            style={{
                                                padding: "8px",
                                                border: "1px solid var(--vscode-editor-foreground)",
                                                borderRadius: "4px",
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
                                                }}
                                            >
                                                <div>
                                                    {new Date(entry.timestamp).toLocaleString()} by{" "}
                                                    {entry.author}
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
                                                                        entry.cellValue;
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
    ["headerStyleLeft", "headerStyleLabel", "headerStyleRight"],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["clean"],
];

// Add interface for edit history
interface EditHistoryEntry {
    before: string;
    after: string;
    timestamp: number;
    author?: string;
}

export default Editor;
