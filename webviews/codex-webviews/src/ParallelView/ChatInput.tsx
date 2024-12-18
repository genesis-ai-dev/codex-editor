import React, { useState, useEffect } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./SharedStyles.css";

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
        <div className="input-wrapper">
            <textarea
                className="input-textarea"
                value={value}
                onChange={(e) => onChange(e.target.value)}
                onKeyDown={handleKeyDown}
                onFocus={onFocus}
                placeholder={`Try asking: "${suggestions[currentSuggestion]}"`}
            />
            <VSCodeButton onClick={onSubmit} className="send-button" appearance="icon" title="Send">
                <span className="codicon codicon-send" />
            </VSCodeButton>
        </div>
    );
};

export default React.memo(ChatInput);
