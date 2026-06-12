import * as vscode from "vscode";
import { basename } from "path";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import { readCodexNotebookFromUri, getActiveCells, isContentCellType } from "./exportHandlerUtils";
import type { ExportOptions } from "./exportHandler";
import type { ExportProgressReporter } from "./exportProgress";

const DEBUG = false;
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[PlaintextExporter]", ...args);
    }
}

export async function exportCodexContentAsPlaintext(
    userSelectedPath: string,
    filesToExport: string[],
    reporter: ExportProgressReporter,
    options?: ExportOptions,
    token?: vscode.CancellationToken
) {
    try {
        debug("Starting exportCodexContentAsPlaintext");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            reporter.error("No project folder found. Please open a project first.");
            return;
        }
        debug("Workspace folders found:", workspaceFolders);

        const selectedFiles = filesToExport.map((fp) => vscode.Uri.file(fp));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            reporter.error("No files selected for export.");
            return;
        }

        let totalCells = 0;
        let totalVerses = 0;

        const exportFolder = vscode.Uri.file(userSelectedPath);
        await vscode.workspace.fs.createDirectory(exportFolder);

        for (const [index, file] of selectedFiles.entries()) {
            if (token?.isCancellationRequested) return;
            reporter.report({
                stage: "writing",
                message: `Processing file ${index + 1}/${selectedFiles.length}`,
                file: basename(file.fsPath),
                current: index + 1,
                total: selectedFiles.length,
            });

            debug(`Processing file: ${file.fsPath}`);

            const codexData = await readCodexNotebookFromUri(file);
            const cells = getActiveCells(codexData.cells);

            debug(`File has ${cells.length} active cells`);

            let exportContent = "";
            let currentChapter = "";
            let chapterContent = "";

            for (const cell of cells) {
                totalCells++;
                if (cell.kind === 2 || cell.kind === 1) {
                    const cellMetadata = cell.metadata;

                    if (
                        cellMetadata.type === "paratext" &&
                        cell.value.startsWith("<h1>")
                    ) {
                        debug("Found chapter heading cell");
                        if (chapterContent) {
                            exportContent += chapterContent + "\n\n";
                        }
                        currentChapter = cell.value
                            .replace(/<\/?[^>]+(>|$)/g, "")
                            .trim();
                        chapterContent = `${currentChapter}\n`;
                        debug(`New chapter: ${currentChapter}`);
                    } else if (
                        isContentCellType(cellMetadata.type) &&
                        cellMetadata.id
                    ) {
                        debug(`Processing verse cell: ${cellMetadata.id}`);
                        let verseContent = cell.value
                            .replace(/<\/?[^>]+(>|$)/g, "")
                            .trim();

                        const cellId = cellMetadata.id;
                        if (
                            cellId &&
                            (verseContent.startsWith(cellId) ||
                                verseContent.startsWith(cellId + " "))
                        ) {
                            verseContent = verseContent
                                .slice(cellId.length)
                                .trimStart();
                        }

                        const verseRefAtStart =
                            extractVerseRefFromLine(verseContent);
                        if (
                            verseRefAtStart &&
                            verseContent.startsWith(verseRefAtStart)
                        ) {
                            verseContent = verseContent
                                .slice(verseRefAtStart.length)
                                .trimStart();
                        }

                        if (verseContent) {
                            chapterContent += `${verseContent}\n`;
                            totalVerses++;
                        }
                    }
                }
            }

            if (chapterContent) {
                exportContent += chapterContent + "\n\n";
            }

            const timestamp = new Date()
                .toISOString()
                .replace(/[:.]/g, "-");
            const fileName =
                basename(file.fsPath).replace(".codex", "") || "unknown";
            const exportFileName = `${fileName}_${timestamp}.txt`;
            const exportFile = vscode.Uri.joinPath(
                exportFolder,
                exportFileName
            );

            await vscode.workspace.fs.writeFile(
                exportFile,
                Buffer.from(exportContent)
            );
            debug(`Export file created: ${exportFile.fsPath}`);
        }

        debug(`Total cells processed: ${totalCells}`);
        debug(`Total verses exported: ${totalVerses}`);
        reporter.complete({
            exportPath: userSelectedPath,
            filesExported: selectedFiles.length,
            extraMessages: [
                `${totalVerses} verses from ${selectedFiles.length} file(s) exported.`,
            ],
        });
    } catch (error) {
        console.error("Plaintext Export failed:", error);
        reporter.error(`Plaintext Export failed: ${error}`);
    }
}
