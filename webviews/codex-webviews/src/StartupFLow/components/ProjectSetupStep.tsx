import React, { useEffect, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { GitLabInfo } from "../types";
import {
    GitLabProject,
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
} from "../../../../../types";

export interface ProjectSetupStepProps {
    projectSelection: {
        type?: string;
        path?: string;
        repoUrl?: string;
        error?: string;
    };
    onCreateEmpty: () => void;
    onCloneRepo: (repoUrl: string) => void;
    gitlabInfo?: GitLabInfo;
    vscode: any;
}

export const ProjectSetupStep: React.FC<ProjectSetupStepProps> = ({
    projectSelection,
    onCreateEmpty,
    onCloneRepo,
    gitlabInfo,
    vscode,
}) => {
    const [repoUrl, setRepoUrl] = useState(projectSelection.repoUrl || "");
    const [projectsList, setProjectsList] = useState<GitLabProject[]>([]);

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            if (message.command === "projectsListFromGitLab") {
                setProjectsList(message.projects);
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (repoUrl) {
            onCloneRepo(repoUrl);
        }
    };

    return (
        <div className="project-setup-step">
            <h2>Project Setup</h2>
            <pre>{JSON.stringify(projectsList, null, 2)}</pre>
            {gitlabInfo && (
                <div className="gitlab-info">
                    <p>Logged in as {gitlabInfo.username}</p>
                </div>
            )}
            <div className="setup-options">
                <div className="option">
                    <h3>Create Empty Project</h3>
                    <p>Start with a blank project and add files as needed.</p>
                    <VSCodeButton onClick={onCreateEmpty}>Create Empty Project</VSCodeButton>
                </div>
                <div className="option">
                    <h3>Clone Repository</h3>
                    <p>Clone an existing Git repository to get started.</p>
                    <form onSubmit={handleSubmit}>
                        <VSCodeTextField
                            value={repoUrl}
                            onChange={(e) => setRepoUrl((e.target as HTMLInputElement).value)}
                            placeholder="Repository URL"
                            required
                        />
                        <VSCodeButton type="submit">Clone Repository</VSCodeButton>
                    </form>
                </div>
            </div>
            {projectSelection.error && <p className="error-message">{projectSelection.error}</p>}
        </div>
    );
};
