import React, { useState, useEffect, useRef, useMemo } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "@sharedUtils/shareUtils";

// Helper function to check if an entry is a valid ValidationEntry object
export function isValidValidationEntry(entry: any): entry is ValidationEntry {
    return (
        entry !== null &&
        typeof entry === "object" &&
        typeof entry.username === "string" &&
        typeof entry.creationTimestamp === "number" &&
        typeof entry.updatedTimestamp === "number" &&
        typeof entry.isDeleted === "boolean"
    );
}

// Static tracking for active popover to ensure only one is shown at a time
const popoverTracker = {
    activePopoverId: null as string | null,
    setActivePopover(id: string | null) {
        this.activePopoverId = id;
    },
    getActivePopover() {
        return this.activePopoverId;
    },
};

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
    const [userCreatedLatestEdit, setUserCreatedLatestEdit] = useState(false);
    const [showPopover, setShowPopover] = useState(false);
    const [isPersistentPopover, setIsPersistentPopover] = useState(false);
    const [popoverPosition, setPopoverPosition] = useState({ top: 0, left: 0 });
    const [validationUsers, setValidationUsers] = useState<ValidationEntry[]>([]);
    const buttonRef = useRef<HTMLDivElement>(null);
    const popoverRef = useRef<HTMLDivElement>(null);
    const uniqueId = useRef(`validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`);

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
                console.log(`Received updated validation count: ${message.content}`);
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
                    }
                }
            } else if (message.type === "configurationChanged") {
                // When configuration changes, refetch the validation count
                console.log("Configuration changed, refetching validation count");
                fetchValidationCount();
            } else if (message.command === "updateValidationCount") {
                setValidationUsers(message.content.validations || []);
                setRequiredValidations(message.content.requiredValidations || 1);
                setIsValidated(message.content.isValidated);
                setUserCreatedLatestEdit(message.content.userCreatedLatestEdit);
            }
        };

        window.addEventListener("message", handleMessage);
        return () => window.removeEventListener("message", handleMessage);
    }, [cellId, username]);

    // Close popover when clicking outside of it
    useEffect(() => {
        const handleOutsideClick = (event: MouseEvent) => {
            if (buttonRef.current && !buttonRef.current.contains(event.target as Node)) {
                setShowPopover(false);
                setIsPersistentPopover(false);
                if (popoverTracker.getActivePopover() === uniqueId.current) {
                    popoverTracker.setActivePopover(null);
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
        if (showPopover && popoverTracker.getActivePopover() !== uniqueId.current) {
            setShowPopover(false);
            setIsPersistentPopover(false);
        }
    }, [showPopover]);

    // Position the popover correctly when it becomes visible
    useEffect(() => {
        if (showPopover && popoverRef.current && buttonRef.current) {
            const buttonRect = buttonRef.current.getBoundingClientRect();
            const popoverRect = popoverRef.current.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            // Determine vertical position (above or below)
            // If button is in the top portion of the screen, place popover below
            // If button is in the bottom portion, place popover above
            let top;
            const spaceAbove = buttonRect.top;
            const spaceBelow = viewportHeight - (buttonRect.top + buttonRect.height);

            if (spaceAbove < popoverRect.height + 10 || spaceAbove < spaceBelow) {
                // Not enough space above or more space below - position below the button
                top = buttonRect.height + 5;
            } else {
                // More space above - position above the button
                top = -popoverRect.height - 5;
            }

            // Always position to the right of the button
            let left = buttonRect.width + 5;

            // If positioning to the right would put it off the screen, try to position it so it's still visible
            if (buttonRect.left + left + popoverRect.width > viewportWidth - 5) {
                // Calculate how far off screen it would go
                const overflowAmount =
                    buttonRect.left + left + popoverRect.width - (viewportWidth - 5);

                // Try to shift it left just enough to keep it on screen
                if (left - overflowAmount > 0) {
                    // We can shift it left and still keep it to the right of the button
                    left -= overflowAmount;
                } else {
                    // As a last resort, position it to the left of the button, but ensure it's fully visible
                    left = -popoverRect.width - 5;

                    // Make sure it doesn't go off the left edge of the screen
                    if (buttonRect.left + left < 5) {
                        left = -buttonRect.left + 5;
                    }
                }
            }

            popoverRef.current.style.top = `${top}px`;
            popoverRef.current.style.left = `${left}px`;
        }
    }, [showPopover]);

    const handleValidate = (e: React.MouseEvent) => {
        e.stopPropagation();

        // If the user has already validated, this click will unvalidate
        vscode.postMessage({
            command: "validateCell",
            content: {
                cellId,
                validate: !isValidated,
            },
        });

        // Optimistically update the UI
        setIsValidated(!isValidated);

        // Close popover after action
        setShowPopover(false);
        setIsPersistentPopover(false);
        popoverTracker.setActivePopover(null);
    };

    const handleButtonClick = (e: React.MouseEvent) => {
        e.stopPropagation();

        // If not validated yet, just validate without showing popover
        if (!isValidated) {
            handleValidate(e);
            return;
        }

        // Only show popover if already validated and there are users to display
        if (uniqueValidationUsers.length > 0) {
            setShowPopover(true);
            setIsPersistentPopover(true);
            popoverTracker.setActivePopover(uniqueId.current);
        }
    };

    const showPopoverHandler = (e: React.MouseEvent) => {
        e.stopPropagation();

        // Only show popover if there are users to display
        if (!showPopover && uniqueValidationUsers.length > 0) {
            const buttonRect = buttonRef.current?.getBoundingClientRect();
            if (buttonRect) {
                // Get viewport dimensions
                const viewportWidth = window.innerWidth;

                // Calculate available space on the right of the button
                const spaceOnRight = viewportWidth - (buttonRect.left + buttonRect.width);

                // Default position: to the right of the button
                let left = buttonRect.width + 5; // 5px margin
                const top = 0;

                // Check if there's not enough space on the right
                if (spaceOnRight < 250) {
                    // 250px is max-width of popover
                    // Place popover to the left of the button
                    left = -250 - 5; // 5px margin
                }

                setPopoverPosition({ top, left });
                setShowPopover(true);
                popoverTracker.setActivePopover(uniqueId.current);
            }
        }
    };

    const hidePopoverHandler = (e?: React.MouseEvent) => {
        if (e) e.stopPropagation();

        if (!isPersistentPopover) {
            setShowPopover(false);
            if (popoverTracker.getActivePopover() === uniqueId.current) {
                popoverTracker.setActivePopover(null);
            }
        }
    };

    const closePopover = (e: React.MouseEvent) => {
        e.stopPropagation();
        setShowPopover(false);
        setIsPersistentPopover(false);
        if (popoverTracker.getActivePopover() === uniqueId.current) {
            popoverTracker.setActivePopover(null);
        }
    };

    // Don't show validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    const isFullyValidated = currentValidations >= requiredValidations;

    const buttonStyle = {
        height: "16px",
        width: "16px",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    };

    return (
        <div
            ref={buttonRef}
            className="validation-button-container"
            onMouseOver={showPopoverHandler}
            onMouseOut={hidePopoverHandler}
            onClick={handleButtonClick}
            style={{ position: "relative", display: "inline-block" }}
        >
            <VSCodeButton
                appearance="icon"
                style={buttonStyle}
                onClick={handleValidate}
                disabled={isSourceText || userCreatedLatestEdit}
            >
                <i
                    className={`codicon ${
                        isFullyValidated
                            ? "codicon-check"
                            : isValidated
                            ? "codicon-pass"
                            : "codicon-circle-outline"
                    }`}
                    style={{
                        fontSize: "12px",
                        color: isValidated
                            ? isFullyValidated
                                ? "var(--vscode-testing-iconPassed)"
                                : "var(--vscode-charts-yellow)"
                            : "var(--vscode-descriptionForeground)",
                    }}
                ></i>
            </VSCodeButton>

            {/* Popover for validation users */}
            {showPopover && uniqueValidationUsers.length > 0 && (
                <div
                    ref={popoverRef}
                    className="validation-popover"
                    style={{
                        position: "absolute",
                        top: popoverPosition.top,
                        left: popoverPosition.left,
                        width: "max-content",
                        maxWidth: "250px",
                        backgroundColor: "var(--vscode-editor-background)",
                        border: "1px solid var(--vscode-editorWidget-border)",
                        borderRadius: "4px",
                        padding: "8px",
                        zIndex: 1000,
                        boxShadow: "0 2px 8px rgba(0, 0, 0, 0.15)",
                        fontSize: "12px",
                        color: "var(--vscode-foreground)",
                        display: "flex",
                        flexDirection: "column",
                        gap: "4px",
                    }}
                >
                    {isPersistentPopover && (
                        <div
                            style={{
                                display: "flex",
                                justifyContent: "space-between",
                                alignItems: "center",
                                marginBottom: "6px",
                                borderBottom: "1px solid var(--vscode-editorWidget-border)",
                                paddingBottom: "6px",
                            }}
                        >
                            <span style={{ fontWeight: "bold" }}>Validators</span>
                            <i
                                className="codicon codicon-close"
                                style={{
                                    cursor: "pointer",
                                    fontSize: "12px",
                                    padding: "4px",
                                    borderRadius: "3px",
                                    transition: "background-color 0.2s ease",
                                }}
                                onClick={closePopover}
                                title="Close"
                            />
                        </div>
                    )}
                    <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center" }}>
                        {uniqueValidationUsers.map((user, index) => (
                            <React.Fragment key={user.username}>
                                <span
                                    style={{
                                        color: "var(--vscode-foreground)",
                                        display: "inline-flex",
                                        alignItems: "center",
                                        whiteSpace: "nowrap",
                                        padding: "2px 4px",
                                        backgroundColor:
                                            user.username === username
                                                ? "rgba(255, 255, 255, 0.05)"
                                                : "transparent",
                                        borderRadius: "3px",
                                        position: "relative",
                                        transition: "all 0.3s ease",
                                        cursor: user.username === username ? "pointer" : "default",
                                    }}
                                    onMouseEnter={() => {
                                        if (user.username === username) {
                                            const trashIcon = document.getElementById(
                                                `trash-icon-${user.username}`
                                            );
                                            if (trashIcon) {
                                                trashIcon.style.display = "inline";
                                                trashIcon.style.animation =
                                                    "fadeIn 0.2s ease-in-out";
                                            }

                                            const usernameElement = document.getElementById(
                                                `username-${user.username}`
                                            );
                                            if (usernameElement) {
                                                usernameElement.style.opacity = "0.5";
                                            }
                                        }
                                    }}
                                    onMouseLeave={() => {
                                        if (user.username === username) {
                                            const trashIcon = document.getElementById(
                                                `trash-icon-${user.username}`
                                            );
                                            if (trashIcon) {
                                                trashIcon.style.display = "none";
                                            }

                                            const usernameElement = document.getElementById(
                                                `username-${user.username}`
                                            );
                                            if (usernameElement) {
                                                usernameElement.style.opacity = "1";
                                            }
                                        }
                                    }}
                                >
                                    <span id={`username-${user.username}`}>{user.username}</span>
                                    {user.username === username && (
                                        <span
                                            id={`trash-icon-${user.username}`}
                                            style={{
                                                display: "none",
                                                position: "absolute",
                                                left: "50%",
                                                transform: "translateX(-50%)",
                                                cursor: "pointer",
                                                transition: "all 0.2s ease",
                                                zIndex: 10,
                                                backgroundColor: "rgba(255, 255, 255, 0.1)",
                                                borderRadius: "50%",
                                                padding: "3px",
                                                boxShadow: "0 0 3px rgba(0, 0, 0, 0.2)",
                                            }}
                                            onClick={handleValidate}
                                            title="Remove your validation"
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
                                </span>
                                {index < uniqueValidationUsers.length - 1 && (
                                    <span
                                        style={{
                                            padding: "0 2px",
                                            color: "var(--vscode-descriptionForeground)",
                                            display: "inline-flex",
                                            alignItems: "center",
                                            cursor: "default",
                                        }}
                                    >
                                        •
                                    </span>
                                )}
                            </React.Fragment>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};

export default ValidationButton;
