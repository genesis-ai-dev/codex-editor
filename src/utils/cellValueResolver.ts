import { EditMapUtils } from "./editMapUtils";

/**
 * Resolves a cell's value from raw .codex JSON data.
 * Handles both legacy string format and new { selectedEdit, updatedAt } object format.
 *
 * @param cell A raw cell object from parsed .codex JSON
 * @returns The resolved string value of the cell
 */
export function resolveCellValue(cell: { value: unknown; metadata?: { edits?: Array<{ id?: string; editMap: readonly string[]; value: unknown; preview?: boolean }>; activeEditId?: string } }): string {
    const value = cell.value;

    // Legacy format: value is already a string
    if (typeof value === "string") {
        return value;
    }

    // New object format: { selectedEdit: string, updatedAt: number }
    if (value && typeof value === "object" && "selectedEdit" in value) {
        const selectedEditId = (value as { selectedEdit: string }).selectedEdit;
        const edits = cell.metadata?.edits;
        if (edits && selectedEditId) {
            const matchingEdit = edits.find(
                (e) => e.id === selectedEditId && EditMapUtils.isValue(e.editMap)
            );
            if (matchingEdit && typeof matchingEdit.value === "string") {
                return matchingEdit.value;
            }
        }
    }

    // Fallback: find the latest non-preview value edit
    const edits = cell.metadata?.edits;
    if (edits) {
        for (let i = edits.length - 1; i >= 0; i--) {
            const edit = edits[i];
            if (EditMapUtils.isValue(edit.editMap) && !edit.preview && typeof edit.value === "string") {
                return edit.value;
            }
        }
    }

    return "";
}

/**
 * Checks if a cell value is in the new object format (CellValueOnDisk).
 */
export function isCellValueObject(value: unknown): value is { selectedEdit: string; updatedAt: number } {
    return value !== null && typeof value === "object" && "selectedEdit" in value;
}
