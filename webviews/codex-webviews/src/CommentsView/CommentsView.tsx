import { useState, useEffect } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "../App.css";
import { NotebookCommentThread, CommentPostMessages } from "../../../../types";
import VerseRefNavigation from "../components/VerseRefNavigation";
import UpdateAndViewCommentThreadTitle from "../components/UpdateAndViewCommentThreadTitle";
import CommentViewSlashEditorSlashDelete from "../components/CommentViewSlashEditorSlashDelete";
import {
  CommentTextForm,
  CommentTextFormProps,
} from "../components/CommentTextForm";
import { v4 as uuidv4 } from "uuid";
const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];
function App() {
  const [verseRef, setVerseRef] = useState<string>("GEN 1:1");
  const [uri, setUri] = useState<string>();
  const [commentThreadArray, setCommentThread] = useState<
    NotebookCommentThread[]
  >([]);
  const [showCommentForm, setShowCommentForm] = useState<{
    [key: string]: boolean;
  }>({});

  const handleToggleCommentForm = (threadId: string) => {
    setShowCommentForm((prev) => ({
      ...prev,
      [threadId]: !prev[threadId],
    }));
  };

  useEffect(() => {
    if (commentThreadArray.length === 0) {
      vscode.postMessage({
        command: "fetchComments",
      } as CommentPostMessages);
    }

    // get the current verseRef in the shared state store
    vscode.postMessage({
      command: "getCurrentVerseRef",
    } as CommentPostMessages);

    const handleMessage = (event: MessageEvent) => {
      const message: CommentPostMessages = event.data;
      switch (message.command) {
        case "commentsFromWorkspace": {
          if (message.content) {
            console.log(message.content);
            const comments = JSON.parse(message.content);
            setCommentThread(comments);
          }
          break;
        }
        case "reload": {
          setVerseRef(message.data?.verseRef);
          setUri(message.data?.uri);
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

  const handleSubmit: CommentTextFormProps["handleSubmit"] = ({
    comment: submittedCommentValue,
    title,
    threadId,
    commentId: commentIdForUpdating,
  }) => {
    const exitingThread = commentThreadArray.find(
      (commentThread) => commentThread.id === threadId
    );
    const lastComment =
      exitingThread?.comments[exitingThread.comments.length - 1];
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
      verseRef,
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
  const handleCommentDeletion = (
    commentId: number,
    commentThreadId: string
  ) => {
    vscode.postMessage({
      command: "deleteComment",
      args: { commentId, commentThreadId },
    } as CommentPostMessages);
  };

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
      <VerseRefNavigation verseRef={verseRef} callback={setVerseRef} />
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
          {commentThreadArray.map((commentThread) => {
            if (commentThread.verseRef === verseRef && !commentThread.deleted) {
              return (
                <div
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
                            handleCommentDeletion={handleCommentDeletion}
                            handleCommentUpdate={handleSubmit}
                          />
                        )
                    )}
                  </div>
                  {!showCommentForm[commentThread.id] ? (
                    <VSCodeButton
                      onClick={() => handleToggleCommentForm(commentThread.id)}
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
            }
          })}
        </div>
      </div>
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
