import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import {
    MessageSquare,
    Plus,
    ChevronLeft,
    ChevronDown,
    ChevronRight,
    Check,
    X,
    Trash2,
    Undo2,
    Send,
    Hash,
    Clock,
    MoreHorizontal,
    ArrowDownUp,
    MapPin,
} from "lucide-react";
import { Button } from "../components/ui/button";
import { Badge } from "../components/ui/badge";
import { NotebookCommentThread, CommentPostMessages, CellIdGlobalState } from "../../../../types";
import { v4 as uuidv4 } from "uuid";
import { WebviewHeader } from "../components/WebviewHeader";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "../components/ui/tooltip";
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "../components/ui/dropdown-menu";
import bibleBooksData from "../assets/bible-books-lookup.json";

const vscode = acquireVsCodeApi();
type Comment = NotebookCommentThread["comments"][0];
type SortMode = "location" | "time-increasing" | "time-decreasing";

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
    const [uri, setUri] = useState<string>();
    const [commentThreadArray, setCommentThread] = useState<NotebookCommentThread[]>([]);
    const [messageText, setMessageText] = useState("");
    const [selectedThread, setSelectedThread] = useState<string | null>(null);
    const [pendingResolveThreads, setPendingResolveThreads] = useState<Set<string>>(new Set());
    const [newThreadText, setNewThreadText] = useState("");
    const [currentSectionExpanded, setCurrentSectionExpanded] = useState(true);
    const [allSectionExpanded, setAllSectionExpanded] = useState(false);
    const newThreadRef = useRef<HTMLTextAreaElement>(null);
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

    const [expandedThreads, setExpandedThreads] = useState<Set<string>>(new Set());
    const [replyingTo, setReplyingTo] = useState<{ threadId: string; username?: string } | null>(
        null
    );
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [threadTitleEdit, setThreadTitleEdit] = useState<string>("");
    
    // Sort configuration
    const [sortMode, setSortMode] = useState<SortMode>("location");

    // Helper function to determine if thread is currently resolved based on latest event
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

    // Create a map of Bible books for ordering
    const bibleBookMap = useMemo(() => {
        const map = new Map<string, { name: string; abbr: string; ord: string; testament: string }>();
        (bibleBooksData as any[]).forEach((book) => {
            map.set(book.abbr, {
                name: book.name,
                abbr: book.abbr,
                ord: book.ord,
                testament: book.testament,
            });
            // Also map by full name for flexibility
            map.set(book.name, {
                name: book.name,
                abbr: book.abbr,
                ord: book.ord,
                testament: book.testament,
            });
        });
        return map;
    }, []);

    // Helper to determine if project uses Bible terminology based on data
    //const isBibleProject = useMemo(() => {
    //    // Check if any thread has Bible-style references (e.g., "GEN 1:1")
    //    return commentThreadArray.some(thread => {
    //        const refs = thread.cellId.globalReferences || [];
    //        return refs.some(ref => /^[A-Z0-9]{3}\s+\d+:\d+/.test(ref));
    //    });
    //}, [commentThreadArray]);

    // Get appropriate label for missing data
    const getMissingLabel = useCallback((type: "file" | "milestone" | "cell"): string => {
        //if (isBibleProject) {
            switch (type) {
                case "file": return "No Book Name";
                case "milestone": return "No Chapter Number";
                case "cell": return "No Verse Number";
            }
        //} else {
        //    switch (type) {
        //        case "file": return "No File Name";
        //        case "milestone": return "No Milestone Value";
        //        case "cell": return "No Cell Number";
        //    }
        //}
    }, []);//[isBibleProject]);

    // Helper to get sort order from fileDisplayName (using canonical Bible book order)
    const getFileSortOrder = useCallback((fileDisplayName: string | undefined): string => {
        if (!fileDisplayName) return "999";
        
        // Try to look up in bible book map
        const bookInfo = bibleBookMap.get(fileDisplayName);
        if (bookInfo) {
            return bookInfo.ord; // "01", "02", etc.
        }
        
        // For non-Bible books, return a high number so they sort after Bible books
        return "999";
    }, [bibleBookMap]);

    // Sort threads based on current sort mode
    const sortThreads = useCallback((threads: NotebookCommentThread[]): NotebookCommentThread[] => {
        const getLatestTimestamp = (thread: NotebookCommentThread) => {
            const timestamps = thread.comments.map((c) => c.timestamp);
            return Math.max(...timestamps);
        };

        switch (sortMode) {
            case "time-increasing":
                return [...threads].sort((a, b) => getLatestTimestamp(a) - getLatestTimestamp(b));
            
            case "time-decreasing":
                return [...threads].sort((a, b) => getLatestTimestamp(b) - getLatestTimestamp(a));
            
            case "location":
                return [...threads].sort((a, b) => {
                    const aFile = a.cellId.fileDisplayName || getMissingLabel("file");
                    const bFile = b.cellId.fileDisplayName || getMissingLabel("file");
                    
                    // Get sort orders for canonical Bible book ordering
                    const aOrder = getFileSortOrder(a.cellId.fileDisplayName);
                    const bOrder = getFileSortOrder(b.cellId.fileDisplayName);
                    
                    // Sort by canonical order (Bible books first by ord, then non-Bible alphabetically)
                    const orderCompare = aOrder.localeCompare(bOrder);
                    if (orderCompare !== 0) return orderCompare;
                    
                    // If same sort order, sort by file display name
                    const fileCompare = aFile.localeCompare(bFile);
                    if (fileCompare !== 0) return fileCompare;
                    
                    // Then by milestone
                    const aMilestone = a.cellId.milestoneValue || getMissingLabel("milestone");
                    const bMilestone = b.cellId.milestoneValue || getMissingLabel("milestone");
                    const milestoneCompare = aMilestone.localeCompare(bMilestone);
                    if (milestoneCompare !== 0) return milestoneCompare;
                    
                    // Then by line number
                    const aLine = a.cellId.cellLineNumber ?? Number.MAX_SAFE_INTEGER;
                    const bLine = b.cellId.cellLineNumber ?? Number.MAX_SAFE_INTEGER;
                    return aLine - bLine;
                });
            
            default:
                return threads;
        }
    }, [sortMode, getMissingLabel, getFileSortOrder]);

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

    // Sort function for threads
    const byLatestActivity = (a: NotebookCommentThread, b: NotebookCommentThread) => {
        const aTime = Math.max(...a.comments.map((c) => c.timestamp));
        const bTime = Math.max(...b.comments.map((c) => c.timestamp));
        return bTime - aTime;
    };

    // Sort threads: unresolved first, then resolved
    const sortThreads = (threads: NotebookCommentThread[]) => {
        const unresolved = threads.filter((t) => !isThreadResolved(t));
        const resolved = threads.filter((t) => isThreadResolved(t));
        return [...unresolved.sort(byLatestActivity), ...resolved.sort(byLatestActivity)];
    };

    // Threads for current cell
    const currentCellThreads = useMemo(() => {
        const nonDeleted = commentThreadArray.filter((t) => !isThreadDeleted(t));
        const filtered = nonDeleted.filter((t) => cellId.cellId && t.cellId.cellId === cellId.cellId);
        return sortThreads(filtered);
    }, [commentThreadArray, cellId.cellId, isThreadDeleted, isThreadResolved]);

    // All threads (excluding current cell to avoid duplicates)
    const allOtherThreads = useMemo(() => {
        const nonDeleted = commentThreadArray.filter((t) => !isThreadDeleted(t));
        const filtered = nonDeleted.filter((t) => !cellId.cellId || t.cellId.cellId !== cellId.cellId);
        return sortThreads(filtered);
    }, [commentThreadArray, cellId.cellId, isThreadDeleted, isThreadResolved]);

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

//Conflict: added by 593:
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

        // New format: CellIdGlobalState object
        // Build display string from available fields: fileDisplayName · milestoneValue · cellLabel
        const displayParts: string[] = [];

        if (cellIdState.fileDisplayName) {
            displayParts.push(cellIdState.fileDisplayName);
        }
        if (cellIdState.milestoneValue) {
            displayParts.push(cellIdState.milestoneValue);
        }
        if (cellIdState.cellLabel) {
            displayParts.push(cellIdState.cellLabel);
        }

        if (displayParts.length > 0) {
            return displayParts.join(" · ");
        }

        // Fallback: Use globalReferences if available (for stored comments)
        if (cellIdState.globalReferences && cellIdState.globalReferences.length > 0) {
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

        // Fallback: shortened cellId
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

        // Apply sorting
        return sortThreads(filtered);
    }, [commentThreadArray, searchQuery, viewMode, cellId.cellId, showResolvedThreads, sortThreads, isThreadDeleted, isThreadResolved]);

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
      //Conflict: added by incoming
    const handleDeleteComment = (commentId: string, threadId: string) => {
        vscode.postMessage({ command: "deleteComment", args: { commentId, commentThreadId: threadId } });
    };

    const handleUndoDelete = (commentId: string, threadId: string) => {
        vscode.postMessage({ command: "undoCommentDeletion", args: { commentId, commentThreadId: threadId } });
    };
      //Conflict: end of conflict

    // Render message content (without reply prefix)
    const renderMessageContent = (content: string) => {
        return content.split("\n").map((line, i, arr) => (
            <span key={i}>
                {line}
                {i < arr.length - 1 && <br />}
            </span>
        ));
    };

    // Render a thread item
    const renderThreadItem = (thread: NotebookCommentThread) => {
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
    };

    // Extract ThreadCard component to avoid duplication
    const ThreadCard = ({ thread }: { thread: NotebookCommentThread }) => (
                                <Card
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
/*    // Thread list view with collapsible sections
    const ThreadList = () => (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto">
                {/* Current Cell Section */}
                <div className="border-b border-border">
                    {/* Section header */}
                    <button
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setCurrentSectionExpanded(!currentSectionExpanded)}
                    >
                        {currentSectionExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-sm">
                            {cellId.cellId ? getCellLabel(cellId) : "Current Cell"}
                        </span>
                        <span className="text-xs text-muted-foreground ml-auto">
                            {currentCellThreads.length} {currentCellThreads.length === 1 ? "thread" : "threads"}
                        </span>
                    </button>

                    {/* Section content */}
                    {currentSectionExpanded && (
                        <div className="pb-2">
                            {/* Inline new thread input */}
                            {currentUser.isAuthenticated && cellId.cellId && (
                                <div className="px-3 py-2">
                                    <div className="relative w-full">
                                        <textarea
                                            ref={newThreadRef}
                                            placeholder="Start a new thread..."
                                            value={newThreadText}
                                            onChange={(e) => setNewThreadText(e.target.value)}
                                            onKeyDown={(e) => {
                                                if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                                                    e.preventDefault();
                                                    handleCreateThread();
                                                } else if (e.key === "Escape") {
                                                    setNewThreadText("");
                                                    newThreadRef.current?.blur();
                                                }
                                            }}
                                            className="w-full resize-none border border-border rounded-md pl-3 pr-10 py-2 text-sm bg-background focus:outline-none focus:ring-1 focus:ring-ring min-h-[40px]"
                                            rows={1}
                                        />
                                        <Button
                                            variant="ghost"
                                            size="sm"
                                            className="absolute right-1 top-1 h-7 w-7 p-0 hover:bg-transparent"
                                            onClick={handleCreateThread}
                                            disabled={!newThreadText.trim()}
                                        >
                                            <Plus className="h-4 w-4 text-primary" />
                                        </Button>
                                    </div>
                                </div>
                            )}

                            {/* Thread list for current cell */}
                            {currentCellThreads.length === 0 ? (
                                <div className="px-3 py-4 text-center text-muted-foreground text-sm">
                                    No threads on this cell yet
                                </div>
                            ) : (
                                currentCellThreads.map(renderThreadItem)
                            )}
                        </div>
                    )}
                </div>

                {/* All Threads Section */}
                <div>
                    {/* Section header */}
                    <button
                        className="w-full px-3 py-2 flex items-center gap-2 hover:bg-muted/30 transition-colors text-left"
                        onClick={() => setAllSectionExpanded(!allSectionExpanded)}
                    >
                        {allSectionExpanded ? (
                            <ChevronDown className="h-4 w-4 text-muted-foreground" />
                        ) : (
                            <ChevronRight className="h-4 w-4 text-muted-foreground" />
                        )}
                        <span className="font-medium text-sm">All Other Threads</span>
                        <span className="text-xs text-muted-foreground ml-auto">
                            {allOtherThreads.length} {allOtherThreads.length === 1 ? "thread" : "threads"}
                        </span>
                    </button>

                    {/* Section content */}
                    {allSectionExpanded && (
                        <div className="pb-2">
                            {allOtherThreads.length === 0 ? (
                                <div className="px-3 py-4 text-center text-muted-foreground text-sm">
                                    No other threads
                                </div>
                            ) : (
                                allOtherThreads.map(renderThreadItem)
                            )}
                        </div>
                    )}
                </div>
            </div>
        </div>
    ); */

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
                                                    </div>
                                                )}
                                            </div>
                                        </div>

                                        <div className="flex justify-between text-xs text-muted-foreground">
                                            <div className="flex gap-2 items-center min-w-0">
                                                <span
                                                    className="text-primary truncate"
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
                                                {thread.cellId.cellLineNumber != null && (
                                                    <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                                                        Cell {thread.cellId.cellLineNumber}
                                                    </Badge>
                                                )}
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
                                            </div>
                                        </CardContent>
                                    )}
                                </Card>
    );

    // Component for rendering location-grouped comments
    const LocationGroupedComments = ({ threads }: { threads: NotebookCommentThread[] }) => {
        // Group by file, then milestone
        const grouped = threads.reduce((acc, thread) => {
            const file = thread.cellId.fileDisplayName || getMissingLabel("file");
            const milestone = thread.cellId.milestoneValue || getMissingLabel("milestone");
            
            if (!acc[file]) acc[file] = {};
            if (!acc[file][milestone]) acc[file][milestone] = [];
            acc[file][milestone].push(thread);
            
            return acc;
        }, {} as Record<string, Record<string, NotebookCommentThread[]>>);

        return (
            <div className="flex flex-col gap-2">
                {Object.entries(grouped).map(([fileName, milestones]) => (
                    <div key={fileName} className="flex flex-col">
                        <div className="px-4 py-2 bg-muted/30 font-semibold text-sm sticky top-0 z-10">
                            {fileName}
                        </div>
                        {Object.entries(milestones).map(([milestoneName, threadsInMilestone]) => (
                            <div key={`${fileName}-${milestoneName}`} className="flex flex-col">
                                <div className="px-6 py-1.5 bg-muted/20 font-medium text-xs text-muted-foreground">
                                    {milestoneName}
                                </div>
                                <div className="ml-8 flex flex-col gap-2 mb-2">
                                    {threadsInMilestone.map((thread) => (
                                        <ThreadCard key={thread.id} thread={thread} />
                            ))}
                        </div>
                    </div>
                        ))}
                    </div>
                ))}
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

                        <div className="flex gap-2 items-center">
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

                            {/* Sort dropdown - only show in "all" view mode */}
                            {viewMode === "all" && (
                                <DropdownMenu>
                                    <DropdownMenuTrigger asChild>
                                        <Button variant="outline" size="icon" title="Sort comments">
                                            <ArrowDownUp className="h-4 w-4" />
                                        </Button>
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end">
                                        <DropdownMenuItem
                                            onClick={() => setSortMode("location")}
                                            className={sortMode === "location" ? "bg-accent" : ""}
                                        >
                                            <MapPin className="h-4 w-4 mr-2" />
                                            Location in Project
                                            {sortMode === "location" && <Check className="h-4 w-4 ml-auto" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => setSortMode("time-increasing")}
                                            className={sortMode === "time-increasing" ? "bg-accent" : ""}
                                        >
                                            <Clock className="h-4 w-4 mr-2" />
                                            Time Increasing
                                            {sortMode === "time-increasing" && <Check className="h-4 w-4 ml-auto" />}
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() => setSortMode("time-decreasing")}
                                            className={sortMode === "time-decreasing" ? "bg-accent" : ""}
                                        >
                                            <Clock className="h-4 w-4 mr-2" />
                                            Time Decreasing
                                            {sortMode === "time-decreasing" && <Check className="h-4 w-4 ml-auto" />}
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            )}
                        </div>
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
                        {sortMode === "location" && viewMode === "all" ? (
                            <LocationGroupedComments threads={filteredCommentThreads} />
                        ) : (
                            <div className="flex flex-col gap-3">
                                {filteredCommentThreads.map((thread) => (
                                    <ThreadCard key={thread.id} thread={thread} />
                                ))}
                            </div>
                        )}
                    </div>
                )}

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
