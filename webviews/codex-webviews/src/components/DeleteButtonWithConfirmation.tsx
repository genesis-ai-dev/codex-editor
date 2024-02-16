import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

const EditAndDeleteOptions: React.FC<{
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
                        border: "1px solid var(--vscode-button-foreground)",
                        padding: "10px",
                        borderRadius: "5px",
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
                            backgroundColor: "var(--vscode-button-foreground)",
                            color: "var(--vscode-button-background)",
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
                            backgroundColor: "var(--vscode-button-background)",
                            color: "var(--vscode-button-foreground)",
                        }}
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};

export default EditAndDeleteOptions;
