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
            // If it's a file URI, convert it to a webview URI
            return webview.asWebviewUri(vscode.Uri.parse(videoPath)).toString();
        } else {
            // If it's a relative path, join it with the workspace URI
            const workspaceUri = vscode.workspace.workspaceFolders?.[0]?.uri;
            if (workspaceUri) {
                // FIXME: if we don't add the video path, then you can use videos from anywhere on your machine
                const fullPath = vscode.Uri.joinPath(workspaceUri, videoPath);
                return webview.asWebviewUri(fullPath).toString();
            }
        }
    } catch (err) {
        console.error("Error processing video URL:", err);
    }
    return null;
}
