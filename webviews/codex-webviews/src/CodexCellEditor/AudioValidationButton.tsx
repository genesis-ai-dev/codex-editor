import React, { useState, useEffect, useRef, useMemo } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "@sharedUtils";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import { isValidValidationEntry } from "./validationUtils";

// Static tracking for active popover to ensure only one is shown at a time
const audioPopoverTracker = {
    activePopoverId: null as string | null,
    setActivePopover(id: string | null) {
        this.activePopoverId = id;
    },
    getActivePopover() {
        return this.activePopoverId;
    },
};

interface AudioValidationButtonProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredAudioValidations?: number;
    // When true, the button is disabled (e.g., missing audio)
    disabled?: boolean;
    // Optional tooltip to explain why disabled
    disabledReason?: string;
}

const AudioValidationButton: React.FC<AudioValidationButtonProps> = ({
    cellId,
    cell,
    vscode,
    isSourceText,
    currentUsername,
    requiredAudioValidations: requiredAudioValidationsProp,
    disabled: externallyDisabled,
    disabledReason,
}) => {
    const [isValidated, setIsValidated] = useState(false);
    const [username, setUsername] = useState<string | null>(currentUsername ?? null);
    const [requiredAudioValidations, setRequiredAudioValidations] = useState(
        requiredAudioValidationsProp ?? 1
    );
    const [userCreatedLatestEdit, setUserCreatedLatestEdit] = useState(false);
    const [showPopover, setShowPopover] = useState(false);
    const [isPersistentPopover, setIsPersistentPopover] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const [validationUsers, setValidationUsers] = useState<ValidationEntry[]>([]);
    const [isDetailedView, setIsDetailedView] = useState(false);
    const [isPendingValidation, setIsPendingValidation] = useState(false);
    const [isValidationInProgress, setIsValidationInProgress] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const uniqueId = useRef(
        `audio-validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`
    );

    // Create a deduplicated list of validation users
    const uniqueValidationUsers = useMemo(() => {
        // Use a Map with username as key to ensure only the latest entry per user is kept
        const uniqueUsers = new Map();

        // Process all validation entries, keeping only the most recent entry per username
        validationUsers.forEach((user) => {
            const existing = uniqueUsers.get(user.username);
            // Only replace if this entry is newer or if no entry exists
            if (
                !existing ||
                new Date(user.updatedTimestamp) > new Date(existing.updatedTimestamp)
            ) {
                uniqueUsers.set(user.username, user);
            }
        });

        // Convert the Map values back to an array
        return Array.from(uniqueUsers.values());
    }, [validationUsers]);

    // Also update how we calculate currentValidations to use the deduplicated list
    const currentValidations = useMemo(() => {
        return uniqueValidationUsers.length;
    }, [uniqueValidationUsers]);

    // Function to fetch audio validation count
    const fetchAudioValidationCount = () => {
        // Only fetch if parent hasn't provided it
        if (requiredAudioValidationsProp == null) {
            vscode.postMessage({
                command: "getAudioValidationCount",
            });
        }
    };

    // Update validation state when editHistory changes
    useEffect(() => {
        // Check if there are any edits
        if (!cell.editHistory || cell.editHistory.length === 0) {
            return;
        }

        // Get the latest edit
        const cellValueData = getCellValueData(cell);
        setUserCreatedLatestEdit(
            cellValueData.author === username && cellValueData.editType === "user-edit"
        );

        // Check if the current user has already validated this edit for audio
        if (cellValueData.audioValidatedBy && username) {
            // Look for the user's entry in audioValidatedBy and check if isDeleted is false
            const userEntry = cellValueData.audioValidatedBy.find(
                (entry: ValidationEntry) =>
                    isValidValidationEntry(entry) && entry.username === username && !entry.isDeleted
            );
            setIsValidated(!!userEntry);

            // Get all active audio validation users
            const activeValidations = cellValueData.audioValidatedBy.filter(
                (entry: ValidationEntry) => isValidValidationEntry(entry) && !entry.isDeleted
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
    }, [currentUsername]);

    useMessageHandler(
        "audioValidationButton",
        (event: MessageEvent) => {
            const message = event.data;
            if (!currentUsername && message.type === "currentUsername") {
                setUsername(message.content.username);
            } else if (
                requiredAudioValidationsProp == null &&
                message.type === "audioValidationCount"
            ) {
                setRequiredAudioValidations(message.content);

                // The component will re-render with the new requiredAudioValidations value
                // which will recalculate isFullyValidated in the render function
            } else if (message.type === "providerUpdatesAudioValidationState") {
                // Handle audio validation state updates from the backend
                if (message.content.cellId === cellId) {
                    const audioValidatedBy = message.content.audioValidatedBy || [];
                    if (username) {
                        // Check if the user has an active audio validation (not deleted)
                        const userEntry = audioValidatedBy.find(
                            (entry: any) =>
                                isValidValidationEntry(entry) &&
                                entry.username === username &&
                                !entry.isDeleted
                        );
                        setIsValidated(!!userEntry);

                        // Update the list of audio validation users
                        const activeValidations = audioValidatedBy.filter(
                            (entry: any) => isValidValidationEntry(entry) && !entry.isDeleted
                        );
                        setValidationUsers(activeValidations);

                        // Validation is complete, clear pending state
                        setIsPendingValidation(false);
                        setIsValidationInProgress(false);
                    }
                }
            } else if (message.type === "configurationChanged") {
                // Configuration changes now send audioValidationCount directly, no need to refetch
                console.log("Configuration changed - audio validation count will be sent directly");
            } else if (message.command === "updateAudioValidationCount") {
                setValidationUsers(message.content.validations || []);
                if (requiredAudioValidationsProp == null) {
                    setRequiredAudioValidations(message.content.requiredAudioValidations || 1);
                }
                setIsValidated(message.content.isValidated);
                setUserCreatedLatestEdit(message.content.userCreatedLatestEdit);
            } else if (message.type === "audioValidationInProgress") {
                // Handle audio validation in progress message
                if (message.content.cellId === cellId) {
                    setIsValidationInProgress(message.content.inProgress);
                    if (!message.content.inProgress) {
                        // If validation is complete, clear pending state as well
                        setIsPendingValidation(false);
                    }
                }
            } else if (message.type === "pendingAudioValidationCleared") {
                // Handle when all pending audio validations are cleared
                if (message.content.cellIds.includes(cellId)) {
                    setIsPendingValidation(false);
                }
            }
        },
        [cellId, username, currentUsername, requiredAudioValidationsProp]
    );

    // Close popover when clicking outside of it
    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
                setShowPopover(false);
                setIsPersistentPopover(false);
                setIsDetailedView(false);
                if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                    audioPopoverTracker.setActivePopover(null);
                }
            }
        };

        document.addEventListener("mousedown", handleOutsideClick);
        return () => {
            document.removeEventListener("mousedown", handleOutsideClick);
        };
    }, []);

    // Check if we should close our popover when another becomes active
    useEffect(() => {
        if (showPopover && audioPopoverTracker.getActivePopover() !== uniqueId.current) {
            setShowPopover(false);
            setIsPersistentPopover(false);
            setIsDetailedView(false);
        }
    }, [showPopover]);

    // Position the popover correctly when it becomes visible
    useEffect(() => {
        if (showPopover && popoverRef.current && buttonRef.current) {
            const buttonRect = buttonRef.current.getBoundingClientRect();
            const popoverRect = popoverRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Calculate available space in each direction
            const spaceAbove = buttonRect.top;
            const spaceBelow = viewportHeight - (buttonRect.top + buttonRect.height);
            const spaceRight = viewportWidth - (buttonRect.left + buttonRect.width);
            const spaceLeft = buttonRect.left;

            // Default position to the right
            let left = buttonRect.width + 5;
            let top = 0;

            // If not enough space on the right, try left
            if (spaceRight < popoverRect.width + 10) {
                left = -popoverRect.width - 5;
            }

            // If not enough space on either side, center horizontally
            if (spaceRight < popoverRect.width + 10 && spaceLeft < popoverRect.width + 10) {
                left = -(popoverRect.width / 2) + buttonRect.width / 2;
            }

            // Vertical positioning
            if (spaceBelow >= popoverRect.height + 10) {
                // Position below
                top = buttonRect.height + 5;
            } else if (spaceAbove >= popoverRect.height + 10) {
                // Position above
                top = -popoverRect.height - 5;
            } else {
                // Center vertically if no good space above or below
                top = -(popoverRect.height / 2) + buttonRect.height / 2;
            }

            // Ensure popover stays within viewport bounds
            const finalLeft = Math.min(
                Math.max(left, -buttonRect.left + 10),
                viewportWidth - buttonRect.left - popoverRect.width - 10
            );

            const finalTop = Math.min(
                Math.max(top, -buttonRect.top + 10),
                viewportHeight - buttonRect.top - popoverRect.height - 10
            );

            // Apply the calculated position with fixed positioning
            popoverRef.current.style.position = "fixed";
            popoverRef.current.style.top = `${buttonRect.top + finalTop}px`;
            popoverRef.current.style.left = `${buttonRect.left + finalLeft}px`;
            popoverRef.current.style.opacity = "1";
            popoverRef.current.style.pointerEvents = "auto";
            popoverRef.current.style.zIndex = "100000";
        }
    }, [showPopover]);

    const handleValidate = (e: React.MouseEvent) => {
        e.stopPropagation();

        // Immediately set pending state
        setIsPendingValidation(true);

        // Add to audio validation queue for sequential processing
        enqueueValidation(cellId, !isValidated, true) // true indicates audio validation
            .then(() => {
                // Validation request has been queued successfully
            })
            .catch((error) => {
                console.error("Audio validation queue error:", error);
                setIsPendingValidation(false);
            });

        // Process the queue
        processValidationQueue(vscode, true).catch((error) => {
            // true indicates audio validation
            console.error("Audio validation queue processing error:", error);
            setIsPendingValidation(false);
        });

        // Don't close popover immediately to allow user to see the change
        setTimeout(() => {
            if (!isPersistentPopover) {
                setShowPopover(false);
                setIsPersistentPopover(false);
                setIsDetailedView(false);
                audioPopoverTracker.setActivePopover(null);
            }
        }, 500);
    };

    const handleButtonClick = (e: React.MouseEvent) => {
        e.stopPropagation();

        if (isDisabled) return;
        // If not validated yet, validate the cell
        if (!isValidated) {
            handleValidate(e);
            return;
        }

        // // For validated cells, toggle the persistent popover with detailed view
        setShowPopover(true);
        setIsPersistentPopover(true);
        setIsDetailedView(true);
        audioPopoverTracker.setActivePopover(uniqueId.current);
    };

    const showPopoverHandler = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();
        if (isDisabled) return;
        // Don't show on hover if already showing in persistent mode
        if (isPersistentPopover) return;

        // Only show popover if there are users to display
        if (!showPopover && uniqueValidationUsers.length > 0) {
            setShowPopover(true);
            setIsDetailedView(false); // Simple view on hover
            audioPopoverTracker.setActivePopover(uniqueId.current);
        }
    };

    const hidePopoverHandler = (e?: React.MouseEvent) => {
        if (e) {
            e.stopPropagation();
            e.preventDefault();
        }

        // Don't hide if in persistent mode
        if (!isPersistentPopover) {
            // Add a small delay before hiding to prevent flickering
            setTimeout(() => {
                // Check if the mouse is still outside before hiding
                if (!buttonRef.current?.matches(":hover")) {
                    setShowPopover(false);
                    setIsDetailedView(false);
                    if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                        audioPopoverTracker.setActivePopover(null);
                    }
                }
            }, 100);
        }
    };

    const closePopover = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPopover(false);
        setIsPersistentPopover(false);
        setIsDetailedView(false);
        if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
            audioPopoverTracker.setActivePopover(null);
        }
    };

    const isFullyValidated = currentValidations >= requiredAudioValidations;

    const buttonStyle = {
        height: "16px",
        width: "16px",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    };

    // Helper function to format timestamps
    const formatTimestamp = (timestamp: number): string => {
        if (!timestamp) return "";

        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffSecs = Math.floor(diffMs / 1000);
        const diffMins = Math.floor(diffSecs / 60);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        // For recent validations (less than a day)
        if (diffDays < 1) {
            if (diffHours < 1) {
                if (diffMins < 1) {
                    return "just now";
                }
                return `${diffMins}m ago`;
            }
            return `${diffHours}h ago`;
        }

        // For older validations
        if (diffDays < 7) {
            return `${diffDays}d ago`;
        }

        // Format date if more than a week ago
        return date.toLocaleDateString();
    };

    const isDisabled = isSourceText || isValidationInProgress || Boolean(externallyDisabled);

    // Don't show audio validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    return (
        <div
            ref={buttonRef}
            className="audio-validation-button-container"
            onMouseEnter={showPopoverHandler}
            onMouseLeave={hidePopoverHandler}
            onClick={handleButtonClick}
            style={{ position: "relative", display: "inline-block", zIndex: 999 }}
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
                // Disable for source text, in-progress, or when externally requested (e.g., no audio)
                disabled={isDisabled}
                title={isDisabled ? disabledReason || "Audio validation requires audio" : undefined}
            >
                {/* Show spinner when validation is in progress */}
                {isValidationInProgress ? (
                    <i
                        className="codicon codicon-loading"
                        style={{
                            fontSize: "12px",
                            color: isDisabled
                                ? "var(--vscode-disabledForeground)"
                                : "var(--vscode-descriptionForeground)",
                            animation: "spin 1.5s linear infinite",
                        }}
                    ></i>
                ) : currentValidations === 0 ? (
                    // Empty circle - No validations
                    <i
                        className="codicon codicon-circle-outline"
                        style={{
                            fontSize: "12px",
                            // Keep original color, don't change for pending validation
                            color: isDisabled
                                ? "var(--vscode-disabledForeground)"
                                : "var(--vscode-descriptionForeground)",
                        }}
                    ></i>
                ) : isFullyValidated ? (
                    isValidated ? (
                        // Double green checkmarks - Fully validated and current user has validated
                        <i
                            className="codicon codicon-check-all"
                            style={{
                                fontSize: "12px",
                                // Keep original color, don't change for pending validation
                                color: isDisabled
                                    ? "var(--vscode-disabledForeground)"
                                    : "var(--vscode-testing-iconPassed)",
                            }}
                        ></i>
                    ) : (
                        // Double grey checkmarks - Fully validated but current user hasn't validated
                        <i
                            className="codicon codicon-check-all"
                            style={{
                                fontSize: "12px",
                                // Keep original color, don't change for pending validation
                                color: isDisabled
                                    ? "var(--vscode-disabledForeground)"
                                    : "var(--vscode-descriptionForeground)",
                            }}
                        ></i>
                    )
                ) : isValidated ? (
                    // Green checkmark - Current user validated but not fully validated
                    <i
                        className="codicon codicon-check"
                        style={{
                            fontSize: "12px",
                            // Keep original color, don't change for pending validation
                            color: isDisabled
                                ? "var(--vscode-disabledForeground)"
                                : "var(--vscode-testing-iconPassed)",
                        }}
                    ></i>
                ) : (
                    // Grey filled circle - Has validations but not from current user
                    <i
                        className="codicon codicon-circle-filled"
                        style={{
                            fontSize: "12px",
                            // Keep original color, don't change for pending validation
                            color: isDisabled
                                ? "var(--vscode-disabledForeground)"
                                : "var(--vscode-descriptionForeground)",
                        }}
                    ></i>
                )}
            </VSCodeButton>

            {/* Add style for spinner animation */}
            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .audio-validation-button-container .pending {
                    border: 2px solid #f5a623; /* Consistent orange color for both themes */
                    border-radius: 50%;
                }
                `}
            </style>

            {/* Popover for validation users */}
            {showPopover && uniqueValidationUsers.length > 0 && (
                <div
                    ref={popoverRef}
                    className={`audio-validation-popover ${
                        isDetailedView ? "detailed-view" : "simple-view"
                    }`}
                    style={{
                        position: "fixed",
                        zIndex: 100000,
                        opacity: showPopover ? "1" : "0",
                        transition: "opacity 0.2s ease-in-out",
                        pointerEvents: showPopover ? "auto" : "none",
                        backgroundColor: "var(--vscode-editor-background)",
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                        border: "1px solid var(--vscode-editorWidget-border)",
                    }}
                    onClick={(e) => {
                        e.stopPropagation();
                        if (!isPersistentPopover) {
                            setIsPersistentPopover(true);
                            setIsDetailedView(true);
                        }
                    }}
                    onMouseEnter={(e) => {
                        e.stopPropagation();
                        if (!isPersistentPopover) {
                            setShowPopover(true);
                        }
                    }}
                    onMouseLeave={(e) => {
                        e.stopPropagation();
                        if (!isPersistentPopover) {
                            hidePopoverHandler(e);
                        }
                    }}
                >
                    {isPersistentPopover && (
                        <div
                            style={{
                                position: "absolute",
                                right: "8px",
                                top: "8px",
                                cursor: "pointer",
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                setShowPopover(false);
                                setIsPersistentPopover(false);
                                setIsDetailedView(false);
                                audioPopoverTracker.setActivePopover(null);
                            }}
                        >
                            <i className="codicon codicon-close" />
                        </div>
                    )}

                    {isDetailedView ? (
                        <div style={{ padding: "0 8px" }}>
                            <div
                                style={{
                                    fontWeight: "bold",
                                    marginBottom: "4px",
                                    borderBottom: "1px solid var(--vscode-editorWidget-border)",
                                    paddingBottom: "4px",
                                }}
                            >
                                Audio Validators
                            </div>
                            {uniqueValidationUsers.map((user) => {
                                const isCurrentUser = user.username === username;
                                const canDelete = isCurrentUser && isValidated;
                                const formattedTime = formatTimestamp(user.updatedTimestamp);

                                return (
                                    <div
                                        key={user.username}
                                        style={{
                                            display: "flex",
                                            alignItems: "center",
                                            justifyContent: "space-between",
                                            padding: "3px 0",
                                            position: "relative",
                                        }}
                                    >
                                        <div
                                            style={{
                                                display: "flex",
                                                alignItems: "center",
                                                gap: "8px",
                                                flex: "1",
                                            }}
                                        >
                                            <span
                                                id={`username-${user.username}-${uniqueId.current}`}
                                                style={{
                                                    fontWeight: isCurrentUser ? "600" : "400",
                                                }}
                                            >
                                                {user.username}
                                            </span>
                                            {user.username === username && (
                                                <span
                                                    id={`trash-icon-${user.username}-${uniqueId.current}`}
                                                    onClick={(e) => {
                                                        e.stopPropagation();

                                                        // Add to audio validation queue for sequential processing
                                                        enqueueValidation(cellId, false, true)
                                                            .then(() => {
                                                                // Validation request has been queued successfully
                                                            })
                                                            .catch((error) => {
                                                                console.error(
                                                                    "Audio validation queue error:",
                                                                    error
                                                                );
                                                            });

                                                        // Process the queue
                                                        processValidationQueue(vscode, true).catch(
                                                            (error) => {
                                                                console.error(
                                                                    "Audio validation queue processing error:",
                                                                    error
                                                                );
                                                            }
                                                        );

                                                        // Immediately close the popover
                                                        setShowPopover(false);
                                                        setIsPersistentPopover(false);
                                                        setIsDetailedView(false);
                                                        if (
                                                            audioPopoverTracker.getActivePopover() ===
                                                            uniqueId.current
                                                        ) {
                                                            audioPopoverTracker.setActivePopover(
                                                                null
                                                            );
                                                        }
                                                    }}
                                                    title="Remove your audio validation"
                                                    className="audio-validation-trash-icon"
                                                    style={{
                                                        cursor: "pointer",
                                                        display: "flex",
                                                        alignItems: "center",
                                                        justifyContent: "center",
                                                        padding: "2px",
                                                        borderRadius: "3px",
                                                        transition: "background-color 0.2s",
                                                    }}
                                                >
                                                    <svg
                                                        width="14"
                                                        height="14"
                                                        viewBox="0 0 24 24"
                                                        fill="none"
                                                        xmlns="http://www.w3.org/2000/svg"
                                                    >
                                                        <path
                                                            d="M3 6H5H21"
                                                            stroke="#ff5252"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                        <path
                                                            d="M8 6V4C8 3.46957 8.21071 2.96086 8.58579 2.58579C8.96086 2.21071 9.46957 2 10 2H14C14.5304 2 15.0391 2.21071 15.4142 2.58579C15.7893 2.96086 16 3.46957 16 4V6M19 6V20C19 20.5304 18.7893 21.0391 18.4142 21.4142C18.0391 21.7893 17.5304 22 17 22H7C6.46957 22 5.96086 21.7893 5.58579 21.4142C5.21071 21.0391 5 20.5304 5 20V6H19Z"
                                                            stroke="#ff5252"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                        <path
                                                            d="M10 11V17"
                                                            stroke="#ff5252"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                        <path
                                                            d="M14 11V17"
                                                            stroke="#ff5252"
                                                            strokeWidth="2"
                                                            strokeLinecap="round"
                                                            strokeLinejoin="round"
                                                        />
                                                    </svg>
                                                </span>
                                            )}
                                            <span
                                                style={{
                                                    fontSize: "11px",
                                                    color: "var(--vscode-descriptionForeground)",
                                                    marginLeft: "auto",
                                                }}
                                            >
                                                {formatTimestamp(user.updatedTimestamp)}
                                            </span>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        // Simple view with just usernames separated by dots
                        <div className="audio-validators-simple-view">
                            {uniqueValidationUsers.map((user, index) => (
                                <React.Fragment key={user.username}>
                                    <span
                                        className={user.username === username ? "current-user" : ""}
                                    >
                                        {user.username}
                                    </span>
                                    {index < uniqueValidationUsers.length - 1 && (
                                        <span className="separator">•</span>
                                    )}
                                </React.Fragment>
                            ))}
                            <div className="more-info-hint">
                                <i className="codicon codicon-info"></i>
                            </div>
                        </div>
                    )}

                    {/* Add this CSS to the component */}
                    <style>
                        {`
                        div:hover > .delete-audio-validation-button {
                            opacity: 1 !important;
                        }
                        .audio-validators-simple-view {
                            padding: 4px 8px;
                            display: flex;
                            flex-wrap: wrap;
                            gap: 4px;
                            align-items: center;
                            max-width: 200px;
                        }
                        .audio-validators-simple-view .current-user {
                            font-weight: 600;
                        }
                        .audio-validators-simple-view .separator {
                            color: var(--vscode-descriptionForeground);
                            margin: 0 2px;
                            pointer-events: none;
                            background: none !important;
                            user-select: none;
                        }
                        .audio-validation-trash-icon:hover {
                            background-color: rgba(255, 82, 82, 0.1) !important;
                        }
                        `}
                    </style>
                </div>
            )}
        </div>
    );
};

export default AudioValidationButton;
