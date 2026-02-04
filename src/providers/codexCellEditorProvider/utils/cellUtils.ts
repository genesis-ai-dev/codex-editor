import { QuillCellContent, CustomNotebookCellData } from "../../../../types";
import { CodexCellTypes } from "../../../../types/enums";
import { generateCellIdFromHash } from "../../../utils/idUtils";

/**
 * Generates a child cell ID using UUID format.
 * Creates a UUID for the child cell based on parent ID + timestamp + random string.
 * @param parentCellId The UUID of the parent cell
 * @returns A new UUID for the child cell
 */
export async function generateChildCellId(parentCellId: string): Promise<string> {
    const timestamp = Date.now();
    const randomString = Math.random().toString(36).substr(2, 9);
    // Create a deterministic ID from parent + timestamp + random, then hash to UUID
    const childIdString = `${parentCellId}:${timestamp}-${randomString}`;
    return await generateCellIdFromHash(childIdString);
}

// MILESTONES: Should use parentId directly instead of parsing the ID for future use.

/**
 * Extracts the parent content cell ID from a paratext cell ID.
 * With UUID format, this function now checks metadata.parentId instead of parsing the ID.
 * This function is kept for backward compatibility but should use metadata.parentId directly.
 * 
 * @param paratextCellId The paratext cell ID (UUID format)
 * @param cellMetadata Optional cell metadata to check for parentId
 * @returns The parent cell UUID or null if not a paratext cell
 * @deprecated Use metadata.parentId directly instead of parsing cell IDs
 */
export function extractParentCellIdFromParatext(paratextCellId: string, cellMetadata?: any): string | null {
    // If metadata is provided and has parentId, use that (preferred method)
    if (cellMetadata?.parentId) {
        return cellMetadata.parentId;
    }

    // Legacy: Try to extract from ID format (for backward compatibility during migration)
    // This should not be needed after migration is complete
    if (!paratextCellId || !paratextCellId.includes(":paratext-")) {
        return null;
    }

    // Extract parent ID by taking everything before ":paratext-"
    // This handles both formats:
    // - Legacy: "GEN 1:50:paratext-123456" -> "GEN 1:50"
    // - UUID: "e8676fe1-2971-37cd-7f4c-5e0f117d9862:paratext-1765972993617-vdhh8qhav" -> "e8676fe1-2971-37cd-7f4c-5e0f117d9862"
    const paratextIndex = paratextCellId.indexOf(":paratext-");
    if (paratextIndex > 0) {
        return paratextCellId.substring(0, paratextIndex);
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
            selectionTimestamp: cell.metadata?.selectionTimestamp,
            parentId: cell.metadata?.parentId,
            isLocked: cell.metadata?.isLocked,
        },
    };
}
