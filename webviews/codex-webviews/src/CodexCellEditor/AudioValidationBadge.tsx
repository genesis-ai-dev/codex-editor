import React, { useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { getValidationLabel } from "./AudioValidationStatusIcon.tsx";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import type { QuillCellContent } from "../../../../types";
import { enqueueValidation, processValidationQueue } from "./validationQueue";
import ValidatorPopover from "./components/ValidatorPopover";
import { audioPopoverTracker } from "./validationUtils";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";

export interface AudioValidationPopoverProps {
    cellId: string;
    cell: QuillCellContent;
    vscode: any;
    isSourceText: boolean;
    currentUsername?: string | null;
    requiredAudioValidations?: number;
    disabled?: boolean;
    disabledReason?: string;
}

export interface AudioValidationBadgeProps {
    validationStatusProps: ValidationStatusIconProps;
    popoverProps: AudioValidationPopoverProps;
    // When true, suppresses click-to-validate and the "remove my validation" action
    // in the popover. Hover popover still works so the user can see who validated.
    readOnly?: boolean;
}

export const AudioValidationBadge: React.FC<AudioValidationBadgeProps> = ({
    validationStatusProps,
    popoverProps,
    readOnly,
}) => {
    const [showValidatorsPopover, setShowValidatorsPopover] = useState(false);
    const validationContainerRef = useRef<HTMLDivElement>(null);
    const popoverCloseTimerRef = useRef<number | null>(null);

    const cancelCloseTimer = () => {
        if (popoverCloseTimerRef.current != null) {
            clearTimeout(popoverCloseTimerRef.current);
            popoverCloseTimerRef.current = null;
        }
    };
    const scheduleCloseTimer = (cb: () => void, delay = 100) => {
        cancelCloseTimer();
        popoverCloseTimerRef.current = window.setTimeout(cb, delay);
    };

    const popoverCurrentUsername = popoverProps?.currentUsername;
    const popoverCell = popoverProps?.cell;
    const popoverCellId = popoverProps?.cellId;
    const isSourceTextPopover = popoverProps?.isSourceText;
    const uniqueId = useRef(
        `audio-validation-${popoverCellId ?? "unknown"}-${Math.random()
            .toString(36)
            .substring(2, 11)}`
    );

    const { validators: uniqueValidationUsers } = useAudioValidationStatus({
        cell: (popoverCell as any) || ({} as any),
        currentUsername: popoverCurrentUsername || null,
        requiredAudioValidations:
            popoverProps &&
            popoverProps.requiredAudioValidations !== undefined &&
            popoverProps.requiredAudioValidations !== null
                ? popoverProps.requiredAudioValidations
                : null,
        isSourceText: Boolean(isSourceTextPopover),
        disabled: false,
        displayValidationText: false,
    });

    const handleValidation = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        enqueueValidation(popoverProps.cellId, true, true)
            .then(() => { })
            .catch((error) => {
                console.error("Audio validation queue error:", error);
            });
        processValidationQueue(popoverProps.vscode, true).catch((error) => {
            console.error("Audio validation queue processing error:", error);
        });
    };

    const handleAudioValidationMouseEnter = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        e.preventDefault();
        cancelCloseTimer();
        setShowValidatorsPopover(true);
        audioPopoverTracker.setActivePopover(uniqueId.current);
    };

    const handleAudioValidationMouseLeave = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        e.preventDefault();
        scheduleCloseTimer(() => {
            setShowValidatorsPopover(false);
            if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                audioPopoverTracker.setActivePopover(null);
            }
        }, 100);
    };

    const renderValidationButton = () => {
        const { currentValidations, requiredValidations, isValidatedByCurrentUser } =
            validationStatusProps;
        const isFullyValidated = currentValidations >= requiredValidations;
        const canValidate = currentValidations === 0 || (!isFullyValidated && !isValidatedByCurrentUser);
        const label = getValidationLabel({ currentValidations, requiredValidations, isValidatedByCurrentUser });
        const buttonLabel = currentValidations === 0 ? "Validate" : label;

        const iconClass = currentValidations === 0
            ? "codicon codicon-circle-outline"
            : isFullyValidated
                ? "codicon codicon-check-all"
                : isValidatedByCurrentUser
                    ? "codicon codicon-check"
                    : "codicon codicon-circle-filled";
        const iconColor = (isFullyValidated || isValidatedByCurrentUser)
            ? "var(--vscode-charts-green)"
            : "var(--vscode-descriptionForeground)";

        const onClickHandler = readOnly ? undefined : (canValidate ? handleValidation : undefined);

        return (
            <Button
                variant="outline"
                size="sm"
                className="static h-6 px-2 rounded-full text-sm bg-[var(--vscode-badge-background)] text-[var(--vscode-badge-foreground)] border border-[var(--vscode-panel-border)]/40 hover:opacity-90"
                onClick={onClickHandler}
                onMouseEnter={handleAudioValidationMouseEnter}
                onMouseLeave={handleAudioValidationMouseLeave}
            >
                <i className={iconClass} style={{ fontSize: "14px", color: iconColor, filter: (isFullyValidated || isValidatedByCurrentUser) ? "drop-shadow(0 0 0.5px rgba(0,0,0,0.45))" : undefined }}></i>
                <span className="ml-1">{buttonLabel}</span>
            </Button>
        );
    };

    if (!validationStatusProps) {
        return null;
    }

    return (
        <div
            ref={validationContainerRef}
            onMouseEnter={(e) => {
                e.stopPropagation();
                cancelCloseTimer();
                setShowValidatorsPopover(true);
                audioPopoverTracker.setActivePopover(uniqueId.current);
            }}
            onMouseLeave={(e) => {
                e.stopPropagation();
                scheduleCloseTimer(() => {
                    setShowValidatorsPopover(false);
                    if (audioPopoverTracker.getActivePopover() === uniqueId.current) {
                        audioPopoverTracker.setActivePopover(null);
                    }
                }, 100);
            }}
        >
            <div
                className="relative inline-flex items-center justify-center"
                style={{
                    filter: "drop-shadow(0 1px 1px rgba(0,0,0,0.15))",
                }}
            >
                {renderValidationButton()}
            </div>
            {showValidatorsPopover &&
                popoverProps &&
                uniqueValidationUsers.length > 0 && (
                    <ValidatorPopover
                        anchorRef={validationContainerRef}
                        show={showValidatorsPopover}
                        setShow={setShowValidatorsPopover}
                        validators={uniqueValidationUsers}
                        currentUsername={popoverCurrentUsername || null}
                        uniqueId={uniqueId.current}
                        onRemoveSelf={() => {
                            if (readOnly) return;
                            enqueueValidation(popoverCellId!, false, true)
                                .then(() => { })
                                .catch((error) =>
                                    console.error("Audio validation queue error:", error)
                                );
                            processValidationQueue(popoverProps!.vscode, true).catch((error) =>
                                console.error(
                                    "Audio validation queue processing error:",
                                    error
                                )
                            );
                        }}
                        cancelCloseTimer={cancelCloseTimer}
                        scheduleCloseTimer={scheduleCloseTimer}
                    />
                )}
        </div>
    );
};

export default AudioValidationBadge;
