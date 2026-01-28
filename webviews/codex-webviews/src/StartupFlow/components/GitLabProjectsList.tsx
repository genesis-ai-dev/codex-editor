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
    vscode: any;
    progressData?: any;
    disableAllActions?: boolean;
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
    vscode,
    progressData,
    disableAllActions = false,
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

    // Add effect to update projects with progress data
    useEffect(() => {
        if (!progressData || !progressData.projectSummaries || !projects) {
            // If no progress data yet, just use the original projects
            setProjectsWithProgress(sortProjectsForDisplay(projects));
            return;
        }

        const progressMap = new Map();
        progressData.projectSummaries.forEach((summary: any) => {
            progressMap.set(summary.projectId, summary.completionPercentage);
            // Also map by name for fuzzy matching
            progressMap.set(summary.projectName, summary.completionPercentage);
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
                    return projectCopy;
                }
            }

            // Try matching by project name
            if (progressMap.has(project.name)) {
                projectCopy.completionPercentage = progressMap.get(project.name);
                return projectCopy;
            }

            // Try fuzzy matching by checking if name is contained in other names
            for (const [key, percentage] of progressMap.entries()) {
                const projectNameLower = project.name.toLowerCase();
                const keyLower = key.toLowerCase();

                if (keyLower.includes(projectNameLower) || projectNameLower.includes(keyLower)) {
                    projectCopy.completionPercentage = percentage;
                    return projectCopy;
                }
            }

            return projectCopy;
        });

        setProjectsWithProgress(sortProjectsForDisplay(updatedProjects));
    }, [progressData, projects, sortProjectsForDisplay]);

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
            p.projectSwap?.swapStatus === "active"
        )),
        [projectsWithProgress, sortProjectsForDisplay]
    );

    const normalProjects = React.useMemo(
        () => (projectsWithProgress || []).filter((p) => 
            !p.pendingUpdate?.required && 
            !(p.projectSwap?.isOldProject && p.projectSwap?.swapStatus === "active")
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

    const normalizeUrl = React.useCallback((url?: string) => {
        if (!url) return "";
        try {
            let clean = url.trim();
            // Strip credentials
            if (clean.startsWith("http")) {
                const u = new URL(clean);
                u.username = "";
                u.password = "";
                let path = u.pathname;
                if (path.endsWith(".git")) path = path.slice(0, -4);
                if (path.endsWith("/")) path = path.slice(0, -1);
                return `${u.host}${path}`.toLowerCase();
            }
            // SSH style git@host:path
            if (clean.includes("@") && clean.includes(":")) {
                const parts = clean.split("@");
                let domainAndPath = parts[1];
                domainAndPath = domainAndPath.replace(":", "/");
                if (domainAndPath.endsWith(".git")) domainAndPath = domainAndPath.slice(0, -4);
                if (domainAndPath.endsWith("/")) domainAndPath = domainAndPath.slice(0, -1);
                return domainAndPath.toLowerCase();
            }
            clean = clean.toLowerCase();
            if (clean.endsWith(".git")) clean = clean.slice(0, -4);
            if (clean.endsWith("/")) clean = clean.slice(0, -1);
            return clean;
        } catch {
            return url.trim().toLowerCase();
        }
    }, []);

    const addUrlVariants = (set: Set<string>, url?: string) => {
        if (!url) return;
        const normalized = normalizeUrl(url);
        if (normalized) set.add(normalized);
        set.add(url.trim().toLowerCase());
    };

    const urlMatchesAny = (url: string, candidates: Set<string>) => {
        const norm = normalizeUrl(url);
        for (const candidate of candidates) {
            if (!candidate) continue;
            if (norm.includes(candidate) || candidate.includes(norm)) return true;
            if (url.toLowerCase().includes(candidate) || candidate.includes(url.toLowerCase())) return true;
        }
        return false;
    };

    const filterProjects = (projects: ProjectWithSyncStatus[]) => {
        if (!projects) return [];

        // Identify new projects that should be hidden because the old one is present locally
        const hiddenNewProjectUrls = new Set<string>();
        const localProjectUrls = new Set<string>();
        const hiddenOldProjectUrls = new Set<string>();
        
        // Check all projects (including pending ones) to build the hidden list
        projectsWithProgress.forEach(p => {
            // If this is a LOCAL OLD project with an active swap, hide the new project from the list
            // Only hide new when old is LOCAL - if old is cloud-only, user doesn't need to swap
            if (
                p.syncStatus !== "cloudOnlyNotSynced" &&
                p.projectSwap && 
                p.projectSwap.isOldProject && 
                p.projectSwap?.swapStatus === "active"
            ) {
                addUrlVariants(hiddenNewProjectUrls, p.projectSwap.newProjectUrl);
            }
            if (p.gitOriginUrl && p.syncStatus !== "cloudOnlyNotSynced") {
                addUrlVariants(localProjectUrls, p.gitOriginUrl);
            }

            // If we already have the NEW project locally, hide its old counterpart even if the
            // old entry comes only from the remote list (cloud-only)
            // NEW projects have isOldProject: false and reference oldProjectUrl
            if (
                p.syncStatus !== "cloudOnlyNotSynced" &&
                p.projectSwap &&
                !p.projectSwap.isOldProject &&
                p.projectSwap.oldProjectUrl
            ) {
                addUrlVariants(hiddenOldProjectUrls, p.projectSwap.oldProjectUrl);
            }
        });

        const filtered = projects.filter((project) => {
            // Hide the "new" project for a pending swap when the old one is still local
            if (project.gitOriginUrl) {
                if (urlMatchesAny(project.gitOriginUrl, hiddenNewProjectUrls)) {
                    return false;
                }
            }

            // Hide cloud-only old project entries when their replacement is already local
            if (project.gitOriginUrl) {
                if (urlMatchesAny(project.gitOriginUrl, hiddenOldProjectUrls)) {
                    return false;
                }
            }

            // Hide the old project once the new one is locally available (swap cancelled or completed)
            // Only hide if swap is no longer active (user already swapped or swap was cancelled)
            if (
                project.projectSwap?.isOldProject &&
                project.projectSwap.swapStatus !== "active" &&
                project.projectSwap.newProjectUrl
            ) {
                if (urlMatchesAny(project.projectSwap.newProjectUrl, localProjectUrls)) {
                    return false;
                }
            }

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
                if (!["downloadedAndSynced", "localOnlyNotSynced", "orphaned"].includes(project.syncStatus)) {
                    return false;
                }
            } else if (currentFilter === "remote") {
                if (project.syncStatus !== "cloudOnlyNotSynced") {
                    return false;
                }
            } else if (currentFilter === "synced") {
                if (!["downloadedAndSynced", "orphaned"].includes(project.syncStatus)) {
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
                                                isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
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
                                                isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
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
                                                isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
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
                                                isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                                isOnline={!!isOnline}
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
                                isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                isOnline={!!isOnline}
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
                                            isProgressDataLoaded={!!progressData}
                                                isAnyOperationApplying={isLocked}
                                            isOnline={!!isOnline}
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
