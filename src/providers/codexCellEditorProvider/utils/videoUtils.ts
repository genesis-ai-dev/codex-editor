import * as vscode from "vscode";

/**
 * Returns true when the stored video reference is a remote URL (streamed),
 * false when it is a local file reference (relative path or file:// URI).
 */
export function isHttpVideoUrl(videoUrl: string | undefined | null): boolean {
    return !!videoUrl && /^https?:\/\//i.test(videoUrl);
}

/**
 * Resolve the workspace-relative path for a stored local video reference.
 * Accepts either a workspace-relative path (as written by pickVideoFile) or a
 * `file://` URI inside the workspace. Returns null for remote URLs or paths
 * outside the workspace.
 */
export function getVideoWorkspaceRelativePath(
    videoUrl: string | undefined | null,
    workspaceUri: vscode.Uri
): string | null {
    if (!videoUrl || isHttpVideoUrl(videoUrl)) {
        return null;
    }

    try {
        if (videoUrl.startsWith("file://")) {
            const fileUri = vscode.Uri.parse(videoUrl);
            const wsPath = workspaceUri.fsPath.replace(/\\/g, "/");
            const filePath = fileUri.fsPath.replace(/\\/g, "/");
            if (filePath.toLowerCase().startsWith(wsPath.toLowerCase() + "/")) {
                return filePath.substring(wsPath.length).replace(/^\/+/, "");
            }
            return null;
        }
        // Already a workspace-relative path
        return videoUrl.replace(/\\/g, "/").replace(/^\/+/, "");
    } catch {
        return null;
    }
}

/**
 * Delete a managed local video from BOTH `\.project/attachments/files/<rel>`
 * and `\.project/attachments/pointers/<rel>`. Works whether the project is
 * unsynced (pointers holds raw bytes) or synced (pointers holds the pointer) —
 * the relative paths are identical in either case.
 *
 * Only files under `attachments/files|pointers/` are touched; arbitrary local
 * references are left alone. Paths whose absolute fsPath is in `excludeFsPaths`
 * are skipped (used when the replacement reuses the same filename).
 *
 * @returns the list of deleted absolute fsPaths (best-effort).
 */
export async function deleteLocalVideoFiles(
    videoUrl: string | undefined | null,
    workspaceUri: vscode.Uri,
    excludeFsPaths: Set<string> = new Set()
): Promise<string[]> {
    const relPath = getVideoWorkspaceRelativePath(videoUrl, workspaceUri);
    if (!relPath) {
        return [];
    }

    const FILES_SEG = "attachments/files/";
    const POINTERS_SEG = "attachments/pointers/";

    let tail: string | null = null;
    let prefix: string | null = null;
    if (relPath.includes(FILES_SEG)) {
        prefix = relPath.substring(0, relPath.indexOf(FILES_SEG));
        tail = relPath.substring(relPath.indexOf(FILES_SEG) + FILES_SEG.length);
    } else if (relPath.includes(POINTERS_SEG)) {
        prefix = relPath.substring(0, relPath.indexOf(POINTERS_SEG));
        tail = relPath.substring(relPath.indexOf(POINTERS_SEG) + POINTERS_SEG.length);
    }

    if (!tail || prefix === null) {
        // Not a managed attachment; do not delete arbitrary local files.
        return [];
    }

    const targets = [
        vscode.Uri.joinPath(workspaceUri, `${prefix}${FILES_SEG}${tail}`),
        vscode.Uri.joinPath(workspaceUri, `${prefix}${POINTERS_SEG}${tail}`),
    ];

    const deleted: string[] = [];
    for (const uri of targets) {
        if (excludeFsPaths.has(uri.fsPath)) {
            continue;
        }
        try {
            await vscode.workspace.fs.delete(uri, { useTrash: false });
            deleted.push(uri.fsPath);
        } catch {
            // File may not exist (e.g. pointer never written); ignore.
        }
    }

    // Keep the persisted-media allowlist in sync: a deleted/replaced video must
    // no longer be protected from stream-only pointer-replacement cleanup,
    // otherwise the list would guard a stale/empty slot.
    try {
        const { removePersistedMediaFile } = await import("../../../utils/localProjectSettings");
        await removePersistedMediaFile(tail, workspaceUri);
    } catch {
        // Non-fatal: allowlist hygiene only.
    }

    return deleted;
}

/**
 * Processes a video path and converts it to a webview-compatible URL.
 * Handles HTTP/HTTPS URLs, file:// URIs, and relative paths.
 * 
 * @param videoPath The video path (can be HTTP/HTTPS URL, file:// URI, or relative path)
 * @param webview The webview to convert file URIs for
 * @returns The processed video URL, or null if invalid/not found
 */
export function processVideoUrl(
    videoPath: string | undefined,
    webview: vscode.Webview
): string | null {
    if (!videoPath) return null;

    try {
        if (videoPath.startsWith("http://") || videoPath.startsWith("https://")) {
            // If it's a web URL, use it directly
            return videoPath;
        } else if (videoPath.startsWith("file://")) {
            // If it's a file URI, parse it and check if it's within the workspace
            const fileUri = vscode.Uri.parse(videoPath);
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;

            if (workspaceUri) {
                // Normalize paths for comparison (case-insensitive on Windows)
                const fileFsPath = fileUri.fsPath.replace(/\\/g, "/").toLowerCase();
                const workspaceFsPath = workspaceUri.fsPath.replace(/\\/g, "/").toLowerCase();

                // Check if the file is within the workspace
                if (fileFsPath.startsWith(workspaceFsPath + "/") || fileFsPath === workspaceFsPath) {
                    // File is within workspace, get relative path using fsPath
                    const relativeFsPath = fileUri.fsPath.substring(workspaceUri.fsPath.length);
                    // Remove leading path separator
                    const relativePath = relativeFsPath.replace(/^[/\\]+/, "");
                    // Convert to URI path format (forward slashes)
                    const normalizedRelativePath = relativePath.replace(/\\/g, "/");
                    const relativeUri = vscode.Uri.joinPath(workspaceUri, normalizedRelativePath);
                    return webview.asWebviewUri(relativeUri).toString();
                } else {
                    // File is outside workspace - VS Code webviews can't access it
                    console.warn(`Video file is outside workspace: ${fileUri.fsPath}`);
                    return null;
                }
            } else {
                // No workspace folder, try direct conversion (may fail for files outside workspace)
                return webview.asWebviewUri(fileUri).toString();
            }
        } else {
            // If it's a relative path, join it with the workspace URI
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (workspaceUri) {
                const fullPath = vscode.Uri.joinPath(workspaceUri, videoPath);
                return webview.asWebviewUri(fullPath).toString();
            }
        }
    } catch (err) {
        console.error("Error processing video URL:", err);
    }
    return null;
}
