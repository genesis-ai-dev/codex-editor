import React from "react";
import { BackToMenuButton } from "./BackToMenuButton";
import { Card } from "./ui/card";
import "../tailwind.css";

interface WebviewHeaderProps {
    title?: string;
    children?: React.ReactNode;
    showBackButton?: boolean;
    showBorderShadow?: boolean;
    vscode?: {
        postMessage: (message: any) => void;
    };
}

export const WebviewHeader: React.FC<WebviewHeaderProps> = ({
    title,
    children,
    showBackButton = true,
    showBorderShadow = true,
    vscode,
}: {
    title?: string;
    children?: React.ReactNode;
    showBackButton?: boolean;
    showBorderShadow?: boolean;
    vscode?: {
        postMessage: (message: any) => void;
    };
}) => (
    <Card
        className={`webview-header sticky top-0 z-10 rounded-none border-0 ${
            showBorderShadow ? "border-b shadow-sm" : ""
        }`}
    >
        <div
            className={`flex items-center justify-start w-full min-h-10 px-4 py-2 gap-2 ${
                showBackButton ? "" : "bg-white"
            }`}
        >
            {showBackButton && vscode && <BackToMenuButton vscode={vscode} />}

            {/* {title && <h2 className="text-sm font-medium uppercase tracking-wide m-0">{title}</h2>} */}

            {children}
        </div>
    </Card>
);
