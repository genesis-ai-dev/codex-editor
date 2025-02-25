import React, { useState, useEffect } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { EditHistory } from "../../../../types";

interface ValidationButtonProps {
    cellId: string;
    editHistory: EditHistory[];
    vscode: any;
    isSourceText: boolean;
}

const ValidationButton: React.FC<ValidationButtonProps> = ({ 
    cellId, 
    editHistory,
    vscode,
    isSourceText
}) => {
    const [isValidated, setIsValidated] = useState(false);
    const [username, setUsername] = useState<string | null>(null);

    useEffect(() => {
        // Check if there are any edits
        if (!editHistory || editHistory.length === 0) {
            return;
        }

        // Get the latest edit
        const latestEdit = editHistory[editHistory.length - 1];
        
        // Check if the current user has already validated this edit
        if (latestEdit.validatedBy && username) {
            setIsValidated(latestEdit.validatedBy.includes(username));
        }
    }, [editHistory, username]);

    // Get the current username when component mounts
    useEffect(() => {
        // This message will be handled by the extension to return the current username
        vscode.postMessage({
            command: "getCurrentUsername"
        });

        const handleMessage = (event: MessageEvent) => {
            if (event.data.type === "currentUsername") {
                setUsername(event.data.content.username);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [vscode]);

    const handleValidate = (e: React.MouseEvent) => {
        // Stop the event from bubbling up to prevent editor from opening
        e.stopPropagation();
        
        vscode.postMessage({
            command: "validateCell",
            content: {
                cellId,
                validate: !isValidated
            }
        });
        
        // Optimistically update the UI
        setIsValidated(!isValidated);
    };

    // Don't show validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    return (
        <VSCodeButton 
            appearance="icon"
            onClick={handleValidate}
            title={isValidated ? "Remove validation" : "Validate this translation"}
            style={{ 
                padding: "0",
                minWidth: "18px",
                height: "18px",
                background: isValidated ? "var(--vscode-terminal-ansiGreen)" : "transparent",
                border: isValidated ? "none" : "1px solid var(--vscode-descriptionForeground)",
                borderRadius: "4px",
                transition: "all 0.2s ease",
                opacity: isValidated ? 1 : 0.6,
                transform: isValidated ? "scale(1)" : "scale(0.95)"
            }}
        >
            <i 
                className="codicon codicon-check" 
                style={{ 
                    color: isValidated ? "var(--vscode-editor-background)" : "var(--vscode-descriptionForeground)",
                    fontSize: "14px",
                    transform: isValidated ? "scale(0.8)" : "scale(0.7)",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center"
                }}
            />
        </VSCodeButton>
    );
};

export default ValidationButton; 