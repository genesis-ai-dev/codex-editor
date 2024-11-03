import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
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
    projects: Array<ProjectListItem> | null;
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
    showBackButton,
}: ProjectListProps) {
    const sortedProjects = projects
        ? [...projects].sort((a, b) => {
              if (!a?.lastOpened && !b?.lastOpened) return 0;
              if (!a?.lastOpened) return 1;
              if (!b?.lastOpened) return -1;
              return b.lastOpened.getTime() - a.lastOpened.getTime();
          })
        : [];

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

            <div style={{ display: "flex", gap: "0.5rem", flexWrap: "wrap" }}>
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

                <div
                    style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: "0.5rem",
                        marginTop: "1rem",
                    }}
                >
                    {watchedFolders.map((folder) => (
                        <div
                            key={folder}
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                padding: "0.5rem",
                                backgroundColor: "var(--vscode-list-hoverBackground)",
                                borderRadius: "4px",
                            }}
                        >
                            <span style={{ wordBreak: "break-all" }}>{folder}</span>
                            <VSCodeButton
                                appearance="icon"
                                onClick={() => onRemoveWatchFolder(folder)}
                            >
                                <i className="codicon codicon-trash"></i>
                            </VSCodeButton>
                        </div>
                    ))}
                </div>
            </div>

            <VSCodeDivider />

            <h3>Found Projects</h3>
            <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
                {sortedProjects.length > 0 ? (
                    sortedProjects.map((project) => (
                        <div
                            key={project.path}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                gap: "0.5rem",
                                padding: "0.75rem",
                                backgroundColor: "var(--vscode-list-hoverBackground)",
                                borderRadius: "4px",
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: "1rem",
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: "1.1em",
                                        fontWeight: "bold",
                                    }}
                                >
                                    {project.name}
                                </span>
                                <VSCodeButton onClick={() => onOpenProject(project.path)}>
                                    <i className="codicon codicon-folder-opened"></i> Open
                                </VSCodeButton>
                            </div>

                            <div
                                style={{
                                    fontSize: "0.9em",
                                    color: "var(--vscode-descriptionForeground)",
                                    wordBreak: "break-all",
                                }}
                            >
                                {project.path}
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: "1rem",
                                    fontSize: "0.9em",
                                }}
                            >
                                <div>
                                    {getVersionDisplay(
                                        project.version,
                                        project.hasVersionMismatch || false,
                                        project.isOutdated || false
                                    )}
                                </div>
                                <div style={{ color: "var(--vscode-descriptionForeground)" }}>
                                    Modified{" "}
                                    {formatDistanceToNow(project.lastModified, { addSuffix: true })}
                                </div>
                            </div>
                        </div>
                    ))
                ) : (
                    <div
                        style={{
                            padding: "1rem",
                            textAlign: "center",
                            color: "var(--vscode-descriptionForeground)",
                        }}
                    >
                        No projects found in watched folders
                    </div>
                )}
            </div>
        </div>
    );
}
