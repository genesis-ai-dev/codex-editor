import { useState, useEffect, useCallback, useMemo } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "../App.css";
import { NotebookCommentThread, CommentPostMessages, CellIdGlobalState } from "../../../../types";
import UpdateAndViewCommentThreadTitle from "../components/UpdateAndViewCommentThreadTitle";
import CommentViewSlashEditorSlashDelete from "../components/CommentViewSlashEditorSlashDelete";
import { CommentTextForm, CommentTextFormProps } from "../components/CommentTextForm";
import { v4 as uuidv4 } from "uuid";

const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];

function App() {
    const [cellId, setCellId] = useState<CellIdGlobalState>({ cellId: "", uri: "" });
    const [uri, setUri] = useState<string>();
    const [commentThreadArray, setCommentThread] = useState<NotebookCommentThread[]>([]);
    const [showCommentForm, setShowCommentForm] = useState<{
        [key: string]: boolean;
    }>({});

    const handleMessage = useCallback((event: MessageEvent) => {
        const message: CommentPostMessages = event.data;
        switch (message.command) {
            case "commentsFromWorkspace": {
                if (message.content) {
                    console.log("Received comments:", message.content);
                    try {
                        const comments = JSON.parse(message.content);
                        setCommentThread(comments);
                    } catch (error) {
                        console.error("Error parsing comments:", error);
                    }
                }
                break;
            }
            case "reload": {
                console.log("Reload message received:", message.data);
                if (message.data?.cellId) {
                    setCellId({ cellId: message.data.cellId, uri: message.data.uri });
                }
                if (message.data?.uri) {
                    setUri(message.data.uri);
                }
                break;
            }
        }
    }, []);

    useEffect(() => {
        window.addEventListener("message", handleMessage);

        // Request initial data
        vscode.postMessage({
            command: "fetchComments",
        } as CommentPostMessages);

        vscode.postMessage({
            command: "getCurrentCellId",
        } as CommentPostMessages);

        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [handleMessage]);

    const handleSubmit: CommentTextFormProps["handleSubmit"] = ({
        comment: submittedCommentValue,
        title,
        threadId,
        commentId: commentIdForUpdating,
    }) => {
        const exitingThread = commentThreadArray.find(
            (commentThread) => commentThread.id === threadId
        );
        const lastComment = exitingThread?.comments[exitingThread.comments.length - 1];
        let commentId = commentIdForUpdating;
        if (!commentId) {
            commentId = lastComment?.id ? lastComment.id + 1 : 1;
        }

        const comment: Comment = {
            id: commentId,
            contextValue: "canDelete",
            body: submittedCommentValue || "",
            mode: 1,
            author: { name: "vscode" },
            deleted: false,
        };
        const updatedCommentThread: NotebookCommentThread = {
            id: threadId || uuidv4(),
            uri: uri,
            canReply: true,
            comments: [comment],
            cellId: cellId,
            collapsibleState: 0,
            threadTitle: title || "",
            deleted: false,
        };
        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: updatedCommentThread,
        } as CommentPostMessages);
    };

    const handleThreadDeletion = (commentThreadId: string) => {
        vscode.postMessage({
            command: "deleteCommentThread",
            commentThreadId,
        } as CommentPostMessages);
    };
    const handleCommentDeletion = (commentId: number, commentThreadId: string) => {
        vscode.postMessage({
            command: "deleteComment",
            args: { commentId, commentThreadId },
        } as CommentPostMessages);
    };

    const filteredCommentThreads = useMemo(() => {
        return commentThreadArray.filter((commentThread) => {
            const [threadDocument, threadSection] = commentThread.cellId.cellId?.split(":") || [];
            const [currentDocument, currentSection] = cellId.cellId?.split(":") || [];
            return (
                threadDocument === currentDocument &&
                threadSection === currentSection &&
                !commentThread.deleted
            );
        });
    }, [commentThreadArray, cellId.cellId]);

    const handleToggleCommentForm = useCallback((threadId: string) => {
        setShowCommentForm((prev) => ({
            ...prev,
            [threadId]: !prev[threadId],
        }));
    }, []);

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
            {!cellId.cellId ? (
                <div>Select a cell to view comments</div>
            ) : (
                <>
                    <h2>Current Cell ID: {cellId.cellId}</h2>
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
                            {filteredCommentThreads.map((commentThread) => {
                                console.log("Rendering comment thread:", commentThread);
                                return (
                                    <div
                                        key={commentThread.id}
                                        style={{
                                            backgroundColor: "var(--vscode-dropdown-background)",
                                            padding: "20px",
                                            borderRadius: "5px",
                                            boxShadow: "0 2px 4px rgba(0,0,0,0.1)",
                                            display: "flex",
                                            flexFlow: "column nowrap",
                                        }}
                                    >
                                        <UpdateAndViewCommentThreadTitle
                                            commentThread={commentThread}
                                            handleCommentThreadDeletion={() =>
                                                handleThreadDeletion(commentThread.id)
                                            }
                                            handleCommentUpdate={(args) => handleSubmit(args)}
                                        />
                                        <div
                                            style={{
                                                display: "flex",
                                                flexFlow: "column nowrap",
                                                marginBottom: 20,
                                            }}
                                        >
                                            {commentThread.comments.map(
                                                (comment, index) =>
                                                    !comment.deleted && (
                                                        <CommentViewSlashEditorSlashDelete
                                                            comment={comment}
                                                            commentThreadId={commentThread.id}
                                                            showHorizontalLine={index !== 0}
                                                            handleCommentDeletion={
                                                                handleCommentDeletion
                                                            }
                                                            handleCommentUpdate={handleSubmit}
                                                        />
                                                    )
                                            )}
                                        </div>
                                        {!showCommentForm[commentThread.id] ? (
                                            <VSCodeButton
                                                onClick={() =>
                                                    handleToggleCommentForm(commentThread.id)
                                                }
                                            >
                                                +
                                            </VSCodeButton>
                                        ) : (
                                            <div>
                                                <CommentTextForm
                                                    handleSubmit={handleSubmit}
                                                    showTitleInput={false}
                                                    threadId={commentThread.id}
                                                    commentId={null}
                                                />
                                                <VSCodeButton
                                                    onClick={() =>
                                                        handleToggleCommentForm(commentThread.id)
                                                    }
                                                >
                                                    Cancel
                                                </VSCodeButton>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </>
            )}
            {/* Input for sending messages */}
            <CommentTextForm
                handleSubmit={handleSubmit}
                showTitleInput={true}
                threadId={null}
                commentId={null}
            />
        </main>
    );
}

export default App;
