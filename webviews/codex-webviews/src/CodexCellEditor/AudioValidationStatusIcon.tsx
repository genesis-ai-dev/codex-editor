import React from "react";

export const getValidationLabel = (opts: {
    currentValidations: number;
    requiredValidations: number;
    isValidatedByCurrentUser: boolean;
    otherValidatorCount?: number;
}): string => {
    if (opts.currentValidations === 0) {
        return "No validators";
    }
    const isFullyValidated = opts.currentValidations >= opts.requiredValidations;
    const others = opts.otherValidatorCount ?? (opts.currentValidations - (opts.isValidatedByCurrentUser ? 1 : 0));
    const otherText = others === 1 ? "1 user" : `${others} users`;

    if (isFullyValidated) {
        if (opts.isValidatedByCurrentUser && others > 0) {
            return `Fully validated by you + ${otherText}`;
        }
        if (opts.isValidatedByCurrentUser) {
            return "Fully validated by you";
        }
        return `Fully validated by ${otherText}`;
    }
    if (opts.isValidatedByCurrentUser && others > 0) {
        return `Validated by you + ${otherText}`;
    }
    if (opts.isValidatedByCurrentUser) {
        return "Validated by you";
    }
    return `Validated by ${otherText}`;
};

export interface ValidationStatusIconProps {
    isValidationInProgress: boolean;
    isDisabled: boolean;
    currentValidations: number;
    requiredValidations: number;
    isValidatedByCurrentUser: boolean;
    displayValidationText?: boolean;
    otherValidatorCount?: number;
}

const ValidationStatusIcon: React.FC<ValidationStatusIconProps> = ({
    isValidationInProgress,
    isDisabled,
    currentValidations,
    requiredValidations,
    isValidatedByCurrentUser,
    displayValidationText,
    otherValidatorCount,
}) => {
    if (isValidationInProgress) {
        return (
            <i
                className="codicon codicon-loading"
                style={{
                    fontSize: "14px",
                    color: isDisabled
                        ? "var(--vscode-disabledForeground)"
                        : "var(--vscode-descriptionForeground)",
                    animation: "spin 1.5s linear infinite",
                }}
            ></i>
        );
    }

    if (currentValidations === 0) {
        return (
            <div className="flex items-center justify-center text-sm font-light">
                <i
                    className="codicon codicon-circle-outline"
                    style={{
                        fontSize: "12px",
                        color: isDisabled
                            ? "var(--vscode-disabledForeground)"
                            : "var(--vscode-descriptionForeground)",
                    }}
                ></i>
                {displayValidationText && <span className="ml-1">No validators</span>}
            </div>
        );
    }

    const isFullyValidated = currentValidations >= requiredValidations;

    const label = getValidationLabel({ currentValidations, requiredValidations, isValidatedByCurrentUser, otherValidatorCount });

    const iconClass = isFullyValidated ? "codicon codicon-check-all" : isValidatedByCurrentUser ? "codicon codicon-check" : "codicon codicon-circle-filled";
    const iconColor = (isFullyValidated || isValidatedByCurrentUser)
        ? (isDisabled ? "var(--vscode-disabledForeground)" : "var(--vscode-charts-green)")
        : (isDisabled ? "var(--vscode-disabledForeground)" : "var(--vscode-descriptionForeground)");
    const iconSize = (isFullyValidated || isValidatedByCurrentUser) ? "14px" : "12px";
    const iconFilter = (isFullyValidated || isValidatedByCurrentUser) ? "drop-shadow(0 0 0.5px rgba(0,0,0,0.45))" : undefined;

    return (
        <div className="flex items-center justify-center text-sm font-light">
            <i
                className={iconClass}
                style={{ fontSize: iconSize, color: iconColor, filter: iconFilter }}
            ></i>
            {displayValidationText && <span className="ml-1">{label}</span>}
        </div>
    );
};

export default ValidationStatusIcon;
