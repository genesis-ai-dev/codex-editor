import React from "react";
import { Button } from "./ui/button";

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
        <Button
            variant="ghost"
            size="sm"
            className={`flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-primary transition-colors ${className}`}
            style={style}
            onClick={handleClick}
        >
            <i className="codicon codicon-arrow-left text-xs" />
            Main Menu
        </Button>
    );
};
