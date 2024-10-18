import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface ConfirmationButtonProps {
    onClick: () => void;
    disabled?: boolean;
    icon: string;
}

const ConfirmationButton: React.FC<ConfirmationButtonProps> = ({
    onClick,
    disabled = false,
    icon,
}) => {
    const [showConfirmation, setShowConfirmation] = useState(false);

    const handleInitialClick = () => {
        setShowConfirmation(true);
    };

    const handleConfirm = () => {
        onClick();
        setShowConfirmation(false);
    };

    const handleCancel = () => {
        setShowConfirmation(false);
    };

    if (showConfirmation) {
        return (
            <div
                style={{
                    display: "flex",
                    gap: "4px",
                    border: "1px solid gray",
                    borderRadius: "4px",
                }}
            >
                <VSCodeButton onClick={handleConfirm} appearance="icon">
                    <i className="codicon codicon-check"></i>
                </VSCodeButton>
                <VSCodeButton onClick={handleCancel} appearance="icon">
                    <i className="codicon codicon-x"></i>
                </VSCodeButton>
            </div>
        );
    }

    return (
        <VSCodeButton onClick={handleInitialClick} disabled={disabled} appearance="icon">
            <i className={`codicon codicon-${icon}`}></i>
        </VSCodeButton>
    );
};

export default ConfirmationButton;
