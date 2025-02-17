import React from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    syncStatus?: Record<string, "synced" | "cloud" | "error">;
    isLoading: boolean;
}

interface ProjectGroup {
    name: string;
    projects: ProjectWithSyncStatus[];
    subgroups: Record<string, ProjectGroup>;
    isLast: boolean;
}

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onCloneProject,
    onOpenProject,
    isLoading,
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

    const parseProjectUrl = (url?: string) => {
        if (!url) return { groups: [], cleanName: "", displayUrl: "", uniqueId: "" };

        try {
            const parsed = new URL(url);
            const pathParts = parsed.pathname.split("/").filter(Boolean);

            // Extract groups hierarchy (all parts except last)
            const groups = pathParts.slice(0, -1);
            const fullName = pathParts[pathParts.length - 1]?.replace(/\.git$/, "") || "";
            const nameParts = fullName.split("-");

            // Extract 20-character ID if it exists
            const lastPart = nameParts[nameParts.length - 1];
            const hasUniqueId = lastPart?.length === 20;
            const uniqueId = hasUniqueId ? nameParts.pop()! : "";
            const cleanName = nameParts.join("-");

            // Rebuild display URL with hierarchy
            const displayPath = [
                ...groups,
                `${cleanName}${parsed.pathname.endsWith(".git") ? ".git" : ""}`,
            ].join("/");
            const displayUrl = new URL(displayPath, parsed.origin).toString();

            return { groups, cleanName, displayUrl, uniqueId };
        } catch {
            return { groups: [], cleanName: "", displayUrl: "", uniqueId: "" };
        }
    };

    const groupProjectsByHierarchy = (projects: ProjectWithSyncStatus[]) => {
        if (!Array.isArray(projects)) {
            console.warn("Invalid projects data received:", projects);
            return {};
        }

        const hierarchy: Record<string, ProjectGroup> = {};
        const ungroupedProjects: ProjectWithSyncStatus[] = [];

        projects.forEach((project) => {
            if (!project) return;

            // If no gitOriginUrl or no groups, add to ungrouped
            if (!project.gitOriginUrl) {
                ungroupedProjects.push(project);
                return;
            }

            const { groups } = parseProjectUrl(project.gitOriginUrl);

            // If no valid groups, add to ungrouped
            if (!Array.isArray(groups) || groups.length === 0) {
                ungroupedProjects.push(project);
                return;
            }

            let currentLevel = hierarchy;
            const currentPath: string[] = [];

            for (const group of groups) {
                if (!group) continue;
                currentPath.push(group);

                // Create path if it doesn't exist
                if (!currentLevel[group]) {
                    currentLevel[group] = {
                        name: group,
                        projects: [],
                        subgroups: {},
                        isLast: currentPath.length === groups.length,
                    };
                }

                // Move to next level
                const nextLevel = currentLevel[group].subgroups;
                if (!nextLevel) {
                    currentLevel[group].subgroups = {};
                }

                // Add project to current level
                if (currentPath.length === groups.length) {
                    if (!Array.isArray(currentLevel[group].projects)) {
                        currentLevel[group].projects = [];
                    }
                    currentLevel[group].projects.push(project);
                    break;
                }

                currentLevel = currentLevel[group].subgroups;
            }
        });

        return { hierarchy, ungroupedProjects };
    };

    const renderProjectRow = (project: ProjectWithSyncStatus, depth: number = 0) => {
        if (!project) return null;
        const { cleanName, displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isUnpublished = !project.gitOriginUrl;

        return (
            <tr key={project.name}>
                <td style={sharedStyles.cell}>
                    {project.syncStatus && getStatusIcon(project.syncStatus)}
                </td>
                <td style={sharedStyles.cell}>
                    <div
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "start",
                            gap: "0.25rem",
                            paddingLeft: `${depth * 20}px`,
                        }}
                    >
                        <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span style={{ fontWeight: "bold", fontSize: "1.1em" }}>
                                {cleanName || project.name}
                            </span>
                            {isUnpublished && (
                                <span
                                    style={{
                                        fontSize: "0.8em",
                                        padding: "0.1rem 0.5rem",
                                        borderRadius: "3px",
                                        backgroundColor: "var(--vscode-badge-background)",
                                        color: "var(--vscode-badge-foreground)",
                                    }}
                                >
                                    Unpublished
                                </span>
                            )}
                        </div>
                        {displayUrl && (
                            <span
                                style={{
                                    color: "var(--vscode-textLink-foreground)",
                                    fontSize: "0.9em",
                                }}
                            >
                                {displayUrl}
                                {uniqueId && (
                                    <span
                                        style={{
                                            fontSize: "0.8em",
                                            marginLeft: "0.5rem",
                                            opacity: 0.7,
                                            color: "var(--vscode-descriptionForeground)",
                                        }}
                                    >
                                        #{uniqueId}
                                    </span>
                                )}
                            </span>
                        )}
                    </div>
                </td>
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
                        <VSCodeButton onClick={() => onOpenProject(project)} title="Open project">
                            <i className="codicon codicon-folder-opened"></i>
                        </VSCodeButton>
                    )}
                </td>
            </tr>
        );
    };

    const renderGroup = (group: ProjectGroup, depth: number = 0): React.ReactNode => {
        if (!group || typeof group !== "object") return null;

        return (
            <>
                <tr key={group.name} style={{ background: "var(--vscode-sideBar-background)" }}>
                    <td
                        colSpan={4}
                        style={{
                            paddingLeft: `${depth * 20}px`,
                            fontWeight: "600",
                            color: "var(--vscode-foreground)",
                        }}
                    >
                        <i className="codicon codicon-folder" style={{ marginRight: "8px" }} />
                        {(group.name || "").replace(/_/g, " ")}
                    </td>
                </tr>
                {Array.isArray(group.projects) &&
                    group.projects.map((project) => renderProjectRow(project, depth + 1))}
                {group.subgroups &&
                    Object.entries(group.subgroups).map(([subgroupName, subgroup]) =>
                        subgroup ? renderGroup(subgroup, depth + 1) : null
                    )}
            </>
        );
    };

    const { hierarchy, ungroupedProjects } = groupProjectsByHierarchy(projects);

    return (
        <div
            className="gitlab-projects-list"
            style={{
                padding: "1rem",
                minHeight: "200px",
                maxHeight: "calc(100vh - 300px)",
                overflowY: "auto",
            }}
        >
            {isLoading ? (
                <div style={{ display: "flex", justifyContent: "center", padding: "2rem" }}>
                    <VSCodeProgressRing />
                </div>
            ) : (
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
                        {Array.isArray(ungroupedProjects) &&
                            ungroupedProjects.map((project) => renderProjectRow(project, 0))}
                        {Object.entries(hierarchy || {}).map(([groupName, group]) =>
                            group ? renderGroup(group, 0) : null
                        )}
                    </tbody>
                </table>
            )}
        </div>
    );
};
