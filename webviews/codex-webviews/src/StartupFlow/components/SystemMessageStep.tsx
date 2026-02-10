import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";
import { MessagesToStartupFlowProvider } from "types";

export interface SystemMessageStepProps {
    vscode: { postMessage: (message: any) => void };
    initialMessage?: string;
    onContinue: () => void;
    onSkip?: () => void;
    isWaitingForMessage?: boolean;
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
    isWaitingForMessage = false,
}) => {
    const [systemMessage, setSystemMessage] = useState<string>(initialMessage);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
    
    // Icon positioning constants
    const ICON_LEFT_MARGIN = "3px";
    const TEXT_LEFT_PADDING = "4px";
    const ICON_SIZE = 16; // pixels

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
        // Show warning if there's existing text
        if (systemMessage.trim()) {
            setShowOverwriteWarning(true);
            return;
        }
        
        // Proceed with generation
        setIsGenerating(true);
        setError(null);
        vscode.postMessage({
            command: "systemMessage.generate",
        } as MessagesToStartupFlowProvider);
    };

    const handleConfirmOverwrite = () => {
        setShowOverwriteWarning(false);
        setIsGenerating(true);
        setError(null);
        vscode.postMessage({
            command: "systemMessage.generate",
        } as MessagesToStartupFlowProvider);
    };

    const handleSave = () => {
        // Require a message before continuing
        if (!systemMessage.trim()) {
            setError("Please enter or generate a system message before continuing.");
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
                            them automatically or write your own. You may find it helpful to generate these
                            instructions automatically, and then tweak them to your liking.
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

                {showOverwriteWarning && (
                    <div
                        style={{
                            padding: "12px",
                            backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                            border: "1px solid var(--vscode-inputValidation-warningBorder)",
                            borderRadius: "4px",
                            fontSize: "14px",
                            display: "flex",
                            flexDirection: "column",
                            gap: "8px",
                        }}
                    >
                        <div style={{ color: "var(--vscode-warningForeground)" }}>
                            Generating a new message will overwrite your current text. Do you want to proceed?
                        </div>
                        <div style={{ display: "flex", gap: "8px", justifyContent: "flex-end" }}>
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => setShowOverwriteWarning(false)}
                            >
                                Cancel
                            </VSCodeButton>
                            <VSCodeButton
                                appearance="primary"
                                onClick={handleConfirmOverwrite}
                            >
                                Overwrite and Generate
                            </VSCodeButton>
                        </div>
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
                        disabled={isGenerating || isWaitingForMessage}
                        style={{
                            width: "100%",
                            fontFamily: "var(--vscode-editor-font-family)",
                            fontSize: "13px",
                            opacity: (isGenerating || isWaitingForMessage) ? 0.6 : 1,
                            cursor: (isGenerating || isWaitingForMessage) ? "not-allowed" : "text",
                        }}
                    />
                    <p style={{ margin: "3px 0 0 0", fontSize: "12px", opacity: 0.7 }}>
                        These instructions can be edited at any time in project settings.
                    </p>
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
                        style={{
                            minWidth: "180px",
                        }}
                    >
                        {isGenerating ? (
                            <span style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}>
                                <i className="codicon codicon-loading codicon-modifier-spin" style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: `${ICON_SIZE}px`,
                                    height: `${ICON_SIZE}px`,
                                    marginLeft: ICON_LEFT_MARGIN,
                                }}></i>
                                <span style={{ paddingLeft: TEXT_LEFT_PADDING }}>Generating...</span>
                            </span>
                        ) : (
                            <span style={{
                                display: "flex",
                                alignItems: "center",
                                gap: "8px",
                            }}>
                                <i className="codicon codicon-sparkle" style={{
                                    display: "inline-flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    width: `${ICON_SIZE}px`,
                                    height: `${ICON_SIZE}px`,
                                    marginLeft: ICON_LEFT_MARGIN,
                                }}></i>
                                <span style={{ paddingLeft: TEXT_LEFT_PADDING }}>Generate</span>
                            </span>
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
                {/* Skip button commented out - system message is required for AI translations */}
                {/* {onSkip && (
                    <VSCodeButton
                        appearance="secondary"
                        onClick={handleSkip}
                        disabled={isGenerating || isSaving}
                    >
                        Skip for Now
                    </VSCodeButton>
                )} */}
                <VSCodeButton
                    appearance="primary"
                    onClick={handleSave}
                    disabled={isGenerating || isSaving || !systemMessage.trim()}
                    style={{
                        minWidth: "200px",
                    }}
                >
                    {isSaving ? (
                        <span style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "8px",
                        }}>
                            <i className="codicon codicon-loading codicon-modifier-spin" style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                width: `${ICON_SIZE}px`,
                                height: `${ICON_SIZE}px`,
                                marginLeft: ICON_LEFT_MARGIN,
                            }}></i>
                            <span style={{ paddingLeft: TEXT_LEFT_PADDING }}>Saving...</span>
                        </span>
                    ) : systemMessage.trim() ? (
                        <>
                            Save and Start Translating
                            <i className="codicon codicon-arrow-right" style={{ marginLeft: "4px" }}></i>
                        </>
                    ) : (
                        <>
                            Start Translating
                            <i className="codicon codicon-arrow-right" style={{ marginLeft: "4px" }}></i>
                        </>
                    )}
                </VSCodeButton>
            </div>
        </div>
    );
};
