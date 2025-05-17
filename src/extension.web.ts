import * as vscode from 'vscode';
import { registerProjectManagerViewWebviewProvider } from './projectManager/projectManagerViewProvider.web';

// Web-specific initialization
export async function activate(context: vscode.ExtensionContext) {
    console.log('Codex Editor Extension (Web) is now active');
    console.log('Extension context:', {
        extensionPath: context.extensionPath,
        globalStoragePath: context.globalStoragePath,
        logPath: context.logPath,
        storagePath: context.storagePath
    });

    try {
        console.log('Attempting to register webview providers...');
        // Register web-compatible webview providers
        registerProjectManagerViewWebviewProvider(context);
        console.log('Successfully registered webview providers');

        // Register web-compatible commands
        console.log('Registering web commands...');
        let disposable = vscode.commands.registerCommand('codex-editor-extension.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from Codex Editor Web!');
        });

        context.subscriptions.push(disposable);
        console.log('Successfully registered web commands');

        // Show welcome message
        vscode.window.showInformationMessage('Welcome to Codex Editor Web!');
    } catch (error) {
        console.error('Error activating Codex Editor Web:', error);
        // Log more details about the error
        if (error instanceof Error) {
            console.error('Error name:', error.name);
            console.error('Error message:', error.message);
            console.error('Error stack:', error.stack);
        }
        vscode.window.showErrorMessage('Failed to activate Codex Editor Web. Please check the console for details.');
    }
}

export function deactivate() {
    // Clean up web-specific resources
    console.log('Codex Editor Extension (Web) is now deactivated');
} 