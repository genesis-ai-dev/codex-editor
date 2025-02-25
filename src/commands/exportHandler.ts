import * as vscode from "vscode";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";
import { basename } from "path";

// Debug flag
const DEBUG = false;

// Custom debug function
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[DEBUG]", ...args);
    }
}

/**
 * Maps book codes to their full names for USFM export
 */
const bookCodeToName: Record<string, string> = {
    // Old Testament
    GEN: "Genesis",
    EXO: "Exodus",
    LEV: "Leviticus",
    NUM: "Numbers",
    DEU: "Deuteronomy",
    JOS: "Joshua",
    JDG: "Judges",
    RUT: "Ruth",
    "1SA": "1 Samuel",
    "2SA": "2 Samuel",
    "1KI": "1 Kings",
    "2KI": "2 Kings",
    "1CH": "1 Chronicles",
    "2CH": "2 Chronicles",
    EZR: "Ezra",
    NEH: "Nehemiah",
    EST: "Esther",
    JOB: "Job",
    PSA: "Psalms",
    PRO: "Proverbs",
    ECC: "Ecclesiastes",
    SNG: "Song of Songs",
    ISA: "Isaiah",
    JER: "Jeremiah",
    LAM: "Lamentations",
    EZK: "Ezekiel",
    DAN: "Daniel",
    HOS: "Hosea",
    JOL: "Joel",
    AMO: "Amos",
    OBA: "Obadiah",
    JON: "Jonah",
    MIC: "Micah",
    NAM: "Nahum",
    HAB: "Habakkuk",
    ZEP: "Zephaniah",
    HAG: "Haggai",
    ZEC: "Zechariah",
    MAL: "Malachi",
    // New Testament
    MAT: "Matthew",
    MRK: "Mark",
    LUK: "Luke",
    JHN: "John",
    ACT: "Acts",
    ROM: "Romans",
    "1CO": "1 Corinthians",
    "2CO": "2 Corinthians",
    GAL: "Galatians",
    EPH: "Ephesians",
    PHP: "Philippians",
    COL: "Colossians",
    "1TH": "1 Thessalonians",
    "2TH": "2 Thessalonians",
    "1TI": "1 Timothy",
    "2TI": "2 Timothy",
    TIT: "Titus",
    PHM: "Philemon",
    HEB: "Hebrews",
    JAS: "James",
    "1PE": "1 Peter",
    "2PE": "2 Peter",
    "1JN": "1 John",
    "2JN": "2 John",
    "3JN": "3 John",
    JUD: "Jude",
    REV: "Revelation",
};

/**
 * Gets the full book name from a book code
 * @param bookCode The three-letter book code
 * @returns The full book name or the original code if not found
 */
function getFullBookName(bookCode: string): string {
    const upperCode = bookCode.toUpperCase();
    return bookCodeToName[upperCode] || bookCode;
}

/**
 * Validates USFM content for common structural issues
 * @param usfmContent The USFM content to validate
 * @returns An array of validation issues, empty if no issues found
 */
function validateUsfmStructure(usfmContent: string): string[] {
    const issues: string[] = [];

    // Check for required USFM markers
    if (!usfmContent.includes("\\id ")) {
        issues.push("Missing \\id marker (required)");
    }

    if (!usfmContent.includes("\\h ")) {
        issues.push("Missing \\h marker (header, recommended)");
    }

    if (
        !usfmContent.includes("\\mt") ||
        (!usfmContent.includes("\\mt ") && !usfmContent.includes("\\mt1 "))
    ) {
        issues.push("Missing \\mt or \\mt1 marker (main title, recommended)");
    }

    if (!usfmContent.includes("\\c ")) {
        issues.push("Missing \\c marker (required for chapters)");
    }

    if (!usfmContent.includes("\\v ")) {
        issues.push("Missing \\v marker (required for verses)");
    }

    if (!usfmContent.includes("\\p")) {
        issues.push("Missing \\p marker (paragraph, recommended for readability)");
    }

    // Check for correct order of markers
    const lines = usfmContent.split("\n");
    let idFound = false;
    let headerFound = false;
    let chapterFound = false;

    // First non-empty line should be \id
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;

        if (i === 0 && !line.startsWith("\\id ")) {
            issues.push("\\id marker should be the first marker in the file");
        }
        break;
    }

    // Check marker sequence
    for (const line of lines) {
        const trimmedLine = line.trim();
        if (!trimmedLine) continue;

        if (trimmedLine.startsWith("\\id ")) {
            if (idFound) {
                issues.push("Multiple \\id markers found (only one allowed)");
            }
            idFound = true;

            // Check if ID has language code
            const idParts = trimmedLine.split(" ");
            if (idParts.length < 3) {
                issues.push(
                    "\\id marker should include book code and language code (e.g., \\id GEN EN)"
                );
            }
        } else if (trimmedLine.startsWith("\\c ")) {
            chapterFound = true;
            // Check if \p follows \c
            const chapterIndex = lines.indexOf(line);
            if (chapterIndex < lines.length - 1) {
                const nextNonEmptyLines = lines
                    .slice(chapterIndex + 1)
                    .map((l) => l.trim())
                    .filter((l) => l.length > 0);

                if (
                    nextNonEmptyLines.length > 0 &&
                    !nextNonEmptyLines[0].startsWith("\\p") &&
                    !nextNonEmptyLines[0].startsWith("\\v")
                ) {
                    issues.push(
                        `Chapter marker should be followed by \\p or \\v marker near: "${trimmedLine}"`
                    );
                }
            }
        } else if (
            trimmedLine.startsWith("\\h ") ||
            trimmedLine.startsWith("\\mt") ||
            trimmedLine.startsWith("\\toc")
        ) {
            headerFound = true;
            if (chapterFound) {
                issues.push(
                    "Header markers (\\h, \\mt, \\toc) should appear before chapter markers (\\c)"
                );
            }
        } else if (trimmedLine.startsWith("\\v ")) {
            if (!chapterFound) {
                issues.push("Verse marker (\\v) found before any chapter marker (\\c)");
            }
        }
    }

    // Check for unmatched markers (simplified check)
    const paragraphMarkers = usfmContent.match(/\\p\b/g) || [];
    const endParagraphMarkers = usfmContent.match(/\\p\*/g) || [];
    if (paragraphMarkers.length !== endParagraphMarkers.length && endParagraphMarkers.length > 0) {
        issues.push("Unmatched paragraph markers (\\p)");
    }

    // Check for potentially malformed verse markers
    const verseLines = usfmContent.split("\n").filter((line) => line.includes("\\v "));
    for (const line of verseLines) {
        const verseMatch = line.match(/\\v\s+(\d+)/);
        if (verseMatch) {
            const verseNumber = verseMatch[1];
            if (verseNumber === "0") {
                issues.push(`Verse number 0 found, which is unusual: "${line.trim()}"`);
            }

            // Check if verse content is empty
            const verseContent = line.replace(/\\v\s+\d+\s*/, "").trim();
            if (!verseContent) {
                issues.push(`Empty content for verse ${verseNumber}`);
            }
        } else {
            issues.push(`Malformed verse marker: "${line.trim()}"`);
        }
    }

    // Check for chapter sequence
    const chapterMatches = [...usfmContent.matchAll(/\\c\s+(\d+)/g)];
    let lastChapterNum = 0;
    for (const match of chapterMatches) {
        const chapterNum = parseInt(match[1], 10);
        if (chapterNum !== lastChapterNum + 1) {
            issues.push(
                `Non-sequential chapter numbering: expected chapter ${lastChapterNum + 1}, found chapter ${chapterNum}`
            );
        }
        lastChapterNum = chapterNum;
    }

    return issues;
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
                    const fileName = basename(file.fsPath).replace(".codex", "") || "unknown";
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
                    const fullBookName = getFullBookName(bookCode);

                    // Add USFM header in the correct order
                    // 1. ID marker must come first - include language code (default to 'en' if unknown)
                    usfmContent += `\\id ${bookCode} EN\n`;

                    // 2. Add metadata as USFM comments
                    usfmContent += `\\rem Exported from Codex Translation Editor v${extensionVersion}\n`;
                    usfmContent += `\\rem Export Date: ${exportDate}\n`;
                    usfmContent += `\\rem Source File: ${file.fsPath}\n\n`;

                    // 3. Add header and title markers with proper book name
                    usfmContent += `\\h ${fullBookName}\n`;
                    usfmContent += `\\toc1 ${fullBookName}\n`; // Long table of contents text
                    usfmContent += `\\toc2 ${fullBookName}\n`; // Short table of contents text
                    usfmContent += `\\toc3 ${bookCode}\n`; // Book abbreviation
                    usfmContent += `\\mt1 ${fullBookName}\n\n`; // Main title, level 1

                    let chapterContent = "";
                    let lastChapter = "";
                    let isFirstChapter = true;

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
                                        } else if (isFirstChapter) {
                                            // If this is the first chapter and we haven't added chapter 1 yet,
                                            // add it explicitly to ensure proper USFM structure
                                            isFirstChapter = false;
                                        }
                                        lastChapter = chapterMatch[1];
                                        // Ensure each chapter starts with \c followed by \p
                                        chapterContent = `\\c ${chapterMatch[1]}\n\\p\n`;
                                    } else {
                                        // If it's a heading but not a chapter heading, add as paragraph
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
                                    // If we haven't started a chapter yet, add chapter 1 automatically
                                    if (lastChapter === "" && isFirstChapter) {
                                        lastChapter = "1";
                                        chapterContent = `\\c 1\n\\p\n`;
                                        isFirstChapter = false;
                                    }

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

                    // Validate USFM content before writing to file
                    progress.report({
                        message: `Validating USFM for ${bookCode}...`,
                        increment: 0,
                    });

                    // Show notification that validation is in progress
                    const validationNotification = vscode.window.setStatusBarMessage(
                        `Validating USFM structure for ${bookCode}...`
                    );

                    try {
                        // Create a USFM grammar parser instance
                        const usfmParser = new grammar.USFMParser(
                            usfmContent,
                            grammar.LEVEL.RELAXED
                        );

                        // Parse the USFM content
                        const parseResult = usfmParser.toJSON() as any;

                        // Perform additional structural validation
                        const structuralIssues = validateUsfmStructure(usfmContent);

                        // Combine parser warnings with structural issues
                        const allWarnings: string[] = [];

                        if (parseResult._messages && parseResult._messages._warnings) {
                            allWarnings.push(
                                ...parseResult._messages._warnings.map(
                                    (w: string) => `[Parser] ${w}`
                                )
                            );
                        }

                        if (structuralIssues.length > 0) {
                            allWarnings.push(...structuralIssues.map((i) => `[Structure] ${i}`));
                        }

                        // Clear the validation notification
                        validationNotification.dispose();

                        // Check for validation issues
                        if (allWarnings.length > 0) {
                            // Format error messages - limit to first 10 warnings if there are many
                            const displayWarnings =
                                allWarnings.length > 10
                                    ? [
                                          ...allWarnings.slice(0, 10),
                                          `... and ${allWarnings.length - 10} more issues`,
                                      ]
                                    : allWarnings;

                            const errorMessages = displayWarnings
                                .map((warning: string, i: number) => `${i + 1}. ${warning}`)
                                .join("\n");

                            // Show error dialog with option to continue anyway
                            const continueAnyway = "Export Anyway";
                            const viewAll = "View All Issues";
                            const cancel = "Cancel Export";

                            const choice = await vscode.window.showErrorMessage(
                                `USFM validation found ${allWarnings.length} issues in ${bookCode}:`,
                                { modal: true, detail: errorMessages },
                                continueAnyway,
                                viewAll,
                                cancel
                            );

                            if (choice === viewAll) {
                                // Create a temporary file with all warnings and open it
                                const tempFile = vscode.Uri.joinPath(
                                    exportFolder,
                                    `${bookCode}_validation_issues.txt`
                                );
                                const fullReport =
                                    `USFM Validation Issues for ${bookCode}\n` +
                                    `Generated: ${new Date().toISOString()}\n` +
                                    `Total issues found: ${allWarnings.length}\n\n` +
                                    allWarnings
                                        .map((warning, i) => `${i + 1}. ${warning}`)
                                        .join("\n");

                                await vscode.workspace.fs.writeFile(
                                    tempFile,
                                    Buffer.from(fullReport)
                                );
                                await vscode.commands.executeCommand("vscode.open", tempFile);

                                // Ask again after viewing
                                const secondChoice = await vscode.window.showErrorMessage(
                                    `Do you want to continue with the export for ${bookCode}?`,
                                    { modal: true },
                                    continueAnyway,
                                    cancel
                                );

                                if (secondChoice !== continueAnyway) {
                                    debug(
                                        `Export cancelled after viewing validation issues for ${bookCode}`
                                    );
                                    return;
                                }
                            } else if (choice !== continueAnyway) {
                                debug(
                                    `Export cancelled due to USFM validation issues in ${bookCode}`
                                );
                                return;
                            }

                            debug(
                                `Continuing export despite USFM validation issues in ${bookCode}`
                            );
                        } else {
                            debug(`USFM validation successful for ${bookCode}`);
                            vscode.window.setStatusBarMessage(
                                `USFM validation successful for ${bookCode}`,
                                3000
                            );
                        }
                    } catch (validationError) {
                        // Clear the validation notification
                        validationNotification.dispose();

                        console.error(`USFM validation error for ${bookCode}:`, validationError);

                        // Show error dialog with option to continue anyway
                        const continueAnyway = "Export Anyway";
                        const cancel = "Cancel Export";

                        const choice = await vscode.window.showErrorMessage(
                            `Error validating USFM for ${bookCode}: ${validationError instanceof Error ? validationError.message : String(validationError)}`,
                            { modal: true },
                            continueAnyway,
                            cancel
                        );

                        if (choice !== continueAnyway) {
                            debug(`Export cancelled due to USFM validation error in ${bookCode}`);
                            return;
                        }

                        debug(`Continuing export despite USFM validation error in ${bookCode}`);
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
