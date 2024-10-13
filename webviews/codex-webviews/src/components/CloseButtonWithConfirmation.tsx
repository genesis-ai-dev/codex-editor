import React, { useState } from "react";
import "@vscode/codicons/dist/codicon.css"; // Import codicons
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const CloseButtonWithConfirmation: React.FC<{
    handleDeleteButtonClick: () => void;
}> = ({ handleDeleteButtonClick }) => {
    const [showConfirmation, setShowConfirmation] = useState(false);

    const handleDelete = () => {
        setShowConfirmation(true);
    };

    const confirmDelete = () => {
        handleDeleteButtonClick();
        setShowConfirmation(false);
    };

    const cancelDelete = () => {
        setShowConfirmation(false);
    };

    return (
        <div style={{ display: "flex", gap: "10px" }}>
            {!showConfirmation ? (
                <VSCodeButton
                    aria-label="Delete"
                    title="Delete"
                    onClick={handleDelete}
                    appearance="icon"
                >
                    <i className="codicon codicon-close"></i>
                </VSCodeButton>
            ) : (
                <div style={{ display: "flex", flexDirection: "row" }}>
                    <VSCodeButton
                        aria-label="Confirm Delete"
                        title="Confirm Delete"
                        onClick={confirmDelete}
                        appearance="secondary"
                    >
                        <i className="codicon codicon-check"></i>
                        <i className="codicon codicon-trash"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        aria-label="Cancel Delete"
                        title="Cancel Delete"
                        onClick={cancelDelete}
                        appearance="icon"
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};

export default CloseButtonWithConfirmation;
