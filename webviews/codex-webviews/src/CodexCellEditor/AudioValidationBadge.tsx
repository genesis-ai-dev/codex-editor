import React, { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "../components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "../components/ui/tooltip";
import { getValidationLabel } from "./AudioValidationStatusIcon.tsx";
import type { ValidationStatusIconProps } from "./AudioValidationStatusIcon.tsx";
import type { QuillCellContent, ValidationEntry } from "../../../../types";
import { enqueueValidation, processValidationQueue } from "./validationQueue";
import ValidatorPopover from "./components/ValidatorPopover";
import { audioPopoverTracker, getActiveAudioValidations, readOnlyTooltipTracker } from "./validationUtils";
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
    // and for the disabled trash tooltip. Defaults to "Download audio to validate" / "…invalidate".
    readOnlyReason?: string;
    // When provided, these validators are used for the hover popover instead of the
    // hook-derived ones (which reflect the cell's selected audio, not necessarily this entry).
    initialValidators?: ValidationEntry[];
    // When provided, the validation/invalidation targets this specific attachment
    // instead of the cell's currently selected audio.
    attachmentId?: string;
    // When true, always use the status label from getValidationLabel() (e.g. "No validators")
    // instead of the action label "Validate" when there are 0 validators.
    alwaysShowStatusLabel?: boolean;
}

export const AudioValidationBadge: React.FC<AudioValidationBadgeProps> = ({
    validationStatusProps,
    popoverProps,
    readOnly,
    readOnlyReason,
    initialValidators,
    attachmentId,
    alwaysShowStatusLabel,
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
    const dismissReadOnlyTooltip = React.useCallback(() => {
        setShowReadOnlyTooltip(false);
        if (readOnlyTooltipTimerRef.current != null) {
            clearTimeout(readOnlyTooltipTimerRef.current);
            readOnlyTooltipTimerRef.current = null;
        }
    }, []);
    const flashReadOnlyTooltip = () => {
        if (readOnlyTooltipTimerRef.current != null) {
            clearTimeout(readOnlyTooltipTimerRef.current);
        }
        readOnlyTooltipTracker.show(dismissReadOnlyTooltip);
        setShowReadOnlyTooltip(true);
        readOnlyTooltipTimerRef.current = window.setTimeout(() => {
            setShowReadOnlyTooltip(false);
            readOnlyTooltipTracker.clear(dismissReadOnlyTooltip);
            readOnlyTooltipTimerRef.current = null;
        }, 2500);
    };
    useEffect(() => {
        return () => {
            if (readOnlyTooltipTimerRef.current != null) {
                clearTimeout(readOnlyTooltipTimerRef.current);
            }
            readOnlyTooltipTracker.clear(dismissReadOnlyTooltip);
        };
    }, [dismissReadOnlyTooltip]);

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
                Array.isArray(message.content?.validatedBy) &&
                // When this badge targets a specific attachment, only accept updates for that attachment.
                // When no attachmentId is set (waveform/cell-list), accept any update for the cell.
                (!attachmentId || !message.content.attachmentId || message.content.attachmentId === attachmentId)
            ) {
                setOverrideValidatedBy(message.content.validatedBy as ValidationEntry[]);
            }
        },
        [popoverCellId]
    );

    // Effective validators: for interactive (non-readOnly) badges, prefer the real-time
    // override from provider messages; for readOnly badges, ignore overrides (they reflect
    // the selected audio which may differ from this entry). Fall back to initialValidators
    // (per-entry) then the hook-derived baseValidationUsers (cell-level).
    const uniqueValidationUsers = useMemo(() => {
        if (!readOnly && overrideValidatedBy) {
            const active = getActiveAudioValidations(overrideValidatedBy);
            const userToLatest = new Map<string, ValidationEntry>();
            for (const v of active) {
                const existing = userToLatest.get(v.username);
                if (!existing || v.updatedTimestamp > existing.updatedTimestamp) {
                    userToLatest.set(v.username, v);
                }
            }
            return Array.from(userToLatest.values());
        }
        if (initialValidators) return initialValidators;
        return baseValidationUsers;
    }, [readOnly, overrideValidatedBy, initialValidators, baseValidationUsers]);

    // Derive effective icon values: for interactive badges, recompute from the real-time
    // override when present; for readOnly badges, always use the parent-supplied props
    // (which are already correct per-entry).
    const effectiveValidationStatusProps: ValidationStatusIconProps = useMemo(() => {
        if (!readOnly && overrideValidatedBy) {
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
        }
        return validationStatusProps;
    }, [readOnly, overrideValidatedBy, uniqueValidationUsers, popoverCurrentUsername, validationStatusProps]);

    const handleValidation = (e: React.MouseEvent<HTMLButtonElement>) => {
        e.stopPropagation();
        enqueueValidation(popoverProps.cellId, true, true, attachmentId)
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
        const canValidate = !isValidatedByCurrentUser;
        const label = getValidationLabel({ currentValidations, requiredValidations, isValidatedByCurrentUser });
        const buttonLabel = (currentValidations === 0 && !readOnly && !alwaysShowStatusLabel) ? "Validate" : label;

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
                  // Only flash the tooltip when the user hasn't validated yet.
                  // If they have, there's nothing the pill can do — invalidation
                  // is handled via the trash icon in the popover.
                  if (!isValidatedByCurrentUser) {
                      flashReadOnlyTooltip();
                  }
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

        const tooltipMessage = readOnlyReason || "Download audio to validate";

        return (
            <Tooltip open={showReadOnlyTooltip} onOpenChange={() => {}}>
                <TooltipTrigger asChild>{button}</TooltipTrigger>
                <TooltipContent side="top" className="z-[100001]">
                    {tooltipMessage}
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
            style={{ position: "relative" }}
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
                                      enqueueValidation(popoverCellId!, false, true, attachmentId)
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
                                ? (readOnlyReason?.replace(/validate$/i, "invalidate") ?? "Download audio to invalidate")
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
