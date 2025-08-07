import { DownloadProgress } from "../types/plugin";

// Get the VSCode API that was set up in the HTML
const vscode: { postMessage: (message: any) => void; } = (window as any).vscodeApi;

/**
 * Helper function for plugins to request downloads from the provider
 * This creates the downloadResource helper that gets passed to plugin components
 */
export function createDownloadHelper(): (
    pluginId: string,
    progressCallback?: (progress: DownloadProgress) => void
) => Promise<any> {
    return (pluginId: string, progressCallback?: (progress: DownloadProgress) => void): Promise<any> => {
        return new Promise((resolve, reject) => {
            const requestId = `download-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;

            // Set up message listener for this specific request
            const handleMessage = (event: MessageEvent) => {
                const message = event.data;

                if (message.requestId !== requestId) {
                    return; // Not for this request
                }

                if (message.command === "downloadResourceProgress") {
                    progressCallback?.(message.progress);
                } else if (message.command === "downloadResourceComplete") {
                    // Clean up listener
                    window.removeEventListener("message", handleMessage);

                    if (message.success) {
                        resolve(message.data);
                    } else {
                        reject(new Error(message.error || "Download failed"));
                    }
                }
            };

            // Add message listener
            window.addEventListener("message", handleMessage);

            // Send download request to provider
            vscode.postMessage({
                command: "downloadResource",
                pluginId: pluginId,
                requestId: requestId
            });

            // Set up timeout to avoid hanging requests
            setTimeout(() => {
                window.removeEventListener("message", handleMessage);
                reject(new Error("Download request timed out"));
            }, 60000); // 60 second timeout
        });
    };
} 