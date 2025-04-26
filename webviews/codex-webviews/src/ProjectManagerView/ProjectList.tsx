/** Ryder: I think this file is deprecated now. */

import { VSCodeButton, VSCodeDivider } from "@vscode/webview-ui-toolkit/react";
import { formatDistanceToNow } from "date-fns";
import { useState, useEffect } from "react";

interface ProjectListItem {
    name: string;
    path: string;
    lastOpened?: string | Date;
    lastModified: string | Date;
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
    const [isOffline, setIsOffline] = useState(!navigator.onLine);

    useEffect(() => {
        const handleOnlineStatusChange = () => {
            setIsOffline(!navigator.onLine);
        };

        window.addEventListener("online", handleOnlineStatusChange);
        window.addEventListener("offline", handleOnlineStatusChange);

        return () => {
            window.removeEventListener("online", handleOnlineStatusChange);
            window.removeEventListener("offline", handleOnlineStatusChange);
        };
    }, []);

    const sortedProjects = projects
        ? [...projects].sort((a, b) => {
              const dateA = a?.lastOpened ? new Date(a.lastOpened) : null;
              const dateB = b?.lastOpened ? new Date(b.lastOpened) : null;

              if (!dateA && !dateB) return 0;
              if (!dateA) return 1;
              if (!dateB) return -1;
              return dateB.getTime() - dateA.getTime();
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
        <div
            style={{
                display: "flex",
                flexDirection: "column",
                gap: "1rem",
                padding: "1rem",
                minWidth: 0,
                position: "relative",
            }}
        >
            {isOffline && (
                <div
                    style={{
                        position: "absolute",
                        top: "10px",
                        right: "10px",
                        display: "flex",
                        alignItems: "center",
                        gap: "4px",
                        backgroundColor: "var(--vscode-badge-background)",
                        color: "var(--vscode-badge-foreground)",
                        padding: "4px 8px",
                        borderRadius: "4px",
                        fontSize: "12px",
                        zIndex: 10,
                    }}
                >
                    <i className="codicon codicon-error"></i>
                    <span>Offline</span>
                </div>
            )}

            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "1rem",
                    flexWrap: "wrap",
                }}
            >
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
                                minWidth: 0,
                            }}
                        >
                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    flexWrap: "wrap",
                                    minWidth: 0,
                                }}
                            >
                                <span
                                    style={{
                                        fontSize: "1.1em",
                                        fontWeight: "bold",
                                        overflow: "hidden",
                                        textOverflow: "ellipsis",
                                        whiteSpace: "nowrap",
                                        minWidth: 0,
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
                                    minWidth: 0,
                                }}
                            >
                                {project.path}
                            </div>

                            <div
                                style={{
                                    display: "flex",
                                    justifyContent: "space-between",
                                    alignItems: "center",
                                    gap: "0.5rem",
                                    fontSize: "0.9em",
                                    flexWrap: "wrap",
                                    minWidth: 0,
                                }}
                            >
                                <div style={{ minWidth: 0 }}>
                                    {getVersionDisplay(
                                        project.version,
                                        project.hasVersionMismatch || false,
                                        project.isOutdated || false
                                    )}
                                </div>
                                <div
                                    style={{
                                        color: "var(--vscode-descriptionForeground)",
                                        flexShrink: 0,
                                    }}
                                >
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
