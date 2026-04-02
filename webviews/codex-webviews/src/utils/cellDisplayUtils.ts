/**
 * Shared cell display labeling - matches the scheme used in the Comments UI.
 * Use this for consistent cell identification across Search Passages, Comments, etc.
 */

export interface CellDisplayInput {
    cellId: string;
    cellLabel?: string | null;
    fileDisplayName?: string;
    milestoneValue?: string;
    cellLineNumber?: number;
    globalReferences?: string[];
}

/**
 * Format a verse reference for display (e.g. "GEN 1:1" -> "Gen 1:1").
 * Matches the Comments UI globalReferences formatting.
 */
function formatVerseReference(ref: string): string {
    const parts = ref.split(" ");
    if (parts.length >= 2) {
        const book = parts[0].charAt(0).toUpperCase() + parts[0].slice(1).toLowerCase();
        return `${book} ${parts.slice(1).join(" ")}`;
    }
    return ref;
}

/**
 * Get display label for a cell using the same scheme as the Comments UI.
 * Priority:
 * 1. fileDisplayName · milestoneValue · Line N (when all available)
 * 2. milestoneValue · Line N
 * 3. fileDisplayName · Line N
 * 4. cellLabel (from cell metadata)
 * 5. globalReferences formatted (Gen 1:1 style)
 * 6. cellId formatted (verse ref style) or shortened for long IDs
 * 7. "Unknown cell"
 */
export function getCellDisplayLabel(input: CellDisplayInput | string): string {
    // Handle legacy string format (e.g. TranslationPair with only cellId passed as string)
    if (typeof input === "string") {
        const cellId = input;
        if (!cellId) return "Unknown cell";
        if (cellId.length > 10) {
            return `...${cellId.slice(-8)}`;
        }
        // Format as verse reference if it looks like "BOOK 1:1"
        return formatVerseReference(cellId);
    }

    const {
        cellId,
        cellLabel,
        fileDisplayName,
        milestoneValue,
        cellLineNumber,
        globalReferences,
    } = input;

    // Priority 1: Use the new display fields if all are available
    if (fileDisplayName && milestoneValue && cellLineNumber !== undefined) {
        return `${fileDisplayName} · ${milestoneValue} · Line ${cellLineNumber}`;
    }

    // Priority 2: Partial display info - show what we have
    if (milestoneValue && cellLineNumber !== undefined) {
        return `${milestoneValue} · Line ${cellLineNumber}`;
    }

    if (fileDisplayName && cellLineNumber !== undefined) {
        return `${fileDisplayName} · Line ${cellLineNumber}`;
    }

    // Priority 3: Use cellLabel from metadata when available
    if (cellLabel && cellLabel.trim()) {
        return cellLabel;
    }

    // Priority 4: Use globalReferences if available (for stored comments)
    if (globalReferences && globalReferences.length > 0) {
        const formatted = globalReferences.map(formatVerseReference);
        return formatted.join(", ");
    }

    // Priority 5: Fall back to formatted or shortened cellId
    const currentCellId = cellId || "";
    if (currentCellId.length > 10) {
        return `...${currentCellId.slice(-8)}`;
    }

    return currentCellId ? formatVerseReference(currentCellId) : "Unknown cell";
}
