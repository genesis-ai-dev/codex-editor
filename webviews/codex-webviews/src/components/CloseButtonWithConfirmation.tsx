import React, { useState } from "react";
import "@vscode/codicons/dist/codicon.css"; // Import codicons

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
                <button
                    aria-label="Delete"
                    title="Delete"
                    onClick={handleDelete}
                    className="vscode-button"
                >
                    <i className="codicon codicon-close"></i>
                </button>
            ) : (
                <div style={{ display: "flex", flexDirection: "row" }}>
                    <button
                        aria-label="Confirm Delete"
                        title="Confirm Delete"
                        onClick={confirmDelete}
                        className="vscode-button"
                    >
                        <i className="codicon codicon-check"></i>
                        <i className="codicon codicon-trash"></i>
                    </button>
                    <button
                        aria-label="Cancel Delete"
                        title="Cancel Delete"
                        onClick={cancelDelete}
                        className="vscode-button"
                    >
                        <i className="codicon codicon-close"></i>
                    </button>
                </div>
            )}
        </div>
    );
};

export default CloseButtonWithConfirmation;
