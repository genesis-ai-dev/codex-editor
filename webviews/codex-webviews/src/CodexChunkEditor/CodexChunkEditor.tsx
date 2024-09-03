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
import { markdownToHTML } from "../TranslationNotesView/utilities/markdownToHTML";
import CloseButtonWithConfirmation from "../components/CloseButtonWithConfirmation";
// import { markdownToHtml } from "./Parser";
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

    const [chapterIndex, setChapterIndex] = useState<number>(0);
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
    const verseRefRegex = /(?<=^|\s)(?=[A-Z, 1-9]{3} \d{1,3}:\d{1,3})/;
    const processVerseContent = (cellContent: string) => {
        console.log({ cellContent });
        const lines = cellContent.split(verseRefRegex);
        console.log({ lines });
        const processedLines = lines
            .map((line) => {
                const verseMarker = line.match(
                    /(\b[A-Z, 1-9]{3}\s\d+:\d+\b)/,
                )?.[0];
                // console.log({ verseMarker });
                if (verseMarker) {
                    const lineWithoutVerseRefMarker = line
                        .replace(`${verseMarker} `, "")
                        .replace(`${verseMarker}\n`, "")
                        .replace(`${verseMarker}`, "");

                    return {
                        verseMarker,
                        verseContent: lineWithoutVerseRefMarker,
                    };
                }
                return null;
            })
            .filter(Boolean);
        return processedLines;
    };
    const verseWithContent =
        scriptureCells?.length > 0
            ? processVerseContent(scriptureCells[0].value).filter(
                  (value) => !!value,
              )
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
            ? processVerseContent(scriptureCells[chapterIndex].value).filter(
                  (value) => !!value,
              )
            : [];
    const unsavedChanges = !!(
        contentBeingUpdated.content &&
        contentBeingUpdated.content !==
            translationUnits?.[contentBeingUpdated.verseIndex]?.verseContent
    );

    console.log({
        unsavedChanges,
        content:
            translationUnits?.[contentBeingUpdated.verseIndex]?.verseContent,
        contentBeingUpdated,
    });
    const handleCloseEditor = () => {
        setContentBeingUpdated({} as EditorVerseContent);
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
            }}
        >
            <h1>{translationUnits[0]?.verseMarker.split(":")[0]}</h1>
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    maxWidth: "30rem",
                    width: "100%",
                }}
            >
                <div
                    style={{ display: "flex", justifyContent: "space-between" }}
                >
                    <button
                        disabled={chapterIndex === 0 || unsavedChanges}
                        onClick={() => {
                            setChapterIndex(chapterIndex - 1);
                        }}
                    >
                        ⬅
                    </button>
                    <button
                        disabled={
                            chapterIndex === scriptureCells?.length - 1 ||
                            unsavedChanges
                        }
                        style={{
                            transform: "rotate(180deg)",
                        }}
                        onClick={() => {
                            setChapterIndex(chapterIndex + 1);
                        }}
                    >
                        ⬅
                    </button>
                </div>
                <p>
                    {translationUnits?.map(
                        ({ verseMarker, verseContent }, verseIndex) => {
                            // console.log({ verseMarker, verseContent });
                            if (
                                verseMarker === contentBeingUpdated.verseMarker
                            ) {
                                return (
                                    <div key={verseIndex}>
                                        <div key={`${verseIndex}`}>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    flex: 1,
                                                    justifyContent:
                                                        "space-between",
                                                }}
                                            >
                                                <h3>{verseMarker}</h3>
                                                {!unsavedChanges && (
                                                    <button
                                                        onClick={
                                                            handleCloseEditor
                                                        }
                                                        disabled={
                                                            unsavedChanges
                                                        }
                                                    >
                                                        ❌
                                                    </button>
                                                )}
                                                {unsavedChanges && (
                                                    <CloseButtonWithConfirmation
                                                        handleDeleteButtonClick={
                                                            handleCloseEditor
                                                        }
                                                    />
                                                )}
                                            </div>
                                            <div className="text-editor">
                                                <Editor
                                                    key={`${verseIndex}-quill`}
                                                    value={verseContent}
                                                    onChange={({
                                                        markdown,
                                                    }) => {
                                                        setContentBeingUpdated({
                                                            verseIndex,
                                                            verseMarker,
                                                            content: markdown,
                                                        });
                                                    }}
                                                />
                                                <button
                                                    onClick={() => {
                                                        vscode.postMessage({
                                                            command:
                                                                "saveMarkdown",
                                                            content:
                                                                contentBeingUpdated,
                                                        } as EditorPostMessages);

                                                        // TODO: set a loading state until the message is processed and the content is saved
                                                        handleCloseEditor();
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
                                                if (!unsavedChanges) {
                                                    setContentBeingUpdated({
                                                        verseMarker,
                                                        content: verseContent,
                                                        verseIndex,
                                                    });
                                                }
                                            }}
                                            style={{
                                                cursor: !unsavedChanges
                                                    ? "pointer"
                                                    : "default",
                                                transition: !unsavedChanges
                                                    ? "none"
                                                    : "background-color 0.3s",
                                            }}
                                            onMouseEnter={(e) =>
                                                (e.currentTarget.style.backgroundColor =
                                                    "#f0f0f0")
                                            }
                                            onMouseLeave={(e) =>
                                                (e.currentTarget.style.backgroundColor =
                                                    "transparent")
                                            }
                                            dangerouslySetInnerHTML={{
                                                __html: markdownToHTML(
                                                    verseContent,
                                                ),
                                            }}
                                        />
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
                                                verseIndex,
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
        </div>
    );
}

export default CodexChunkEditor;
