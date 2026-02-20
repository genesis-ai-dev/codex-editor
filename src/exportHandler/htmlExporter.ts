import * as vscode from "vscode";
import { basename } from "path";
import { CodexCellTypes } from "../../types/enums";
import { readCodexNotebookFromUri, getActiveCells } from "./exportHandlerUtils";
import type { ExportOptions } from "./exportHandler";

/** Verse ref regex: "1TH 1:1", "GEN 1:1", etc. */
const VERSE_REF_REGEX = /\b[A-Z0-9]{2,4}\s+\d+:\d+\b/;

/**
 * Gets the verse reference for a cell, from globalReferences (preferred) or metadata.id (legacy).
 * Returns null if no verse-ref format found.
 */
function getVerseRefForCell(cell: { metadata?: any }): string | null {
    const meta = cell.metadata as any;
    const globalRefs = meta?.data?.globalReferences;
    if (globalRefs && Array.isArray(globalRefs) && globalRefs.length > 0) {
        const ref = globalRefs[0];
        if (typeof ref === "string" && VERSE_REF_REGEX.test(ref)) {
            return ref;
        }
    }
    const id = meta?.id;
    if (typeof id === "string" && VERSE_REF_REGEX.test(id)) {
        return id;
    }
    return null;
}

const DEBUG = false;
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[HtmlExporter]", ...args);
    }
}

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

export async function exportCodexContentAsHtml(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    try {
        debug("Starting exportCodexContentAsHtml function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const extension = vscode.extensions.getExtension(
            "project-accelerate.codex-editor-extension"
        );
        const extensionVersion = extension?.packageJSON?.version || "unknown";
        const exportDate = new Date().toISOString();

        const selectedFiles = filesToExport.map((fp) => vscode.Uri.file(fp));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            vscode.window.showInformationMessage(
                "No files selected for export."
            );
            return;
        }

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

                const baseExportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(baseExportFolder);

                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    debug(`Processing file: ${file.fsPath}`);

                    const bookCode =
                        basename(file.fsPath).split(".")[0] || "export";

                    // Create a subfolder per book for cleaner output
                    const exportFolder = vscode.Uri.joinPath(
                        baseExportFolder,
                        bookCode
                    );
                    await vscode.workspace.fs.createDirectory(exportFolder);

                    const cssFile = vscode.Uri.joinPath(
                        exportFolder,
                        "styles.css"
                    );
                    await vscode.workspace.fs.writeFile(
                        cssFile,
                        Buffer.from(cssStyles)
                    );

                    const codexData = await readCodexNotebookFromUri(file);
                    const cells = getActiveCells(codexData.cells);

                    debug(`File has ${cells.length} active cells`);

                    const chapters: { [key: string]: string } = {};

                    for (const cell of cells) {
                        totalCells++;
                        if (cell.kind === 2 || cell.kind === 1) {
                            const cellMetadata = cell.metadata as any;
                            const cellContent = cell.value.trim();

                            if (!cellContent) continue;

                            if (cellMetadata.type === CodexCellTypes.TEXT) {
                                const verseRef = getVerseRefForCell(cell);
                                if (verseRef) {
                                    const chapterMatch = verseRef.match(/\s(\d+):/);
                                    const verseMatch = verseRef.match(/\d+$/);
                                    if (chapterMatch && verseMatch) {
                                        const chapterNum = chapterMatch[1];
                                        const verseNumber = verseMatch[0];
                                        if (!chapters[chapterNum]) {
                                            chapters[chapterNum] = `
                                            <div class="chapter">
                                            <h2 class="chapter-title">Chapter ${chapterNum}</h2>`;
                                        }
                                        chapters[chapterNum] += `
                                            <div class="verse" x-type="verse" x-verse-ref="${verseRef}">
                                                <span class="verse-number">${verseNumber}</span>
                                                ${cellContent}
                                            </div>`;
                                        totalVerses++;
                                    }
                                } else {
                                    // No verse ref (e.g. non-Bible file): put in "Content" section
                                    const fallbackKey = "_content";
                                    if (!chapters[fallbackKey]) {
                                        chapters[fallbackKey] = `
                                            <div class="chapter">
                                            <h2 class="chapter-title">Content</h2>`;
                                    }
                                    chapters[fallbackKey] += `
                                            <div class="verse" x-type="verse">
                                                ${cellContent}
                                            </div>`;
                                    totalVerses++;
                                }
                            } else if (
                                cellMetadata.type === CodexCellTypes.PARATEXT
                            ) {
                                if (!cellContent.startsWith("<h1>")) {
                                    const currentChapters =
                                        Object.keys(chapters);
                                    if (currentChapters.length > 0) {
                                        const lastChapter =
                                            currentChapters[
                                                currentChapters.length - 1
                                            ];
                                        chapters[lastChapter] += `
                                            <div class="paratext" x-type="paratext">${cellContent}</div>`;
                                    } else {
                                        const fallbackKey = "_content";
                                        if (!chapters[fallbackKey]) {
                                            chapters[fallbackKey] = `
                                            <div class="chapter">
                                            <h2 class="chapter-title">Content</h2>`;
                                        }
                                        chapters[fallbackKey] += `
                                            <div class="paratext" x-type="paratext">${cellContent}</div>`;
                                    }
                                }
                            }
                        }
                    }

                    const sortedChapterEntries = Object.entries(chapters).sort(
                        (a, b) => {
                            const [keyA, keyB] = [a[0], b[0]];
                            if (keyA === "_content") return -1;
                            if (keyB === "_content") return 1;
                            return parseInt(keyA, 10) - parseInt(keyB, 10);
                        }
                    );

                    for (const [chapterNum, chapterContent] of sortedChapterEntries) {
                        const chapterTitle =
                            chapterNum === "_content" ? "Content" : `Chapter ${chapterNum}`;
                        const chapterFileName =
                            chapterNum === "_content"
                                ? `${bookCode}_content.html`
                                : `${bookCode}_${chapterNum.padStart(3, "0")}.html`;

                        const chapterHtml = `<!DOCTYPE html>
                        <html lang="en">
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <title>${bookCode} ${chapterTitle}</title>
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
                        const chapterFile = vscode.Uri.joinPath(
                            exportFolder,
                            chapterFileName
                        );
                        await vscode.workspace.fs.writeFile(
                            chapterFile,
                            Buffer.from(chapterHtml)
                        );
                        debug(`Chapter file created: ${chapterFile.fsPath}`);
                    }

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
                            ${sortedChapterEntries
                                .map(([num, _]) => {
                                    const href =
                                        num === "_content"
                                            ? `${bookCode}_content.html`
                                            : `${bookCode}_${num.padStart(3, "0")}.html`;
                                    const label =
                                        num === "_content"
                                            ? "Content"
                                            : `Chapter ${num}`;
                                    return `<li><a class="chapter-link" href="${href}">${label}</a></li>`;
                                })
                                .join("")}
                        </ul>
                        <div class="metadata">
                            <p>Exported from Codex Translation Editor v${extensionVersion}</p>
                            <p>Export Date: ${exportDate}</p>
                            <p>Source File: ${file.fsPath}</p>
                        </div>
                    </body>
                    </html>`;

                    const indexFile = vscode.Uri.joinPath(
                        exportFolder,
                        `${bookCode}_index.html`
                    );
                    await vscode.workspace.fs.writeFile(
                        indexFile,
                        Buffer.from(indexHtml)
                    );
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
