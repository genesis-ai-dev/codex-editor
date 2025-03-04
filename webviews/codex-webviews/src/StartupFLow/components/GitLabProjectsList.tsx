import React, { useState, useMemo } from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import {
    VSCodeButton,
    VSCodeProgressRing,
    VSCodeBadge,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeTextField,
} from "@vscode/webview-ui-toolkit/react";
import "./GitLabProjectsList.css";

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    isLoading: boolean;
}

interface ProjectGroup {
    name: string;
    projects: ProjectWithSyncStatus[];
    subgroups: Record<string, ProjectGroup>;
    isLast: boolean;
}

interface ParsedProjectInfo {
    groups: string[];
    cleanName: string;
    displayUrl: string;
    uniqueId: string;
}

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onCloneProject,
    onOpenProject,
    isLoading,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});

    const getStatusIcon = (syncStatus: ProjectSyncStatus) => {
        switch (syncStatus) {
            case "downloadedAndSynced":
                return {
                    icon: "codicon-check",
                    title: "Downloaded and synced",
                    className: "synced",
                };
            case "error":
                return {
                    icon: "codicon-error",
                    title: "Local only - not synced",
                    className: "error",
                };
            case "cloudOnlyNotSynced":
                return {
                    icon: "codicon-cloud",
                    title: "Available in cloud",
                    className: "cloud",
                };
            case "localOnlyNotSynced":
                return {
                    icon: "codicon-vm",
                    title: "Local only - not synced with cloud",
                    className: "local",
                };
            default:
                return {
                    icon: "codicon-error",
                    title: "Error",
                    className: "error",
                };
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
            const hasUniqueId = lastPart?.length >= 20;
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

    const filterProjects = (projects: ProjectWithSyncStatus[]) => {
        if (!searchQuery) return projects;
        return projects.filter(
            (project) =>
                project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                project.gitOriginUrl?.toLowerCase().includes(searchQuery.toLowerCase())
        );
    };

    const { hierarchy, ungroupedProjects } = useMemo(
        () => groupProjectsByHierarchy(projects || []),
        [projects]
    );

    const renderProjectCard = (project: ProjectWithSyncStatus) => {
        if (!project) return null;
        const { cleanName, displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isUnpublished = !project.gitOriginUrl;
        const status = getStatusIcon(project.syncStatus);
        const isExpanded = expandedProjects[project.name];

        const mainAction = () => {
            if (project.syncStatus === "cloudOnlyNotSynced") {
                return (
                    <VSCodeButton
                        appearance="secondary"
                        onClick={() => onCloneProject(project)}
                        title="Download project"
                    >
                        <i className="codicon codicon-cloud-download"></i>
                    </VSCodeButton>
                );
            }
            if (
                project.syncStatus === "downloadedAndSynced" ||
                project.syncStatus === "localOnlyNotSynced"
            ) {
                return (
                    <VSCodeButton
                        appearance="primary"
                        onClick={() => onOpenProject(project)}
                        title="Open project"
                    >
                        <i className="codicon codicon-folder-opened"></i>
                    </VSCodeButton>
                );
            }
            return null;
        };

        return (
            <div className={`project-card ${isExpanded ? "expanded" : ""}`} key={project.name}>
                <div className="card-header">
                    <div className="status-and-name">
                        <i
                            className={`codicon ${status.icon} status-icon ${status.className}`}
                            title={status.title}
                        />
                        <div className="project-title">
                            <span className="name">{cleanName || project.name}</span>
                            {isUnpublished && <VSCodeBadge>Unpublished</VSCodeBadge>}
                        </div>
                        {uniqueId && (
                            <span
                                style={{
                                    opacity: 0.4,
                                    transition: "opacity 0.2s ease",
                                    fontSize: "0.9em",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.opacity = "1";
                                    e.currentTarget.textContent = `#${uniqueId}`;
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.opacity = "0.4";
                                    e.currentTarget.textContent = `#${uniqueId.slice(0, 3)}...`;
                                }}
                                title={`Full ID: ${uniqueId}`}
                            >
                                #{uniqueId.slice(0, 3)}...
                            </span>
                        )}
                    </div>
                    <div className="card-actions">
                        {mainAction()}
                        {displayUrl && (
                            <span
                                className={`expand-button ${isExpanded ? "expanded" : ""}`}
                                onClick={() =>
                                    setExpandedProjects((prev) => ({
                                        ...prev,
                                        [project.name]: !prev[project.name],
                                    }))
                                }
                                title={isExpanded ? "Hide URL" : "Show URL"}
                            >
                                <i className="codicon codicon-chevron-down" />
                            </span>
                        )}
                    </div>
                </div>
                {isExpanded && displayUrl && (
                    <div className="card-content">
                        <div className="url-container">
                            <p className="url">{displayUrl}</p>
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() =>
                                    navigator.clipboard.writeText(project.gitOriginUrl || "")
                                }
                                title="Copy URL to clipboard"
                            >
                                <i className="codicon codicon-copy"></i>
                            </VSCodeButton>
                            {uniqueId && <span className="unique-id">#{uniqueId}</span>}
                        </div>
                    </div>
                )}
            </div>
        );
    };

    const renderGroupSection = (group: ProjectGroup, depth: number = 0) => {
        if (!group || typeof group !== "object") return null;

        const filteredProjects = filterProjects(group.projects || []);
        const hasSubgroupsWithProjects = Object.values(group.subgroups).some((subgroup) => {
            if (!subgroup) return false;
            const filteredSubgroupProjects = filterProjects(subgroup.projects || []);
            return filteredSubgroupProjects.length > 0;
        });

        if (searchQuery && filteredProjects.length === 0 && !hasSubgroupsWithProjects) {
            return null;
        }

        const isExpanded = expandedGroups[group.name] ?? true;

        return (
            <div className="group-section" key={group.name}>
                <div
                    className="group-header"
                    onClick={() =>
                        setExpandedGroups((prev) => ({
                            ...prev,
                            [group.name]: !prev[group.name],
                        }))
                    }
                >
                    <i
                        className={`codicon ${
                            isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"
                        }`}
                    />
                    <i className="codicon codicon-folder" />
                    <h2 className="group-name">{(group.name || "").replace(/_/g, " ")}</h2>
                    <VSCodeBadge>{filteredProjects.length}</VSCodeBadge>
                </div>
                {isExpanded && (
                    <>
                        {filteredProjects.length > 0 && (
                            <div className="projects-grid">
                                {filteredProjects.map((project) => renderProjectCard(project))}
                            </div>
                        )}
                        {Object.entries(group.subgroups || {}).map(([subgroupName, subgroup]) =>
                            subgroup ? renderGroupSection(subgroup, depth + 1) : null
                        )}
                    </>
                )}
            </div>
        );
    };

    const filteredUngroupedProjects = filterProjects(ungroupedProjects || []);

    return (
        <div className="gitlab-projects-list">
            <div className="search-container">
                <VSCodeTextField
                    placeholder="Search projects..."
                    value={searchQuery}
                    onInput={(e: any) => setSearchQuery((e.target as HTMLInputElement).value)}
                >
                    <i slot="start" className="codicon codicon-search"></i>
                </VSCodeTextField>
                {searchQuery && (
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => setSearchQuery("")}
                        className="search-clear-button"
                        title="Clear search"
                    >
                        <i className="codicon codicon-close"></i>
                    </VSCodeButton>
                )}
            </div>
            {isLoading ? (
                <div className="loading-container">
                    <VSCodeProgressRing />
                </div>
            ) : (
                <div className="projects-container">
                    {Object.entries(hierarchy || {}).map(([groupName, group]) =>
                        group ? renderGroupSection(group, 0) : null
                    )}
                    {filteredUngroupedProjects.length > 0 && (
                        <div className="group-section">
                            <div className="group-header">
                                <i className="codicon codicon-folder" />
                                <h2 className="group-name">Ungrouped Projects</h2>
                                <VSCodeBadge>{filteredUngroupedProjects.length}</VSCodeBadge>
                            </div>
                            <div className="projects-grid">
                                {filteredUngroupedProjects.map((project) =>
                                    renderProjectCard(project)
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
};
