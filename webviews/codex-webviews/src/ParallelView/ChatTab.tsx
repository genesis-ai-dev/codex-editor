import React from "react";
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
                    display: "flex",
                    flexDirection: "column",
                }}
            >
                <h3>Pinned Cell IDs:</h3>
                {pinnedVerses.length > 0 ? (
                    <ul style={{ listStyleType: "none", paddingLeft: 0 }}>
                        {pinnedVerses.map((verse) => (
                            <li
                                key={verse.cellId}
                                style={{
                                    display: "flex",
                                    alignItems: "center",
                                    marginBottom: "4px",
                                }}
                            >
                                {/* Example icon usage */}
                                {/* <VSCodeIcon icon="symbol-property" style={{ marginRight: "8px" }} /> */}
                                <span>{verse.cellId}</span>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <p>No pinned cells.</p>
                )}
            </div>

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
                                            message.role === "user" ? "flex-start" : "flex-end",
                                        marginTop: "8px",
                                        gap: "4px",
                                    }}
                                >
                                    {message.role === "user" && (
                                        <VSCodeButton
                                            appearance="icon"
                                            onClick={() => onEditMessage(index)}
                                            title="Edit message"
                                        >
                                            <span className="codicon codicon-edit" />
                                        </VSCodeButton>
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

export default ChatTab;
