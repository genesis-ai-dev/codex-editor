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
            justifyContent: "flex-start",
            width: "100%",
            alignItems: "center",
            padding: "0.5em 1em",
            gap: "0.5em",
            minHeight: "2.5em",
            position: "sticky",
            top: 0,
            zIndex: 1,
            backgroundColor: "var(--vscode-editor-background)",
            boxShadow: "0 2px 8px rgba(0, 0, 0, 0.1)"
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
