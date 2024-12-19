import React from "react";
import { TranslationPair } from "../../../../types";
import { VSCodeButton, VSCodeBadge, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import "./cellItem.css";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    isPinned: boolean;
    onPinToggle: (item: TranslationPair, isPinned: boolean) => void;
}

const stripHtmlTags = (html: string) => {
    const doc = new DOMParser().parseFromString(html, "text/html");
    return doc.body.textContent || "";
};

const CellItem: React.FC<CellItemProps> = ({ item, onUriClick, isPinned, onPinToggle }) => {
    const handleCopy = () => {
        const cleanText = `${stripHtmlTags(item.sourceCell.content || "")}\n${stripHtmlTags(
            item.targetCell.content || ""
        )}`;
        navigator.clipboard.writeText(cleanText);
    };

    const getTargetUri = (uri: string): string => {
        if (!uri) return "";
        return uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
    };

    return (
        <div className={`verse-item ${isPinned ? "pinned" : ""}`}>
            <div className="verse-header">
                <div className="verse-badges">
                    <VSCodeBadge className="verse-badge">{item.cellId}</VSCodeBadge>
                    {isPinned && <span className="locked-text">Pinned</span>}
                </div>
                <VSCodeButton
                    appearance="icon"
                    aria-label={isPinned ? "Unpin" : "Pin"}
                    onClick={() => onPinToggle(item, !isPinned)}
                >
                    <span className={`codicon codicon-${isPinned ? "pinned" : "pin"}`}></span>
                </VSCodeButton>
            </div>

            <VSCodeDivider />

            <div className="verse-content">
                <div className="verse-section">
                    <div className="verse-text-container">
                        <div className="verse-label">Source Text</div>
                        <p className="verse-text">{item.sourceCell.content}</p>
                    </div>
                    <div className="verse-buttons">
                        <VSCodeButton appearance="secondary" onClick={handleCopy}>
                            <span className="codicon codicon-copy button-icon"></span>
                            Copy
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() => onUriClick(item.sourceCell.uri || "", `${item.cellId}`)}
                        >
                            <span className="codicon codicon-open-preview button-icon"></span>
                            Open
                        </VSCodeButton>
                    </div>
                </div>

                <VSCodeDivider />

                <div className="verse-section">
                    <div className="verse-text-container">
                        <div className="verse-label">Target Text</div>
                        <p
                            className="verse-text"
                            dangerouslySetInnerHTML={{ __html: item.targetCell.content || "" }}
                        ></p>
                    </div>
                    <div className="verse-buttons">
                        <VSCodeButton appearance="secondary" onClick={handleCopy}>
                            <span className="codicon codicon-copy button-icon"></span>
                            Copy
                        </VSCodeButton>
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() =>
                                onUriClick(
                                    getTargetUri(item.targetCell.uri || ""),
                                    `${item.cellId}`
                                )
                            }
                        >
                            <span className="codicon codicon-open-preview button-icon"></span>
                            Open
                        </VSCodeButton>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CellItem;
