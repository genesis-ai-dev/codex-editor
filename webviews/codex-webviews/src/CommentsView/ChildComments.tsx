import React from "react";
import { NotebookComment } from "../../../../types";

type Props = {
    comments: NotebookComment[];
    threadIndex: number;
    expandedThreadIndex: number | null;
};

function ChildComments({ comments, threadIndex, expandedThreadIndex }: Props) {
    return threadIndex === expandedThreadIndex ? (
        <ul style={{ marginBlockStart: "1rem" }}>
            {/* Child comments */}
            {comments.map((comment, commentIndex) => (
                <li key={commentIndex}>
                    <div
                        style={{
                            textOverflow: "ellipsis",
                            overflow: "hidden",
                        }}
                    >
                        {comment.body?.slice(0, 29)}
                    </div>
                </li>
            ))}
        </ul>
    ) : (
        <></>
    );
}

export default ChildComments;
