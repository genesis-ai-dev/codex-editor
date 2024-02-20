import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface HideOptionsButtonProps {
    children: React.ReactNode;
    outerDivStyles?: React.CSSProperties;
}

const HideOptionsButton: React.FC<HideOptionsButtonProps> = ({
    children,
    outerDivStyles,
}) => {
    const [isHidden, setIsHidden] = useState(true);

    const handleButtonClick = () => {
        setIsHidden(!isHidden);
    };

    return (
        <div
            style={{
                display: "flex",
                gap: "0.25em",
                height: "fit-content",
                maxHeight: "min-content",
                ...outerDivStyles,
            }}
        >
            {!isHidden && children}
            <VSCodeButton
                aria-label="More options"
                appearance="icon"
                title="More options"
                onClick={handleButtonClick}
                style={{
                    backgroundColor: isHidden
                        ? "var(--vscode-button-background)"
                        : "var(--vscode-errorForeground)",
                    color: isHidden
                        ? "var(--vscode-button-foreground)"
                        : "var(--vscode-editor-background)",
                }}
            >
                {isHidden ? (
                    <i className="codicon codicon-more"></i>
                ) : (
                    <i className="codicon codicon-x"></i>
                )}
            </VSCodeButton>
        </div>
    );
};

export default HideOptionsButton;
