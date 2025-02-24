import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";
import { basename } from "path";
import * as fs from "fs";
import * as path from "path";
import { getProjectMetadata } from "../utils";
import { LanguageProjectStatus } from "codex-types";
import { CodexNotebookAsJSONData } from "../../types";

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
    HTML = "html",
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
        case CodexExportFormat.HTML:
            await exportCodexContentAsHtml(userSelectedPath, filesToExport);
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

                // Process files in parallel batches to improve performance
                const BATCH_SIZE = 5; // Process 5 files at a time
                for (let i = 0; i < selectedFiles.length; i += BATCH_SIZE) {
                    const batch = selectedFiles.slice(i, i + BATCH_SIZE);
                    await Promise.all(
                        batch.map(async (file, batchIndex) => {
                            const fileIndex = i + batchIndex;
                    progress.report({
                                message: `Processing file ${fileIndex + 1}/${selectedFiles.length}`,
                                increment: increment,
                    });

                    debug(`Processing file: ${file.fsPath}`);

                            // Read and parse the file directly instead of opening as notebook
                            const rawFileContent = await vscode.workspace.fs.readFile(file);
                            const notebookData = JSON.parse(
                                new TextDecoder().decode(rawFileContent)
                            ) as CodexNotebookAsJSONData;
                            const cells = notebookData.cells;
                    debug(`File has ${cells.length} cells`);

                            let outputContent = "";
                    let currentChapter = "";
                    let chapterContent = "";

                    for (const cell of cells) {
                        totalCells++;
                            const cellMetadata = cell.metadata as { type: string; id: string };

                            if (
                                cellMetadata.type === "paratext" &&
                                    cell.value.startsWith("<h1>")
                            ) {
                                debug("Found chapter heading cell");
                                if (chapterContent) {
                                        outputContent += chapterContent + "\n\n";
                                }
                                    currentChapter = cell.value.replace(/<\/?h1>/g, "").trim();
                                chapterContent = `${currentChapter}\n`;
                                debug(`New chapter: ${currentChapter}`);
                            } else if (cellMetadata.type === "text" && cellMetadata.id) {
                                debug(`Processing verse cell: ${cellMetadata.id}`);
                                const verseRef = cellMetadata.id;
                                    const verseContent = cell.value.trim();
                                if (verseContent) {
                                    chapterContent += `${verseRef} ${verseContent}\n`;
                                    totalVerses++;
                            }
                        }
                    }

                    // Add the last chapter's content
                    if (chapterContent) {
                                outputContent += chapterContent + "\n\n";
                    }

                    // Write individual file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                            const fileName =
                                basename(file.fsPath).replace(".codex", "") || "unknown";
                    const exportFileName = `${fileName}_${timestamp}.txt`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

                            await vscode.workspace.fs.writeFile(
                                exportFile,
                                Buffer.from(outputContent)
                            );
                    debug(`Export file created: ${exportFile.fsPath}`);
                        })
                    );
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
            "project-accelerate.codex-editor-extension"
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
                    const bookCode = basename(file.fsPath).split(".")[0] || "";

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

async function exportCodexContentAsHtml(userSelectedPath: string, filesToExport: string[]) {
    try {
        debug("Starting exportCodexContentAsHtml function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        // Get extension version for metadata
        const extension = vscode.extensions.getExtension(
            "project-accelerate.codex-editor-extension"
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

        // CSS styles for the HTML output
        const cssStyles = `
            :root {
                --text-color: #333;
                --bg-color: #fff;
                --link-color: #0066cc;
                --border-color: #ddd;
                --chapter-color: #2c3e50;
                --verse-number-color: #7f8c8d;
            }

            @media (prefers-color-scheme: dark) {
                :root {
                    --text-color: #eee;
                    --bg-color: #1e1e1e;
                    --link-color: #66b3ff;
                    --border-color: #444;
                    --chapter-color: #89a7c3;
                    --verse-number-color: #95a5a6;
                }
            }

            body {
                font-family: 'Noto Serif', Georgia, serif;
                line-height: 1.6;
                max-width: 800px;
                margin: 0 auto;
                padding: 2rem;
                color: var(--text-color);
                background: var(--bg-color);
            }

            .book-title {
                text-align: center;
                font-size: 2.5rem;
                color: var(--chapter-color);
                margin-bottom: 2rem;
                border-bottom: 2px solid var(--border-color);
                padding-bottom: 1rem;
            }

            .chapter {
                margin-bottom: 3rem;
                break-inside: avoid;
            }

            .chapter-title {
                font-size: 2rem;
                color: var(--chapter-color);
                margin: 2rem 0 1rem;
                text-align: center;
            }

            .verse {
                margin: 1rem 0;
                text-align: justify;
            }

            .verse-number {
                font-size: 0.8em;
                color: var(--verse-number-color);
                vertical-align: super;
                margin-right: 0.3em;
                font-weight: bold;
            }

            .paratext {
                font-style: italic;
                margin: 1rem 0;
                color: var(--chapter-color);
            }

            .metadata {
                font-size: 0.9rem;
                color: var(--verse-number-color);
                border-top: 1px solid var(--border-color);
                margin-top: 2rem;
                padding-top: 1rem;
            }

            @media print {
                @page {
                    margin: 2cm;
                }

                body {
                    max-width: none;
                    padding: 0;
                }

                .chapter {
                    page-break-inside: avoid;
                }

                .verse {
                    page-break-inside: avoid;
                }

                .metadata {
                    display: none;
                }
            }
        `;

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Codex Content as HTML",
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
                let totalVerses = 0;
                const increment = 100 / selectedFiles.length;

                // Create export directory if it doesn't exist
                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                // Create styles.css
                const cssFile = vscode.Uri.joinPath(exportFolder, "styles.css");
                await vscode.workspace.fs.writeFile(cssFile, Buffer.from(cssStyles));

                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    debug(`Processing file: ${file.fsPath}`);
                    const notebookDocument = await vscode.workspace.openNotebookDocument(file);
                    const cells = notebookDocument.getCells();
                    debug(`File has ${cells.length} cells`);

                    // Extract book code from filename (e.g., "MAT.codex" -> "MAT")
                    const bookCode = basename(file.fsPath).split(".")[0] || "";
                    const chapters: { [key: string]: string } = {};

                    // First pass: Organize content by chapters
                    for (const cell of cells) {
                        totalCells++;
                        if (cell.kind === vscode.NotebookCellKind.Code) {
                            const cellMetadata = cell.metadata as { type: string; id: string };
                            const cellContent = cell.document.getText().trim();

                            if (!cellContent) continue;

                            if (cellMetadata.type === CodexCellTypes.TEXT && cellMetadata.id) {
                                // Extract chapter number from verse reference (e.g., "MRK 1:1" -> "1")
                                const chapterMatch = cellMetadata.id.match(/\s(\d+):/);
                                if (chapterMatch) {
                                    const chapterNum = chapterMatch[1];
                                    if (!chapters[chapterNum]) {
                                        chapters[chapterNum] = `
                                            <div class="chapter">
                                            <h2 class="chapter-title">Chapter ${chapterNum}</h2>`;
                                    }

                                    const verseMatch = cellMetadata.id.match(/\d+$/);
                                    if (verseMatch) {
                                        const verseNumber = verseMatch[0];
                                        chapters[chapterNum] += `
                                            <div class="verse" x-type="verse" x-verse-ref="${cellMetadata.id}">
                                                <span class="verse-number">${verseNumber}</span>
                                                ${cellContent}
                                            </div>`;
                                        totalVerses++;
                                    }
                                }
                            } else if (cellMetadata.type === CodexCellTypes.PARATEXT) {
                                // Handle paratext that isn't a chapter heading
                                if (!cellContent.startsWith("<h1>")) {
                                    // Add to the current chapter if we have one
                                    const currentChapters = Object.keys(chapters);
                                    if (currentChapters.length > 0) {
                                        const lastChapter =
                                            currentChapters[currentChapters.length - 1];
                                        chapters[lastChapter] += `
                                            <div class="paratext" x-type="paratext">${cellContent}</div>`;
                                    }
                                }
                            }
                        }
                    }

                    // Create a chapter file for each chapter
                    for (const [chapterNum, chapterContent] of Object.entries(chapters)) {
                        const chapterHtml = `<!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>${bookCode} Chapter ${chapterNum}</title>
                            <link rel="stylesheet" href="styles.css">
                        </head>
                        <body>
                            <h1 class="book-title">${bookCode}</h1>
                            ${chapterContent}
                            </div>
                            <div class="metadata">
                                <p>Exported from Codex Translation Editor v${extensionVersion}</p>
                                <p>Export Date: ${exportDate}</p>
                                <p>Source File: ${file.fsPath}</p>
                            </div>
                        </body>
                        </html>`;

                        const chapterFileName = `${bookCode}_${chapterNum.padStart(3, "0")}.html`;
                        const chapterFile = vscode.Uri.joinPath(exportFolder, chapterFileName);
                        await vscode.workspace.fs.writeFile(chapterFile, Buffer.from(chapterHtml));
                        debug(`Chapter file created: ${chapterFile.fsPath}`);
                    }

                    // Create an index file for the book
                    const indexHtml = `<!DOCTYPE html>
                    <html lang="en">
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <title>${bookCode}</title>
                        <link rel="stylesheet" href="styles.css">
                        <style>
                            .chapter-list {
                                list-style: none;
                                padding: 0;
                                display: grid;
                                grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
                                gap: 1rem;
                            }
                            .chapter-link {
                                display: block;
                                padding: 1rem;
                                text-align: center;
                                text-decoration: none;
                                color: var(--link-color);
                                border: 1px solid var(--border-color);
                                border-radius: 4px;
                                transition: all 0.2s ease;
                            }
                            .chapter-link:hover {
                                background: var(--border-color);
                            }
                        </style>
                    </head>
                    <body>
                        <h1 class="book-title">${bookCode}</h1>
                        <ul class="chapter-list">
                            ${Object.keys(chapters)
                                .sort((a, b) => parseInt(a) - parseInt(b))
                                .map(
                                    (num) => `
                                    <li><a class="chapter-link" href="${bookCode}_${num.padStart(3, "0")}.html">Chapter ${num}</a></li>
                                `
                                )
                                .join("")}
                        </ul>
                        <div class="metadata">
                            <p>Exported from Codex Translation Editor v${extensionVersion}</p>
                            <p>Export Date: ${exportDate}</p>
                            <p>Source File: ${file.fsPath}</p>
                        </div>
                    </body>
                    </html>`;

                    const indexFile = vscode.Uri.joinPath(exportFolder, `${bookCode}_index.html`);
                    await vscode.workspace.fs.writeFile(indexFile, Buffer.from(indexHtml));
                    debug(`Index file created: ${indexFile.fsPath}`);
                }

                vscode.window.showInformationMessage(
                    `HTML Export completed: ${totalVerses} verses from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("HTML Export failed:", error);
        vscode.window.showErrorMessage(`HTML Export failed: ${error}`);
    }
}

// TODO: Add an html export - one file per chapter.. perhaps a default css file if needed. last part of id as superscript. Only show ids on TEXT rather than PARATEXT cells.
