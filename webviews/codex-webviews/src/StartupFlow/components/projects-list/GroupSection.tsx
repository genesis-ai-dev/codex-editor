import React from "react";
import { ProjectWithSyncStatus, ProjectSyncStatus } from "types";
import { Card, CardContent, CardHeader } from "../../../components/ui/card";
import { Badge } from "../../../components/ui/badge";
import { cn } from "../../../lib/utils";
import { ProjectCard } from "./ProjectCard";

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

interface GroupSectionProps {
    group: ProjectGroup;
    depth?: number;
    filter: string;
    searchQuery: string;
    expandedGroups: Record<string, boolean>;
    setExpandedGroups: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    expandedProjects: Record<string, boolean>;
    setExpandedProjects: React.Dispatch<React.SetStateAction<Record<string, boolean>>>;
    newlyAddedProjects: Set<string>;
    statusChangedProjects: Set<string>;
    onCloneProject: (project: ProjectWithSyncStatus) => void;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    onDeleteProject?: (project: ProjectWithSyncStatus) => void;
    vscode: any;
    parseProjectUrl: (url?: string) => ParsedProjectInfo;
    getStatusIcon: (syncStatus: ProjectSyncStatus) => {
        icon: string;
        title: string;
        className: string;
    };
    filterProjects: (projects: ProjectWithSyncStatus[]) => ProjectWithSyncStatus[];
}

const INDENTATION_SIZE_REM = 1.25;

export const GroupSection: React.FC<GroupSectionProps> = ({
    group,
    depth = 0,
    filter,
    searchQuery,
    expandedGroups,
    setExpandedGroups,
    expandedProjects,
    setExpandedProjects,
    newlyAddedProjects,
    statusChangedProjects,
    onCloneProject,
    onOpenProject,
    onDeleteProject,
    vscode,
    parseProjectUrl,
    getStatusIcon,
    filterProjects,
}) => {
    if (!group || typeof group !== "object") return null;

    const filteredProjects = filterProjects(group.projects || []);

    // Recursively count all projects in this group and its subgroups
    const getTotalProjectCount = (group: ProjectGroup): number => {
        const directProjects = filterProjects(group.projects || []).length;
        const subgroupProjects = Object.values(group.subgroups || {}).reduce((total, subgroup) => {
            if (!subgroup) return total;
            return total + getTotalProjectCount(subgroup);
        }, 0);
        return directProjects + subgroupProjects;
    };

    const totalProjectCount = getTotalProjectCount(group);

    const hasSubgroupsWithProjects = Object.values(group.subgroups).some((subgroup) => {
        if (!subgroup) return false;
        const filteredSubgroupProjects = filterProjects(subgroup.projects || []);
        return filteredSubgroupProjects.length > 0;
    });

    if ((filter !== "all" || searchQuery) && totalProjectCount === 0) {
        return null;
    }

    const isExpanded = expandedGroups[group.name] ?? true;

    // Style functions for different depths
    const getBorderColor = (depth: number) => {
        if (depth === 0) return "border-l-primary";
        if (depth === 1) return "border-l-accent";
        return "border-l-muted";
    };

    const getFolderColor = (depth: number) => {
        if (depth === 0) return "text-primary";
        if (depth === 1) return "text-accent";
        return "text-muted";
    };

    const getBadgeStyle = (depth: number) => {
        if (depth === 0) return "bg-primary/10 text-primary border-primary";
        if (depth === 1) return "bg-accent/10 text-accent border-accent";
        return "bg-muted/10 text-muted border-muted";
    };

    return (
        <div key={group.name} className={cn("mb-2", depth > 0 && "ml-6")}>
            <Card
                className={cn(
                    "overflow-hidden border-l-4 shadow-sm",
                    getBorderColor(depth),
                    depth > 0 && "bg-muted/10"
                )}
            >
                <CardHeader
                    className={cn(
                        "cursor-pointer hover:bg-muted/30 transition-colors",
                        depth === 0 ? "py-2 px-3" : "py-1.5 px-3"
                    )}
                    onClick={() =>
                        setExpandedGroups((prev) => ({
                            ...prev,
                            [group.name]: !(prev[group.name] ?? true),
                        }))
                    }
                >
                    <div className="flex items-center gap-2">
                        <i
                            className={cn(
                                "codicon transition-transform text-sm text-muted-foreground",
                                isExpanded ? "codicon-chevron-down" : "codicon-chevron-right"
                            )}
                        />
                        <i
                            className={cn("codicon codicon-folder text-sm", getFolderColor(depth))}
                        />
                        <h3
                            className={cn(
                                "text-sm text-foreground",
                                depth === 0 ? "font-medium" : "font-normal"
                            )}
                        >
                            {(group.name || "").replace(/_/g, " ")}
                        </h3>
                        <Badge
                            variant="outline"
                            className={cn("ml-auto text-xs px-1.5 py-0.5", getBadgeStyle(depth))}
                        >
                            {totalProjectCount}
                        </Badge>
                    </div>
                </CardHeader>
                {isExpanded && (
                    <CardContent className="p-0">
                        {filteredProjects.length > 0 && (
                            <div className="border-t border-muted">
                                {filteredProjects.map((project) => (
                                    <ProjectCard
                                        key={project.name}
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
                                    />
                                ))}
                            </div>
                        )}
                        {Object.entries(group.subgroups || {}).map(([subgroupName, subgroup]) =>
                            subgroup ? (
                                <div key={subgroupName} className="mt-2 px-3 pb-2">
                                    <GroupSection
                                        group={subgroup}
                                        depth={depth + 1}
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
                                    />
                                </div>
                            ) : null
                        )}
                    </CardContent>
                )}
            </Card>
        </div>
    );
};
