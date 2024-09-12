import { useRef, useState, useEffect, useMemo } from "react";
import Quill from "quill";
import "quill/dist/quill.snow.css";
import registerQuillSpellChecker, {
    getCleanedHtml,
} from "./react-quill-spellcheck";

const icons: any = Quill.import("ui/icons");
// Assuming you have access to the VSCode API here
const vscode: any = (window as any).vscodeApi;

// Register the QuillSpellChecker with the VSCode API
registerQuillSpellChecker(Quill, vscode);

icons["spellcheck"] =
    '<svg viewBox="0 0 18 18"><path class="ql-fill" d="M9 1C4.64 1 1 4.64 1 9s3.64 8 8 8 8-3.64 8-8-3.64-8-8-8zm0 16c-3.31 0-6-2.69-6-6s2.69-6 6-6 6 2.69 6 6-2.69 6-6 6zm3.78-10.78l-1 1L9 11.91 7.11 10.02l-1 1L9 13.91l4.59-4.59-1.89-1.89z"/></svg>';

icons["add-test"] =
    '<svg viewBox="0 0 18 18"><text x="4" y="14" font-size="14">T</text></svg>';

export interface EditorContentChanged {
    html: string;
}

export interface EditorProps {
    initialValue?: string;
    onChange?: (changes: EditorContentChanged) => void;
    spellCheckResponse?: any;
}

const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["clean"],
    ["spellcheck"],
    ["add-test"],
];

export default function Editor(props: EditorProps) {
    function isQuillEmpty(quill: Quill | null) {
        if (!quill) return true;
        let delta = quill.getContents();
        let text = delta.ops?.reduce((text, op) => {
            return text + (op.insert ? op.insert : "");
        }, "");

        // Trim whitespace and check if empty
        return text?.trim().length === 0;
    }

    const revertedValue = useMemo(() => {
        return props.initialValue
            ?.replace(/^<span>/, "<p>")
            .replace(/<\/span>/, "</p>");
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
                            "add-test": addTestWord,
                            spellcheck: () => {
                                console.log("spellcheck was clicked");
                            },
                        },
                    },
                    spellChecker: {},
                },
            });

            quillRef.current = quill;

            quill.on("text-change", () => {
                const content = quill.root.innerHTML;
                // Remove this line to prevent unnecessary state updates
                // setValue(content);
                if (props.onChange) {
                    const cleanedContents = getCleanedHtml(content);

                    const arrayOfParagraphs = cleanedContents
                        .trim()
                        .split("</p>")
                        .map((p) => p.trim());
                    const finalParagraphs = arrayOfParagraphs
                        .filter((p) => !!p)
                        .map((p) =>
                            p.startsWith("<p>") ? `${p}</p>` : `<p>${p}</p>`,
                        );

                    const firstParagraph = finalParagraphs[0];
                    const restOfParagraphs = finalParagraphs.slice(1) || [];
                    const firstParagraphWithoutP = firstParagraph
                        .trim()
                        .slice(3, -4);
                    const contentIsEmpty = isQuillEmpty(quill);

                    console.log("firstParagraphWithoutP", {
                        firstParagraphWithoutP,
                        contentIsEmpty,
                    });
                    const finalContent = contentIsEmpty
                        ? ""
                        : [
                              `<span>${firstParagraphWithoutP}</span>`,
                              ...restOfParagraphs,
                          ].join("");

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

    const addTestWord = () => {
        if (quillRef.current) {
            const length = quillRef.current.getLength();
            quillRef.current.insertText(length, " test");
        }
    };

    return (
        <>
            <button onClick={addTestWord} className="vscode-button">
                Add "test"
            </button>
            <div ref={editorRef} style={{ height: "400px" }}></div>
        </>
    );
}
