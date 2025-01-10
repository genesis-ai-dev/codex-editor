import React, { useEffect, useState } from "react";
import { VSCodeButton, VSCodeTextField } from "@vscode/webview-ui-toolkit/react";
import { GitLabInfo } from "../types";
import {
    GitLabProject,
    ProjectWithSyncStatus,
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
} from "../../../../../types";
import { GitLabProjectsList } from "./GitLabProjectsList";
import { StartupFlowEvents, startupFlowMachine } from "../machines/startupFlowMachine";
import { useMachine } from "@xstate/react";
import { WebviewApi } from "vscode-webview";
import { EventFrom } from "xstate";
import { StateFrom } from "xstate";

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
    // const [state, send, service] = useMachine(startupFlowMachine);

    const fetchProjectList = () => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);
    };

    useEffect(() => {
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            console.log({ message }, "message in ProjectSetupStep");
            if (message.command === "projectsListFromGitLab") {
                console.log(message.projects, "message in ProjectSetupStep");
                setProjectsList(message.projects);
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
            <h2>Project Setup</h2>
            {gitlabInfo && (
                <div className="gitlab-info">
                    <p>Logged in as {gitlabInfo.username}</p>
                </div>
            )}
            <div style={{ display: "flex", justifyContent: "flex-end" }}>
                <VSCodeButton appearance="icon" onClick={fetchProjectList} title="Refresh">
                    <i className="codicon codicon-refresh"></i>
                </VSCodeButton>
            </div>

            <GitLabProjectsList
                onOpenProject={onOpenProject}
                projects={projectsList}
                onCloneProject={(project) =>
                    project.gitOriginUrl && onCloneRepo(project.gitOriginUrl)
                }
                syncStatus={syncStatus}
            />
            <div className="setup-options">
                <div className="option">
                    <h3>Create Empty Project</h3>
                    <p>Start with a blank project and add files as needed.</p>
                    <VSCodeButton onClick={onCreateEmpty}>Create Empty Project</VSCodeButton>
                </div>
            </div>
        </div>
    );
};
