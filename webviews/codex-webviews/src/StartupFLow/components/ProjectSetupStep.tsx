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
    // state: StateFrom<typeof startupFlowMachine>;
    // send: (event: EventFrom<typeof startupFlowMachine>) => void;
}

export const ProjectSetupStep: React.FC<ProjectSetupStepProps> = ({
    onCreateEmpty,
    onCloneRepo,
    onOpenProject,
    gitlabInfo,
    vscode,
    // state,
    // send,
}) => {
    const [projectsList, setProjectsList] = useState<ProjectWithSyncStatus[]>([]);
    const [syncStatus, setSyncStatus] = useState<Record<string, "synced" | "cloud" | "error">>({});
    const [isLoading, setIsLoading] = useState(true);
    // const [state, send, service] = useMachine(startupFlowMachine);

    const fetchProjectList = () => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);
        setIsLoading(true);
    };

    const handleDeleteProject = (project: ProjectWithSyncStatus) => {
        if (!project.path) return;
        
        // Show confirmation dialog via VSCode
        vscode.postMessage({
            command: "project.delete",
            projectPath: project.path,
            syncStatus: project.syncStatus
        } as MessagesToStartupFlowProvider);
        
        // Set loading state
        setIsLoading(true);
    };

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            console.log({ message }, "message in ProjectSetupStep");
            
            if (message.command === "projectsListFromGitLab") {
                console.log(message.projects, "projects list updated");
                setProjectsList(message.projects);
                setIsLoading(false);
            } else if (message.command === "project.deleteResponse") {
                console.log(`Project deletion response:`, message);
                
                if (message.success) {
                    console.log(`Project at ${message.projectPath} successfully deleted`);
                    
                    // Explicitly request a fresh project list
                    vscode.postMessage({
                        command: "getProjectsListFromGitLab",
                    } as MessagesToStartupFlowProvider);
                } else {
                    // Handle different error cases
                    if (message.error === "Deletion cancelled by user") {
                        console.log("Project deletion was cancelled by user");
                    } else {
                        console.error(`Failed to delete project: ${message.error}`);
                    }
                    
                    // Always stop loading on any error or cancellation
                    setIsLoading(false);
                }
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsSyncStatus",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            if (message.command === "projectsSyncStatus") {
                setSyncStatus(message.status);
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);
    return (
        <div className="project-setup-step">
            {/* {state.context.authState.isAuthExtensionInstalled && (
                <div>
                    <VSCodeButton
                        appearance="icon"
                        onClick={() => send({ type: StartupFlowEvents.BACK_TO_LOGIN })}
                        title="Back to login"
                    >
                        <i className="codicon codicon-arrow-left"></i>
                    </VSCodeButton>
                </div>
            )} */}
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
                        title="Refresh"
                        className="refresh-button"
                    >
                        <i className="codicon codicon-refresh"></i>
                    </VSCodeButton>

                    <VSCodeButton
                        appearance="primary"
                        onClick={onCreateEmpty}
                        title="Create New Project from Scratch"
                        className="create-button"
                    >
                        <i className="codicon codicon-plus"></i>
                        Create Empty Project
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
                onOpenProject={onOpenProject}
                projects={projectsList}
                onDeleteProject={handleDeleteProject}
                onCloneProject={(project) =>
                    project.gitOriginUrl && onCloneRepo(project.gitOriginUrl)
                }
            />
        </div>
    );
};
