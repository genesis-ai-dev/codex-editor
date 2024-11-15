import React, { SetStateAction } from "react";
import { NotebookCommentThread } from "../../../../types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import ChildComments from "./ChildComments";

interface AllCommentsProps {
    comments: NotebookCommentThread[];
    expandedThreadIndex: number | null;
    handleCollapseClick: (threadIndex: number) => void;
}

export const AllCommentsList = ({
    comments,
    expandedThreadIndex,
    handleCollapseClick,
}: AllCommentsProps) => {
    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                width: "100%",
            }}
        >
            {comments.map((commentThread, threadIndex) => (
                <div
                    key={threadIndex}
                    style={{
                        width: "100%",
                    }}
                >
                    <div
                        onClick={() => handleCollapseClick(threadIndex)}
                        className={`collapse-button ${
                            threadIndex === expandedThreadIndex ? "" : "collapsed"
                        }`}
                        style={{
                            width: "100%",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                            }}
                        >
                            <i
                                style={{
                                    marginInlineEnd: ".5rem",
                                }}
                                className={`codicon codicon-${
                                    threadIndex === expandedThreadIndex
                                        ? "chevron-down"
                                        : "chevron-right"
                                }`}
                            />
                            {commentThread.threadTitle?.slice(0, 29) || "(no title)"}:{" "}
                            {commentThread.comments.length}
                        </div>
                        <ChildComments
                            comments={commentThread.comments}
                            threadIndex={threadIndex}
                            expandedThreadIndex={expandedThreadIndex}
                        />
                    </div>
                </div>
            ))}
        </div>
    );
};
