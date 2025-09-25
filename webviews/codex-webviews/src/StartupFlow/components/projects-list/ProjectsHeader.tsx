import React from "react";
import { ProjectWithSyncStatus } from "types";
import { Button } from "../../../components/ui/button";
import { Input } from "../../../components/ui/input";
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "../../../components/ui/select";

// Filter options for projects
type ProjectFilter = "all" | "local" | "remote" | "synced" | "non-synced";

interface ProjectsHeaderProps {
    searchQuery: string;
    setSearchQuery: React.Dispatch<React.SetStateAction<string>>;
    filter: ProjectFilter;
    setFilter: React.Dispatch<React.SetStateAction<ProjectFilter>>;
    projects: ProjectWithSyncStatus[];
    vscode: any;
}

export const ProjectsHeader: React.FC<ProjectsHeaderProps> = ({
    searchQuery,
    setSearchQuery,
    filter,
    setFilter,
    projects,
    vscode,
}) => {
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
        <div className="sticky top-0 z-10 bg-background p-3 shadow-sm">
            <div className="flex gap-2 items-center">
                <div className="relative flex-1">
                    <i className="codicon codicon-search absolute left-2 top-1/2 transform -translate-y-1/2 text-muted-foreground text-sm" />
                    <Input
                        placeholder="Search projects..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="pl-8 h-9 text-sm"
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

                <Select value={filter} onValueChange={(value) => setFilter(value as ProjectFilter)}>
                    <SelectTrigger className="w-40 text-sm border border-gray-200">
                        <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                        <SelectItem value="all">All Projects ({getFilterCount("all")})</SelectItem>
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
            </div>
        </div>
    );
};
