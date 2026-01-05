import React, { useEffect, useState } from "react";
import { ProjectSetupStep } from "./components/ProjectSetupStep";
import { LoginRegisterStep } from "./components/LoginRegisterStep";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import "./StartupFlowView.css";
import { AuthState } from "./types";
import {
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
    ProjectWithSyncStatus,
} from "types";
import { ProjectCreationModal } from "./components/ProjectCreationModal";

const vscode = acquireVsCodeApi();

export const StartupFlowView: React.FC = () => {
    const [isModalOpen, setIsModalOpen] = useState(false);
    const [projectsList, setProjectsList] = useState<ProjectWithSyncStatus[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [showLogin, setShowLogin] = useState(false);
    const [authState, setAuthState] = useState<AuthState>({
        isAuthenticated: false,
        isAuthExtensionInstalled: false,
        isLoading: true,
        error: undefined,
        gitlabInfo: undefined,
    });

    useEffect(() => {
        // Fetch projects list on mount
        vscode.postMessage({
            command: "getProjectsListFromGitLab",
        } as MessagesToStartupFlowProvider);

        // Listen for messages from the extension
        const messageHandler = (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            console.log({ message }, "message in startup flow");

            switch (message.command) {
                case "projectsListFromGitLab": {
                    setProjectsList(message.projects);
                    setIsLoading(false);
                    break;
                }
                case "project.created": {
                    // Close modal when project is created
                    if (message.success) {
                        setIsModalOpen(false);
                    }
                    break;
                }
                case "updateAuthState": {
                    setAuthState(message.authState);
                    setShowLogin(false); // Hide login when auth state updates
                    break;
                }
                case "forceLogin": {
                    setShowLogin(true);
                    break;
                }
                default:
                    break;
            }
        };

        window.addEventListener("message", messageHandler);
        return () => window.removeEventListener("message", messageHandler);
    }, []);

    const handleOpenProject = (project: ProjectWithSyncStatus) => {
        vscode.postMessage({
            command: "project.open",
            projectPath: project.path,
            mediaStrategy: project.mediaStrategy,
        } as MessagesToStartupFlowProvider);
    };

    const handleLogin = (username: string, password: string) => {
        vscode.postMessage({
            command: "auth.login",
            username,
            password,
        } as MessagesToStartupFlowProvider);
    };

    const handleRegister = (username: string, email: string, password: string) => {
        vscode.postMessage({
            command: "auth.signup",
            username,
            email,
            password,
        } as MessagesToStartupFlowProvider);
    };

    const handleSkipAuth = () => {
        vscode.postMessage({
            command: "auth.skipAuthentication",
        } as MessagesToStartupFlowProvider);
        setShowLogin(false);
    };

    const handleLogout = () => {
        vscode.postMessage({
            command: "auth.logout",
        } as MessagesToStartupFlowProvider);
        setShowLogin(true);
    };

    // Show login if forced or user is not authenticated
    if (showLogin || (!authState.isAuthenticated && !authState.isLoading)) {
        return (
            <LoginRegisterStep
                onLogin={handleLogin}
                onRegister={handleRegister}
                onSkipAuthentication={handleSkipAuth}
                authState={authState}
                vscode={vscode}
            />
        );
    }

    return (
        <div className="startup-flow-container">
            <div className="header-section">
                <h1>Your Projects</h1>
            </div>

            <div className="projects-section">
                <ProjectSetupStep
                    onCreateEmpty={() => setIsModalOpen(true)}
                    onCloneRepo={(repoUrl: string) => {
                        vscode.postMessage({
                            command: "project.clone",
                            repoUrl,
                        } as MessagesToStartupFlowProvider);
                    }}
                    onOpenProject={handleOpenProject}
                    vscode={vscode}
                    gitlabInfo={authState.gitlabInfo}
                    isAuthenticated={authState.isAuthenticated}
                />
            </div>

            <ProjectCreationModal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                vscode={vscode}
            />
        </div>
    );
};
