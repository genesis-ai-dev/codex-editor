/**
 * Helper utility to ensure VS Code API is acquired only once.
 * This prevents the "An instance of the VS Code API has already been acquired" error.
 */

// Declare the acquireVsCodeApi function that's globally available in VS Code webviews
declare function acquireVsCodeApi(): any;

// Store a single instance of the VS Code API
let vscodeApiInstance: any | undefined = undefined;

/**
 * Get the VS Code API instance, acquiring it only once.
 * @returns The VS Code API instance
 */
export function getVSCodeAPI() {
    if (!vscodeApiInstance) {
        try {
            vscodeApiInstance = acquireVsCodeApi();
        } catch (error) {
            console.error("Failed to acquire VS Code API:", error);
            // Fallback object with postMessage that logs errors
            vscodeApiInstance = {
                postMessage: (message: any) => {
                    console.error("Unable to post message due to missing VS Code API:", message);
                },
            };
        }
    }
    return vscodeApiInstance;
}
