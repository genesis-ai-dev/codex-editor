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
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";

const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];

interface UserAvatar {
    username: string;
    email?: string;
    size?: "small" | "medium" | "large";
}

// Helper function to generate deterministic colors for usernames
const getUserColor = (username: string): string => {
    // Distinct, readable colors for avatars (using actual color values)
    const colors = [
        "#3b82f6", // blue-500
        "#10b981", // emerald-500
        "#8b5cf6", // violet-500
        "#f59e0b", // amber-500
        "#ec4899", // pink-500
        "#06b6d4", // cyan-500
        "#ef4444", // red-500
        "#6366f1", // indigo-500
        "#14b8a6", // teal-500
        "#84cc16", // lime-500
        "#f97316", // orange-500
        "#a855f7", // purple-500
        "#f43f5e", // rose-500
        "#0ea5e9", // sky-500
        "#22c55e", // green-500
        "#eab308", // yellow-500
    ];

    // Create deterministic hash from username using a better hash function
    let hash = 0;
    if (username.length === 0) return colors[0];

    for (let i = 0; i < username.length; i++) {
        const char = username.charCodeAt(i);
        hash = (hash << 5) - hash + char;
        hash = hash & hash; // Convert to 32bit integer
    }

    // Add some additional mixing to reduce collisions
    hash = hash ^ (hash >>> 16);
    hash = hash * 0x85ebca6b;
    hash = hash ^ (hash >>> 13);
    hash = hash * 0xc2b2ae35;
    hash = hash ^ (hash >>> 16);

    // Use absolute value and modulo to get color index
    const colorIndex = Math.abs(hash) % colors.length;
    return colors[colorIndex];
};

// Helper function to format timestamps in a user-friendly way
const formatTimestamp = (timestamp: string | number): { display: string; full: string } => {
    const now = new Date();
    const date = new Date(typeof timestamp === "string" ? parseInt(timestamp) : timestamp);

    // If invalid date, return fallback
    if (isNaN(date.getTime())) {
        return { display: "", full: "" };
    }

    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

    // Full timestamp for hover
    const full = date.toLocaleString();

    // Display format based on age
    if (diffMinutes < 1) {
        return { display: "just now", full };
    } else if (diffMinutes < 60) {
        return { display: `${diffMinutes}m ago`, full };
    } else if (diffHours < 24) {
        return { display: `${diffHours}h ago`, full };
    } else if (diffDays === 1) {
        return { display: "yesterday", full };
    } else if (diffDays < 7) {
        return { display: `${diffDays}d ago`, full };
    } else {
        // For older dates, show month/day
        const monthDay = date.toLocaleDateString("en-US", {
            month: "short",
            day: "numeric",
        });
        return { display: monthDay, full };
    }
};

const UserAvatar = ({ username, email, size = "small" }: UserAvatar) => {
    const sizeMap = {
        small: { width: "24px", height: "24px", fontSize: "12px" },
        medium: { width: "32px", height: "32px", fontSize: "14px" },
        large: { width: "40px", height: "40px", fontSize: "16px" },
    };

    const userColor = getUserColor(username);

    return (
        <div
            className="flex items-center gap-2 relative"
            title={email ? `${username} (${email})` : username}
        >
            <div
                className="rounded-full text-white flex items-center justify-center font-medium flex-shrink-0"
                style={{
                    ...sizeMap[size],
                    backgroundColor: userColor,
                }}
            >
                {username[0].toUpperCase()}
            </div>
            {/* Hide username text on narrow viewports (VSCode sidebar) */}
            <div className="flex flex-col gap-0.5 min-w-0 hidden sm:flex">
                <span className="font-medium truncate">{username}</span>
            </div>
        </div>
    );
};

function App() {
    const [cellId, setCellId] = useState<CellIdGlobalState>({ cellId: "", uri: "", globalReferences: [] });
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

    // Force re-render for timestamp updates
    const [timestampUpdateTrigger, setTimestampUpdateTrigger] = useState(0);

    // Update timestamps every minute
    useEffect(() => {
        const interval = setInterval(() => {
            setTimestampUpdateTrigger((prev) => prev + 1);
        }, 60000); // Update every minute

        return () => clearInterval(interval);
    }, []);

    // Track current user state changes
    useEffect(() => {
        // User state updated
    }, [currentUser]);

    const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
    const [replyingTo, setReplyingTo] = useState<{ threadId: string; username?: string } | null>(
        null
    );
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [threadTitleEdit, setThreadTitleEdit] = useState<string>("");

    // Helper function to determine if thread is currently resolved based on latest event
    const isThreadResolved = useCallback((thread: NotebookCommentThread): boolean => {
        const resolvedEvents = thread.resolvedEvent || [];
        const latestResolvedEvent =
            resolvedEvents.length > 0
                ? resolvedEvents.reduce((latest, event) =>
                      event.timestamp > latest.timestamp ? event : latest
                  )
                : null;
        return latestResolvedEvent?.resolved || false;
    }, []);

    // Helper function to determine if thread is currently deleted based on latest event
    const isThreadDeleted = useCallback((thread: NotebookCommentThread): boolean => {
        const deletionEvents = thread.deletionEvent || [];
        const latestDeletionEvent =
            deletionEvents.length > 0
                ? deletionEvents.reduce((latest, event) =>
                      event.timestamp > latest.timestamp ? event : latest
                  )
                : null;
        return latestDeletionEvent?.deleted || false;
    }, []);

    const handleMessage = useCallback(
        (event: MessageEvent) => {
            const message: CommentPostMessages = event.data;

            switch (message.command) {
                case "commentsFromWorkspace": {
                    if (message.content) {
                        try {
                            const comments = JSON.parse(message.content);
                            setCommentThread(comments);
                            setPendingResolveThreads(new Set());
                        } catch (error) {
                            console.error("[CommentsWebview] Error parsing comments:", error);
                        }
                    }
                    break;
                }
                case "reload": {
                    if (message.data?.cellId) {
                        setCellId({ 
                            cellId: message.data.cellId, 
                            uri: message.data.uri || "",
                            globalReferences: message.data.globalReferences || []
                        });
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
                        const newUser = {
                            username: message.userInfo.username,
                            email: message.userInfo.email,
                            isAuthenticated: true,
                        };
                        setCurrentUser(newUser);
                    } else {
                        const newUser = {
                            username: "vscode",
                            email: "",
                            isAuthenticated: false,
                        };
                        setCurrentUser(newUser);
                    }
                    break;
                }
                default:
                // Unknown message command
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
        const timestamp = Date.now();
        const newCommentId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

        const comment: Comment = {
            id: newCommentId,
            timestamp: timestamp,
            body: replyText[threadId],
            mode: 1,
            author: { name: currentUser.username },
            deleted: false,
        };

        const updatedThread: NotebookCommentThread = {
            ...(existingThread || {
                id: threadId,
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

    const handleCommentDeletion = (commentId: string, commentThreadId: string) => {
        vscode.postMessage({
            command: "deleteComment",
            args: { commentId, commentThreadId },
        } as CommentPostMessages);
    };

    const handleUndoCommentDeletion = (commentId: string, commentThreadId: string) => {
        vscode.postMessage({
            command: "undoCommentDeletion",
            args: { commentId, commentThreadId },
        } as CommentPostMessages);
    };

    const handleNewComment = () => {
        if (!newCommentText.trim() || !cellId.cellId || !currentUser.isAuthenticated) return;

        console.log("[CommentsView] Creating new comment with cellId state:", cellId);

        // Generate a timestamp for the default title
        const now = new Date();
        const defaultTitle = now.toLocaleString();
        const timestamp = Date.now();
        const commentId = `${timestamp}-${Math.random().toString(36).substr(2, 9)}`;

        const newThread: NotebookCommentThread = {
            id: uuidv4(),
            canReply: true,
            cellId: cellId,
            collapsibleState: 0,
            threadTitle: defaultTitle,
            deletionEvent: [],
            resolvedEvent: [],
            comments: [
                {
                    id: commentId,
                    timestamp: timestamp,
                    body: newCommentText.trim(),
                    mode: 1,
                    author: { name: currentUser.username },
                    deleted: false,
                },
            ],
        };

        console.log("[CommentsView] Sending new comment thread:", newThread);

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

        // Determine if thread is currently resolved (latest event determines state)
        const isCurrentlyResolved = isThreadResolved(thread);

        // Add new event with opposite state and current timestamp
        const updatedThread = {
            ...thread,
            resolvedEvent: [
                ...(thread.resolvedEvent || []),
                {
                    timestamp: Date.now(),
                    author: { name: currentUser?.username || "Unknown" },
                    resolved: !isCurrentlyResolved,
                },
            ],
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


    /**
     * Get display name for a cell, using new display fields or calculating fallback
     * Priority:
     * 1. Use fileDisplayName + milestoneValue + cellLineNumber if available
     * 2. Fall back to globalReferences if available
     * 3. Fall back to shortened cellId
     * 
     * Note: For stored comments, the display fields may not be present.
     * The current cell selection will have them, but older saved comments won't.
     * This is intentional - we want fresh data for the current cell, but we fall back
     * to simpler display for historical comments to avoid expensive lookups.
     */
    const getCellDisplayName = (cellIdState: CellIdGlobalState | string): string => {
        // Handle legacy string format (shouldn't happen after migration, but just in case)
        if (typeof cellIdState === 'string') {
            const parts = cellIdState.split(":");
            const finalPart = parts[parts.length - 1] || cellIdState;
            return cellIdState.length < 10 ? cellIdState : finalPart;
        }

        console.log("[CommentsView] Getting display name for cellIdState:", cellIdState);

        // New format: CellIdGlobalState object
        // Priority 1: Use the new display fields if all are available
        if (cellIdState.fileDisplayName && cellIdState.milestoneValue && cellIdState.cellLineNumber) {
            console.log("[CommentsView] Using Priority 1: All display fields available");
            return `${cellIdState.fileDisplayName} · ${cellIdState.milestoneValue} · Line ${cellIdState.cellLineNumber}`;
        }

        // Priority 2: Partial display info - show what we have
        if (cellIdState.milestoneValue && cellIdState.cellLineNumber) {
            console.log("[CommentsView] Using Priority 2: Milestone + line number");
            return `${cellIdState.milestoneValue} · Line ${cellIdState.cellLineNumber}`;
        }

        if (cellIdState.fileDisplayName && cellIdState.cellLineNumber) {
            console.log("[CommentsView] Using Priority 2: File + line number");
            return `${cellIdState.fileDisplayName} · Line ${cellIdState.cellLineNumber}`;
        }

        // Priority 3: Use globalReferences if available (for stored comments)
        if (cellIdState.globalReferences && cellIdState.globalReferences.length > 0) {
            console.log("[CommentsView] Using Priority 3: globalReferences");
            // For stored comments with globalReferences, show them nicely
            // Extract just the reference part (e.g., "GEN 1:1" -> "Gen 1:1" or "NUM 1:7" -> "Num 1:7")
            const formatted = cellIdState.globalReferences.map(ref => {
                // Capitalize first letter, lowercase rest: "NUM 1:7" -> "Num 1:7"
                const parts = ref.split(' ');
                if (parts.length >= 2) {
                    const book = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
                    return `${book} ${parts.slice(1).join(' ')}`;
                }
                return ref;
            });
            return formatted.join(", ");
        }

        // Priority 4: Fall back to shortened cellId
        console.log("[CommentsView] Using Priority 4: Shortened cellId");
        const cellId = cellIdState.cellId;
        if (cellId.length > 10) {
            // Show last 8 characters for UUIDs
            return `...${cellId.slice(-8)}`;
        }

        return cellId || "Unknown cell";
    };

    const filteredCommentThreads = useMemo(() => {
        // First, get all non-deleted threads
        const nonDeletedThreads = commentThreadArray.filter((thread) => !isThreadDeleted(thread));

        // Then, apply additional filtering based on view mode, search, and resolved status
        const filtered = nonDeletedThreads.filter((commentThread) => {
            // Skip resolved threads if they're hidden
            if (!showResolvedThreads && isThreadResolved(commentThread)) return false;

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

        // Sort threads by newest first (based on latest comment timestamp)
        return filtered.sort((a, b) => {
            const getLatestTimestamp = (thread: NotebookCommentThread) => {
                const timestamps = thread.comments.map((c) => c.timestamp);
                return Math.max(...timestamps);
            };
            return getLatestTimestamp(b) - getLatestTimestamp(a);
        });
    }, [commentThreadArray, searchQuery, viewMode, cellId.cellId, showResolvedThreads, isThreadDeleted, isThreadResolved]);

    // Count of hidden resolved threads
    const hiddenResolvedThreadsCount = useMemo(() => {
        if (showResolvedThreads) return 0;

        const nonDeletedThreads = commentThreadArray.filter((thread) => !isThreadDeleted(thread));

        return nonDeletedThreads.filter((thread) => {
            const isResolved = isThreadResolved(thread);
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
    }, [commentThreadArray, viewMode, cellId.cellId, searchQuery, showResolvedThreads, isThreadDeleted, isThreadResolved]);

    // Whether a user can start a new top-level comment thread (requires auth and active cell)
    const canStartNewComment = currentUser.isAuthenticated && Boolean(cellId.cellId);

    // Helper function to render comment body with blockquotes
    const renderCommentBody = (body: string) => {
        if (!body) return null;

        const lines = body.split("\n");
        const elements: JSX.Element[] = [];
        let currentQuoteLines: string[] = [];

        const flushQuote = () => {
            if (currentQuoteLines.length > 0) {
                elements.push(
                    <blockquote
                        key={`quote-${elements.length}`}
                        className="border-l-4 border-muted-foreground/30 pl-3 py-1 my-2 bg-muted/30 text-muted-foreground italic"
                    >
                        {currentQuoteLines.join("\n")}
                    </blockquote>
                );
                currentQuoteLines = [];
            }
        };

        lines.forEach((line, index) => {
            if (line.startsWith("> ")) {
                currentQuoteLines.push(line.substring(2));
            } else {
                flushQuote();
                if (line.trim() || index < lines.length - 1) {
                    elements.push(
                        <span key={`text-${elements.length}`}>
                            {line}
                            {index < lines.length - 1 && <br />}
                        </span>
                    );
                }
            }
        });

        flushQuote();
        return elements;
    };

    const handleReplyToComment = (comment: Comment, threadId: string) => {
        const quotedText = `> ${comment.body.replace(/\n/g, "\n> ")}\n\n`;
        setReplyText((prev) => ({
            ...prev,
            [threadId]: quotedText,
        }));
        setReplyingTo({ threadId, username: comment.author.name });
    };

    const CommentCard = ({
        thread,
        comment,
    }: {
        thread: NotebookCommentThread;
        comment: Comment;
    }) => {
        const formattedTime = formatTimestamp(comment.timestamp);
        const [isHovered, setIsHovered] = useState(false);

        return (
            <div
                key={comment.id}
                className={`group relative hover:bg-muted/50 rounded-md p-2 transition-colors ${
                    comment.deleted ? "opacity-60" : ""
                }`}
                onMouseEnter={() => setIsHovered(true)}
                onMouseLeave={() => setIsHovered(false)}
            >
                <div className="flex gap-2 items-start">
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <UserAvatar username={comment.author.name} size="small" />
                        </TooltipTrigger>
                        <TooltipContent>{comment.author.name}</TooltipContent>
                    </Tooltip>

                    {/* Comment content */}
                    <div className="flex-1 min-w-0">
                        <div className="flex justify-between">
                            <Tooltip>
                                <TooltipTrigger asChild>
                                    <span className="text-xs text-muted-foreground">
                                        {formattedTime.display}
                                    </span>
                                </TooltipTrigger>
                                <TooltipContent>{formattedTime.full}</TooltipContent>
                            </Tooltip>
                        </div>
                        <div
                            className={`text-sm leading-relaxed break-words ${
                                comment.deleted ? "text-muted-foreground italic" : ""
                            }`}
                        >
                            {comment.deleted
                                ? "This comment has been deleted"
                                : renderCommentBody(comment.body)}
                        </div>
                    </div>
                </div>

                {/* Action buttons - positioned at bottom right */}
                {isHovered && currentUser.isAuthenticated && !comment.deleted && (
                    <div className="absolute bottom-1 right-2 flex gap-1 bg-background/80 backdrop-blur-sm rounded px-1 py-0.5 border border-border/50">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 w-6 p-0 text-muted-foreground hover:text-foreground"
                            onClick={() => handleReplyToComment(comment, thread.id)}
                            title="Reply to this comment"
                        >
                            <Reply className="h-3 w-3" />
                        </Button>

                        {comment.author.name === currentUser.username && (
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => handleCommentDeletion(comment.id, thread.id)}
                                title="Delete comment"
                            >
                                <Trash2 className="h-3 w-3" />
                            </Button>
                        )}
                    </div>
                )}

                {/* Undo deletion button for deleted comments - only show on hover */}
                {comment.deleted && comment.author.name === currentUser.username && isHovered && (
                    <div className="absolute bottom-1 right-2 bg-background/80 backdrop-blur-sm rounded px-2 py-1 border border-border/50">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="h-6 px-2 text-xs text-muted-foreground hover:text-foreground"
                            onClick={() => handleUndoCommentDeletion(comment.id, thread.id)}
                            title="Undo deletion"
                        >
                            <Undo2 className="h-3 w-3 mr-1" />
                            Undo
                        </Button>
                    </div>
                )}
            </div>
        );
    };

    return (
        <TooltipProvider>
            <div className="h-full w-full flex flex-col bg-background text-foreground font-sans relative">
                <WebviewHeader title="Comments" vscode={vscode} />

                {/* Header */}
                <div className="p-4 border-b border-border flex flex-col gap-3">
                    {/* {currentUser.isAuthenticated && (
                        <div className="flex items-center gap-2">
                            <UserAvatar
                                username={currentUser.username}
                                email={currentUser.email}
                                size="medium"
                            />
                        </div>
                    )} */}

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
                            <span className="hidden sm:inline">All Comments</span>
                            <span className="sm:hidden">All</span>
                        </Button>
                        <Button
                            variant={viewMode === "cell" ? "default" : "ghost"}
                            className="flex-1 rounded-none"
                            onClick={() => {
                                setViewMode("cell");
                                setSearchQuery(cellId.cellId);
                            }}
                        >
                            <span className="hidden sm:inline">Current Cell</span>
                            <span className="sm:hidden">Current</span>
                        </Button>
                    </div>

                    {/* Search 
                    
                    // TODO: this should be a react select for autocomplete of cell ids or allow you to search text
                    */}
                    <div className="flex gap-2 items-center">
                        <div className="relative flex-1">
                            <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                            <Input
                                placeholder={
                                    viewMode === "all"
                                        ? "Search all comments..."
                                        : `Showing comments for ${getCellDisplayName(cellId)}`
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

                        {currentUser.isAuthenticated &&
                            (canStartNewComment ? (
                                <Button
                                    onClick={() => setShowNewCommentForm(true)}
                                    className="font-medium"
                                >
                                    <Plus className="h-4 w-4 mr-1.5" />
                                    Comment
                                </Button>
                            ) : (
                                <Tooltip>
                                    <TooltipTrigger asChild>
                                        {/* span wrapper so tooltip works with disabled button */}
                                        <span>
                                            <Button className="font-medium" disabled>
                                                <Plus className="h-4 w-4 mr-1.5" />
                                                Comment
                                            </Button>
                                        </span>
                                    </TooltipTrigger>
                                    <TooltipContent>
                                        Please select a cell to comment on first
                                    </TooltipContent>
                                </Tooltip>
                            ))}
                    </div>
                </div>

                {/* New comment form CHANGE THIS TOO! THIS NEEDS TO HAVE THE CELLDISPLAYNAME INSTEAD OF CELLID, about 9 lines down.*/}
                {showNewCommentForm && (
                    <Card className="m-4 bg-muted/50">
                        <CardContent className="p-4">
                            <div className="flex items-center mb-3 gap-2">
                                <MessageSquare className="h-4 w-4" />
                                <span className="text-sm font-medium">New comment</span>
                                {viewMode === "cell" && (
                                    <span className="text-xs text-muted-foreground">
                                        on {getCellDisplayName(cellId)}
                                    </span>
                                )}
                            </div>
                            <div className="flex gap-3 items-start">
                                <UserAvatar
                                    username={currentUser.username}
                                    email={currentUser.email}
                                    size="small"
                                />
                                <div className="flex-1 flex flex-col gap-3">
                                    <Input
                                        placeholder="What do you want to say?"
                                        value={newCommentText}
                                        className="border-0 border-b border-border rounded-none px-0 focus-visible:ring-0 focus-visible:border-primary"
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
                                            className="h-7 px-3 text-xs"
                                            onClick={() => setShowNewCommentForm(false)}
                                        >
                                            Cancel
                                        </Button>
                                        <Button
                                            size="sm"
                                            className="h-7 px-3 text-xs"
                                            onClick={handleNewComment}
                                            disabled={!newCommentText.trim()}
                                        >
                                            Comment
                                        </Button>
                                    </div>
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
                        <div className="flex flex-col gap-3">
                            {filteredCommentThreads.map((thread) => (
                                <Card
                                    key={thread.id}
                                    className={`overflow-hidden border transition-opacity duration-200 ${
                                        isThreadResolved(thread) ? "opacity-75" : "opacity-100"
                                    }`}
                                >
                                    {/* Thread header */}
                                    <CardHeader
                                        className="cursor-pointer bg-muted/50 hover:bg-muted/70 transition-colors p-3"
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
                                                {isThreadResolved(thread) && (
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
                                                                isThreadResolved(thread)
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
                                                            {pendingResolveThreads.has(
                                                                thread.id
                                                            ) ? (
                                                                <Clock className="h-4 w-4 animate-spin" />
                                                            ) : isThreadResolved(thread) ? (
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
                                                    title={
                                                        typeof thread.cellId === 'string'
                                                            ? thread.cellId
                                                            : `Cell ID: ${thread.cellId.cellId}${
                                                                  thread.cellId.globalReferences?.length
                                                                      ? `\nReferences: ${thread.cellId.globalReferences.join(", ")}`
                                                                      : ""
                                                              }`
                                                    }
                                                >
                                                    {getCellDisplayName(thread.cellId)}
                                                </span>
                                            </div>
                                            <span className="flex items-center gap-1">
                                                <MessageSquare className="h-3 w-3" />
                                                {thread.comments.length}{" "}
                                                {thread.comments.length === 1
                                                    ? "comment"
                                                    : "comments"}
                                            </span>
                                        </div>
                                    </CardHeader>

                                    {/* Comments section */}
                                    {!collapsedThreads[thread.id] && (
                                        <CardContent className="p-3">
                                            <div className="flex flex-col gap-3">
                                                {/* Reply form at top */}
                                                {currentUser.isAuthenticated && (
                                                    <div className="flex gap-3 items-start pb-3 border-b border-border">
                                                        <UserAvatar
                                                            username={currentUser.username}
                                                            email={currentUser.email}
                                                            size="small"
                                                        />

                                                        <div className="flex-1 flex flex-col gap-2">
                                                            {replyingTo?.threadId === thread.id && (
                                                                <div className="text-xs text-primary flex items-center gap-1 pb-2 border-b border-border">
                                                                    <Reply className="h-3 w-3" />
                                                                    Replying to @
                                                                    {replyingTo.username}
                                                                    <Button
                                                                        variant="ghost"
                                                                        size="sm"
                                                                        className="h-4 w-4 p-0 ml-auto"
                                                                        onClick={() => {
                                                                            setReplyingTo(null);
                                                                            setReplyText(
                                                                                (prev) => ({
                                                                                    ...prev,
                                                                                    [thread.id]: "",
                                                                                })
                                                                            );
                                                                        }}
                                                                    >
                                                                        <X className="h-3 w-3" />
                                                                    </Button>
                                                                </div>
                                                            )}

                                                            <div className="flex gap-2">
                                                                <textarea
                                                                    placeholder="Add a reply..."
                                                                    value={
                                                                        replyText[thread.id] || ""
                                                                    }
                                                                    className="flex-1 resize-none border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-2 focus:ring-ring min-h-[2.5rem] max-h-32"
                                                                    rows={
                                                                        replyText[
                                                                            thread.id
                                                                        ]?.includes("\n")
                                                                            ? Math.min(
                                                                                  replyText[
                                                                                      thread.id
                                                                                  ].split("\n")
                                                                                      .length,
                                                                                  5
                                                                              )
                                                                            : 1
                                                                    }
                                                                    onKeyDown={(e) => {
                                                                        if (
                                                                            e.key === "Enter" &&
                                                                            !e.shiftKey
                                                                        ) {
                                                                            e.preventDefault();
                                                                            handleReply(thread.id);
                                                                        } else if (
                                                                            e.key === "Escape"
                                                                        ) {
                                                                            setReplyingTo(null);
                                                                            setReplyText(
                                                                                (prev) => ({
                                                                                    ...prev,
                                                                                    [thread.id]: "",
                                                                                })
                                                                            );
                                                                        }
                                                                    }}
                                                                    onChange={(e) => {
                                                                        const value =
                                                                            e.target.value;
                                                                        setReplyText((prev) => ({
                                                                            ...prev,
                                                                            [thread.id]: value,
                                                                        }));
                                                                    }}
                                                                />

                                                                <Button
                                                                    variant="ghost"
                                                                    size="sm"
                                                                    className="h-8 w-8 p-0 self-end"
                                                                    onClick={() =>
                                                                        handleReply(thread.id)
                                                                    }
                                                                    title="Send reply"
                                                                    disabled={
                                                                        !replyText[
                                                                            thread.id
                                                                        ]?.trim()
                                                                    }
                                                                >
                                                                    <Send className="h-4 w-4" />
                                                                </Button>
                                                            </div>

                                                            {/* Preview of the reply with rendered blockquotes */}
                                                            {replyText[thread.id]?.trim() && (
                                                                <div className="border border-border rounded-md p-2 bg-muted/30 text-sm">
                                                                    <div className="text-xs text-muted-foreground mb-1">
                                                                        Preview:
                                                                    </div>
                                                                    <div className="text-sm leading-relaxed break-words">
                                                                        {renderCommentBody(
                                                                            replyText[thread.id]
                                                                        )}
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Comments - newest first like YouTube */}
                                                <div className="flex flex-col gap-3">
                                                    {thread.comments
                                                        .slice()
                                                        .reverse()
                                                        .map((comment, index) => (
                                                            <CommentCard
                                                                key={comment.id}
                                                                comment={comment}
                                                                thread={thread}
                                                            />
                                                        ))}
                                                </div>
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
                    commentThreadArray.some(
                        (thread) => !isThreadDeleted(thread) && isThreadResolved(thread)
                    ) && (
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
        </TooltipProvider>
    );
}

export default App;
