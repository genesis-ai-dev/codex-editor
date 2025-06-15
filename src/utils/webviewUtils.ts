import * as vscode from 'vscode';

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
        if (webviewPanel.visible) {
            webviewPanel.webview.postMessage(message);
            return true;
        }
        return false;
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