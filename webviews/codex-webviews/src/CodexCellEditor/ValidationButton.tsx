import React, { useState, useEffect, useRef } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "@sharedUtils";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import {
    isValidValidationEntry,
    textPopoverTracker,
} from "./validationUtils";
import { useTextValidationStatus } from "./hooks/useTextValidationStatus";
import AudioValidatorsPopover from "./components/AudioValidatorsPopover";
import ValidationStatusIcon from "./AudioValidationStatusIcon";

interface ValidationButtonProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredValidations?: number;
    disabled?: boolean;
    disabledReason?: string;
}

const ValidationButton: React.FC<ValidationButtonProps> = ({
    cellId,
    cell,
    vscode,
    isSourceText,
    currentUsername,
    requiredValidations: requiredValidationsProp,
    disabled: externallyDisabled,
    disabledReason,
}) => {
    const [isValidated, setIsValidated] = useState(false);
    const [username, setUsername] = useState<string | null>(currentUsername ?? null);
    const [requiredValidations, setRequiredValidations] = useState(requiredValidationsProp ?? 1);
    const [userCreatedLatestEdit, setUserCreatedLatestEdit] = useState(false);
    const [showPopover, setShowPopover] = useState(false);
    const [isPersistentPopover, setIsPersistentPopover] = useState(false);
    const [validationUsers, setValidationUsers] = useState<ValidationEntry[]>([]);
    const [isDetailedView, setIsDetailedView] = useState(false);
    const [isPendingValidation, setIsPendingValidation] = useState(false);
    const [isValidationInProgress, setIsValidationInProgress] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const uniqueId = useRef(`validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`);
    const closeTimerRef = useRef<number | null>(null);
    const clearCloseTimer = () => {
        if (closeTimerRef.current != null) {
            clearTimeout(closeTimerRef.current);
            closeTimerRef.current = null;
        }
    };
    const scheduleCloseTimer = (callback: () => void, delay = 100) => {
        clearCloseTimer();
        closeTimerRef.current = window.setTimeout(callback, delay);
    };

    const {
        validators: uniqueValidationUsers,
        currentValidations,
        isValidatedByCurrentUser,
    } = useTextValidationStatus({
        cell,
        currentUsername: username,
        requiredTextValidations: requiredValidationsProp ?? null,
        isSourceText,
        disabled: Boolean(externallyDisabled) || isSourceText,
    });

    useEffect(() => {
        setIsValidated(Boolean(isValidatedByCurrentUser));
    }, [isValidatedByCurrentUser]);

    // Update validation state when editHistory changes
    useEffect(() => {
        // Validation count is now bundled with initial content, no need to fetch repeatedly

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
                (entry) =>
                    isValidValidationEntry(entry) && entry.username === username && !entry.isDeleted
            );
            setIsValidated(!!userEntry);

            // Get all active validation users
            const activeValidations = cellValueData.validatedBy.filter(
                (entry) => isValidValidationEntry(entry) && !entry.isDeleted
            );
            setValidationUsers(activeValidations);
        }
    }, [cell, username]);

    // Get the current username when component mounts and listen for configuration changes
    useEffect(() => {
        // Username is now bundled with initial content and passed down from parent
        if (currentUsername) {
            setUsername(currentUsername);
        }
        // No need to request username separately - it comes bundled with initial content
    }, [currentUsername]);

    // Update requiredValidations when prop changes
    useEffect(() => {
        if (requiredValidationsProp !== undefined && requiredValidationsProp !== null) {
            setRequiredValidations(requiredValidationsProp);
        }
    }, [requiredValidationsProp]);

    useMessageHandler(
        "validationButton",
        (event: MessageEvent) => {
            const message = event.data;
            if (!currentUsername && message.type === "currentUsername") {
                setUsername(message.content.username);
            } else if (requiredValidationsProp == null && message.type === "validationCount") {
                setRequiredValidations(message.content);

                // The component will re-render with the new requiredValidations value
                // which will recalculate isFullyValidated in the render function
            } else if (message.type === "providerUpdatesValidationState") {
                // Handle validation state updates from the backend
                if (message.content.cellId === cellId) {
                    const validatedBy = message.content.validatedBy || [];
                    if (username) {
                        // Check if the user has an active validation (not deleted)
                        const userEntry = validatedBy.find(
                            (entry: any) =>
                                isValidValidationEntry(entry) &&
                                entry.username === username &&
                                !entry.isDeleted
                        );
                        setIsValidated(!!userEntry);

                        // Update the list of validation users
                        const activeValidations = validatedBy.filter(
                            (entry: any) => isValidValidationEntry(entry) && !entry.isDeleted
                        );
                        setValidationUsers(activeValidations);

                        // Validation is complete, clear pending state
                        setIsPendingValidation(false);
                        setIsValidationInProgress(false);
                    }
                }
            } else if (message.type === "configurationChanged") {
                // Configuration changes now send validationCount directly, no need to refetch
                console.log("Configuration changed - validation count will be sent directly");
            } else if (message.command === "updateValidationCount") {
                setValidationUsers(message.content.validations || []);
                if (requiredValidationsProp == null) {
                    setRequiredValidations(message.content.requiredValidations || 1);
                }
                setIsValidated(message.content.isValidated);
                setUserCreatedLatestEdit(message.content.userCreatedLatestEdit);
            } else if (message.type === "validationInProgress") {
                // Handle validation in progress message
                if (message.content.cellId === cellId) {
                    setIsValidationInProgress(message.content.inProgress);
                    if (!message.content.inProgress) {
                        // If validation is complete, clear pending state as well
                        setIsPendingValidation(false);
                    }
                }
            } else if (message.type === "pendingValidationCleared") {
                // Handle when all pending validations are cleared
                if (message.content.cellIds.includes(cellId)) {
                    setIsPendingValidation(false);
                }
            }
        },
        [cellId, username, currentUsername, requiredValidationsProp]
    );

    // Check if we should close our popover when another becomes active
    useEffect(() => {
        if (showPopover && textPopoverTracker.getActivePopover() !== uniqueId.current) {
            setShowPopover(false);
        }
    }, [showPopover]);

    const handleValidate = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPendingValidation(true);
        // Add to validation queue for sequential processing
        enqueueValidation(cellId, !isValidated)
            .then(() => {})
            .catch((error) => {
                console.error("Validation queue error:", error);
                setIsPendingValidation(false);
            });
        processValidationQueue(vscode).catch((error) => {
            console.error("Validation queue processing error:", error);
            setIsPendingValidation(false);
        });
    };

    const handleButtonClick = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDisabled) return;
        // If not validated yet, validate the cell
        if (!isValidated) {
            handleValidate(e);
            return;
        }
    };

    const showPopoverHandler = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (isDisabled) return;

        clearCloseTimer();
        setShowPopover(true);
        textPopoverTracker.setActivePopover(uniqueId.current);
    };

    const hidePopoverHandler = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (isDisabled) return;

        scheduleCloseTimer(() => {
            setShowPopover(false);
            textPopoverTracker.setActivePopover(null);
        }, 100);
    };

    const closePopover = () => {
        setShowPopover(false);
        textPopoverTracker.setActivePopover(null);
        clearCloseTimer();
    };

    const buttonStyle = {
        height: "16px",
        width: "16px",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    };

    const isDisabled = isSourceText || isValidationInProgress || Boolean(externallyDisabled);

    // Don't show validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    return (
        <div
            ref={buttonRef}
            className="validation-button-container relative inline-block"
            onMouseEnter={showPopoverHandler}
            onMouseLeave={hidePopoverHandler}
            onClick={handleButtonClick}
        >
            <VSCodeButton
                appearance="icon"
                style={{
                    ...buttonStyle,
                    // Add orange border for pending validations - use a consistent orange color
                    ...(isPendingValidation && {
                        border: "2px solid #f5a623", // Consistent orange color for both themes
                        borderRadius: "50%",
                    }),
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleButtonClick(e);
                }}
                // Disable for source text, in-progress, or when externally requested (e.g., no audio/text)
                disabled={isDisabled}
                title={
                    isDisabled ? disabledReason || "Validation requires text and audio" : undefined
                }
            >
                <ValidationStatusIcon
                    isValidationInProgress={isValidationInProgress}
                    isDisabled={isDisabled}
                    currentValidations={currentValidations}
                    requiredValidations={requiredValidations}
                    isValidatedByCurrentUser={isValidated}
                />
            </VSCodeButton>

            {/* Add style for spinner animation */}
            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .validation-button-container .pending {
                    border: 2px solid #f5a623; /* Consistent orange color for both themes */
                    border-radius: 50%;
                }
                `}
            </style>

            {/* Popover for validation users */}
            {showPopover && uniqueValidationUsers.length > 0 && (
                <AudioValidatorsPopover
                    anchorRef={buttonRef as any}
                    show={showPopover}
                    setShow={setShowPopover}
                    validators={uniqueValidationUsers}
                    currentUsername={username}
                    uniqueId={uniqueId.current}
                    onRequestClose={() => closePopover()}
                    cancelCloseTimer={() => {}}
                    scheduleCloseTimer={scheduleCloseTimer}
                    onRemoveSelf={() => {
                        enqueueValidation(cellId, false)
                            .then(() => {})
                            .catch((error) => console.error("Validation queue error:", error));
                        processValidationQueue(vscode).catch((error) =>
                            console.error("Validation queue processing error:", error)
                        );
                    }}
                    title="Validators"
                    popoverTracker={textPopoverTracker}
                />
            )}
        </div>
    );
};

export default ValidationButton;
