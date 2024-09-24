import React from "react";
import { TranslationPair } from "../../../../types";
import { VSCodeButton, VSCodeBadge } from "@vscode/webview-ui-toolkit/react";

interface VerseItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    onSaveClick: (index: number, before: string, after: string, uri: string) => void;
}

const VerseItem: React.FC<VerseItemProps> = ({ item, onUriClick, onSaveClick }) => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="verse-item">
            <VSCodeBadge>{item.vref}</VSCodeBadge>
            <div className="verse-header">
                <div className="verse-content">
                    <p className="verse-text">{item.sourceVerse.content}</p>
                </div>
                <div className="verse-actions">
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Copy Source"
                        onClick={() => handleCopy(item.sourceVerse.content)}
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Open Source"
                        onClick={() => onUriClick(item.sourceVerse.uri, `${item.vref}`)}
                    >
                        <span className="codicon codicon-open-preview"></span>
                    </VSCodeButton>
                </div>
            </div>
            <div className="verse-header">
                <div className="verse-content">
                    <p className="verse-text">{item.targetVerse.content}</p>
                </div>
                <div className="verse-actions">
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Copy Target"
                        onClick={() => handleCopy(item.targetVerse.content)}
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Open Target"
                        onClick={() => onUriClick(item.targetVerse.uri || "", `${item.vref}`)}
                    >
                        <span className="codicon codicon-open-preview"></span>
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

export default VerseItem;
