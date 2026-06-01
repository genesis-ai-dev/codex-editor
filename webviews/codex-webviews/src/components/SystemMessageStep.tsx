import React, { useState, useEffect } from "react";
import { VSCodeButton, VSCodeTextArea } from "@vscode/webview-ui-toolkit/react";
import { MessagesToStartupFlowProvider } from "types";

export interface SystemMessageStepProps {
    vscode: { postMessage: (message: any) => void };
    initialMessage?: string;
    onContinue: () => void;
    onSkip?: () => void;
    isWaitingForMessage?: boolean;
    /** Optional banner shown above the heading (e.g. to explain why this view appeared). */
    headerBanner?: React.ReactNode;
    /** When provided, renders an additional button (e.g. "I don't need to change this") that calls onDismiss. */
    dismissLabel?: string;
    onDismiss?: () => void;
    /** Override label shown on the primary save button. Defaults to "Save and Start Translating". */
    saveLabel?: string;
    /** Override label shown on the generate button. Defaults to "Generate". */
    generateLabel?: string;
    /** When true, clicking Generate skips the overwrite-confirmation warning and generates immediately. */
    skipOverwriteWarning?: boolean;
    /**
     * When true, the Generate button is the primary call-to-action until the user has
     * either edited the text or regenerated. After that, Save becomes primary.
     * Useful for the review flow where the expectation is that the user changes
     * something before saving.
     */
    emphasizeGenerateUntilEdited?: boolean;
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
    headerBanner,
    dismissLabel,
    onDismiss,
    saveLabel,
    generateLabel,
    skipOverwriteWarning = false,
    emphasizeGenerateUntilEdited = false,
}) => {
    const [systemMessage, setSystemMessage] = useState<string>(initialMessage);
    const [isGenerating, setIsGenerating] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [showOverwriteWarning, setShowOverwriteWarning] = useState(false);
    const [hasInteracted, setHasInteracted] = useState(false);

    const resolvedGenerateLabel = generateLabel ?? "Generate";
    const generateAppearance: "primary" | "secondary" =
        emphasizeGenerateUntilEdited && !hasInteracted ? "primary" : "secondary";
    const saveAppearance: "primary" | "secondary" =
        emphasizeGenerateUntilEdited && !hasInteracted ? "secondary" : "primary";

    // Update local state when initialMessage changes
    useEffect(() => {
        if (initialMessage) {
            setSystemMessage(initialMessage);
            setHasInteracted(false);
        }
    }, [initialMessage]);

    // Listen for generated system message from extension
    useEffect(() => {
        const handleMessage = (event: MessageEvent<any>) => {
            if (event.data.command === "systemMessage.generated") {
                setSystemMessage(event.data.message || "");
                setIsGenerating(false);
                setError(null);
                setHasInteracted(true);
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
        // Show warning if there's existing text (unless the consumer opted out, e.g. the
        // language-change review flow, where regenerating is the expected next step).
        if (!skipOverwriteWarning && systemMessage.trim()) {
            setShowOverwriteWarning(true);
            return;
        }

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
                {headerBanner && (
                    <div>{headerBanner}</div>
                )}
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
                            Generating a new message will overwrite your current text.
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
                        onInput={(e: any) => {
                            setSystemMessage(e.target.value);
                            setHasInteracted(true);
                        }}
                        placeholder={
                            isGenerating || isWaitingForMessage
                                ? "Generating translation instructions..."
                                : "Enter or generate translation instructions for the AI..."
                        }
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
                        appearance={generateAppearance}
                        onClick={handleGenerate}
                        disabled={isGenerating || isWaitingForMessage || isSaving}
                        style={{
                            minWidth: "180px",
                        }}
                    >
                        <span
                            style={{
                                display: "inline-flex",
                                alignItems: "center",
                                justifyContent: "center",
                                gap: "6px",
                                whiteSpace: "nowrap",
                            }}
                        >
                            <i
                                className={
                                    isGenerating || isWaitingForMessage
                                        ? "codicon codicon-loading codicon-modifier-spin"
                                        : "codicon codicon-sparkle"
                                }
                            ></i>
                            {isGenerating || isWaitingForMessage
                                ? "Generating..."
                                : resolvedGenerateLabel}
                        </span>
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
                {dismissLabel && onDismiss && (
                    <VSCodeButton
                        appearance="secondary"
                        onClick={onDismiss}
                        disabled={isGenerating || isSaving}
                    >
                        {dismissLabel}
                    </VSCodeButton>
                )}
                <VSCodeButton
                    appearance={saveAppearance}
                    onClick={handleSave}
                    disabled={isGenerating || isSaving || !systemMessage.trim()}
                    style={{
                        minWidth: "200px",
                    }}
                >
                    <span
                        style={{
                            display: "inline-flex",
                            alignItems: "center",
                            justifyContent: "center",
                            gap: "6px",
                            whiteSpace: "nowrap",
                        }}
                    >
                        {isSaving ? (
                            <>
                                <i className="codicon codicon-loading codicon-modifier-spin"></i>
                                Saving...
                            </>
                        ) : (
                            <>
                                {saveLabel ??
                                    (systemMessage.trim()
                                        ? "Save and Start Translating"
                                        : "Start Translating")}
                                <i className="codicon codicon-arrow-right"></i>
                            </>
                        )}
                    </span>
                </VSCodeButton>
            </div>
        </div>
    );
};
