import { useRef, useState } from "react";
// import ReactQuill, { Quill } from "react-quill";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
import registerQuillSpellChecker, {
    getCleanedHtml,
} from "./react-quill-spellcheck";
// import "react-quill-spell-checker/dist/styles.css";
// registerQuillSpellChecker(Quill);
export interface EditorContentChanged {
    html: string;
}

export interface EditorProps {
    value?: string;
    onChange?: (changes: EditorContentChanged) => void;
}

const TOOLBAR_OPTIONS = [
    [{ header: [1, 2, 3, false] }],
    ["bold", "italic", "underline", "strike", "blockquote", "link"],
    [{ list: "ordered" }, { list: "bullet" }],
    [{ indent: "-1" }, { indent: "+1" }],
    ["clean"],
    // ["spellcheck"], // Add spellcheck button to toolbar
];

// Custom dictionary (example words)
const customDictionary = ["codex", "vscode", "webview", "languagetool"];

export default function Editor(props: EditorProps) {
    const revertedValue = props.value
        ?.replace(/^<span>/, "<p>")
        .replace(/<\/span>/, "</p>");

    const [value, setValue] = useState<string>(revertedValue || "");
    const reactQuillRef = useRef<ReactQuill>(null);

    const onChange = (content: string) => {
        setValue(content);

        if (props.onChange) {
            // Parse the content and replace outer <p> with <span>
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

            const finalContent = [
                `<span>${firstParagraph.trim().slice(3, -4)}</span>`,
                ...restOfParagraphs,
            ].join("");

            props.onChange({
                html: finalContent,
            });
        }
    };
    const addDisabledCategoriesOnBody = (text: string) => {
        console.log("text in addDisabledCategoriesOnBody", text);
        const body = {
            text,
            language: "auto",
            disabledCategories: "FORMAL_SPEECH",
        };
        return Object.keys(body)
            .map(
                (key) =>
                    `${key}=${encodeURIComponent(
                        body[key as keyof typeof body],
                    )}`,
            )
            .join("&");
    };

    // console.log("value", { value });
    // const quillSpellCheckerParams: QuillSpellCheckerParams = {
    //     disableNativeSpellcheck: true,
    //     cooldownTime: 1000,
    //     showLoadingIndicator: true,
    //     api: {
    //         url: "http://localhost:3000/api/v2/check",
    //         // body: addDisabledCategoriesOnBody,
    //         // headers: {
    //         //     "Content-Type": "application/x-www-form-urlencoded",
    //         // },
    //         // method: "POST",
    //         // mode: "cors",
    //         // mapResponse: async (response: any) => {
    //         //     const data = await response.json();
    //         //     console.log("mapResponse data", { data });
    //         //     return data;
    //         // },
    //     },
    // };
    return (
        <ReactQuill
            ref={reactQuillRef}
            theme="snow"
            placeholder="Start writing..."
            modules={{
                toolbar: {
                    container: TOOLBAR_OPTIONS,
                },
                // spellChecker: quillSpellCheckerParams,
                spellChecker: {
                    // api: {
                    //     url: "https://languagetool.org/api/v2/check",
                    //     body: (text: string) => {
                    //         console.log(
                    //             "spell-checker-debug: QuillSpellChecker body",
                    //             {
                    //                 text,
                    //             },
                    //         );
                    //         const body: any = {
                    //             text,
                    //             language: "auto",
                    //         };
                    //         return Object.keys(body)
                    //             .map(
                    //                 (key) =>
                    //                     `${key}=${encodeURIComponent(
                    //                         body[key],
                    //                     )}`,
                    //             )
                    //             .join("&");
                    //     },
                    //     headers: {
                    //         "Content-Type": "application/x-www-form-urlencoded",
                    //     },
                    //     method: "POST",
                    //     mode: "cors",
                    //     mapResponse: async (response: any) => {
                    //         console.log("spell-checker-debug: mapResponse", {
                    //             response,
                    //         });
                    //         const json = await response.json();
                    //         console.log(
                    //             "spell-checker-debug: mapResponse json",
                    //             { json },
                    //         );
                    //         return json;
                    //     },
                    // },
                    // disableNativeSpellcheck: true,
                    // cooldownTime: 3000,
                    // showLoadingIndicator: false,
                    // dictionaries: ["en-US"],
                    // customDictionaries: [customDictionary],
                    // misspelledWordClass: "misspelled-word",
                    // api: {
                    //     // url: "http://google.com/api/v2/check",
                    //     // body: (text: string) => {
                    //     //     console.log("text in body", { text });
                    //     //     // const body: any = {
                    //     //     //     text,
                    //     //     //     language: "auto",
                    //     //     // };
                    //     //     // return Object.keys(body)
                    //     //     //     .map(
                    //     //     //         (key) =>
                    //     //     //             `${key}=${encodeURIComponent(
                    //     //     //                 body[key],
                    //     //     //             )}`,
                    //     //     //     )
                    //     //     //     .join("&");
                    //     // },
                    //     //     headers: {
                    //     //         "Content-Type": "application/x-www-form-urlencoded",
                    //     //     },
                    //     //     method: "POST",
                    //     //     mode: "cors",
                    //     //     // mapResponse: async (response: any) => {
                    //     //     //     const data = await response.json();
                    //     //     //     console.log("mapResponse data", { data });
                    //     //     //     return data;
                    //     //     // },
                    // },
                },
            }}
            value={value}
            onChange={onChange}
        >
            {/* <ReactQuillSpellCheckerModule /> */}
        </ReactQuill>
    );
}
