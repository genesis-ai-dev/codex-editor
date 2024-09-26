import { useRef, useEffect, useMemo } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import registerQuillSpellChecker, { getCleanedHtml } from "./react-quill-spellcheck";
import { EditorPostMessages } from "../../../../types";
import "./TextEditor.css"; // over write the default quill styles so spans flow

const icons: any = Quill.import("ui/icons");
// Assuming you have access to the VSCode API here
const vscode: any = (window as any).vscodeApi;

// Register the QuillSpellChecker with the VSCode API
registerQuillSpellChecker(Quill, vscode);

// Use VSCode icon for autocomplete
icons["autocomplete"] = `<i class="codicon codicon-sparkle quill-toolbar-icon"></i>`;

export interface EditorContentChanged {
    html: string;
}

export interface EditorProps {
    currentLineId: string;
    initialValue?: string;
    onChange?: (changes: EditorContentChanged) => void;
    spellCheckResponse?: any;
    textDirection: "ltr" | "rtl";
}

const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["clean"],
    ["autocomplete"],
];

export default function Editor(props: EditorProps) {
    function isQuillEmpty(quill: Quill | null) {
        if (!quill) return true;
        const delta = quill.getContents();
        const text = delta.ops?.reduce((text, op) => {
            return text + (op.insert ? op.insert : "");
        }, "");

        // Trim whitespace and check if empty
        return text?.trim().length === 0;
    }

    const revertedValue = useMemo(() => {
        if (!props.initialValue) return "";
        return props.initialValue
            ?.replace(/^<span>/, "<p>")
            .replace(/<\/span>/, "</p>")
            .replace(/\n$/, "");
    }, [props.initialValue]);

    const quillRef = useRef<Quill | null>(null);
    const editorRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editorRef.current && !quillRef.current) {
            const quill = new Quill(editorRef.current, {
                theme: "snow",
                placeholder: "Start writing...",
                modules: {
                    toolbar: {
                        container: TOOLBAR_OPTIONS,
                        handlers: {
                            autocomplete: llmCompletion,
                        },
                    },
                    spellChecker: {},
                },
            });

            // Set text direction after initialization
            quill.format("direction", props.textDirection);
            quill.format("align", props.textDirection === "rtl" ? "right" : "left");

            quillRef.current = quill;

            quill.on("text-change", () => {
                const content = quill.root.innerHTML;
                if (props.onChange) {
                    const cleanedContents = getCleanedHtml(content);

                    const arrayOfParagraphs = cleanedContents
                        .trim()
                        .split("</p>")
                        .map((p) => p.trim());
                    const finalParagraphs = arrayOfParagraphs
                        .filter((p) => !!p)
                        .map((p) => (p.startsWith("<p>") ? `${p}</p>` : `<p>${p}</p>`));

                    const firstParagraph = finalParagraphs[0];
                    const restOfParagraphs = finalParagraphs.slice(1) || [];
                    const firstParagraphWithoutP = firstParagraph.trim().slice(3, -4);
                    const contentIsEmpty = isQuillEmpty(quill);

                    console.log("firstParagraphWithoutP", {
                        firstParagraphWithoutP,
                        contentIsEmpty,
                    });
                    const finalContent = contentIsEmpty
                        ? ""
                        : [`<span>${firstParagraphWithoutP}</span>`, ...restOfParagraphs].join(" ");

                    props.onChange({
                        html: contentIsEmpty ? "\n" : finalContent,
                    });
                }
            });

            // Register spellchecker
            if ((window as any).vscodeApi) {
                registerQuillSpellChecker(Quill, (window as any).vscodeApi);
            }
        }
    }, []);

    console.log("revertedValue", revertedValue);

    useEffect(() => {
        if (quillRef.current && revertedValue !== undefined) {
            const quill = quillRef.current;
            // Only update if the content has actually changed
            if (quill.root.innerHTML !== revertedValue) {
                quill.root.innerHTML = revertedValue;
                // Move the cursor to the end
                quill.setSelection(quill.getLength(), 0);
            }
        }
    }, [revertedValue]);

    const llmCompletion = async () => {
        console.log("llmCompletion vscode", { vscode, window }, window.vscodeApi);
        window.vscodeApi.postMessage({
            command: "llmCompletion",
            content: {
                currentLineId: props.currentLineId,
            },
        } as EditorPostMessages);

        const newTextContentFromLLM: string = await new Promise((resolve) => {
            const messageListener = (event: MessageEvent) => {
                console.log("messageListener", { event });
                if (event.data.type === "llmCompletionResponse") {
                    resolve(event.data.content.completion);
                    window.removeEventListener("message", messageListener);
                }
            };
            window.addEventListener("message", messageListener);
        });

        console.log("Received text from LLM completion:", newTextContentFromLLM);
        if (quillRef.current && newTextContentFromLLM) {
            const quill = quillRef.current;
            const length = quill.getLength();
            const trimmedContent = newTextContentFromLLM.trim();

            // If the editor is empty, just set the content
            if (isQuillEmpty(quill)) {
                quill.setText(trimmedContent);
            } else {
                // If there's existing content, add a space before inserting
                quill.insertText(length, " " + trimmedContent);
            }

            // Trigger the text-change event manually
            quill.update();
        } else {
            console.error("Quill editor not initialized or empty text received");
        }
    };

    return (
        <>
            <div ref={editorRef}></div>
        </>
    );
}
