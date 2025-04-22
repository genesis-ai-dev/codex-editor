import React from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";

interface BackToMenuButtonProps {
    className?: string;
    style?: React.CSSProperties;
    vscode: {
        postMessage: (message: any) => void;
    };
}

export const BackToMenuButton: React.FC<BackToMenuButtonProps> = ({ className, style, vscode }) => {
    const handleClick = () => {
        vscode.postMessage({
            command: "navigateToMainMenu",
        });
    };

    return (
        <VSCodeButton
            appearance="secondary"
            className={className}
            style={{
                width: "100%",
                display: "flex",
                gap: "0.5rem",
                alignItems: "center",
                justifyContent: "center",
                margin: "0.25rem",
                fontVariant: "small-caps",
                ...style,
            }}
            onClick={handleClick}
        >
            <i
                className="codicon codicon-arrow-left"
                style={{
                    fontSize: "0.875rem",
                    display: "flex",
                    alignItems: "center",
                }}
            ></i>{" "}
            MAIN MENU
        </VSCodeButton>
    );
};
