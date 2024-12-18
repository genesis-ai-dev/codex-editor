import React from "react";

interface UserFeedbackProps {
    cellId: string;
    originalText: string;
    feedbackText: string;
}

export const UserFeedbackComponent: React.FC<UserFeedbackProps> = ({
    cellId,
    originalText,
    feedbackText,
}) => {
    return (
        <div className="user-feedback">
            <div className="user-feedback-header">
                <h4>User Feedback</h4>
                <span className="cell-id">Cell ID: {cellId}</span>
            </div>
            <div className="original-text">
                <h5>Original Text:</h5>
                <p>{originalText}</p>
            </div>
            <div className="feedback-text">
                <h5>Feedback:</h5>
                <p>{feedbackText}</p>
            </div>
        </div>
    );
};

export const RegEx = {
    UserFeedback:
        /<UserFeedback\s+cellId="([^"]*)"\s+originalText="([^"]*)"\s+feedbackText="([^"]*)"\s*\/>/g,
};
