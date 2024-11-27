import React, { useEffect, useRef, useCallback, useState } from "react";
import {
    VSCodeButton,
    VSCodeTextField,
    VSCodeBadge,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";
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
    YoutubeVideoComponent,
} from "./ChatComponents";
import { format } from "date-fns";
import {
    UserFeedbackComponent,
    RegEx as UserChatRegEx,
    UserRequestsTranslation,
} from "./UserChatComponents";

interface SessionInfo {
    id: string;
    name: string;
    timestamp: string;
}

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
    sessionInfo: SessionInfo | null;
    allSessions: SessionInfo[];
    onStartNewSession: () => void;
    onLoadSession: (sessionId: string) => void;
    onDeleteSession: (sessionId: string) => void;
    setChatHistory: React.Dispatch<React.SetStateAction<ChatMessage[]>>;
    onSendFeedback: (originalText: string, feedbackText: string, cellId: string) => void;
    isSessionMenuOpen: boolean;
    setIsSessionMenuOpen: React.Dispatch<React.SetStateAction<boolean>>;
    onRequestTranslation: (cellId: string, sourceText: string) => void;
}

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
    sessionInfo,
    allSessions,
    onStartNewSession,
    onLoadSession,
    onDeleteSession,
    setChatHistory,
    onSendFeedback,
    isSessionMenuOpen,
    setIsSessionMenuOpen,
}: ChatTabProps) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const [pendingSubmit, setPendingSubmit] = useState(false);
    const [currentMessage, setCurrentMessage] = useState("");
    const [isStreaming, setIsStreaming] = useState(false);
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredSessions, setFilteredSessions] = useState(allSessions);
    const [pendingAssistantMessage, setPendingAssistantMessage] = useState<string | null>(null);

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);

    useEffect(() => {
        const filtered = allSessions
            .filter((session) => session.name.toLowerCase().includes(searchTerm.toLowerCase()))
            .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setFilteredSessions(filtered);

        if (searchTerm.length > 0) {
            setIsSessionMenuOpen(true);
        }
    }, [searchTerm, allSessions]);

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

    const handleIncomingChunk = useCallback(
        (message: any) => {
            if (message.command === "chatResponseStream") {
                try {
                    const parsedChunk = JSON.parse(message.data);
                    const { content, isLast } = parsedChunk;

                    if (content) {
                        setPendingAssistantMessage((prevMessage) => (prevMessage || "") + content);
                        setIsStreaming(true);
                    }

                    if (isLast) {
                        setChatHistory((prevHistory) => {
                            const newHistory = [...prevHistory];
                            const lastMessage = newHistory[newHistory.length - 1];
                            if (
                                lastMessage &&
                                lastMessage.role === "assistant" &&
                                !lastMessage.content
                            ) {
                                // Update the last message if it's an empty assistant message
                                lastMessage.content = pendingAssistantMessage || "";
                            } else {
                                // Add a new message only if there's content
                                if (pendingAssistantMessage) {
                                    newHistory.push({
                                        role: "assistant",
                                        content: pendingAssistantMessage,
                                    });
                                }
                            }
                            return newHistory;
                        });
                        setPendingAssistantMessage(null);
                        setIsStreaming(false);
                    }
                } catch (error) {
                    console.error("Error parsing chunk data:", error);
                }
            }
        },
        [pendingAssistantMessage, setChatHistory]
    );

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

        // Combine RegEx from ChatComponents and UserChatComponents
        const regexPatterns = [...Object.entries(RegEx), ...Object.entries(UserChatRegEx)];

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
                const propsString = earliestMatch.match[0];
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

    const handleSendFeedback = useCallback(
        (originalText: string, feedbackText: string, cellId: string) => {
            const newMessage: ChatMessage = {
                role: "user",
                content: `<UserFeedback cellId="${cellId}" originalText="${originalText}" feedbackText="${feedbackText}" />`,
            };
            setChatHistory((prev) => [...prev, newMessage]);

            onSendFeedback(originalText, feedbackText, cellId);
        },
        [setChatHistory, onSendFeedback]
    );

    const renderMessage = useCallback(
        (content: string, role: "user" | "assistant") => {
            console.log("Rendering message:", content);
            const parsedContent = parseMessage(content);
            console.log("Parsed content:", parsedContent);

            return (
                <>
                    {parsedContent.map((part, index) => {
                        console.log("Rendering part:", part);
                        if (part.type === "text") {
                            return (
                                <p
                                    key={index}
                                    dangerouslySetInnerHTML={{ __html: part.content || "" }}
                                />
                            );
                        } else if (part.type === "UserFeedback" && part.props) {
                            console.log("Rendering UserFeedback component");
                            return (
                                <UserFeedbackComponent
                                    key={`uf-${index}`}
                                    cellId={part.props.cellId}
                                    originalText={decodeURIComponent(part.props.originalText)}
                                    feedbackText={decodeURIComponent(part.props.feedbackText)}
                                />
                            );
                        } else if (part.type === "UserRequestsTranslation" && part.props) {
                            return (
                                <UserRequestsTranslation
                                    key={`ut-${index}`}
                                    cellId={part.props.cellId}
                                    sourceText={decodeURIComponent(part.props.sourceText)}
                                />
                            );
                        } else if (part.type === "IndividuallyTranslatedVerse" && part.props) {
                            return (
                                <IndividuallyTranslatedVerseComponent
                                    key={`tr-${index}`}
                                    text={part.props.text || ""}
                                    cellId={part.props.cellId}
                                    onApplyTranslation={onApplyTranslation}
                                    onSendFeedback={handleSendFeedback}
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
                        } else if (part.type === "YoutubeVideo" && part.props) {
                            return (
                                <YoutubeVideoComponent
                                    key={`yv-${index}`}
                                    videoId={part.props.videoId}
                                />
                            );
                        }
                        return null;
                    })}
                </>
            );
        },
        [onApplyTranslation, handleSendFeedback, handleAddedFeedback, handlePromptClick]
    );

    return (
        <div className="tab-container">
            <div className="session-management">
                <div className="session-controls">
                    <VSCodeTextField
                        placeholder="Search or create a session..."
                        value={searchTerm}
                        onChange={(e) => setSearchTerm((e.target as HTMLInputElement).value)}
                    >
                        <span slot="start" className="codicon codicon-search"></span>
                    </VSCodeTextField>
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => setIsSessionMenuOpen(!isSessionMenuOpen)}
                        title="Session list"
                    >
                        <span className="codicon codicon-clock"></span>
                    </VSCodeButton>
                </div>
                <div className="pinned-verses-section">
                    {pinnedVerses.length > 0 ? (
                        <div className="pinned-verses-list">
                            {pinnedVerses.map((verse) => (
                                <VSCodeBadge key={verse.cellId}>{verse.cellId}</VSCodeBadge>
                            ))}
                        </div>
                    ) : (
                        <br></br>
                    )}
                </div>
            </div>

            {(isSessionMenuOpen || searchTerm.length > 0) && (
                <div className="session-menu">
                    <div className="session-list">
                        {filteredSessions.map((session) => (
                            <div
                                key={session.id}
                                className={`session-item ${
                                    sessionInfo?.id === session.id ? "active" : ""
                                }`}
                            >
                                <div
                                    className="session-item-content"
                                    onClick={() => onLoadSession(session.id)}
                                >
                                    <span>{session.name}</span>
                                    {/* <span>{format(new Date(session.timestamp), "PP")}</span> */}
                                </div>
                                <div className="session-item-actions">
                                    <VSCodeButton
                                        appearance="icon"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            onDeleteSession(session.id);
                                        }}
                                        title="Delete session"
                                    >
                                        <span className="codicon codicon-trash"></span>
                                    </VSCodeButton>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            )}

            <div ref={chatHistoryRef} className="message-history">
                {chatHistory.length > 1 ? (
                    <div className="chat-messages">
                        {chatHistory.slice(1).map((message, index) =>
                            message.content ? (
                                <div key={index} className={`chat-message ${message.role}`}>
                                    {renderMessage(message.content, message.role)}
                                    <div className="chat-message-actions">
                                        {message.role === "user" && (
                                            <>
                                                <VSCodeButton
                                                    appearance="icon"
                                                    onClick={() => onEditMessage(index + 1)}
                                                    title="Edit message"
                                                >
                                                    <span className="codicon codicon-edit" />
                                                </VSCodeButton>
                                                <VSCodeButton
                                                    appearance="icon"
                                                    onClick={() =>
                                                        handleRedoMessage(
                                                            index + 1,
                                                            message.content
                                                        )
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
                            ) : null
                        )}
                        {pendingAssistantMessage && (
                            <div className="chat-message assistant">
                                {renderMessage(pendingAssistantMessage, "assistant")}
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
