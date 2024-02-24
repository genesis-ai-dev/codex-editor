import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

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
        <div style={{ display: "flex", gap: "10px" }}>
            {!showConfirmation ? (
                <VSCodeButton
                    aria-label="Delete"
                    appearance="icon"
                    title="Delete"
                    onClick={handleDelete}
                    style={{
                        backgroundColor: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                    }}
                >
                    <i className="codicon codicon-trash"></i>
                </VSCodeButton>
            ) : (
                <div
                    style={{
                        borderRadius: "5px",
                        backgroundColor: "var(--vscode-errorForeground)",
                        display: "flex",
                        gap: "10px",
                    }}
                >
                    <VSCodeButton
                        aria-label="Confirm Delete"
                        appearance="icon"
                        title="Confirm Delete"
                        onClick={confirmDelete}
                        style={{
                            color: "var(--vscode-button-foreground)",
                            backgroundColor:
                                "var(--vscode-symbolIcon-eventForeground)",
                        }}
                    >
                        <i className="codicon codicon-check"></i>
                        <i className="codicon codicon-trash"></i>
                    </VSCodeButton>
                    <VSCodeButton
                        aria-label="Cancel Delete"
                        appearance="icon"
                        title="Cancel Delete"
                        onClick={cancelDelete}
                        style={{
                            backgroundColor: "var(--vscode-errorForeground)",
                            color: "var(--vscode-editor-background)",
                        }}
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};

export default DeleteButtonWithConfirmation;
