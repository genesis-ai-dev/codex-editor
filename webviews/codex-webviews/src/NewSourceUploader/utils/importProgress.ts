/**
 * Utilities for notifying the provider when an import starts/ends.
 * This disables the sync button immediately when the user clicks Import,
 * preventing sync during download/processing before writeNotebooks is sent.
 */

const vscode: { postMessage: (message: { command: string }) => void } =
    (window as any).vscodeApi;

/**
 * Call at the very start of any import handler (before any async work).
 * Disables the sync button until notifyImportEnded is called.
 */
export function notifyImportStarted(): void {
    vscode?.postMessage({ command: "importStarted" });
}

/**
 * Call when an import handler finishes (success, error, or cancel).
 * Must be paired with notifyImportStarted. Use in a finally block.
 */
export function notifyImportEnded(): void {
    vscode?.postMessage({ command: "importEnded" });
}
