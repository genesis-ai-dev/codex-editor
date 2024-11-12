import React, { useState } from "react";
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";

interface ChatInputProps {
    value: string;
    onChange: (value: string) => void;
    onSubmit: () => void;
    onFocus?: () => void;
}

function ChatInput({ value, onChange, onSubmit, onFocus }: ChatInputProps) {
    const defaultPrompts = [
        { text: "Detect anomalies", icon: "🔍" },
        { text: "Summarize changes", icon: "📝" },
    ];

    return (
        <div
            className="chat-input-container"
            style={{
                background: "var(--vscode-editor-background)",
                padding: "12px",
                borderRadius: "6px",
            }}
        >
            <div
                className="default-prompts"
                style={{
                    display: "flex",
                    gap: "8px",
                    marginBottom: "8px",
                }}
            >
                {defaultPrompts.map((prompt, index) => (
                    <VSCodeButton
                        key={index}
                        onClick={() => onChange(prompt.text)}
                        appearance="secondary"
                        style={{
                            padding: "4px 12px",
                            borderRadius: "16px",
                        }}
                    >
                        <span style={{ marginRight: "4px" }}>{prompt.icon}</span>
                        {prompt.text}
                    </VSCodeButton>
                ))}
            </div>
            <div
                className="input-row"
                style={{
                    display: "flex",
                    gap: "8px",
                }}
            >
                <VSCodeTextArea
                    value={value}
                    onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
                    onFocus={onFocus}
                    placeholder="Ask about these passages... (Ctrl + Enter to send)"
                    style={{
                        width: "100%",
                        borderRadius: "4px",
                    }}
                    onKeyDown={(e) => {
                        if (e.ctrlKey && e.key === "Enter") {
                            onSubmit();
                        }
                    }}
                />
                <VSCodeButton onClick={onSubmit} appearance="primary">
                    Send
                </VSCodeButton>
            </div>
        </div>
    );
}

export default ChatInput;
