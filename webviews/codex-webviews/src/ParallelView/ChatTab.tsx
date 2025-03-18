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
    PinnedVerseComponent,
} from "./ChatComponents";
import { format } from "date-fns";
import { UserFeedbackComponent, RegEx as UserChatRegEx } from "./UserChatComponents";

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
    onUnpinVerse: (cellId: string) => void;
}

const ChatTab: React.FC<ChatTabProps> = ({
    chatHistory,
    chatInput,
    onChatInputChange,
    onChatSubmit,
    onChatFocus,
    onEditMessage,
    pinnedVerses,
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
    onUnpinVerse,
}) => {
    const chatHistoryRef = useRef<HTMLDivElement>(null);
    const sessionMenuRef = useRef<HTMLDivElement>(null);
    const [searchTerm, setSearchTerm] = useState("");
    const [filteredSessions, setFilteredSessions] = useState(allSessions);
    const [isChatFocused, setIsChatFocused] = useState(chatHistory.length > 1);
    const [showSessionDropdown, setShowSessionDropdown] = useState(false);
    const [pinnedSectionCollapsed, setPinnedSectionCollapsed] = useState(true);
    
    // Handle clicks outside of the session dropdown to close it
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (sessionMenuRef.current && !sessionMenuRef.current.contains(event.target as Node)) {
                setShowSessionDropdown(false);
            }
        };
        
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    // Auto-scroll to the bottom of the chat when new messages arrive
    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);

    // Update filtered sessions when search term or allSessions changes
    useEffect(() => {
        setIsChatFocused(chatHistory.length > 1);
        
        const filtered = searchTerm ? 
            allSessions.filter(s => s.name.toLowerCase().includes(searchTerm.toLowerCase()))
                .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
            : allSessions;
        setFilteredSessions(filtered);
    }, [searchTerm, allSessions, chatHistory]);

    // Handle editing a message and submitting again
    const handleRedoMessage = useCallback(
        (index: number, content: string) => {
            onEditMessage(index);
            onChatInputChange(content);
            setTimeout(() => onChatSubmit(), 0);
        },
        [onEditMessage, onChatInputChange, onChatSubmit]
    );

    // Handle clicking on a suggested prompt
    const handlePromptClick = useCallback(
        (prompt: string) => {
            onChatInputChange(prompt);
            onChatSubmit();
        },
        [onChatInputChange, onChatSubmit]
    );

    // Process message content for special components
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
                    earliestMatch = { regex, match, type };
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

                // Skip AutomatedSuccess components
                if (earliestMatch.type !== "AutomatedSuccess") {
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

    // Function to handle sending feedback for translated verses
    const handleSendFeedback = useCallback(
        (originalText: string, feedbackText: string, cellId: string) => {
            onSendFeedback(originalText, feedbackText, cellId);
        },
        [onSendFeedback]
    );

    // Render a chat message with its special components
    const renderMessage = useCallback(
        (content: string, role: "user" | "assistant") => {
            const parsedContent = parseMessage(content);

            if (
                parsedContent.length === 0 ||
                (parsedContent.length === 1 &&
                    parsedContent[0].type === "text" &&
                    !parsedContent[0].content?.trim())
            ) {
                return null;
            }

            return (
                <>
                    {parsedContent.map((part, index) => {
                        if (part.type === "text" && part.content?.trim()) {
                            return (
                                <p
                                    key={index}
                                    dangerouslySetInnerHTML={{ __html: part.content || "" }}
                                />
                            );
                        } else if (part.type === "UserFeedback" && part.props) {
                            return (
                                <UserFeedbackComponent
                                    key={`uf-${index}`}
                                    cellId={part.props.cellId}
                                    originalText={decodeURIComponent(part.props.originalText)}
                                    feedbackText={decodeURIComponent(part.props.feedbackText)}
                                />
                            );
                        } else if (part.type === "IndividuallyTranslatedVerse" && part.props) {
                            return (
                                <IndividuallyTranslatedVerseComponent
                                    key={`tr-${index}`}
                                    text={part.props.text || ""}
                                    cellId={part.props.cellId}
                                    onSendFeedback={handleSendFeedback}
                                />
                            );
                        } else if (part.type === "AddedFeedback" && part.props) {
                            return (
                                <AddedFeedbackComponent
                                    key={`af-${index}`}
                                    feedback={part.props.feedback}
                                    cellId={part.props.cellId}
                                    handleAddedFeedback={handleAddedFeedback}
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
                                    onClick={handlePromptClick}
                                />
                            );
                        } else if (part.type === "YoutubeVideo" && part.props) {
                            return (
                                <YoutubeVideoComponent
                                    key={`yv-${index}`}
                                    videoId={part.props.videoId}
                                />
                            );
                        } else if (part.type === "PinnedVerse" && part.props) {
                            return (
                                <PinnedVerseComponent
                                    key={`pv-${index}`}
                                    cellId={part.props.cellId}
                                    sourceText={decodeURIComponent(part.props.sourceText)}
                                    targetText={part.props.targetText ? decodeURIComponent(part.props.targetText) : undefined}
                                    onUnpin={onUnpinVerse}
                                />
                            );
                        }
                        return null;
                    })}
                </>
            );
        },
        [handleSendFeedback, handleAddedFeedback, handlePromptClick, onUnpinVerse]
    );

    const handleFocus = () => {
        setIsChatFocused(true);
        onChatFocus();
    };

    // Handle session management
    const toggleSessionDropdown = () => {
        setShowSessionDropdown(prev => !prev);
        setSearchTerm("");
    };

    const handleNewSession = () => {
        onStartNewSession();
        setShowSessionDropdown(false);
    };

    const handleLoadSession = (sessionId: string) => {
        onLoadSession(sessionId);
        setShowSessionDropdown(false);
    };

    // Render session list item
    const renderSessionItem = (session: SessionInfo) => (
        <div 
            key={session.id} 
            className={`session-item ${sessionInfo?.id === session.id ? "active" : ""}`}
        >
            <div className="session-item-content" onClick={() => handleLoadSession(session.id)}>
                <span className="session-name">{session.name}</span>
                <span className="session-date">
                    {format(new Date(session.timestamp), "MMM d, yyyy 'at' h:mm a")}
                </span>
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
    );

    // Render empty state for when there are no messages
    const renderEmptyState = () => (
        <div className="empty-state">
            <div className="empty-state-icon codicon codicon-book"></div>
            <p className="empty-state-description">
                Ask questions about verse translations, get help with complex passages, 
                or discuss contextual meanings.
            </p>
            <div className="empty-state-action">
                <VSCodeButton onClick={() => {
                    onChatInputChange("Help me translate this verse");
                    onChatSubmit();
                }}>
                    Start Translation
                </VSCodeButton>
            </div>
        </div>
    );

    // Toggle handler for pinned verses section
    const togglePinnedSection = () => {
        setPinnedSectionCollapsed(!pinnedSectionCollapsed);
    };

    return (
        <div className={`tab-container ${isChatFocused ? 'chat-focused' : ''}`}>
            {/* Compact header with minimal controls */}
            <div className="session-management">
                <div className="chat-header">
                    <div className="chat-header-left">
                        {sessionInfo && (
                            <div className="current-session">
                                <span className="session-label">Current Session:</span>
                                <span className="session-name">{sessionInfo.name}</span>
                            </div>
                        )}
                    </div>
                    
                    <div className="chat-header-actions">
                        {/* Pin indicator */}
                        {pinnedVerses.length > 0 && (
                            <div className="pin-indicator">
                                <span className="codicon codicon-pin"></span>
                                <VSCodeBadge>{pinnedVerses.length}</VSCodeBadge>
                            </div>
                        )}
                        
                        {/* Session dropdown trigger */}
                        <div className="session-dropdown-container" ref={sessionMenuRef}>
                            <VSCodeButton 
                                appearance="icon"
                                onClick={toggleSessionDropdown}
                                title="Sessions"
                                className={showSessionDropdown ? 'active' : ''}
                            >
                                <span className="codicon codicon-history"></span>
                            </VSCodeButton>
                            
                            {/* Session dropdown menu */}
                            {showSessionDropdown && (
                                <div className="sessions-dropdown">
                                    <div className="dropdown-header">
                                        <h3>Translation Sessions</h3>
                                        <div className="dropdown-actions">
                                            <VSCodeButton 
                                                appearance="icon" 
                                                onClick={handleNewSession}
                                                title="New Session"
                                            >
                                                <span className="codicon codicon-add"></span>
                                            </VSCodeButton>
                                        </div>
                                    </div>
                                    
                                    <div className="dropdown-search">
                                        <VSCodeTextField
                                            placeholder="Search sessions..."
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm((e.target as HTMLInputElement).value)}
                                        >
                                            <span slot="start" className="codicon codicon-search"></span>
                                            {searchTerm && (
                                                <span 
                                                    slot="end" 
                                                    className="codicon codicon-close"
                                                    style={{ cursor: 'pointer' }}
                                                    onClick={() => setSearchTerm('')}
                                                ></span>
                                            )}
                                        </VSCodeTextField>
                                    </div>
                                    
                                    <VSCodeDivider />
                                    
                                    <div className="session-list">
                                        {filteredSessions.length > 0 ? (
                                            filteredSessions.map(renderSessionItem)
                                        ) : (
                                            <div className="empty-sessions">
                                                <p>No sessions found {searchTerm && `matching "${searchTerm}"`}</p>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                        
                        {/* New session button */}
                        <VSCodeButton 
                            appearance="icon"
                            onClick={handleNewSession}
                            title="New Session"
                        >
                            <span className="codicon codicon-new-file"></span>
                        </VSCodeButton>
                    </div>
                </div>
                
                {/* Display pinned verses badges if any */}
                {pinnedVerses.length > 0 && (
                    <div className="pinned-verses-section">
                        <div 
                            className={`collapse-toggle ${!pinnedSectionCollapsed ? 'expanded' : ''}`}
                            onClick={togglePinnedSection}
                        >
                            <span className="collapse-icon codicon codicon-chevron-right"></span>
                            <span className="pinned-verses-label">
                                Pinned ({pinnedVerses.length}):
                            </span>
                        </div>
                        
                        {!pinnedSectionCollapsed && (
                            <div className="pinned-verses-list">
                                {pinnedVerses.map((verse) => (
                                    <VSCodeBadge key={verse.cellId}>{verse.cellId}</VSCodeBadge>
                                ))}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Chat message history */}
            <div ref={chatHistoryRef} className="message-history">
                {chatHistory.length > 1 ? (
                    <div className="chat-messages">
                        {chatHistory
                            .slice(1)
                            .filter(message => !message.content.includes("don't-render") && message.content.trim() !== "")
                            .map((message, index) => (
                                <div key={index} className={`chat-bubble ${message.role}`}>
                                    <div className="message-header">
                                        <div className={`avatar ${message.role}`}>
                                            {message.role === 'user' ? 'U' : 'C'}
                                        </div>
                                        <div className="message-info">
                                            <span className="message-sender">
                                                {message.role === 'user' ? 'You' : 'Codex Assistant'}
                                            </span>
                                            {message.isStreaming && (
                                                <div className="typing-indicator">
                                                    <span></span>
                                                    <span></span>
                                                    <span></span>
                                                </div>
                                            )}
                                        </div>
                                        <div className="message-actions">
                                            {message.role === 'user' && (
                                                <button 
                                                    className="action-button" 
                                                    onClick={() => handleRedoMessage(
                                                        chatHistory.indexOf(message), message.content
                                                    )} 
                                                    title="Edit message"
                                                >
                                                    <span className="codicon codicon-edit"></span>
                                                </button>
                                            )}
                                            <button 
                                                className="action-button" 
                                                onClick={() => onCopy(message.content)} 
                                                title="Copy"
                                            >
                                                <span className="codicon codicon-copy"></span>
                                            </button>
                                        </div>
                                    </div>
                                    
                                    <div className="message-content">
                                        {renderMessage(message.content, message.role)}
                                    </div>
                                    
                                    {!message.isStreaming && message.role === 'assistant' && (
                                        <div className="message-status sent">
                                            <span className="codicon codicon-check"></span>
                                            <span>Completed</span>
                                        </div>
                                    )}
                                </div>
                            ))}
                    </div>
                ) : (
                    renderEmptyState()
                )}
            </div>

            {/* Chat input area */}
            <div className="chat-input-wrapper">
                <ChatInput
                    value={chatInput}
                    onChange={onChatInputChange}
                    onSubmit={onChatSubmit}
                    onFocus={handleFocus}
                    placeholder="Type your translation question..."
                    disabled={false}
                />
            </div>
        </div>
    );
};

export default React.memo(ChatTab);
