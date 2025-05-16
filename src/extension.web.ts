import * as vscode from 'vscode';
import { registerProjectManagerViewWebviewProvider } from './projectManager/projectManagerViewProvider';

// Web-specific initialization
export async function activate(context: vscode.ExtensionContext) {
    console.log('Codex Editor Extension (Web) is now active');

    try {
        // Register web-compatible webview providers
        registerProjectManagerViewWebviewProvider(context);

        // Register web-compatible commands
        let disposable = vscode.commands.registerCommand('codex-editor-extension.helloWorld', () => {
            vscode.window.showInformationMessage('Hello World from Codex Editor Web!');
        });

        context.subscriptions.push(disposable);

        // Show welcome message
        vscode.window.showInformationMessage('Welcome to Codex Editor Web!');
    } catch (error) {
        console.error('Error activating Codex Editor Web:', error);
        vscode.window.showErrorMessage('Failed to activate Codex Editor Web. Please check the console for details.');
    }
}

export function deactivate() {
    // Clean up web-specific resources
    console.log('Codex Editor Extension (Web) is now deactivated');
} 