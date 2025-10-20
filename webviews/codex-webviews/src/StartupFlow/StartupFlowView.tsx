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
import NameProjectModal from "./components/NameProjectModal";
import { WebviewApi } from "vscode-webview";
import ConfirmModal from "../components/ConfirmModal";

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
    }, [value]);

    // Try to sync project after successful authentication
    const triggerSyncAfterAuth = (isAuthenticated: boolean) => {
        if (isAuthenticated) {
            console.log("Authentication successful, checking if we can sync project");
            // Check if there's an open workspace, then trigger sync
            vscode.postMessage({
                command: "workspace.checkStatus",
                callback: (workspaceStatus: { isOpen: boolean }) => {
                    if (workspaceStatus.isOpen) {
                        console.log("Workspace is open, triggering sync");
                        vscode.postMessage({
                            command: "project.triggerSync",
                            message: "Initial sync after login",
                        });
                    } else {
                        console.log("No workspace open, skipping initial sync");
                    }
                },
            });
        }
    };

    const handleLogin = async (username: string, password: string) => {
        console.log("Login attempt with:", username);
        vscode.postMessage({
            command: "auth.login",
            username,
            password,
        });

        // The login is asynchronous, but we need to keep the loading state until
        // we get a response from the extension about auth state update
        return new Promise<boolean>((resolve) => {
            const messageHandler = (event: MessageEvent<any>) => {
                const message = event.data;
                if (message.command === "updateAuthState") {
                    console.log("Auth state updated during login:", message.authState);
                    window.removeEventListener("message", messageHandler);

                    const isAuthenticated = message.authState?.isAuthenticated || false;
                    const authError = message.authState?.error;

                    // If login was successful, trigger project sync
                    if (isAuthenticated) {
                        triggerSyncAfterAuth(isAuthenticated);
                    }

                    // Resolve with success status based on auth state
                    resolve(isAuthenticated);
                } else if (message.command === "auth.error") {
                    // Handle explicit auth error message
                    console.error("Authentication error:", message.error);
                    window.removeEventListener("message", messageHandler);
                    resolve(false);
                } else if (message.command === "show.error" || message.command === "show.warning") {
                    // Handle VS Code notifications which often indicate authentication failures
                    console.warn("VS Code notification during login:", message);
                    // We keep the listener to also get the auth state update, but resolve false immediately
                    // to stop the loading indicator
                    resolve(false);
                }
            };

            // Add temporary listener for auth state update
            window.addEventListener("message", messageHandler);

            // Fallback timeout in case we don't get a response
            setTimeout(() => {
                window.removeEventListener("message", messageHandler);
                console.warn("Authentication timed out");
                resolve(false);
            }, 5000); // Reduced timeout to 5 seconds
        });
    };

    const handleRegister = async (username: string, email: string, password: string) => {
        console.log("Register attempt with:", username, email);
        vscode.postMessage({
            command: "auth.signup",
            username,
            email,
            password,
        });

        // Similar to login, keep loading state until auth response
        return new Promise<boolean>((resolve) => {
            const messageHandler = (event: MessageEvent<any>) => {
                const message = event.data;
                if (message.command === "updateAuthState") {
                    console.log("Auth state updated during registration:", message.authState);
                    window.removeEventListener("message", messageHandler);

                    const isAuthenticated = message.authState?.isAuthenticated || false;
                    const authError = message.authState?.error;

                    // If registration was successful, trigger project sync
                    if (isAuthenticated) {
                        triggerSyncAfterAuth(isAuthenticated);
                    }

                    resolve(isAuthenticated);
                } else if (message.command === "auth.error") {
                    // Handle explicit auth error message
                    console.error("Registration error:", message.error);
                    window.removeEventListener("message", messageHandler);
                    resolve(false);
                } else if (message.command === "show.error" || message.command === "show.warning") {
                    // Handle VS Code notifications which often indicate registration failures
                    console.warn("VS Code notification during registration:", message);
                    // We keep the listener to also get the auth state update, but resolve false immediately
                    // to stop the loading indicator
                    resolve(false);
                }
            };

            window.addEventListener("message", messageHandler);

            // Fallback timeout
            setTimeout(() => {
                window.removeEventListener("message", messageHandler);
                console.warn("Registration timed out");
                resolve(false);
            }, 5000); // Reduced timeout to 5 seconds
        });
    };

    const handleLogout = () => {
        vscode.postMessage({ command: "auth.logout" });
    };

    const handleSkipAuth = () => {
        // send({ type: StartupFlowEvents.SKIP_AUTH });
    };

    const [showNameModal, setShowNameModal] = useState(false);
    const [pendingSanitizedName, setPendingSanitizedName] = useState<{
        original: string;
        sanitized: string;
    } | null>(null);
    const [showConfirmSanitizedNameModal, setShowConfirmSanitizedNameModal] = useState(false);

    useEffect(() => {
        const onMessage = (event: MessageEvent<any>) => {
            const message = event.data as MessagesFromStartupFlowProvider;
            if (message?.command === "project.nameWillBeSanitized") {
                const payload = {
                    original: message.original,
                    sanitized: message.sanitized,
                };
                setPendingSanitizedName(payload);
                (window as any).__codexConfirmData = payload;
                setShowConfirmSanitizedNameModal(true);
            }
        };
        window.addEventListener("message", onMessage);
        return () => window.removeEventListener("message", onMessage);
    }, []);

    const handleCreateEmpty = () => {
        setPendingSanitizedName(null);
        setShowNameModal(true);
    };

    const submitProjectName = (name: string) => {
        vscode.postMessage({
            command: "project.createEmptyWithName",
            projectName: name,
        } as MessagesToStartupFlowProvider);
        // keep modal open until we know if sanitize changed it; provider will tell us if needed
        // but if no sanitize change, the provider will proceed and we can close immediately
        setShowNameModal(false);
    };

    // Confirmation handled by separate modal via submitProjectName

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

    const data = (window as any).__codexConfirmData as
        | { original: string; sanitized: string }
        | undefined;

    const sanitized = data?.sanitized || "";

    const confirmModalContent = (
        <div className="flex flex-col justify-center items-center py-4">
            <div className="font-semibold">{sanitized}</div>
        </div>
    );

    return (
        <div className="startup-flow-container">
            <div
                className="close-button-container"
                style={{
                    position: "absolute",
                    top: "10px",
                    right: "10px",
                    zIndex: 1000,
                }}
            >
                <VSCodeButton
                    appearance="icon"
                    onClick={() => vscode.postMessage({ command: "startup.dismiss" })}
                    title="Close"
                >
                    <i className="codicon codicon-close"></i>
                </VSCodeButton>
            </div>

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
                    vscode={vscode as unknown as WebviewApi<any>}
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
                                        waitForStateUpdate: true,
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

            <NameProjectModal
                open={showNameModal}
                onCancel={() => {
                    setShowNameModal(false);
                    setPendingSanitizedName(null);
                }}
                onSubmit={submitProjectName}
            />

            <ConfirmModal
                title="Confirm Project Name"
                description="Project name will be saved in the following format"
                open={showConfirmSanitizedNameModal}
                content={confirmModalContent}
                disableSubmit={!sanitized}
                onCancel={() => {
                    setShowConfirmSanitizedNameModal(false);
                    (window as any).__codexConfirmData = undefined;
                    setPendingSanitizedName(null);
                    setShowNameModal(true);
                }}
                onSubmit={() => {
                    vscode.postMessage({
                        command: "project.createEmpty.confirm",
                        proceed: true,
                        projectName: sanitized,
                    } as MessagesToStartupFlowProvider);
                    setShowConfirmSanitizedNameModal(false);
                    (window as any).__codexConfirmData = undefined;
                    setPendingSanitizedName(null);
                }}
            />
        </div>
    );
};

const InitializeProjectButton = ({
    onClick,
    isInitializing,
}: {
    onClick: () => void;
    isInitializing: boolean;
}) => {
    const [dots, setDots] = useState("");

    useEffect(() => {
        if (!isInitializing) return;

        const interval = setInterval(() => {
            setDots((prev) => (prev.length >= 3 ? "" : prev + "."));
        }, 500);

        return () => clearInterval(interval);
    }, [isInitializing]);

    return (
        <VSCodeButton
            onClick={onClick}
            style={{
                width: "200px",
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                gap: "4px",
            }}
        >
            <div
                style={{
                    minWidth: "140px",
                    display: "flex",
                    justifyContent: "center",
                }}
            >
                {isInitializing ? (
                    <>
                        Initializing Project
                        <span style={{ width: "18px", textAlign: "left" }}>{dots}</span>
                    </>
                ) : (
                    <>
                        Initialize Project
                        <i
                            className="codicon codicon-arrow-right"
                            style={{ marginLeft: "4px" }}
                        ></i>
                    </>
                )}
            </div>
        </VSCodeButton>
    );
};
