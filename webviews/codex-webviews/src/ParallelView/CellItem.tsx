import React from "react";
import { TranslationPair } from "../../../../types";
import { VSCodeButton, VSCodeBadge } from "@vscode/webview-ui-toolkit/react";

interface CellItemProps {
    item: TranslationPair;
    onUriClick: (uri: string, word: string) => void;
}

const CellItem: React.FC<CellItemProps> = ({ item, onUriClick }) => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    const getTargetUri = (uri: string): string => {
        // FIXME: This should not be needed.
        if (!uri) {
            return "";
        }
        // Convert source file path to target file path
        // Example: /sourceText/file.source -> /files/target/file.codex
        return uri
            .replace(".source", ".codex") // Change file extension
            .replace(".project/sourceTexts/", "files/target/"); // Change directory path
    };

    return (
        <div className="verse-item">
            <VSCodeBadge>{item.cellId}</VSCodeBadge>
            <div className="cell-header">
                <div className="verse-content">
                    <p className="verse-text">{item.sourceCell.content}</p>
                </div>
                <div className="verse-actions">
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Copy Source"
                        onClick={() => handleCopy(item.sourceCell.content || "")}
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Open Source"
                        onClick={() => onUriClick(item.sourceCell.uri || "", `${item.cellId}`)}
                    >
                        <span className="codicon codicon-open-preview"></span>
                    </VSCodeButton>
                </div>
            </div>
            <div className="cell-header">
                <div className="verse-content">
                    <p
                        className="verse-text"
                        dangerouslySetInnerHTML={{ __html: item.targetCell.content || "" }}
                    ></p>
                </div>
                <div className="verse-actions">
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Copy Target"
                        onClick={() => handleCopy(item.targetCell.content || "")}
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="icon"
                        aria-label="Open Target"
                        onClick={() =>
                            onUriClick(getTargetUri(item.targetCell.uri || ""), `${item.cellId}`)
                        }
                    >
                        <span className="codicon codicon-open-preview"></span>
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};

export default CellItem;
