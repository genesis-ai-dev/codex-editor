import * as vscode from "vscode";
import { CodexCellEditorProvider } from "./codexCellEditorProvider";

export const registerCellEditorCommands = (
    context: vscode.ExtensionContext,
    updateCellContent: (cellId: string, text: string, webviewPanel: vscode.WebviewPanel) => void,
    webviewPanel: vscode.WebviewPanel
) => {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-cell-editor.updateCellContent",
            (cellId: string, text: string) => {
                console.log("updateCellContent", cellId, text);
                vscode.commands.executeCommand("parallel-passages-sidebar.focus");
                // Wait for the webview to be ready
                setTimeout(() => {
                    updateCellContent(cellId, text, webviewPanel);
                }, 100);
            }
        )
    );
};
