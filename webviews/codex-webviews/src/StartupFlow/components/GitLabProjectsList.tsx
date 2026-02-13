import React, { useState, useEffect } from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import { Badge } from "../../components/ui/badge";
import { Card, CardContent, CardHeader } from "../../components/ui/card";
import { Skeleton } from "../../components/ui/skeleton";
import { GroupSection } from "./projects-list/GroupSection";
import { ProjectCard } from "./projects-list/ProjectCard";
import { ProjectsHeader } from "./projects-list/ProjectsHeader";
import { EmptyState } from "./projects-list/EmptyState";
import { useNetworkState } from "@uidotdev/usehooks";

// Filter options for projects
type ProjectFilter = "all" | "local" | "remote" | "synced" | "non-synced";

// Type guard to validate filter values
function isValidFilter(value: string): value is ProjectFilter {
    return ["all", "local", "remote", "synced", "non-synced"].includes(value);
}

const INDENTATION_SIZE_REM = 1.25;

interface GitLabProjectsListProps {
    projects: ProjectWithSyncStatus[];
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    isLoading: boolean;
    isRefreshing?: boolean;
    vscode: any;
    disableAllActions?: boolean;
    currentUsername?: string;
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

const ProjectCardSkeleton = () => (
    <div className="flex items-center space-x-4 p-3">
        <Skeleton className="h-4 w-4 rounded-full" />
        <div className="space-y-2 flex-1">
            <Skeleton className="h-4 w-3/4" />
        </div>
        <Skeleton className="h-4 w-12" />
        <Skeleton className="h-6 w-16" />
    </div>
);

export const GitLabProjectsList: React.FC<GitLabProjectsListProps> = ({
    projects,
    onCloneProject,
    onOpenProject,
    onDeleteProject,
    isLoading,
    isRefreshing = false,
    vscode,
    disableAllActions = false,
    currentUsername,
}) => {
    const [isAnyApplying, setIsAnyApplying] = useState(false);
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const msg = event.data as any;
            if (msg?.command === "project.mediaStrategyApplying") {
                setIsAnyApplying(!!msg.applying);
            }
            if (msg?.command === "project.updatingInProgress") {
                setIsAnyApplying(!!msg.updating);
            }
            if (msg?.command === "project.cloningInProgress") {
                setIsAnyApplying(!!msg.cloning);
            }
            if (msg?.command === "project.openingInProgress") {
                setIsAnyApplying(!!msg.opening);
            }
            if (msg?.command === "project.zippingInProgress") {
                setIsAnyApplying(!!msg.zipping);
            }
            if (msg?.command === "project.cleaningInProgress") {
                setIsAnyApplying(!!msg.cleaning);
            }
            if (msg?.command === "project.swappingInProgress") {
                setIsAnyApplying(!!msg.swapping);
            }
            if (msg?.command === "project.fixingInProgress") {
                setIsAnyApplying(!!msg.fixing);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);
    const [searchQuery, setSearchQuery] = useState("");
    const [filter, setFilter] = useState<ProjectFilter>("all");
    const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({});
    const [expandedProjects, setExpandedProjects] = useState<Record<string, boolean>>({});
    const [projectsWithProgress, setProjectsWithProgress] = useState<ProjectWithSyncStatus[]>([]);
    const [newlyAddedProjects, setNewlyAddedProjects] = useState<Set<string>>(new Set());
    const [statusChangedProjects, setStatusChangedProjects] = useState<Set<string>>(new Set());

    const network = useNetworkState();
    const isOnline = network?.online;
    const isLocked = isAnyApplying || disableAllActions;
    
    const sortProjectsForDisplay = React.useCallback((list: ProjectWithSyncStatus[]) => {
        return [...(list || [])].sort((a, b) => {
            const aPending = a.pendingUpdate?.required ? 1 : 0;
            const bPending = b.pendingUpdate?.required ? 1 : 0;
            if (aPending !== bPending) {
                return bPending - aPending; // pending updates first
            }
            return (a.name || "").localeCompare(b.name || "");
        });
    }, []);
    
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

    // Update projects with sorted display
    useEffect(() => {
        setProjectsWithProgress(sortProjectsForDisplay(projects));
    }, [projects, sortProjectsForDisplay]);

    const getStatusIcon = (syncStatus: ProjectSyncStatus) => {
        switch (syncStatus) {
            case "downloadedAndSynced":
                return {
                    icon: "codicon-check",
                    title: "Downloaded and synced",
                    className: "text-green-500",
                };
            case "orphaned":
                return {
                    icon: "codicon-warning",
                    title: "Remote project missing or inaccessible",
                    className: "text-amber-500",
                };
            case "serverUnreachable":
                return {
                    icon: "codicon-cloud-offline",
                    title: "Server unreachable - cannot verify remote status",
                    className: "text-red-500",
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
            return {
                groups: [],
                cleanName: "",
                displayUrl: "",
                uniqueId: "",
            };
        }

        try {
            const urlObj = new URL(url);
            const pathParts = urlObj.pathname.split("/").filter(Boolean);

            if (pathParts.length >= 2) {
                const groups = pathParts.slice(0, -1);
                const projectNameWithExt = pathParts[pathParts.length - 1];
                const cleanName = projectNameWithExt.replace(/\.git$/, "");
                const displayUrl = `${urlObj.hostname}${urlObj.pathname}`;
                const uniqueId = cleanName;

                return { groups, cleanName, displayUrl, uniqueId };
            }
        } catch (error) {
            console.warn("Failed to parse project URL:", url, error);
        }

        return {
            groups: [],
            cleanName: "",
            displayUrl: url,
            uniqueId: "",
        };
    };

    const pendingProjects = React.useMemo(
        () => sortProjectsForDisplay((projectsWithProgress || []).filter((p) => p.pendingUpdate?.required)),
        [projectsWithProgress, sortProjectsForDisplay]
    );

    const pendingSwaps = React.useMemo(
        () => sortProjectsForDisplay((projectsWithProgress || []).filter((p) => 
            p.projectSwap?.isOldProject && 
            p.projectSwap?.swapStatus === "active" &&
            !p.projectSwap?.currentUserAlreadySwapped
        )),
        [projectsWithProgress, sortProjectsForDisplay]
    );

    const normalProjects = React.useMemo(
        () => (projectsWithProgress || []).filter((p) => 
            !p.pendingUpdate?.required && 
            !(p.projectSwap?.isOldProject && p.projectSwap?.swapStatus === "active" && !p.projectSwap?.currentUserAlreadySwapped)
        ),
        [projectsWithProgress]
    );

    const buildGroupedProjects = React.useCallback(
        (projects: ProjectWithSyncStatus[]) => {
            const hierarchy: Record<string, ProjectGroup> = {};
            const ungrouped: ProjectWithSyncStatus[] = [];

            projects.forEach((project) => {
                const { groups } = parseProjectUrl(project.gitOriginUrl);

                if (groups.length === 0) {
                    ungrouped.push(project);
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
                    }

                    if (index === groups.length - 1) {
                        currentLevel[group].projects.push(project);
                    } else {
                        currentLevel = currentLevel[group].subgroups;
                    }
                });
            });

            // Recursively sort projects and groups so pending updates rise to the top
            const sortGroup = (group: ProjectGroup): { group: ProjectGroup; hasPending: boolean } => {
                const sortedProjects = sortProjectsForDisplay(group.projects || []);
                const sortedSubgroupsEntries = Object.entries(group.subgroups || {})
                    .map(([name, sub]) => {
                        const { group: sg, hasPending } = sortGroup(sub);
                        return { name, group: sg, hasPending };
                    })
                    .sort((a, b) => {
                        if (a.hasPending !== b.hasPending) {
                            return a.hasPending ? -1 : 1;
                        }
                        return a.name.localeCompare(b.name);
                    });

                const rebuiltSubgroups: Record<string, ProjectGroup> = {};
                sortedSubgroupsEntries.forEach(({ name, group }) => {
                    rebuiltSubgroups[name] = group;
                });

                const hasPendingHere =
                    sortedProjects.some((p) => p.pendingUpdate?.required) ||
                    sortedSubgroupsEntries.some((s) => s.hasPending);

                return {
                    group: {
                        ...group,
                        projects: sortedProjects,
                        subgroups: rebuiltSubgroups,
                    },
                    hasPending: hasPendingHere,
                };
            };

            const sortedHierarchyEntries = Object.entries(hierarchy)
                .map(([name, group]) => {
                    const { group: g, hasPending } = sortGroup(group);
                    return { name, group: g, hasPending };
                })
                .sort((a, b) => {
                    if (a.hasPending !== b.hasPending) {
                        return a.hasPending ? -1 : 1;
                    }
                    return a.name.localeCompare(b.name);
                });

            const sortedHierarchy: Record<string, ProjectGroup> = {};
            sortedHierarchyEntries.forEach(({ name, group }) => {
                sortedHierarchy[name] = group;
            });

            return { hierarchy: sortedHierarchy, ungrouped };
        },
        [parseProjectUrl, sortProjectsForDisplay]
    );

    const { hierarchy, ungrouped: ungroupedProjects } = React.useMemo(
        () => buildGroupedProjects(normalProjects || []),
        [normalProjects, buildGroupedProjects]
    );

    const filterProjects = (projects: ProjectWithSyncStatus[]) => {
        if (!projects) return [];

        // NOTE: All swap-related visibility filtering (hiding old/new projects based on swap status)
        // is now handled server-side in StartupFlowProvider.ts before sending to webview.
        // This function only handles UI filters (all/local/remote/synced) and search.

        const filtered = projects.filter((project) => {
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
                if (!["downloadedAndSynced", "localOnlyNotSynced", "orphaned", "serverUnreachable"].includes(project.syncStatus)) {
                    return false;
                }
            } else if (currentFilter === "remote") {
                if (project.syncStatus !== "cloudOnlyNotSynced") {
                    return false;
                }
            } else if (currentFilter === "synced") {
                if (!["downloadedAndSynced", "orphaned", "serverUnreachable"].includes(project.syncStatus)) {
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

        return sortProjectsForDisplay(filtered);
    };

    // For pinned "Needs Update" section: always show, ignore search/filter
    const filterProjectsPinned = React.useCallback(
        (projects: ProjectWithSyncStatus[]) => sortProjectsForDisplay(projects || []),
        [sortProjectsForDisplay]
    );

    // Always pin all pending swaps, ignore search/filter
    const filteredPendingSwaps = React.useMemo(
        () => sortProjectsForDisplay(pendingSwaps || []),
        [pendingSwaps, sortProjectsForDisplay]
    );
    const filteredPendingSwapsGrouped = React.useMemo(() => {
        const { hierarchy, ungrouped } = buildGroupedProjects(filteredPendingSwaps || []);
        return { hierarchy, ungrouped };
    }, [filteredPendingSwaps, buildGroupedProjects]);

    // No list-level memoization; we pass shallow copies at usage sites where needed

    // Always pin all pending projects, even if they wouldn't match the current filter/search
    const filteredPendingProjects = React.useMemo(
        () => sortProjectsForDisplay(pendingProjects || []),
        [pendingProjects, sortProjectsForDisplay]
    );
    const filteredPendingGrouped = React.useMemo(() => {
        const { hierarchy, ungrouped } = buildGroupedProjects(filteredPendingProjects || []);
        return { hierarchy, ungrouped };
    }, [filteredPendingProjects, buildGroupedProjects]);
    const filteredUngroupedProjects = filterProjects(ungroupedProjects || []);

    return (
        <div className="flex flex-col gap-3 w-full flex-1 overflow-hidden min-h-0">
            <ProjectsHeader
                searchQuery={searchQuery}
                setSearchQuery={setSearchQuery}
                filter={filter}
                setFilter={setFilter}
                projects={projects}
                vscode={vscode}
                disabled={isLocked}
            />

            {isRefreshing && (
                <div className="flex items-center gap-2 px-3 py-1.5 mx-3 text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded-md animate-pulse">
                    <i className="codicon codicon-loading codicon-modifier-spin" />
                    Reconnected — refreshing projects list...
                </div>
            )}

            {isLoading ? (
                <div className="p-3 space-y-3 flex-1 overflow-y-auto">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <ProjectCardSkeleton key={i} />
                    ))}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2">
                    {/* Pending Swaps pinned to top */}
                    {filteredPendingSwaps.length > 0 && (
                        <Card className="overflow-hidden border-l-4 border-l-purple-500">
                            <CardHeader className="py-2 px-3 bg-purple-50/70 border-b border-purple-100">
                                <div className="flex items-center gap-2">
                                    <i className="codicon codicon-arrow-swap text-sm text-purple-700" />
                                    <h3 className="font-medium text-sm text-purple-800">Project Swap Required</h3>
                                    <Badge
                                        variant="outline"
                                        className="ml-auto text-xs px-1.5 py-0.5 bg-purple-100 text-purple-800 border-purple-300"
                                    >
                                        {filteredPendingSwaps.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="border-t border-purple-100">
                                    {Object.entries(filteredPendingSwapsGrouped.hierarchy || {}).map(([groupName, group]) =>
                                        group ? (
                                            <GroupSection
                                                key={`pending-swap-${groupName}`}
                                                group={{ ...group, projects: [...group.projects] }}
                                                depth={0}
                                                filter={filter}
                                                searchQuery={searchQuery}
                                                expandedGroups={expandedGroups}
                                                setExpandedGroups={setExpandedGroups}
                                                expandedProjects={expandedProjects}
                                                setExpandedProjects={setExpandedProjects}
                                                newlyAddedProjects={newlyAddedProjects}
                                                statusChangedProjects={statusChangedProjects}
                                                onCloneProject={onCloneProject}
                                                onOpenProject={onOpenProject}
                                                onDeleteProject={onDeleteProject}
                                                vscode={vscode}
                                                parseProjectUrl={parseProjectUrl}
                                                getStatusIcon={getStatusIcon}
                                                filterProjects={filterProjectsPinned}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
                                                currentUsername={currentUsername}
                                            />
                                        ) : null
                                    )}
                                    {filteredPendingSwapsGrouped.ungrouped.length > 0 &&
                                        filteredPendingSwapsGrouped.ungrouped.map((project) => (
                                            <ProjectCard
                                                key={`pending-swap-ungrouped-${project.name}-${project.gitOriginUrl || "no-url"}`}
                                                project={project}
                                                onCloneProject={onCloneProject}
                                                onOpenProject={onOpenProject}
                                                onDeleteProject={onDeleteProject}
                                                vscode={vscode}
                                                expandedProjects={expandedProjects}
                                                setExpandedProjects={setExpandedProjects}
                                                newlyAddedProjects={newlyAddedProjects}
                                                statusChangedProjects={statusChangedProjects}
                                                parseProjectUrl={parseProjectUrl}
                                                getStatusIcon={getStatusIcon}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
                                                currentUsername={currentUsername}
                                            />
                                        ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Pending updates pinned to top */}
                    {filteredPendingProjects.length > 0 && (
                        <Card className="overflow-hidden border-l-4 border-l-amber-500">
                            <CardHeader className="py-2 px-3 bg-amber-50/70 border-b border-amber-100">
                                <div className="flex items-center gap-2">
                                    <i className="codicon codicon-warning text-sm text-amber-700" />
                                    <h3 className="font-medium text-sm text-amber-800">Needs Update</h3>
                                    <Badge
                                        variant="outline"
                                        className="ml-auto text-xs px-1.5 py-0.5 bg-amber-100 text-amber-800 border-amber-300"
                                    >
                                        {filteredPendingProjects.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="border-t border-amber-100">
                                    {Object.entries(filteredPendingGrouped.hierarchy || {}).map(([groupName, group]) =>
                                        group ? (
                                            <GroupSection
                                                key={`pending-${groupName}`}
                                                group={{ ...group, projects: [...group.projects] }}
                                                depth={0}
                                                filter={filter}
                                                searchQuery={searchQuery}
                                                expandedGroups={expandedGroups}
                                                setExpandedGroups={setExpandedGroups}
                                                expandedProjects={expandedProjects}
                                                setExpandedProjects={setExpandedProjects}
                                                newlyAddedProjects={newlyAddedProjects}
                                                statusChangedProjects={statusChangedProjects}
                                                onCloneProject={onCloneProject}
                                                onOpenProject={onOpenProject}
                                                onDeleteProject={onDeleteProject}
                                                vscode={vscode}
                                                parseProjectUrl={parseProjectUrl}
                                                getStatusIcon={getStatusIcon}
                                                filterProjects={filterProjectsPinned}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
                                                currentUsername={currentUsername}
                                            />
                                        ) : null
                                    )}
                                    {filteredPendingGrouped.ungrouped.length > 0 &&
                                        filteredPendingGrouped.ungrouped.map((project) => (
                                            <ProjectCard
                                                key={`pending-ungrouped-${project.name}-${project.gitOriginUrl || "no-url"}`}
                                                project={project}
                                                onCloneProject={onCloneProject}
                                                onOpenProject={onOpenProject}
                                                onDeleteProject={onDeleteProject}
                                                vscode={vscode}
                                                expandedProjects={expandedProjects}
                                                setExpandedProjects={setExpandedProjects}
                                                newlyAddedProjects={newlyAddedProjects}
                                                statusChangedProjects={statusChangedProjects}
                                                parseProjectUrl={parseProjectUrl}
                                                getStatusIcon={getStatusIcon}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
                                                currentUsername={currentUsername}
                                            />
                                        ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Group Hierarchy */}
                    {Object.entries(hierarchy || {}).map(([groupName, group]) =>
                        group ? (
                            <GroupSection
                                key={groupName}
                                group={{ ...group, projects: [...group.projects] }}
                                depth={0}
                                filter={filter}
                                searchQuery={searchQuery}
                                expandedGroups={expandedGroups}
                                setExpandedGroups={setExpandedGroups}
                                expandedProjects={expandedProjects}
                                setExpandedProjects={setExpandedProjects}
                                newlyAddedProjects={newlyAddedProjects}
                                statusChangedProjects={statusChangedProjects}
                                onCloneProject={onCloneProject}
                                onOpenProject={onOpenProject}
                                onDeleteProject={onDeleteProject}
                                vscode={vscode}
                                parseProjectUrl={parseProjectUrl}
                                getStatusIcon={getStatusIcon}
                                filterProjects={filterProjects}
                                isAnyOperationApplying={isLocked}
                                isOnline={!!isOnline}
                                currentUsername={currentUsername}
                            />
                        ) : null
                    )}

                    {/* Ungrouped Projects */}
                    {filteredUngroupedProjects.length > 0 && (
                        <Card className="overflow-hidden border-l-4 border-l-gray-200">
                            <CardHeader className="py-2 px-3">
                                <div className="flex items-center gap-2">
                                    <i className="codicon codicon-folder text-sm text-gray-600" />
                                    <h3 className="font-medium text-sm text-foreground">
                                        Ungrouped Projects
                                    </h3>
                                    <Badge
                                        variant="outline"
                                        className="ml-auto text-xs px-1.5 py-0.5 bg-gray-50 text-gray-700 border-gray-200"
                                    >
                                        {filteredUngroupedProjects.length}
                                    </Badge>
                                </div>
                            </CardHeader>
                            <CardContent className="p-0">
                                <div className="border-t border-muted">
                                    {filteredUngroupedProjects.map((project) => (
                                        <ProjectCard
                                            key={`${project.name}-${
                                                project.gitOriginUrl || "no-url"
                                            }`}
                                            project={project}
                                            onCloneProject={onCloneProject}
                                            onOpenProject={onOpenProject}
                                            onDeleteProject={onDeleteProject}
                                            vscode={vscode}
                                            expandedProjects={expandedProjects}
                                            setExpandedProjects={setExpandedProjects}
                                            newlyAddedProjects={newlyAddedProjects}
                                            statusChangedProjects={statusChangedProjects}
                                            parseProjectUrl={parseProjectUrl}
                                            getStatusIcon={getStatusIcon}
                                            isAnyOperationApplying={isLocked}
                                            isOnline={!!isOnline}
                                            currentUsername={currentUsername}
                                        />
                                    ))}
                                </div>
                            </CardContent>
                        </Card>
                    )}

                    {/* Empty State */}
                    {filteredUngroupedProjects.length === 0 &&
                        Object.keys(hierarchy || {}).length === 0 && (
                            <EmptyState filter={filter} setFilter={setFilter} />
                        )}
                </div>
            )}
        </div>
    );
};
