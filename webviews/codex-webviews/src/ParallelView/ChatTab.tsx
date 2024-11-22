import React, { useEffect, useRef, useCallback, useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import ChatInput from "./ChatInput";
import { ChatMessage } from "./types";
import { TranslationPair } from "../../../../types";
import "./SharedStyles.css";
import {
    onCopy,
    RegEx,
    IndividuallyTranslatedVerseComponent,
    ShowUserPreferenceComponent,
    AddedFeedbackComponent,
    GuessNextPromptsComponent,
} from "./ChatComponents";

interface ChatTabProps {
    chatHistory: ChatMessage[];
    chatInput: string;
    onChatInputChange: (input: string) => void;
    onChatSubmit: () => void;
    onChatFocus: () => void;
    onEditMessage: (index: number) => void;
    messageStyles: {
        user: React.CSSProperties;
        assistant: React.CSSProperties;
    };
    pinnedVerses: TranslationPair[];
    onApplyTranslation: (cellId: string, text: string) => void;
    handleAddedFeedback: (cellId: string, feedback: string) => void;
}

const components = {
    VSCodeButton,
    IndividuallyTranslatedVerseComponent,
    AddedFeedbackComponent,
    ShowUserPreferenceComponent,
    GuessNextPromptsComponent,
};

function ChatTab({
    chatHistory,
    chatInput,
    onChatInputChange,
    onChatSubmit,
    onChatFocus,
    onEditMessage,
    pinnedVerses,
    onApplyTranslation,
    handleAddedFeedback,
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

    const handlePromptClick = useCallback(
        (prompt: string) => {
            onChatInputChange(prompt);
            onChatSubmit();
        },
        [onChatInputChange, onChatSubmit]
    );

    useEffect(() => {
        const handleMessage = (event: MessageEvent) => {
            if (event.data.command === "chatResponseStream") {
                handleIncomingChunk(event.data.data);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [handleIncomingChunk]);

    const parseMessage = (content: string) => {
        const parts = [];
        let lastIndex = 0;

        // Get all component regex patterns from RegEx
        const regexPatterns = Object.entries(RegEx);

        for (let i = 0; i < content.length; ) {
            let earliestMatch: {
                regex: RegExp;
                match: RegExpExecArray;
                type: string;
            } | null = null;

            // Find the earliest matching component
            for (const [type, regex] of regexPatterns) {
                regex.lastIndex = i;
                const match = regex.exec(content);
                if (match && (!earliestMatch || match.index < earliestMatch.match.index)) {
                    earliestMatch = {
                        regex,
                        match,
                        type,
                    };
                }
            }

            if (earliestMatch) {
                // Add text content before the component if any
                if (earliestMatch.match.index > lastIndex) {
                    parts.push({
                        type: "text",
                        content: content.slice(lastIndex, earliestMatch.match.index),
                    });
                }

                // Parse the component props
                const propsString = earliestMatch.match[1];
                const propsMatch = propsString.match(/(\w+)="([^"]*)"/g);

                if (propsMatch) {
                    const props = Object.fromEntries(
                        propsMatch.map((prop) => {
                            const [key, value] = prop.split("=");
                            return [key, value.replace(/(^")|("$)/g, "")];
                        })
                    );
                    parts.push({ type: earliestMatch.type, props });
                }

                lastIndex = earliestMatch.regex.lastIndex;
                i = lastIndex;
            } else {
                // No more components found, add remaining text
                parts.push({
                    type: "text",
                    content: content.slice(lastIndex),
                });
                break;
            }
        }

        return parts;
    };

    const renderMessage = useCallback((content: string) => {
        const parsedContent = parseMessage(content);

        return (
            <>
                {parsedContent.map((part, index) => {
                    if (part.type === "text") {
                        return (
                            <p
                                key={index}
                                dangerouslySetInnerHTML={{ __html: part.content || "" }}
                            />
                        );
                    } else if (part.type === "IndividuallyTranslatedVerse" && part.props) {
                        return (
                            <IndividuallyTranslatedVerseComponent
                                key={`tr-${index}`}
                                text={part.props.text || ""}
                                cellId={part.props.cellId}
                                onApplyTranslation={onApplyTranslation}
                            />
                        );
                    } else if (part.type === "AddedFeedback" && part.props) {
                        return (
                            <AddedFeedbackComponent
                                key={`af-${index}`}
                                feedback={part.props.feedback}
                                cellId={part.props.cellId}
                                handleAddedFeedback={(cellId, feedback) =>
                                    handleAddedFeedback(cellId, feedback)
                                }
                            />
                        );
                    } else if (part.type === "ShowUserPreference" && part.props) {
                        return (
                            <ShowUserPreferenceComponent
                                key={`sf-${index}`}
                                feedback={part.props.feedback}
                                cellId={part.props.cellId}
                            />
                        );
                    } else if (part.type === "GuessNextPrompts" && part.props) {
                        return (
                            <GuessNextPromptsComponent
                                key={`gp-${index}`}
                                prompts={part.props.prompts.split(",")}
                                onClick={(prompt) => handlePromptClick(prompt)}
                            />
                        );
                    }
                    return null;
                })}
            </>
        );
    }, []);

    return (
        <div className="tab-container">
            <div className="pinned-verses">
                <h3>Pinned Verses:</h3>
                <p className="select-target-instruction">
                    These verses are used as context for conversing with the Codex Assistant. You
                    may edit them in the 'search' tab.
                </p>
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
                                {renderMessage(message.content)}
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
                                {renderMessage(currentMessage)}
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
