import React from "react";

export interface AudioValidationStatusIconProps {
    isValidationInProgress: boolean;
    isDisabled: boolean;
    currentValidations: number;
    requiredValidations: number;
    isValidatedByCurrentUser: boolean;
    displayValidationText?: boolean;
}

const AudioValidationStatusIcon: React.FC<AudioValidationStatusIconProps> = ({
    isValidationInProgress,
    isDisabled,
    currentValidations,
    requiredValidations,
    isValidatedByCurrentUser,
    displayValidationText,
}) => {
    if (isValidationInProgress) {
        return (
            <i
                className="codicon codicon-loading"
                style={{
                    fontSize: "12px",
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
                {displayValidationText && <span>No validations</span>}
            </div>
        );
    }

    const isFullyValidated = currentValidations >= requiredValidations;

    if (isFullyValidated) {
        if (isValidatedByCurrentUser) {
            return (
                <div className="flex items-center justify-center text-sm font-light">
                    <i
                        className="codicon codicon-check-all"
                        style={{
                            fontSize: "12px",
                            color: isDisabled
                            ? "var(--vscode-disabledForeground)"
                            : "var(--vscode-testing-iconPassed)",
                        }}
                    ></i>
                    {displayValidationText && <span className="ml-1">Fully validated</span>}
                </div>
            );
        }
        return (
            <div className="flex items-center justify-center text-sm font-light">
                <i
                    className="codicon codicon-check-all"
                    style={{
                        fontSize: "12px",
                        color: isDisabled
                            ? "var(--vscode-disabledForeground)"
                            : "var(--vscode-descriptionForeground)",
                        }}
                ></i>
                {displayValidationText && <span className="ml-1">Fully validated by other user(s)</span>}
            </div>
        );
    }

    if (isValidatedByCurrentUser) {
        return (
            <div className="flex items-center justify-center text-sm font-light">
            <i
                className="codicon codicon-check"
                style={{
                    fontSize: "12px",
                    color: isDisabled
                        ? "var(--vscode-disabledForeground)"
                        : "var(--vscode-testing-iconPassed)",
                }}
                ></i>
                {displayValidationText && <span className="ml-1">Validated by you</span>}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center text-sm font-light">
            <i
                className="codicon codicon-circle-filled"
                style={{
                    fontSize: "12px",
                    color: isDisabled
                        ? "var(--vscode-disabledForeground)"
                        : "var(--vscode-descriptionForeground)",
                }}
            ></i>
            {displayValidationText && <span className="ml-1">Validated by other user(s)</span>}
        </div>
    );
};

export default AudioValidationStatusIcon;
