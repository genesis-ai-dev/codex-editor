import * as vscode from "vscode";

// FIXME: move notebook format migration here

export const migration_changeDraftFolderToFilesFolder = async () => {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        const rootUri = workspaceFolders[0].uri;
        const metadataUri = vscode.Uri.joinPath(rootUri, "metadata.json");
        const draftsUri = vscode.Uri.joinPath(rootUri, "drafts");
        const filesUri = vscode.Uri.joinPath(rootUri, "files");

        try {
            // Check if the 'metadata.json' file exists
            await vscode.workspace.fs.stat(metadataUri);

            // Check if the 'drafts' folder exists
            try {
                const draftsFolder = await vscode.workspace.fs.readDirectory(draftsUri);

                // If the read succeeds, the folder exists, and we can attempt to rename it
                if (draftsFolder) {
                    await vscode.workspace.fs.rename(draftsUri, filesUri, {
                        overwrite: false,
                    });
                    console.log('Renamed "drafts" folder to "files".');
                }
            } catch (error) {
                // If the 'drafts' folder doesn't exist, we quietly pass
                console.log('The "drafts" folder does not exist. No action needed.');
            }
        } catch (error) {
            console.log('The "metadata.json" file does not exist. No action needed.');
        }
    }
};
export async function temporaryMigrationScript_checkMatthewNotebook() {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return;
    }

    const matthewNotebookPath = vscode.Uri.joinPath(
        workspaceFolders[0].uri,
        "/files/target/MAT.codex"
    );

    try {
        // Check if MAT.codex exists
        await vscode.workspace.fs.stat(matthewNotebookPath);

        // If MAT.codex exists, proceed with migration
        const document = await vscode.workspace.openNotebookDocument(matthewNotebookPath);
        for (const cell of document.getCells()) {
            if (
                cell.kind === vscode.NotebookCellKind.Code &&
                cell.document.getText().includes("MAT 1:1")
            ) {
                vscode.window.showInformationMessage(
                    "Updating notebook to use cells for verse content."
                );
                await vscode.window.withProgress(
                    {
                        location: vscode.ProgressLocation.Notification,
                        title: "Updating notebooks",
                        cancellable: false,
                    },
                    async (progress) => {
                        progress.report({ increment: 0 });
                        await vscode.commands.executeCommand(
                            "codex-editor-extension.updateProjectNotebooksToUseCellsForVerseContent"
                        );
                        progress.report({ increment: 100 });
                    }
                );
                vscode.window.showInformationMessage(
                    "Updated notebook to use cells for verse content."
                );
                // Reload the window
                await vscode.commands.executeCommand("workbench.action.reloadWindow");
                break;
            }
        }
    } catch (error) {
        // If MAT.codex doesn't exist, we silently ignore
        console.log("MAT.codex not found. Skipping migration.");
    }
}
