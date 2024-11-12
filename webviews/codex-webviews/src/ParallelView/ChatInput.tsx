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
                    gap: "12px",
                    marginBottom: "8px",
                    fontSize: "13px",
                    color: "var(--vscode-textLink-foreground)",
                }}
            >
                {defaultPrompts.map((prompt, index) => (
                    <span
                        key={index}
                        onClick={() => onChange(prompt.text)}
                        style={{
                            cursor: "pointer",
                            display: "flex",
                            alignItems: "center",
                            gap: "4px",
                        }}
                    >
                        {prompt.icon} {prompt.text}
                    </span>
                ))}
            </div>
            <div
                className="input-wrapper"
                style={{
                    display: "flex",
                    gap: "8px",
                    alignItems: "flex-start",
                }}
            >
                <VSCodeTextArea
                    value={value}
                    onChange={(e) => onChange((e.target as HTMLTextAreaElement).value)}
                    onFocus={onFocus}
                    placeholder="Ask about these passages... (Ctrl + Enter to send)"
                    style={{
                        width: "100%",
                        border: "none",
                        background: "var(--vscode-input-background)",
                    }}
                    onKeyDown={(e) => {
                        if (e.ctrlKey && e.key === "Enter") {
                            onSubmit();
                        }
                    }}
                />
                <VSCodeButton
                    appearance="primary"
                    onClick={onSubmit}
                    style={{
                        width: "32px",
                        height: "32px",
                        padding: "0",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
                        <path d="M1.724 1.053a.5.5 0 0 0-.714.545l1.403 4.85a.5.5 0 0 0 .397.354l5.69.953c.268.053.268.437 0 .49l-5.69.953a.5.5 0 0 0-.397.354l-1.403 4.85a.5.5 0 0 0 .714.545l13-6.5a.5.5 0 0 0 0-.894l-13-6.5Z" />
                    </svg>
                </VSCodeButton>
            </div>
        </div>
    );
}

export default ChatInput;
