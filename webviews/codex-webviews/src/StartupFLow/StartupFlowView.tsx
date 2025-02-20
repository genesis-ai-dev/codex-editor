import React, { useEffect, useState } from "react";
import { useActor } from "@xstate/react";
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
} from "types";
import { createActor } from "xstate";
import { InputCriticalProjectInfo } from "./components/InputCriticalProjectInfo";

enum StartupFlowStates {
    LOGIN_REGISTER = "loginRegister",
    OPEN_OR_CREATE_PROJECT = "createNewProject",
    PROMPT_USER_TO_INITIALIZE_PROJECT = "promptUserToInitializeProject",
    PROMPT_USER_TO_ADD_CRITICAL_DATA = "promptUserToAddCriticalData",
    ALREADY_WORKING = "alreadyWorking",
}


const vscode = acquireVsCodeApi();

export const StartupFlowView: React.FC = () => {
    const [value, setValue] = useState<StartupFlowStates | null>(null);
    const [isInitializing, setIsInitializing] = useState(false);

    useEffect(() => {
        // Request metadata check to determine initial state
        vscode.postMessage({ command: "webview.ready" });

        // Listen for messages from the extension
        const messageHandler = (event: MessageEvent</* MessagesFromStartupFlowProvider */ any>) => {
            const message = event.data;
            console.log({ message }, "message in startup flow");
            switch (message.command) {
                case "state.update": {
                    setValue(message.state.value);
                    break;
                }
                case "project.initializationStatus": {
                    const { isInitialized } = message;
                    if (isInitialized) {
                        // Project is initialized, move to critical data state
                        setValue(StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA);
                        setIsInitializing(false);
                        // Request metadata check to get latest data
                        vscode.postMessage({ command: "metadata.check" });
                        // Show Project Manager view
                        vscode.postMessage({ command: "project.showManager" });
                    }
                    break;
                }
                case "metadata.checkResponse": {
                    // Only handle metadata response if we're in the critical data state
                    if (value === StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA) {
                        // Show Project Manager view
                        vscode.postMessage({ command: "project.showManager" });
                    }
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
        return () => window.removeEventListener("message", messageHandler);
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
        { value, doesThisWork: value === StartupFlowStates.OPEN_OR_CREATE_PROJECT },
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
                        <InitializeProjectButton
                            isInitializing={isInitializing}
                            onClick={async () => {
                                if (!isInitializing) {
                                    setIsInitializing(true);
                                    vscode.postMessage({
                                        command: "project.initialize",
                                        waitForStateUpdate: true
                                    } as MessagesToStartupFlowProvider);
                                }
                            }}
                        />
                    </div>
                </div>
            )}

            {value === StartupFlowStates.PROMPT_USER_TO_ADD_CRITICAL_DATA && (
                <InputCriticalProjectInfo vscode={vscode} />
            )}
        </div>
    );
};

const InitializeProjectButton = ({ 
    onClick,
    isInitializing 
}: { 
    onClick: () => void;
    isInitializing: boolean;
}) => {
    const [dots, setDots] = useState('');
    
    useEffect(() => {
        if (!isInitializing) return;
        
        const interval = setInterval(() => {
            setDots(prev => prev.length >= 3 ? '' : prev + '.');
        }, 500);
        
        return () => clearInterval(interval);
    }, [isInitializing]);
    
    return (
        <VSCodeButton
            onClick={onClick}
            style={{
                width: '200px',
                display: 'flex',
                justifyContent: 'center',
                alignItems: 'center',
                gap: '4px'
            }}
        >
            <div style={{ 
                minWidth: '140px',
                display: 'flex',
                justifyContent: 'center'
            }}>
                {isInitializing ? (
                    <>
                        Initializing Project
                        <span style={{ width: '18px', textAlign: 'left' }}>{dots}</span>
                    </>
                ) : (
                    <>
                        Initialize Project
                        <i className="codicon codicon-arrow-right" style={{ marginLeft: '4px' }}></i>
                    </>
                )}
            </div>
        </VSCodeButton>
    );
};
