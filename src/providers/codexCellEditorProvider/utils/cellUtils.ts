import { QuillCellContent, CustomNotebookCellData } from "../../../../types";
import { CodexCellTypes } from "../../../../types/enums";

/**
 * Generates a child cell ID by appending a timestamp and random string to the parent ID
 * @param parentCellId The ID of the parent cell
 * @returns A new cell ID for the child
 */
export function generateChildCellId(parentCellId: string): string {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substr(2, 9);
    return `${parentCellId}:${timestamp}-${randomString}`;
}

/**
 * Extracts the parent content cell ID from a paratext cell ID.
 * Paratext cell IDs have the format: "parentId:paratext-..." or "parentId:paratext-..."
 * Returns the parent ID (first two parts when split by ':') or null if not a paratext cell.
 * 
 * @param paratextCellId The paratext cell ID (e.g., "GEN 1:50:paratext-123456")
 * @returns The parent content cell ID (e.g., "GEN 1:50") or null if not a paratext cell
 */
export function extractParentCellIdFromParatext(paratextCellId: string): string | null {
    if (!paratextCellId || !paratextCellId.includes(":paratext-")) {
        return null;
    }

    // Split by ':' and take the first two parts to get the parent cell ID
    // Format: "GEN 1:50:paratext-123456" -> ["GEN 1", "50", "paratext-123456"]
    // We want "GEN 1:50"
    const parts = paratextCellId.split(":");
    if (parts.length >= 2) {
        return parts.slice(0, 2).join(":");
    }

    return null;
}

/**
 * Converts a CustomNotebookCellData cell to QuillCellContent format.
 * 
 * @param cell The notebook cell data to convert
 * @returns QuillCellContent representation of the cell
 */
export function convertCellToQuillContent(cell: CustomNotebookCellData): QuillCellContent {
    const cellId = cell.metadata?.id || "";
    return {
        cellMarkers: [cellId],
        cellContent: cell.value || "",
        cellType: cell.metadata?.type || CodexCellTypes.TEXT,
        editHistory: cell.metadata?.edits || [],
        timestamps: cell.metadata?.data,
        cellLabel: cell.metadata?.cellLabel,
        merged: cell.metadata?.data?.merged,
        deleted: cell.metadata?.data?.deleted,
        data: cell.metadata?.data,
        attachments: cell.metadata?.attachments || {},
        metadata: {
            selectedAudioId: cell.metadata?.selectedAudioId,
        },
    };
}
