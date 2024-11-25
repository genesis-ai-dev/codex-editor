import React from "react";
import { StateValue } from "xstate";
import { startupFlowMachine } from "../machines/startupFlowMachine";

interface WorkflowProgressProps {
    currentState: StateValue;
    context: any;
}

export const WorkflowProgress: React.FC<WorkflowProgressProps> = ({ currentState, context }) => {
    const getStateLabel = (state: string): string => {
        switch (state) {
            case "loginRegister":
                return "Authentication";
            case "workspaceCheck":
                return "Workspace";
            case "createNewProject":
                return "New Project";
            case "metadataCheck":
                return "Project Check";
            case "openSourceFlow":
                return "Initialize";
            case "complicatedState":
                return "Setup";
            case "alreadyWorking":
                return "Complete";
            default:
                return state;
        }
    };

    const getStateDescription = (state: string): string => {
        switch (state) {
            case "loginRegister":
                return "Log in or register";
            case "workspaceCheck":
                return "Check workspace status";
            case "createNewProject":
                return "Create or clone project";
            case "metadataCheck":
                return "Check project status";
            case "openSourceFlow":
                return "Initialize project";
            case "complicatedState":
                return "Project setup";
            case "alreadyWorking":
                return "Project ready";
            default:
                return "";
        }
    };

    const isStateComplete = (state: string): boolean => {
        const states = Object.keys(startupFlowMachine.states);
        const currentIndex = states.indexOf(currentState.toString());
        const stateIndex = states.indexOf(state);
        return stateIndex < currentIndex;
    };

    return (
        <div className="workflow-progress">
            {Object.keys(startupFlowMachine.states).map((state) => (
                <div
                    key={state}
                    className={`progress-step ${currentState === state ? "active" : ""} ${
                        isStateComplete(state) ? "complete" : ""
                    }`}
                >
                    <div className="step-indicator">{isStateComplete(state) ? "✓" : ""}</div>
                    <div className="step-label">{getStateLabel(state)}</div>
                    <div className="step-description">{getStateDescription(state)}</div>
                </div>
            ))}
        </div>
    );
};
