import * as vscode from "vscode";

class SourceUploadDocumentProvider implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    // provideTextDocumentContent(uri: vscode.Uri): string {
    //     console.log("provideTextDocumentContent called", { uri });
    //     // Generate and return the content for the virtual document
    //     return "Hello World";
    // }
    provideTextDocumentContent(uri: vscode.Uri): string {
        return "Source Upload Document Provider Content";
    }
}

export default SourceUploadDocumentProvider;
