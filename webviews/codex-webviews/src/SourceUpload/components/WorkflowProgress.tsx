import React from "react";
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

    const isStepClickable = (step: WorkflowStep): boolean => {
        if (currentStep === "processing") return false;
        const stepIndex = steps.indexOf(step);
        const currentIndex = steps.indexOf(currentStep);

        return (
            (step === "type-select" || stepIndex < currentIndex) &&
            step !== "processing" &&
            step !== "complete"
        );
    };

    const isStepComplete = (step: WorkflowStep): boolean => {
        const stepIndex = steps.indexOf(step);
        const currentIndex = steps.indexOf(currentStep);
        return stepIndex < currentIndex;
    };

    return (
        <div style={{ display: "flex", flexDirection: "column", gap: "1rem" }}>
            <div
                style={{
                    display: "flex",
                    justifyContent: "space-between",
                    position: "relative",
                    padding: "1rem 0",
                }}
            >
                {/* Progress line */}
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "0",
                        right: "0",
                        height: "2px",
                        background: "var(--vscode-widget-border)",
                        zIndex: 0,
                    }}
                />

                {/* Progress fill */}
                <div
                    style={{
                        position: "absolute",
                        top: "50%",
                        left: "0",
                        height: "2px",
                        background: "var(--vscode-button-background)",
                        width: `${(steps.indexOf(currentStep) / (steps.length - 1)) * 100}%`,
                        transition: "width 0.3s ease-in-out",
                        zIndex: 0,
                    }}
                />

                {steps.map((step, index) => {
                    const isActive = step === currentStep;
                    const complete = isStepComplete(step);
                    const clickable = isStepClickable(step);

                    return (
                        <div
                            key={step}
                            onClick={() => clickable && onStepClick(step)}
                            style={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                gap: "0.5rem",
                                position: "relative",
                                zIndex: 1,
                                cursor: clickable ? "pointer" : "default",
                                opacity: currentStep === "processing" && !isActive ? 0.7 : 1,
                                transition: "opacity 0.3s ease",
                            }}
                        >
                            <div
                                style={{
                                    width: "2rem",
                                    height: "2rem",
                                    borderRadius: "50%",
                                    background:
                                        isActive || complete
                                            ? "var(--vscode-button-background)"
                                            : "var(--vscode-editor-background)",
                                    border: "2px solid var(--vscode-button-background)",
                                    display: "flex",
                                    alignItems: "center",
                                    justifyContent: "center",
                                    color:
                                        isActive || complete
                                            ? "var(--vscode-button-foreground)"
                                            : "var(--vscode-foreground)",
                                    transition: "all 0.3s ease",
                                }}
                            >
                                {complete ? (
                                    <i className="codicon codicon-check" />
                                ) : isActive && step === "processing" ? (
                                    <i className="codicon codicon-sync codicon-modifier-spin" />
                                ) : (
                                    index + 1
                                )}
                            </div>
                            <span
                                style={{
                                    color: isActive
                                        ? "var(--vscode-button-background)"
                                        : "var(--vscode-foreground)",
                                }}
                            >
                                {getStepLabel(step)}
                            </span>
                        </div>
                    );
                })}
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
