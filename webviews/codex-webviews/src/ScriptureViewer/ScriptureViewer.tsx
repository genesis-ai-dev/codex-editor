import { useState, useEffect } from "react";
import "../App.css";
import {
    ScriptureContent,
    ScripturePostMessages,
    NotebookCellKind,
} from "../../../../types";

const markdownNotebookCellKind = 1 as NotebookCellKind;
const verseContentNotebookCellKind = 2 as NotebookCellKind;
const vscode = acquireVsCodeApi();
function App() {
    const [scriptureContent, setScriptureContent] =
        useState<ScriptureContent>();

    useEffect(() => {
        if (scriptureContent && scriptureContent?.cells.length === 0) {
            vscode.postMessage({
                command: "fetchData",
            } as ScripturePostMessages);
        }
        const handleMessage = (event: MessageEvent) => {
            const message: ScripturePostMessages = event.data;
            switch (message.command) {
                case "sendData": {
                    if (message.data) {
                        setScriptureContent(message.data);
                        // console.log({ comments });
                    }
                    break;
                }
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []); // The empty array means this effect runs once on mount and cleanup on unmount
    console.log({ scriptureContent });
    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
                padding: "10px",
                boxSizing: "border-box",
                backgroundColor: "var(--vscode-editorWidget-background)",
                color: "var(--vscode-editorWidget-foreground)",
            }}
        >
            <div
                className="comments-container"
                style={{
                    flex: 1,
                    overflowY: "auto",
                    width: "100%",
                    marginTop: "10px",
                }}
            >
                <div
                    className="comments-content"
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "10px",
                    }}
                >
                    {scriptureContent?.cells.map((scriptureCell) => {
                        const cellIsMarkdownChapterHeading =
                            scriptureCell.kind === markdownNotebookCellKind &&
                            scriptureCell.metadata?.type === "chapter-heading";
                        const values = scriptureCell.value.split("\n");

                        const valueArray: string[][] = [];
                        const emptyLineFound = !!values.find(
                            (value) => value.trim() === "",
                        );

                        if (emptyLineFound) {
                            let index = 0;
                            values.forEach((value) => {
                                if (value.trim() !== "") {
                                    if (!valueArray[index]) {
                                        valueArray.push([]);
                                    }
                                    valueArray[index].push(value);
                                } else {
                                    index++;
                                }
                            });
                        }
                        console.log({ values, valueArray, emptyLineFound });

                        if (
                            cellIsMarkdownChapterHeading ||
                            scriptureCell.kind === verseContentNotebookCellKind
                        ) {
                            return (
                                <div
                                    style={
                                        {
                                            // backgroundColor:
                                            //     "var(--vscode-dropdown-background)",
                                            // padding: "20px",
                                            // borderRadius: "5px",
                                            // boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                            // display: "flex",
                                            // flexFlow: "column nowrap",
                                        }
                                    }
                                >
                                    {scriptureCell.kind ===
                                        markdownNotebookCellKind &&
                                        scriptureCell.metadata?.type ===
                                            "chapter-heading" && (
                                            <h1>
                                                {scriptureCell.value
                                                    .replace(/^#+\s*/, "")
                                                    .trim()}
                                            </h1>
                                        )}
                                    {scriptureCell.kind ===
                                        verseContentNotebookCellKind && (
                                        <>
                                            {valueArray.map((arrayOfLines) => {
                                                return (
                                                    <p
                                                        style={{
                                                            fontSize: "1rem",
                                                            lineHeight:
                                                                "1.8rem",
                                                        }}
                                                    >
                                                        {arrayOfLines.map(
                                                            (line, index) => {
                                                                const verseNumber =
                                                                    line.match(
                                                                        /^[^:]*:\s*(\d+)/,
                                                                    )?.[1];

                                                                const verseContent =
                                                                    line.replace(
                                                                        /^[^:]*:\s*\d+\s*/,
                                                                        "",
                                                                    );
                                                                if (
                                                                    verseNumber &&
                                                                    verseContent
                                                                ) {
                                                                    return (
                                                                        <span
                                                                            key={
                                                                                index
                                                                            }
                                                                            style={{
                                                                                margin: "0",
                                                                                padding:
                                                                                    "0.5em 0",
                                                                            }}
                                                                        >
                                                                            <sup
                                                                                style={{
                                                                                    verticalAlign:
                                                                                        "text-top",
                                                                                    marginRight:
                                                                                        "0.3em",
                                                                                    marginLeft:
                                                                                        "0.3em",
                                                                                    lineHeight:
                                                                                        "1.5em",
                                                                                }}
                                                                            >
                                                                                {
                                                                                    verseNumber
                                                                                }
                                                                            </sup>
                                                                            {
                                                                                verseContent
                                                                            }
                                                                        </span>
                                                                    );
                                                                }
                                                            },
                                                        )}
                                                    </p>
                                                );
                                            })}
                                        </>
                                    )}
                                </div>
                            );
                        }
                    })}
                </div>
            </div>
        </main>
    );
}

export default App;
