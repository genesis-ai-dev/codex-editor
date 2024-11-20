import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onFocus?: () => void;
}

const ChatInput: React.FC<ChatInputProps> = ({ value, onChange, onSubmit, onFocus }) => {
    const suggestions = [
        "Codex tech help",
        "Summarize changes",
        "Detect anomalies",
        "Show me these verses in their original languages",
    ];
    const [currentSuggestion, setCurrentSuggestion] = useState(0);

    useEffect(() => {
        const interval = setInterval(() => {
            setCurrentSuggestion((prev) => (prev + 1) % suggestions.length);
        }, 3000);
        return () => clearInterval(interval);
    }, []);

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            onSubmit();
        }
    };

    return (
        <div className="chat-input-container">
            <div
                className="chat-input-suggestion"
                onClick={() => onChange(suggestions[currentSuggestion])}
            >
                Suggestion: {suggestions[currentSuggestion]}
            </div>
            <div className="chat-input-wrapper">
                <textarea
                    className="chat-input-textarea"
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={onFocus}
                    placeholder="Ask about these passages... (Ctrl + Enter to send)"
                />
                <VSCodeButton
                    onClick={onSubmit}
                    className="chat-input-send-button"
                    appearance="icon"
                    title="Send"
                >
                    <span className="codicon codicon-send" />
                </VSCodeButton>
            </div>
        </div>
    );
};

export default ChatInput;
