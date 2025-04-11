import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom";

interface TooltipPortalProps {
    content: React.ReactNode;
    isVisible: boolean;
    position: {
        x: number;
        y: number;
    };
}

const TooltipPortal: React.FC<TooltipPortalProps> = ({ content, isVisible, position }) => {
    const [portalRoot, setPortalRoot] = useState<HTMLElement | null>(null);

    useEffect(() => {
        // Check if the portal root already exists
        let root = document.getElementById("tooltip-portal-root");

        // If not, create it
        if (!root) {
            root = document.createElement("div");
            root.id = "tooltip-portal-root";
            root.style.position = "fixed";
            root.style.top = "0";
            root.style.left = "0";
            root.style.width = "0";
            root.style.height = "0";
            root.style.overflow = "visible";
            root.style.zIndex = "9999999";
            document.body.appendChild(root);
        }

        setPortalRoot(root);

        // Cleanup
        return () => {
            // We don't remove the root element on unmount because other tooltips might use it
        };
    }, []);

    if (!portalRoot || !isVisible) return null;

    return ReactDOM.createPortal(
        <div
            className="footnote-tooltip-portal"
            style={{
                position: "fixed",
                left: `${position.x}px`,
                top: `${position.y}px`,
                transform: "translate(-50%, -100%)",
                background: "var(--vscode-editor-background)",
                border: "1px solid var(--vscode-focusBorder)",
                padding: "8px 12px",
                borderRadius: "4px",
                minWidth: "200px",
                maxWidth: "300px",
                boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                whiteSpace: "normal",
                fontWeight: "normal",
                fontSize: "1em",
                marginBottom: "8px",
                zIndex: 9999999,
                pointerEvents: "none",
            }}
        >
            {content}
        </div>,
        portalRoot
    );
};

export default TooltipPortal;
