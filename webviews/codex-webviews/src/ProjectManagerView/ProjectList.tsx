import {
    VSCodeButton,
    VSCodeDataGrid,
    VSCodeDataGridCell,
    VSCodeDataGridRow,
    VSCodeDivider,
} from "@vscode/webview-ui-toolkit/react";
import { formatDistanceToNow } from "date-fns";

interface ProjectListItem {
    name: string;
    path: string;
    lastOpened?: Date;
    lastModified: Date;
    version: string;
    hasVersionMismatch?: boolean;
    isOutdated?: boolean;
}

interface ProjectListProps {
    projects: Array<ProjectListItem>;
    watchedFolders: string[];
    onCreateNew: () => void;
    onOpenProject: (path: string) => void;
    onBackToOverview?: () => void;
    onAddWatchFolder: () => void;
    onRemoveWatchFolder: (path: string) => void;
    onRefreshProjects: () => void;
    showBackButton: boolean;
}

export function ProjectList({
    projects,
    watchedFolders,
    onCreateNew,
    onOpenProject,
    onBackToOverview,
    onAddWatchFolder,
    onRemoveWatchFolder,
    onRefreshProjects,
    showBackButton
}: ProjectListProps) {
    // Sort projects by last opened date, with most recent first
    const sortedProjects = [...projects].sort((a, b) => {
        if (!a.lastOpened && !b.lastOpened) return 0;
        if (!a.lastOpened) return 1;
        if (!b.lastOpened) return -1;
        return b.lastOpened.getTime() - a.lastOpened.getTime();
    });

    const getVersionDisplay = (
        version: string,
        hasVersionMismatch: boolean,
        isOutdated: boolean
    ) => {
        if (hasVersionMismatch || isOutdated) {
            return (
                <span
                    style={{
                        color: "var(--vscode-errorForeground)",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                    }}
                >
                    <i className="codicon codicon-warning"></i>
                    {version}
                    {hasVersionMismatch && " (version mismatch)"}
                    {isOutdated && " (outdated)"}
                </span>
            );
        }
        return <span>{version}</span>;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem", padding: "1rem" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <h2>Codex Projects</h2>
                {showBackButton && onBackToOverview && (
                    <VSCodeButton onClick={onBackToOverview}>
                        <i className="codicon codicon-arrow-left"></i> Back to Overview
                    </VSCodeButton>
                )}
            </div>

            <div style={{ display: "flex", gap: "0.5rem" }}>
                <VSCodeButton onClick={onCreateNew}>
                    <i className="codicon codicon-new-folder"></i> Create New Project
                </VSCodeButton>
                <VSCodeButton onClick={onRefreshProjects}>
                    <i className="codicon codicon-refresh"></i> Refresh Projects
                </VSCodeButton>
            </div>

            <VSCodeDivider />

            <div>
                <h3>Watched Folders</h3>
                <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
                    <VSCodeButton onClick={onAddWatchFolder}>
                        <i className="codicon codicon-add"></i> Add Folder to Watch
                    </VSCodeButton>
                </div>

                <VSCodeDataGrid style={{ marginTop: "0.5rem" }}>
                    {watchedFolders.map((folder) => (
                        <VSCodeDataGridRow key={folder}>
                            <VSCodeDataGridCell grid-column="1">{folder}</VSCodeDataGridCell>
                            <VSCodeDataGridCell grid-column="2">
                                <VSCodeButton
                                    appearance="icon"
                                    onClick={() => onRemoveWatchFolder(folder)}
                                >
                                    <i className="codicon codicon-trash"></i>
                                </VSCodeButton>
                            </VSCodeDataGridCell>
                        </VSCodeDataGridRow>
                    ))}
                </VSCodeDataGrid>
            </div>

            <VSCodeDivider />

            <h3>Found Projects</h3>
            <VSCodeDataGrid>
                {sortedProjects.map((project) => (
                    <VSCodeDataGridRow key={project.path}>
                        <VSCodeDataGridCell grid-column="1">{project.name}</VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="2">{project.path}</VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="3">
                            {getVersionDisplay(
                                project.version,
                                project.hasVersionMismatch || false,
                                project.isOutdated || false
                            )}
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="4">
                            <span
                                style={{
                                    fontSize: "0.8em",
                                    color: "var(--vscode-descriptionForeground)",
                                }}
                            >
                                Modified{" "}
                                {formatDistanceToNow(project.lastModified, { addSuffix: true })}
                            </span>
                        </VSCodeDataGridCell>
                        <VSCodeDataGridCell grid-column="5">
                            <VSCodeButton onClick={() => onOpenProject(project.path)}>
                                <i className="codicon codicon-folder-opened"></i>
                            </VSCodeButton>
                        </VSCodeDataGridCell>
                    </VSCodeDataGridRow>
                ))}
            </VSCodeDataGrid>
        </div>
    );
}
