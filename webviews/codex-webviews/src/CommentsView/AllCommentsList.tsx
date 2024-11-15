import React, { useState } from "react";
import { NotebookCommentThread } from "../../../../types";
import { VSCodeBadge, VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import ChildComments from "./ChildComments";

interface AllCommentsProps {
    comments: NotebookCommentThread[];
}

export const AllCommentsList = ({ comments }: AllCommentsProps) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [currentPage, setCurrentPage] = useState(1);
    const [expandedThreadIndex, setExpandedThreadIndex] = useState<number | null>(null);
    const commentsPerPage = 10;

    // Filter comments based on search
    const filteredComments = comments?.filter(
        (thread) =>
            thread.threadTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
            thread.comments?.some((comment) =>
                comment.body.toLowerCase().includes(searchQuery.toLowerCase())
            )
    );

    // Calculate pagination
    const totalPages = Math.ceil((filteredComments?.length || 0) / commentsPerPage);
    const paginatedComments = filteredComments?.slice(
        (currentPage - 1) * commentsPerPage,
        currentPage * commentsPerPage
    );

    const handleCollapseClick = (threadIndex: number) => {
        setExpandedThreadIndex(expandedThreadIndex === threadIndex ? null : threadIndex);
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                height: "100%",
                width: "100%",
                gap: "1rem",
            }}
        >
            <div
                style={{
                    padding: "1rem",
                    borderBottom: "1px solid var(--vscode-widget-border)",
                }}
            >
                <VSCodeTextField
                    placeholder="Search comments..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                >
                    <span slot="start" className="codicon codicon-search"></span>
                </VSCodeTextField>
            </div>

            <div
                style={{
                    flexGrow: 1,
                    overflowY: "auto",
                }}
            >
                {paginatedComments?.map((commentThread, threadIndex) => (
                    <div
                        key={threadIndex}
                        style={{
                            borderBottom: "1px solid var(--vscode-widget-border)",
                        }}
                    >
                        <div
                            onClick={() => handleCollapseClick(threadIndex)}
                            style={{
                                width: "100%",
                                cursor: "pointer",
                            }}
                            onMouseEnter={(e) => {
                                (e.target as HTMLDivElement).style.backgroundColor =
                                    "var(--vscode-list-hoverBackground)";
                            }}
                            onMouseLeave={(e) => {
                                (e.target as HTMLDivElement).style.backgroundColor = "";
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    padding: "0.5rem 1rem",
                                }}
                            >
                                <div
                                    style={{
                                        display: "flex",
                                        alignItems: "center",
                                        gap: "0.5rem",
                                    }}
                                >
                                    <i
                                        className={`codicon codicon-${
                                            threadIndex === expandedThreadIndex
                                                ? "chevron-down"
                                                : "chevron-right"
                                        }`}
                                    />
                                    <span>
                                        {commentThread.threadTitle?.slice(0, 50)} -{" "}
                                        <VSCodeBadge>
                                            {commentThread.cellId.cellId.slice(0, 25)}
                                        </VSCodeBadge>
                                    </span>
                                </div>
                                <span
                                    style={{
                                        color: "var(--vscode-descriptionForeground)",
                                        fontSize: "0.9em",
                                    }}
                                >
                                    {commentThread.comments.length} comment
                                    {commentThread.comments.length !== 1 ? "s" : ""}
                                </span>
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

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    padding: "1rem",
                    borderTop: "1px solid var(--vscode-widget-border)",
                }}
            >
                <VSCodeButton
                    appearance="secondary"
                    onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
                    disabled={currentPage === 1}
                >
                    Previous
                </VSCodeButton>
                <span
                    style={{
                        color: "var(--vscode-descriptionForeground)",
                        fontSize: "0.9em",
                    }}
                >
                    Page {currentPage} of {totalPages}
                </span>
                <VSCodeButton
                    appearance="secondary"
                    onClick={() => setCurrentPage((prev) => Math.min(prev + 1, totalPages))}
                    disabled={currentPage === totalPages}
                >
                    Next
                </VSCodeButton>
            </div>
        </div>
    );
};
