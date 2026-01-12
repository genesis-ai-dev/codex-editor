import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";
import { MessagesToStartupFlowProvider } from "types";

export interface SystemMessageStepProps {
    vscode: { postMessage: (message: any) => void };
    initialMessage?: string;
    onContinue: () => void;
    onSkip?: () => void;
}

/**
 * Modular component for displaying and editing system messages.
 * Designed to be reusable for future multi-step walkthroughs.
 */
export const SystemMessageStep: React.FC<SystemMessageStepProps> = ({
    vscode,
    initialMessage = "",
    onContinue,
    onSkip,
}) => {
    const [systemMessage, setSystemMessage] = useState<string>(initialMessage);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Update local state when initialMessage changes
    useEffect(() => {
        if (initialMessage) {
            setSystemMessage(initialMessage);
        }
    }, [initialMessage]);

    // Listen for generated system message from extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent<any>) => {
            if (event.data.command === "systemMessage.generated") {
                setSystemMessage(event.data.message || "");
                setIsGenerating(false);
                setError(null);
            } else if (event.data.command === "systemMessage.generateError") {
                setError(event.data.error || "Failed to generate system message");
                setIsGenerating(false);
            } else if (event.data.command === "systemMessage.saved") {
                setIsSaving(false);
                onContinue();
            } else if (event.data.command === "systemMessage.saveError") {
                setError(event.data.error || "Failed to save system message");
                setIsSaving(false);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [onContinue]);

    const handleGenerate = () => {
        setIsGenerating(true);
        setError(null);
        vscode.postMessage({
            command: "systemMessage.generate",
        } as MessagesToStartupFlowProvider);
    };

    const handleSave = () => {
        if (!systemMessage.trim()) {
            setError("System message cannot be empty");
            return;
        }
        setIsSaving(true);
        setError(null);
        vscode.postMessage({
            command: "systemMessage.save",
            message: systemMessage,
        } as MessagesToStartupFlowProvider);
    };

    const handleSkip = () => {
        if (onSkip) {
            onSkip();
        } else {
            onContinue();
        }
    };

    return (
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "20px",
                width: "100%",
                maxWidth: "800px",
                padding: "20px",
            }}
        >
            <div
                style={{
                    display: "flex",
                    flexDirection: "column",
                    gap: "12px",
                }}
            >
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "12px",
                    }}
                >
                    <i className="codicon codicon-comment-discussion" style={{ fontSize: "48px" }}></i>
                    <div>
                        <h2 style={{ margin: 0, fontSize: "20px", fontWeight: "600" }}>
                            AI Translation Instructions
                        </h2>
                        <p style={{ margin: "4px 0 0 0", fontSize: "14px", opacity: 0.8 }}>
                            These instructions guide the AI when translating your project. You can generate
                            them automatically or write your own.
                        </p>
                    </div>
                </div>

                {error && (
                    <div
                        style={{
                            padding: "12px",
                            backgroundColor: "var(--vscode-inputValidation-errorBackground)",
                            border: "1px solid var(--vscode-inputValidation-errorBorder)",
                            borderRadius: "4px",
                            color: "var(--vscode-errorForeground)",
                            fontSize: "14px",
                        }}
                    >
                        {error}
                    </div>
                )}

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "8px",
                    }}
                >
                    <label
                        htmlFor="system-message-textarea"
                        style={{
                            fontSize: "14px",
                            fontWeight: "500",
                        }}
                    >
                        System Message
                    </label>
                    <VSCodeTextArea
                        id="system-message-textarea"
                        value={systemMessage}
                        onInput={(e: any) => setSystemMessage(e.target.value)}
                        placeholder="Enter or generate translation instructions for the AI..."
                        rows={12}
                        style={{
                            width: "100%",
                            fontFamily: "var(--vscode-editor-font-family)",
                            fontSize: "13px",
                        }}
                    />
                </div>

                <div
                    style={{
                        display: "flex",
                        gap: "8px",
                        justifyContent: "flex-end",
                    }}
                >
                    <VSCodeButton
                        appearance="secondary"
                        onClick={handleGenerate}
                        disabled={isGenerating || isSaving}
                    >
                        {isGenerating ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                                Generating...
                            </>
                        ) : (
                            <>
                                <i className="codicon codicon-sparkle"></i>
                                Generate Automatically
                            </>
                        )}
                    </VSCodeButton>
                </div>
            </div>

            <div
                style={{
                    display: "flex",
                    gap: "8px",
                    justifyContent: "flex-end",
                    paddingTop: "12px",
                    borderTop: "1px solid var(--vscode-panel-border)",
                }}
            >
                {onSkip && (
                    <VSCodeButton
                        appearance="secondary"
                        onClick={handleSkip}
                        disabled={isGenerating || isSaving}
                    >
                        Skip for Now
                    </VSCodeButton>
                )}
                <VSCodeButton
                    appearance="primary"
                    onClick={handleSave}
                    disabled={isGenerating || isSaving || !systemMessage.trim()}
                >
                    {isSaving ? (
                        <>
                            <i className="codicon codicon-loading codicon-modifier-spin"></i>
                            Saving...
                        </>
                    ) : (
                        <>
                            Save & Continue
                            <i className="codicon codicon-arrow-right" style={{ marginLeft: "4px" }}></i>
                        </>
                    )}
                </VSCodeButton>
            </div>
        </div>
    );
};
