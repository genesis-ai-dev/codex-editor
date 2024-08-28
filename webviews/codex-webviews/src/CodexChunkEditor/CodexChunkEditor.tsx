import { useState, useEffect, useCallback, useRef } from "react";
import ReactQuill from "react-quill";
import "react-quill/dist/quill.snow.css";
declare function acquireVsCodeApi(): any;
const vscode = acquireVsCodeApi();
import * as vscodeTypes from "vscode";
type CustomNotebook = vscodeTypes.NotebookCellData & {
    language: string;
};

type CustomNotebookData = {
    metadata: vscodeTypes.NotebookData["metadata"];
    cells: CustomNotebook[];
};

function CodexChunkEditor() {
    const [content, setContent] = useState<CustomNotebookData>(
        {} as CustomNotebookData,
    );
    const quillRef = useRef<ReactQuill>(null);

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
        vscode.postMessage({ type: "getContent" });

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

    const handleAICompletion = useCallback(() => {
        if (quillRef.current) {
            const quill = quillRef.current.getEditor();
            const range = quill.getSelection();
            quill.on("text-change", (delta, oldDelta, source) => {
                console.log({ delta, oldDelta, source });
            });
            console.log(range);
            if (range) {
                const text = quill.getText(0, range.index);
                vscode.postMessage({ type: "aiCompletion", text });
            }
        }
    }, []);
    const handleVerseChange = (
        verseMarker: string,
        // cellIndex: number,
        verseIndex: number,
        newContent: string,
        content: CustomNotebookData,
    ) => {
        // if (quillRef.current) {
        //     const content = quillRef.current.getEditorContents();
        //     console.log({ content });
        // }

        console.log({ newContent, content, verseIndex, verseMarker });
        // const updatedContent = JSON.parse(JSON.stringify(content));
        // const cellVerses = JSON.parse(updatedContent.cells[cellIndex].value);
        // // cellVerses[verseIndex].content = newContent;
        // updatedContent.cells[cellIndex].value = JSON.stringify(cellVerses);

        // vscode.postMessage({
        //     type: "update",
        //     content: JSON.stringify(updatedContent),
        // });
    };

    useEffect(() => {
        if (quillRef.current) {
            const quill = quillRef.current.getEditor();
            const toolbar = quill.getModule("toolbar");
            toolbar.addHandler("ai", handleAICompletion);
        }
    }, [handleAICompletion]);

    console.log({ content });
    const scriptureCells = content?.cells?.filter(
        (cell) => cell.language === "scripture",
    );
    const processVerseContent = (cellContent: string) => {
        console.log({ cellContent });
        const lines = cellContent.split("\n");
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
    const CustomToolbar = () => (
        <div id="toolbar">
            <button className="ql-ai" onClick={handleAICompletion}>
                ✨
            </button>
        </div>
    );

    const modules = {
        toolbar: {
            container: "#toolbar",
            handlers: {
                handleAICompletion: handleAICompletion,
            },
        },
    };

    const formats = [
        "header",
        "font",
        "size",
        "bold",
        "italic",
        "underline",
        "strike",
        "blockquote",
        "list",
        "bullet",
        "indent",
        "link",
        "image",
        "color",
    ];
    return (
        <div>
            {verseWithContent &&
                verseWithContent?.map(
                    ({ verseMarker, verseContent }, verseIndex) => (
                        <div key={verseIndex}>
                            <div key={`${verseIndex}`}>
                                <h3>{verseMarker}</h3>
                                <div className="text-editor">
                                    <CustomToolbar />
                                    <ReactQuill
                                        key={`${verseIndex}-quill`}
                                        ref={quillRef}
                                        value={verseContent}
                                        onChange={(newContent) =>
                                            handleVerseChange(
                                                verseMarker,
                                                verseIndex,
                                                // verseIndex,
                                                newContent,
                                                content,
                                            )
                                        }
                                        theme="snow"
                                        modules={modules}
                                        formats={formats}
                                    />
                                </div>
                            </div>
                        </div>
                    ),
                )}
        </div>
    );
}

export default CodexChunkEditor;
