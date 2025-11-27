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
}) => {
    const [isAnyApplying, setIsAnyApplying] = useState(false);
    useEffect(() => {
        const onMessage = (event: MessageEvent) => {
            const msg = event.data as any;
            if (msg?.command === "project.mediaStrategyApplying") {
                setIsAnyApplying(!!msg.applying);
            }
            if (msg?.command === "project.healingInProgress") {
                setIsAnyApplying(!!msg.healing);
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

    const { hierarchy, ungrouped: ungroupedProjects } = React.useMemo(() => {
        const groupProjectsByHierarchy = (projects: ProjectWithSyncStatus[]) => {
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

            return { hierarchy, ungrouped };
        };

        return groupProjectsByHierarchy(projectsWithProgress || []);
    }, [projectsWithProgress]);

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

    // No list-level memoization; we pass shallow copies at usage sites where needed

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
                disabled={isAnyApplying}
            />

            {isLoading ? (
                <div className="p-3 space-y-3 flex-1 overflow-y-auto">
                    {Array.from({ length: 5 }).map((_, i) => (
                        <ProjectCardSkeleton key={i} />
                    ))}
                </div>
            ) : (
                <div className="flex-1 overflow-y-auto overflow-x-hidden p-3 space-y-2">
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
                                isAnyOperationApplying={isAnyApplying}
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
                                            isAnyOperationApplying={isAnyApplying}
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
