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
