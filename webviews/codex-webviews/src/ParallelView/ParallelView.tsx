import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeButton,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { OpenFileMessage, ChatMessage } from "./types";
import SearchTab from "./SearchTab";
import ChatTab from "./ChatTab";
import { TranslationPair } from "../../../../types";

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

                        // Skip processing if content is empty and isLast is true
                        if (chunk.isLast && !chunk.content) {
                            setChatHistory((prev) => {
                                const newHistory = [...prev];
                                if (newHistory.length > 0) {
                                    newHistory[newHistory.length - 1].isStreaming = false;
                                }
                                return newHistory;
                            });
                            // Reset indices for next stream
                            setNextChunkIndex(0);
                            setPendingChunks([]);
                            return;
                        }

                        setPendingChunks((prev) => [...prev, chunk]);

                        // If this is the last chunk, update the chat history
                        if (chunk.isLast) {
                            setChatHistory((prev) => {
                                const newHistory = [...prev];
                                if (newHistory.length > 0) {
                                    newHistory[newHistory.length - 1].isStreaming = false;
                                }
                                return newHistory;
                            });
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
                    break;
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
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
    const handleApplyTranslation = (translation: string, cellId: string) => {
        vscode.postMessage({
            command: "applyTranslation",
            translation: translation,
            cellId: cellId,
        });
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

        sendMessage(chatInput);
        setChatInput("");
    };

    const sendMessage = (messageContent: string) => {
        const newHistory: ChatMessage[] = [
            ...chatHistory,
            {
                role: "user",
                content: messageContent,
            },
            {
                role: "assistant",
                content: "",
                isStreaming: true,
            },
        ];

        setChatHistory(newHistory);

        vscode.postMessage({
            command: "chatStream",
            query: messageContent,
            context: verses.map((verse) => verse.cellId),
        });
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

    useEffect(() => {
        // Request current session info and all sessions on component mount
        vscode.postMessage({ command: "getCurrentChatSessionInfo" });
        vscode.postMessage({ command: "getAllChatSessions" });
    }, []);

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab-search">Search</VSCodePanelTab>
            <VSCodePanelTab id="tab-chat">Chat</VSCodePanelTab>

            {/* Search Tab */}
            <VSCodePanelView id="view-search">
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
            </VSCodePanelView>

            {/* Chat Tab */}
            <VSCodePanelView id="view-chat">
                <ChatTab
                    chatHistory={chatHistory}
                    chatInput={chatInput}
                    onChatInputChange={setChatInput}
                    onChatSubmit={handleChatSubmit}
                    onChatFocus={handleChatFocus}
                    onEditMessage={handleEditMessage}
                    messageStyles={messageStyles}
                    pinnedVerses={pinnedVerses}
                    onApplyTranslation={handleApplyTranslation}
                    handleAddedFeedback={handleAddedFeedback}
                    sessionInfo={sessionInfo}
                    allSessions={allSessions}
                    onStartNewSession={handleStartNewSession}
                    onLoadSession={handleLoadSession}
                    onDeleteSession={handleDeleteSession}
                    setChatHistory={setChatHistory}
                    onSendFeedback={handleSendFeedback}
                />
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
