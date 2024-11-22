import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./SharedStyles.css";

interface TranslationResponseProps {
    text: string;
    cellId?: string;
}

export const onCopy = (content: string) => {
    navigator.clipboard.writeText(content);
};

const onApply = (content: string) => {
    console.log("Apply", content);
};

const TranslationResponseComponent: React.FC<TranslationResponseProps> = ({ text, cellId }) => {
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
                        onClick={() => onApply(text)}
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
