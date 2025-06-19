import React, { useState, useMemo, useEffect, useRef } from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import { Button } from "../../components/ui/button";
import { Badge } from "../../components/ui/badge";
import { Input } from "../../components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../components/ui/select";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { cn } from "../../lib/utils";

// Filter options for projects
type ProjectFilter = "all" | "local" | "remote" | "synced" | "non-synced";

// Type guard to validate filter values
function isValidFilter(value: string): value is ProjectFilter {
    return ["all", "local", "remote", "synced", "non-synced"].includes(value);
}

// Debug mode flags - check if URL has debug parameters
const DEBUG_MODE = false;
const DEBUG_PROGRESS_MATCHING = false;

const INDENTATION_SIZE_REM = 1.25;

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    isLoading: boolean;
    hasPartialData?: boolean; // Indicates if we have local projects but are still loading remote
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
    hasPartialData,
    vscode,
    progressData,
}) => {
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<ProjectFilter>("all");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
    const [projectsWithProgress, setProjectsWithProgress] = useState<ProjectWithSyncStatus[]>([]);
    const [newlyAddedProjects, setNewlyAddedProjects] = useState<Set<string>>(new Set());
    const [statusChangedProjects, setStatusChangedProjects] = useState<Set<string>>(new Set());

    // Track newly added projects for animation
    useEffect(() => {
        const currentProjectNames = new Set(projects.map((p) => p.name));
        const previousProjectNames = new Set(projectsWithProgress.map((p) => p.name));

        // Find newly added projects
        const newProjects = Array.from(currentProjectNames).filter(
            (name) => !previousProjectNames.has(name)
        );

        if (newProjects.length > 0) {
            setNewlyAddedProjects(new Set(newProjects));

            // Remove the highlight after animation
            setTimeout(() => {
                setNewlyAddedProjects(new Set());
            }, 2000);
        }
    }, [projects, projectsWithProgress]);

    // Track status changes for animation
    useEffect(() => {
        const currentProjectsMap = new Map(projects.map((p) => [p.name, p.syncStatus]));
        const previousProjectsMap = new Map(
            projectsWithProgress.map((p) => [p.name, p.syncStatus])
        );

        const statusChanged = Array.from(currentProjectsMap.entries())
            .filter(([name, status]) => {
                const previousStatus = previousProjectsMap.get(name);
                return previousStatus && previousStatus !== status;
            })
            .map(([name]) => name);

        if (statusChanged.length > 0) {
            setStatusChangedProjects(new Set(statusChanged));

            // Remove the highlight after animation
            setTimeout(() => {
                setStatusChangedProjects(new Set());
            }, 1500);
        }
    }, [projects, projectsWithProgress]);

    // Add effect to update projects with progress data
    useEffect(() => {
        if (!progressData || !progressData.projectSummaries || !projects) {
            // If no progress data yet, just use the original projects
            setProjectsWithProgress([...projects]);
            return;
        }

        // Log progress data for debugging
        if (DEBUG_PROGRESS_MATCHING) {
            console.log(
                "Processing progress data:",
                progressData.projectSummaries.length,
                "project summaries"
            );
        }

        const progressMap = new Map();
        progressData.projectSummaries.forEach((summary: any) => {
            progressMap.set(summary.projectId, summary.completionPercentage);
            // Also map by name for fuzzy matching
            progressMap.set(summary.projectName, summary.completionPercentage);
            if (DEBUG_PROGRESS_MATCHING) {
                console.log(
                    `Progress for ${summary.projectName}: ${summary.completionPercentage}%`
                );
            }
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
                    if (DEBUG_PROGRESS_MATCHING) {
                        console.log(
                            `Matched by ID: ${project.name} -> ${projectCopy.completionPercentage}%`
                        );
                    }
                    return projectCopy;
                }
            }

            // Try matching by project name
            if (progressMap.has(project.name)) {
                projectCopy.completionPercentage = progressMap.get(project.name);
                if (DEBUG_PROGRESS_MATCHING) {
                    console.log(
                        `Matched by name: ${project.name} -> ${projectCopy.completionPercentage}%`
                    );
                }
                return projectCopy;
            }

            // Try fuzzy matching by checking if name is contained in other names
            for (const [key, percentage] of progressMap.entries()) {
                const projectNameLower = project.name.toLowerCase();
                const keyLower = key.toLowerCase();

                if (keyLower.includes(projectNameLower) || projectNameLower.includes(keyLower)) {
                    projectCopy.completionPercentage = percentage;
                    if (DEBUG_PROGRESS_MATCHING) {
                        console.log(
                            `Matched by fuzzy: ${project.name} -> ${projectCopy.completionPercentage}%`
                        );
                    }
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
                    className: "text-green-500",
                };
            case "error":
                return {
                    icon: "codicon-error",
                    title: "Local only - not synced",
                    className: "text-red-500",
                };
            case "cloudOnlyNotSynced":
                return {
                    icon: "codicon-cloud",
                    title: "Available in cloud",
                    className: "text-blue-500",
                };
            case "localOnlyNotSynced":
                return {
                    icon: "codicon-file",
                    title: "Local only - not synced",
                    className: "text-yellow-500",
                };
            default:
                return {
                    icon: "codicon-question",
                    title: "Unknown status",
                    className: "text-gray-500",
                };
        }
    };

    const parseProjectUrl = (url?: string) => {
        if (!url) {
            if (DEBUG_MODE) {
                console.log("parseProjectUrl: No URL provided");
            }
            return {
                groups: [],
                cleanName: "",
                displayUrl: "",
                uniqueId: "",
            };
        }

        if (DEBUG_MODE) {
            console.log(`parseProjectUrl: Parsing URL: ${url}`);
        }

        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split("/").filter(Boolean);

            if (DEBUG_MODE) {
                console.log(`parseProjectUrl: Path parts:`, pathParts);
            }

            if (pathParts.length >= 2) {
                const groups = pathParts.slice(0, -1);
                const projectNameWithExt = pathParts[pathParts.length - 1];
                const cleanName = projectNameWithExt.replace(/\.git$/, "");
                const displayUrl = `${urlObj.hostname}${urlObj.pathname}`;
                const uniqueId = cleanName;

                if (DEBUG_MODE) {
                    console.log(`parseProjectUrl: Extracted groups:`, groups);
                    console.log(`parseProjectUrl: Clean name:`, cleanName);
                }

                return { groups, cleanName, displayUrl, uniqueId };
            }
        } catch (error) {
            console.warn("Failed to parse project URL:", url, error);
            if (DEBUG_MODE) {
                console.log(`parseProjectUrl: Failed to parse URL: ${url}`, error);
            }
        }

        if (DEBUG_MODE) {
            console.log(`parseProjectUrl: Returning fallback for URL: ${url}`);
        }

        return {
            groups: [],
            cleanName: "",
            displayUrl: url,
            uniqueId: "",
        };
    };

    const groupProjectsByHierarchy = (projects: ProjectWithSyncStatus[]) => {
        const hierarchy: Record<string, ProjectGroup> = {};
        const ungrouped: ProjectWithSyncStatus[] = [];

        if (DEBUG_MODE) {
            console.log(`Grouping ${projects.length} projects by hierarchy...`);
        }

        projects.forEach((project) => {
            const { groups } = parseProjectUrl(project.gitOriginUrl);

            if (DEBUG_MODE) {
                console.log(`Project "${project.name}" parsed groups:`, groups);
            }

            if (groups.length === 0) {
                ungrouped.push(project);
                if (DEBUG_MODE) {
                    console.log(`Project "${project.name}" added to ungrouped (no groups found)`);
                }
                return;
            }

            let currentLevel = hierarchy;
            let currentPath = "";

            groups.forEach((group, index) => {
                currentPath = currentPath ? `${currentPath}/${group}` : group;

                if (!currentLevel[group]) {
                    currentLevel[group] = {
                        name: group,
                        projects: [],
                        subgroups: {},
                        isLast: index === groups.length - 1,
                    };
                    if (DEBUG_MODE) {
                        console.log(`Created group: "${group}" at path: "${currentPath}"`);
                    }
                }

                if (index === groups.length - 1) {
                    currentLevel[group].projects.push(project);
                    if (DEBUG_MODE) {
                        console.log(`Added project "${project.name}" to group "${group}"`);
                    }
                } else {
                    currentLevel = currentLevel[group].subgroups;
                }
            });
        });

        if (DEBUG_MODE) {
            console.log("Final hierarchy:", hierarchy);
            console.log(`Ungrouped projects: ${ungrouped.length}`);
        }

        return { hierarchy, ungrouped };
    };

    const { hierarchy, ungrouped: ungroupedProjects } = useMemo(
        () => groupProjectsByHierarchy(projectsWithProgress || []),
        [projectsWithProgress]
    );

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

    const renderProjectActions = (project: ProjectWithSyncStatus) => {
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);
        const isRemote = project.syncStatus === "cloudOnlyNotSynced";

        if (isLocal) {
            return (
                <div className="flex gap-1">
                    <Button
                        variant="default"
                        size="sm"
                        onClick={() => onOpenProject(project)}
                        className="h-6 text-xs px-2"
                    >
                        <i className="codicon codicon-folder-opened mr-1" />
                        Open
                    </Button>
                    {onDeleteProject && (
                        <Button
                            variant="outline"
                            size="sm"
                            onClick={() => onDeleteProject(project)}
                            className="h-6 text-xs px-2 text-red-500 hover:text-red-600"
                        >
                            <i className="codicon codicon-trash" />
                        </Button>
                    )}
                </div>
            );
        }

        if (isRemote) {
            return (
                <Button
                    variant="default"
                    size="sm"
                    onClick={() => onCloneProject(project)}
                    className="h-6 text-xs px-2"
                >
                    <i className="codicon codicon-cloud-download mr-1" />
                    Clone
                </Button>
            );
        }

        return null;
    };

    const renderProjectCard = (project: ProjectWithSyncStatus) => {
        if (!project) return null;
        const { cleanName, displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isUnpublished = !project.gitOriginUrl;
        const status = getStatusIcon(project.syncStatus);
        const isExpanded = expandedProjects[project.name];
        const isNewlyAdded = newlyAddedProjects.has(project.name);
        const isStatusChanged = statusChangedProjects.has(project.name);

        return (
            <Card
                key={project.name}
                className={cn(
                    "mb-2 transition-all duration-300 ease-in-out hover:shadow-sm border-l-4",
                    isNewlyAdded &&
                        "ring-1 ring-blue-500 ring-opacity-30 bg-blue-50 border-l-blue-500",
                    isStatusChanged &&
                        "ring-1 ring-green-500 ring-opacity-30 bg-green-50 border-l-green-500",
                    !isNewlyAdded && !isStatusChanged && "border-l-transparent"
                )}
            >
                <CardHeader className="pb-2 pt-3">
                    <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                            <div className="relative">
                                <i
                                    className={cn(
                                        "codicon text-sm",
                                        status.icon,
                                        status.className,
                                        "transition-all duration-300"
                                    )}
                                    title={status.title}
                                />
                                {/* Show a subtle loading indicator when we have partial data and this is a local project */}
                                {hasPartialData &&
                                    isLoading &&
                                    project.syncStatus === "localOnlyNotSynced" && (
                                        <div className="absolute -top-0.5 -right-0.5 w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                                    )}
                            </div>
                            <div className="flex items-center gap-2 flex-1 min-w-0">
                                <span className="font-medium truncate transition-colors duration-200 text-sm">
                                    {cleanName || project.name}
                                </span>
                                {isUnpublished && (
                                    <Badge variant="outline" className="text-xs px-1 py-0">
                                        Unpublished
                                    </Badge>
                                )}
                                {isNewlyAdded && (
                                    <Badge
                                        variant="default"
                                        className="text-xs bg-blue-500 animate-pulse px-1 py-0"
                                    >
                                        New
                                    </Badge>
                                )}
                                {isStatusChanged && (
                                    <Badge
                                        variant="default"
                                        className="text-xs bg-green-500 animate-pulse px-1 py-0"
                                    >
                                        Updated
                                    </Badge>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            {project.completionPercentage !== undefined && (
                                <div className="flex items-center gap-1">
                                    <span className="text-xs font-medium text-muted-foreground">
                                        {project.completionPercentage.toFixed(0)}%
                                    </span>
                                    <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                        <div
                                            className="h-full bg-green-500 transition-all duration-500 ease-out"
                                            style={{
                                                width: `${Math.min(
                                                    project.completionPercentage,
                                                    100
                                                )}%`,
                                            }}
                                        />
                                    </div>
                                </div>
                            )}
                            {renderProjectActions(project)}
                            {displayUrl && (
                                <Button
                                    variant="ghost"
                                    size="sm"
                                    onClick={() =>
                                        setExpandedProjects((prev) => ({
                                            ...prev,
                                            [project.name]: !prev[project.name],
                                        }))
                                    }
                                    className="h-6 w-6 p-0 transition-transform duration-200"
                                >
                                    <i
                                        className={cn(
                                            "codicon codicon-chevron-down transition-transform duration-200 text-xs",
                                            isExpanded && "rotate-180"
                                        )}
                                    />
                                </Button>
                            )}
                        </div>
                    </div>
                </CardHeader>

                {isExpanded && displayUrl && (
                    <CardContent className="pt-0 pb-3">
                        <div className="space-y-2 border-t pt-2">
                            <div className="flex items-center justify-between">
                                <span className="text-xs text-muted-foreground font-mono">
                                    {displayUrl}
                                </span>
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() =>
                                        navigator.clipboard.writeText(project.gitOriginUrl || "")
                                    }
                                    className="h-6 text-xs"
                                >
                                    <i className="codicon codicon-copy" />
                                </Button>
                            </div>
                            {uniqueId && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs text-muted-foreground">
                                        #{uniqueId}
                                    </span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => navigator.clipboard.writeText(uniqueId)}
                                        className="h-6 text-xs"
                                    >
                                        <i className="codicon codicon-copy" />
                                    </Button>
                                </div>
                            )}
                            {(project.syncStatus === "downloadedAndSynced" ||
                                project.syncStatus === "localOnlyNotSynced") && (
                                <div className="flex items-center justify-between">
                                    <span className="text-xs">{project.name}</span>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => {
                                            vscode.postMessage({
                                                command: "zipProject",
                                                projectName: project.name,
                                                projectPath: project.path,
                                            });
                                        }}
                                        className="h-6 text-xs"
                                    >
                                        <i className="codicon codicon-package mr-1" />
                                        ZIP
                                    </Button>
                                </div>
                            )}
                        </div>
                    </CardContent>
                )}
            </Card>
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
            <div key={group.name} className="mb-4">
                <div
                    className="flex items-center gap-2 p-2 bg-muted/30 rounded-md cursor-pointer hover:bg-muted/50 transition-colors"
                    style={{ marginLeft: `${depth * INDENTATION_SIZE_REM}rem` }}
                    onClick={() =>
                        setExpandedGroups((prev) => ({
                            ...prev,
                            [group.name]: !(prev[group.name] ?? true),
                        }))
                    }
                >
                    <i
                        className={cn(
                            "codicon transition-transform text-sm",
                            isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"
                        )}
                    />
                    <i className="codicon codicon-folder text-sm" />
                    <h3 className="font-medium text-sm">{(group.name || "").replace(/_/g, " ")}</h3>
                    <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
                        {filteredProjects.length}
                    </Badge>
                </div>
                {isExpanded && (
                    <div className="mt-2 space-y-1">
                        {filteredProjects.length > 0 && (
                            <div
                                className="space-y-1"
                                style={{ marginLeft: `${(depth + 1) * INDENTATION_SIZE_REM}rem` }}
                            >
                                {filteredProjects.map((project) => renderProjectCard(project))}
                            </div>
                        )}
                        {Object.entries(group.subgroups || {}).map(([subgroupName, subgroup]) =>
                            subgroup ? renderGroupSection(subgroup, depth + 1) : null
                        )}
                    </div>
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
        <div className="flex flex-col gap-3 h-[calc(100vh-130px)] w-full">
            <div className="sticky top-0 z-10 bg-background p-3 border-b shadow-sm">
                <div className="flex gap-2 items-center">
                    <div className="relative flex-1">
                        <i className="codicon codicon-search absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground text-sm" />
                        <Input
                            placeholder="Search projects..."
                            value={searchQuery}
                            onChange={(e) => setSearchQuery(e.target.value)}
                            className="pl-8 h-8 text-sm"
                        />
                        {searchQuery && (
                            <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => setSearchQuery("")}
                                className="absolute right-1 top-1/2 transform -translate-y-1/2 h-6 w-6 p-0"
                            >
                                <i className="codicon codicon-close text-xs" />
                            </Button>
                        )}
                    </div>

                    <Select
                        value={filter}
                        onValueChange={(value) => setFilter(value as ProjectFilter)}
                    >
                        <SelectTrigger className="w-40 h-8 text-sm">
                            <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                            <SelectItem value="all">
                                All Projects ({getFilterCount("all")})
                            </SelectItem>
                            <SelectItem value="local">
                                Available Locally ({getFilterCount("local")})
                            </SelectItem>
                            <SelectItem value="remote">
                                Remote Only ({getFilterCount("remote")})
                            </SelectItem>
                            <SelectItem value="synced">
                                Synced Projects ({getFilterCount("synced")})
                            </SelectItem>
                            <SelectItem value="non-synced">
                                Non-Synced Projects ({getFilterCount("non-synced")})
                            </SelectItem>
                        </SelectContent>
                    </Select>

                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => {
                            vscode.postMessage({
                                command: "forceRefreshProjectsList",
                            });
                        }}
                        className="h-8 w-8 p-0"
                        title="Force refresh projects list"
                    >
                        <i className="codicon codicon-refresh text-sm" />
                    </Button>
                </div>
            </div>

            {isLoading && !hasPartialData ? (
                <div className="flex justify-center items-center p-6">
                    <div className="text-center">
                        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-primary mx-auto mb-3"></div>
                        <p className="text-sm text-muted-foreground">Loading projects...</p>
                    </div>
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-3">
                    {/* Show loading indicator at top when we have partial data */}
                    {hasPartialData && isLoading && (
                        <div className="flex items-center gap-2 p-2 bg-blue-50 border border-blue-200 rounded-md mb-3 animate-pulse">
                            <div className="animate-spin rounded-full h-3 w-3 border-b-2 border-blue-500"></div>
                            <span className="text-xs text-blue-700">
                                Loading remote projects...
                            </span>
                        </div>
                    )}

                    {/* Debug information - only show when DEBUG_MODE is true */}
                    {DEBUG_MODE && (
                        <Card className="p-4">
                            <h3 className="font-semibold mb-2">Debug Information</h3>
                            <div className="space-y-4">
                                <div>
                                    <h4 className="font-medium mb-2">
                                        Raw Projects Data ({projects.length} projects)
                                    </h4>
                                    <pre className="text-xs overflow-auto max-h-40 bg-gray-100 p-2 rounded">
                                        {JSON.stringify(projects, null, 2)}
                                    </pre>
                                </div>
                                {progressData && (
                                    <div>
                                        <h4 className="font-medium mb-2">Progress Data</h4>
                                        <pre className="text-xs overflow-auto max-h-40 bg-gray-100 p-2 rounded">
                                            {JSON.stringify(progressData, null, 2)}
                                        </pre>
                                    </div>
                                )}
                                <div>
                                    <h4 className="font-medium mb-2">Hierarchy Structure</h4>
                                    <pre className="text-xs overflow-auto max-h-40 bg-gray-100 p-2 rounded">
                                        {JSON.stringify(hierarchy, null, 2)}
                                    </pre>
                                </div>
                                <div>
                                    <h4 className="font-medium mb-2">
                                        Ungrouped Projects ({ungroupedProjects.length})
                                    </h4>
                                    <pre className="text-xs overflow-auto max-h-40 bg-gray-100 p-2 rounded">
                                        {JSON.stringify(ungroupedProjects, null, 2)}
                                    </pre>
                                </div>
                                <div>
                                    <h4 className="font-medium mb-2">Refresh Information</h4>
                                    <div className="text-xs bg-gray-100 p-2 rounded">
                                        <p>
                                            • Periodic refresh: Every 5 minutes (when authenticated)
                                        </p>
                                        <p>• Force refresh: Use the refresh button above</p>
                                        <p>
                                            • Manual refresh: Use the refresh button in
                                            ProjectSetupStep
                                        </p>
                                        <p>• Last update: {new Date().toLocaleTimeString()}</p>
                                    </div>
                                </div>
                            </div>
                        </Card>
                    )}
                    {Object.entries(hierarchy || {}).map(([groupName, group]) =>
                        group ? renderGroupSection(group, 0) : null
                    )}
                    {filteredUngroupedProjects.length > 0 && (
                        <div>
                            <div className="flex items-center gap-2 p-2 bg-muted/30 rounded-md mb-2">
                                <i className="codicon codicon-folder text-sm" />
                                <h3 className="font-medium text-sm">Ungrouped Projects</h3>
                                <Badge variant="secondary" className="ml-auto text-xs px-1.5 py-0">
                                    {filteredUngroupedProjects.length}
                                </Badge>
                            </div>
                            <div
                                className="space-y-1"
                                style={{ marginLeft: `${INDENTATION_SIZE_REM}rem` }}
                            >
                                {filteredUngroupedProjects.map((project) =>
                                    renderProjectCard(project)
                                )}
                            </div>
                        </div>
                    )}

                    {filteredUngroupedProjects.length === 0 &&
                        Object.keys(hierarchy || {}).length === 0 && (
                            <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
                                <i className="codicon codicon-info text-2xl text-muted-foreground" />
                                <p className="text-sm text-muted-foreground">
                                    No projects match the current filters
                                </p>
                                {filter !== "all" && (
                                    <Button
                                        onClick={() => setFilter("all")}
                                        size="sm"
                                        className="text-xs"
                                    >
                                        Show All Projects
                                    </Button>
                                )}
                            </div>
                        )}
                </div>
            )}
        </div>
    );
};
