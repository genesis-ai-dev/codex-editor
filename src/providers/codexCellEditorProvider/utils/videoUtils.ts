import * as vscode from "vscode";

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
