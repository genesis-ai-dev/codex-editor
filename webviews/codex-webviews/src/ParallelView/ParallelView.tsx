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
}

const vscode = acquireVsCodeApi();

function ParallelView() {
    const [verses, setVerses] = useState<TranslationPair[]>([]);
    const [lockedVerses, setLockedVerses] = useState<TranslationPair[]>([]);
    const [lastQuery, setLastQuery] = useState<string>("");
    const [chatInput, setChatInput] = useState<string>("");
    const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
    const [pendingChunks, setPendingChunks] = useState<{ index: number; content: string }[]>([]);
    const [nextChunkIndex, setNextChunkIndex] = useState(0);

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
            if (message.command === "searchResults") {
                setVerses([...lockedVerses, ...(message.data as TranslationPair[])]);
            } else if (message.command === "chatResponseStream") {
                try {
                    const chunk = JSON.parse(message.data);
                    setPendingChunks((prev) => [...prev, chunk]);
                } catch (error) {
                    console.error("Error parsing chunk:", error);
                }
            } else if (message.command === "chatResponseComplete") {
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
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [lockedVerses]);

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

    const handleLockToggle = (item: TranslationPair, isLocked: boolean) => {
        if (isLocked) {
            setLockedVerses([...lockedVerses, item]);
        } else {
            setLockedVerses(lockedVerses.filter((v) => v.cellId !== item.cellId));
        }
    };

    const handleChatSubmit = () => {
        if (!chatInput.trim()) return;

        // Add user message to history immediately
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
        setChatInput("");
    };

    const handleChatFocus = () => {
        setVerses([...lockedVerses]);
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="tab1">Parallel Passages</VSCodePanelTab>
            <VSCodePanelView id="view1">
                <div className="container">
                    <SearchBar
                        query={lastQuery}
                        onQueryChange={setLastQuery}
                        onSearch={(event) => {
                            searchBoth(lastQuery, event);
                        }}
                    />
                    <VSCodeDivider />
                    {verses.length > 0 ? (
                        <div className="verses-container">
                            {verses.map((item, index) => (
                                <VerseItem
                                    key={index}
                                    item={item}
                                    onUriClick={handleUriClick}
                                    isLocked={lockedVerses.some((v) => v.cellId === item.cellId)}
                                    onLockToggle={handleLockToggle}
                                />
                            ))}
                        </div>
                    ) : (
                        <p className="no-results">
                            No results found. Try a different search query.
                        </p>
                    )}
                    <VSCodeDivider />
                    {chatHistory.length > 0 && (
                        <div className="chat-history">
                            {chatHistory.map((message, index) => (
                                <div
                                    key={index}
                                    className={`chat-message ${message.role}`}
                                    style={{
                                        padding: "12px",
                                        margin: "12px 0",
                                        background: "var(--vscode-editor-background)",
                                        borderRadius: "6px",
                                        borderLeft:
                                            message.role === "assistant"
                                                ? "4px solid var(--vscode-textLink-foreground)"
                                                : "none",
                                    }}
                                >
                                    <ReactMarkdown>{message.content}</ReactMarkdown>
                                </div>
                            ))}
                        </div>
                    )}
                    <VSCodeDivider />
                    <ChatInput
                        value={chatInput}
                        onChange={setChatInput}
                        onSubmit={handleChatSubmit}
                        onFocus={handleChatFocus}
                    />
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
}

export default ParallelView;
