import * as vscode from 'vscode';

/**
 * Wait for an extension to be activated
 * @param extensionId The extension ID to wait for
 * @param timeoutMs Optional timeout in milliseconds
 * @returns The extension or undefined if not found/timeout
 */
export async function waitForExtensionActivation(
    extensionId: string,
    timeoutMs: number = 10000
): Promise<vscode.Extension<any> | undefined> {
    const startTime = Date.now();
    
    while (Date.now() - startTime < timeoutMs) {
        const extension = vscode.extensions.getExtension(extensionId);
        if (extension) {
            if (!extension.isActive) {
                await extension.activate();
            }
            return extension;
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }
    
    return undefined;
}
