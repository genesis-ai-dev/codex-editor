import React from "react";
import { Button } from "../../../components/ui/button";

type ProjectFilter = "all" | "local" | "remote" | "synced" | "non-synced";

interface EmptyStateProps {
    filter: ProjectFilter;
    setFilter: React.Dispatch<React.SetStateAction<ProjectFilter>>;
}

export const EmptyState: React.FC<EmptyStateProps> = ({ filter, setFilter }) => {
    return (
        <div className="flex flex-col items-center justify-center gap-3 p-6 text-center">
            <i className="codicon codicon-info text-2xl text-muted-foreground" />
            <p className="text-sm text-muted-foreground">No projects match the current filters</p>
            {filter !== "all" && (
                <Button onClick={() => setFilter("all")} size="sm" className="text-xs">
                    Show All Projects
                </Button>
            )}
        </div>
    );
};
