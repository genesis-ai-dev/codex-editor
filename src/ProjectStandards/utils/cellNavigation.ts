import * as vscode from "vscode";
import { StandardViolation } from "../../../types";
import { jumpToCellInNotebook } from "../../utils";

/**
 * Navigate to a cell containing a violation.
 * Opens the file if not already open and scrolls to the cell.
 */
export async function jumpToViolationCell(
    context: vscode.ExtensionContext,
    violation: StandardViolation
): Promise<void> {
    try {
        const { fileUri, cellId } = violation;

        if (!fileUri || !cellId) {
            throw new Error("Violation missing fileUri or cellId");
        }

        // Use existing utility to jump to cell
        await jumpToCellInNotebook(context, fileUri, cellId);

        // Open the document to ensure it's visible
        const uri = vscode.Uri.file(fileUri);
        await vscode.commands.executeCommand("vscode.open", uri);
    } catch (error) {
        console.error("[CellNavigation] Error jumping to violation cell:", error);
        vscode.window.showErrorMessage(
            `Failed to navigate to cell: ${(error as Error).message}`
        );
    }
}

/**
 * Navigate to a cell by its ID and file URI.
 */
export async function navigateToCellById(
    context: vscode.ExtensionContext,
    cellId: string,
    fileUri: string
): Promise<void> {
    await jumpToViolationCell(context, {
        cellId,
        fileUri,
        cellValue: "",
        matchText: "",
    });
}

/**
 * Highlight a cell in the editor.
 * Uses the existing highlight mechanism from the editor provider.
 */
export async function highlightCell(cellId: string): Promise<void> {
    try {
        // Broadcast the highlight command to all editors
        await vscode.commands.executeCommand(
            "codex-editor-extension.highlightCell",
            cellId
        );
    } catch (error) {
        console.error("[CellNavigation] Error highlighting cell:", error);
    }
}

/**
 * Get the file URI for a cell from SQLite index data.
 * Useful when you have a cellId but need the file path.
 */
export function extractFileUriFromCell(cell: {
    uri?: string;
    file_path?: string;
}): string | undefined {
    return cell.uri || cell.file_path;
}
