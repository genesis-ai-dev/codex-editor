import React, { useState } from "react";
import EditButtonWithCancelOption from "./EditButtonWithCancleOption";
import DeleteButtonWithConfirmation from "./DeleteButtonWithConfirmation";
import { CommentTextForm, CommentTextFormProps } from "./CommentTextForm";
import { NotebookCommentThread } from "../../../../types";
import HideOptionsButton from "./HideOptionsButton";

type CommentProps = {
    commentThread: NotebookCommentThread;
    handleCommentThreadDeletion: (commentThreadId: string) => void;
    handleCommentUpdate: CommentTextFormProps["handleSubmit"];
};

const UpdateAndViewCommentThreadTitle: React.FC<CommentProps> = ({
    commentThread,
    handleCommentThreadDeletion,
    handleCommentUpdate,
}) => {
    const [editMode, setEditMode] = useState(false);

    const handleEditButtonClick = () => {
        setEditMode(!editMode);
    };
    const idOfFirstComment = 1;

    return (
        <div
            style={{
                display: "flex",
                flexFlow: "row nowrap",
                justifyContent: "space-between",
                gap: "10px",
            }}
        >
            {!editMode ? (
                <h3 style={{ margin: "0 0 10px 0" }}>
                    {commentThread.threadTitle || "Note:"}
                </h3>
            ) : (
                <CommentTextForm
                    showTitleInput={true}
                    commentId={idOfFirstComment}
                    handleSubmit={({ comment: newComment, title }) => {
                        handleCommentUpdate({
                            comment: newComment,
                            threadId: commentThread.id,
                            title: title,
                            commentId: idOfFirstComment,
                        });
                        setEditMode(false);
                    }}
                    threadId={commentThread.id}
                    titleValue={commentThread.threadTitle}
                    commentValue={
                        commentThread.comments.find(
                            (comment) => comment.id === idOfFirstComment,
                        )?.body
                    }
                />
            )}
            <HideOptionsButton outerDivStyles={{ gap: "10px" }}>
                <div style={{ display: "flex", gap: "10px" }}>
                    <EditButtonWithCancelOption
                        editModeIsActive={editMode}
                        handleEditButtonClick={handleEditButtonClick}
                    />
                    <DeleteButtonWithConfirmation
                        handleDeleteButtonClick={() =>
                            handleCommentThreadDeletion(commentThread.id)
                        }
                    />
                </div>
            </HideOptionsButton>
        </div>
    );
};

export default UpdateAndViewCommentThreadTitle;
