import { ValidationEntry } from "../../../../types";

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

// Returns only active (non-deleted, valid) validation entries
export function getActiveAudioValidations(
    validatedBy: ValidationEntry[] | undefined
): ValidationEntry[] {
    const list = validatedBy || [];
    return list.filter(
        (entry: ValidationEntry) => isValidValidationEntry(entry) && !entry.isDeleted
    );
}

// Returns whether the given username has an active validation
export function isAudioValidatedByUser(
    validatedBy: ValidationEntry[] | undefined,
    username: string | null | undefined
): boolean {
    if (!username) return false;
    const active = getActiveAudioValidations(validatedBy);
    return active.some((entry) => entry.username === username);
}

// Computes both the active validations list and whether the user is validated
export function computeAudioValidationUpdate(
    validatedBy: ValidationEntry[] | undefined,
    username: string | null | undefined
): { isValidated: boolean; activeValidations: ValidationEntry[]; } {
    const activeValidations = getActiveAudioValidations(validatedBy);
    const isValidated = Boolean(username) && activeValidations.some((e) => e.username === username);
    return { isValidated, activeValidations };
}
