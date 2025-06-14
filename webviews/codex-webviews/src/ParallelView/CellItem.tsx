import React from "react";
import { TranslationPair } from "../../../../types";

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
    const handleSourceCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.sourceCell.content || ""));
    
    const handleTargetCopy = () => navigator.clipboard.writeText(stripHtmlTags(item.targetCell.content || ""));

    const getTargetUri = (uri: string): string => {
        if (!uri) return "";
        return uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
    };

    return (
        <div className={`card p-4 ${isPinned ? "pinned" : ""}`}>
            <div className="flex justify-between items-start mb-4">
                <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                        <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                            {item.cellId}
                        </h3>
                        {isPinned && (
                            <span className="text-blue-500 text-xs font-medium bg-blue-50 px-2 py-1 rounded-full">
                                Pinned
                            </span>
                        )}
                    </div>
                </div>
                <button
                    style={{
                        width: '24px',
                        height: '24px',
                        padding: '4px',
                        border: 'none',
                        background: 'none',
                        cursor: 'pointer',
                        borderRadius: '4px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        color: isPinned ? 'var(--blue-500)' : 'var(--gray-500)',
                        transition: 'all 0.2s ease'
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.backgroundColor = 'var(--gray-100)';
                    }}
                    onMouseLeave={(e) => {
                        e.currentTarget.style.backgroundColor = 'transparent';
                    }}
                    aria-label={isPinned ? "Unpin" : "Pin"}
                    onClick={() => onPinToggle(item, !isPinned)}
                >
                    <span className={`codicon codicon-${isPinned ? "pinned" : "pin"}`} style={{ fontSize: '14px' }}></span>
                </button>
            </div>

            <div className="space-y-4">
                <div>
                    <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                        Bource Text
                    </div>
                    <p className="text-sm leading-relaxed text-gray-900 dark:text-white mb-3">
                        {item.sourceCell.content}
                    </p>
                    <div className="flex gap-2">
                        <button 
                            className="btn"
                            onClick={handleSourceCopy}
                            aria-label="Copy text"
                        >
                            <span className="codicon codicon-copy"></span>
                            Copy
                        </button>
                        <button
                            className="btn"
                            onClick={() =>
                                onUriClick(item.sourceCell.uri || "", `${item.cellId}`)
                            }
                            aria-label="Open source text"
                        >
                            <span className="codicon codicon-open-preview"></span>
                            Open
                        </button>
                    </div>
                </div>

                <div className="divider" />

                <div>
                    <div className="text-xs font-medium text-gray-500 mb-2 uppercase tracking-wider">
                        Target Text
                    </div>
                    {item.targetCell.content ? (
                        <p
                            className="text-sm leading-relaxed text-gray-900 dark:text-white mb-3"
                            dangerouslySetInnerHTML={{
                                __html: item.targetCell.content,
                            }}
                        />
                    ) : (
                        <p className="text-sm text-gray-400 italic mb-3">
                            No translation yet
                        </p>
                    )}
                    <div className="flex gap-2">
                        <button 
                            className="btn"
                            onClick={handleTargetCopy}
                            aria-label="Copy text"
                        >
                            <span className="codicon codicon-copy"></span>
                            Copy
                        </button>
                        <button
                            className="btn"
                            onClick={() =>
                                onUriClick(
                                    getTargetUri(item.targetCell.uri || ""),
                                    `${item.cellId}`
                                )
                            }
                            aria-label="Open target text"
                        >
                            <span className="codicon codicon-open-preview"></span>
                            Open
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default CellItem;
