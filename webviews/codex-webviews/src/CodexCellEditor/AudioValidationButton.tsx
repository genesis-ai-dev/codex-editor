import React, { useState, useEffect, useRef, Dispatch, SetStateAction } from "react";
import { VSCodeButton } from "@vscode/webview-ui-toolkit/react";
import { QuillCellContent, ValidationEntry } from "../../../../types";
import { getCellValueData } from "@sharedUtils";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";
import { processValidationQueue, enqueueValidation } from "./validationQueue";
import { computeAudioValidationUpdate } from "./validationUtils";
import AudioValidationStatusIcon from "./AudioValidationStatusIcon";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";
import { audioPopoverTracker } from "./validationUtils";
import AudioValidatorsPopover from "./components/AudioValidatorsPopover";

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
    const [isValidated, setIsValidated] = useState(false);
    const [username, setUsername] = useState<string | null>(currentUsername ?? null);
    const [requiredAudioValidations, setRequiredAudioValidations] = useState(
        requiredAudioValidationsProp ?? 1
    );
    const [userCreatedLatestEdit, setUserCreatedLatestEdit] = useState(false);
    const [showPopover, setShowPopover] = useState(false);
    const [isPendingValidation, setIsPendingValidation] = useState(false);
    const [isValidationInProgress, setIsValidationInProgress] = useState(false);
    const buttonRef = useRef<HTMLDivElement>(null);
    const uniqueId = useRef(
        `audio-validation-${cellId}-${Math.random().toString(36).substring(2, 11)}`
    );

    const { iconProps: baseIconProps, validators: baseValidators } = useAudioValidationStatus({
        cell,
        currentUsername: username,
        requiredAudioValidations: requiredAudioValidationsProp ?? null,
        isSourceText,
        disabled: Boolean(externallyDisabled) || isSourceText,
        displayValidationText: false,
    });

    // Create a deduplicated list of validation users
    const uniqueValidationUsers = baseValidators;
    const currentValidations = baseValidators.length;

    const fetchValidationCountAudio = () => {
        // Only fetch if parent hasn't provided it
        if (requiredAudioValidationsProp == null) {
            vscode.postMessage({
                command: "getValidationCountAudio",
            });
        }
    };

    // Update validation state when attachments or hook-derived validators change
    useEffect(() => {
        if (!cell.attachments) {
            return;
        }

        const effectiveSelectedAudioId = cell.metadata?.selectedAudioId ?? "";

        const cellValueData = getCellValueData({
            ...cell,
            metadata: {
                ...(cell.metadata || {}),
                selectedAudioId: effectiveSelectedAudioId,
            },
        } as any);

        setUserCreatedLatestEdit(
            cellValueData.author === username && cellValueData.editType === "user-edit"
        );

        setIsValidated(Boolean(baseIconProps.isValidatedByCurrentUser));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [cell, username, baseValidators, baseIconProps.isValidatedByCurrentUser]);

    // Get the current username when component mounts and listen for configuration changes
    useEffect(() => {
        if (currentUsername) {
            setUsername(currentUsername);
        }
    }, [currentUsername]);

    useEffect(() => {
        if (requiredAudioValidationsProp !== undefined && requiredAudioValidationsProp !== null) {
            setRequiredAudioValidations(requiredAudioValidationsProp);
        }
    }, [requiredAudioValidationsProp]);

    const applyValidatedByUpdate = (validatedBy: ValidationEntry[] | undefined) => {
        const { isValidated: validated } = computeAudioValidationUpdate(validatedBy, username);
        setIsValidated(validated);
        setIsPendingValidation(false);
        setIsValidationInProgress(false);
    };

    useMessageHandler(
        "audioValidationButton",
        (event: MessageEvent) => {
            const message = event.data as any;
            if (!currentUsername && message.type === "currentUsername") {
                setUsername(message.content.username);
            } else if (
                requiredAudioValidationsProp == null &&
                message.type === "validationCountAudio"
            ) {
                setRequiredAudioValidations(message.content);

                // The component will re-render with the new requiredAudioValidations value
                // which will recalculate isFullyValidated in the render function
            } else if (message.type === "providerUpdatesAudioValidationState") {
                // Handle audio validation state updates from the backend
                if (message.content.cellId === cellId) {
                    applyValidatedByUpdate(message.content.validatedBy);
                }
            } else if (message.type === "configurationChanged") {
                // Configuration changes now send validationCountAudio directly, no need to refetch
                console.log("Configuration changed - audio validation count will be sent directly");
            } else if (message.command === "updateAudioValidationCount") {
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
                if (message.content.cellIds.includes(cellId)) {
                    setIsPendingValidation(false);
                }
            } else if (message.type === "audioHistorySelectionChanged") {
                applyValidatedByUpdate(message.content.validatedBy);
            }
        },
        [cellId, username, currentUsername, requiredAudioValidationsProp]
    );

    useEffect(() => {
        if (showPopover && audioPopoverTracker.getActivePopover() !== uniqueId.current) {
            setShowPopover(false);
        }
    }, [showPopover]);

    const handleValidate = (e: React.MouseEvent) => {
        e.stopPropagation();
        setIsPendingValidation(true);
        // Add to audio validation queue for sequential processing
        enqueueValidation(cellId, !isValidated, true)
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
        if (!isValidated) {
            handleValidate(e);
            return;
        }
        setShowPopover(true);
        audioPopoverTracker.setActivePopover(uniqueId.current);
    };

    const buttonStyle = {
        height: "16px",
        width: "16px",
        padding: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
    } as const;

    const isDisabled = isSourceText || isValidationInProgress || Boolean(externallyDisabled);

    if (isSourceText || !username) {
        return null;
    }

    return (
        <div
            ref={buttonRef}
            className="audio-validation-button-container"
            onClick={handleButtonClick}
            style={{ position: "relative", display: "inline-block" }}
        >
            <VSCodeButton
                appearance="icon"
                style={{
                    ...buttonStyle,
                    // Add orange border for pending validations - use a consistent orange color
                    ...(isPendingValidation && {
                        border: "2px solid #f5a623",
                        borderRadius: "50%",
                    }),
                }}
                onClick={(e) => {
                    e.stopPropagation();
                    handleButtonClick(e);
                }}
                disabled={isDisabled}
                title={isDisabled ? disabledReason || "Audio validation requires audio" : undefined}
            >
                <AudioValidationStatusIcon
                    isValidationInProgress={isValidationInProgress}
                    isDisabled={isDisabled}
                    currentValidations={currentValidations}
                    requiredValidations={requiredAudioValidations}
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
                .audio-validation-button-container .pending {
                    border: 2px solid #f5a623;
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
                    onRequestClose={() => setShowSparkleButton && setShowSparkleButton(false)}
                    onRemoveSelf={() => {
                        enqueueValidation(cellId, false, true)
                            .then(() => {})
                            .catch((error) =>
                                console.error("Audio validation queue error:", error)
                            );
                        processValidationQueue(vscode, true).catch((error) =>
                            console.error("Audio validation queue processing error:", error)
                        );
                    }}
                />
            )}
        </div>
    );
};

export default AudioValidationButton;
