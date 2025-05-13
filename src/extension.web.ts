import * as vscode from 'vscode';

// Web-specific initialization
export async function activate(context: vscode.ExtensionContext) {
    // Initialize web-specific features
    console.log('Codex Editor Extension (Web) is now active');

    // Register web-compatible commands
    let disposable = vscode.commands.registerCommand('codex-editor-extension.helloWorld', () => {
        vscode.window.showInformationMessage('Hello World from Codex Editor Web!');
    });

    context.subscriptions.push(disposable);
}

export function deactivate() {
    // Clean up web-specific resources
} 