import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./SharedStyles.css";

interface IndividuallyTranslatedVerseProps {
    text: string;
    cellId: string;
    onApplyTranslation: (cellId: string, text: string) => void;
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

export const RegEx = {
    IndividuallyTranslatedVerse: /<IndividuallyTranslatedVerse\s+([^>]+)\s*\/>/g,
    AddedFeedback: /<AddedFeedback\s+([^>]+)\s*\/>/g,
    ShowUserPreference: /<ShowUserPreference\s+([^>]+)\s*\/>/g,
    GuessNextPrompts: /<GuessNextPrompts\s+([^>]+)\s*\/>/g,
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
    React.useCallback(() => {
        handleAddedFeedback(cellId, feedback);
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
