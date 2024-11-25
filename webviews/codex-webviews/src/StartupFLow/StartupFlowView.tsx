import React, { useCallback, useEffect } from "react";
import {
    VSCodeButton,
    VSCodePanels,
    VSCodePanelTab,
    VSCodePanelView,
    VSCodeDropdown,
    VSCodeOption,
} from "@vscode/webview-ui-toolkit/react";
import {
    BiblePreviewData,
    PreviewContent,
    SourceUploadPostMessages,
    SourceUploadResponseMessages,
    MessagesFromStartupFlowProvider,
    MessagesToStartupFlowProvider,
} from "../../../../types";
import { WorkflowProgress } from "./components/WorkflowProgress";

import { AuthenticationStep } from "./components/AuthenticationStep";

import { WorkflowState, WorkflowStep, ProcessingStatus } from "./types";
import { ProjectPicker } from "./components/ProjectPicker";
import { useMachine } from "@xstate/react";
import { startupFlowMachine } from "./machines/startupFlowMachine";

const initialWorkflowState: WorkflowState = {
    step: "auth",
    importType: null,
    selectedFiles: [],
    translationAssociations: [],
    fileObjects: [],
    previews: [],

    authState: {
        isAuthenticated: false,
        isAuthExtensionInstalled: false,
        isLoading: true,
        error: undefined,
    },
    projectSelection: {
        type: undefined,
        path: undefined,
        repoUrl: undefined,
        error: undefined,
    },
};

const vscode = acquireVsCodeApi();

export const SourceUploader: React.FC = () => {
    const [state, send] = useMachine(startupFlowMachine);
    console.log({ state });

    useEffect(() => {
        // Initial auth check
        vscode.postMessage({
            command: "auth.status",
        } as MessagesToStartupFlowProvider);

        // Listen for VSCode messages
        window.addEventListener("message", handleVSCodeMessage);
        return () => window.removeEventListener("message", handleVSCodeMessage);
    }, []);

    const handleVSCodeMessage = useCallback(
        (event: MessageEvent<MessagesFromStartupFlowProvider>) => {
            const message = event.data;
            console.log({ message });
            switch (message.command) {
                case "auth.statusResponse":
                    if (message.isAuthenticated) {
                        send({ type: "AUTH.LOGGED_IN" });
                    }
                    break;
                case "checkWorkspaceState":
                    if (message.isWorkspaceOpen) {
                        send({ type: "WORKSPACE.OPEN" });
                    } else {
                        send({ type: "WORKSPACE.CLOSED" });
                    }
                    break;
                case "extension.checkResponse":
                    if (message.isInstalled) {
                        send({ type: "AUTH.EXTENSION_INSTALLED" });
                    } else {
                        send({ type: "AUTH.NO_EXTENSION" });
                    }
                    break;
                // Add other message handlers
            }
        },
        [send]
    );

    const renderContent = () => {
        const currentState = state.value.toString();
        console.log({ currentState });
        switch (currentState) {
            case "loginRegister":
                return (
                    <AuthenticationStep
                        authState={state.context.authState}
                        onAuthComplete={() => send({ type: "AUTH.COMPLETE" })}
                        vscode={vscode}
                    />
                );
            case "projectSelect":
                return (
                    <ProjectPicker
                        projectSelection={state.context.projectSelection}
                        onProjectSelected={() => send({ type: "PROJECT.SELECTED" })}
                        vscode={vscode}
                    />
                );
            default:
                return <div>Unknown state: {currentState}</div>;
        }
    };

    return (
        <VSCodePanels>
            <VSCodePanelTab id="setup">Project Setup</VSCodePanelTab>
            <VSCodePanelView id="setup-view">
                <div
                    style={{
                        maxWidth: "100dvw",
                        margin: "0 auto",
                        padding: "2rem",
                        display: "flex",
                        flexDirection: "column",
                        gap: "2rem",
                    }}
                >
                    <WorkflowProgress currentState={state.value} context={state.context} />
                    {renderContent()}
                </div>
            </VSCodePanelView>
        </VSCodePanels>
    );
};

export default SourceUploader;
