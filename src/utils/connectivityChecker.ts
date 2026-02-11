import * as vscode from "vscode";

/**
 * Simple connectivity check using VS Code's built-in fetch
 * @returns Promise<boolean> - true if online, false if offline
 */
export async function isOnline(): Promise<boolean> {
    try {
        // Quick check using a reliable endpoint
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 3000);
        
        const response = await fetch("https://www.google.com", {
            method: "HEAD",
            signal: controller.signal,
        });
        
        clearTimeout(timeout);
        return response.ok;
    } catch {
        return false;
    }
}

/**
 * Shows a blocking modal that waits for internet connectivity to be restored.
 * Polls every 5 seconds until online.
 * @param operation - Description of the operation waiting for connectivity
 * @returns Promise<void> - resolves when connectivity is restored
 */
export async function waitForConnectivity(operation: string = "operation"): Promise<void> {
    const checkInterval = 5000; // Check every 5 seconds
    let attempt = 0;

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: `⚠️ No Internet Connection`,
            cancellable: false,
        },
        async (progress) => {
            const checkConnectivity = async (): Promise<void> => {
                attempt++;
                const online = await isOnline();
                
                if (online) {
                    progress.report({
                        message: `✅ Connection restored! Continuing ${operation}...`,
                    });
                    await new Promise((r) => setTimeout(r, 1000));
                    return;
                }
                
                progress.report({
                    message: `Cannot continue ${operation} without internet. Retrying (attempt ${attempt})...`,
                });
                
                await new Promise((r) => setTimeout(r, checkInterval));
                return checkConnectivity();
            };

            return checkConnectivity();
        }
    );
}

/**
 * Ensures connectivity before starting an operation.
 * If offline, blocks and waits for connectivity to be restored.
 */
export async function ensureConnectivity(operation: string = "operation"): Promise<void> {
    const online = await isOnline();
    
    if (!online) {
        await waitForConnectivity(operation);
    }
}

/**
 * Categorizes errors to provide appropriate handling and user feedback
 */
export enum ErrorType {
    NETWORK = "network",
    DISK_FULL = "disk_full",
    PERMISSION = "permission",
    SERVER_UNREACHABLE = "server_unreachable",
    UNKNOWN = "unknown"
}

export interface CategorizedError {
    type: ErrorType;
    originalError: Error;
    userMessage: string;
    canRetry: boolean;
    requiresConnectivity: boolean;
}

/**
 * Categorizes an error based on its properties and message
 */
export function categorizeError(error: unknown): CategorizedError {
    const err = error instanceof Error ? error : new Error(String(error));
    const message = err.message.toLowerCase();

    // Network errors
    if (
        message.includes("enotfound") ||
        message.includes("etimedout") ||
        message.includes("econnrefused") ||
        message.includes("econnreset") ||
        message.includes("network") ||
        message.includes("fetch failed") ||
        message.includes("getaddrinfo")
    ) {
        return {
            type: ErrorType.NETWORK,
            originalError: err,
            userMessage: "Network connection lost. Waiting for connectivity to be restored...",
            canRetry: true,
            requiresConnectivity: true,
        };
    }

    // Disk full errors
    if (
        message.includes("enospc") ||
        message.includes("no space left") ||
        message.includes("disk full") ||
        message.includes("quota exceeded")
    ) {
        return {
            type: ErrorType.DISK_FULL,
            originalError: err,
            userMessage: "Disk is full. Please free up space and try again.",
            canRetry: false,
            requiresConnectivity: false,
        };
    }

    // Permission errors
    if (
        message.includes("eacces") ||
        message.includes("eperm") ||
        message.includes("permission denied") ||
        message.includes("access denied")
    ) {
        return {
            type: ErrorType.PERMISSION,
            originalError: err,
            userMessage: "Permission denied. Please check file/folder permissions.",
            canRetry: false,
            requiresConnectivity: false,
        };
    }

    // Server unreachable (but we have internet)
    if (
        message.includes("404") ||
        message.includes("403") ||
        message.includes("500") ||
        message.includes("502") ||
        message.includes("503") ||
        message.includes("repository not found") ||
        message.includes("remote repository") ||
        message.includes("could not read from remote")
    ) {
        return {
            type: ErrorType.SERVER_UNREACHABLE,
            originalError: err,
            userMessage: "Server is unreachable or repository not accessible. Please try again later.",
            canRetry: true,
            requiresConnectivity: false,
        };
    }

    // Unknown error
    return {
        type: ErrorType.UNKNOWN,
        originalError: err,
        userMessage: err.message || "An unexpected error occurred.",
        canRetry: false,
        requiresConnectivity: false,
    };
}

/**
 * Handles an error during update, providing appropriate feedback and retry logic
 */
export async function handleUpdateError(
    error: unknown,
    operation: string,
    retryFn?: () => Promise<void>
): Promise<void> {
    const categorized = categorizeError(error);

    switch (categorized.type) {
        case ErrorType.NETWORK:
            // Wait for connectivity and retry if function provided
            vscode.window.showWarningMessage(
                `Network connection lost during ${operation}. Waiting for connectivity...`
            );
            await waitForConnectivity(operation);
            
            if (retryFn) {
                await retryFn();
            }
            break;

        case ErrorType.DISK_FULL:
            vscode.window.showErrorMessage(
                `Cannot complete ${operation}: ${categorized.userMessage}`,
                { modal: true }
            );
            throw categorized.originalError;

        case ErrorType.PERMISSION:
            vscode.window.showErrorMessage(
                `Cannot complete ${operation}: ${categorized.userMessage}`,
                { modal: true }
            );
            throw categorized.originalError;

        case ErrorType.SERVER_UNREACHABLE: {
            const retry = await vscode.window.showErrorMessage(
                `${categorized.userMessage}\n\nOperation: ${operation}`,
                { modal: true },
                "Retry",
                "Cancel"
            );
            
            if (retry === "Retry" && retryFn) {
                await retryFn();
            } else {
                throw categorized.originalError;
            }
            break;
        }

        case ErrorType.UNKNOWN:
        default:
            vscode.window.showErrorMessage(
                `Failed during ${operation}: ${categorized.userMessage}`,
                { modal: true }
            );
            throw categorized.originalError;
    }
}
