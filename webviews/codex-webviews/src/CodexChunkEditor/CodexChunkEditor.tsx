import { useState, useEffect } from "react";
import Editor from "./Editor";
// import ReactQuill from "react-quill";
// import "react-quill/dist/quill.snow.css";
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();
import {
    EditorVerseContent,
    EditorPostMessages,
    CustomNotebookData,
} from "../../../../types";

// TODO: add a language type for the translation unit heading aka the book names
// TODO: stop user from closing current editor when they have unsaved changes
// TODO: save each change to the verse metadata as "working copy"

// type ContentUpdate = {
//     verseMarker: EditorVerseContent["verseMarker"];
//     content: EditorVerseContent["content"];
// };

function CodexChunkEditor() {
    const [content, setContent] = useState<CustomNotebookData>(
        {} as CustomNotebookData,
    );
    const [contentBeingUpdated, setContentBeingUpdated] =
        useState<EditorVerseContent>({} as EditorVerseContent);

    // const quillRef = useRef<ReactQuill>(null);

    useEffect(() => {
        const messageListener = (event: MessageEvent) => {
            console.log({ event });
            const message = event.data;
            switch (message.type) {
                case "update":
                    try {
                        const jsonContent = JSON.parse(message.content);
                        setContent(jsonContent);
                    } catch (error) {
                        console.error("Failed to parse JSON content:", error);
                    }
                    break;
            }
        };

        window.addEventListener("message", messageListener);
        vscode.postMessage({
            command: "getContent",
        } as EditorPostMessages);

        return () => window.removeEventListener("message", messageListener);
    }, []);

    // const handleChange = (value: string) => {
    //     console.log({ value });
    //     const processedContent = processVerseContent(value);
    //     vscode.postMessage({
    //         type: "update",
    //         content: JSON.stringify(processedContent),
    //     });
    // };

    // const handleAICompletion = useCallback(() => {
    //     if (quillRef.current) {
    //         const quill = quillRef.current.getEditor();
    //         const range = quill.getSelection();
    //         quill.on("text-change", (delta, oldDelta, source) => {
    //             console.log({ delta, oldDelta, source });
    //         });
    //         console.log(range);
    //         if (range) {
    //             const text = quill.getText(0, range.index);
    //             vscode.postMessage({ type: "aiCompletion", text });
    //         }
    //     }
    // }, []);
    // const handleVerseChange = (
    //     verseMarker: string,
    //     // cellIndex: number,
    //     verseIndex: number,
    //     newContent: string,
    //     content: CustomNotebookData,
    // ) => {
    //     // if (quillRef.current) {
    //     //     const content = quillRef.current.getEditorContents();
    //     //     console.log({ content });
    //     // }

    //     console.log({ newContent, content, verseIndex, verseMarker });
    //     // const updatedContent = JSON.parse(JSON.stringify(content));
    //     // const cellVerses = JSON.parse(updatedContent.cells[cellIndex].value);
    //     // // cellVerses[verseIndex].content = newContent;
    //     // updatedContent.cells[cellIndex].value = JSON.stringify(cellVerses);

    //     // vscode.postMessage({
    //     //     type: "update",
    //     //     content: JSON.stringify(updatedContent),
    //     // });
    // };

    // useEffect(() => {
    //     if (quillRef.current) {
    //         const quill = quillRef.current.getEditor();
    //         const toolbar = quill.getModule("toolbar");
    //         toolbar.addHandler("ai", handleAICompletion);
    //     }
    // }, [handleAICompletion]);

    // console.log({ content });
    const scriptureCells = content?.cells?.filter(
        (cell) => cell.language === "scripture",
    );
    const processVerseContent = (cellContent: string) => {
        console.log({ cellContent });
        const lines = cellContent.split(
            /(?<=^|\s)(?=[A-Z]{3} \d{1,3}:\d{1,3})/,
        );
        console.log({ lines });
        const processedLines = lines.map((line) => {
            const [book, chapterVerse, ...contentParts] = line.split(/\s+/);
            // const [chapter, verse] = chapterVerse.split(":");
            const verseMarker = `${book} ${chapterVerse}`;
            return {
                verseMarker,
                verseContent: contentParts.join(" "),
            };
        });
        console.log({ processedLines });
        return processedLines;
    };
    const verseWithContent =
        scriptureCells?.length > 0
            ? processVerseContent(scriptureCells[0].value)
            : [];
    // scriptureCells?.forEach((cell, cellIndex) => {
    //     verseContent.forEach((verse) => {
    //         verseWithContent.push({
    //             ...verse,
    //             cellIndex,
    //         });
    //     });
    // });
    console.log({ verseWithContent });
    // const CustomToolbar = () => (
    //     <div id="toolbar">
    //         <button className="ql-ai" onClick={handleAICompletion}>
    //             ✨
    //         </button>
    //     </div>
    // );

    // const modules = {
    //     toolbar: {
    //         container: "#toolbar",
    //         handlers: {
    //             handleAICompletion: handleAICompletion,
    //         },
    //     },
    // };

    // const formats = [
    //     "header",
    //     "font",
    //     "size",
    //     "bold",
    //     "italic",
    //     "underline",
    //     "strike",
    //     "blockquote",
    //     "list",
    //     "bullet",
    //     "indent",
    //     "link",
    //     "image",
    //     "color",
    // ];
    const translationUnits =
        scriptureCells?.length > 0
            ? processVerseContent(scriptureCells[0].value)
            : [];
    return (
        <div>
            <p>
                {translationUnits?.map(
                    ({ verseMarker, verseContent }, verseIndex) => {
                        if (verseMarker === contentBeingUpdated.verseMarker) {
                            return (
                                <div key={verseIndex}>
                                    <div key={`${verseIndex}`}>
                                        <h3>{verseMarker}</h3>
                                        <div className="text-editor">
                                            <Editor
                                                key={`${verseIndex}-quill`}
                                                value={verseContent}
                                                onChange={({ markdown }) => {
                                                    setContentBeingUpdated({
                                                        verseMarker,
                                                        content: markdown,
                                                    });
                                                    console.log({
                                                        markdown,
                                                    });
                                                }}
                                            />
                                            <button
                                                onClick={() => {
                                                    console.log({
                                                        contentBeingUpdated,
                                                    });
                                                    vscode.postMessage({
                                                        command: "saveMarkdown",
                                                        content:
                                                            contentBeingUpdated,
                                                    } as EditorPostMessages);
                                                }}
                                            >
                                                Save
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        } else if (verseContent.length > 0) {
                            return (
                                <>
                                    {" "}
                                    <sup style={{ marginRight: "0.1rem" }}>
                                        {
                                            verseMarker
                                                .split(" ")[1]
                                                .split(":")[1]
                                        }
                                    </sup>
                                    <span
                                        onClick={() => {
                                            setContentBeingUpdated({
                                                verseMarker,
                                                content: verseContent,
                                            });
                                        }}
                                        style={{
                                            cursor: "pointer",
                                            transition: "background-color 0.3s",
                                        }}
                                        onMouseEnter={(e) =>
                                            (e.currentTarget.style.backgroundColor =
                                                "#f0f0f0")
                                        }
                                        onMouseLeave={(e) =>
                                            (e.currentTarget.style.backgroundColor =
                                                "transparent")
                                        }
                                    >
                                        {verseContent}
                                    </span>
                                </>
                            );
                        } else {
                            return (
                                <p
                                    style={{
                                        cursor: "pointer",
                                        transition: "background-color 0.3s",
                                    }}
                                    onMouseEnter={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                            "#f0f0f0")
                                    }
                                    onMouseLeave={(e) =>
                                        (e.currentTarget.style.backgroundColor =
                                            "transparent")
                                    }
                                    onClick={() => {
                                        setContentBeingUpdated({
                                            verseMarker,
                                            content: "",
                                        });
                                    }}
                                >
                                    {verseMarker}
                                </p>
                            );
                        }
                    },
                )}
            </p>
        </div>
    );
}

export default CodexChunkEditor;
