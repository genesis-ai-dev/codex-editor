import React, { useState, useMemo, useEffect, useRef } from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import {
    VSCodeButton,
    VSCodeProgressRing,
    VSCodeBadge,
    VSCodeDivider,
    VSCodeDropdown,
    VSCodeTextField,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import "./GitLabProjectsList.css";

// Filter options for projects
type ProjectFilter = "all" | "local" | "remote" | "synced" | "non-synced";

// Type guard to validate filter values
function isValidFilter(value: string): value is ProjectFilter {
    return ["all", "local", "remote", "synced", "non-synced"].includes(value);
}

// Debug mode flag - check if URL has debug=true
const DEBUG_MODE = new URLSearchParams(window.location.search).get("debug") === "true";

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    isLoading: boolean;
    vscode: any;
    progressData?: any;
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
    onDeleteProject,
    isLoading,
    vscode,
    progressData,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<ProjectFilter>("all");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
    const [projectsWithProgress, setProjectsWithProgress] = useState<ProjectWithSyncStatus[]>([]);
    const dropdownRef = useRef<HTMLSelectElement | null>(null);

    // Add effect to handle dropdown changes
    useEffect(() => {
        const dropdown = document.getElementById("project-filter") as HTMLSelectElement;
        if (!dropdown) return;

        // Store ref to dropdown
        dropdownRef.current = dropdown;

        // Set initial selected value
        dropdown.value = filter;

        const handleChange = () => {
            const newValue = dropdown.value;
            if (isValidFilter(newValue)) {
                setFilter(newValue);
            }
        };

        dropdown.addEventListener("change", handleChange);
        return () => dropdown.removeEventListener("change", handleChange);
    }, []);

    // Update dropdown when filter changes programmatically
    useEffect(() => {
        if (dropdownRef.current) {
            dropdownRef.current.value = filter;
        }
    }, [filter]);

    // Update dropdown option text when filter counts change due to search
    useEffect(() => {
        const dropdown = document.getElementById("project-filter") as HTMLSelectElement;
        if (!dropdown) return;

        // Update the option text to reflect current counts
        const options = dropdown.querySelectorAll("vscode-option");
        options.forEach((option: Element) => {
            const value = option.getAttribute("value");
            if (value && isValidFilter(value)) {
                const count = getFilterCount(value);
                const label = getFilterLabel(value);
                option.textContent = `${label} (${count})`;
            }
        });
    }, [searchQuery, projects]);

    // Add effect to update projects with progress data
    useEffect(() => {
        if (!progressData || !progressData.projectSummaries || !projects) {
            // If no progress data yet, just use the original projects
            setProjectsWithProgress([...projects]);
            return;
        }

        // Log progress data for debugging
        console.log(
            "Processing progress data:",
            progressData.projectSummaries.length,
            "project summaries"
        );

        const progressMap = new Map();
        progressData.projectSummaries.forEach((summary: any) => {
            progressMap.set(summary.projectId, summary.completionPercentage);
            // Also map by name for fuzzy matching
            progressMap.set(summary.projectName, summary.completionPercentage);
            console.log(`Progress for ${summary.projectName}: ${summary.completionPercentage}%`);
        });

        // Create a deep copy of projects to update
        const updatedProjects = projects.map((project) => {
            const projectCopy = { ...project };

            // First try direct ID match
            if (project.gitOriginUrl) {
                // Extract project ID from URL or name
                const urlParts = project.gitOriginUrl.split("/");
                const possibleId = urlParts[urlParts.length - 1].replace(".git", "");

                if (progressMap.has(possibleId)) {
                    projectCopy.completionPercentage = progressMap.get(possibleId);
                    console.log(
                        `Matched by ID: ${project.name} -> ${projectCopy.completionPercentage}%`
                    );
                    return projectCopy;
                }
            }

            // Try matching by project name
            if (progressMap.has(project.name)) {
                projectCopy.completionPercentage = progressMap.get(project.name);
                console.log(
                    `Matched by name: ${project.name} -> ${projectCopy.completionPercentage}%`
                );
                return projectCopy;
            }

            // Try fuzzy matching by checking if name is contained in other names
            for (const [key, percentage] of progressMap.entries()) {
                const projectNameLower = project.name.toLowerCase();
                const keyLower = key.toLowerCase();

                if (keyLower.includes(projectNameLower) || projectNameLower.includes(keyLower)) {
                    projectCopy.completionPercentage = percentage;
                    console.log(
                        `Matched by fuzzy: ${project.name} -> ${projectCopy.completionPercentage}%`
                    );
                    return projectCopy;
                }
            }

            return projectCopy;
        });

        setProjectsWithProgress(updatedProjects);
    }, [progressData, projects]);

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
        if (!projects) return [];

        return projects.filter((project) => {
            // Safe type comparison for filters
            const currentFilter = filter as string;

            // Apply status filter based on current filter setting
            if (currentFilter === "all") {
                // Apply only search filter for "all"
                if (searchQuery) {
                    return (
                        project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                        project.gitOriginUrl?.toLowerCase().includes(searchQuery.toLowerCase())
                    );
                }
                return true;
            } else if (currentFilter === "local") {
                if (!["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus)) {
                    return false;
                }
            } else if (currentFilter === "remote") {
                if (project.syncStatus !== "cloudOnlyNotSynced") {
                    return false;
                }
            } else if (currentFilter === "synced") {
                if (project.syncStatus !== "downloadedAndSynced") {
                    return false;
                }
            } else if (currentFilter === "non-synced") {
                if (project.syncStatus !== "localOnlyNotSynced") {
                    return false;
                }
            }

            // Then apply search filter if there is a query
            if (searchQuery) {
                return (
                    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    project.gitOriginUrl?.toLowerCase().includes(searchQuery.toLowerCase())
                );
            }

            return true;
        });
    };

    const { hierarchy, ungroupedProjects } = useMemo(
        () => groupProjectsByHierarchy(projectsWithProgress || []),
        [projectsWithProgress]
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
                    <div style={{ display: "flex", gap: "8px" }}>
                        <VSCodeButton
                            appearance="primary"
                            onClick={() => onOpenProject(project)}
                            title="Open project"
                        >
                            <i className="codicon codicon-folder-opened"></i>
                        </VSCodeButton>
                        {onDeleteProject && (
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => onDeleteProject(project)}
                                title="Delete local project"
                            >
                                <i className="codicon codicon-trash"></i>
                            </VSCodeButton>
                        )}
                    </div>
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
                        {project.completionPercentage !== undefined && (
                            <div
                                className="compact-progress"
                                title={`Translation Progress: ${project.completionPercentage.toFixed(
                                    2
                                )}%`}
                            >
                                <span className="compact-progress-text">
                                    {project.completionPercentage.toFixed(1)}%
                                </span>
                                <div className="compact-progress-bar-container">
                                    <div
                                        className="compact-progress-bar"
                                        style={{
                                            width: `${Math.min(
                                                project.completionPercentage,
                                                100
                                            )}%`,
                                        }}
                                    ></div>
                                </div>
                            </div>
                        )}
                        {mainAction()}
                        {displayUrl ? (
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
                        ) : (
                            // Add a placeholder with the same width as the expand button when there's no URL
                            // This ensures trash buttons align between cloud and local projects
                            <span style={{ width: "28px", display: "inline-block" }}></span>
                        )}
                    </div>
                </div>

                {isExpanded && displayUrl && (
                    <div className="card-content">
                        <div className="url-container">
                            <div className="url-row">
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
                            </div>
                            {uniqueId && (
                                <div
                                    className="unique-id-row"
                                    style={{
                                        borderBottom:
                                            project.syncStatus === "downloadedAndSynced" ||
                                            project.syncStatus === "localOnlyNotSynced"
                                                ? "1px solid var(--vscode-widget-border)"
                                                : "none",
                                        marginBottom:
                                            project.syncStatus === "downloadedAndSynced" ||
                                            project.syncStatus === "localOnlyNotSynced"
                                                ? "8px"
                                                : "0",
                                        paddingBottom:
                                            project.syncStatus === "downloadedAndSynced" ||
                                            project.syncStatus === "localOnlyNotSynced"
                                                ? "8px"
                                                : "0",
                                    }}
                                >
                                    <span className="unique-id">#{uniqueId}</span>
                                    <VSCodeButton
                                        appearance="secondary"
                                        onClick={() => navigator.clipboard.writeText(uniqueId)}
                                        title="Copy ID to clipboard"
                                    >
                                        <i className="codicon codicon-copy"></i>
                                    </VSCodeButton>
                                </div>
                            )}
                            {(project.syncStatus === "downloadedAndSynced" ||
                                project.syncStatus === "localOnlyNotSynced") && (
                                <div className="zip-button-row">
                                    <span className="project-name">{project.name}</span>
                                    <VSCodeButton
                                        appearance="secondary"
                                        onClick={() => {
                                            vscode.postMessage({
                                                command: "zipProject",
                                                projectName: project.name,
                                                projectPath: project.path,
                                            });
                                        }}
                                        title="Download as ZIP"
                                    >
                                        <i className="codicon codicon-package"></i>
                                    </VSCodeButton>
                                </div>
                            )}
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

        if (
            (filter !== "all" || searchQuery) &&
            filteredProjects.length === 0 &&
            !hasSubgroupsWithProjects
        ) {
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

    const getFilterLabel = (filterType: ProjectFilter): string => {
        switch (filterType) {
            case "all":
                return "All Projects";
            case "local":
                return "Available Locally";
            case "remote":
                return "Remote Only";
            case "synced":
                return "Synced Projects";
            case "non-synced":
                return "Non-Synced Projects";
            default:
                return "All Projects";
        }
    };

    const getFilterCount = (filterType: ProjectFilter) => {
        // First filter by the filter type
        const typeFilteredProjects = projects.filter((project) => {
            if (filterType === "all") return true;
            if (filterType === "local") {
                return ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);
            }
            if (filterType === "remote") {
                return project.syncStatus === "cloudOnlyNotSynced";
            }
            if (filterType === "synced") {
                return project.syncStatus === "downloadedAndSynced";
            }
            if (filterType === "non-synced") {
                return project.syncStatus === "localOnlyNotSynced";
            }
            return false;
        });

        // If there's a search query, further filter the results
        if (searchQuery) {
            return typeFilteredProjects.filter(
                (project) =>
                    project.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    project.description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
                    project.gitOriginUrl?.toLowerCase().includes(searchQuery.toLowerCase())
            ).length;
        }

        return typeFilteredProjects.length;
    };

    return (
        <div className="gitlab-projects-list">
            <div className="search-filter-container">
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

                <div className="filter-container">
                    <VSCodeDropdown id="project-filter">
                        <VSCodeOption value="all">
                            All Projects ({getFilterCount("all")})
                        </VSCodeOption>
                        <VSCodeOption value="local">
                            Available Locally ({getFilterCount("local")})
                        </VSCodeOption>
                        <VSCodeOption value="remote">
                            Remote Only ({getFilterCount("remote")})
                        </VSCodeOption>
                        <VSCodeOption value="synced">
                            Synced Projects ({getFilterCount("synced")})
                        </VSCodeOption>
                        <VSCodeOption value="non-synced">
                            Non-Synced Projects ({getFilterCount("non-synced")})
                        </VSCodeOption>
                    </VSCodeDropdown>
                </div>
            </div>

            {isLoading ? (
                <div className="loading-container">
                    <VSCodeProgressRing />
                </div>
            ) : (
                <div className="projects-container">
                    {/* Debug information - only show when DEBUG_MODE is true */}
                    {DEBUG_MODE && progressData && (
                        <div className="debug-info">
                            <h3>Debug Information</h3>
                            <pre>{JSON.stringify(progressData, null, 2)}</pre>
                        </div>
                    )}
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

                    {filteredUngroupedProjects.length === 0 &&
                        Object.keys(hierarchy || {}).length === 0 && (
                            <div className="no-results">
                                <i className="codicon codicon-info"></i>
                                <p>No projects match the current filters</p>
                                {filter !== "all" && (
                                    <VSCodeButton onClick={() => setFilter("all")}>
                                        Show All Projects
                                    </VSCodeButton>
                                )}
                            </div>
                        )}
                </div>
            )}
        </div>
    );
};
