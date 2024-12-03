import * as vscode from "vscode";

export const registerCellEditorCommands = (
    context: vscode.ExtensionContext,
    updateCellContent: (cellId: string, text: string) => void
) => {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-cell-editor.updateCellContent",
            (cellId: string, text: string) => updateCellContent(cellId, text)
        )
    );
};
