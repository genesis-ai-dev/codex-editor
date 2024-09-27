import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";

export async function exportCodexContent() {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const codexFiles = await vscode.workspace.findFiles("**/*.codex");
        if (codexFiles.length === 0) {
            vscode.window.showInformationMessage("No .codex files found in the workspace.");
            return;
        }

        let allContent = "";

        for (const file of codexFiles) {
            const notebookDocument = await vscode.workspace.openNotebookDocument(file);
            const cells = notebookDocument.getCells();

            let currentChapter = "";
            let chapterContent = "";

            for (const cell of cells) {
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    const cellMetadata = cell.metadata as { type: string; id: string };

                    if (
                        cellMetadata.type === "paratext" &&
                        cell.document.getText().startsWith("<h1>")
                    ) {
                        // This is a chapter heading cell
                        if (chapterContent) {
                            allContent += chapterContent + "\n\n";
                        }
                        currentChapter = cell.document
                            .getText()
                            .replace(/<\/?h1>/g, "")
                            .trim();
                        chapterContent = `${currentChapter}\n`;
                    } else if (cellMetadata.type === "text" && cellMetadata.id) {
                        // This is a verse cell
                        const verseRef = cellMetadata.id;
                        const verseContent = cell.document.getText().trim();
                        if (verseContent) {
                            chapterContent += `${verseRef} ${verseContent}\n`;
                        }
                    }
                }
            }

            // Add the last chapter's content
            if (chapterContent) {
                allContent += chapterContent + "\n\n";
            }
        }

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const exportFileName = `export_${timestamp}.txt`;
        const exportFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, "exports");

        await vscode.workspace.fs.createDirectory(exportFolder);
        const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(allContent));

        vscode.window.showInformationMessage(`Export completed: ${exportFile.fsPath}`);
    } catch (error) {
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}

// TODO: Add an html export - one file per chapter.. perhaps a default css file if needed. last part of id as superscript. Only show ids on TEXT rather than PARATEXT cells.
