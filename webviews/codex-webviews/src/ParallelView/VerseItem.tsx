import React from 'react';
import { TranslationPair } from "../../../../types";
import { VSCodeDivider, VSCodeBadge } from '@vscode/webview-ui-toolkit/react';

interface VerseItemProps {
    item: TranslationPair;
    index: number;
    onUriClick: (uri: string, word: string) => void;
}

const VerseItem: React.FC<VerseItemProps> = ({ item, index, onUriClick }) => {
    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text);
    };

    return (
        <div className="verse-item vscode-card" style={{ padding: '16px', marginBottom: '16px' }}>
            <div className="verse-header" style={{ marginBottom: '8px' }}>
                <VSCodeBadge>{item.vref}</VSCodeBadge>
            </div>
            <VSCodeDivider />
            <div className="verse-content" style={{ marginTop: '16px' }}>
                <VerseSection
                    title="Source"
                    content={item.sourceVerse.content}
                    onCopy={() => handleCopy(item.sourceVerse.content)}
                    onOpen={() => onUriClick(item.sourceVerse.uri, `${item.vref}`)}
                />
                <VSCodeDivider style={{ margin: '16px 0' }} />
                <VerseSection
                    title="Target"
                    content={item.targetVerse.content}
                    onCopy={() => handleCopy(item.targetVerse.content)}
                    onOpen={() => onUriClick(item.targetVerse.uri || "", `${item.vref}`)}
                />
            </div>
        </div>
    );
};

interface VerseSectionProps {
    title: string;
    content: string;
    onCopy: () => void;
    onOpen: () => void;
}

const VerseSection: React.FC<VerseSectionProps> = ({ 
    title, 
    content, 
    onCopy, 
    onOpen
}) => (
    <div className="verse-section">
        <h3 
            className="verse-title" 
            onClick={onOpen}
            style={{ cursor: 'pointer', fontSize: '1.2em', marginBottom: '8px' }}
        >
            {title}
        </h3>
        <p 
            className="verse-content-text" 
            onClick={onCopy}
            style={{ cursor: 'pointer', fontSize: '1.1em', lineHeight: '1.5' }}
        >
            {content}
        </p>
    </div>
);

export default VerseItem;