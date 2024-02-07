import { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { NotebookCommentThread } from "../../types";
const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];
function App() {
    const [comment, setComment] = useState<Comment>();
    const [commentThreadArray, setCommentThread] = useState<NotebookCommentThread[]>(
        [],
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            console.log({ message }, "lkdjsfad;o");
            switch (message.command) {
                case "commentsFromWorkspace": {
                    if (message.content) {
                        const comments = JSON.parse(message.content);
                        setCommentThread(comments);
                        console.log({ comments });
                    }
                    break;
                }
                // Handle other cases
            }
        };

        window.addEventListener("message", handleMessage);

        // Cleanup function to remove the event listener
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, []); // The empty array means this effect runs once on mount and cleanup on unmount
    useEffect(() => {
        const uri: any = "";
        if (comment) {
            const updatedCommentThreadArray: NotebookCommentThread[] = [
                ...commentThreadArray,
                {
                    uri: uri,
                    canReply: true,
                    comments: [comment],
                    verseRef,
                    collapsibleState: 0,
                },
            ];
            vscode.postMessage({
                command: "updateCommentThread",
                comments: JSON.stringify(updatedCommentThreadArray),
            });
        }
    }, [comment, commentThreadArray]);

    function handleClick(commentContent?: string) {
        // if (message) {
        // const currentMessageLog = [...messageLog, message];
        // setMessageLog(currentMessageLog);
        // console.log({ currentMessageLog });
        const id = 1 // FIXME: use unique id count
        setComment({
            id,
            contextValue: "canDelete",
            body: commentContent || "",
            mode: 1,
            author: { name: "vscode" },
        });

        // setMessage(undefined);
        // }
    }
    // console.log("getState", vscode.getState());
    // window.addEventListener(
    //     "message",
    //     (
    //         event: MessageEvent<{
    //             command: "response";
    //             finished: boolean;
    //             text: string;
    //         }>,
    //     ) => {
    //         // const message = event.data; // The JSON data our extension sent
    //         console.log({ event, message });
    //         if (!event.data.finished) {
    //             const messageContent =
    //                 (message?.content || "") + (event.data.text || "");
    //             setMessage({
    //                 role: "system",
    //                 content: messageContent,
    //             });
    //         } else {
    //             if (message) {
    //                 setMessageLog([...messageLog, message]);
    //             }
    //             setMessage(undefined);
    //         }
    //         // switch (message.command) {
    //         //   case "setState": {
    //         //     // Handle the 'setState' message and update webview state
    //         //     const state = message.data;
    //         //     console.log({ state });
    //         //     // Use the state to update your webview content
    //         //     break;
    //         //   }
    //         // }
    //     },
    // );
    return (
        <main
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100vh",
                width: "100%",
            }}
        >
            <div
                className="chat-container"
                style={{ flex: 1, overflowY: "auto" }}
            >
                <div className="chat-content">
                    {commentThreadArray.map((commentThread) => {
                        return (
                            <p>
                                {JSON.stringify(commentThread.comments[0].body)}
                            </p>
                        );
                    })}
                </div>
            </div>
            {/* Input for sending messages */}
            <form
                className="chat-input"
                style={{
                    position: "sticky",
                    bottom: 0,
                    width: "100%",
                    display: "flex",
                    flexWrap: "nowrap",
                }}
                onSubmit={(e) => {
                    e.preventDefault();
                    handleClick();
                }}
            >
                <VSCodeTextField
                    placeholder="Type a message..."
                    value={JSON.stringify(comment?.body) || ""}
                    onChange={(e) =>
                        handleClick((e.target as HTMLInputElement).value)
                    }
                    style={{ width: "100%" }}
                />
                <VSCodeButton type="submit">Send</VSCodeButton>
            </form>
        </main>
    );
}

export default App;
