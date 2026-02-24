import React, { useEffect, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { GitLabInfo } from "../types";
import {
    ProjectWithSyncStatus,
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
} from "types";
import { GitLabProjectsList } from "./GitLabProjectsList";
import { WebviewApi } from "vscode-webview";

export interface ProjectSetupStepProps {
    onCreateEmpty: () => void;
    onCloneRepo: (repoUrl: string) => void;
    gitlabInfo?: GitLabInfo;
    vscode: WebviewApi<any>;
    onOpenProject: (project: ProjectWithSyncStatus) => void;
    isAuthenticated: boolean;
    // state: StateFrom<typeof startupFlowMachine>;
    // send: (event: EventFrom<typeof startupFlowMachine>) => void;
}

export const ProjectSetupStep: React.FC<ProjectSetupStepProps> = ({
    onCreateEmpty,
    onCloneRepo,
    onOpenProject,
    gitlabInfo,
    vscode,
    isAuthenticated,
    // state,
    // send,
}) => {
    const [projectsList, setProjectsList] = useState<ProjectWithSyncStatus[]>([]);
    const [syncStatus, setSyncStatus] = useState<Record<string, "synced" | "cloud" | "error">>({});
    const [isLoading, setIsLoading] = useState(true);
    const [isAnyApplying, setIsAnyApplying] = useState(false);
    const [disableAllActions, setDisableAllActions] = useState(false);
    const [isOffline, setIsOffline] = useState(!navigator.onLine);
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [swapCloneWarning, setSwapCloneWarning] = useState<{
        message: string;
        repoUrl?: string;
        newProjectName?: string;
    } | null>(null);
    const [isCloningDeprecated, setIsCloningDeprecated] = useState(false);
    const [currentUsername, setCurrentUsername] = useState<string | undefined>(undefined);

    useEffect(() => {
        let wasOffline = !navigator.onLine;

        const handleOnlineStatusChange = () => {
            const nowOnline = navigator.onLine;
            setIsOffline(!nowOnline);

            // When transitioning from offline to online, show a refreshing indicator.
            // The provider auto-refreshes the project list on connectivity restoration
            // (via network.connectivityRestored → sendList), so the response will
            // clear this state when it arrives.
            if (wasOffline && nowOnline) {
                setIsRefreshing(true);
            }

            wasOffline = !nowOnline;
        };

        window.addEventListener("online", handleOnlineStatusChange);
        window.addEventListener("offline", handleOnlineStatusChange);

        return () => {
            window.removeEventListener("online", handleOnlineStatusChange);
            window.removeEventListener("offline", handleOnlineStatusChange);
        };
    }, []);

    const fetchProjectList = () => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);
        setIsLoading(true);
    };

    const fetchSyncStatus = () => {
        vscode.postMessage({
            command: "getProjectsSyncStatus",
        } as MessagesToStartupFlowProvider);
    };

    const handleDeleteProject = (project: ProjectWithSyncStatus) => {
        if (!project.path) return;

        vscode.postMessage({
            command: "project.delete",
            projectPath: project.path,
            syncStatus: project.syncStatus,
        } as MessagesToStartupFlowProvider);

        // Don't set loading state here - wait for confirmation
        // setIsLoading(true); will be called in message handler if deletion is confirmed
    };

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        // const progressTimer = setTimeout(() => {
        //     fetchProgressData();
        // }, 500);

        const syncTimer = setTimeout(() => {
            fetchSyncStatus();
        }, 1000);

        return () => {
            // clearTimeout(progressTimer);
            clearTimeout(syncTimer);
        };
    }, []);

    useEffect(() => {
        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            if (message.command === "projectsListFromGitLab") {
                setProjectsList(message.projects);
                setCurrentUsername((message as any).currentUsername);
                setIsLoading(false);
                setIsRefreshing(false);
            } else if (message.command === "project.deleteResponse") {
                if (message.success) {
                    // Set loading state only after deletion is confirmed
                    setIsLoading(true);
                    vscode.postMessage({
                        command: "getProjectsListFromGitLab",
                    } as MessagesToStartupFlowProvider);
                } else {
                    if (message.error !== "Deletion cancelled by user") {
                        console.error(`Failed to delete project: ${message.error}`);
                    }
                    // No need to set loading false since we never set it true for cancelled deletions
                }
            } else if (message.command === "projectsSyncStatus") {
                setSyncStatus(message.status);
            } else if ((message as any).command === "project.mediaStrategyApplying") {
                setIsAnyApplying(!!(message as any).applying);
            } else if ((message as any).command === "project.updatingInProgress") {
                setIsAnyApplying(!!(message as any).updating);
            } else if ((message as any).command === "project.cloningInProgress") {
                setIsAnyApplying(!!(message as any).cloning);
            } else if ((message as any).command === "project.openingInProgress") {
                setIsAnyApplying(!!(message as any).opening);
            } else if ((message as any).command === "project.zippingInProgress") {
                setIsAnyApplying(!!(message as any).zipping);
            } else if ((message as any).command === "project.cleaningInProgress") {
                setIsAnyApplying(!!(message as any).cleaning);
            } else if ((message as any).command === "project.swapCloneWarning") {
                const warning = message as any;
                if (warning?.isOldProject) {
                    setSwapCloneWarning({
                        message: warning.message || "This project has been deprecated. Please use the newer project.",
                        repoUrl: warning.repoUrl,
                        newProjectName: warning.newProjectName,
                    });
                    setDisableAllActions(true);
                } else {
                    setSwapCloneWarning(null);
                    setDisableAllActions(false);
                    setIsCloningDeprecated(false);
                }
            } else if ((message as any).command === "project.setMediaStrategyResult") {
                // Update the project's media strategy in the projects list when it changes
                const result = message as any;
                if (result.success && result.projectPath && result.mediaStrategy) {
                    setProjectsList(prevProjects => 
                        prevProjects.map(p => 
                            p.path === result.projectPath 
                                ? { ...p, mediaStrategy: result.mediaStrategy }
                                : p
                        )
                    );
                }
            }
        };

        window.addEventListener("message", messageHandler);
        return () => window.removeEventListener("message", messageHandler);
    }, []);

    return (
        <div className="project-setup-step">
            {(isOffline || !isAuthenticated) && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "1rem",
                        padding: "8px 12px",
                        backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                        border: "1px solid var(--vscode-inputValidation-warningBorder)",
                        borderRadius: "4px",
                        width: "100%",
                        boxSizing: "border-box",
                    }}
                >
                    <i className="codicon codicon-warning"></i>
                    <span>
                        {isOffline && !isAuthenticated ? (
                            <div className="flex flex-col">
                                <span>You are offline and logged out. Only local projects are available.</span>
                                <span>Translating using AI requires an account and an internet connection.</span>
                            </div>
                        ) : isOffline ? (
                            <div className="flex flex-col">
                                <span>You appear to be offline.</span>
                                <span>Some features may be unavailable.</span>
                            </div>
                        ) : (
                            <div className="flex flex-col">
                                <span>You are currently logged out. Only local projects will be available.</span>
                                <span>Translating using AI will not work.</span>
                            </div>
                        )}
                    </span>
                </div>
            )}
            {swapCloneWarning && (
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "8px",
                        marginBottom: "1rem",
                        padding: "8px 12px",
                        backgroundColor: "var(--vscode-inputValidation-warningBackground)",
                        border: "1px solid var(--vscode-inputValidation-warningBorder)",
                        borderRadius: "4px",
                        width: "100%",
                        boxSizing: "border-box",
                    }}
                >
                    <i className="codicon codicon-warning"></i>
                    <span style={{ flex: 1 }}>
                        <div className="flex flex-col">
                            <span>{swapCloneWarning.message}</span>
                            {swapCloneWarning.newProjectName && (
                                <span>Recommended project: {swapCloneWarning.newProjectName}</span>
                            )}
                        </div>
                    </span>
                    <div style={{ display: "flex", gap: "8px" }}>
                        {!isCloningDeprecated && (
                            <VSCodeButton
                                appearance="secondary"
                                onClick={() => {
                                    setSwapCloneWarning(null);
                                    setDisableAllActions(false);
                                }}
                            >
                                Cancel
                            </VSCodeButton>
                        )}
                        {swapCloneWarning.repoUrl && (
                            <VSCodeButton
                                appearance="primary"
                                disabled={isCloningDeprecated}
                                onClick={() => {
                                    setIsCloningDeprecated(true);
                                    vscode.postMessage({
                                        command: "project.cloneDeprecated",
                                        repoUrl: swapCloneWarning.repoUrl,
                                    } as MessagesToStartupFlowProvider);
                                }}
                            >
                                {isCloningDeprecated ? "Cloning..." : "Clone Deprecated Project"}
                            </VSCodeButton>
                        )}
                    </div>
                </div>
            )}
            {!isAuthenticated && (
                <div>
                    <VSCodeButton
                        appearance="secondary"
                        onClick={() =>
                            vscode.postMessage({
                                command: "auth.backToLogin",
                            } as MessagesToStartupFlowProvider)
                        }
                    >
                        <i className="codicon codicon-arrow-left" style={{ marginRight: "4px" }}></i>
                        Back to Login
                    </VSCodeButton>
                </div>
            )}
            <div
                style={{
                    display: "flex",
                    flexDirection: "row",
                    gap: "2rem",
                    justifyContent: "space-between",
                    width: "100%",
                }}
            >
                <div className="title-section" style={{ alignSelf: "start" }}>
                    <h2>Project Setup</h2>
                </div>
                <div
                    className="actions-section"
                    style={{
                        display: "flex",
                        flex: 1,
                        alignSelf: "end",
                        gap: "1rem",
                        justifyContent: "flex-end",
                    }}
                >
                    {gitlabInfo && (
                        <div className="gitlab-info">
                            <p>Logged in as {gitlabInfo.username}</p>
                        </div>
                    )}
                    <VSCodeButton
                        appearance="secondary"
                        onClick={fetchProjectList}
                        title="Refresh Projects List"
                        disabled={disableAllActions || isRefreshing}
                        className={`refresh-button ${isAnyApplying || disableAllActions || isRefreshing ? "opacity-50 pointer-events-none cursor-default" : ""}`}
                    >
                        <i className={`codicon ${isRefreshing ? "codicon-loading codicon-modifier-spin" : "codicon-refresh"}`}></i>
                        {isRefreshing ? "Refreshing..." : "Refresh"}
                    </VSCodeButton>

                    <VSCodeButton
                        appearance="primary"
                        onClick={onCreateEmpty}
                        title="Create New Project from Scratch"
                        disabled={disableAllActions || isRefreshing}
                        className={`create-button ${isAnyApplying || disableAllActions || isRefreshing ? "opacity-50 pointer-events-none cursor-default" : ""}`}
                    >
                        <i className="codicon codicon-plus"></i>
                        Create New Project
                    </VSCodeButton>
                </div>

                {/* <div className="setup-options">
                    <div className="option">
                        <h3>Create Empty Project</h3>
                        <p>Start with a blank project and add files as needed.</p>
                        <VSCodeButton onClick={onCreateEmpty}>Create Empty Project</VSCodeButton>
                    </div>
                </div> */}
            </div>

            <GitLabProjectsList
                isLoading={isLoading}
                isRefreshing={isRefreshing}
                onOpenProject={onOpenProject}
                projects={projectsList}
                onDeleteProject={handleDeleteProject}
                onCloneProject={(project) => {
                    if (project.gitOriginUrl) {
                        vscode.postMessage({
                            command: "project.clone",
                            repoUrl: project.gitOriginUrl,
                            mediaStrategy: project.mediaStrategy,
                        } as MessagesToStartupFlowProvider);
                    }
                }}
                vscode={vscode}
                disableAllActions={disableAllActions || isRefreshing}
                currentUsername={currentUsername}
            />
        </div>
    );
};
