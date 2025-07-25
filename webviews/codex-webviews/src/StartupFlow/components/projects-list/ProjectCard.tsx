import React from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import { Button } from "../../../components/ui/button";
import { Badge } from "../../../components/ui/badge";
import { Skeleton } from "../../../components/ui/skeleton";
import { cn } from "../../../lib/utils";

interface ParsedProjectInfo {
    groups: string[];
    cleanName: string;
    displayUrl: string;
    uniqueId: string;
}

interface ProjectCardProps {
    project: ProjectWithSyncStatus;
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    vscode: any;
    expandedProjects: Record<string, boolean>;
    setExpandedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    newlyAddedProjects: Set<string>;
    statusChangedProjects: Set<string>;
    parseProjectUrl: (url?: string) => ParsedProjectInfo;
    getStatusIcon: (syncStatus: ProjectSyncStatus) => {
        icon: string;
        title: string;
        className: string;
    };
    isProgressDataLoaded?: boolean;
}

export const ProjectCard: React.FC<ProjectCardProps> = ({
    project,
    onCloneProject,
    onOpenProject,
    onDeleteProject,
    vscode,
    expandedProjects,
    setExpandedProjects,
    newlyAddedProjects,
    statusChangedProjects,
    parseProjectUrl,
    getStatusIcon,
    isProgressDataLoaded = false,
}) => {
    const renderProjectActions = (project: ProjectWithSyncStatus) => {
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);
        const isRemote = project.syncStatus === "cloudOnlyNotSynced";

        if (isLocal) {
            return (
                <div className="flex gap-1">
                    <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => onOpenProject(project)}
                        className="h-6 text-xs px-2"
                    >
                        <i className="codicon codicon-folder-opened mr-1" />
                        Open
                    </Button>
                </div>
            );
        }

        if (isRemote) {
            return (
                <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => onCloneProject(project)}
                    className="h-6 text-xs px-2"
                >
                    <i className="codicon codicon-arrow-circle-down mr-1" />
                    Clone
                </Button>
            );
        }

        return null;
    };

    const renderProjectCard = () => {
        if (!project) return null;
        const { cleanName, displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isUnpublished = !project.gitOriginUrl;
        const status = getStatusIcon(project.syncStatus);
        const isExpanded = expandedProjects[project.name];
        const isNewlyAdded = newlyAddedProjects.has(project.name);
        const isStatusChanged = statusChangedProjects.has(project.name);

        return (
            <div
                key={`${project.name}-${project.gitOriginUrl || "no-url"}`}
                className={cn(
                    "flex items-center justify-between py-2 px-3 hover:bg-muted/30 transition-colors duration-200 border-b last:border-b-0",
                    isNewlyAdded && "bg-blue-50/50",
                    isStatusChanged && "bg-green-50/50"
                )}
            >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                    <div className="relative flex-shrink-0">
                        <i
                            className={cn(
                                "codicon text-sm",
                                status.icon,
                                status.className,
                                "transition-all duration-300"
                            )}
                            title={status.title}
                        />
                    </div>
                    <div className="flex items-center gap-2 flex-1 min-w-0">
                        <span className="font-normal truncate transition-colors duration-200 text-sm">
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
                    {project.completionPercentage !== undefined ? (
                        <div className="flex items-center gap-1">
                            <span className="text-xs font-medium text-muted-foreground">
                                {project.completionPercentage.toFixed(0)}%
                            </span>
                            <div className="w-12 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                                <div
                                    className="h-full bg-green-500 transition-all duration-500 ease-out"
                                    style={{
                                        width: `${Math.min(project.completionPercentage, 100)}%`,
                                    }}
                                />
                            </div>
                        </div>
                    ) : !isProgressDataLoaded ? (
                        <div className="flex items-center gap-1">
                            <Skeleton className="h-3 w-5" />
                            <Skeleton className="h-1.5 w-12" />
                        </div>
                    ) : null}
                    {renderProjectActions(project)}
                    {(displayUrl || onDeleteProject) && (
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
        );
    };

    const renderProjectDetails = () => {
        if (!project) return null;
        const { displayUrl, uniqueId } = parseProjectUrl(project.gitOriginUrl);
        const isExpanded = expandedProjects[project.name];
        const isLocal = ["downloadedAndSynced", "localOnlyNotSynced"].includes(project.syncStatus);

        if (!isExpanded || (!displayUrl && !onDeleteProject)) return null;

        return (
            <div className="bg-muted/30 border-t">
                <div className="p-3 space-y-2">
                    {displayUrl && (
                        <>
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
                        </>
                    )}
                    {isLocal && (
                        <div className="flex items-center justify-between gap-2">
                            <span className="text-xs">{project.name}</span>
                            <div className="flex gap-2">
                                <Button
                                    variant="outline"
                                    size="sm"
                                    onClick={() => {
                                        vscode.postMessage({
                                            command: "zipProject",
                                            projectName: project.name,
                                            projectPath: project.path,
                                            includeGit: true,
                                        });
                                    }}
                                    className="h-6 text-xs"
                                >
                                    <i className="codicon codicon-package mr-1" />
                                    ZIP (with git)
                                </Button>
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
                                    <i className="codicon codicon-file-zip mr-1" />
                                    Mini ZIP
                                </Button>
                                {onDeleteProject && (
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        onClick={() => onDeleteProject(project)}
                                        className="h-6 text-xs text-red-500 hover:text-red-600"
                                    >
                                        <i className="codicon codicon-trash mr-1" />
                                        Delete
                                    </Button>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>
        );
    };

    return (
        <div key={`${project.name}-${project.gitOriginUrl || "no-url"}`}>
            {renderProjectCard()}
            {renderProjectDetails()}
        </div>
    );
};
