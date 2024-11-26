import React, { useEffect } from "react";
import { useMachine } from "@xstate/react";
import { startupFlowMachine } from "./machines/startupFlowMachine";
import { LoginRegisterStep } from "./components/LoginRegisterStep";
import { WorkspaceStep } from "./components/WorkspaceStep";
import { ProjectSetupStep } from "./components/ProjectSetupStep";
import { VSCodeProgressRing } from "@vscode/webview-ui-toolkit/react";
import "./StartupFlowView.css";
import { AuthState } from "./types";

const vscode = acquireVsCodeApi();

export const StartupFlowView: React.FC = () => {
    const [state, send, service] = useMachine(startupFlowMachine);

    useEffect(() => {
        // Request initial auth and workspace status
        vscode.postMessage({ command: "auth.status" });
        vscode.postMessage({ command: "workspace.status" });

        // Listen for messages from the extension
        const messageHandler = (event: MessageEvent) => {
            const message = event.data;
            switch (message.command) {
                case "updateAuthState": {
                    const authState: AuthState = message.authState;
                    if (!authState.isAuthExtensionInstalled) {
                        send({
                            type: "AUTH.NO_EXTENSION",
                            data: {
                                isAuthenticated: false,
                                isAuthExtensionInstalled: false,
                                isLoading: false,
                                gitlabInfo: undefined
                            }
                        });
                    } else {
                        send({
                            type: authState.isAuthenticated ? "AUTH.LOGGED_IN" : "AUTH.NOT_AUTHENTICATED",
                            data: {
                                isAuthenticated: authState.isAuthenticated,
                                isAuthExtensionInstalled: true,
                                isLoading: false,
                                error: authState.error,
                                gitlabInfo: authState.gitlabInfo
                            }
                        });
                    }
                    break;
                }
                case "workspace.statusResponse":
                    if (message.isOpen) {
                        send({ type: "WORKSPACE.OPEN" });
                        vscode.postMessage({ command: "metadata.check" });
                    } else {
                        send({ type: "WORKSPACE.CLOSED" });
                    }
                    break;
                case "workspace.opened":
                    send({ type: "WORKSPACE.OPEN" });
                    vscode.postMessage({ command: "metadata.check" });
                    break;
                case "workspace.closed":
                    send({ type: "WORKSPACE.CLOSED" });
                    break;
                case "metadata.check":
                    send({
                        type: message.exists ? "METADATA.EXISTS" : "METADATA.NOT_EXISTS"
                    });
                    break;
            }
        };

        window.addEventListener('message', messageHandler);
        return () => {
            window.removeEventListener('message', messageHandler);
            service.stop(); // Clean up the state machine
        };
    }, [send]);

    const handleLogin = (username: string, password: string) => {
        vscode.postMessage({ 
            command: "auth.login",
            username,
            password
        });
    };

    const handleRegister = (username: string, email: string, password: string) => {
        vscode.postMessage({ 
            command: "auth.signup",
            username,
            email,
            password
        });
    };

    const handleLogout = () => {
        vscode.postMessage({ command: "auth.logout" });
    };

    const handleSkipAuth = () => {
        send({ type: "AUTH.NO_EXTENSION" });
    };

    const handleOpenWorkspace = () => {
        vscode.postMessage({ command: "workspace.open" });
    };

    const handleCreateNew = () => {
        vscode.postMessage({ command: "workspace.create" });
    };

    const handleCreateEmpty = () => {
        send({ type: "PROJECT.CREATE_EMPTY" });
        vscode.postMessage({ command: "project.createEmpty" });
    };

    const handleCloneRepo = (repoUrl: string) => {
        send({ type: "PROJECT.CLONE" });
        vscode.postMessage({ 
            command: "project.clone",
            repoUrl
        });
    };

    return (
        <div className="startup-flow">
            <div className="auth-status-bar">
                {state.context.authState.isLoading ? (
                    <span className="loading">
                        <VSCodeProgressRing /> Checking authentication...
                    </span>
                ) : state.context.authState.isAuthenticated ? (
                    <span className="authenticated">
                        {/* Authenticated as {state.context.authState.gitlabInfo?.username || 'User'} */}
                        Authenticated
                    </span>
                ) : state.context.authState.isAuthExtensionInstalled ? (
                    <span className="not-authenticated">Not authenticated</span>
                ) : (
                    <span className="no-extension">Auth extension not installed</span>
                )}
            </div>

            {state.matches("loginRegister") && (
                <LoginRegisterStep
                    authState={state.context.authState}
                    onLogin={handleLogin}
                    onRegister={handleRegister}
                    onLogout={handleLogout}
                    onSkip={handleSkipAuth}
                />
            )}
            {state.matches("workspaceCheck") && (
                <WorkspaceStep
                    onOpenWorkspace={handleOpenWorkspace}
                    onCreateNew={handleCreateNew}
                />
            )}
            {state.matches("createNewProject") && (
                <ProjectSetupStep
                    projectSelection={state.context.projectSelection}
                    onCreateEmpty={handleCreateEmpty}
                    onCloneRepo={handleCloneRepo}
                />
            )}
            {state.matches("openSourceFlow") && (
                <VSCodeProgressRing />
            )}
        </div>
    );
};
