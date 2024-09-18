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

icons["autocomplete"] =
    '<svg viewBox="0 0 18 18"><text x="4" y="14" font-size="14">✨</text></svg>';

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
    ["autocomplete"],
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
                            autocomplete: addTestWord,
                        },
                    },
                    spellChecker: {},
                },
            });

            // Set RTL direction after initialization
            quill.format("direction", "rtl");
            quill.format("align", "right");

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
            <div ref={editorRef}></div>
        </>
    );
}
