import * as vscode from 'vscode';
import { registerProjectManagerViewWebviewProvider } from './projectManager/projectManagerViewProvider.web';
import { initializeStateStore } from './stateStore.web';

/**
 * Logs the activation status of all extensions to help diagnose dependency issues
 */
function logExtensionActivationStatus() {
    const extensions = vscode.extensions.all;
    console.log('[Web] All extensions:', extensions.map(ext => ({
        id: ext.id,
        isActive: ext.isActive,
        exports: ext.exports ? 'Has exports' : 'No exports'
    })));

    const stateStoreExt = extensions.find(ext => ext.id.includes('shared-state-store'));
    if (stateStoreExt) {
        console.log('[Web] Shared state store found:', {
            id: stateStoreExt.id,
            isActive: stateStoreExt.isActive,
            exports: stateStoreExt.exports ? 'Has exports' : 'No exports'
        });
    } else {
        console.log('[Web] Shared state store extension not found');
    }
}

// Web-specific initialization
export async function activate(context: vscode.ExtensionContext) {
    console.log('Codex Editor Extension (Web) is now active');

    try {
        // Log extension status to help with diagnosis
        logExtensionActivationStatus();

        // Check for the state store extension first and log its status
        const stateStore = await initializeStateStore();
        console.log('[Web] State store initialization result:', 
            stateStore ? 'Successfully initialized' : 'Failed to initialize');

        // Register web-compatible webview providers
        registerProjectManagerViewWebviewProvider(context);

        // Register web-compatible commands
        let disposable = vscode.commands.registerCommand('codex-editor-extension.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from Codex Editor Web!');
        });

        // Add a diagnostic command to check extension status at any time
        let diagnosticDisposable = vscode.commands.registerCommand('codex-editor-extension.diagnoseExtensions', () => {
            logExtensionActivationStatus();
            vscode.window.showInformationMessage('Extension diagnostic info logged to console');
        });

        context.subscriptions.push(disposable, diagnosticDisposable);

        // Show welcome message with diagnostic info
        vscode.window.showInformationMessage('Welcome to Codex Editor Web! Run the "Diagnose Extensions" command if you experience issues.');
    } catch (error) {
        console.error('Error activating Codex Editor Web:', error);
        vscode.window.showErrorMessage('Failed to activate Codex Editor Web. Please check the console for details.');
    }
}

export function deactivate() {
    // Clean up web-specific resources
    console.log('Codex Editor Extension (Web) is now deactivated');
} 