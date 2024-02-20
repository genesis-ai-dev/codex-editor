import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import DeleteButtonWithConfirmation from "./DeleteButtonWithConfirmation";

const EditAndDeleteOptions: React.FC<{
    handleDeleteButtonClick: () => void;
    handleEditButtonClick: (editModeIsEnabled: boolean) => void;
}> = ({ handleDeleteButtonClick: handleCommentDeletion }) => {
    return (
        <div
            style={{
                display: "flex",
                gap: "10px",
            }}
        >
            <VSCodeButton
                aria-label="Edit"
                appearance="icon"
                title="Edit"
                style={{
                    backgroundColor: "var(--vscode-button-background)",
                    color: "var(--vscode-button-foreground)",
                }}
            >
                <i className="codicon codicon-edit"></i>
            </VSCodeButton>
            <DeleteButtonWithConfirmation
                handleDeleteButtonClick={() => handleCommentDeletion()}
            />
        </div>
    );
};

export default EditAndDeleteOptions;
