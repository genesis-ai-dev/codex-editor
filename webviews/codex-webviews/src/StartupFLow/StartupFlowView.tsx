import React, { useEffect } from "react";
import { useMachine } from "@xstate/react";
import {
    StartupFlowEvents,
    startupFlowMachine,
    StartupFlowStates,
} from "./machines/startupFlowMachine";
import { LoginRegisterStep } from "./components/LoginRegisterStep";
import { WorkspaceStep } from "./components/WorkspaceStep";
import { ProjectSetupStep } from "./components/ProjectSetupStep";
import { VSCodeButton, VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import "./StartupFlowView.css";
import { AuthState } from "./types";
import { MessagesToStartupFlowProvider, ProjectWithSyncStatus } from "../../../../types";

const vscode = acquireVsCodeApi();

export const StartupFlowView: React.FC = () => {
    const [state, send, service] = useMachine(startupFlowMachine);

    useEffect(() => {
        // Notify the extension that the webview is ready
        vscode.postMessage({ command: "webview.ready" });

        // Request initial auth and workspace status
        vscode.postMessage({ command: "auth.status" });
        vscode.postMessage({ command: "workspace.status" });

        // Listen for messages from the extension
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateAuthState": {
                    console.log("updateAuthState", message);
                    const authState: AuthState = message.authState;
                    if (!authState.isAuthExtensionInstalled) {
                        send({
                            type: StartupFlowEvents.NO_AUTH_EXTENSION,
                            data: {
                                isAuthenticated: false,
                                isAuthExtensionInstalled: false,
                                isLoading: false,
                                error: undefined,
                                gitlabInfo: undefined,
                            },
                        });
                    } else if (authState.isAuthenticated) {
                        send({
                            type: StartupFlowEvents.AUTH_LOGGED_IN,
                            data: {
                                isAuthenticated: authState.isAuthenticated,
                                isAuthExtensionInstalled: true,
                                isLoading: false,
                                error: authState.error,
                                gitlabInfo: authState.gitlabInfo,
                            },
                        });
                    } else {
                        send({
                            type: StartupFlowEvents.UPDATE_AUTH_STATE,
                            data: {
                                isAuthenticated: false,
                                isAuthExtensionInstalled: true,
                                isLoading: false,
                                error: authState.error,
                                gitlabInfo: undefined,
                            },
                        });
                    }
                    break;
                }
                case "workspace.statusResponse":
                    if (message.isOpen) {
                        // send({ type: StartupFlowEvents.WORKSPACE_OPEN });
                        vscode.postMessage({
                            command: "metadata.check",
                        } as MessagesToStartupFlowProvider);
                    }
                    break;
                case "workspace.opened":
                    vscode.postMessage({
                        command: "metadata.check",
                    } as MessagesToStartupFlowProvider);
                    break;
                case "metadata.checkResponse":
                    if (message.exists) {
                        send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN });
                    } else {
                        send({ type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT });
                    }
                    break;
                case "setupComplete": {
                    console.log("setupComplete called");
                    send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN }); // fixme: this should be a generic. ex "projectSet", "workspaceOpen"
                }
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
            service.stop(); // Clean up the state machine
        };
    }, [send]);

    const handleLogin = (username: string, password: string) => {
        vscode.postMessage({
            command: "auth.login",
            username,
            password,
        });
    };

    const handleRegister = (username: string, email: string, password: string) => {
        vscode.postMessage({
            command: "auth.signup",
            username,
            email,
            password,
        });
    };

    const handleLogout = () => {
        vscode.postMessage({ command: "auth.logout" });
    };

    const handleSkipAuth = () => {
        send({ type: StartupFlowEvents.SKIP_AUTH });
    };

    // const handleOpenWorkspace = () => {
    //     vscode.postMessage({ command: "workspace.open" });
    // };

    // const handleCreateNew = () => {
    //     vscode.postMessage({ command: "workspace.create" });
    // };

    const handleCreateEmpty = () => {
        send({ type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT });
        vscode.postMessage({ command: "project.createEmpty" } as MessagesToStartupFlowProvider);
    };

    const handleCloneRepo = (repoUrl: string) => {
        vscode.postMessage({
            command: "project.clone",
            repoUrl,
        } as MessagesToStartupFlowProvider);
    };

    const handleOpenProject = (project: ProjectWithSyncStatus) => {
        console.log({ project });
        if (project.path) {
            vscode.postMessage({
                command: "project.open",
                projectPath: project.path,
            } as MessagesToStartupFlowProvider);
        }
    };
    useEffect(() => {
        if (state.matches(StartupFlowStates.ALREADY_WORKING)) {
            vscode.postMessage({ command: "workspace.continue" } as MessagesToStartupFlowProvider);
        }
    }, [state.value]);

    return (
        <div className="startup-flow-container">
            {state.matches(StartupFlowStates.LOGIN_REGISTER) && (
                <LoginRegisterStep
                    authState={state.context.authState}
                    onLogin={handleLogin}
                    onRegister={handleRegister}
                    onLogout={handleLogout}
                    onSkip={handleSkipAuth}
                />
            )}

            {state.matches(StartupFlowStates.OPEN_OR_CREATE_PROJECT) && (
                <ProjectSetupStep
                    onCreateEmpty={handleCreateEmpty}
                    onCloneRepo={handleCloneRepo}
                    onOpenProject={handleOpenProject}
                    vscode={vscode}
                    state={state}
                    send={send}
                />
            )}
            {state.matches(StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT) && (
                <div
                    style={{
                        display: "flex",

                        gap: "10px",
                        width: "100%",
                        height: "100vh",
                        alignItems: "center",
                        justifyContent: "center",
                    }}
                >
                    <div
                        style={{
                            display: "flex",
                            gap: "10px",
                            marginBottom: "37vh",
                            alignItems: "center",
                            justifyContent: "center",
                            flexDirection: "column",
                        }}
                    >
                        <i
                            className="codicon codicon-symbol-variable"
                            style={{ fontSize: "72px" }}
                        ></i>
                        <VSCodeButton
                            onClick={() => {
                                send({ type: StartupFlowEvents.INITIALIZE_PROJECT });
                                vscode.postMessage({
                                    command: "project.initialize",
                                } as MessagesToStartupFlowProvider);
                            }}
                        >
                            Initialize Project <i className="codicon codicon-arrow-right"></i>
                        </VSCodeButton>
                    </div>
                </div>
            )}
        </div>
    );
};
