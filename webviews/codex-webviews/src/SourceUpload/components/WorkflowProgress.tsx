import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { ImportType, WorkflowStep } from "../types";

interface WorkflowProgressProps {
    currentStep: WorkflowStep;
    importType: ImportType;
    steps: WorkflowStep[];
    onStepClick: (step: WorkflowStep) => void;
}

export const WorkflowProgress: React.FC<WorkflowProgressProps> = ({
    currentStep,
    importType,
    steps,
    onStepClick,
}) => {
    const getStepLabel = (step: WorkflowStep): string => {
        if (importType === "bible-download") {
            switch (step) {
                case "type-select":
                    return "Select Type";
                case "select":
                    return "Choose Bible";
                case "preview":
                    return "Preview Content";
                case "processing":
                    return "Download";
                case "complete":
                    return "Complete";
                default:
                    return step;
            }
        }

        // Default labels for other import types
        switch (step) {
            case "type-select":
                return "Select Type";
            case "select":
                return "Choose File";
            case "preview":
                return "Preview";
            case "processing":
                return "Processing";
            case "complete":
                return "Complete";
            default:
                return step;
        }
    };

    const getStepDescription = (step: WorkflowStep): string => {
        if (importType === "bible-download") {
            switch (step) {
                case "type-select":
                    return "Choose import type";
                case "select":
                    return "Select Bible translation";
                case "preview":
                    return "Review Bible content";
                case "processing":
                    return "Download and process";
                case "complete":
                    return "Import complete";
                default:
                    return "";
            }
        }

        // Default descriptions for other import types
        switch (step) {
            case "type-select":
                return "Choose import type";
            case "select":
                return "Select source file";
            case "preview":
                return "Review content";
            case "processing":
                return "Process content";
            case "complete":
                return "Import complete";
            default:
                return "";
        }
    };

    const isStepComplete = (step: WorkflowStep): boolean => {
        const stepIndex = steps.indexOf(step);
        const currentIndex = steps.indexOf(currentStep);
        return stepIndex < currentIndex;
    };

    const isStepActive = (step: WorkflowStep): boolean => {
        return step === currentStep;
    };

    const canClickStep = (step: WorkflowStep): boolean => {
        if (currentStep === "processing") return false;
        if (step === "complete" && !isStepComplete("processing")) return false;
        const stepIndex = steps.indexOf(step);
        const currentIndex = steps.indexOf(currentStep);
        return stepIndex <= currentIndex;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
                style={{
                    display: "flex",
                    gap: "0.5rem",
                    alignItems: "center",
                }}
            >
                {steps.map((step, index) => (
                    <React.Fragment key={step}>
                        <VSCodeButton
                            appearance={isStepActive(step) ? "primary" : "secondary"}
                            disabled={!canClickStep(step)}
                            onClick={() => onStepClick(step)}
                            style={{
                                opacity: isStepComplete(step) ? 0.7 : 1,
                                cursor: canClickStep(step) ? "pointer" : "default",
                            }}
                        >
                            {isStepComplete(step) && (
                                <i
                                    className="codicon codicon-check"
                                    style={{ marginRight: "0.5rem" }}
                                />
                            )}
                            {getStepLabel(step)}
                        </VSCodeButton>
                        {index < steps.length - 1 && (
                            <div
                                style={{
                                    height: "1px",
                                    width: "1rem",
                                    background: "var(--vscode-button-separator)",
                                }}
                            />
                        )}
                    </React.Fragment>
                ))}
            </div>
            <p
                style={{
                    color: "var(--vscode-descriptionForeground)",
                    fontSize: "0.9em",
                }}
            >
                {getStepDescription(currentStep)}
            </p>
        </div>
    );
};
