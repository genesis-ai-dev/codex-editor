import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { getValidationLabel } from "./AudioValidationStatusIcon.tsx";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import type { QuillCellContent, ValidationEntry } from "../../../../types";
import { enqueueValidation, processValidationQueue } from "./validationQueue";
import ValidatorPopover from "./components/ValidatorPopover";
import { audioPopoverTracker, getActiveAudioValidations } from "./validationUtils";
import { useAudioValidationStatus } from "./hooks/useAudioValidationStatus";
import { useMessageHandler } from "./hooks/useCentralizedMessageDispatcher";

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
    // When true, suppresses click-to-validate mutations. Clicking surfaces a ShadCN
    // tooltip explaining why; hover popover still works so users can see validators.
    readOnly?: boolean;
    // Optional override for the ShadCN tooltip message shown on click (when readOnly)
    // and for the disabled trash tooltip. Defaults to "Download audio to validate/unvalidate".
    readOnlyReason?: string;
}

export const AudioValidationBadge: React.FC<AudioValidationBadgeProps> = ({
    validationStatusProps,
    popoverProps,
    readOnly,
    readOnlyReason,
}) => {
    const [showValidatorsPopover, setShowValidatorsPopover] = useState(false);
    const [showReadOnlyTooltip, setShowReadOnlyTooltip] = useState(false);
    const validationContainerRef = useRef<HTMLDivElement>(null);
    const popoverCloseTimerRef = useRef<number | null>(null);
    const readOnlyTooltipTimerRef = useRef<number | null>(null);

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
    const flashReadOnlyTooltip = () => {
        if (readOnlyTooltipTimerRef.current != null) {
            clearTimeout(readOnlyTooltipTimerRef.current);
        }
        setShowReadOnlyTooltip(true);
        readOnlyTooltipTimerRef.current = window.setTimeout(() => {
            setShowReadOnlyTooltip(false);
            readOnlyTooltipTimerRef.current = null;
        }, 2500);
    };
    useEffect(() => {
        return () => {
            if (readOnlyTooltipTimerRef.current != null) {
                clearTimeout(readOnlyTooltipTimerRef.current);
            }
        };
    }, []);

    const popoverCurrentUsername = popoverProps?.currentUsername;
    const popoverCell = popoverProps?.cell;
    const popoverCellId = popoverProps?.cellId;
    const isSourceTextPopover = popoverProps?.isSourceText;
    const uniqueId = useRef(
        `audio-validation-${popoverCellId ?? "unknown"}-${Math.random()
            .toString(36)
            .substring(2, 11)}`
    );

    const { validators: baseValidationUsers } = useAudioValidationStatus({
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

    // Local override of validatedBy, fed by providerUpdatesAudioValidationState messages.
    // The parent-derived validationStatusProps and baseValidationUsers come from cell state
    // which is not always refreshed after a validation action; listening directly lets the
    // badge react in real time (mirrors the pattern used by AudioValidationButton).
    const [overrideValidatedBy, setOverrideValidatedBy] = useState<ValidationEntry[] | null>(
        null
    );

    // Clear the override whenever the selection changes — validations are per-attachment,
    // so a new selection resets us to whatever the parent's cell state says.
    const selectedAudioId = (popoverCell as any)?.metadata?.selectedAudioId ?? "";
    useEffect(() => {
        setOverrideValidatedBy(null);
    }, [selectedAudioId, popoverCellId]);

    useMessageHandler(
        `audioValidationBadge-${popoverCellId ?? "unknown"}-${uniqueId.current}`,
        (event: MessageEvent) => {
            const message = event.data as any;
            if (
                message?.type === "providerUpdatesAudioValidationState" &&
                message.content?.cellId === popoverCellId &&
                Array.isArray(message.content?.validatedBy)
            ) {
                setOverrideValidatedBy(message.content.validatedBy as ValidationEntry[]);
            }
        },
        [popoverCellId]
    );

    // Effective validators: prefer the override (latest push from provider) when present,
    // otherwise fall back to the hook-derived validators from cell state.
    const uniqueValidationUsers = useMemo(() => {
        if (!overrideValidatedBy) return baseValidationUsers;
        const active = getActiveAudioValidations(overrideValidatedBy);
        const userToLatest = new Map<string, ValidationEntry>();
        for (const entry of active) {
            const existing = userToLatest.get(entry.username);
            if (!existing || entry.updatedTimestamp > existing.updatedTimestamp) {
                userToLatest.set(entry.username, entry);
            }
        }
        return Array.from(userToLatest.values());
    }, [overrideValidatedBy, baseValidationUsers]);

    // Derive effective icon values: when override is present, recompute from it; else use
    // the validationStatusProps that were passed down from the parent.
    const effectiveValidationStatusProps: ValidationStatusIconProps = useMemo(() => {
        if (!overrideValidatedBy) return validationStatusProps;
        const currentValidations = uniqueValidationUsers.length;
        const lowerCurrentUser = (popoverCurrentUsername || "").toLowerCase();
        const isValidatedByCurrentUser = lowerCurrentUser
            ? uniqueValidationUsers.some(
                (u) => (u.username || "").toLowerCase() === lowerCurrentUser
            )
            : false;
        return {
            ...validationStatusProps,
            currentValidations,
            isValidatedByCurrentUser,
        };
    }, [overrideValidatedBy, uniqueValidationUsers, popoverCurrentUsername, validationStatusProps]);

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
            effectiveValidationStatusProps;
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

        const onClickHandler = readOnly
            ? (e: React.MouseEvent<HTMLButtonElement>) => {
                  e.stopPropagation();
                  flashReadOnlyTooltip();
              }
            : canValidate
                ? handleValidation
                : undefined;

        const button = (
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

        if (!readOnly) return button;

        return (
            <Tooltip open={showReadOnlyTooltip} onOpenChange={setShowReadOnlyTooltip}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="top">
                    {readOnlyReason || "Download audio to validate"}
                </TooltipContent>
            </Tooltip>
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
                        onRemoveSelf={
                            readOnly
                                ? undefined
                                : () => {
                                      enqueueValidation(popoverCellId!, false, true)
                                          .then(() => { })
                                          .catch((error) =>
                                              console.error(
                                                  "Audio validation queue error:",
                                                  error
                                              )
                                          );
                                      processValidationQueue(
                                          popoverProps!.vscode,
                                          true
                                      ).catch((error) =>
                                          console.error(
                                              "Audio validation queue processing error:",
                                              error
                                          )
                                      );
                                  }
                        }
                        removeSelfDisabledReason={
                            readOnly
                                ? readOnlyReason || "Download audio to unvalidate"
                                : undefined
                        }
                        cancelCloseTimer={cancelCloseTimer}
                        scheduleCloseTimer={scheduleCloseTimer}
                    />
                )}
        </div>
    );
};

export default AudioValidationBadge;
