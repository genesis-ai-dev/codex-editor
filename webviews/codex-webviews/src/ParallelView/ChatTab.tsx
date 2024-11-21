import React, { useEffect, useRef, useCallback, useState } from "react";
import { VSCodeDivider, VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import ReactMarkdown from "react-markdown";
import ChatInput from "./ChatInput";
import { ChatMessage } from "./types";
import { TranslationPair } from "../../../../types";
import "./SharedStyles.css";

interface ChatTabProps {
    chatHistory: ChatMessage[];
    chatInput: string;
    onChatInputChange: (input: string) => void;
    onChatSubmit: () => void;
    onChatFocus: () => void;
    onEditMessage: (index: number) => void;
    onCopy: (content: string) => void;
    messageStyles: {
        user: React.CSSProperties;
        assistant: React.CSSProperties;
    };
    pinnedVerses: TranslationPair[];
}

const reconstructMessage = (content: string | object): string => {
    // If content is already a string, return it directly
    if (typeof content === "string") {
        return content;
    }

    // If content is an object, check if it has a 'content' property
    if (typeof content === "object" && content !== null && "content" in content) {
        return content.content as string;
    }

    // If it's an object but doesn't have a 'content' property, stringify it
    return JSON.stringify(content);
};

function ChatTab({
    chatHistory,
    chatInput,
    onChatInputChange,
    onChatSubmit,
    onChatFocus,
    onEditMessage,
    onCopy,
    messageStyles,
    pinnedVerses,
}: ChatTabProps) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const [pendingSubmit, setPendingSubmit] = useState(false);
    const [currentMessage, setCurrentMessage] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory, currentMessage]);

    const handleRedoMessage = useCallback(
        (index: number, content: string) => {
            onEditMessage(index);
            onChatInputChange(content);
            setPendingSubmit(true);
        },
        [onEditMessage, onChatInputChange]
    );

    useEffect(() => {
        if (pendingSubmit) {
            onChatSubmit();
            setPendingSubmit(false);
        }
    }, [pendingSubmit, onChatSubmit]);

    const handleIncomingChunk = useCallback((message: any) => {
        if (message.command === "chatResponseStream") {
            try {
                const parsedChunk = JSON.parse(message.data);
                const { content, isLast } = parsedChunk;

                if (content) {
                    setCurrentMessage((prevMessage) => prevMessage + content);
                    setIsStreaming(true);
                }
            } catch (error) {
                console.error("Error parsing chunk data:", error);
            }
        } else if (message.command === "chatResponseComplete") {
            setIsStreaming(false);
        }
    }, []);

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.command === "chatResponseStream") {
                handleIncomingChunk(event.data.data);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleIncomingChunk]);

    return (
        <div className="tab-container">
            <div className="pinned-verses">
                <h3>Pinned Verses:</h3>
                {pinnedVerses.length > 0 ? (
                    <div className="pinned-verses-list">
                        {pinnedVerses.map((verse) => (
                            <span key={verse.cellId} className="pinned-verse-id">
                                {verse.cellId}
                            </span>
                        ))}
                    </div>
                ) : (
                    <p>No pinned verses.</p>
                )}
            </div>

            <div ref={chatHistoryRef} className="message-history">
                {chatHistory.length > 0 ? (
                    <div className="chat-messages">
                        {chatHistory.map((message, index) => (
                            <div key={index} className={`chat-message ${message.role}`}>
                                <div className="chat-message-content">
                                    <ReactMarkdown>
                                        {reconstructMessage(message.content)}
                                    </ReactMarkdown>
                                </div>
                                <div className="chat-message-actions">
                                    {message.role === "user" && (
                                        <>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => onEditMessage(index)}
                                                title="Edit message"
                                            >
                                                <span className="codicon codicon-edit" />
                                            </VSCodeButton>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() =>
                                                    handleRedoMessage(index, message.content)
                                                }
                                                title="Redo message"
                                            >
                                                <span className="codicon codicon-refresh" />
                                            </VSCodeButton>
                                            <VSCodeButton
                                                appearance="icon"
                                                onClick={() => onCopy(message.content)}
                                                title="Copy message"
                                            >
                                                <span className="codicon codicon-copy" />
                                            </VSCodeButton>
                                        </>
                                    )}
                                    {message.role === "assistant" && !message.isStreaming && (
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={() => onCopy(message.content)}
                                            title="Copy response"
                                        >
                                            <span className="codicon codicon-copy" />
                                        </VSCodeButton>
                                    )}
                                </div>
                            </div>
                        ))}
                        {isStreaming && (
                            <div className="chat-message assistant">
                                <div className="chat-message-content">
                                    <ReactMarkdown>{currentMessage}</ReactMarkdown>
                                </div>
                            </div>
                        )}
                    </div>
                ) : (
                    <div className="chat-empty-message">No messages yet. Start a conversation!</div>
                )}
            </div>

            <div className="input-container">
                <ChatInput
                    value={chatInput}
                    onChange={onChatInputChange}
                    onSubmit={onChatSubmit}
                    onFocus={onChatFocus}
                />
            </div>
        </div>
    );
}

export default React.memo(ChatTab);
