import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent } from "../../../../types";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import { textPopoverTracker } from "./validationUtils";
import { useTextValidationStatus } from "./hooks/useTextValidationStatus";
import ValidatorPopover from "./components/ValidatorPopover";
import ValidationStatusIcon from "./AudioValidationStatusIcon";

interface ValidationButtonProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredValidations?: number;
    setShowSparkleButton?: Dispatch<SetStateAction<boolean>>;
    disabled?: boolean;
    disabledReason?: string;
    health?: number; // Health score (0-1) for radial progress when unverified
    showHealthIndicators?: boolean; // Whether to show health indicators
}

/**
 * ValidationButton - Provider is the source of truth
 *
 * This component relies entirely on:
 * 1. The `cell` prop (updated by provider)
 * 2. The `useTextValidationStatus` hook (derives state from `cell`)
 * 3. Provider messages for validation progress
 *
 * Local state is only used for UI-specific concerns (popover, keyboard focus, pending state).
 */
const ValidationButton: React.FC<ValidationButtonProps> = ({
    cellId,
    cell,
    vscode,
    isSourceText,
    currentUsername,
    requiredValidations: requiredValidationsProp,
    setShowSparkleButton,
    disabled: externallyDisabled,
    disabledReason,
    health,
    showHealthIndicators = false,
}) => {
    // UI-specific local state only
    const [showPopover, setShowPopover] = useState(false);
    const [isPendingValidation, setIsPendingValidation] = useState(false);
    const [isKeyboardFocused, setIsKeyboardFocused] = useState(false);

    const buttonRef = useRef<HTMLDivElement>(null);
    const uniqueId = useRef(`validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`);
    const closeTimerRef = useRef<number | null>(null);
    const ignoreHoverRef = useRef(false);
    const wasKeyboardNavigationRef = useRef(false);

    // Use currentUsername prop directly - no local state duplication
    const username = currentUsername ?? null;

    // Provider-derived state via hook - this is the source of truth
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

    // Debug logging for health and validation state
    useEffect(() => {
        console.log("[ValidationButton] State update:", {
            cellId,
            healthProp: health,
            healthFromCell: cell.metadata?.health,
            healthMatch: health === cell.metadata?.health,
            currentValidations,
            isValidatedByCurrentUser,
            validatorsCount: uniqueValidationUsers.length,
            showHealthIndicators,
        });
    }, [
        cellId,
        health,
        cell.metadata?.health,
        currentValidations,
        isValidatedByCurrentUser,
        uniqueValidationUsers.length,
        showHealthIndicators,
    ]);

    // Use prop directly with fallback - no local state needed
    const requiredValidations = requiredValidationsProp ?? 1;

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

    // Listen for provider messages to clear pending state
    useMessageHandler(
        `validationButton-${cellId}-${uniqueId.current}`,
        (event: MessageEvent) => {
            const message = event.data;

            if (message.type === "providerUpdatesValidationState") {
                // Provider has confirmed the validation state - clear pending
                if (message.content.cellId === cellId) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "validationInProgress") {
                // Backend is processing - keep pending state
                if (message.content.cellId === cellId && !message.content.inProgress) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "pendingValidationCleared") {
                if (message.content.cellIds.includes(cellId)) {
                    setIsPendingValidation(false);
                }
            }
        },
        [cellId]
    );

    // Close popover when another becomes active
    useEffect(() => {
        if (showPopover && textPopoverTracker.getActivePopover() !== uniqueId.current) {
            setShowPopover(false);
        }
    }, [showPopover]);

    // Track keyboard navigation for accessibility
    useEffect(() => {
        const handleDocumentKeyDown = (e: KeyboardEvent) => {
            if (e.key === "Tab" || e.key.startsWith("Arrow") || e.key === "Enter") {
                wasKeyboardNavigationRef.current = true;
            }
        };

        const handleDocumentMouseDown = () => {
            wasKeyboardNavigationRef.current = false;
        };

        document.addEventListener("keydown", handleDocumentKeyDown);
        document.addEventListener("mousedown", handleDocumentMouseDown);
        return () => {
            document.removeEventListener("keydown", handleDocumentKeyDown);
            document.removeEventListener("mousedown", handleDocumentMouseDown);
        };
    }, []);

    const handleValidate = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPendingValidation(true);

        // Send to provider - it will update the cell, which will update the hook
        enqueueValidation(cellId, !isValidatedByCurrentUser)
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

        ignoreHoverRef.current = true;
        window.setTimeout(() => {
            ignoreHoverRef.current = false;
        }, 200);

        wasKeyboardNavigationRef.current = false;
        setIsKeyboardFocused(false);

        window.setTimeout(() => {
            if (buttonRef.current) {
                const buttonElement = buttonRef.current.querySelector(
                    "button"
                ) as HTMLButtonElement;
                if (buttonElement) {
                    buttonElement.blur();
                }
            }
        }, 0);

        if (!isValidatedByCurrentUser) {
            handleValidate(e);
            closePopover();
        }
    };

    const showPopoverHandler = (e: React.MouseEvent) => {
        e.stopPropagation();
        e.preventDefault();

        if (isDisabled) return;
        if (ignoreHoverRef.current) return;

        clearCloseTimer();
        setShowPopover(true);
        textPopoverTracker.setActivePopover(uniqueId.current);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        wasKeyboardNavigationRef.current = true;

        if (e.key === "Enter") {
            e.preventDefault();
            showPopoverHandler(e as unknown as React.MouseEvent);
            handleButtonClick(e as unknown as React.MouseEvent);
        }

        if (e.key === "Escape") {
            e.preventDefault();
            hidePopoverHandler(e as unknown as React.MouseEvent);
        }
    };

    const handleFocus = () => {
        if (wasKeyboardNavigationRef.current) {
            setIsKeyboardFocused(true);
        }
    };

    const handleBlur = () => {
        setIsKeyboardFocused(false);
        wasKeyboardNavigationRef.current = false;
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
        if (setShowSparkleButton) {
            setShowSparkleButton(false);
        }

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

    // Show as in-progress when pending (waiting for provider response)
    const isValidationInProgress = isPendingValidation;
    const isDisabled = isSourceText || isValidationInProgress || Boolean(externallyDisabled);

    // Don't show validation button for source text or if no username is available
    if (isSourceText || !username) {
        return null;
    }

    return (
        <div
            ref={buttonRef}
            className={`validation-button-container relative inline-block ${
                isKeyboardFocused ? "keyboard-focused" : ""
            }`}
            onMouseEnter={showPopoverHandler}
            onMouseLeave={hidePopoverHandler}
        >
            <VSCodeButton
                appearance="icon"
                style={{
                    ...buttonStyle,
                    // Add orange border for pending validations
                    ...(isPendingValidation && {
                        border: "2px solid #f5a623",
                        borderRadius: "50%",
                    }),
                }}
                onClick={handleButtonClick}
                onKeyDown={handleKeyDown}
                onFocus={handleFocus}
                onBlur={handleBlur}
                disabled={isDisabled}
                title={
                    isPendingValidation
                        ? "Validating..."
                        : isDisabled
                        ? disabledReason || "Validation requires text and audio"
                        : undefined
                }
            >
                <ValidationStatusIcon
                    key={`${cellId}-${health}-${currentValidations}`}
                    isValidationInProgress={isValidationInProgress}
                    isDisabled={isDisabled}
                    currentValidations={currentValidations}
                    requiredValidations={requiredValidations}
                    isValidatedByCurrentUser={isValidatedByCurrentUser}
                    health={health}
                    showHealthRadial={showHealthIndicators}
                    isPendingValidation={isPendingValidation}
                />
            </VSCodeButton>

            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .validation-button-container .pending {
                    border: 2px solid #f5a623;
                    border-radius: 50%;
                }
                `}
            </style>

            {/* Popover for validation users OR health status - uses hook data directly */}
            {showPopover && (
                <ValidatorPopover
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
                        setIsPendingValidation(true);
                        enqueueValidation(cellId, false)
                            .then(() => {})
                            .catch((error) => {
                                console.error("Validation queue error:", error);
                                setIsPendingValidation(false);
                            });
                        processValidationQueue(vscode).catch((error) => {
                            console.error("Validation queue processing error:", error);
                            setIsPendingValidation(false);
                        });
                        closePopover();
                    }}
                    title="Validators"
                    popoverTracker={textPopoverTracker}
                    health={currentValidations > 0 ? 1.0 : health}
                    showHealthWhenNoValidators={showHealthIndicators}
                    isPendingValidation={isPendingValidation}
                    currentValidations={currentValidations}
                />
            )}
        </div>
    );
};

export default ValidationButton;
