import { useEffect, useMemo, useState } from "react";
import type { QuillCellContent, ValidationEntry } from "../../../../../types";
import { getCellValueData } from "@sharedUtils";
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
            const effectiveSelectedAudioId = cell.metadata?.selectedAudioId ?? "";
            const cellValueData = getCellValueData({
                ...cell,
                metadata: {
                    ...(cell.metadata || {}),
                    selectedAudioId: effectiveSelectedAudioId,
                },
            } as any);

            const active = getActiveAudioValidations(cellValueData.audioValidatedBy as any);
            const deduped = dedupeByLatestPerUser(active);
            const isValidated = username
                ? deduped.some(
                    (v) => (v.username || "").toLowerCase() === (username || "").toLowerCase()
                )
                : false;
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


