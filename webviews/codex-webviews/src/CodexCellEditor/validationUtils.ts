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

// Format timestamps
export const formatTimestamp = (timestamp: number): string => {
    if (!timestamp) return "";

    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffSecs = Math.floor(diffMs / 1000);
    const diffMins = Math.floor(diffSecs / 60);
    const diffHours = Math.floor(diffMins / 60);
    const diffDays = Math.floor(diffHours / 24);

    // For recent validations (less than a day)
    if (diffDays < 1) {
        if (diffHours < 1) {
            if (diffMins < 1) {
                return "just now";
            }
            return `${diffMins}m ago`;
        }
        return `${diffHours}h ago`;
    }

    // For older validations
    if (diffDays < 7) {
        return `${diffDays}d ago`;
    }

    // Format date if more than a week ago
    return date.toLocaleDateString();
};

// Shared tracker to ensure only one audio validators popover is active
export const audioPopoverTracker = {
    activePopoverId: null as string | null,
    setActivePopover(id: string | null) {
        this.activePopoverId = id;
    },
    getActivePopover() {
        return this.activePopoverId;
    },
};
