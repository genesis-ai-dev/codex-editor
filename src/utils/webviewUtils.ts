import * as vscode from 'vscode';
import * as path from 'path';
import { CodexCellEditorProvider } from '../providers/codexCellEditorProvider/codexCellEditorProvider';

/**
 * Utility functions for safe webview operations that handle disposal gracefully
 */

/**
 * Safely post a message to a webview, handling disposal errors gracefully
 * @param webview The webview to send the message to
 * @param message The message to send
 * @param context Optional context for logging (e.g., "StartupFlow", "ProjectManager")
 * @returns true if message was sent successfully, false if webview was disposed
 */
export function safePostMessage(
    webview: vscode.Webview | undefined | null,
    message: any,
    context?: string
): boolean {
    if (!webview) {
        return false;
    }

    try {
        webview.postMessage(message);
        return true;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview disposed while sending message, skipping`);
        } else {
            console.debug("Webview disposed while sending message, skipping");
        }
        return false;
    }
}

/**
 * Safely check if a webview panel is visible, handling disposal errors gracefully
 * @param webviewPanel The webview panel to check
 * @param context Optional context for logging
 * @returns true if visible, false if not visible or disposed
 */
export function safeIsVisible(
    webviewPanel: vscode.WebviewPanel | undefined | null,
    context?: string
): boolean {
    if (!webviewPanel) {
        return false;
    }

    try {
        return webviewPanel.visible;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview panel disposed while checking visibility`);
        } else {
            console.debug("Webview panel disposed while checking visibility");
        }
        return false;
    }
}

/**
 * Safely set webview HTML, handling disposal errors gracefully
 * @param webview The webview to set HTML for
 * @param html The HTML content to set
 * @param context Optional context for logging
 * @returns true if HTML was set successfully, false if webview was disposed
 */
export function safeSetHtml(
    webview: vscode.Webview | undefined | null,
    html: string,
    context?: string
): boolean {
    if (!webview) {
        return false;
    }

    try {
        webview.html = html;
        return true;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview disposed while setting HTML, skipping`);
        } else {
            console.debug("Webview disposed while setting HTML, skipping");
        }
        return false;
    }
}

/**
 * Safely set webview options, handling disposal errors gracefully
 * @param webview The webview to set options for
 * @param options The options to set
 * @param context Optional context for logging
 * @returns true if options were set successfully, false if webview was disposed
 */
export function safeSetOptions(
    webview: vscode.Webview | undefined | null,
    options: vscode.WebviewOptions,
    context?: string
): boolean {
    if (!webview) {
        return false;
    }

    try {
        webview.options = options;
        return true;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview disposed while setting options, skipping`);
        } else {
            console.debug("Webview disposed while setting options, skipping");
        }
        return false;
    }
}

/**
 * Safely access webview CSP source, handling disposal errors gracefully
 * @param webview The webview to get CSP source from
 * @param context Optional context for logging
 * @returns CSP source string or empty string if webview was disposed
 */
export function safeGetCspSource(
    webview: vscode.Webview | undefined | null,
    context?: string
): string {
    if (!webview) {
        return '';
    }

    try {
        return webview.cspSource;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview disposed while getting CSP source`);
        } else {
            console.debug("Webview disposed while getting CSP source");
        }
        return '';
    }
}

/**
 * Safely execute a function that operates on a webview, with automatic disposal handling
 * @param webview The webview to operate on
 * @param operation The operation to perform
 * @param context Optional context for logging
 * @returns The result of the operation, or undefined if webview was disposed
 */
export function safeWebviewOperation<T>(
    webview: vscode.Webview | vscode.WebviewPanel | undefined | null,
    operation: (webview: vscode.Webview | vscode.WebviewPanel) => T,
    context?: string
): T | undefined {
    if (!webview) {
        return undefined;
    }

    try {
        return operation(webview);
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview disposed during operation, skipping`);
        } else {
            console.debug("Webview disposed during operation, skipping");
        }
        return undefined;
    }
}

/**
 * Safely post a message to a webview panel, checking visibility first
 * @param webviewPanel The webview panel to send the message to
 * @param message The message to send
 * @param context Optional context for logging
 * @returns true if message was sent successfully, false if panel was disposed or not visible
 */
export function safePostMessageToPanel(
    webviewPanel: vscode.WebviewPanel | undefined | null,
    message: any,
    context?: string
): boolean {
    if (!webviewPanel) {
        return false;
    }

    try {
        // Always attempt to post; the webview will queue if not yet ready/visible
        webviewPanel.webview.postMessage(message);
        return true;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview panel disposed while sending message, skipping`);
        } else {
            console.debug("Webview panel disposed while sending message, skipping");
        }
        return false;
    }
}

/**
 * Create a safe webview message sender that automatically handles disposal
 * @param webviewPanel The webview panel to create a sender for
 * @param context Optional context for logging
 * @returns A function that safely sends messages
 */
export function createSafeMessageSender(
    webviewPanel: vscode.WebviewPanel | undefined | null,
    context?: string
): (message: any) => boolean {
    return (message: any) => safePostMessageToPanel(webviewPanel, message, context);
}

/**
 * Wrapper for webview view providers to safely post messages
 * @param webviewView The webview view to send the message to
 * @param message The message to send
 * @param context Optional context for logging
 * @returns true if message was sent successfully, false if view was disposed
 */
export function safePostMessageToView(
    webviewView: vscode.WebviewView | undefined | null,
    message: any,
    context?: string
): boolean {
    if (!webviewView) {
        return false;
    }

    try {
        webviewView.webview.postMessage(message);
        return true;
    } catch (error) {
        if (context) {
            console.debug(`[${context}] Webview view disposed while sending message, skipping`);
        } else {
            console.debug("Webview view disposed while sending message, skipping");
        }
        return false;
    }
}

/**
 * Check if a file exists at the given URI
 * @param uri The URI to check
 * @returns true if the file exists, false otherwise
 */
export async function fileExists(uri: vscode.Uri): Promise<boolean> {
    try {
        await vscode.workspace.fs.stat(uri);
        return true;
    } catch {
        return false;
    }
}

/**
 * Close webviews for deleted files and their corresponding pairs
 * If a .codex file is deleted, also closes its .source webview
 * If a .source file is deleted, also closes its .codex webview
 * @param deletedFilePaths Array of relative file paths (e.g., ".project/targetTexts/file.codex")
 * @param workspaceFolder The workspace folder to resolve paths against
 */
export async function closeWebviewsForDeletedFiles(
    deletedFilePaths: string[],
    workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
    const codexEditorProvider = CodexCellEditorProvider.getInstance();
    if (!codexEditorProvider) {
        return;
    }

    const webviewPanels = codexEditorProvider.getWebviewPanels();

    // Helper function to find and close a panel by URI
    const closePanelByUri = (uri: vscode.Uri) => {
        // Try to find the panel by URI string match first
        let panelToClose = webviewPanels.get(uri.toString());
        // If not found, try matching by fsPath (handles URI format differences)
        if (!panelToClose) {
            for (const [panelUri, panel] of webviewPanels.entries()) {
                const panelUriObj = vscode.Uri.parse(panelUri);
                if (panelUriObj.fsPath === uri.fsPath) {
                    panelToClose = panel;
                    break;
                }
            }
        }
        if (panelToClose) {
            panelToClose.dispose();
        }
    };

    // Process each deleted file
    for (const deletedPath of deletedFilePaths) {
        // Normalize path (replace backslashes, remove leading slashes) and split into segments
        const normalizedPath = deletedPath.replace(/\\/g, "/").replace(/^\/+/, "");
        const pathSegments = normalizedPath.split("/").filter(Boolean);

        // Convert relative path to absolute URI
        const deletedUri = vscode.Uri.joinPath(workspaceFolder.uri, ...pathSegments);

        // Close the webview for the deleted file itself
        closePanelByUri(deletedUri);

        // Determine if this is a codex or source file and find its pair
        const fileName = path.basename(normalizedPath);
        const isCodexFile = fileName.endsWith('.codex');
        const isSourceFile = fileName.endsWith('.source');

        if (isCodexFile) {
            // If a .codex file is deleted, also close its corresponding .source webview
            const baseFileName = fileName.replace('.codex', '.source');
            const sourceUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                '.project',
                'sourceTexts',
                baseFileName
            );
            closePanelByUri(sourceUri);
        } else if (isSourceFile) {
            // If a .source file is deleted, also close its corresponding .codex webview
            const baseFileName = fileName.replace('.source', '.codex');
            // Source files are in .project/sourceTexts/, codex files are in .project/targetTexts/
            const codexUri = vscode.Uri.joinPath(
                workspaceFolder.uri,
                '.project',
                'targetTexts',
                baseFileName
            );
            closePanelByUri(codexUri);
        }
    }
}

/**
 * Close webviews for files that no longer exist on disk
 * This handles cases where webviews were restored from a previous session
 * but the files were deleted (e.g., by another client or in a previous session)
 * @param workspaceFolder The workspace folder to resolve paths against
 */
export async function closeWebviewsForNonExistentFiles(
    workspaceFolder: vscode.WorkspaceFolder
): Promise<void> {
    const codexEditorProvider = CodexCellEditorProvider.getInstance();
    if (!codexEditorProvider) {
        return;
    }

    const webviewPanels = codexEditorProvider.getWebviewPanels();
    const panelsToClose: vscode.WebviewPanel[] = [];

    // Check each open webview panel
    for (const [panelUriStr, panel] of webviewPanels.entries()) {
        try {
            const panelUri = vscode.Uri.parse(panelUriStr);
            // Check if the file still exists
            if (!(await fileExists(panelUri))) {
                panelsToClose.push(panel);

                // Also check for paired files (.codex <-> .source)
                const fileName = path.basename(panelUri.fsPath);
                const isCodexFile = fileName.endsWith('.codex');
                const isSourceFile = fileName.endsWith('.source');

                if (isCodexFile) {
                    // Check if corresponding .source file exists and close its webview if it doesn't
                    const baseFileName = fileName.replace('.codex', '.source');
                    const sourceUri = vscode.Uri.joinPath(
                        workspaceFolder.uri,
                        '.project',
                        'sourceTexts',
                        baseFileName
                    );
                    const sourcePanel = webviewPanels.get(sourceUri.toString());
                    if (sourcePanel && !(await fileExists(sourceUri))) {
                        // Avoid adding the same panel twice
                        if (!panelsToClose.includes(sourcePanel)) {
                            panelsToClose.push(sourcePanel);
                        }
                    }
                } else if (isSourceFile) {
                    // Check if corresponding .codex file exists and close its webview if it doesn't
                    const baseFileName = fileName.replace('.source', '.codex');
                    const codexUri = vscode.Uri.joinPath(
                        workspaceFolder.uri,
                        '.project',
                        'targetTexts',
                        baseFileName
                    );
                    const codexPanel = webviewPanels.get(codexUri.toString());
                    if (codexPanel && !(await fileExists(codexUri))) {
                        // Avoid adding the same panel twice
                        if (!panelsToClose.includes(codexPanel)) {
                            panelsToClose.push(codexPanel);
                        }
                    }
                }
            }
        } catch (error) {
            // Skip invalid URIs
            console.warn(`[webviewUtils] Error checking webview panel ${panelUriStr}:`, error);
        }
    }

    // Close all panels that point to non-existent files
    for (const panel of panelsToClose) {
        try {
            panel.dispose();
        } catch (error) {
            console.warn(`[webviewUtils] Error disposing webview panel:`, error);
        }
    }

    if (panelsToClose.length > 0) {
        console.debug(`[webviewUtils] Closed ${panelsToClose.length} webview(s) for non-existent files`);
    }
} 