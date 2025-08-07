/**
 * Registry for download handlers that can be executed on the provider side
 * This allows plugins to define download logic while keeping execution on the backend
 */

export interface DownloadHandler {
    (): Promise<{
        success: boolean;
        data?: any;
        error?: string;
    }>;
}

export interface DownloadProgress {
    stage: string;
    message: string;
    progress: number;
}

// Registry of download handlers by plugin ID
const downloadHandlers = new Map<string, DownloadHandler>();

/**
 * Register a download handler for a plugin
 */
export function registerDownloadHandler(pluginId: string, handler: DownloadHandler): void {
    downloadHandlers.set(pluginId, handler);
}

/**
 * Get a download handler for a plugin
 */
export function getDownloadHandler(pluginId: string): DownloadHandler | undefined {
    return downloadHandlers.get(pluginId);
}

/**
 * Execute a download handler with progress reporting
 */
export async function executeDownloadHandler(
    pluginId: string,
    progressCallback?: (progress: DownloadProgress) => void
): Promise<{
    success: boolean;
    data?: any;
    error?: string;
}> {
    const handler = downloadHandlers.get(pluginId);
    if (!handler) {
        return {
            success: false,
            error: `No download handler registered for plugin: ${pluginId}`
        };
    }

    try {
        // Report initial progress
        progressCallback?.({
            stage: "downloading",
            message: "Initializing download...",
            progress: 0
        });

        // Execute the handler
        const result = await handler();

        // Report completion
        if (result.success) {
            progressCallback?.({
                stage: "complete",
                message: "Download complete!",
                progress: 100
            });
        }

        return result;
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : "Unknown error occurred"
        };
    }
}

// Import and register download handlers for specific plugins
import { maculaBibleDownloadHandler } from "./downloadHandlers/maculaBibleHandler";

// Register the Macula Bible download handler
registerDownloadHandler("macula-bible", maculaBibleDownloadHandler); 