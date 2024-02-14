// import * as vscode from 'vscode';
// import { DictionaryTablePanel } from './DictionaryTablePanel';

// export class DictionaryTableCustomEditorProvider implements vscode.CustomEditorProvider {
//     constructor(private context: vscode.ExtensionContext) {}

//     public async resolveCustomEditor(
//         document: vscode.CustomDocument,
//         webviewPanel: vscode.WebviewPanel,
//         token: vscode.CancellationToken
//     ): Promise<void> {
//         // Here, you can use the existing DictionaryTablePanel logic
//         DictionaryTablePanel.createOrShow(document.uri, this.context.extensionUri, webviewPanel);
//     }

//     // Implement required methods
//     public onDidChangeCustomDocument(e: vscode.CustomDocumentEditEvent<vscode.CustomDocument>): void {
//         // Handle document changes
//     }

//     public saveCustomDocument(document: vscode.CustomDocument, cancellation: vscode.CancellationToken): Thenable<void> {
//         // Handle save
//         return Promise.resolve();
//     }

//     public saveCustomDocumentAs(document: vscode.CustomDocument, destination: vscode.Uri, cancellation: vscode.CancellationToken): Thenable<void> {
//         // Handle save as
//         return Promise.resolve();
//     }

//     public revertCustomDocument(document: vscode.CustomDocument, cancellation: vscode.CancellationToken): Thenable<void> {
//         // Handle revert
//         return Promise.resolve();
//     }

//     public backupCustomDocument(document: vscode.CustomDocument, context: vscode.CustomDocumentBackupContext, cancellation: vscode.CancellationToken): Thenable<vscode.CustomDocumentBackup> {
//         // Handle backup
//         return Promise.resolve({ id: '' }); // Provide a meaningful implementation
//     }
// }