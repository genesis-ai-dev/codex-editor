import React, { useState } from "react";
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
                    appearance="icon"
                    title="Delete"
                    onClick={handleDelete}
                    style={{
                        backgroundColor: "var(--vscode-button-background)",
                        color: "var(--vscode-button-foreground)",
                    }}
                >
                    ❌
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
                        ✅🗑️
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
                        🚫
                    </VSCodeButton>
                </div>
            )}
        </div>
    );
};

export default CloseButtonWithConfirmation;
