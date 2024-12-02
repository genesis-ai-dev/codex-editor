import { useRef, useEffect, useMemo, useState } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import registerQuillSpellChecker, { getCleanedHtml } from "./react-quill-spellcheck";
import { EditorPostMessages, SpellCheckResponse } from "../../../../types";
import "./TextEditor.css"; // Override the default Quill styles so spans flow

const icons: any = Quill.import("ui/icons");
// Assuming you have access to the VSCode API here
const vscode: any = (window as any).vscodeApi;

// Register the QuillSpellChecker with the VSCode API
registerQuillSpellChecker(Quill, vscode);
// Use VSCode icon for autocomplete
icons[
    "autocomplete"
] = `<i class="codicon codicon-sparkle quill-toolbar-icon" style="color: var(--vscode-editor-foreground)"></i>`;
icons[
    "openLibrary"
] = `<i class="codicon codicon-book quill-toolbar-icon" style="color: var(--vscode-editor-foreground)"></i>`;

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
    onChange?: (changes: EditorContentChanged) => void;
    spellCheckResponse?: SpellCheckResponse | null;
    textDirection: "ltr" | "rtl";
    sourceText: string | null;
    onAutocomplete: () => void;
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

// Register formats
Quill.register({
    "formats/autocomplete": AutocompleteFormat,
    "formats/openLibrary": OpenLibraryFormat,
});

export default function Editor(props: EditorProps) {
    const [isToolbarExpanded, setIsToolbarExpanded] = useState(false);
    const [showModal, setShowModal] = useState(false);
    const [wordsToAdd, setWordsToAdd] = useState<string[]>([]);
    const [isEditorEmpty, setIsEditorEmpty] = useState(true);
    const [editHistory, setEditHistory] = useState<EditHistoryEntry[]>([]);
    const initialContentRef = useRef<string>("");
    const [headerLabel, setHeaderLabel] = useState<string>("Normal"); // Track header label

    const quillRef = useRef<Quill | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);

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
                            autocomplete: () => {
                                props.onAutocomplete();
                            },
                            openLibrary: () => {
                                const content = quill.getText();
                                const words = content
                                    .split(/[\s\n.,!?]+/)
                                    .filter((word) => word.length > 0)
                                    .filter((word, index, self) => self.indexOf(word) === index);
                                setWordsToAdd(words);
                                setShowModal(true);
                            },
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

            quillRef.current = quill;

            // Store initial content when editor is mounted
            initialContentRef.current = quill.root.innerHTML;

            // Add text-change event listener
            quill.on("text-change", () => {
                const content = quill.root.innerHTML;
                if (props.onChange) {
                    const cleanedContents = getCleanedHtml(content);

                    // New function to remove excessive empty paragraphs and line breaks
                    const removeExcessiveEmptyTags = (html: string) => {
                        return html
                            .replace(/<p><br><\/p>/g, "<p></p>") // Replace <p><br></p> with <p></p>
                            .replace(/<p><\/p>(\s*<p><\/p>)+/g, "<p></p>") // Remove consecutive empty paragraphs
                            .replace(/^(\s*<p><\/p>)+/, "") // Remove leading empty paragraphs
                            .replace(/(\s*<p><\/p>)+$/, ""); // Remove trailing empty paragraphs
                    };

                    const trimmedContent = removeExcessiveEmptyTags(cleanedContents);

                    const arrayOfParagraphs = trimmedContent
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
                        : [`<span>${firstParagraphWithoutP}</span>`, ...restOfParagraphs].join("");

                    props.onChange({
                        html: finalContent,
                    });
                }
                updateHeaderLabel();
            });

            // Save edit history on unmount
            return () => {
                if (quillRef.current) {
                    const finalContent = quillRef.current.root.innerHTML;
                    if (finalContent !== initialContentRef.current) {
                        setEditHistory((prev) => {
                            const newEntry = {
                                before: initialContentRef.current,
                                after: finalContent,
                                timestamp: Date.now(),
                            };
                            // Keep only the last 7 entries
                            return [...prev, newEntry].slice(-7);
                        });
                    }
                }
            };
        }
    }, [props.sourceText, props.currentLineId, props.onAutocomplete]); // Add props.currentLineId to the dependency array

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
        const text = delta.ops?.reduce((text, op) => {
            return text + (op.insert ? op.insert : "");
        }, "");

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
                if (event.data.type === "providerSendsLLMCompletionResponse") {
                    const completionText = event.data.content.completion;
                    quill.root.innerHTML = completionText; // Clear existing content
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

    // Add a new useEffect to handle sourceText updates
    useEffect(() => {
        if (props.sourceText !== null) {
            console.log("Source text updated:", props.sourceText);
            // You can perform any necessary actions with the updated sourceText here
        }
    }, [props.sourceText]);

    return (
        <>
            <div className="editor-container">
                <div ref={editorRef}></div>
            </div>
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
}

// Existing constants and interfaces
const TOOLBAR_OPTIONS = [
    ["openLibrary", "autocomplete"],
    ["headerStyleLeft", "headerStyleLabel", "headerStyleRight"], // Three separate buttons for the control
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
}
