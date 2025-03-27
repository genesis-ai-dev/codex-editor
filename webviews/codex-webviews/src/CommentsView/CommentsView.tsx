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
    const [showNewThreadForm, setShowNewThreadForm] = useState(false);
    const [newThreadTitle, setNewThreadTitle] = useState("");
    const [pendingResolveThreads, setPendingResolveThreads] = useState<Set<string>>(new Set());
    const [isLocked, setIsLocked] = useState(true);
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
                        setCellId({ cellId: message.data.cellId, uri: message.data.uri });
                        if (isLocked) {
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
        [isLocked]
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

    const handleNewThread = () => {
        if (!newThreadTitle.trim() || !cellId.cellId || !currentUser.isAuthenticated) return;

        const newThread: NotebookCommentThread = {
            id: uuidv4(),
            uri: uri,
            canReply: true,
            cellId: cellId,
            collapsibleState: 0,
            threadTitle: newThreadTitle.trim(),
            deleted: false,
            resolved: false,
            comments: [],
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: newThread,
        } as CommentPostMessages);

        setNewThreadTitle("");
        setShowNewThreadForm(false);
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

    const getCellId = (cellId: string) => {
        const parts = cellId.split(":");
        return parts[parts.length - 1] || cellId;
    };

    const filteredCommentThreads = useMemo(() => {
        return commentThreadArray.filter((commentThread) => {
            if (commentThread.deleted) return false;

            return (
                searchQuery.toLowerCase() === "" ||
                commentThread.threadTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                commentThread.comments.some((comment) =>
                    comment.body.toLowerCase().includes(searchQuery.toLowerCase())
                ) ||
                commentThread.cellId.cellId.toLowerCase().includes(searchQuery.toLowerCase())
            );
        });
    }, [commentThreadArray, searchQuery]);

    return (
        <div
            style={{
                height: "100%",
                width: "100%",
                display: "flex",
                flexDirection: "column",
                backgroundColor: "var(--vscode-editorWidget-background)",
                color: "var(--vscode-editorWidget-foreground)",
            }}
        >
            <div style={{ padding: "10px", display: "flex", flexDirection: "column", gap: "8px" }}>
                {currentUser.isAuthenticated && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            padding: "8px",
                            backgroundColor: "var(--vscode-list-hoverBackground)",
                            borderRadius: "4px",
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                            <i className="codicon codicon-account"></i>
                            <span>{currentUser.username}</span>
                        </div>
                        {currentUser.email && (
                            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                                <i className="codicon codicon-mail"></i>
                                <span>{currentUser.email}</span>
                            </div>
                        )}
                    </div>
                )}

                <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
                    <VSCodeTextField
                        placeholder="Search comments..."
                        value={searchQuery}
                        style={{ flex: 1 }}
                        onChange={(e) => setSearchQuery((e.target as HTMLInputElement).value)}
                    >
                        <span slot="start" className="codicon codicon-search"></span>
                    </VSCodeTextField>
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => setIsLocked(!isLocked)}
                        title={isLocked ? "Unlock from current cell" : "Lock to current cell"}
                    >
                        <i className={`codicon codicon-${isLocked ? "lock" : "unlock"}`} />
                    </VSCodeButton>
                </div>

                {/* {cellId.cellId && (
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            gap: "4px",
                            padding: "8px",
                            backgroundColor: "var(--vscode-list-hoverBackground)",
                            borderRadius: "4px",
                            fontSize: "12px",
                        }}
                    >
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                color: "var(--vscode-descriptionForeground)",
                            }}
                        >
                            <i className="codicon codicon-location"></i>
                            <span>Current Cell</span>
                        </div>
                        <div
                            style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                                fontFamily: "var(--vscode-editor-font-family)",
                            }}
                        >
                            <span
                                style={{
                                    color: "var(--vscode-textLink-foreground)",
                                    wordBreak: "break-all",
                                }}
                            >
                                {cellId.cellId}
                            </span>
                            <VSCodeBadge
                                style={{
                                    padding: "2px 6px",
                                    backgroundColor: "var(--vscode-badge-background)",
                                    color: "var(--vscode-badge-foreground)",
                                    borderRadius: "4px",
                                    fontSize: "11px",
                                    flexShrink: 0,
                                }}
                            >
                                {getCellId(cellId.cellId)}
                            </VSCodeBadge>
                        </div>
                    </div>
                )} */}

                {showNewThreadForm && (
                    <div style={{ display: "flex", gap: "8px", alignItems: "flex-start" }}>
                        <UserAvatar username={currentUser.username} email={currentUser.email} />
                        <div
                            style={{
                                flex: 1,
                                display: "flex",
                                flexDirection: "column",
                                gap: "8px",
                            }}
                        >
                            <VSCodeTextField
                                placeholder="New thread title..."
                                value={newThreadTitle}
                                style={{ width: "100%" }}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleNewThread();
                                    }
                                }}
                                onChange={(e) =>
                                    setNewThreadTitle((e.target as HTMLInputElement).value)
                                }
                            />
                            <div
                                style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}
                            >
                                <VSCodeButton
                                    appearance="secondary"
                                    onClick={() => setShowNewThreadForm(false)}
                                >
                                    Cancel
                                </VSCodeButton>
                                <VSCodeButton appearance="primary" onClick={handleNewThread}>
                                    Add Thread
                                </VSCodeButton>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            <div
                style={{
                    flex: 1,
                    overflowY: "auto",
                    padding: "0 10px 10px 10px",
                }}
            >
                {filteredCommentThreads.length === 0 ? (
                    <div
                        style={{
                            textAlign: "center",
                            padding: "2rem",
                            color: "var(--vscode-descriptionForeground)",
                        }}
                    >
                        No comments found
                    </div>
                ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                        {filteredCommentThreads.map((thread) => (
                            <div
                                key={thread.id}
                                style={{
                                    backgroundColor: "var(--vscode-dropdown-background)",
                                    border: "1px solid var(--vscode-widget-border)",
                                    borderRadius: "4px",
                                    opacity: thread.resolved ? 0.7 : 1,
                                }}
                            >
                                <div
                                    style={{
                                        padding: "8px",
                                        display: "flex",
                                        alignItems: "center",
                                        justifyContent: "space-between",
                                        cursor: "pointer",
                                        borderBottom: !collapsedThreads[thread.id]
                                            ? "1px solid var(--vscode-widget-border)"
                                            : "none",
                                        backgroundColor: expandedThreads.has(thread.id)
                                            ? "var(--vscode-list-activeSelectionBackground)"
                                            : "transparent",
                                    }}
                                    onClick={() => toggleCollapsed(thread.id)}
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
                                        />
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "4px",
                                                flex: 1,
                                                minWidth: 0,
                                            }}
                                        >
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        fontWeight: 500,
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {thread.threadTitle || "Untitled Thread"}
                                                </span>
                                                <span
                                                    style={{
                                                        fontSize: "12px",
                                                        color: "var(--vscode-descriptionForeground)",
                                                    }}
                                                >
                                                    {thread.comments.length}{" "}
                                                    {thread.comments.length === 1
                                                        ? "comment"
                                                        : "comments"}
                                                </span>
                                            </div>
                                            <div
                                                style={{
                                                    display: "flex",
                                                    alignItems: "center",
                                                    gap: "8px",
                                                    fontSize: "12px",
                                                }}
                                            >
                                                <span
                                                    style={{
                                                        color: "var(--vscode-textLink-foreground)",
                                                        fontFamily:
                                                            "var(--vscode-editor-font-family)",
                                                        overflow: "hidden",
                                                        textOverflow: "ellipsis",
                                                        whiteSpace: "nowrap",
                                                    }}
                                                >
                                                    {thread.cellId.cellId}
                                                </span>
                                                <VSCodeBadge
                                                    style={{
                                                        padding: "2px 6px",
                                                        backgroundColor:
                                                            "var(--vscode-badge-background)",
                                                        color: "var(--vscode-badge-foreground)",
                                                        borderRadius: "4px",
                                                        fontSize: "11px",
                                                        flexShrink: 0,
                                                    }}
                                                >
                                                    {getCellId(thread.cellId.cellId)}
                                                </VSCodeBadge>
                                            </div>
                                        </div>
                                        {thread.resolved && <VSCodeBadge>Resolved</VSCodeBadge>}
                                    </div>
                                    <div style={{ display: "flex", gap: "4px" }}>
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                toggleResolved(thread);
                                            }}
                                            disabled={pendingResolveThreads.has(thread.id)}
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
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleThreadDeletion(thread.id);
                                            }}
                                        >
                                            <i className="codicon codicon-trash" />
                                        </VSCodeButton>
                                    </div>
                                </div>

                                {!collapsedThreads[thread.id] && (
                                    <div
                                        style={{
                                            padding: "8px",
                                            backgroundColor: expandedThreads.has(thread.id)
                                                ? "var(--vscode-list-activeSelectionBackground)"
                                                : "transparent",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                flexDirection: "column",
                                                gap: "12px",
                                            }}
                                        >
                                            {thread.comments.map((comment, index) => (
                                                <div
                                                    key={comment.id}
                                                    style={{
                                                        display: "flex",
                                                        flexDirection: "column",
                                                        gap: "8px",
                                                        position: "relative",
                                                        paddingLeft: "16px",
                                                        opacity: comment.deleted ? 0.6 : 1,
                                                    }}
                                                >
                                                    {/* Thread line indicator */}
                                                    {index < thread.comments.length - 1 && (
                                                        <div
                                                            style={{
                                                                position: "absolute",
                                                                left: "12px",
                                                                top: "32px",
                                                                bottom: "-20px",
                                                                width: "2px",
                                                                backgroundColor:
                                                                    "var(--vscode-widget-border)",
                                                            }}
                                                        />
                                                    )}

                                                    <div
                                                        style={{
                                                            display: "flex",
                                                            justifyContent: "space-between",
                                                            alignItems: "flex-start",
                                                            gap: "8px",
                                                        }}
                                                    >
                                                        <UserAvatar
                                                            username={comment.author.name}
                                                            size="small"
                                                            timestamp="Just now" // TODO: Add actual timestamps
                                                        />
                                                        <div
                                                            style={{ display: "flex", gap: "4px" }}
                                                        >
                                                            {comment.deleted ? (
                                                                // Show undo button only for the comment author
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
                                                                )
                                                            ) : (
                                                                <>
                                                                    <VSCodeButton
                                                                        appearance="icon"
                                                                        onClick={() => {
                                                                            setReplyingTo({
                                                                                threadId: thread.id,
                                                                                username:
                                                                                    comment.author
                                                                                        .name,
                                                                            });
                                                                        }}
                                                                    >
                                                                        <i className="codicon codicon-reply" />
                                                                    </VSCodeButton>
                                                                    {comment.author.name ===
                                                                        currentUser.username && (
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
                                                                    )}
                                                                </>
                                                            )}
                                                        </div>
                                                    </div>
                                                    <div
                                                        style={{
                                                            paddingLeft: "32px",
                                                            wordBreak: "break-word",
                                                            fontSize: "13px",
                                                            lineHeight: "1.4",
                                                            color: comment.deleted
                                                                ? "var(--vscode-descriptionForeground)"
                                                                : "inherit",
                                                        }}
                                                    >
                                                        {comment.deleted ? (
                                                            <i>This comment has been deleted</i>
                                                        ) : replyingTo?.username &&
                                                          comment.body.startsWith(
                                                              `@${replyingTo.username}`
                                                          ) ? (
                                                            <>
                                                                <span
                                                                    style={{
                                                                        color: "var(--vscode-textLink-foreground)",
                                                                        marginRight: "4px",
                                                                    }}
                                                                >
                                                                    @{replyingTo.username}
                                                                </span>
                                                                {comment.body.slice(
                                                                    replyingTo.username.length + 1
                                                                )}
                                                            </>
                                                        ) : (
                                                            comment.body
                                                        )}
                                                    </div>
                                                </div>
                                            ))}

                                            {/* Reply section */}
                                            {currentUser.isAuthenticated && (
                                                <div
                                                    style={{
                                                        display: "flex",
                                                        gap: "8px",
                                                        alignItems: "flex-start",
                                                        backgroundColor:
                                                            "var(--vscode-list-hoverBackground)",
                                                        padding: "8px",
                                                        borderRadius: "4px",
                                                        marginTop: "4px",
                                                        marginLeft: "16px",
                                                    }}
                                                >
                                                    <UserAvatar
                                                        username={currentUser.username}
                                                        email={currentUser.email}
                                                        size="small"
                                                    />
                                                    <div
                                                        style={{
                                                            flex: 1,
                                                            display: "flex",
                                                            gap: "8px",
                                                        }}
                                                    >
                                                        <VSCodeTextField
                                                            placeholder={
                                                                replyingTo?.username
                                                                    ? `Reply to @${replyingTo.username}...`
                                                                    : "Add a reply..."
                                                            }
                                                            value={replyText[thread.id] || ""}
                                                            style={{ flex: 1 }}
                                                            onKeyDown={(e) => {
                                                                if (
                                                                    e.key === "Enter" &&
                                                                    !e.shiftKey
                                                                ) {
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
                                                                        replyingTo?.username
                                                                            ? `@${replyingTo.username} ${value}`
                                                                            : value,
                                                                }));
                                                            }}
                                                        />
                                                        <div
                                                            style={{ display: "flex", gap: "4px" }}
                                                        >
                                                            {replyingTo && (
                                                                <VSCodeButton
                                                                    appearance="icon"
                                                                    onClick={() =>
                                                                        setReplyingTo(null)
                                                                    }
                                                                >
                                                                    <i className="codicon codicon-close" />
                                                                </VSCodeButton>
                                                            )}
                                                            <VSCodeButton
                                                                appearance="icon"
                                                                onClick={() =>
                                                                    handleReply(thread.id)
                                                                }
                                                            >
                                                                <i className="codicon codicon-send" />
                                                            </VSCodeButton>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {currentUser.isAuthenticated && !showNewThreadForm && (
                <div
                    style={{
                        padding: "10px",
                        borderTop: "1px solid var(--vscode-widget-border)",
                        display: "flex",
                        justifyContent: "center",
                    }}
                >
                    <VSCodeButton appearance="icon" onClick={() => setShowNewThreadForm(true)}>
                        <i className="codicon codicon-plus" />
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
}

export default App;
