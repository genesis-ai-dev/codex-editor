import React from "react";
import { TranslationPair } from "../../../../types";
import { VSCodeButton, VSCodeBadge, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import "./cellItem.css";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
    isLocked: boolean;
    onLockToggle: (item: TranslationPair, isLocked: boolean) => void;
}

const CellItem: React.FC<CellItemProps> = ({ item, onUriClick, isLocked, onLockToggle }) => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const getTargetUri = (uri: string): string => {
        if (!uri) return "";
        return uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
    };

    return (
        <div className={`verse-item ${isLocked ? "locked" : ""}`}>
            <div className="verse-header">
                <div className="verse-badges">
                    <VSCodeBadge className="verse-badge">{item.cellId}</VSCodeBadge>
                    {isLocked && <span className="locked-text">Locked</span>}
                </div>
                <VSCodeButton
                    appearance="icon"
                    aria-label={isLocked ? "Unlock" : "Lock"}
                    onClick={() => onLockToggle(item, !isLocked)}
                >
                    <span className={`codicon codicon-${isLocked ? "lock" : "unlock"}`}></span>
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
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() => handleCopy(item.sourceCell.content || "")}
                        >
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
                        <VSCodeButton
                            appearance="secondary"
                            onClick={() => handleCopy(item.targetCell.content || "")}
                        >
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
