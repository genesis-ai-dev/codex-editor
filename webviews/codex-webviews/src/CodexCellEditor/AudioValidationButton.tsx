import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent } from "../../../../types";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import ValidationStatusIcon from "./AudioValidationStatusIcon";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";
import { audioPopoverTracker } from "./validationUtils";
import ValidatorPopover from "./components/ValidatorPopover";

interface AudioValidationButtonProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredAudioValidations?: number;
    disabled?: boolean;
    disabledReason?: string;
    setShowSparkleButton?: Dispatch<SetStateAction<boolean>>;
}

/**
 * AudioValidationButton - Provider is the source of truth
 *
 * This component relies entirely on:
 * 1. The `cell` prop (updated by provider)
 * 2. The `useAudioValidationStatus` hook (derives state from `cell`)
 * 3. Provider messages for validation progress
 *
 * Local state is only used for UI-specific concerns (popover, keyboard focus, pending state).
 */
const AudioValidationButton: React.FC<AudioValidationButtonProps> = ({
    cellId,
    cell,
    vscode,
    isSourceText,
    currentUsername,
    requiredAudioValidations: requiredAudioValidationsProp,
    disabled: externallyDisabled,
    disabledReason,
    setShowSparkleButton,
}) => {
    // UI-specific local state only
    const [showPopover, setShowPopover] = useState(false);
    const [isPendingValidation, setIsPendingValidation] = useState(false);
    const [isKeyboardFocused, setIsKeyboardFocused] = useState(false);

    const buttonRef = useRef<HTMLDivElement>(null);
    const closeTimerRef = useRef<number | null>(null);
    const ignoreHoverRef = useRef(false);
    const wasKeyboardNavigationRef = useRef(false);
    const uniqueId = useRef(
        `audio-validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`
    );

    // Use currentUsername prop directly - no local state duplication
    const username = currentUsername ?? null;

    // Provider-derived state via hook - this is the source of truth
    const { iconProps: baseIconProps, validators: uniqueValidationUsers } =
        useAudioValidationStatus({
            cell,
            currentUsername: username,
            requiredAudioValidations: requiredAudioValidationsProp ?? null,
            isSourceText,
            disabled: Boolean(externallyDisabled) || isSourceText,
            displayValidationText: false,
        });

    // Derive from hook - no local state needed
    const currentValidations = uniqueValidationUsers.length;
    const isValidatedByCurrentUser = baseIconProps.isValidatedByCurrentUser;

    // Use prop directly with fallback - no local state needed
    const requiredAudioValidations = requiredAudioValidationsProp ?? 1;

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
        `audioValidationButton-${cellId}-${uniqueId.current}`,
        (event: MessageEvent) => {
            const message = event.data as any;

            if (message.type === "providerUpdatesAudioValidationState") {
                // Provider has confirmed the validation state - clear pending
                if (message.content.cellId === cellId) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "audioValidationInProgress") {
                if (message.content.cellId === cellId && !message.content.inProgress) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "pendingAudioValidationCleared") {
                if (message.content.cellIds.includes(cellId)) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "audioHistorySelectionChanged") {
                // Audio selection changed - clear pending as we'll re-render with new data
                if (message.content.cellId === cellId) {
                    setIsPendingValidation(false);
                }
            }
        },
        [cellId]
    );

    // Close popover when another becomes active
    useEffect(() => {
        if (showPopover && audioPopoverTracker.getActivePopover() !== uniqueId.current) {
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
        enqueueValidation(cellId, !isValidatedByCurrentUser, true)
            .then(() => {})
            .catch((error) => {
                console.error("Audio validation queue error:", error);
                setIsPendingValidation(false);
            });
        processValidationQueue(vscode, true).catch((error) => {
            console.error("Audio validation queue processing error:", error);
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
            handleRequestClose();
        }
    };

    const handleMouseEnter = (e: React.MouseEvent) => {
        e.stopPropagation();

        if (isDisabled) return;
        if (ignoreHoverRef.current) return;

        clearCloseTimer();
        setShowPopover(true);
        audioPopoverTracker.setActivePopover(uniqueId.current);
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        wasKeyboardNavigationRef.current = true;

        if (e.key === "Enter") {
            e.preventDefault();
            handleMouseEnter(e as unknown as React.MouseEvent);
            handleButtonClick(e as unknown as React.MouseEvent);
        }

        if (e.key === "Escape") {
            e.preventDefault();
            handleMouseLeave(e as unknown as React.MouseEvent);
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

    const handleMouseLeave = (e: React.MouseEvent) => {
        e.stopPropagation();
        if (isDisabled) return;

        scheduleCloseTimer(() => {
            setShowPopover(false);
            audioPopoverTracker.setActivePopover(null);
        }, 100);
    };

    const handleRequestClose = () => {
        if (setShowSparkleButton) {
            setShowSparkleButton(false);
        }

        setShowPopover(false);
        audioPopoverTracker.setActivePopover(null);
        clearCloseTimer();
    };

    const buttonStyle = {
        height: "16px",
        width: "16px",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    } as const;

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
            className={`audio-validation-button-container ${
                isKeyboardFocused ? "keyboard-focused" : ""
            }`}
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{ position: "relative", display: "inline-block" }}
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
                        ? "Validating audio..."
                        : isDisabled
                        ? disabledReason || "Audio validation requires audio"
                        : undefined
                }
            >
                <ValidationStatusIcon
                    isValidationInProgress={isValidationInProgress}
                    isDisabled={isDisabled}
                    currentValidations={currentValidations}
                    requiredValidations={requiredAudioValidations}
                    isValidatedByCurrentUser={isValidatedByCurrentUser}
                />
            </VSCodeButton>

            {/* Popover for validation users - uses hook data directly */}
            {showPopover && uniqueValidationUsers.length > 0 && (
                <ValidatorPopover
                    anchorRef={buttonRef as any}
                    show={showPopover}
                    setShow={setShowPopover}
                    validators={uniqueValidationUsers}
                    currentUsername={username}
                    uniqueId={uniqueId.current}
                    onRequestClose={() => handleRequestClose()}
                    cancelCloseTimer={clearCloseTimer}
                    scheduleCloseTimer={scheduleCloseTimer}
                    onRemoveSelf={() => {
                        setIsPendingValidation(true);
                        enqueueValidation(cellId, false, true)
                            .then(() => {})
                            .catch((error) => {
                                console.error("Audio validation queue error:", error);
                                setIsPendingValidation(false);
                            });
                        processValidationQueue(vscode, true).catch((error) => {
                            console.error("Audio validation queue processing error:", error);
                            setIsPendingValidation(false);
                        });
                        handleRequestClose();
                    }}
                />
            )}

            <style>
                {`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .audio-validation-button-container .pending {
                    border: 2px solid #f5a623;
                    border-radius: 50%;
                }
                `}
            </style>
        </div>
    );
};

export default AudioValidationButton;
