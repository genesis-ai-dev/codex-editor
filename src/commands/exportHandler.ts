import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";

// Debug flag
const DEBUG = false;

// Custom debug function
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[DEBUG]", ...args);
    }
}

export enum CodexExportFormat {
    PLAINTEXT = "plaintext",
    USFM = "usfm",
}

export async function exportCodexContent(
    format: CodexExportFormat,
    userSelectedPath: string,
    filesToExport: string[]
) {
    switch (format) {
        case CodexExportFormat.PLAINTEXT:
            await exportCodexContentAsPlaintext(userSelectedPath, filesToExport);
            break;
        case CodexExportFormat.USFM:
            await exportCodexContentAsUsfm(userSelectedPath, filesToExport);
            break;
    }
}

async function exportCodexContentAsPlaintext(userSelectedPath: string, filesToExport: string[]) {
    try {
        debug("Starting exportCodexContent function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }
        debug("Workspace folders found:", workspaceFolders);

        // Filter codex files based on user selection
        const selectedFiles = filesToExport.map((path) => vscode.Uri.file(path));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            vscode.window.showInformationMessage("No files selected for export.");
            return;
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Codex Content",
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
                let totalVerses = 0;
                const increment = 100 / selectedFiles.length;

                // Create export directory if it doesn't exist
                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                // Process each selected file
                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    debug(`Processing file: ${file.fsPath}`);
                    const notebookDocument = await vscode.workspace.openNotebookDocument(file);
                    const cells = notebookDocument.getCells();
                    debug(`File has ${cells.length} cells`);

                    let fileContent = "";
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
                                    fileContent += chapterContent + "\n\n";
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
                        fileContent += chapterContent + "\n\n";
                    }

                    // Write individual file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const fileName =
                        file.fsPath.split("/").pop()?.replace(".codex", "") || "unknown";
                    const exportFileName = `${fileName}_${timestamp}.txt`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

                    progress.report({
                        message: `Writing file ${index + 1}/${selectedFiles.length}...`,
                        increment: 0,
                    });

                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(fileContent));
                    debug(`Export file created: ${exportFile.fsPath}`);
                }

                debug(`Total cells processed: ${totalCells}`);
                debug(`Total verses exported: ${totalVerses}`);
                vscode.window.showInformationMessage(
                    `Export completed: ${totalVerses} verses from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("Export failed:", error);
        vscode.window.showErrorMessage(`Export failed: ${error}`);
    }
}

async function exportCodexContentAsUsfm(userSelectedPath: string, filesToExport: string[]) {
    try {
        debug("Starting exportCodexContentAsUsfm function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        // Get extension version for metadata
        const extension = vscode.extensions.getExtension(
            "project-accelerate.codex-project-manager"
        );
        const extensionVersion = extension?.packageJSON?.version || "unknown";
        const exportDate = new Date().toISOString();

        // Filter codex files based on user selection
        const selectedFiles = filesToExport.map((path) => vscode.Uri.file(path));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            vscode.window.showInformationMessage("No files selected for export.");
            return;
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Codex Content as USFM",
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
                let totalVerses = 0;
                const increment = 100 / selectedFiles.length;

                // Create export directory if it doesn't exist
                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    debug(`Processing file: ${file.fsPath}`);
                    const notebookDocument = await vscode.workspace.openNotebookDocument(file);
                    const cells = notebookDocument.getCells();
                    debug(`File has ${cells.length} cells`);

                    let usfmContent = "";

                    // Extract book code from filename (e.g., "MAT.codex" -> "MAT")
                    const bookCode = file.fsPath.split("/").pop()?.split(".")[0] || "";

                    // Add metadata as USFM comments
                    usfmContent += `\\rem Exported from Codex Translation Editor v${extensionVersion}\n`;
                    usfmContent += `\\rem Export Date: ${exportDate}\n`;
                    usfmContent += `\\rem Source File: ${file.fsPath}\n\n`;

                    // Add USFM header
                    usfmContent += `\\id ${bookCode}\n\\h ${bookCode}\n\\mt ${bookCode}\n\n`;

                    let chapterContent = "";
                    let lastChapter = "";

                    for (const cell of cells) {
                        totalCells++;
                        if (cell.kind === vscode.NotebookCellKind.Code) {
                            const cellMetadata = cell.metadata as { type: string; id: string };
                            const cellContent = cell.document.getText().trim();

                            if (!cellContent) continue;

                            if (cellMetadata.type === CodexCellTypes.PARATEXT) {
                                // Handle chapter headings
                                if (cellContent.startsWith("<h1>")) {
                                    const chapterTitle = cellContent.replace(/<\/?h1>/g, "").trim();
                                    const chapterMatch = chapterTitle.match(/Chapter (\d+)/i);
                                    if (chapterMatch) {
                                        if (lastChapter !== "") {
                                            usfmContent += chapterContent + "\n";
                                        }
                                        lastChapter = chapterMatch[1];
                                        chapterContent = `\\c ${chapterMatch[1]}\n\\p\n`;
                                    } else {
                                        chapterContent += `\\p ${cellContent}\n`;
                                    }
                                } else {
                                    // Handle other paratext
                                    chapterContent += `\\p ${cellContent}\n`;
                                }
                            } else if (
                                cellMetadata.type === CodexCellTypes.TEXT &&
                                cellMetadata.id
                            ) {
                                // Handle verse content
                                const verseRef = cellMetadata.id;
                                const verseMatch = verseRef.match(/\d+$/);
                                if (verseMatch) {
                                    const verseNumber = verseMatch[0];
                                    chapterContent += `\\v ${verseNumber} ${cellContent}\n`;
                                    totalVerses++;
                                }
                            }
                        }
                    }

                    // Add the last chapter's content
                    if (chapterContent) {
                        usfmContent += chapterContent;
                    }

                    // Write individual file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const exportFileName = `${bookCode}_${timestamp}.usfm`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

                    progress.report({
                        message: `Writing file ${index + 1}/${selectedFiles.length}...`,
                        increment: 0,
                    });

                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(usfmContent));
                    debug(`Export file created: ${exportFile.fsPath}`);
                }

                vscode.window.showInformationMessage(
                    `USFM Export completed: ${totalVerses} verses from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("USFM Export failed:", error);
        vscode.window.showErrorMessage(`USFM Export failed: ${error}`);
    }
}

// TODO: Add an html export - one file per chapter.. perhaps a default css file if needed. last part of id as superscript. Only show ids on TEXT rather than PARATEXT cells.
