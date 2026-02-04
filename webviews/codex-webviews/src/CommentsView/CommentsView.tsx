import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    MessageSquare,
    Plus,
    ChevronLeft,
    Check,
    X,
    Trash2,
    Undo2,
    Send,
    Hash,
    Clock,
    Reply,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { NotebookCommentThread, CommentPostMessages, CellIdGlobalState } from "../../../../types";
import { v4 as uuidv4 } from "uuid";
import { WebviewHeader } from "../components/WebviewHeader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";

const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];

// Helper function to generate deterministic colors for usernames
const getUserColor = (username: string): string => {
    const colors = [
        "#3b82f6", "#10b981", "#8b5cf6", "#f59e0b", "#ec4899", "#06b6d4",
        "#ef4444", "#6366f1", "#14b8a6", "#84cc16", "#f97316", "#a855f7",
    ];
    let hash = 0;
    for (let i = 0; i < username.length; i++) {
        hash = (hash << 5) - hash + username.charCodeAt(i);
        hash = hash & hash;
    }
    return colors[Math.abs(hash) % colors.length];
};

// Helper function to format timestamps
const formatTimestamp = (timestamp: string | number): { display: string; full: string } => {
    const now = new Date();
    const date = new Date(typeof timestamp === "string" ? parseInt(timestamp) : timestamp);
    if (isNaN(date.getTime())) return { display: "", full: "" };

    const diffMs = now.getTime() - date.getTime();
    const diffMinutes = Math.floor(diffMs / (1000 * 60));
    const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));
    const full = date.toLocaleString();

    if (diffMinutes < 1) return { display: "just now", full };
    if (diffMinutes < 60) return { display: `${diffMinutes}m ago`, full };
    if (diffHours < 24) return { display: `${diffHours}h ago`, full };
    if (diffDays === 1) return { display: "yesterday", full };
    if (diffDays < 7) return { display: `${diffDays}d ago`, full };
    return { display: date.toLocaleDateString("en-US", { month: "short", day: "numeric" }), full };
};

// Author name with color
const AuthorName = ({ username, size = "sm" }: { username: string; size?: "sm" | "base" }) => (
    <span
        className={`font-semibold ${size === "base" ? "text-base" : "text-sm"}`}
        style={{ color: getUserColor(username) }}
    >
        {username}
    </span>
);

function App() {
    const [cellId, setCellId] = useState<CellIdGlobalState>({ cellId: "", uri: "", globalReferences: [] });
    const [commentThreadArray, setCommentThread] = useState<NotebookCommentThread[]>([]);
    const [messageText, setMessageText] = useState("");
    const [viewMode, setViewMode] = useState<"all" | "cell">("cell");
    const [selectedThread, setSelectedThread] = useState<string | null>(null);
    const [pendingResolveThreads, setPendingResolveThreads] = useState<Set<string>>(new Set());
    const [showNewThreadForm, setShowNewThreadForm] = useState(false);
    const [newThreadText, setNewThreadText] = useState("");
    const [replyingTo, setReplyingTo] = useState<Comment | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const commentRefs = useRef<Map<string, HTMLDivElement>>(new Map());
    const MAX_MESSAGE_LENGTH = 8000;
    const REPLY_PREVIEW_MAX_WORDS = 12;
    const [currentUser, setCurrentUser] = useState<{
        username: string;
        email: string;
        isAuthenticated: boolean;
    }>({
        username: "vscode",
        email: "",
        isAuthenticated: false,
    });

    // Scroll to bottom when messages change
    useEffect(() => {
        if (selectedThread) {
            messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
        }
    }, [selectedThread, commentThreadArray]);

    // Auto-resize textarea
    const autoResizeTextarea = useCallback(() => {
        const textarea = textareaRef.current;
        if (textarea) {
            textarea.style.height = "auto";
            textarea.style.height = Math.min(textarea.scrollHeight, 200) + "px";
        }
    }, []);

    useEffect(() => {
        autoResizeTextarea();
    }, [messageText, autoResizeTextarea]);

    const isThreadResolved = useCallback((thread: NotebookCommentThread): boolean => {
        const resolvedEvents = thread.resolvedEvent || [];
        if (resolvedEvents.length === 0) return false;
        const latest = resolvedEvents.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
        return latest.resolved || false;
    }, []);

    const isThreadDeleted = useCallback((thread: NotebookCommentThread): boolean => {
        const deletionEvents = thread.deletionEvent || [];
        if (deletionEvents.length === 0) return false;
        const latest = deletionEvents.reduce((a, b) => (a.timestamp > b.timestamp ? a : b));
        return latest.deleted || false;
    }, []);

    const handleMessage = useCallback(
        (event: MessageEvent) => {
            const message: CommentPostMessages = event.data;
            switch (message.command) {
                case "commentsFromWorkspace":
                    if (message.content) {
                        try {
                            setCommentThread(JSON.parse(message.content));
                            setPendingResolveThreads(new Set());
                        } catch (error) {
                            console.error("[CommentsWebview] Error parsing comments:", error);
                        }
                    }
                    break;
                case "reload":
                    if (message.data?.cellId) {
                        setCellId({
                            cellId: message.data.cellId,
                            uri: message.data.uri || "",
                            globalReferences: message.data.globalReferences || [],
                        });
                    }
                    break;
                case "updateUserInfo":
                    setCurrentUser(
                        message.userInfo
                            ? { ...message.userInfo, isAuthenticated: true }
                            : { username: "vscode", email: "", isAuthenticated: false }
                    );
                    break;
            }
        },
        []
    );

    useEffect(() => {
        window.addEventListener("message", handleMessage);
        vscode.postMessage({ command: "fetchComments" });
        vscode.postMessage({ command: "getCurrentCellId" });
        return () => window.removeEventListener("message", handleMessage);
    }, [handleMessage]);

    // Parse reply reference from message body
    const parseReplyInfo = (body: string): { replyToId: string | null; content: string } => {
        const match = body.match(/^@reply:([^\n]+)\n([\s\S]*)$/);
        if (match) {
            return { replyToId: match[1], content: match[2] };
        }
        // Legacy: check for markdown quote style
        const lines = body.split("\n");
        const quoteLines: string[] = [];
        let contentStart = 0;
        for (let i = 0; i < lines.length; i++) {
            if (lines[i].startsWith("> ")) {
                quoteLines.push(lines[i].slice(2));
            } else if (lines[i].trim() === "" && quoteLines.length > 0) {
                contentStart = i + 1;
                break;
            } else {
                break;
            }
        }
        if (quoteLines.length > 0) {
            return { replyToId: null, content: lines.slice(contentStart).join("\n") };
        }
        return { replyToId: null, content: body };
    };

    // Find comment by ID in current thread
    const findCommentById = (commentId: string): Comment | null => {
        if (!currentThread) return null;
        return currentThread.comments.find((c) => c.id === commentId) || null;
    };

    // Scroll to a comment
    const scrollToComment = (commentId: string) => {
        const element = commentRefs.current.get(commentId);
        if (element) {
            element.scrollIntoView({ behavior: "smooth", block: "center" });
            element.classList.add("bg-primary/10");
            setTimeout(() => element.classList.remove("bg-primary/10"), 1500);
        }
    };

    // Truncate text to max words
    const truncateToWords = (text: string, maxWords: number): string => {
        const words = text.split(/\s+/);
        if (words.length <= maxWords) return text;
        return words.slice(0, maxWords).join(" ") + "...";
    };

    const getCellLabel = (cellIdState: CellIdGlobalState | string): string => {
        if (typeof cellIdState === "string") {
            return cellIdState.length > 20 ? cellIdState.slice(-12) : cellIdState;
        }
        if (cellIdState.globalReferences?.length > 0) {
            return cellIdState.globalReferences[0];
        }
        const id = cellIdState.cellId;
        return id.length > 20 ? id.slice(-12) : id;
    };

    const getThreadPreview = (thread: NotebookCommentThread): string => {
        const firstComment = thread.comments[0];
        if (!firstComment) return "Empty thread";
        const plainText = firstComment.body
            .split("\n")
            .filter((line) => !line.startsWith("> "))
            .join(" ")
            .trim();
        return plainText.length > 50 ? plainText.slice(0, 47) + "..." : plainText || "Empty thread";
    };

    // Filter and sort threads: unresolved first, then resolved at bottom
    const filteredThreads = useMemo(() => {
        const nonDeleted = commentThreadArray.filter((t) => !isThreadDeleted(t));
        const filtered = nonDeleted.filter((t) => {
            if (viewMode === "cell" && cellId.cellId) {
                return t.cellId.cellId === cellId.cellId;
            }
            return true;
        });

        // Sort: unresolved first (by latest activity), then resolved
        const unresolved = filtered.filter((t) => !isThreadResolved(t));
        const resolved = filtered.filter((t) => isThreadResolved(t));

        const byLatestActivity = (a: NotebookCommentThread, b: NotebookCommentThread) => {
            const aTime = Math.max(...a.comments.map((c) => c.timestamp));
            const bTime = Math.max(...b.comments.map((c) => c.timestamp));
            return bTime - aTime;
        };

        return [...unresolved.sort(byLatestActivity), ...resolved.sort(byLatestActivity)];
    }, [commentThreadArray, viewMode, cellId.cellId, isThreadDeleted, isThreadResolved]);

    const currentThread = selectedThread
        ? commentThreadArray.find((t) => t.id === selectedThread)
        : null;

    const handleSendMessage = () => {
        if (!messageText.trim() || !currentThread || !currentUser.isAuthenticated) return;
        if (isThreadResolved(currentThread)) return;

        const timestamp = Date.now();

        // Build message body with optional reply reference
        let body = messageText.trim();
        if (replyingTo) {
            body = `@reply:${replyingTo.id}\n${body}`;
        }

        const newComment: Comment = {
            id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
            timestamp,
            body,
            mode: 1,
            author: { name: currentUser.username },
            deleted: false,
        };

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: { ...currentThread, comments: [...currentThread.comments, newComment] },
        });
        setMessageText("");
        setReplyingTo(null);
    };

    const handleCreateThread = () => {
        if (!newThreadText.trim() || !cellId.cellId || !currentUser.isAuthenticated) return;

        const timestamp = Date.now();
        const newThread: NotebookCommentThread = {
            id: uuidv4(),
            canReply: true,
            cellId: cellId,
            collapsibleState: 0,
            threadTitle: new Date().toLocaleString(),
            deletionEvent: [],
            resolvedEvent: [],
            comments: [{
                id: `${timestamp}-${Math.random().toString(36).substr(2, 9)}`,
                timestamp,
                body: newThreadText.trim(),
                mode: 1,
                author: { name: currentUser.username },
                deleted: false,
            }],
        };

        vscode.postMessage({ command: "updateCommentThread", commentThread: newThread });
        setNewThreadText("");
        setShowNewThreadForm(false);
        setSelectedThread(newThread.id);
    };

    const toggleResolved = (thread: NotebookCommentThread) => {
        setPendingResolveThreads((prev) => new Set(prev).add(thread.id));
        const isCurrentlyResolved = isThreadResolved(thread);

        vscode.postMessage({
            command: "updateCommentThread",
            commentThread: {
                ...thread,
                resolvedEvent: [
                    ...(thread.resolvedEvent || []),
                    { timestamp: Date.now(), author: { name: currentUser.username }, resolved: !isCurrentlyResolved },
                ],
            },
        });
    };

    const handleDeleteComment = (commentId: string, threadId: string) => {
        vscode.postMessage({ command: "deleteComment", args: { commentId, commentThreadId: threadId } });
    };

    const handleUndoDelete = (commentId: string, threadId: string) => {
        vscode.postMessage({ command: "undoCommentDeletion", args: { commentId, commentThreadId: threadId } });
    };

    // Render message content (without reply prefix)
    const renderMessageContent = (content: string) => {
        return content.split("\n").map((line, i, arr) => (
            <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
            </span>
        ));
    };

    // Thread list view
    const ThreadList = () => (
        <div className="flex-1 flex flex-col overflow-hidden">
            {/* Header */}
            <div className="p-3 border-b border-border">
                <div className="flex gap-2 mb-3">
                    <Button
                        variant={viewMode === "all" ? "default" : "ghost"}
                        size="sm"
                        className="flex-1"
                        onClick={() => setViewMode("all")}
                    >
                        All
                    </Button>
                    <Button
                        variant={viewMode === "cell" ? "default" : "ghost"}
                        size="sm"
                        className="flex-1 truncate"
                        onClick={() => setViewMode("cell")}
                    >
                        {cellId.cellId ? getCellLabel(cellId) : "Current"}
                    </Button>
                </div>

                {currentUser.isAuthenticated && cellId.cellId && (
                    <Button
                        className="w-full"
                        size="sm"
                        onClick={() => setShowNewThreadForm(true)}
                    >
                        <Plus className="h-4 w-4 mr-2" />
                        New Thread
                    </Button>
                )}
            </div>

            {/* New thread form */}
            {showNewThreadForm && (
                <div className="p-3 border-b border-border bg-muted/30">
                    <div className="text-xs text-muted-foreground mb-2">
                        Starting thread on {getCellLabel(cellId)}
                    </div>
                    <textarea
                        autoFocus
                        placeholder="What's on your mind?"
                        value={newThreadText}
                        onChange={(e) => setNewThreadText(e.target.value)}
                        onKeyDown={(e) => {
                            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                e.preventDefault();
                                handleCreateThread();
                            } else if (e.key === "Escape") {
                                setShowNewThreadForm(false);
                                setNewThreadText("");
                            }
                        }}
                        className="w-full resize-none border border-border rounded-md px-3 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring min-h-[60px] mb-2"
                    />
                    <div className="flex justify-end gap-2">
                        <Button variant="ghost" size="sm" onClick={() => { setShowNewThreadForm(false); setNewThreadText(""); }}>
                            Cancel
                        </Button>
                        <Button size="sm" onClick={handleCreateThread} disabled={!newThreadText.trim()}>
                            Create
                        </Button>
                    </div>
                </div>
            )}

            {/* Thread list */}
            <div className="flex-1 overflow-y-auto">
                {filteredThreads.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-muted-foreground p-8 text-center">
                        <MessageSquare className="h-8 w-8 mb-3 opacity-50" />
                        <div className="text-sm">No threads yet</div>
                        <div className="text-xs mt-1">Start a conversation</div>
                    </div>
                ) : (
                    <div className="py-1">
                        {filteredThreads.map((thread) => {
                            const resolved = isThreadResolved(thread);
                            const latestComment = thread.comments[thread.comments.length - 1];
                            const time = formatTimestamp(latestComment?.timestamp || 0);

                            return (
                                <div
                                    key={thread.id}
                                    onClick={() => setSelectedThread(thread.id)}
                                    className={`px-3 py-2 cursor-pointer hover:bg-muted/50 transition-colors border-l-2 ${
                                        resolved
                                            ? "border-transparent opacity-60"
                                            : "border-transparent hover:border-primary"
                                    }`}
                                >
                                    <div className="flex items-center gap-2">
                                        <Hash className={`h-4 w-4 flex-shrink-0 ${resolved ? "text-muted-foreground" : "text-primary"}`} />
                                        <span className={`text-sm truncate flex-1 ${resolved ? "text-muted-foreground" : "font-medium"}`}>
                                            {getThreadPreview(thread)}
                                        </span>
                                        {resolved && (
                                            <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                                                <Check className="h-2.5 w-2.5" />
                                            </Badge>
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2 mt-1 ml-6 text-xs text-muted-foreground">
                                        <span>{thread.comments.length} {thread.comments.length === 1 ? "message" : "messages"}</span>
                                        <span>•</span>
                                        <span>{time.display}</span>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );

    // Thread detail view (Discord chat style)
    const ThreadDetail = () => {
        if (!currentThread) return null;
        const resolved = isThreadResolved(currentThread);

        return (
            <div className="flex-1 flex flex-col overflow-hidden">
                {/* Thread header */}
                <div className="p-2 border-b border-border flex items-center gap-2 bg-muted/30">
                    <Button variant="ghost" size="sm" className="h-8 w-8 p-0" onClick={() => setSelectedThread(null)}>
                        <ChevronLeft className="h-4 w-4" />
                    </Button>
                    <Hash className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm font-medium truncate flex-1">
                        {getThreadPreview(currentThread)}
                    </span>
                    {resolved && (
                        <Badge variant="secondary" className="text-xs">
                            <Check className="h-3 w-3 mr-1" />
                            Resolved
                        </Badge>
                    )}
                    <Tooltip>
                        <TooltipTrigger asChild>
                            <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => toggleResolved(currentThread)}
                                disabled={pendingResolveThreads.has(currentThread.id)}
                            >
                                {pendingResolveThreads.has(currentThread.id) ? (
                                    <Clock className="h-4 w-4 animate-spin" />
                                ) : resolved ? (
                                    <Undo2 className="h-4 w-4" />
                                ) : (
                                    <Check className="h-4 w-4" />
                                )}
                            </Button>
                        </TooltipTrigger>
                        <TooltipContent>{resolved ? "Reopen thread" : "Resolve thread"}</TooltipContent>
                    </Tooltip>
                </div>

                {/* Messages */}
                <div className="flex-1 overflow-y-auto p-3">
                    <div className="flex flex-col gap-3">
                        {currentThread.comments.map((comment, idx) => {
                            const time = formatTimestamp(comment.timestamp);
                            const showAuthor = idx === 0 || currentThread.comments[idx - 1].author.name !== comment.author.name;
                            const isOwn = comment.author.name === currentUser.username;
                            const { replyToId, content } = parseReplyInfo(comment.body);
                            const repliedComment = replyToId ? findCommentById(replyToId) : null;

                            return (
                                <div
                                    key={comment.id}
                                    ref={(el) => {
                                        if (el) commentRefs.current.set(comment.id, el);
                                    }}
                                    className={`group rounded-md px-2 py-1 -mx-2 transition-colors ${comment.deleted ? "opacity-50" : ""}`}
                                >
                                    {/* Discord-style reply preview */}
                                    {repliedComment && !comment.deleted && (
                                        <div
                                            className="flex items-center gap-1.5 mb-1 cursor-pointer hover:underline"
                                            onClick={() => scrollToComment(repliedComment.id)}
                                        >
                                            <div className="w-6 h-3 border-l-2 border-t-2 border-muted-foreground/40 rounded-tl-md ml-2" />
                                            <span
                                                className="text-xs font-medium"
                                                style={{ color: getUserColor(repliedComment.author.name) }}
                                            >
                                                {repliedComment.author.name}
                                            </span>
                                            <span className="text-xs text-muted-foreground truncate">
                                                {truncateToWords(parseReplyInfo(repliedComment.body).content, REPLY_PREVIEW_MAX_WORDS)}
                                            </span>
                                        </div>
                                    )}

                                    {showAuthor && (
                                        <div className="flex items-center gap-2 mb-0.5">
                                            <AuthorName username={comment.author.name} size="base" />
                                            <Tooltip>
                                                <TooltipTrigger asChild>
                                                    <span className="text-xs text-muted-foreground">{time.display}</span>
                                                </TooltipTrigger>
                                                <TooltipContent>{time.full}</TooltipContent>
                                            </Tooltip>
                                        </div>
                                    )}
                                    <div className="relative">
                                        <div className="text-base leading-relaxed">
                                            {comment.deleted ? (
                                                <span className="italic text-muted-foreground">Message deleted</span>
                                            ) : (
                                                renderMessageContent(content)
                                            )}
                                        </div>

                                        {/* Actions */}
                                        {!comment.deleted && !resolved && (
                                            <div className="absolute -right-1 -top-1 opacity-0 group-hover:opacity-100 transition-opacity flex gap-0.5 bg-background rounded shadow-sm border border-border">
                                                <Tooltip>
                                                    <TooltipTrigger asChild>
                                                        <Button
                                                            variant="ghost"
                                                            size="sm"
                                                            className="h-7 w-7 p-0 text-muted-foreground hover:text-primary"
                                                            onClick={() => {
                                                                setReplyingTo(comment);
                                                                textareaRef.current?.focus();
                                                            }}
                                                        >
                                                            <Reply className="h-3.5 w-3.5" />
                                                        </Button>
                                                    </TooltipTrigger>
                                                    <TooltipContent>Reply</TooltipContent>
                                                </Tooltip>
                                                {isOwn && (
                                                    <Tooltip>
                                                        <TooltipTrigger asChild>
                                                            <Button
                                                                variant="ghost"
                                                                size="sm"
                                                                className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive"
                                                                onClick={() => handleDeleteComment(comment.id, currentThread.id)}
                                                            >
                                                                <Trash2 className="h-3.5 w-3.5" />
                                                            </Button>
                                                        </TooltipTrigger>
                                                        <TooltipContent>Delete</TooltipContent>
                                                    </Tooltip>
                                                )}
                                            </div>
                                        )}
                                        {isOwn && comment.deleted && (
                                            <Button
                                                variant="ghost"
                                                size="sm"
                                                className="h-6 px-2 mt-1 text-xs"
                                                onClick={() => handleUndoDelete(comment.id, currentThread.id)}
                                            >
                                                <Undo2 className="h-3 w-3 mr-1" />
                                                Undo
                                            </Button>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                        <div ref={messagesEndRef} />
                    </div>
                </div>

                {/* Message input */}
                <div className="p-3 border-t border-border bg-muted/20">
                    {resolved ? (
                        <div className="text-center text-sm text-muted-foreground py-2">
                            This thread is resolved.{" "}
                            <button
                                className="text-primary hover:underline"
                                onClick={() => toggleResolved(currentThread)}
                            >
                                Reopen to reply
                            </button>
                        </div>
                    ) : currentUser.isAuthenticated ? (
                        <div className="w-full">
                            {/* Reply preview */}
                            {replyingTo && (
                                <div className="flex items-center gap-2 mb-2 px-2 py-1.5 bg-muted/50 rounded-md border-l-2 border-primary">
                                    <Reply className="h-3 w-3 text-muted-foreground flex-shrink-0" />
                                    <span className="text-xs text-muted-foreground">Replying to</span>
                                    <AuthorName username={replyingTo.author.name} size="sm" />
                                    <span className="text-xs text-muted-foreground truncate flex-1">
                                        {replyingTo.body.split("\n").filter((l) => !l.startsWith("> "))[0]?.slice(0, 40)}...
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="sm"
                                        className="h-5 w-5 p-0 text-muted-foreground hover:text-foreground"
                                        onClick={() => setReplyingTo(null)}
                                    >
                                        <X className="h-3 w-3" />
                                    </Button>
                                </div>
                            )}
                            <div className="relative w-full">
                                <textarea
                                    ref={textareaRef}
                                    placeholder={replyingTo ? `Reply to ${replyingTo.author.name}...` : "Send a message..."}
                                    value={messageText}
                                    onChange={(e) => {
                                        if (e.target.value.length <= MAX_MESSAGE_LENGTH) {
                                            setMessageText(e.target.value);
                                        }
                                    }}
                                    onKeyDown={(e) => {
                                        if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                            e.preventDefault();
                                            handleSendMessage();
                                        } else if (e.key === "Escape" && replyingTo) {
                                            setReplyingTo(null);
                                        }
                                    }}
                                    className="w-full resize-none border border-border rounded-md pl-3 pr-10 py-2.5 text-base bg-background focus:outline-none focus:ring-1 focus:ring-ring min-h-[48px]"
                                    style={{ maxHeight: "200px" }}
                                    rows={1}
                                />
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    className="absolute right-1 top-1 h-8 w-8 p-0 hover:bg-transparent"
                                    onClick={handleSendMessage}
                                    disabled={!messageText.trim()}
                                >
                                    <Send className="h-4 w-4 text-primary" />
                                </Button>
                            </div>
                            {/* Character count - only show when getting close to limit */}
                            {messageText.length > MAX_MESSAGE_LENGTH * 0.8 && (
                                <div className={`text-xs text-right mt-1 ${messageText.length >= MAX_MESSAGE_LENGTH ? "text-destructive" : "text-muted-foreground"}`}>
                                    {messageText.length}/{MAX_MESSAGE_LENGTH}
                                </div>
                            )}
                        </div>
                    ) : (
                        <div className="text-center text-sm text-muted-foreground py-2">
                            Sign in to send messages
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <TooltipProvider>
            <div className="h-full w-full flex flex-col bg-background text-foreground">
                <WebviewHeader title="Comments" vscode={vscode} />
                {selectedThread ? ThreadDetail() : ThreadList()}
            </div>
        </TooltipProvider>
    );
}

export default App;
