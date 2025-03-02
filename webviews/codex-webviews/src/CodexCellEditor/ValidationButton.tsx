import React, { useState, useEffect } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "./utils/shareUtils";

// Helper function to check if an entry is a valid ValidationEntry object
function isValidValidationEntry(entry: any): entry is ValidationEntry {
    return (
        entry !== null &&
        typeof entry === 'object' &&
        typeof entry.username === 'string' &&
        typeof entry.creationTimestamp === 'number' &&
        typeof entry.updatedTimestamp === 'number' &&
        typeof entry.isDeleted === 'boolean'
    );
}

interface ValidationButtonProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
}

const ValidationButton: React.FC<ValidationButtonProps> = ({
    cellId,
    cell,
    vscode,
    isSourceText,
}) => {
    const [isValidated, setIsValidated] = useState(false);
    const [username, setUsername] = useState<string | null>(null);
    const [requiredValidations, setRequiredValidations] = useState(1);
    const [currentValidations, setCurrentValidations] = useState(0);
    const [userCreatedLatestEdit, setUserCreatedLatestEdit] = useState(false);
    // Function to fetch validation count
    const fetchValidationCount = () => {
        vscode.postMessage({
            command: "getValidationCount",
        });
    };

    // Update validation state when editHistory changes
    useEffect(() => {
        fetchValidationCount();

        // Check if there are any edits
        if (!cell.editHistory || cell.editHistory.length === 0) {
            return;
        }

        // Get the latest edit
        const cellValueData = getCellValueData(cell);
        setUserCreatedLatestEdit(
            cellValueData.author === username && cellValueData.editType === "user-edit"
        );

        // Check if the current user has already validated this edit
        if (cellValueData.validatedBy && username) {
            // Look for the user's entry in validatedBy and check if isDeleted is false
            const userEntry = cellValueData.validatedBy.find(
                entry => isValidValidationEntry(entry) && entry.username === username && !entry.isDeleted
            );
            setIsValidated(!!userEntry);
        }

        // Set the current number of validations, counting only non-deleted entries
        if (cellValueData.validatedBy) {
            const activeValidations = cellValueData.validatedBy.filter(
                entry => isValidValidationEntry(entry) && !entry.isDeleted
            ).length;
            setCurrentValidations(activeValidations);
        }
    }, [cell.editHistory, username]);

    // Get the current username when component mounts and listen for configuration changes
    useEffect(() => {
        vscode.postMessage({
            command: "getCurrentUsername",
        });

        const handleMessage = (event: MessageEvent) => {
            const message = event.data;
            if (message.type === "currentUsername") {
                setUsername(message.content.username);
            } else if (message.type === "validationCount") {
                setRequiredValidations(message.content);
            } else if (message.type === "providerUpdatesValidationState") {
                // Handle validation state updates from the backend
                if (message.content.cellId === cellId) {
                    const validatedBy = message.content.validatedBy || [];
                    if (username) {
                        // Check if the user has an active validation (not deleted)
                        const userEntry = validatedBy.find(
                            (entry: any) => isValidValidationEntry(entry) && entry.username === username && !entry.isDeleted
                        );
                        setIsValidated(!!userEntry);
                    }
                    // Count active validations (where isDeleted is false)
                    const activeValidations = validatedBy.filter(
                        (entry: any) => isValidValidationEntry(entry) && !entry.isDeleted
                    ).length;
                    setCurrentValidations(activeValidations);
                }
            } else if (message.type === "configurationChanged") {
                // When configuration changes, refetch the validation count
                fetchValidationCount();
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [cellId, username]);

    const handleValidate = (e: React.MouseEvent) => {
        // Stop the event from bubbling up to prevent editor from opening
        e.stopPropagation();

        vscode.postMessage({
            command: "validateCell",
            content: {
                cellId,
                validate: !isValidated,
            },
        });

        // Optimistically update the UI
        setIsValidated(!isValidated);
        setCurrentValidations((prev) => (!isValidated ? prev + 1 : prev - 1));
    };

    // Don't show validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    const isFullyValidated = currentValidations >= requiredValidations;

    return (
        <VSCodeButton
            appearance="icon"
            onClick={handleValidate}
            // Allow users to validate their own edits
            title={isValidated ? "Remove validation" : "Validate this translation"}
            style={{
                padding: "0",
                minWidth: "18px",
                height: "18px",
                backgroundColor: isValidated ? "var(--vscode-button-background)" : "transparent",
                border: "none",
                borderRadius: "4px",
                transition: "all 0.2s ease",
                opacity: isValidated ? 1 : 0.6,
                transform: isValidated ? "scale(1)" : "scale(0.95)",
            }}
        >
            <i
                className={`codicon ${isFullyValidated ? "codicon-check-all" : "codicon-check"}`}
                style={{
                    color: isValidated
                        ? "var(--vscode-editor-background)"
                        : "var(--vscode-descriptionForeground)",
                    fontSize: "14px",
                    transform: isValidated ? "scale(0.8)" : "scale(0.7)",
                    transition: "all 0.2s ease",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "center",
                }}
            />
        </VSCodeButton>
    );
};

export default ValidationButton;
