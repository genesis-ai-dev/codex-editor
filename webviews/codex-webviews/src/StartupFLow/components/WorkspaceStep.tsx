import React from 'react';
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface WorkspaceStepProps {
    onOpenWorkspace: () => void;
    onCreateNew: () => void;
}

export const WorkspaceStep: React.FC<WorkspaceStepProps> = ({ onOpenWorkspace, onCreateNew }) => {
    return (
        <div className="workspace-step">
            <h2>Set Up Your Workspace</h2>
            <div className="workspace-options">
                <div className="option">
                    <h3>Open Existing Project</h3>
                    <p>Select a folder containing an existing Codex project</p>
                    <VSCodeButton onClick={onOpenWorkspace}>
                        Open Folder
                    </VSCodeButton>
                </div>
                <div className="option">
                    <h3>Create New Project</h3>
                    <p>Start a new Codex project in a fresh directory</p>
                    <VSCodeButton onClick={onCreateNew}>
                        Create New Project
                    </VSCodeButton>
                </div>
            </div>
        </div>
    );
};
