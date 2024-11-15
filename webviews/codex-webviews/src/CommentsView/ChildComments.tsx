import React from "react";
import { NotebookComment } from "../../../../types";

type Props = {
    comments: NotebookComment[];
    threadIndex: number;
    expandedThreadIndex: number | null;
};

function ChildComments({ comments, threadIndex, expandedThreadIndex }: Props) {
    return threadIndex === expandedThreadIndex ? (
        <div
            style={{
                padding: "0.5rem 1rem 1rem 2.5rem", // Extra left padding to align with parent's chevron
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "0.75rem",
                }}
            >
                {comments.map((comment, commentIndex) => (
                    <div
                        key={commentIndex}
                        style={{
                            padding: "0.5rem",
                            backgroundColor: "var(--vscode-list-inactiveSelectionBackground)",
                            borderRadius: "4px",
                        }}
                    >
                        <div
                            style={{
                                fontSize: "0.9em",
                                color: "var(--vscode-foreground)",
                                whiteSpace: "pre-wrap",
                                wordBreak: "break-word",
                            }}
                        >
                            {comment.body}
                        </div>
                        {comment.author && (
                            <div
                                style={{
                                    marginTop: "0.25rem",
                                    fontSize: "0.8em",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                            >
                                {comment.author.name}
                            </div>
                        )}
                    </div>
                ))}
            </div>
        </div>
    ) : null;
}

export default ChildComments;
