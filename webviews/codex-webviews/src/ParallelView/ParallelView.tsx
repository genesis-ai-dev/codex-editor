import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeButton,
    VSCodeBadge,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { OpenFileMessage, ChatMessage } from "./types";
import SearchTab from "./SearchTab";
import ChatTab from "./ChatTab";
import { TranslationPair } from "../../../../types";
import { WebviewHeader } from "../components/WebviewHeader";

const vscode = acquireVsCodeApi();

// Add these CSS changes to your App.css file or create them inline in the component
const messageStyles = {
    user: {
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "12px",
        padding: "12px 16px",
        marginBottom: "16px",
        width: "100%",
        border: "1px solid var(--vscode-widget-border)",
    },
    assistant: {
        backgroundColor: "var(--vscode-button-background)",
        borderRadius: "12px",
        padding: "12px 16px",
        marginBottom: "16px",
        width: "100%",
        color: "var(--vscode-button-foreground)",
    },
};

// Add this new type
interface SessionInfo {
    id: string;
    name: string;
    timestamp: string;
}

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [pinnedVerses, setPinnedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [chatInput, setChatInput] = useState<string>("");
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [pendingChunks, setPendingChunks] = useState<{ index: number; content: string }[]>([]);
    const [nextChunkIndex, setNextChunkIndex] = useState(0);
    const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);
    const [completeOnly, setCompleteOnly] = useState<boolean>(false);
    const [sessionInfo, setSessionInfo] = useState<SessionInfo | null>(null);
    const [allSessions, setAllSessions] = useState<SessionInfo[]>([]);
    const [loadedMessages, setLoadedMessages] = useState<ChatMessage[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [isSessionMenuOpen, setIsSessionMenuOpen] = useState(true);
    const [activeTab, setActiveTab] = useState<"search" | "chat">("search");
    const [pinnedCount, setPinnedCount] = useState<number>(0);

    // Helper function to process pending chunks in order
    const processNextChunk = () => {
        const nextChunk = pendingChunks.find((chunk) => chunk.index === nextChunkIndex);
        if (nextChunk) {
            setChatHistory((prev) => {
                const newHistory = [...prev];
                if (newHistory.length === 0 || !newHistory[newHistory.length - 1].isStreaming) {
                    return [
                        ...prev,
                        {
                            role: "assistant",
                            content: nextChunk.content,
                            isStreaming: true,
                        },
                    ];
                }

                const lastMessage = newHistory[newHistory.length - 1];
                lastMessage.content = lastMessage.content + nextChunk.content;
                return [...newHistory];
            });

            // Remove processed chunk and increment next expected index
            setPendingChunks((prev) => prev.filter((chunk) => chunk.index !== nextChunkIndex));
            setNextChunkIndex((prev) => prev + 1);
        }
    };

    // Process pending chunks whenever they change
    useEffect(() => {
        processNextChunk();
    }, [pendingChunks, nextChunkIndex]);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "searchResults":
                    setVerses([...pinnedVerses, ...(message.data as TranslationPair[])]);
                    // Auto-switch to search tab when search results arrive
                    setActiveTab("search");
                    break;
                case "pinCell": {
                    // Check if the cell is already pinned
                    const isAlreadyPinned = pinnedVerses.some(
                        (verse) => verse.cellId === message.data.cellId
                    );

                    if (isAlreadyPinned) {
                        // Remove the verse if it's already pinned
                        setPinnedVerses((prev) =>
                            prev.filter((verse) => verse.cellId !== message.data.cellId)
                        );
                        // Also update verses to remove the unpinned cell
                        setVerses((prev) =>
                            prev.filter((verse) => verse.cellId !== message.data.cellId)
                        );
                    } else {
                        // Add the new verse if it's not already pinned
                        setPinnedVerses((prev) => [...prev, message.data]);
                        setVerses((prev) => {
                            const exists = prev.some(
                                (verse) => verse.cellId === message.data.cellId
                            );
                            if (!exists) {
                                return [...prev, message.data];
                            }
                            return prev;
                        });
                    }
                    break;
                }
                case "chatResponseStream":
                    try {
                        const chunk = JSON.parse(message.data);

                        setChatHistory((prev) => {
                            const newHistory = [...prev];
                            if (newHistory.length === 0 || !isStreaming) {
                                return [
                                    ...prev,
                                    {
                                        role: "assistant",
                                        content: chunk.content,
                                        isStreaming: true,
                                    },
                                ];
                            }

                            const lastMessage = newHistory[newHistory.length - 1];
                            lastMessage.content += chunk.content;
                            return [...newHistory];
                        });

                        setIsStreaming(true);

                        // Auto-switch to chat tab when receiving a message
                        setActiveTab("chat");

                        // If this is the last chunk, don't end streaming yet
                        if (chunk.isLast) {
                            // Reset indices for next stream
                            setNextChunkIndex(0);
                            setPendingChunks([]);
                        }
                    } catch (error) {
                        console.error("Error parsing chunk:", error);
                    }
                    break;
                case "chatResponseComplete":
                    // This case is now handled in the chatResponseStream case when isLast is true
                    break;
                case "updateSessionInfo":
                    setSessionInfo(message.data);
                    // Don't clear chat history here, as it's handled in handleStartNewSession
                    break;
                case "updateAllSessions":
                    setAllSessions(message.data);
                    break;
                case "loadedSessionData":
                    // Replace the entire chat history with the loaded messages
                    setChatHistory(message.data.messages);
                    setSessionInfo(message.data.sessionInfo);
                    setActiveTab("chat");
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [pinnedVerses, isStreaming]);

    // Update pinned count for badge
    useEffect(() => {
        setPinnedCount(pinnedVerses.length);
    }, [pinnedVerses]);

    const handleUriClick = (uri: string, word: string) => {
        console.log("handleUriClick", uri, word);
        vscode.postMessage({
            command: "openFileAtLocation",
            uri,
            word: word,
        } as OpenFileMessage);
    };

    const searchBoth = (query: string, event?: React.FormEvent) => {
        if (event) {
            event.preventDefault();
        }
        setLastQuery(query);
        vscode.postMessage({
            command: "search",
            query: query,
            completeOnly: completeOnly,
        });
    };

    const handlePinToggle = (item: TranslationPair, isPinned: boolean) => {
        if (isPinned) {
            setPinnedVerses([...pinnedVerses, item]);
        } else {
            setPinnedVerses(pinnedVerses.filter((v) => v.cellId !== item.cellId));
        }
    };

    const handleEditMessage = (index: number) => {
        if (chatHistory[index].role === "user") {
            // Delete all messages after the edited message
            setChatHistory((prev) => prev.slice(0, index + 1));
            setEditingMessageIndex(index);
            setChatInput(chatHistory[index].content);

            // Scroll to and focus the chat input
            setTimeout(() => {
                const textarea = document.querySelector("vscode-text-area") as HTMLElement;
                if (textarea) {
                    textarea.scrollIntoView({ behavior: "smooth" });
                    textarea.focus();
                }
            }, 0);
        }
    };

    const handleChatSubmit = () => {
        if (!chatInput.trim()) return;

        // End streaming when a new user message is sent
        setIsStreaming(false);
        setChatHistory((prev) => {
            const newHistory = [...prev];
            if (newHistory.length > 0) {
                newHistory[newHistory.length - 1].isStreaming = false;
            }
            return newHistory;
        });

        sendMessage(chatInput);
        setChatInput("");
        setIsSessionMenuOpen(false);

        // Auto-switch to chat tab when sending a message
        setActiveTab("chat");
    };

    // Helper function to strip HTML tags from content
    const stripHtmlTags = (html: string) => {
        // Use a simple regex to remove HTML tags
        return html.replace(/<[^>]*>/g, "");
    };

    const handleUnpinVerse = (cellId: string) => {
        // Remove the verse from pinned verses
        setPinnedVerses((prev) => prev.filter((verse) => verse.cellId !== cellId));
    };

    const sendMessage = (messageContent: string) => {
        // Format pinned verses to include in the message using the PinnedVerse component
        let fullMessage = messageContent;

        // Only add the pinned verses if there are any and the message is not a feedback message
        if (pinnedVerses.length > 0 && !messageContent.includes("<UserFeedback")) {
            // Convert pinned verses to PinnedVerse components in the message
            const pinnedVersesComponents = pinnedVerses
                .map((verse) => {
                    const sourceText = stripHtmlTags(
                        verse.sourceCell?.content || "No source text available"
                    );
                    const targetText = stripHtmlTags(verse.targetCell?.content || "");

                    return `<PinnedVerse cellId="${verse.cellId}" sourceText="${encodeURIComponent(
                        sourceText
                    )}" targetText="${encodeURIComponent(targetText)}" />`;
                })
                .join("\n");

            // Add the PinnedVerse components to the user's message
            fullMessage = `${messageContent}\n\n${pinnedVersesComponents}`;
        }

        const newHistory: ChatMessage[] = [
            ...chatHistory,
            {
                role: "user",
                content: fullMessage,
            },
        ];

        setChatHistory(newHistory);

        // Also add the plain text version for the API
        const plainTextPinnedVerses =
            pinnedVerses.length > 0 && !messageContent.includes("<UserFeedback")
                ? pinnedVerses
                      .map((verse) => {
                          const sourceText = stripHtmlTags(
                              verse.sourceCell?.content || "No source text available"
                          );
                          const targetText = stripHtmlTags(verse.targetCell?.content || "");

                          return `\n---\nVerse: ${verse.cellId}\nSource: ${sourceText}\nTarget: ${
                              targetText ? `${targetText}` : ""
                          }`;
                      })
                      .join("\n")
                : "";

        const apiMessage =
            pinnedVerses.length > 0 && !messageContent.includes("<UserFeedback")
                ? `${messageContent}\n\nCONTEXT (PINNED VERSES):${plainTextPinnedVerses}\n---`
                : messageContent;

        vscode.postMessage({
            command: "chatStream",
            query: apiMessage,
            context: [], // Empty context as we're now including verses directly in the message
        });

        // Automatically unpin all verses after they've been included in a message
        // but only if this is not a feedback message
        if (pinnedVerses.length > 0 && !messageContent.includes("<UserFeedback")) {
            setPinnedVerses([]);
        }
    };

    const handleSendFeedback = (originalText: string, feedbackText: string, cellId: string) => {
        const feedbackContent = `<UserFeedback cellId="${cellId}" originalText="${originalText}" feedbackText="${feedbackText}" />`;
        sendMessage(feedbackContent);
    };

    const handleChatFocus = () => {
        setVerses([...pinnedVerses]);
    };

    const handleAddedFeedback = (cellId: string, feedback: string) => {
        console.log("handleAddedFeedback", cellId, feedback);
        vscode.postMessage({
            command: "addedFeedback",
            cellId: cellId,
            feedback: feedback,
        });
    };

    const handlePinAll = () => {
        const unpinnedVerses = verses.filter(
            (verse) => !pinnedVerses.some((pinned) => pinned.cellId === verse.cellId)
        );
        setPinnedVerses([...pinnedVerses, ...unpinnedVerses]);
    };

    const handleStartNewSession = () => {
        vscode.postMessage({ command: "startNewChatSession" });
        // Clear chat history and add an initial system message
        // setChatHistory([
        //     {
        //         role: "system",
        //         content: "New session started. How can I assist you today?",
        //     },
        // ]);
    };

    const handleLoadSession = (sessionId: string) => {
        vscode.postMessage({
            command: "loadChatSession",
            sessionId: sessionId,
        });
        // Clear chat history immediately in the frontend
        setChatHistory([]);
    };

    const handleDeleteSession = (sessionId: string) => {
        vscode.postMessage({
            command: "deleteChatSession",
            sessionId: sessionId,
        });
        // Remove the deleted session from the allSessions state
        setAllSessions((prevSessions) =>
            prevSessions.filter((session) => session.id !== sessionId)
        );
    };

    const handleChangeTab = (tabName: "search" | "chat") => {
        setActiveTab(tabName);
    };

    useEffect(() => {
        // Request current session info and all sessions on component mount
        vscode.postMessage({ command: "getCurrentChatSessionInfo" });
        vscode.postMessage({ command: "getAllChatSessions" });
    }, []);

    return (
        <div className="parallel-view-container">
            <WebviewHeader title="Parallel Passages" vscode={vscode} />
            <div className="tab-navigation">
                <div
                    className={`tab-button ${activeTab === "search" ? "active" : ""}`}
                    onClick={() => handleChangeTab("search")}
                >
                    <span className="codicon codicon-search"></span>
                    <span className="tab-label">Search</span>
                </div>
                <div
                    className={`tab-button ${activeTab === "chat" ? "active" : ""}`}
                    onClick={() => handleChangeTab("chat")}
                >
                    <span className="codicon codicon-comment"></span>
                    <span className="tab-label">Chat</span>
                    {chatHistory.length > 0 && <VSCodeBadge>{chatHistory.length}</VSCodeBadge>}
                </div>
                <div className="pinned-indicator">
                    <span className="codicon codicon-pin"></span>
                    {pinnedCount > 0 && <VSCodeBadge>{pinnedCount}</VSCodeBadge>}
                </div>
            </div>

            <VSCodeDivider />

            <div className="tab-content">
                <div className={`tab-panel ${activeTab === "search" ? "active" : ""}`}>
                    <SearchTab
                        verses={verses}
                        pinnedVerses={pinnedVerses}
                        lastQuery={lastQuery}
                        onQueryChange={setLastQuery}
                        completeOnly={completeOnly}
                        onCompleteOnlyChange={setCompleteOnly}
                        onSearch={searchBoth}
                        onPinToggle={handlePinToggle}
                        onUriClick={handleUriClick}
                        onPinAll={handlePinAll}
                    />
                </div>

                <div className={`tab-panel ${activeTab === "chat" ? "active" : ""}`}>
                    <ChatTab
                        chatHistory={chatHistory}
                        chatInput={chatInput}
                        onChatInputChange={setChatInput}
                        onChatSubmit={handleChatSubmit}
                        onChatFocus={handleChatFocus}
                        onEditMessage={handleEditMessage}
                        messageStyles={messageStyles}
                        pinnedVerses={pinnedVerses}
                        handleAddedFeedback={handleAddedFeedback}
                        sessionInfo={sessionInfo}
                        allSessions={allSessions}
                        onStartNewSession={handleStartNewSession}
                        onLoadSession={handleLoadSession}
                        onDeleteSession={handleDeleteSession}
                        setChatHistory={setChatHistory}
                        onSendFeedback={handleSendFeedback}
                        isSessionMenuOpen={isSessionMenuOpen}
                        setIsSessionMenuOpen={setIsSessionMenuOpen}
                        onUnpinVerse={handleUnpinVerse}
                    />
                </div>
            </div>
        </div>
    );
}

export default ParallelView;
