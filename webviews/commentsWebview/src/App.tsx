import { useState, useEffect } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { NotebookCommentThread, CommentPostMessages } from "../../../types";
import VerseRefNavigation from "./components/verseRefNavigation";
const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];
function App() {
    // const [comment, setComment] = useState<Comment>();
    const [verseRef, setVerseRef] = useState<string>("GEN 1:1");
    const [uri, setUri] = useState<string>();
    const [commentThreadArray, setCommentThread] = useState<
        NotebookCommentThread[]
    >([]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message: CommentPostMessages = event.data;
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
                case "reload": {
                    console.log(verseRef, message.data?.verseRef);
                    setVerseRef(message.data?.verseRef);
                    setUri(message.data?.uri);
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
    // useEffect(() => {
    //     const uri: any = "";
    //     if (comment && verseRef) {
    //         const updatedCommentThread: NotebookCommentThread = {
    //             uri: uri,
    //             canReply: true,
    //             comments: [comment],
    //             verseRef,
    //             collapsibleState: 0,
    //         };
    //         vscode.postMessage({
    //             command: "updateCommentThread",
    //             comment: updatedCommentThread,
    //         } as CommentPostMessages);
    //     }
    // }, [comment, commentThreadArray]);
    const [formState, setFormState] = useState<string>("");
    function handleSubmit() {
        // if (message) {
        // const currentMessageLog = [...messageLog, message];
        // setMessageLog(currentMessageLog);
        console.log({
            formState,
            // "CommentCommandNames.updateCommentThread":
            //     CommentCommandNames.updateCommentThread,
        });
        // const id = 1; // FIXME: use unique id count
        // setComment({
        //     id,
        //     contextValue: "canDelete",
        //     body: formState || "",
        //     mode: 1,
        //     author: { name: "vscode" },
        // });
        if (!uri) {
            console.error("uri not found");
            return;
        }
        const comment: Comment = {
            id: 1,
            contextValue: "canDelete",
            body: formState || "",
            mode: 1,
            author: { name: "vscode" },
        };

        const updatedCommentThread: NotebookCommentThread = {
            uri: uri,
            canReply: true,
            comments: [comment],
            verseRef,
            collapsibleState: 0,
        };
        vscode.postMessage({
            command: "updateCommentThread",
            comment: updatedCommentThread,
        } as CommentPostMessages);
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
            <VerseRefNavigation verseRef={verseRef} callback={setVerseRef} />
            <div
                className="comments-container"
                style={{ flex: 1, overflowY: "auto" }}
            >
                <h1>{verseRef}</h1>
                {commentThreadArray.length === 0 && (
                    <VSCodeButton
                        type="button"
                        onClick={() => {
                            vscode.postMessage({
                                command: "fetchComments",
                            } as CommentPostMessages);
                        }}
                    >
                        Fetch Comments
                    </VSCodeButton>
                )}
                <div className="comments-content">
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
                className="comments-input"
                style={{
                    position: "sticky",
                    bottom: 0,
                    width: "100%",
                    display: "flex",
                    flexWrap: "nowrap",
                }}
                onSubmit={(e) => {
                    console.log({ e });
                    e.preventDefault();
                    handleSubmit();
                }}
            >
                <VSCodeTextField
                    placeholder="Type a message..."
                    value={formState}
                    onChange={
                        (e) => {
                            setFormState(
                                formState +
                                    (e.target as HTMLInputElement).value,
                            );
                        }
                        // handleSubmit((e.target as HTMLInputElement).value)
                    }
                    style={{ width: "100%" }}
                />
                <VSCodeButton type="submit">Send</VSCodeButton>
            </form>
        </main>
    );
}

export default App;
