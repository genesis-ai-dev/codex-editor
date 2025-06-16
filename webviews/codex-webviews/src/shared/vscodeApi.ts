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
    // Check if we're in a VSCode webview context
    const isInVSCodeContext = typeof acquireVsCodeApi === 'function';
    
    if (!vscodeApiInstance) {
        try {
            if (isInVSCodeContext) {
                vscodeApiInstance = acquireVsCodeApi();
            } else {
                throw new Error("Not in a VS Code webview context");
            }
        } catch (error) {
            console.error("Failed to acquire VS Code API:", error);
            
            // Create a safe fallback object that won't throw errors
            vscodeApiInstance = {
                postMessage: (message: any) => {
                    console.warn("Unable to post message; not in a VS Code context:", message);
                    return false; // Return a value to prevent undefined errors
                },
                getState: () => ({}),
                setState: () => { }
            };
        }
    }
    
    // Add a safety check in case the instance is still somehow undefined
    if (!vscodeApiInstance) {
        console.warn("Creating emergency fallback VS Code API instance");
        vscodeApiInstance = {
            postMessage: (message: any) => {
                console.warn("Emergency fallback: Unable to post message:", message);
                return false;
            },
            getState: () => ({}),
            setState: () => { }
        };
    }
    
    return vscodeApiInstance;
}
