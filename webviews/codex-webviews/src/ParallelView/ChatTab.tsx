import React, { useEffect, useRef, useCallback, useState } from "react";
import { VSCodeDivider, VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import ReactMarkdown from "react-markdown";
import ChatInput from "./ChatInput";
import { ChatMessage } from "./types";
import { TranslationPair } from "../../../../types";

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

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);

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

    return (
        <div
            className="container"
            style={{ display: "flex", flexDirection: "column", height: "100%" }}
        >
            {/* Display Pinned Cell IDs */}
            <div
                style={{
                    padding: "10px",
                    backgroundColor: "var(--vscode-editor-background)",
                    borderBottom: "1px solid var(--vscode-panel-border)",
                }}
            >
                {pinnedVerses.length > 0 ? (
                    <div
                        style={{
                            display: "flex",
                            flexWrap: "wrap",
                            gap: "8px",
                        }}
                    >
                        {pinnedVerses.map((verse) => (
                            <VSCodeButton
                                key={verse.cellId}
                                appearance="secondary"
                                style={{
                                    padding: "4px 8px",
                                    minWidth: "auto",
                                }}
                            >
                                {verse.cellId}
                            </VSCodeButton>
                        ))}
                    </div>
                ) : (
                    <p>No pinned cells.</p>
                )}
            </div>

            {/* Updated Chat History section */}
            <div ref={chatHistoryRef} style={{ flex: 1, overflowY: "auto", minHeight: 0 }}>
                {chatHistory.length > 0 && (
                    <div className="chat-history">
                        {chatHistory.map((message, index) => (
                            <div
                                key={index}
                                className={`chat-message ${message.role}`}
                                style={{
                                    display: "flex",
                                    flexDirection: "column",
                                    width: "100%",
                                    ...(message.role === "user"
                                        ? messageStyles.user
                                        : messageStyles.assistant),
                                }}
                            >
                                <div
                                    style={{
                                        flex: 1,
                                        wordBreak: "break-word",
                                        whiteSpace: "pre-wrap",
                                    }}
                                >
                                    <ReactMarkdown>{message.content}</ReactMarkdown>
                                </div>
                                <div
                                    style={{
                                        display: "flex",
                                        justifyContent:
                                            message.role === "user" ? "flex-start" : "flex-end",
                                        marginTop: "8px",
                                        gap: "4px",
                                    }}
                                >
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
                    onChange={onChatInputChange}
                    onSubmit={onChatSubmit}
                    onFocus={onChatFocus}
                />
            </div>
        </div>
    );
}

export default React.memo(ChatTab);
