import React from "react";
import { GitLabProject } from "../../../../../types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface GitLabProjectsListProps {
    projects: GitLabProject[];
    onSelectProject: (project: GitLabProject) => void;
    syncStatus?: Record<string, "synced" | "cloud" | "error">;
}

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onSelectProject,
    syncStatus = {},
}) => {
    const getStatusIcon = (projectId: number) => {
        const status = syncStatus[projectId];
        switch (status) {
            case "synced":
                return (
                    <i
                        className="codicon codicon-check status-icon synced"
                        title="Downloaded and synced"
                    />
                );
            case "error":
                return (
                    <i
                        className="codicon codicon-error status-icon error"
                        title="Local only - not synced"
                    />
                );
            case "cloud":
            default:
                return (
                    <i
                        className="codicon codicon-cloud status-icon cloud"
                        title="Available in cloud"
                    />
                );
        }
    };

    return (
        <div className="gitlab-projects-list">
            {projects.map((project) => (
                <div key={project.id} className="project-row">
                    <div className="project-info">
                        <div className="project-header">
                            <span className="project-name">{project.name}</span>
                            {getStatusIcon(project.id)}
                        </div>
                        <span className="project-description">{project.description}</span>
                    </div>
                    <VSCodeButton appearance="secondary" onClick={() => onSelectProject(project)}>
                        Clone
                    </VSCodeButton>
                </div>
            ))}
        </div>
    );
};
