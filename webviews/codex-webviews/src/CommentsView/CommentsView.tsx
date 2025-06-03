import { useState, useEffect, useCallback, useMemo } from "react";
import {
    MessageSquare,
    Search,
    Plus,
    ChevronRight,
    ChevronDown,
    Edit,
    Check,
    Circle,
    X,
    Trash2,
    Undo2,
    Send,
    Reply,
    Eye,
    EyeOff,
    ChevronUp,
    Clock,
    MoreHorizontal,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/card";
import { Badge } from "../components/ui/badge";
import { Input } from "../components/ui/input";
import { NotebookCommentThread, CommentPostMessages, CellIdGlobalState } from "../../../../types";
import { v4 as uuidv4 } from "uuid";
import { WebviewHeader } from "../components/WebviewHeader";

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
            className="flex items-center gap-2 relative"
            title={email ? `${username} (${email})` : username}
        >
            <div
                className="rounded-full bg-primary text-primary-foreground flex items-center justify-center font-medium"
                style={sizeMap[size]}
            >
                {username[0].toUpperCase()}
            </div>
            <div className="flex flex-col gap-0.5">
                <span className="font-medium">{username}</span>
                {timestamp && <span className="text-xs text-muted-foreground">{timestamp}</span>}
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
    const [showResolvedThreads, setShowResolvedThreads] = useState(false);
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
        const finalPart = parts[parts.length - 1] || cellId;
        // Show full cell ID if it's less than 10 characters
        return cellId.length < 10 ? cellId : finalPart;
    };

    const filteredCommentThreads = useMemo(() => {
        // First, get all non-deleted threads
        const nonDeletedThreads = commentThreadArray.filter((thread) => !thread.deleted);

        // Then, apply additional filtering based on view mode, search, and resolved status
        return nonDeletedThreads.filter((commentThread) => {
            // Skip resolved threads if they're hidden
            if (!showResolvedThreads && commentThread.resolved) return false;

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

            // In all view mode with no search, show all comments (except resolved ones if hidden)
            return true;
        });
    }, [commentThreadArray, searchQuery, viewMode, cellId.cellId, showResolvedThreads]);

    // Count of hidden resolved threads
    const hiddenResolvedThreadsCount = useMemo(() => {
        if (showResolvedThreads) return 0;

        const nonDeletedThreads = commentThreadArray.filter((thread) => !thread.deleted);

        return nonDeletedThreads.filter((thread) => {
            const isResolved = thread.resolved;
            const matchesCurrentCell =
                viewMode !== "cell" || thread.cellId.cellId === cellId.cellId;
            const matchesSearch =
                !searchQuery ||
                thread.threadTitle?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                thread.comments.some((comment) =>
                    comment.body.toLowerCase().includes(searchQuery.toLowerCase())
                ) ||
                thread.cellId.cellId.toLowerCase().includes(searchQuery.toLowerCase());

            return isResolved && matchesCurrentCell && matchesSearch;
        }).length;
    }, [commentThreadArray, viewMode, cellId.cellId, searchQuery, showResolvedThreads]);

    return (
        <div className="h-full w-full flex flex-col bg-background text-foreground font-sans relative">
            <WebviewHeader title="Comments" vscode={vscode} />

            {/* Header */}
            <div className="p-4 border-b border-border flex flex-col gap-3">
                {currentUser.isAuthenticated && (
                    <div className="flex items-center gap-2">
                        <UserAvatar
                            username={currentUser.username}
                            email={currentUser.email}
                            size="medium"
                        />
                    </div>
                )}

                {/* View mode selector */}
                <div className="flex rounded border border-border overflow-hidden">
                    <Button
                        variant={viewMode === "all" ? "default" : "ghost"}
                        className="flex-1 rounded-none"
                        onClick={() => {
                            setViewMode("all");
                            setSearchQuery("");
                        }}
                    >
                        All Comments
                    </Button>
                    <Button
                        variant={viewMode === "cell" ? "default" : "ghost"}
                        className="flex-1 rounded-none"
                        onClick={() => {
                            setViewMode("cell");
                            setSearchQuery(cellId.cellId);
                        }}
                    >
                        Current Cell
                    </Button>
                </div>

                {/* Search */}
                <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                        <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                        <Input
                            placeholder={
                                viewMode === "all"
                                    ? "Search all comments..."
                                    : `Showing comments for ${getCellId(cellId.cellId)}`
                            }
                            value={searchQuery}
                            className="pl-10"
                            onChange={(e) => setSearchQuery(e.target.value)}
                            disabled={viewMode === "cell"}
                        />
                    </div>
                </div>

                <div className="flex justify-between items-center">
                    <div className="text-sm text-muted-foreground flex items-center gap-1.5">
                        <MessageSquare className="h-4 w-4" />
                        <span>
                            {filteredCommentThreads.length}{" "}
                            {filteredCommentThreads.length === 1 ? "thread" : "threads"}
                        </span>
                    </div>

                    {currentUser.isAuthenticated && (
                        <Button onClick={() => setShowNewCommentForm(true)} className="font-medium">
                            <Plus className="h-4 w-4 mr-1.5" />
                            Comment
                        </Button>
                    )}
                </div>
            </div>

            {/* New comment form */}
            {showNewCommentForm && (
                <Card className="m-4 bg-muted/50">
                    <CardContent className="pt-6">
                        <div className="flex items-center mb-3 gap-2">
                            <MessageSquare className="h-4 w-4" />
                            <span className="text-sm font-medium">New comment</span>
                            {viewMode === "cell" && (
                                <span className="text-xs text-muted-foreground">
                                    on {getCellId(cellId.cellId)}
                                </span>
                            )}
                        </div>
                        <div className="flex flex-col gap-3">
                            <Input
                                placeholder="What do you want to say?"
                                value={newCommentText}
                                onKeyDown={(e) => {
                                    if (e.key === "Enter" && !e.shiftKey) {
                                        e.preventDefault();
                                        handleNewComment();
                                    }
                                }}
                                onChange={(e) => setNewCommentText(e.target.value)}
                            />
                            <div className="flex gap-2 justify-end">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => setShowNewCommentForm(false)}
                                >
                                    <X className="h-4 w-4" />
                                </Button>
                                <Button size="sm" onClick={handleNewComment}>
                                    <MessageSquare className="h-4 w-4 mr-1.5" />
                                    Send
                                </Button>
                            </div>
                        </div>
                    </CardContent>
                </Card>
            )}

            {/* Empty states */}
            {filteredCommentThreads.length === 0 && (
                <div className="flex flex-col items-center justify-center p-12 text-muted-foreground text-center gap-4 flex-1">
                    {viewMode === "cell" && cellId.cellId ? (
                        <>
                            <MessageSquare className="h-8 w-8 opacity-60" />
                            <div>
                                <div className="mb-2 text-base">No comments on this cell</div>
                                <div className="text-sm">
                                    Be the first to start a conversation here
                                </div>
                            </div>
                        </>
                    ) : searchQuery.length > 0 ? (
                        <>
                            <Search className="h-8 w-8 opacity-60" />
                            <div>
                                <div className="mb-2 text-base">No results found</div>
                                <div className="text-sm">
                                    Try a different search or view all comments
                                </div>
                            </div>
                        </>
                    ) : (
                        <>
                            <MessageSquare className="h-8 w-8 opacity-60" />
                            <div>
                                <div className="mb-2 text-base">No comments yet</div>
                                <div className="text-sm">
                                    Start the conversation by adding a comment
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

            {/* Comment list */}
            {filteredCommentThreads.length > 0 && (
                <div className="flex-1 overflow-y-auto p-2">
                    <div className="flex flex-col gap-4">
                        {filteredCommentThreads.map((thread) => (
                            <Card
                                key={thread.id}
                                className={`overflow-hidden border transition-opacity duration-200 ${
                                    thread.resolved ? "opacity-75" : "opacity-100"
                                }`}
                            >
                                {/* Thread header */}
                                <CardHeader
                                    className="cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors"
                                    onClick={() => toggleCollapsed(thread.id)}
                                >
                                    <div className="flex justify-between items-center">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            {collapsedThreads[thread.id] ? (
                                                <ChevronRight className="h-4 w-4" />
                                            ) : (
                                                <ChevronDown className="h-4 w-4" />
                                            )}

                                            {editingTitle === thread.id ? (
                                                <Input
                                                    value={threadTitleEdit}
                                                    placeholder="Thread title"
                                                    className="flex-1"
                                                    onChange={(e) =>
                                                        setThreadTitleEdit(e.target.value)
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
                                                <span className="font-medium text-sm truncate">
                                                    {thread.threadTitle || "Untitled Thread"}
                                                </span>
                                            )}
                                        </div>

                                        <div className="flex gap-1.5 items-center">
                                            {thread.resolved && (
                                                <Badge variant="secondary" className="text-xs">
                                                    <Check className="h-3 w-3 mr-1" />
                                                    Resolved
                                                </Badge>
                                            )}

                                            {/* Action Buttons */}
                                            {!editingTitle && (
                                                <div className="flex gap-1">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
                                                        title="Edit title"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingTitle(thread.id);
                                                            setThreadTitleEdit(
                                                                thread.threadTitle || ""
                                                            );
                                                        }}
                                                    >
                                                        <Edit className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
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
                                                        {pendingResolveThreads.has(thread.id) ? (
                                                            <Clock className="h-4 w-4 animate-spin" />
                                                        ) : thread.resolved ? (
                                                            <Check className="h-4 w-4" />
                                                        ) : (
                                                            <Circle className="h-4 w-4" />
                                                        )}
                                                    </Button>
                                                </div>
                                            )}

                                            {/* Edit mode actions */}
                                            {editingTitle === thread.id && (
                                                <div className="flex gap-2">
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
                                                        title="Cancel"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            setEditingTitle(null);
                                                        }}
                                                    >
                                                        <X className="h-4 w-4" />
                                                    </Button>
                                                    <Button
                                                        variant="ghost"
                                                        size="sm"
                                                        className="h-8 w-8 p-0"
                                                        title="Save"
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleEditThreadTitle(thread.id);
                                                        }}
                                                    >
                                                        <Check className="h-4 w-4" />
                                                    </Button>
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    <div className="flex justify-between text-xs text-muted-foreground">
                                        <div className="flex gap-2 items-center">
                                            <span
                                                className="text-primary max-w-48 truncate"
                                                title={thread.cellId.cellId}
                                            >
                                                {getCellId(thread.cellId.cellId)}
                                            </span>
                                        </div>
                                        <span className="flex items-center gap-1">
                                            <MessageSquare className="h-3 w-3" />
                                            {thread.comments.length}{" "}
                                            {thread.comments.length === 1 ? "comment" : "comments"}
                                        </span>
                                    </div>
                                </CardHeader>

                                {/* Comments section */}
                                {!collapsedThreads[thread.id] && (
                                    <CardContent className="p-4">
                                        <div className="flex flex-col gap-4">
                                            {/* Comments */}
                                            <div className="flex flex-col gap-4">
                                                {thread.comments.map((comment, index) => (
                                                    <div
                                                        key={comment.id}
                                                        className={`flex gap-3 ${
                                                            comment.deleted ? "opacity-60" : ""
                                                        }`}
                                                    >
                                                        <UserAvatar
                                                            username={comment.author.name}
                                                            size="medium"
                                                        />

                                                        <div className="flex-1 flex flex-col gap-1.5">
                                                            <div className="flex justify-between">
                                                                <div className="font-medium">
                                                                    {comment.author.name}
                                                                </div>

                                                                {!comment.deleted &&
                                                                    comment.author.name ===
                                                                        currentUser.username && (
                                                                        <div className="flex gap-2">
                                                                            <Button
                                                                                variant="ghost"
                                                                                size="sm"
                                                                                className="h-8 w-8 p-0"
                                                                                onClick={() =>
                                                                                    handleCommentDeletion(
                                                                                        comment.id,
                                                                                        thread.id
                                                                                    )
                                                                                }
                                                                                title="Delete comment"
                                                                            >
                                                                                <Trash2 className="h-4 w-4" />
                                                                            </Button>
                                                                        </div>
                                                                    )}

                                                                {comment.deleted &&
                                                                    comment.author.name ===
                                                                        currentUser.username && (
                                                                        <Button
                                                                            variant="ghost"
                                                                            size="sm"
                                                                            className="h-8 w-8 p-0"
                                                                            onClick={() =>
                                                                                handleUndoCommentDeletion(
                                                                                    comment.id,
                                                                                    thread.id
                                                                                )
                                                                            }
                                                                            title="Undo deletion"
                                                                        >
                                                                            <Undo2 className="h-4 w-4" />
                                                                        </Button>
                                                                    )}
                                                            </div>

                                                            <div
                                                                className={`text-sm leading-relaxed break-words ${
                                                                    comment.deleted
                                                                        ? "text-muted-foreground italic"
                                                                        : ""
                                                                }`}
                                                            >
                                                                {comment.deleted
                                                                    ? "This comment has been deleted"
                                                                    : comment.body}
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* Reply form */}
                                            {currentUser.isAuthenticated && (
                                                <div className="flex gap-3 items-start mt-2 border-t border-border pt-4">
                                                    <UserAvatar
                                                        username={currentUser.username}
                                                        email={currentUser.email}
                                                        size="medium"
                                                    />

                                                    <div className="flex-1 flex flex-col gap-2">
                                                        <Input
                                                            placeholder="Add a reply..."
                                                            value={replyText[thread.id] || ""}
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
                                                                const value = e.target.value;
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

                                                        <div className="flex justify-between items-center">
                                                            {replyingTo?.threadId === thread.id && (
                                                                <div className="text-xs text-primary flex items-center gap-1">
                                                                    <Reply className="h-3 w-3" />
                                                                    Replying to @
                                                                    {replyingTo.username}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="h-6 w-6 p-0"
                                                                        onClick={() =>
                                                                            setReplyingTo(null)
                                                                        }
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                            )}

                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-8 w-8 p-0 ml-auto"
                                                                onClick={() =>
                                                                    handleReply(thread.id)
                                                                }
                                                                title="Send reply"
                                                            >
                                                                <Send className="h-4 w-4" />
                                                            </Button>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </CardContent>
                                )}
                            </Card>
                        ))}
                    </div>
                </div>
            )}

            {/* Resolved threads banner */}
            {hiddenResolvedThreadsCount > 0 && (
                <div
                    className="sticky bottom-0 left-0 right-0 p-2 px-4 bg-primary text-primary-foreground flex justify-between items-center cursor-pointer border-t border-border text-sm z-10"
                    onClick={() => setShowResolvedThreads(true)}
                >
                    <div className="flex items-center gap-2">
                        <Eye className="h-4 w-4" />
                        <span>
                            {hiddenResolvedThreadsCount} resolved{" "}
                            {hiddenResolvedThreadsCount === 1 ? "thread" : "threads"} hidden
                        </span>
                    </div>
                    <ChevronUp className="h-4 w-4" />
                </div>
            )}

            {/* Hide resolved threads button (when they're visible) */}
            {showResolvedThreads &&
                commentThreadArray.some((thread) => !thread.deleted && thread.resolved) && (
                    <div
                        className="sticky bottom-0 left-0 right-0 p-2 px-4 bg-primary text-primary-foreground flex justify-between items-center cursor-pointer border-t border-border text-sm z-10"
                        onClick={() => setShowResolvedThreads(false)}
                    >
                        <div className="flex items-center gap-2">
                            <EyeOff className="h-4 w-4" />
                            <span>Hide resolved threads</span>
                        </div>
                        <ChevronDown className="h-4 w-4" />
                    </div>
                )}
        </div>
    );
}

export default App;
