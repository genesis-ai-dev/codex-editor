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
        <div style={{ display: "flex", flexDirection: "column", padding: "8px" }}>
            <div
                onClick={() => onChange(suggestions[currentSuggestion])}
                style={{
                    marginBottom: "8px",
                    color: "var(--vscode-descriptionForeground)",
                    cursor: "pointer",
                    fontSize: "12px",
                }}
            >
                Suggestion: {suggestions[currentSuggestion]}
            </div>
            <div style={{ position: "relative" }}>
                <textarea
                    value={value}
                    onChange={(e) => onChange(e.target.value)}
                    onKeyDown={handleKeyDown}
                    onFocus={onFocus}
                    placeholder="Ask about these passages... (Ctrl + Enter to send)"
                    style={{
                        width: "100%",
                        backgroundColor: "transparent",
                        border: "1px solid var(--vscode-widget-border)",
                        borderRadius: "4px",
                        padding: "8px",
                        paddingRight: "40px",
                        color: "var(--vscode-foreground)",
                        outline: "none",
                        resize: "vertical",
                        minHeight: "60px",
                        fontFamily: "inherit",
                        fontSize: "inherit",
                    }}
                />
                <VSCodeButton
                    onClick={onSubmit}
                    style={{
                        position: "absolute",
                        right: "8px",
                        top: "8px",
                        padding: "0",
                        minWidth: "auto",
                    }}
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
