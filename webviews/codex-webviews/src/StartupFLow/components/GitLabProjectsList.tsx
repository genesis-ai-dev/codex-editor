import React from "react";
import { GitLabProject } from "../../../../../types";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface GitLabProjectsListProps {
    projects: GitLabProject[];
    onSelectProject: (project: GitLabProject) => void;
}

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onSelectProject,
}) => {
    console.log({ projects });
    return (
        <div className="gitlab-projects-list">
            {projects.map((project) => (
                <div key={project.id} className="project-row">
                    <div className="project-info">
                        <span className="project-name">{project.name}</span>
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
