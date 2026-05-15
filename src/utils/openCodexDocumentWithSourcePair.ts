import * as path from "path";
import * as vscode from "vscode";

/**
 * Opens the paired source (.source) and target (.codex) notebooks in split editors
 * (source in ViewColumn.One, target in ViewColumn.Two). Matches navigation webview behavior.
 */
export async function openCodexDocumentWithSourcePair(
    codexUri: vscode.Uri,
    workspaceFolderUri: vscode.Uri | undefined
): Promise<void> {
    const normalizedPath = codexUri.fsPath.replace(/\\/g, "/");

    if (!workspaceFolderUri) {
        await vscode.commands.executeCommand("vscode.openWith", codexUri, "codex.cellEditor");
        return;
    }

    try {
        const baseFileName = path.basename(normalizedPath);
        const sourceFileName = baseFileName.replace(".codex", ".source");
        const sourceUri = vscode.Uri.joinPath(
            workspaceFolderUri,
            ".project",
            "sourceTexts",
            sourceFileName
        );

        await vscode.commands.executeCommand(
            "vscode.openWith",
            sourceUri,
            "codex.cellEditor",
            { viewColumn: vscode.ViewColumn.One }
        );

        try {
            const { CodexCellEditorProvider } = await import(
                "../providers/codexCellEditorProvider/codexCellEditorProvider"
            );
            const provider = CodexCellEditorProvider.getInstance();
            if (provider) {
                await provider.waitForWebviewReady(sourceUri.toString(), 3000);
            } else {
                await new Promise((resolve) => setTimeout(resolve, 100));
            }
        } catch {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }

        await vscode.commands.executeCommand(
            "vscode.openWith",
            codexUri,
            "codex.cellEditor",
            { viewColumn: vscode.ViewColumn.Two }
        );
    } catch (sourceError) {
        console.warn("Could not open source file:", sourceError);
        await vscode.commands.executeCommand(
            "vscode.openWith",
            codexUri,
            "codex.cellEditor",
            { viewColumn: vscode.ViewColumn.Two }
        );
    }
}
