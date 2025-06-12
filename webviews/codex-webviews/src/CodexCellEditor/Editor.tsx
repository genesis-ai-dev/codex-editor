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
    updateContent: (content: string) => void;
}

// Wrap the Editor component in forwardRef instead of default export
const Editor = forwardRef<EditorHandles, EditorProps>((props, ref) => {
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

    const [showFootnoteModal, setShowFootnoteModal] = useState(false);
    const [footnoteContent, setFootnoteContent] = useState("");
    const [footnoteWord, setFootnoteWord] = useState("");
    const [footnoteCount, setFootnoteCount] = useState(1);

    console.log({ editHistory, editHistoryForCell });

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

            // Add a custom quill clipboard handler for pasting in
            quill.clipboard.addMatcher(Node.ELEMENT_NODE, (node: Node, delta) => {
                setUnsavedChanges(true);
                return delta;
            });

            quillRef.current = quill;

            if (props.initialValue) {
                quill.root.innerHTML = props.initialValue;
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
                const initialQuillContent = "<p><br></p>";
                const content = quill.root.innerHTML;
                let isDirty = false;
                if (quillInitialContent !== initialQuillContent) {
                    isDirty = content !== quillInitialContent;
                }

                debug("isDirty", {
                    isDirty,
                    content,
                    initialContentRefCurrent: initialContentRef.current,
                    quillInitialContent,
                    // initialContentConvertedByQuill,
                });
                if (isDirty) {
                    setUnsavedChanges(isDirty);
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
            }
        }
    }, [revertedValue]);

    // Function to check if Quill editor is empty
    function isQuillEmpty(quill: Quill | null) {
        if (!quill) return true;
        const delta = quill.getContents();
        debug("delta", delta);
        const text = delta.ops?.reduce((text, op) => {
            return text + (op.insert ? op.insert : "");
        }, "");
        debug("text", text);
        return text?.trim().length === 0;
    }

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

    // Handle adding a footnote
    const handleAddFootnote = () => {
        if (!quillRef.current) return;

        const quill = quillRef.current;
        const selection = quill.getSelection(true);

        if (selection) {
            // Get the text so far
            const text = quill.getText();
            const cursorPosition = selection.index;

            // Find the start of the word before the cursor
            let wordStart = cursorPosition;
            while (wordStart > 0 && !/\s/.test(text.charAt(wordStart - 1))) {
                wordStart--;
            }

            // Extract the word
            const word = text.substring(wordStart, cursorPosition);

            // Only proceed if we have a word
            if (word.trim()) {
                setFootnoteWord(word);
                // Use HTML for the word in italics
                setFootnoteContent(`<i>${word}</i>: `);
                setShowFootnoteModal(true);
            } else {
                // If no word detected, just show empty modal
                setFootnoteWord("");
                setFootnoteContent("");
                setShowFootnoteModal(true);
            }
        }
    };

    // Insert the footnote marker at the current selection
    const insertFootnoteMarker = () => {
        if (!quillRef.current) return;

        const quill = quillRef.current;
        const selection = quill.getSelection(true);

        if (selection) {
            // Create a unique footnote ID for this marker
            const footnoteId = `fn${footnoteCount}`;

            // Insert the footnote marker
            quill.insertText(selection.index, " ", {});
            // Insert the marker with the content directly in the data-footnote attribute
            quill.insertText(selection.index + 1, footnoteId, { footnote: footnoteContent });

            // Move cursor past the footnote
            quill.setSelection(selection.index + footnoteId.length + 1);

            // Increment footnote counter for next use
            setFootnoteCount((prev) => prev + 1);

            // Trigger change event to save content
            setUnsavedChanges(true);

            // No need to store footnote separately, it's already in the HTML
        }
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
        updateContent: (content: string) => {
            if (quillRef.current) {
                quillRef.current.root.innerHTML = content;
                setUnsavedChanges(true);

                // Trigger the onChange callback to notify the parent
                if (props.onChange) {
                    props.onChange({ html: content });
                }

                // Update header label after content change
                updateHeaderLabel();
            }
        },
    }));

    return (
        <>
            <div
                className={`text-editor-container ${
                    isToolbarVisible ? "toolbar-visible" : "toolbar-hidden"
                }`}
            >
                <VSCodeButton
                    appearance="icon"
                    onClick={() => setIsToolbarVisible(!isToolbarVisible)}
                    title={isToolbarVisible ? "Hide Formatting Toolbar" : "Show Formatting Toolbar"}
                    style={{ marginBottom: "5px" }} // Add some space below the button
                >
                    <i
                        className={`codicon ${
                            isToolbarVisible ? "codicon-chevron-up" : "codicon-tools"
                        }`}
                    ></i>
                </VSCodeButton>
                <div ref={editorRef}></div>
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
            {showFootnoteModal && (
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
                        width: "400px",
                        maxWidth: "90vw",
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
                        <h3>Add Footnote</h3>
                        <button
                            onClick={() => setShowFootnoteModal(false)}
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
                    <div style={{ marginBottom: "16px" }}>
                        <label style={{ display: "block", marginBottom: "8px" }}>
                            Footnote Content:
                        </label>
                        <textarea
                            value={footnoteContent}
                            onChange={(e) => setFootnoteContent(e.target.value)}
                            style={{
                                width: "100%",
                                minHeight: "100px",
                                padding: "8px",
                                backgroundColor: "var(--vscode-input-background)",
                                color: "var(--vscode-input-foreground)",
                                border: "1px solid var(--vscode-input-border)",
                                borderRadius: "2px",
                                resize: "vertical",
                            }}
                            autoFocus
                            placeholder="Enter footnote content..."
                        />
                    </div>
                    <div
                        style={{
                            display: "flex",
                            gap: "10px",
                            justifyContent: "flex-end",
                            marginTop: "20px",
                        }}
                    >
                        <button onClick={() => setShowFootnoteModal(false)}>Cancel</button>
                        <button
                            onClick={() => {
                                insertFootnoteMarker();
                                setShowFootnoteModal(false);
                            }}
                        >
                            Add Footnote
                        </button>
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
