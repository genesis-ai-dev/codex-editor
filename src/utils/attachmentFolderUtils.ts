import * as path from "path";
import * as vscode from "vscode";

/**
 * Returns the folder segment we use for book-scoped attachments under:
 *  - .project/attachments/files/{SEGMENT}/
 *  - .project/attachments/pointers/{SEGMENT}/
 *
 * For typical projects this is the base filename of the active notebook:
 *  - ".../files/target/MAT.codex" -> "MAT"
 *  - ".../.project/sourceTexts/MAT.source" -> "MAT"
 *
 * We intentionally derive from the *document filename* (not cell IDs) because
 * cell IDs may now be UUIDs and no longer encode the book/document name.
 */
export function getAttachmentDocumentSegmentFromUri(documentUri: vscode.Uri): string {
    // Prefer fsPath when available (file scheme); fall back to uri.path.
    const rawPath = documentUri.fsPath || documentUri.path || "";
    const base = path.basename(rawPath);
    const withoutKnownExt = base.replace(/\.(codex|source)$/i, "");
    const segment = withoutKnownExt.trim();
    return segment || "UNKNOWN";
}

