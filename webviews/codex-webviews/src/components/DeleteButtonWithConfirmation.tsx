import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "@vscode/codicons/dist/codicon.css";

const DeleteButtonWithConfirmation: React.FC<{
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
        <div style={{ display: "flex", gap: "4px", alignItems: "center" }}>
            {!showConfirmation ? (
                <VSCodeButton
                    appearance="icon"
                    aria-label="Delete"
                    title="Delete"
                    onClick={() => setShowConfirmation(true)}
                >
                    <i className="codicon codicon-close"></i>
                </VSCodeButton>
            ) : (
                <div
                    style={{
                        display: "flex",
                        gap: "4px",
                    }}
                >
                    <VSCodeButton
                        appearance="secondary"
                        aria-label="Cancel Delete"
                        title="Cancel Delete"
                        onClick={() => setShowConfirmation(false)}
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        appearance="primary"
                        aria-label="Confirm Delete"
                        title="Confirm Delete"
                        onClick={() => {
                            handleDeleteButtonClick();
                            setShowConfirmation(false);
                        }}
                    >
                        <i className="codicon codicon-trash"></i>
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};

export default DeleteButtonWithConfirmation;
