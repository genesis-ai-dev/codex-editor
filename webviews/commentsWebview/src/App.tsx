import { useState, useEffect } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { NotebookCommentThread, CommentPostMessages } from "../../../types";
import VerseRefNavigation from "./components/verseRefNavigation";
import {
    CommentTextForm,
    CommentTextFormProps,
} from "./components/CommentTextForm";
import { v4 as uuidv4 } from "uuid";
import React from "react";
const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];
function App() {
    const [verseRef, setVerseRef] = useState<string>("GEN 1:1");
    const [uri, setUri] = useState<string>();
    const [commentThreadArray, setCommentThread] = useState<
        NotebookCommentThread[]
    >([]);

    useEffect(() => {
        if (commentThreadArray.length === 0) {
            vscode.postMessage({
                command: "fetchComments",
            } as CommentPostMessages);
        }
        const handleMessage = (event: MessageEvent) => {
            const message: CommentPostMessages = event.data;
            switch (message.command) {
                case "commentsFromWorkspace": {
                    if (message.content) {
                        const comments = JSON.parse(message.content);
                        setCommentThread(comments);
                        // console.log({ comments });
                    }
                    break;
                }
                case "reload": {
                    // console.log(verseRef, message.data?.verseRef);
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

    const handleSubmit: CommentTextFormProps["handleSubmit"] = ({
        comment: submittedCommentValue,
        title,
        threadId,
    }) => {
        const exitingThread = commentThreadArray.find(
            (commentThread) => commentThread.id === threadId,
        );
        const lastComment =
            exitingThread?.comments[exitingThread.comments.length - 1];
        const commentId = lastComment?.id ? lastComment.id + 1 : 1;

        const comment: Comment = {
            id: commentId,
            contextValue: "canDelete",
            body: submittedCommentValue || "",
            mode: 1,
            author: { name: "vscode" },
        };
        const updatedCommentThread: NotebookCommentThread = {
            id: threadId || uuidv4(),
            uri: uri,
            canReply: true,
            comments: [comment],
            verseRef,
            collapsibleState: 0,
            threadTitle: title || "",
        };
        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: updatedCommentThread,
        } as CommentPostMessages);
    };

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
                style={{ flex: 1, overflowY: "auto", width: "100%" }}
            >
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
                <div
                    className="comments-content"
                    style={{
                        display: "flex",
                        flexFlow: "column nowrap",
                        justifyContent: "stretch",
                    }}
                >
                    {commentThreadArray.map((commentThread) => {
                        if (commentThread.verseRef === verseRef) {
                            return (
                                <div
                                    style={{
                                        backgroundColor:
                                            "var(--vscode-button-background)",
                                        paddingTop: "20px",
                                        paddingRight: "15px",
                                        paddingLeft: "15px",
                                        paddingBottom: "30px",
                                        borderRadius: "20px",
                                        margin: "20px",
                                    }}
                                >
                                    <h3>
                                        {commentThread.threadTitle || "Note:"}
                                    </h3>
                                    {commentThread.comments.map(
                                        (comment, index) => (
                                            <React.Fragment key={comment.id}>
                                                {index > 0 && (
                                                    <hr
                                                        style={{
                                                            width: "100%",
                                                            border: "0",
                                                            borderBottom:
                                                                "1px solid var(--vscode-editor-foreground)",
                                                        }}
                                                    />
                                                )}
                                                <p>{comment.body}</p>
                                            </React.Fragment>
                                        ),
                                    )}
                                    <CommentTextForm
                                        handleSubmit={handleSubmit}
                                        showTitleInput={false}
                                        threadId={commentThread.id}
                                    />
                                </div>
                            );
                        }
                    })}
                </div>
            </div>
            {/* Input for sending messages */}
            <CommentTextForm
                handleSubmit={handleSubmit}
                showTitleInput={true}
                threadId={null}
            />
        </main>
    );
}

export default App;
