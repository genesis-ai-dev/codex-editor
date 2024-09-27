import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";

// Debug flag
const DEBUG = false;

// Custom debug function
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[DEBUG]", ...args);
    }
}

export async function exportCodexContent() {
    try {
        debug("Starting exportCodexContent function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }
        debug("Workspace folders found:", workspaceFolders);

        const codexFiles = await vscode.workspace.findFiles("**/*.codex");
        debug(`Found ${codexFiles.length} .codex files`);
        if (codexFiles.length === 0) {
            vscode.window.showInformationMessage("No .codex files found in the workspace.");
            return;
        }

        let allContent = "";
        let totalCells = 0;
        let totalVerses = 0;

        for (const file of codexFiles) {
            debug(`Processing file: ${file.fsPath}`);
            const notebookDocument = await vscode.workspace.openNotebookDocument(file);
            const cells = notebookDocument.getCells();
            debug(`File has ${cells.length} cells`);

            let currentChapter = "";
            let chapterContent = "";

            for (const cell of cells) {
                totalCells++;
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    const cellMetadata = cell.metadata as { type: string; id: string };

                    if (
                        cellMetadata.type === "paratext" &&
                        cell.document.getText().startsWith("<h1>")
                    ) {
                        debug("Found chapter heading cell");
                        if (chapterContent) {
                            allContent += chapterContent + "\n\n";
                        }
                        currentChapter = cell.document
                            .getText()
                            .replace(/<\/?h1>/g, "")
                            .trim();
                        chapterContent = `${currentChapter}\n`;
                        debug(`New chapter: ${currentChapter}`);
                    } else if (cellMetadata.type === "text" && cellMetadata.id) {
                        debug(`Processing verse cell: ${cellMetadata.id}`);
                        const verseRef = cellMetadata.id;
                        const verseContent = cell.document.getText().trim();
                        if (verseContent) {
                            chapterContent += `${verseRef} ${verseContent}\n`;
                            totalVerses++;
                        }
                    }
                }
            }

            // Add the last chapter's content
            if (chapterContent) {
                allContent += chapterContent + "\n\n";
            }
        }

        debug(`Total cells processed: ${totalCells}`);
        debug(`Total verses exported: ${totalVerses}`);

        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const exportFileName = `export_${timestamp}.txt`;
        const exportFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, "exports");

        await vscode.workspace.fs.createDirectory(exportFolder);
        const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(allContent));

        debug(`Export file created: ${exportFile.fsPath}`);
        vscode.window.showInformationMessage(`Export completed: ${exportFile.fsPath}`);
    } catch (error) {
        console.error("Export failed:", error);
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}

// TODO: Add an html export - one file per chapter.. perhaps a default css file if needed. last part of id as superscript. Only show ids on TEXT rather than PARATEXT cells.
