import React, { useState, useEffect } from "react";
import {
    VSCodePanelTab,
    VSCodePanelView,
    VSCodePanels,
    VSCodeDivider,
    VSCodeTextArea,
    VSCodeButton,
} from "@vscode/webview-ui-toolkit/react";
import "./App.css";
import { OpenFileMessage } from "./types";
import { TranslationPair } from "../../../../types";
import ReactMarkdown from "react-markdown";
import SearchBar from "./SearchBar";
import VerseItem from "./CellItem";
import ChatInput from "./ChatInput";

// Add new interface for chat messages
interface ChatMessage {
    role: "user" | "assistant";
    content: string;
    isStreaming?: boolean;
    isEditing?: boolean;
}

const vscode = acquireVsCodeApi();

// Add these CSS changes to your App.css file or create them inline in the component
const messageStyles = {
    user: {
        backgroundColor: "var(--vscode-editor-background)",
        borderRadius: "12px 12px 12px 0",
        padding: "12px 16px",
        marginBottom: "16px",
        maxWidth: "85%",
        alignSelf: "flex-start",
        border: "1px solid var(--vscode-widget-border)",
    },
    assistant: {
        backgroundColor: "var(--vscode-button-background)",
        borderRadius: "12px 12px 0 12px",
        padding: "12px 16px",
        marginBottom: "16px",
        maxWidth: "85%",
        alignSelf: "flex-end",
        color: "var(--vscode-button-foreground)",
    },
};

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [pinnedVerses, setPinnedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [chatInput, setChatInput] = useState<string>("");
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [pendingChunks, setPendingChunks] = useState<{ index: number; content: string }[]>([]);
    const [nextChunkIndex, setNextChunkIndex] = useState(0);
    const [editingMessageIndex, setEditingMessageIndex] = useState<number | null>(null);

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
                        setPendingChunks((prev) => [...prev, chunk]);
                    } catch (error) {
                        console.error("Error parsing chunk:", error);
                    }
                    break;
                case "chatResponseComplete":
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
            database: "both",
            query: query,
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

        if (editingMessageIndex !== null) {
            // Update the edited message
            setChatHistory((prev) => {
                const newHistory = prev.slice(0, editingMessageIndex + 1);
                newHistory[editingMessageIndex] = {
                    ...newHistory[editingMessageIndex],
                    content: chatInput,
                };
                return newHistory;
            });

            // Send edit request
            vscode.postMessage({
                command: "chatStream",
                query: chatInput,
                context: verses.map((verse) => verse.cellId),
                editIndex: editingMessageIndex,
            });

            setEditingMessageIndex(null);
        } else {
            // Normal message submission
            setChatHistory((prev) => [
                ...prev,
                {
                    role: "user",
                    content: chatInput,
                },
            ]);

            vscode.postMessage({
                command: "chatStream",
                query: chatInput,
                context: verses.map((verse) => verse.cellId),
            });
        }

        setChatInput("");
    };

    const handleChatFocus = () => {
        setVerses([...pinnedVerses]);
    };

    const handleCopy = async (content: string) => {
        try {
            await navigator.clipboard.writeText(content);
            // Optional: Show some feedback that the copy was successful
            vscode.postMessage({
                command: "showInfo",
                text: "Copied to clipboard",
            });
        } catch (err) {
            console.error("Failed to copy text: ", err);
        }
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab-search">Search</VSCodePanelTab>
            <VSCodePanelTab id="tab-chat">Chat</VSCodePanelTab>

            {/* Search Tab */}
            <VSCodePanelView id="view-search">
                <div
                    className="container"
                    style={{ display: "flex", flexDirection: "column", height: "100%" }}
                >
                    <div
                        style={{
                            backgroundColor: "transparent",
                            flexShrink: 0,
                        }}
                    >
                        <SearchBar
                            query={lastQuery}
                            onQueryChange={setLastQuery}
                            onSearch={(event) => searchBoth(lastQuery, event)}
                        />
                        <VSCodeDivider />
                    </div>

                    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                        {verses.length > 0 ? (
                            <div className="verses-container">
                                {verses.map((item, index) => (
                                    <VerseItem
                                        key={index}
                                        item={item}
                                        onUriClick={handleUriClick}
                                        isPinned={pinnedVerses.some(
                                            (v) => v.cellId === item.cellId
                                        )}
                                        onPinToggle={handlePinToggle}
                                    />
                                ))}
                            </div>
                        ) : (
                            <p className="no-results">
                                No results found. Try a different search query.
                            </p>
                        )}
                    </div>
                </div>
            </VSCodePanelView>

            {/* Chat Tab */}
            <VSCodePanelView id="view-chat">
                <div
                    className="container"
                    style={{ display: "flex", flexDirection: "column", height: "100%" }}
                >
                    {/* Context Display - Changed to only show pinnedVerses */}
                    {pinnedVerses.length > 0 && (
                        <div
                            style={{
                                backgroundColor: "var(--vscode-editor-background)",
                                padding: "8px",
                                marginBottom: "8px",
                                borderRadius: "4px",
                                fontSize: "12px",
                                color: "var(--vscode-descriptionForeground)",
                            }}
                        >
                            <div style={{ marginBottom: "4px" }}>
                                Context from {pinnedVerses.length} pinned results:
                            </div>
                            <div
                                style={{
                                    display: "flex",
                                    flexWrap: "wrap",
                                    gap: "4px",
                                }}
                            >
                                {pinnedVerses.map((verse) => (
                                    <span
                                        key={verse.cellId}
                                        style={{
                                            background: "var(--vscode-badge-background)",
                                            color: "var(--vscode-badge-foreground)",
                                            padding: "3px 8px",
                                            borderRadius: "4px",
                                            fontSize: "12px",
                                            fontWeight: "500",
                                            letterSpacing: "0.3px",
                                        }}
                                    >
                                        {verse.cellId}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Existing Chat History */}
                    <div style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                        {chatHistory.length > 0 && (
                            <div className="chat-history">
                                {chatHistory.map((message, index) => (
                                    <div
                                        key={index}
                                        className={`chat-message ${message.role}`}
                                        style={{
                                            display: "flex",
                                            flexDirection: "column",
                                            ...(message.role === "user"
                                                ? messageStyles.user
                                                : messageStyles.assistant),
                                        }}
                                    >
                                        <div style={{ flex: 1 }}>
                                            <ReactMarkdown>{message.content}</ReactMarkdown>
                                        </div>
                                        <div
                                            style={{
                                                display: "flex",
                                                justifyContent:
                                                    message.role === "user"
                                                        ? "flex-start"
                                                        : "flex-end",
                                                marginTop: "8px",
                                                gap: "4px",
                                            }}
                                        >
                                            {message.role === "user" && (
                                                <VSCodeButton
                                                    appearance="icon"
                                                    onClick={() => handleEditMessage(index)}
                                                    title="Edit message"
                                                >
                                                    <span className="codicon codicon-edit" />
                                                </VSCodeButton>
                                            )}
                                            {message.role === "assistant" &&
                                                !message.isStreaming && (
                                                    <VSCodeButton
                                                        appearance="icon"
                                                        onClick={() => handleCopy(message.content)}
                                                        title="Copy response"
                                                    >
                                                        <span className="codicon codicon-copy" />
                                                    </VSCodeButton>
                                                )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Existing Chat Input */}
                    <div
                        style={{
                            backgroundColor: "transparent",
                            flexShrink: 0,
                        }}
                    >
                        <VSCodeDivider />
                        <ChatInput
                            value={chatInput}
                            onChange={setChatInput}
                            onSubmit={handleChatSubmit}
                            onFocus={handleChatFocus}
                        />
                    </div>
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
