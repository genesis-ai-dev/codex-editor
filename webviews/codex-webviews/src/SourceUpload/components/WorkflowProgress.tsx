import React from 'react';
import { WorkflowStep } from '../types';

interface WorkflowProgressProps {
    currentStep: WorkflowStep;
    steps: WorkflowStep[];
    onStepClick?: (step: WorkflowStep) => void;
}

export const WorkflowProgress: React.FC<WorkflowProgressProps> = ({ 
    currentStep, 
    steps,
    onStepClick 
}) => {
    const getStepLabel = (step: WorkflowStep): string => {
        switch (step) {
            case "type-select":
                return "Import Type";
            case "select":
                return "Select File";
            case "preview":
                return "Review";
            case "processing":
                return "Processing";
            case "complete":
                return "Complete";
            default:
                return step;
        }
    };

    const isStepClickable = (step: WorkflowStep): boolean => {
        const currentIndex = steps.indexOf(currentStep);
        const stepIndex = steps.indexOf(step);
        
        // Can only go back to previous steps, and never during processing
        return currentStep !== 'processing' && 
               stepIndex < currentIndex && 
               step !== 'processing' && 
               step !== 'complete';
    };

    return (
        <div style={{
            display: "flex",
            justifyContent: "space-between",
            marginBottom: "2rem",
            position: "relative",
            padding: "1rem 0"
        }}>
            {/* Progress line */}
            <div style={{
                position: "absolute",
                top: "50%",
                left: "0",
                right: "0",
                height: "2px",
                background: "var(--vscode-widget-border)",
                zIndex: 0
            }} />
            
            {/* Progress fill */}
            <div style={{
                position: "absolute",
                top: "50%",
                left: "0",
                height: "2px",
                background: "var(--vscode-button-background)",
                width: `${(steps.indexOf(currentStep) / (steps.length - 1)) * 100}%`,
                transition: "width 0.3s ease-in-out",
                zIndex: 0
            }} />

            {steps.map((step, index) => {
                const isActive = step === currentStep;
                const isComplete = steps.indexOf(currentStep) > index;
                const clickable = isStepClickable(step);
                
                return (
                    <div 
                        key={step} 
                        onClick={() => clickable && onStepClick?.(step)}
                        style={{
                            display: "flex",
                            flexDirection: "column",
                            alignItems: "center",
                            gap: "0.5rem",
                            position: "relative",
                            zIndex: 1,
                            cursor: clickable ? "pointer" : "default",
                            opacity: currentStep === 'processing' && !isActive ? 0.7 : 1,
                            transition: "opacity 0.3s ease"
                        }}
                    >
                        <div style={{
                            width: "2rem",
                            height: "2rem",
                            borderRadius: "50%",
                            background: isActive || isComplete 
                                ? "var(--vscode-button-background)" 
                                : "var(--vscode-editor-background)",
                            border: "2px solid var(--vscode-button-background)",
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                            color: isActive || isComplete 
                                ? "var(--vscode-button-foreground)" 
                                : "var(--vscode-foreground)",
                            transition: "all 0.3s ease"
                        }}>
                            {isComplete ? (
                                <i className="codicon codicon-check" />
                            ) : isActive && step === 'processing' ? (
                                <i className="codicon codicon-sync codicon-modifier-spin" />
                            ) : (
                                index + 1
                            )}
                        </div>
                        <span style={{
                            color: isActive 
                                ? "var(--vscode-button-background)" 
                                : "var(--vscode-foreground)"
                        }}>
                            {getStepLabel(step)}
                        </span>
                    </div>
                );
            })}
        </div>
    );
};
