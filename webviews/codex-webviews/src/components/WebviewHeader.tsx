import React from "react";
import { BackToMenuButton } from "./BackToMenuButton";

interface WebviewHeaderProps {
    title?: string;
    children?: React.ReactNode;
    showBackButton?: boolean;
    vscode?: {
        postMessage: (message: any) => void;
    };
}

export const WebviewHeader: React.FC<WebviewHeaderProps> = ({
    title,
    children,
    showBackButton = true,
    vscode,
}: {
    title?: string;
    children?: React.ReactNode;
    showBackButton?: boolean;
    vscode?: {
        postMessage: (message: any) => void;
    };
}) => (
    <div
        className="webview-header"
        style={{
            display: "flex",
            justifyContent: "stretch",
            width: "100%",
            alignItems: "center",
            padding: "0.25em 1em",
            gap: "0.25em",
            borderBottom: "2px solid var(--vscode-editorGroupHeader-tabsBorder)",
            minHeight: "2em",
        }}
    >
        {showBackButton && vscode && <BackToMenuButton vscode={vscode} />}

        {/* {title && (
            <h2
                style={{
                    margin: 0,
                    textTransform: "uppercase",
                    fontSize: "1rem",
                }}
            >
                {title}
            </h2>
        )} */}
        {/* {children} */}
    </div>
);
