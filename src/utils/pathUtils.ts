/**
 * Consolidated path utilities
 * Combines: pathUtils, webPathUtils, attachmentFolderUtils
 */

import * as path from "path";
import * as vscode from "vscode";

// ============================================================================
// Cross-platform path helpers
// ============================================================================

/**
 * Convert any Windows-style backslashes to POSIX-style forward slashes.
 * Keeps existing forward slashes intact and does not perform URL decoding.
 */
export function toPosixPath(inputPath: string): string {
    if (!inputPath) return inputPath;
    return inputPath.replace(/\\/g, "/");
}

/**
 * Normalize an attachment URL to POSIX and ensure it points to the files/ structure.
 * Examples:
 *  - .project\\attachments\\files\\BOOK\\file.webm -> .project/attachments/files/BOOK/file.webm
 *  - .project\\attachments\\BOOK\\file.webm -> .project/attachments/files/BOOK/file.webm
 *  - .project/attachments/pointers/BOOK/file.webm -> .project/attachments/files/BOOK/file.webm
 */
export function normalizeAttachmentUrl(rawUrl: string | undefined): string | undefined {
    if (!rawUrl || typeof rawUrl !== "string") return rawUrl;
    let url = toPosixPath(rawUrl);

    // Only operate on .project/attachments paths
    if (url.includes(".project/attachments/")) {
        // If currently pointing to pointers/, switch to files/
        if (url.includes("/attachments/pointers/")) {
            url = url.replace("/attachments/pointers/", "/attachments/files/");
        }

        // If neither files/ nor pointers/ is present after attachments/, insert files/
        const attachmentsIdx = url.indexOf(".project/attachments/");
        if (attachmentsIdx !== -1) {
            const after = url.slice(attachmentsIdx + ".project/attachments/".length);
            if (!after.startsWith("files/") && !after.startsWith("pointers/")) {
                url = url.replace(".project/attachments/", ".project/attachments/files/");
            }
        }
    }

    return url;
}

// ============================================================================
// Web-compatible URI path utilities
// ============================================================================

/**
 * Web-compatible path utilities that use URIs instead of file system paths
 */
export class WebPathUtils {
    /**
     * Get the basename of a URI
     */
    static getBasename(uri: vscode.Uri): string {
        const uriPath = uri.path;
        const parts = uriPath.split("/");
        return parts[parts.length - 1];
    }

    /**
     * Get the extension of a URI
     */
    static getExtension(uri: vscode.Uri): string {
        const basename = this.getBasename(uri);
        const parts = basename.split(".");
        return parts.length > 1 ? parts[parts.length - 1].toLowerCase() : "";
    }

    /**
     * Get the directory name of a URI
     */
    static getDirname(uri: vscode.Uri): string {
        const uriPath = uri.path;
        const parts = uriPath.split("/");
        parts.pop();
        return parts.join("/");
    }

    /**
     * Join path segments with a URI
     */
    static join(uri: vscode.Uri, ...paths: string[]): vscode.Uri {
        return vscode.Uri.joinPath(uri, ...paths);
    }

    /**
     * Check if a URI ends with a specific extension
     */
    static hasExtension(uri: vscode.Uri, extension: string): boolean {
        return this.getExtension(uri) === extension.toLowerCase();
    }

    /**
     * Get the name without extension
     */
    static getNameWithoutExtension(uri: vscode.Uri): string {
        const basename = this.getBasename(uri);
        const extension = this.getExtension(uri);
        return extension ? basename.slice(0, -(extension.length + 1)) : basename;
    }
}

// ============================================================================
// Attachment folder utilities
// ============================================================================

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
