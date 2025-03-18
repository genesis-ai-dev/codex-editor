import React, { useEffect, useState } from "react";
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import "./SharedStyles.css";

interface IndividuallyTranslatedVerseProps {
    text: string;
    cellId: string;
    onSendFeedback: (originalText: string, feedbackText: string, cellId: string) => void;
}

interface AddedFeedbackProps {
    feedback: string;
    cellId: string;
    handleAddedFeedback: (cellId: string, feedback: string) => void;
}

interface ShowUserPreferenceProps {
    feedback: string;
    cellId: string;
}

interface GuessNextPromptsProps {
    prompts: string[];
    onClick: (prompt: string) => void;
}

interface YoutubeVideoProps {
    videoId: string;
}

interface PinnedVerseProps {
    cellId: string;
    sourceText: string;
    targetText?: string;
    onUnpin: (cellId: string) => void;
}

export const RegEx = {
    IndividuallyTranslatedVerse: /<IndividuallyTranslatedVerse\s+([^>]+)\s*\/>/g,
    AddedFeedback: /<AddedFeedback\s+([^>]+)\s*\/>/g,
    ShowUserPreference: /<ShowUserPreference\s+([^>]+)\s*\/>/g,
    GuessNextPrompts: /<GuessNextPrompts\s+([^>]+)\s*\/>/g,
    YoutubeVideo: /<YoutubeVideo\s+([^>]+)\s*\/>/g,
    PinnedVerse: /<PinnedVerse\s+([^>]+)\s*\/>/g,
} as const;

export const onCopy = (content: string) => {
    navigator.clipboard.writeText(content);
};

export const GuessNextPromptsComponent: React.FC<GuessNextPromptsProps> = ({
    prompts,
    onClick,
}) => {
    return (
        <div className="guess-next-prompts">
            {prompts.map((prompt) => (
                <VSCodeButton onClick={() => onClick(prompt)}>{prompt}</VSCodeButton>
            ))}
        </div>
    );
};

export const AddedFeedbackComponent: React.FC<AddedFeedbackProps> = ({
    feedback,
    cellId,
    handleAddedFeedback,
}) => {
    const isInitialMount = React.useRef(true);

    React.useEffect(() => {
        if (isInitialMount.current) {
            handleAddedFeedback(cellId, feedback);
            isInitialMount.current = false;
        } else {
            handleAddedFeedback(cellId, feedback);
        }
    }, [cellId, feedback, handleAddedFeedback]);

    return (
        <div className="added-feedback">
            <p>🧠 Added to Memory: {cellId}</p>
            <p>{feedback}</p>
        </div>
    );
};

export const ShowUserPreferenceComponent: React.FC<ShowUserPreferenceProps> = ({
    feedback,
    cellId,
}) => {
    return (
        <div className="useful-feedback">
            <p>🧠 Found in Context: {cellId}</p>
            <p>{feedback}</p>
        </div>
    );
};

export const IndividuallyTranslatedVerseComponent: React.FC<IndividuallyTranslatedVerseProps> = ({
    text,
    cellId,
    onSendFeedback,
}) => {
    const [feedbackText, setFeedbackText] = useState("");

    const handleSendFeedback = () => {
        if (feedbackText.trim()) {
            onSendFeedback(text, feedbackText, cellId);
            setFeedbackText("");
        }
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === "Enter" && e.ctrlKey) {
            e.preventDefault();
            handleSendFeedback();
        }
    };

    return (
        <div className="assistant-response">
            {cellId && (
                <div className="cell-id">
                    <strong>Verse:</strong> {cellId}
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
                        title="Copy translation"
                    >
                        <span className="codicon codicon-copy"></span>
                    </VSCodeButton>
                </div>
            </div>
            <div className="feedback-input">
                <textarea
                    value={feedbackText}
                    onChange={(e) => setFeedbackText(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="Suggest feedback..."
                />
                <VSCodeButton
                    onClick={handleSendFeedback}
                    className="send-button"
                    appearance="icon"
                    title="Send Feedback"
                    disabled={!feedbackText.trim()}
                >
                    <span className="codicon codicon-send"></span>
                </VSCodeButton>
            </div>
        </div>
    );
};

export const YoutubeVideoComponent: React.FC<YoutubeVideoProps> = ({ videoId }) => {
    return (
        <div className="youtube-video">
            <iframe
                src={`https://www.youtube.com/embed/${videoId}`}
                title="YouTube video player"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
            ></iframe>
        </div>
    );
};

export const PinnedVerseComponent: React.FC<PinnedVerseProps> = ({
    cellId,
    sourceText,
    targetText,
    onUnpin
}) => {
    return (
        <div className="pinned-verse-component">
            <div className="pinned-verse-header">
                <div className="pinned-verse-id">
                    <span className="codicon codicon-pin"></span>
                    <strong>{cellId}</strong>
                </div>
                <div className="pinned-verse-actions">
                    <button 
                        className="action-button" 
                        onClick={() => onUnpin(cellId)} 
                        title="Unpin verse">
                        <span className="codicon codicon-pinned-filled"></span>
                    </button>
                </div>
            </div>
            <div className="pinned-verse-content">
                <div className="verse-source">
                    <div className="verse-label">Source:</div>
                    <div className="verse-text source-text">{sourceText}</div>
                </div>
                {targetText && (
                    <div className="verse-target">
                        <div className="verse-label">Target:</div>
                        <div className="verse-text target-text">{targetText}</div>
                    </div>
                )}
            </div>
        </div>
    );
};
