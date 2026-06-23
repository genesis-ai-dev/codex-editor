import { useEffect, useMemo, useState } from "react";
import type { QuillCellContent, ValidationEntry } from "../../../../../types";
import { getActiveAudioValidations } from "../validationUtils";
import type { ValidationStatusIconProps } from "../AudioValidationStatusIcon";

interface UseAudioValidationStatusParams {
    cell: QuillCellContent;
    currentUsername?: string | null;
    requiredAudioValidations?: number | null;
    isSourceText?: boolean;
    disabled?: boolean;
    displayValidationText?: boolean;
}

export interface UseAudioValidationStatusResult {
    iconProps: ValidationStatusIconProps;
    validators: ValidationEntry[]; // deduped, latest per user
}

// Deduplicate validations to the latest per user
function dedupeByLatestPerUser(entries: ValidationEntry[]): ValidationEntry[] {
    const userToLatest = new Map<string, ValidationEntry>();
    for (const entry of entries) {
        const existing = userToLatest.get(entry.username);
        if (!existing || entry.updatedTimestamp > existing.updatedTimestamp) {
            userToLatest.set(entry.username, entry);
        }
    }
    return Array.from(userToLatest.values());
}

export function useAudioValidationStatus(
    params: UseAudioValidationStatusParams
): UseAudioValidationStatusResult {
    const {
        cell,
        currentUsername,
        requiredAudioValidations,
        isSourceText = false,
        disabled,
        displayValidationText,
    } = params;

    const [username, setUsername] = useState<string | null>(currentUsername ?? null);

    // keep username in sync with prop
    useEffect(() => {
        setUsername(currentUsername ?? null);
    }, [currentUsername]);

    const { validators, currentValidations, isValidatedByCurrentUser } = useMemo(() => {
        try {
            // Per-attachment-selected rule: validators belong to the audio attachment
            // that `selectedAudioId` points at. If there is no explicit selection, or
            // the id no longer resolves to a non-deleted audio attachment, the cell
            // currently has no "selected validators" — return empty. This matches
            // the audio availability rule in `resolveSelectedAttachmentState` and
            // keeps the cell-list badge consistent with the audio button.
            const explicitId = cell.metadata?.selectedAudioId;
            const atts = (cell.attachments || {}) as Record<string, any>;
            const selectedAtt = explicitId ? atts[explicitId] : undefined;
            const selectionResolves =
                !!selectedAtt &&
                selectedAtt.type === "audio" &&
                !selectedAtt.isDeleted;

            if (!selectionResolves) {
                return {
                    validators: [],
                    currentValidations: 0,
                    isValidatedByCurrentUser: false,
                };
            }

            const active = getActiveAudioValidations(
                selectedAtt.validatedBy as ValidationEntry[] | undefined
            );
            const deduped = dedupeByLatestPerUser(active);
            const lowerUser = (username || "").toLowerCase();
            const isValidated = !!lowerUser && deduped.some(
                (v) => (v.username || "").toLowerCase() === lowerUser
            );
            return {
                validators: deduped,
                currentValidations: deduped.length,
                isValidatedByCurrentUser: isValidated,
            };
        } catch {
            return { validators: [], currentValidations: 0, isValidatedByCurrentUser: false };
        }
    }, [cell, username]);

    const iconProps: ValidationStatusIconProps = {
        isValidationInProgress: false, // status icon itself does not track queue here
        isDisabled: Boolean(isSourceText || disabled),
        currentValidations,
        requiredValidations: requiredAudioValidations ?? 1,
        isValidatedByCurrentUser,
        displayValidationText,
    };

    return {
        iconProps,
        validators,
    };
}

export default useAudioValidationStatus;


