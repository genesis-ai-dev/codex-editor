import React, { useEffect, useState } from "react";
import { useActor } from "@xstate/react";
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
import {
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
    ProjectWithSyncStatus,
} from "../../../../types";
import { createActor } from "xstate";

const vscode = acquireVsCodeApi();

export const StartupFlowView: React.FC = () => {
    // const [state, send] = useActor(startupFlowMachine);
    const [value, setValue] = useState<StartupFlowStates | null>(null);
    useEffect(() => {
        // Notify the extension that the webview is ready
        vscode.postMessage({ command: "webview.ready" });

        // Request initial auth and workspace status
        vscode.postMessage({ command: "auth.status" });
        vscode.postMessage({ command: "workspace.status" });

        // Listen for messages from the extension
        const messageHandler = (event: MessageEvent</* MessagesFromStartupFlowProvider */ any>) => {
            const message = event.data;
            console.log({ message }, "message in startup flow");
            switch (message.command) {
                case "state.update": {
                    setValue(message.state.value);
                    break;
                }
                case "updateAuthState": {
                    console.log("updateAuthState", JSON.stringify(message, null, 2));
                    const authState: AuthState = message.authState;
                    if (!authState.isAuthExtensionInstalled) {
                        // send({
                        //     type: StartupFlowEvents.NO_AUTH_EXTENSION,
                        //     data: {
                        //         isAuthenticated: false,
                        //         isAuthExtensionInstalled: false,
                        //         isLoading: false,
                        //         error: undefined,
                        //         gitlabInfo: undefined,
                        //         workspaceState: authState.workspaceState,
                        //     },
                        // });
                    } else if (authState.isAuthenticated) {
                        // send({
                        //     type: StartupFlowEvents.AUTH_LOGGED_IN,
                        //     data: {
                        //         isAuthenticated: authState.isAuthenticated,
                        //         isAuthExtensionInstalled: true,
                        //         isLoading: false,
                        //         error: authState.error,
                        //         gitlabInfo: authState.gitlabInfo,
                        //         workspaceState: authState.workspaceState,
                        //     },
                        // });
                    } else {
                        // send({
                        //     type: StartupFlowEvents.UPDATE_AUTH_STATE,
                        //     data: {
                        //         isAuthenticated: false,
                        //         isAuthExtensionInstalled: true,
                        //         isLoading: false,
                        //         error: authState.error,
                        //         gitlabInfo: undefined,
                        //         workspaceState: authState.workspaceState,
                        //     },
                        // });
                    }
                    break;
                }
                case "workspace.statusResponse": {
                    if (message.isOpen) {
                        vscode.postMessage({
                            command: "metadata.check",
                        } as MessagesToStartupFlowProvider);
                    } else {
                        console.log("workspace.statusResponse workspace not open");
                        // send({
                        //     type: StartupFlowEvents.NO_AUTH_EXTENSION,
                        //     data: {
                        //         isAuthenticated: false,
                        //         isAuthExtensionInstalled: false,
                        //         isLoading: false,
                        //         error: undefined,
                        //         gitlabInfo: undefined,
                        //         workspaceState: {
                        //             isWorkspaceOpen: false,
                        //             isProjectInitialized: false,
                        //         },
                        //     },
                        // });
                    }
                    break;
                }
                case "metadata.checkResponse":
                    console.log("metadata.checkResponse", JSON.stringify(message, null, 2));
                    if (message.data.exists) {
                        if (message.data.hasCriticalData) {
                            // send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN });
                        } else {
                            // send({ type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA });
                        }
                    } else {
                        // send({ type: StartupFlowEvents.EMPTY_WORKSPACE_THAT_NEEDS_PROJECT });
                    }
                    break;
                case "setupIncompleteCriticalDataMissing": {
                    // console.log("setupIncompleteCriticalDataMissing called", {
                    //     state,
                    // });
                    // send({ type: StartupFlowEvents.PROJECT_MISSING_CRITICAL_DATA });
                    break;
                }
                case "setupComplete": {
                    // console.log("setupComplete called");
                    // send({ type: StartupFlowEvents.VALIDATE_PROJECT_IS_OPEN });
                    break;
                }
            }
        };

        window.addEventListener("message", messageHandler);
        return () => {
            window.removeEventListener("message", messageHandler);
        };
    }, []);

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
        // send({ type: StartupFlowEvents.SKIP_AUTH });
    };

    const handleCreateEmpty = () => {
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

    // useEffect(() => {
    //     if (state.matches(StartupFlowStates.ALREADY_WORKING)) {
    //         vscode.postMessage({ command: "workspace.continue" } as MessagesToStartupFlowProvider);
    //     }
    // }, [state.value]);

    console.log(
        { value, doesThisWork: value === StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA },
        "value in startup flow"
    );

    return (
        <div className="startup-flow-container">
            {value === StartupFlowStates.LOGIN_REGISTER && (
                <LoginRegisterStep
                    // authState={value.context.authState}
                    onLogin={handleLogin}
                    onRegister={handleRegister}
                    onLogout={handleLogout}
                    onSkip={handleSkipAuth}
                />
            )}

            {value === StartupFlowStates.OPEN_OR_CREATE_PROJECT && (
                <ProjectSetupStep
                    onCreateEmpty={handleCreateEmpty}
                    onCloneRepo={handleCloneRepo}
                    onOpenProject={handleOpenProject}
                    vscode={vscode}
                    // state={state}
                    // send={send}
                />
            )}
            {value === StartupFlowStates.PROMPT_USER_TO_INITIALIZE_PROJECT && (
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
                                // send({ type: StartupFlowEvents.INITIALIZE_PROJECT });
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

            {value === StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA && (
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
                                vscode.postMessage({
                                    command: "renameProject",
                                });
                            }}
                        >
                            Name Project <i className="codicon codicon-arrow-right"></i>
                        </VSCodeButton>
                        <VSCodeButton
                            onClick={() => {
                                vscode.postMessage({
                                    command: "changeSourceLanguage",
                                });
                            }}
                        >
                            Source Language <i className="codicon codicon-arrow-right"></i>
                        </VSCodeButton>
                        <VSCodeButton
                            onClick={() => {
                                vscode.postMessage({
                                    command: "changeTargetLanguage",
                                });
                            }}
                        >
                            Target Language <i className="codicon codicon-arrow-right"></i>
                        </VSCodeButton>
                    </div>
                </div>
            )}
        </div>
    );
};
