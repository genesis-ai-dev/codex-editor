import React, { useEffect, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { GitLabInfo } from "../types";
import {
    GitLabProject,
    ProjectWithSyncStatus,
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
} from "../../../../../types";
import { GitLabProjectsList } from "./GitLabProjectsList";

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
    onOpenProject: (project: ProjectWithSyncStatus) => void;
}

export const ProjectSetupStep: React.FC<ProjectSetupStepProps> = ({
    projectSelection,
    onCreateEmpty,
    onCloneRepo,
    onOpenProject,
    gitlabInfo,
    vscode,
}) => {
    const [repoUrl, setRepoUrl] = useState(projectSelection.repoUrl || "");
    const [projectsList, setProjectsList] = useState<ProjectWithSyncStatus[]>([]);
    const [syncStatus, setSyncStatus] = useState<Record<string, "synced" | "cloud" | "error">>({});

    const fetchProjectList = () => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);
    };

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            console.log({ message }, "message in ProjectSetupStep");
            if (message.command === "projectsListFromGitLab") {
                console.log(message.projects, "message in ProjectSetupStep");
                setProjectsList(message.projects);
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsSyncStatus",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            if (message.command === "projectsSyncStatus") {
                setSyncStatus(message.status);
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

    const handleProjectSelect = (project: GitLabProject) => {
        // setRepoUrl(project.url);
        vscode.postMessage({
            command: "project.clone",
            repoUrl: project.url,
        } as MessagesToStartupFlowProvider);
    };

    return (
        <div className="project-setup-step">
            <h2>Project Setup</h2>
            {gitlabInfo && (
                <div className="gitlab-info">
                    <p>Logged in as {gitlabInfo.username}</p>
                </div>
            )}

            <VSCodeButton onClick={fetchProjectList} title="Refresh">
                <i className="codicon codicon-refresh"></i>
            </VSCodeButton>
            <GitLabProjectsList
                onOpenProject={onOpenProject}
                projects={projectsList}
                onCloneProject={(project) =>
                    project.gitOriginUrl && onCloneRepo(project.gitOriginUrl)
                }
                syncStatus={syncStatus}
            />
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
