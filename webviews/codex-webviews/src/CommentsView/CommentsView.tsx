import { useState, useEffect, useCallback, useMemo } from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeTextField,
    VSCodeBadge,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";
import "../App.css";
import { NotebookCommentThread, CommentPostMessages, CellIdGlobalState } from "../../../../types";
import { v4 as uuidv4 } from "uuid";

const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];

interface UserAvatar {
    username: string;
    email?: string;
    size?: "small" | "medium" | "large";
    timestamp?: string;
}

const UserAvatar = ({ username, email, size = "small", timestamp }: UserAvatar) => {
    const sizeMap = {
        small: { width: "24px", height: "24px", fontSize: "12px" },
        medium: { width: "32px", height: "32px", fontSize: "14px" },
        large: { width: "40px", height: "40px", fontSize: "16px" },
    };

    return (
        <div
            style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                position: "relative",
            }}
            title={email ? `${username} (${email})` : username}
        >
            <div
                style={{
                    ...sizeMap[size],
                    borderRadius: "50%",
                    backgroundColor: "var(--vscode-badge-background)",
                    color: "var(--vscode-badge-foreground)",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                    fontWeight: "500",
                }}
            >
                {username[0].toUpperCase()}
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                <span style={{ fontWeight: "500" }}>{username}</span>
                {timestamp && (
                    <span
                        style={{
                            fontSize: "11px",
                            color: "var(--vscode-descriptionForeground)",
                        }}
                    >
                        {timestamp}
                    </span>
                )}
            </div>
        </div>
    );
};

function App() {
    const [cellId, setCellId] = useState<CellIdGlobalState>({ cellId: "", uri: "" });
    const [uri, setUri] = useState<string>();
    const [commentThreadArray, setCommentThread] = useState<NotebookCommentThread[]>([]);
    const [replyText, setReplyText] = useState<Record<string, string>>({});
    const [collapsedThreads, setCollapsedThreads] = useState<Record<string, boolean>>({});
    const [searchQuery, setSearchQuery] = useState("");
    const [showNewCommentForm, setShowNewCommentForm] = useState(false);
    const [newCommentText, setNewCommentText] = useState("");
    const [pendingResolveThreads, setPendingResolveThreads] = useState<Set<string>>(new Set());
    const [viewMode, setViewMode] = useState<"all" | "cell">("cell");
    const [currentUser, setCurrentUser] = useState<{
        username: string;
        email: string;
        isAuthenticated: boolean;
    }>({
        username: "vscode",
        email: "",
        isAuthenticated: false,
    });
    const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
    const [replyingTo, setReplyingTo] = useState<{ threadId: string; username?: string } | null>(
        null
    );
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [threadTitleEdit, setThreadTitleEdit] = useState<string>("");

    const handleMessage = useCallback(
        (event: MessageEvent) => {
            const message: CommentPostMessages = event.data;
            switch (message.command) {
                case "commentsFromWorkspace": {
                    if (message.content) {
                        console.log("Received comments:", message.content);
                        try {
                            const comments = JSON.parse(message.content);
                            setCommentThread(comments);
                            setPendingResolveThreads(new Set());
                        } catch (error) {
                            console.error("Error parsing comments:", error);
                        }
                    }
                    break;
                }
                case "reload": {
                    console.log("Reload message received:", message.data);
                    if (message.data?.cellId) {
                        setCellId({ cellId: message.data.cellId, uri: message.data.uri || "" });
                        if (viewMode === "cell") {
                            setSearchQuery(message.data.cellId);
                        }
                    }
                    if (message.data?.uri) {
                        setUri(message.data.uri);
                    }
                    break;
                }
                case "updateUserInfo": {
                    if (message.userInfo) {
                        setCurrentUser({
                            username: message.userInfo.username,
                            email: message.userInfo.email,
                            isAuthenticated: true,
                        });
                    } else {
                        setCurrentUser({
                            username: "vscode",
                            email: "",
                            isAuthenticated: false,
                        });
                    }
                    break;
                }
            }
        },
        [viewMode]
    );

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

    const handleReply = (threadId: string) => {
        if (!replyText[threadId]?.trim() || !currentUser.isAuthenticated) return;

        const existingThread = commentThreadArray.find((thread) => thread.id === threadId);
        const newCommentId = existingThread
            ? Math.max(...existingThread.comments.map((c) => c.id)) + 1
            : 1;

        const comment: Comment = {
            id: newCommentId,
            contextValue: "canDelete",
            body: replyText[threadId],
            mode: 1,
            author: { name: currentUser.username },
            deleted: false,
        };

        const updatedThread: NotebookCommentThread = {
            ...(existingThread || {
                id: threadId,
                uri: uri,
                canReply: true,
                cellId: cellId,
                collapsibleState: 0,
                threadTitle: "",
                deleted: false,
                resolved: false,
            }),
            comments: existingThread ? [...existingThread.comments, comment] : [comment],
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: updatedThread,
        } as CommentPostMessages);

        setReplyText((prev) => ({ ...prev, [threadId]: "" }));
        setReplyingTo(null);
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

    const handleUndoCommentDeletion = (commentId: number, commentThreadId: string) => {
        vscode.postMessage({
            command: "undoCommentDeletion",
            args: { commentId, commentThreadId },
        } as CommentPostMessages);
    };

    const handleNewComment = () => {
        if (!newCommentText.trim() || !cellId.cellId || !currentUser.isAuthenticated) return;

        // Generate a timestamp for the default title
        const now = new Date();
        const defaultTitle = now.toLocaleString();

        const newThread: NotebookCommentThread = {
            id: uuidv4(),
            uri: uri,
            canReply: true,
            cellId: cellId,
            collapsibleState: 0,
            threadTitle: defaultTitle,
            deleted: false,
            resolved: false,
            comments: [
                {
                    id: 1,
                    contextValue: "canDelete",
                    body: newCommentText.trim(),
                    mode: 1,
                    author: { name: currentUser.username },
                    deleted: false,
                },
            ],
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: newThread,
        } as CommentPostMessages);

        setNewCommentText("");
        setShowNewCommentForm(false);
    };

    const handleEditThreadTitle = (threadId: string) => {
        if (!threadTitleEdit.trim()) return;

        const existingThread = commentThreadArray.find((thread) => thread.id === threadId);
        if (!existingThread) return;

        const updatedThread = {
            ...existingThread,
            threadTitle: threadTitleEdit.trim(),
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: updatedThread,
        } as CommentPostMessages);

        setEditingTitle(null);
        setThreadTitleEdit("");
    };

    const toggleResolved = (thread: NotebookCommentThread) => {
        setPendingResolveThreads((prev) => {
            const next = new Set(prev);
            next.add(thread.id);
            return next;
        });

        const updatedThread = {
            ...thread,
            resolved: !thread.resolved,
            comments: [...thread.comments],
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: updatedThread,
        } as CommentPostMessages);
    };

    const toggleCollapsed = (threadId: string) => {
        setCollapsedThreads((prev) => ({
            ...prev,
            [threadId]: !prev[threadId],
        }));
    };

    const toggleAllThreads = (collapse: boolean) => {
        const newState: Record<string, boolean> = {};
        filteredCommentThreads.forEach((thread) => {
            newState[thread.id] = collapse;
        });
        setCollapsedThreads(newState);
    };

    const getCellId = (cellId: string) => {
        const parts = cellId.split(":");
        return parts[parts.length - 1] || cellId;
    };

    const filteredCommentThreads = useMemo(() => {
        return commentThreadArray.filter((commentThread) => {
            if (commentThread.deleted) return false;

            // If in cell view mode, only show comments for the current cell
            if (viewMode === "cell" && cellId.cellId) {
                return commentThread.cellId.cellId === cellId.cellId;
            }

            // If searching, filter by search query
            if (searchQuery) {
                return (
                    commentThread.threadTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    commentThread.comments.some((comment) =>
                        comment.body.toLowerCase().includes(searchQuery.toLowerCase())
                    ) ||
                    commentThread.cellId.cellId.toLowerCase().includes(searchQuery.toLowerCase())
                );
            }

            // In all view mode with no search, show all comments
            return true;
        });
    }, [commentThreadArray, searchQuery, viewMode, cellId.cellId]);

    return (
        <div
            style={{
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--vscode-editorWidget-background)",
                color: "var(--vscode-editorWidget-foreground)",
                fontFamily: "var(--vscode-font-family)",
            }}
        >
            {/* Header */}
            <div
                style={{
                    padding: "16px",
                    borderBottom: "1px solid var(--vscode-widget-border)",
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                }}
            >
                {currentUser.isAuthenticated && (
                    <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                        <UserAvatar
                            username={currentUser.username}
                            email={currentUser.email}
                            size="medium"
                        />
                    </div>
                )}

                {/* View mode selector */}
                <div
                    style={{
                        display: "flex",
                        borderRadius: "4px",
                        overflow: "hidden",
                        border: "1px solid var(--vscode-button-background)",
                    }}
                >
                    <button
                        style={{
                            flex: 1,
                            padding: "8px 12px",
                            border: "none",
                            background:
                                viewMode === "all"
                                    ? "var(--vscode-button-background)"
                                    : "transparent",
                            color:
                                viewMode === "all"
                                    ? "var(--vscode-button-foreground)"
                                    : "var(--vscode-foreground)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "13px",
                            fontWeight: 500,
                            transition: "background-color 0.2s",
                        }}
                        onClick={() => {
                            setViewMode("all");
                            setSearchQuery("");
                        }}
                    >
                        All Comments
                    </button>
                    <button
                        style={{
                            flex: 1,
                            padding: "8px 12px",
                            border: "none",
                            background:
                                viewMode === "cell"
                                    ? "var(--vscode-button-background)"
                                    : "transparent",
                            color:
                                viewMode === "cell"
                                    ? "var(--vscode-button-foreground)"
                                    : "var(--vscode-foreground)",
                            cursor: "pointer",
                            fontFamily: "inherit",
                            fontSize: "13px",
                            fontWeight: 500,
                            transition: "background-color 0.2s",
                        }}
                        onClick={() => {
                            setViewMode("cell");
                            setSearchQuery(cellId.cellId);
                        }}
                    >
                        Current Cell
                    </button>
                </div>

                {/* Search */}
                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <VSCodeTextField
                        placeholder={
                            viewMode === "all"
                                ? "Search all comments..."
                                : `Showing comments for ${getCellId(cellId.cellId)}`
                        }
                        value={searchQuery}
                        style={{ flex: 1 }}
                        onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                        disabled={viewMode === "cell"}
                    >
                        <span slot="start" className="codicon codicon-search"></span>
                    </VSCodeTextField>
                </div>

                <div
                    style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                    }}
                >
                    <div
                        style={{
                            fontSize: "13px",
                            color: "var(--vscode-descriptionForeground)",
                            display: "flex",
                            alignItems: "center",
                            gap: "6px",
                        }}
                    >
                        <i className="codicon codicon-comment-discussion"></i>
                        <span>
                            {filteredCommentThreads.length}{" "}
                            {filteredCommentThreads.length === 1 ? "thread" : "threads"}
                        </span>
                    </div>

                    {currentUser.isAuthenticated && (
                        <VSCodeButton
                            appearance="primary"
                            onClick={() => setShowNewCommentForm(true)}
                            style={{ fontWeight: 500 }}
                        >
                            <i
                                className="codicon codicon-comment-add"
                                style={{ marginRight: "6px" }}
                            />
                            New Comment
                        </VSCodeButton>
                    )}
                </div>
            </div>

            {/* New comment form */}
            {showNewCommentForm && (
                <div
                    style={{
                        padding: "16px",
                        borderBottom: "1px solid var(--vscode-widget-border)",
                        backgroundColor: "var(--vscode-editor-inactiveSelectionBackground)",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            alignItems: "center",
                            marginBottom: "12px",
                            gap: "8px",
                        }}
                    >
                        <span style={{ fontSize: "14px", fontWeight: 500 }}>New comment</span>
                        {viewMode === "cell" && (
                            <span
                                style={{
                                    fontSize: "12px",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                            >
                                on {getCellId(cellId.cellId)}
                            </span>
                        )}
                    </div>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "12px",
                        }}
                    >
                        <VSCodeTextField
                            placeholder="What's on your mind?"
                            value={newCommentText}
                            style={{ width: "100%" }}
                            onKeyDown={(e) => {
                                if (e.key === "Enter" && !e.shiftKey) {
                                    e.preventDefault();
                                    handleNewComment();
                                }
                            }}
                            onChange={(e) =>
                                setNewCommentText((e.target as HTMLInputElement).value)
                            }
                        />
                        <div
                            style={{
                                display: "flex",
                                gap: "8px",
                                justifyContent: "flex-end",
                            }}
                        >
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => setShowNewCommentForm(false)}
                            >
                                Cancel
                            </VSCodeButton>
                            <VSCodeButton appearance="primary" onClick={handleNewComment}>
                                Comment
                            </VSCodeButton>
                        </div>
                    </div>
                </div>
            )}

            {/* Empty state for cell view with no comments */}
            {viewMode === "cell" && filteredCommentThreads.length === 0 && cellId.cellId && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "48px 16px",
                        color: "var(--vscode-descriptionForeground)",
                        textAlign: "center",
                        gap: "16px",
                        flex: 1,
                    }}
                >
                    <i
                        className="codicon codicon-comment"
                        style={{ fontSize: "32px", opacity: 0.6 }}
                    ></i>
                    <div>
                        <div style={{ marginBottom: "8px", fontSize: "16px" }}>
                            No comments on this cell
                        </div>
                        <div style={{ fontSize: "13px" }}>
                            Be the first to start a conversation here
                        </div>
                    </div>
                </div>
            )}

            {/* Empty state for all view with no comments */}
            {viewMode === "all" && filteredCommentThreads.length === 0 && searchQuery.length === 0 && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "48px 16px",
                        color: "var(--vscode-descriptionForeground)",
                        textAlign: "center",
                        gap: "16px",
                        flex: 1,
                    }}
                >
                    <i
                        className="codicon codicon-comments"
                        style={{ fontSize: "32px", opacity: 0.6 }}
                    ></i>
                    <div>
                        <div style={{ marginBottom: "8px", fontSize: "16px" }}>No comments yet</div>
                        <div style={{ fontSize: "13px" }}>
                            Start the conversation by adding a comment
                        </div>
                    </div>
                </div>
            )}

            {/* No results for search */}
            {searchQuery.length > 0 && filteredCommentThreads.length === 0 && (
                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        alignItems: "center",
                        justifyContent: "center",
                        padding: "48px 16px",
                        color: "var(--vscode-descriptionForeground)",
                        textAlign: "center",
                        gap: "16px",
                        flex: 1,
                    }}
                >
                    <i
                        className="codicon codicon-search-no-results"
                        style={{ fontSize: "32px", opacity: 0.6 }}
                    ></i>
                    <div>
                        <div style={{ marginBottom: "8px", fontSize: "16px" }}>
                            No results found
                        </div>
                        <div style={{ fontSize: "13px" }}>
                            Try a different search or view all comments
                        </div>
                    </div>
                </div>
            )}

            {/* Comment list */}
            {filteredCommentThreads.length > 0 && (
                <div style={{ flex: 1, overflowY: "auto", padding: "8px" }}>
                    <div style={{ display: "flex", flexDirection: "column", gap: "16px" }}>
                        {filteredCommentThreads.map((thread) => (
                            <div
                                key={thread.id}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    borderRadius: "6px",
                                    overflow: "hidden",
                                    border: "1px solid var(--vscode-widget-border)",
                                    opacity: thread.resolved ? 0.75 : 1,
                                    transition: "opacity 0.2s ease",
                                }}
                            >
                                {/* Thread header */}
                                <div
                                    style={{
                                        padding: "12px 16px",
                                        display: "flex",
                                        flexDirection: "column",
                                        gap: "6px",
                                        backgroundColor:
                                            "var(--vscode-editor-inactiveSelectionBackground)",
                                        cursor: "pointer",
                                        borderBottom: !collapsedThreads[thread.id]
                                            ? "1px solid var(--vscode-widget-border)"
                                            : "none",
                                    }}
                                    onClick={() => toggleCollapsed(thread.id)}
                                >
                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            alignItems: "center",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                flex: 1,
                                                minWidth: 0,
                                            }}
                                        >
                                            <i
                                                className={`codicon codicon-chevron-${
                                                    collapsedThreads[thread.id] ? "right" : "down"
                                                }`}
                                                style={{ fontSize: "14px" }}
                                            />

                                            {editingTitle === thread.id ? (
                                                <VSCodeTextField
                                                    value={threadTitleEdit}
                                                    placeholder="Thread title"
                                                    style={{ flex: 1 }}
                                                    onChange={(e) =>
                                                        setThreadTitleEdit(
                                                            (e.target as HTMLInputElement).value
                                                        )
                                                    }
                                                    onKeyDown={(e) => {
                                                        if (e.key === "Enter") {
                                                            e.preventDefault();
                                                            handleEditThreadTitle(thread.id);
                                                        } else if (e.key === "Escape") {
                                                            setEditingTitle(null);
                                                        }
                                                    }}
                                                />
                                            ) : (
                                                <span
                                                    style={{
                                                        fontWeight: 500,
                                                        fontSize: "14px",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {thread.threadTitle || "Untitled Thread"}
                                                </span>
                                            )}
                                        </div>

                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "6px",
                                                alignItems: "center",
                                            }}
                                        >
                                            {thread.resolved && (
                                                <span
                                                    style={{
                                                        fontSize: "12px",
                                                        padding: "2px 8px",
                                                        borderRadius: "4px",
                                                        backgroundColor:
                                                            "var(--vscode-badge-background)",
                                                        color: "var(--vscode-badge-foreground)",
                                                    }}
                                                >
                                                    Resolved
                                                </span>
                                            )}

                                            {/* Action Buttons */}
                                            {!editingTitle && (
                                                <div style={{ display: "flex", gap: "4px" }}>
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        title="Edit title"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingTitle(thread.id);
                                                            setThreadTitleEdit(
                                                                thread.threadTitle || ""
                                                            );
                                                        }}
                                                    >
                                                        <i className="codicon codicon-edit" />
                                                    </VSCodeButton>
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        title={
                                                            thread.resolved
                                                                ? "Mark as unresolved"
                                                                : "Mark as resolved"
                                                        }
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            toggleResolved(thread);
                                                        }}
                                                        disabled={pendingResolveThreads.has(
                                                            thread.id
                                                        )}
                                                    >
                                                        <i
                                                            className={`codicon codicon-${
                                                                pendingResolveThreads.has(thread.id)
                                                                    ? "loading~spin"
                                                                    : thread.resolved
                                                                    ? "check"
                                                                    : "circle-outline"
                                                            }`}
                                                        />
                                                    </VSCodeButton>
                                                </div>
                                            )}

                                            {/* Edit mode actions */}
                                            {editingTitle === thread.id && (
                                                <div style={{ display: "flex", gap: "8px" }}>
                                                    <VSCodeButton
                                                        appearance="secondary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingTitle(null);
                                                        }}
                                                    >
                                                        Cancel
                                                    </VSCodeButton>
                                                    <VSCodeButton
                                                        appearance="primary"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleEditThreadTitle(thread.id);
                                                        }}
                                                    >
                                                        Save
                                                    </VSCodeButton>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div
                                        style={{
                                            display: "flex",
                                            justifyContent: "space-between",
                                            fontSize: "12px",
                                            color: "var(--vscode-descriptionForeground)",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                gap: "8px",
                                                alignItems: "center",
                                            }}
                                        >
                                            <span
                                                style={{
                                                    color: "var(--vscode-textLink-foreground)",
                                                    maxWidth: "200px",
                                                    overflow: "hidden",
                                                    textOverflow: "ellipsis",
                                                    whiteSpace: "nowrap",
                                                }}
                                                title={thread.cellId.cellId}
                                            >
                                                {getCellId(thread.cellId.cellId)}
                                            </span>
                                        </div>
                                        <span>
                                            {thread.comments.length}{" "}
                                            {thread.comments.length === 1 ? "comment" : "comments"}
                                        </span>
                                    </div>
                                </div>

                                {/* Comments section */}
                                {!collapsedThreads[thread.id] && (
                                    <div
                                        style={{
                                            padding: "16px",
                                            display: "flex",
                                            flexDirection: "column",
                                            gap: "16px",
                                        }}
                                    >
                                        {/* Comments */}
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "16px",
                                            }}
                                        >
                                            {thread.comments.map((comment, index) => (
                                                <div
                                                    key={comment.id}
                                                    style={{
                                                        display: "flex",
                                                        gap: "12px",
                                                        opacity: comment.deleted ? 0.6 : 1,
                                                    }}
                                                >
                                                    <UserAvatar
                                                        username={comment.author.name}
                                                        size="medium"
                                                    />

                                                    <div
                                                        style={{
                                                            flex: 1,
                                                            display: "flex",
                                                            flexDirection: "column",
                                                            gap: "6px",
                                                        }}
                                                    >
                                                        <div
                                                            style={{
                                                                display: "flex",
                                                                justifyContent: "space-between",
                                                            }}
                                                        >
                                                            <div style={{ fontWeight: 500 }}>
                                                                {comment.author.name}
                                                            </div>

                                                            {!comment.deleted &&
                                                                comment.author.name ===
                                                                    currentUser.username && (
                                                                    <div
                                                                        style={{
                                                                            display: "flex",
                                                                            gap: "8px",
                                                                        }}
                                                                    >
                                                                        <VSCodeButton
                                                                            appearance="icon"
                                                                            onClick={() =>
                                                                                handleCommentDeletion(
                                                                                    comment.id,
                                                                                    thread.id
                                                                                )
                                                                            }
                                                                            title="Delete comment"
                                                                        >
                                                                            <i className="codicon codicon-trash" />
                                                                        </VSCodeButton>
                                                                    </div>
                                                                )}

                                                            {comment.deleted &&
                                                                comment.author.name ===
                                                                    currentUser.username && (
                                                                    <VSCodeButton
                                                                        appearance="icon"
                                                                        onClick={() =>
                                                                            handleUndoCommentDeletion(
                                                                                comment.id,
                                                                                thread.id
                                                                            )
                                                                        }
                                                                        title="Undo deletion"
                                                                    >
                                                                        <i className="codicon codicon-discard" />
                                                                    </VSCodeButton>
                                                                )}
                                                        </div>

                                                        <div
                                                            style={{
                                                                fontSize: "14px",
                                                                lineHeight: "1.5",
                                                                wordBreak: "break-word",
                                                                color: comment.deleted
                                                                    ? "var(--vscode-descriptionForeground)"
                                                                    : "inherit",
                                                            }}
                                                        >
                                                            {comment.deleted ? (
                                                                <i>This comment has been deleted</i>
                                                            ) : (
                                                                comment.body
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}
                                        </div>

                                        {/* Reply form */}
                                        {currentUser.isAuthenticated && (
                                            <div
                                                style={{
                                                    display: "flex",
                                                    gap: "12px",
                                                    alignItems: "flex-start",
                                                    marginTop: "8px",
                                                    borderTop:
                                                        "1px solid var(--vscode-widget-border)",
                                                    paddingTop: "16px",
                                                }}
                                            >
                                                <UserAvatar
                                                    username={currentUser.username}
                                                    email={currentUser.email}
                                                    size="medium"
                                                />

                                                <div
                                                    style={{
                                                        flex: 1,
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: "8px",
                                                    }}
                                                >
                                                    <VSCodeTextField
                                                        placeholder={
                                                            replyingTo?.username &&
                                                            replyingTo.threadId === thread.id
                                                                ? `Reply to ${replyingTo.username}...`
                                                                : "Add a reply..."
                                                        }
                                                        value={replyText[thread.id] || ""}
                                                        style={{ width: "100%" }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === "Enter" && !e.shiftKey) {
                                                                e.preventDefault();
                                                                handleReply(thread.id);
                                                            } else if (e.key === "Escape") {
                                                                setReplyingTo(null);
                                                            }
                                                        }}
                                                        onChange={(e) => {
                                                            const value = (
                                                                e.target as HTMLInputElement
                                                            ).value;
                                                            setReplyText((prev) => ({
                                                                ...prev,
                                                                [thread.id]:
                                                                    replyingTo?.username &&
                                                                    replyingTo.threadId ===
                                                                        thread.id
                                                                        ? value
                                                                        : value,
                                                            }));
                                                        }}
                                                    />

                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "center",
                                                        }}
                                                    >
                                                        {replyingTo?.threadId === thread.id && (
                                                            <div
                                                                style={{
                                                                    fontSize: "12px",
                                                                    color: "var(--vscode-textLink-foreground)",
                                                                }}
                                                            >
                                                                Replying to @{replyingTo.username}
                                                                <VSCodeButton
                                                                    appearance="icon"
                                                                    onClick={() =>
                                                                        setReplyingTo(null)
                                                                    }
                                                                    style={{ padding: "0 4px" }}
                                                                >
                                                                    <i
                                                                        className="codicon codicon-close"
                                                                        style={{ fontSize: "10px" }}
                                                                    />
                                                                </VSCodeButton>
                                                            </div>
                                                        )}

                                                        <VSCodeButton
                                                            appearance="primary"
                                                            onClick={() => handleReply(thread.id)}
                                                            disabled={!replyText[thread.id]?.trim()}
                                                        >
                                                            Reply
                                                        </VSCodeButton>
                                                    </div>
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
}

export default App;
