import * as vscode from "vscode";

export const registerCellEditorCommands = (
    context: vscode.ExtensionContext,
    openCellById: (cellId: string, text: string) => void
) => {
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-cell-editor.openCellById",
            (cellId: string, text: string) => openCellById(cellId, text)
        )
    );
};
