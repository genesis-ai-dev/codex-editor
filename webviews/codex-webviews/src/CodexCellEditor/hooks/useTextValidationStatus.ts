import { useEffect, useMemo, useState } from "react";
import type { QuillCellContent, ValidationEntry } from "../../../../../types";
import { getCellValueData } from "@sharedUtils";
import { getActiveTextValidations } from "../validationUtils";

interface UseTextValidationStatusParams {
    cell: QuillCellContent;
    currentUsername?: string | null;
    requiredTextValidations?: number | null;
    isSourceText?: boolean;
    disabled?: boolean;
}

export interface UseTextValidationStatusResult {
    validators: ValidationEntry[]; // deduped, latest per user
    currentValidations: number;
    isValidatedByCurrentUser: boolean;
}

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

export function useTextValidationStatus(
    params: UseTextValidationStatusParams
): UseTextValidationStatusResult {
    const { cell, currentUsername } = params;

    const [username, setUsername] = useState<string | null>(currentUsername ?? null);

    useEffect(() => {
        setUsername(currentUsername ?? null);
    }, [currentUsername]);

    const { validators, currentValidations, isValidatedByCurrentUser } = useMemo(() => {
        try {
            const cellValueData = getCellValueData(cell);
            const active = getActiveTextValidations((cellValueData as any).validatedBy);
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

    return {
        validators,
        currentValidations,
        isValidatedByCurrentUser,
    };
}

export default useTextValidationStatus;


