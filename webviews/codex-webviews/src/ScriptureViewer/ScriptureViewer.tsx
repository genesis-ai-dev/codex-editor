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

                        if (
                            cellIsMarkdownChapterHeading ||
                            scriptureCell.kind === verseContentNotebookCellKind
                        ) {
                            return (
                                <div
                                    style={{
                                        backgroundColor:
                                            "var(--vscode-dropdown-background)",
                                        padding: "20px",
                                        borderRadius: "5px",
                                        boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                        display: "flex",
                                        flexFlow: "column nowrap",
                                    }}
                                >
                                    {scriptureCell.kind ===
                                        markdownNotebookCellKind &&
                                        scriptureCell.metadata?.type ===
                                            "chapter-heading" && (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    flexFlow: "column nowrap",
                                                    marginBottom: 20,
                                                }}
                                            >
                                                <h1>{scriptureCell.value}</h1>
                                            </div>
                                        )}
                                    {scriptureCell.kind ===
                                        verseContentNotebookCellKind && (
                                        <div
                                            style={{
                                                display: "flex",
                                                flexFlow: "column nowrap",
                                                marginBottom: 20,
                                            }}
                                        >
                                            <p>{scriptureCell.value}</p>
                                        </div>
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
