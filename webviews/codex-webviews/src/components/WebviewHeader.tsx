import React from "react";

interface WebviewHeaderProps {
    title?: string;
    children?: React.ReactNode;
}

export const WebviewHeader: React.FC<WebviewHeaderProps> = ({
    title,
    children,
}: {
    title?: string;
    children?: React.ReactNode;
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
            backgroundColor: "var(--vscode-sideBar-background)",
            color: "var(--vscode-sideBar-foreground)",
            minHeight: "2em",
        }}
    >
        {title && (
            <h2
                style={{
                    margin: 0,
                    textTransform: "uppercase",
                    fontSize: "1rem",
                }}
            >
                {title}
            </h2>
        )}
        {children}
    </div>
);
