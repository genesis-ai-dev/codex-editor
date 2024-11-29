import React from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "../../../../../types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    syncStatus?: Record<string, "synced" | "cloud" | "error">;
}

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onCloneProject,
    onOpenProject,
}) => {
    const getStatusIcon = (syncStatus: ProjectSyncStatus) => {
        switch (syncStatus) {
            case "downloadedAndSynced":
                return (
                    <i
                        className="codicon codicon-check status-icon synced"
                        title="Downloaded and synced"
                    />
                );
            case "error":
                return (
                    <i
                        className="codicon codicon-error status-icon"
                        title="Local only - not synced"
                    />
                );
            case "cloudOnlyNotSynced":
                return (
                    <i className="codicon codicon-cloud status-icon" title="Available in cloud" />
                );
            case "localOnlyNotSynced":
                return (
                    <i
                        className="codicon codicon-vm status-icon"
                        title="Local only - not synced with cloud"
                    />
                );
            default:
                return <i className="codicon codicon-error status-icon" title="Error" />;
        }
    };
    const sharedStyles = {
        cell: {
            padding: "0.5rem",
            textAlign: "center" as const,
        },
        table: {
            padding: "0.5rem",
            textAlign: "center" as const,
            margin: "0 auto",
        },
    };

    return (
        <div
            className="gitlab-projects-list"
            style={{
                padding: "1rem",
                maxHeight: "400px",
                overflowY: "auto",
            }}
        >
            <table style={sharedStyles.table}>
                <thead>
                    <tr>
                        <th style={sharedStyles.cell}>Status</th>
                        <th style={sharedStyles.cell}>Project Name</th>
                        <th style={sharedStyles.cell}>Description</th>
                        <th style={sharedStyles.cell}>Actions</th>
                    </tr>
                </thead>
                <tbody>
                    {projects.map((project) => (
                        <tr key={project.name}>
                            <td style={sharedStyles.cell}>
                                {project.syncStatus && getStatusIcon(project.syncStatus)}
                            </td>
                            <td style={sharedStyles.cell}>{project.name}</td>
                            <td style={sharedStyles.cell}>{project.description}</td>
                            <td style={sharedStyles.cell}>
                                {project.syncStatus === "cloudOnlyNotSynced" && (
                                    <VSCodeButton
                                        appearance="secondary"
                                        onClick={() => onCloneProject(project)}
                                        title="Download project"
                                    >
                                        <i className="codicon codicon-cloud-download"></i>
                                    </VSCodeButton>
                                )}
                                {(project.syncStatus === "downloadedAndSynced" ||
                                    project.syncStatus === "localOnlyNotSynced") && (
                                    <VSCodeButton
                                        // appearance="icon"
                                        onClick={() => onOpenProject(project)}
                                        title="Open project"
                                    >
                                        <i className="codicon codicon-folder-opened"></i>
                                    </VSCodeButton>
                                )}
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </div>
    );
};
