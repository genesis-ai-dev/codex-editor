import * as path from "path";
import * as vscode from "vscode";

export type OpenCodexDocumentOptions = {
    /**
     * Open the target beside the top editor group.
     * Use this when ViewColumn.Two is already a pane below the editors
     * (for example the footnotes list), so the target is not placed there.
     */
    openTargetBesideTopGroup?: boolean;
};

/**
 * Opens the paired source (.source) and target (.codex) notebooks in split editors
 * (source in ViewColumn.One, target in ViewColumn.Two). Matches navigation webview behavior.
 */
export async function openCodexDocumentWithSourcePair(
    codexUri: vscode.Uri,
    workspaceFolderUri: vscode.Uri | undefined,
    options?: OpenCodexDocumentOptions
): Promise<void> {
    const normalizedPath = codexUri.fsPath.replace(/\\/g, "/");

    // Resolve the editor provider once so we can wait for each pane's webview to
    // become ready before returning. Callers frequently publish a navigation jump
    // (e.g. the `cellToJumpTo` workspace-state key) immediately after this resolves.
    // The provider registers that jump listener while resolving each editor, and
    // `waitForWebviewReady` only returns once a pane has signalled ready (i.e. after
    // it resolved + registered its listener). If we don't wait for the TARGET pane,
    // a cold-opened editor can miss the jump and land on chapter 1 instead of the
    // requested cell. See issue #996.
    let provider:
        | { waitForWebviewReady(uri: string, maxWaitMs?: number): Promise<boolean>; }
        | undefined;
    try {
        const { CodexCellEditorProvider } = await import(
            "../providers/codexCellEditorProvider/codexCellEditorProvider"
        );
        provider = CodexCellEditorProvider.getInstance() ?? undefined;
    } catch {
        provider = undefined;
    }
    const waitForPaneReady = async (uri: vscode.Uri) => {
        if (provider) {
            await provider.waitForWebviewReady(uri.toString(), 3000);
        } else {
            await new Promise((resolve) => setTimeout(resolve, 100));
        }
    };

    if (!workspaceFolderUri) {
        await vscode.commands.executeCommand("vscode.openWith", codexUri, "codex.cellEditor");
        await waitForPaneReady(codexUri);
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
        await waitForPaneReady(sourceUri);

        const targetViewColumn = await resolveTargetViewColumn(options);
        await vscode.commands.executeCommand(
            "vscode.openWith",
            codexUri,
            "codex.cellEditor",
            { viewColumn: targetViewColumn }
        );
        await waitForPaneReady(codexUri);
    } catch (sourceError) {
        console.warn("Could not open source file:", sourceError);
        const targetViewColumn = await resolveTargetViewColumn(options);
        await vscode.commands.executeCommand(
            "vscode.openWith",
            codexUri,
            "codex.cellEditor",
            { viewColumn: targetViewColumn }
        );
        await waitForPaneReady(codexUri);
    }
}

/**
 * ViewColumn.Two is the second editor group. When the footnotes list is that
 * group, opening the target there splits the list. Focusing the top group and
 * using Beside places the target next to the source instead.
 */
async function resolveTargetViewColumn(
    options: OpenCodexDocumentOptions | undefined
): Promise<vscode.ViewColumn> {
    if (!options?.openTargetBesideTopGroup) {
        return vscode.ViewColumn.Two;
    }
    await vscode.commands.executeCommand("workbench.action.focusFirstEditorGroup");
    return vscode.ViewColumn.Beside;
}
