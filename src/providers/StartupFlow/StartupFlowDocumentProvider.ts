import * as vscode from "vscode";

class StartupFlowDocumentProvider implements vscode.TextDocumentContentProvider {
    onDidChangeEmitter = new vscode.EventEmitter<vscode.Uri>();
    onDidChange = this.onDidChangeEmitter.event;

    // provideTextDocumentContent(uri: vscode.Uri): string {
    //     console.log("provideTextDocumentContent called", { uri });
    //     // Generate and return the content for the virtual document
    //     return "Hello World";
    // }
    provideTextDocumentContent(uri: vscode.Uri): string {
        return "Startup Flow Document Provider Content";
    }
}

export default StartupFlowDocumentProvider;
