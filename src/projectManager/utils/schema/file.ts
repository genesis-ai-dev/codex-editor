import * as vscode from "vscode";
import { atomicWriteUriText } from "../../../utils/notebookSafeSaveUtils";
import { formatJsonForNotebookFile } from "../../../utils/notebookFileFormattingUtils";
import {
    bringNotebookToCurrent,
    BringToCurrentResult,
    SchemaMigrationContext,
    SchemaNotebook,
} from "./index";

/**
 * Reads a notebook URI, runs the schema ladder, and atomically writes it back
 * iff the ladder reported a change. Used by both the activation-time normalization
 * pass and the post-sync hook so they share identical semantics.
 *
 * Returns `migrated: false` when the file is already at the current schema version
 * or when the file is at a version newer than this client understands (in which
 * case the file is left untouched).
 */
export async function bringNotebookToCurrentForFile(
    uri: vscode.Uri,
    ctx: SchemaMigrationContext
): Promise<BringToCurrentResult & { error?: unknown; }> {
    try {
        const data = await vscode.workspace.fs.readFile(uri);
        const text = new TextDecoder().decode(data);
        const notebook: SchemaNotebook = JSON.parse(text);

        const result = await bringNotebookToCurrent(notebook, ctx);
        if (result.migrated) {
            const newContent = formatJsonForNotebookFile(notebook);
            await atomicWriteUriText(uri, newContent);
        }
        return result;
    } catch (error) {
        console.error(`[schema] Failed to migrate ${uri.fsPath}:`, error);
        return { migrated: false, from: -1, to: -1, aheadOfClient: false, error };
    }
}
