import React, { useEffect, useRef, useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import ReactMarkdown from "react-markdown";
import { TranslationPair } from "../../../../types";
import "./SharedStyles.css";

export interface TeachMessageBase {
    role: "user" | "assistant";
    content: string;
}

export interface UserMessage extends TeachMessageBase {
    role: "user";
}

export interface AssistantMessage extends TeachMessageBase {
    role: "assistant";
    message: string;
    thinking: string[];
    translation: string;
    memoriesUsed: string[];
    memoryUpdates?: { cellId: string; content: string; reason: string }[];
}

export type TeachMessage = UserMessage | AssistantMessage;

interface TeachTabProps {
    chatHistory: TeachMessage[];
    chatInput: string;
    onChatInputChange: (input: string) => void;
    onChatSubmit: () => void;
    onChatFocus: () => void;
    onCopy: (content: string) => void;
    messageStyles: {
        user: React.CSSProperties;
        assistant: React.CSSProperties;
    };
    pinnedVerses: TranslationPair[];
    onSelectTargetPassage: (cellId: string) => void;
    targetPassage: string | null;
    isLoading: boolean;
    onNavigateToNextPinnedCell: () => void;
    applyTranslation: (translation: string, cellId: string) => void;
    hasNextPinnedCell: boolean;
}

const defaultAssistantMessage: AssistantMessage = {
    role: "assistant",
    content: "Here's an example of how I'll respond to your query.",
    message: "This is a default message.",
    thinking: [
        "1. Analyze the verse and context",
        "2. Consider translation pairs",
        "3. Apply linguistic principles",
        "4. Draft initial translation",
        "5. Refine and finalize",
    ],
    translation: "This is where the translated verse or response will appear.",
    memoriesUsed: ["Example relevant information 1", "Example relevant information 2"],
    memoryUpdates: [
        {
            cellId: "1",
            content: "New information or insight gained from this interaction",
            reason: "Reason for update",
        },
    ],
};

function TeachTab({
    chatHistory,
    chatInput,
    onChatInputChange,
    onChatSubmit,
    onChatFocus,
    onCopy,
    pinnedVerses,
    onSelectTargetPassage,
    targetPassage,
    isLoading,
    onNavigateToNextPinnedCell,
    applyTranslation,
    hasNextPinnedCell,
}: TeachTabProps) {
    const chatHistoryRef = useRef<HTMLDivElement>(null);

    const [expandedThoughts, setExpandedThoughts] = useState<Set<number>>(new Set());

    const toggleThoughts = (index: number) => {
        setExpandedThoughts((prev) => {
            const newSet = new Set(prev);
            if (newSet.has(index)) {
                newSet.delete(index);
            } else {
                newSet.add(index);
            }
            return newSet;
        });
    };

    useEffect(() => {
        if (chatHistoryRef.current) {
            chatHistoryRef.current.scrollTop = chatHistoryRef.current.scrollHeight;
        }
    }, [chatHistory]);

    const renderTranslationResponse = (message: AssistantMessage, index: number) => {
        return (
            <>
                <div
                    className={`silver-path-segment thinking-silver-path ${
                        expandedThoughts.has(index) ? "expanded" : ""
                    }`}
                >
                    <h3 onClick={() => toggleThoughts(index)}>Thinking Process</h3>
                    <ul>
                        {message.thinking.map((thought, idx) => (
                            <li key={idx}>{thought}</li>
                        ))}
                    </ul>
                </div>
                <div className="silver-path-segment">
                    <h3>Message</h3>
                    <p>{message.message}</p>
                </div>
                <div className="silver-path-segment translation-silver-path">
                    <h3>Translation / Response</h3>
                    <div
                        className="translation-content-silver-path silver-path-code"
                        dangerouslySetInnerHTML={{
                            __html: message.translation,
                        }}
                    />
                    <div className="translation-actions-silver-path">
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => onCopy(message.translation)}
                            title="Copy translation"
                        >
                            <span className="codicon codicon-copy"></span>
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="icon"
                            onClick={() => {
                                if (targetPassage) {
                                    applyTranslation(message.translation, targetPassage);
                                }
                            }}
                            title="Apply translation"
                        >
                            <span className="codicon codicon-check"></span>
                        </VSCodeButton>
                    </div>
                </div>

                <div className="silver-path-segment memories-silver-path">
                    <h3>Relevant Information</h3>
                    {message.memoriesUsed.length > 0 ? (
                        <ul>
                            {message.memoriesUsed.map((memory, idx) => (
                                <li key={idx}>{memory}</li>
                            ))}
                        </ul>
                    ) : (
                        <p>No relevant information used for this response.</p>
                    )}
                </div>

                {message.memoryUpdates && message.memoryUpdates.length > 0 && (
                    <div className="silver-path-segment new-memory-silver-path">
                        <h3>New Information</h3>
                        <ul>
                            {message.memoryUpdates?.map((memory, idx) => (
                                <li key={idx}>{memory.content}</li>
                            ))}
                        </ul>
                    </div>
                )}

                {hasNextPinnedCell && (
                    <div className="silver-path-segment next-cell-silver-path">
                        <VSCodeButton onClick={onNavigateToNextPinnedCell}>
                            Navigate to Next Pinned Cell
                        </VSCodeButton>
                    </div>
                )}
            </>
        );
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            onChatSubmit();
        }
    };

    return (
        <div className="tab-container">
            <div className="pinned-verses">
                <h3>Select Target Passage:</h3>
                {pinnedVerses.length > 0 ? (
                    <>
                        <p className="select-target-instruction">
                            Click on a verse ID to select the target passage for translation:
                        </p>
                        <div className="pinned-verses-list">
                            {pinnedVerses.map((verse) => (
                                <span
                                    key={verse.cellId}
                                    className={`pinned-verse-id ${
                                        targetPassage === verse.cellId ? "target-passage" : ""
                                    }`}
                                    onClick={() => onSelectTargetPassage(verse.cellId)}
                                >
                                    {verse.cellId}
                                </span>
                            ))}
                        </div>
                    </>
                ) : (
                    <p>No pinned verses available. Pin verses to start translating.</p>
                )}
            </div>

            <div ref={chatHistoryRef} className="message-history">
                {targetPassage && (
                    <div className="current-passage">
                        <h3>Target: {targetPassage}</h3>
                    </div>
                )}
                {chatHistory.length > 0 &&
                    chatHistory[chatHistory.length - 1].role === "assistant" && (
                        <div className="silver-path-message assistant">
                            {renderTranslationResponse(
                                chatHistory[chatHistory.length - 1] as AssistantMessage,
                                chatHistory.length - 1
                            )}
                        </div>
                    )}
                {isLoading && (
                    <div className="silver-path-loading">
                        <div className="silver-path-loading-spinner"></div>
                        <span>Thinking...</span>
                    </div>
                )}
            </div>

            <div className="input-container">
                <div className="input-wrapper">
                    <textarea
                        className="input-textarea"
                        value={chatInput}
                        onChange={(e) => onChatInputChange(e.target.value)}
                        onKeyDown={handleKeyDown}
                        onFocus={onChatFocus}
                        placeholder={
                            targetPassage
                                ? "Ask about these passages... (Ctrl + Enter to send)"
                                : "Select a target passage before asking questions"
                        }
                        disabled={!targetPassage}
                    />
                    <VSCodeButton
                        onClick={onChatSubmit}
                        className="send-button"
                        appearance="icon"
                        title="Send"
                        disabled={!targetPassage}
                    >
                        <span className="codicon codicon-send" />
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
}

export default React.memo(TeachTab);
