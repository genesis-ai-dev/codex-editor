import React, { useState } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface HideOptionsButtonProps {
    children: React.ReactNode;
}

const HideOptionsButton: React.FC<HideOptionsButtonProps> = ({ children }) => {
    const [isHidden, setIsHidden] = useState(true);

    const handleButtonClick = () => {
        setIsHidden(!isHidden);
    };

    return (
        <div style={{ display: "flex", gap: "0.25em", height: "fit-content" }}>
            {!isHidden && children}
            <VSCodeButton
                aria-label="More options"
                appearance="icon"
                title="More options"
                onClick={handleButtonClick}
                style={{
                    backgroundColor: "var(--vscode-button-background)",
                    color: "var(--vscode-button-foreground)",
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
