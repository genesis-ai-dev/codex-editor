import React, { useState } from "react";
import EditButtonWithCancelOption from "./EditButtonWithCancleOption";
import DeleteButtonWithConfirmation from "./DeleteButtonWithConfirmation";
import { CommentTextForm, CommentTextFormProps } from "./CommentTextForm";
import { NotebookCommentThread } from "../../../../types";
import HideOptionsButton from "./HideOptionsButton";

type CommentProps = {
    comment: NotebookCommentThread["comments"][0];
    handleCommentDeletion: (commentId: number, commentThreadId: string) => void;
    handleCommentUpdate: CommentTextFormProps["handleSubmit"];
    showHorizontalLine: boolean;
    commentThreadId: string;
};

const CommentViewSlashEditorSlashDelete: React.FC<CommentProps> = ({
    comment,
    handleCommentDeletion,
    handleCommentUpdate,
    showHorizontalLine: showHorizontalLine,
    commentThreadId,
}) => {
    const [editMode, setEditMode] = useState(false);

    const handleEditButtonClick = () => {
        setEditMode(!editMode);
    };

    return (
        <div
            style={{
                display: "flex",
                flex: 1,
                flexFlow: "column nowrap",
            }}
            key={comment.id}
        >
            {showHorizontalLine && (
                <hr
                    style={{
                        width: "100%",
                        border: "0",
                        borderBottom:
                            "1px solid var(--vscode-editor-foreground)",
                        margin: "10px 0",
                    }}
                />
            )}
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    gap: "10px",
                    flexFlow: "row nowrap",
                }}
            >
                {!editMode ? (
                    <p
                        style={{
                            margin: "0 0 10px 0",
                        }}
                    >
                        {comment.body}
                    </p>
                ) : (
                    <CommentTextForm
                        commentId={comment.id}
                        handleSubmit={({ comment: newComment }) => {
                            handleCommentUpdate({
                                comment: newComment,
                                threadId: commentThreadId,
                                title: null,
                                commentId: comment.id,
                            });
                            setEditMode(false);
                        }}
                        threadId={commentThreadId}
                        commentValue={comment.body}
                    />
                )}
                {showHorizontalLine && (
                    <HideOptionsButton outerDivStyles={{ gap: "10px" }}>
                        <div style={{ display: "flex", gap: "10px" }}>
                            <EditButtonWithCancelOption
                                editModeIsActive={editMode}
                                handleEditButtonClick={handleEditButtonClick}
                            />
                            <DeleteButtonWithConfirmation
                                handleDeleteButtonClick={() =>
                                    handleCommentDeletion(
                                        comment.id,
                                        commentThreadId,
                                    )
                                }
                            />
                        </div>
                    </HideOptionsButton>
                )}
            </div>
        </div>
    );
};

export default CommentViewSlashEditorSlashDelete;
