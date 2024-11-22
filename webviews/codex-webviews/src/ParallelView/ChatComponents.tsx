import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./SharedStyles.css";

interface TranslationResponseProps {
    text: string;
    cellId?: string;
    onApplyTranslation: (cellId: string, text: string) => void;
}
export const RegEx = {
    TranslationResponse: /<TranslationResponse\s+([^>]+)\s*\/>/g,
} as const;

export const onCopy = (content: string) => {
    navigator.clipboard.writeText(content);
};

const TranslationResponseComponent: React.FC<TranslationResponseProps> = ({
    text,
    cellId,
    onApplyTranslation,
}) => {
    return (
        <div className="assistant-response">
            {cellId && (
                <div className="cell-id">
                    <strong>Cell ID:</strong> {cellId}
                </div>
            )}
            <div className="response-content">
                <div className="response-text">
                    <p>{text}</p>
                </div>
                <div className="response-actions">
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => onCopy(text)}
                        title="Copy response"
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => cellId && onApplyTranslation(text, cellId)}
                        title="Apply response"
                    >
                        <span className="codicon codicon-check"></span>
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

export default TranslationResponseComponent;
