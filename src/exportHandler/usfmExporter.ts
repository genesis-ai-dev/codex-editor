import * as vscode from "vscode";
import { basename } from "path";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";
import { readCodexNotebookFromUri } from "./exportHandlerUtils";
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
        console.log("[UsfmExporter]", ...args);
    }
}

const bookCodeToName: Record<string, string> = {
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

function getFullBookName(bookCode: string): string {
    const upperCode = bookCode.toUpperCase();
    return bookCodeToName[upperCode] || bookCode;
}

function convertHtmlToUsfm(html: string): string {
    if (!html) return "";

    let content = html;

    content = content.replace(/<h2>(.*?)<\/h2>/gi, "\\s1 $1");
    content = content.replace(/<h3>(.*?)<\/h3>/gi, "\\s2 $1");
    content = content.replace(/<h4>(.*?)<\/h4>/gi, "\\s3 $1");
    content = content.replace(/<em>(.*?)<\/em>/gi, "\\em $1\\em*");
    content = content.replace(/<i>(.*?)<\/i>/gi, "\\it $1\\it*");
    content = content.replace(/<strong>(.*?)<\/strong>/gi, "\\bd $1\\bd*");
    content = content.replace(/<b>(.*?)<\/b>/gi, "\\bd $1\\bd*");
    content = content.replace(/<u>(.*?)<\/u>/gi, "\\ul $1\\ul*");
    content = content.replace(/<sup>(.*?)<\/sup>/gi, "\\sup $1\\sup*");
    content = content.replace(/<sub>(.*?)<\/sub>/gi, "\\sub $1\\sub*");

    content = content.replace(/<ul>(.*?)<\/ul>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;
        return items
            .map((item: string) => "\\li " + item.replace(/<\/?li>/gi, "").trim())
            .join("\n");
    });

    content = content.replace(/<ol>(.*?)<\/ol>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;
        return items
            .map(
                (item: string, index: number) =>
                    `\\li${index + 1} ` + item.replace(/<\/?li>/gi, "").trim()
            )
            .join("\n");
    });

    content = content.replace(/<[^>]*>/g, "");
    content = content.replace(/&nbsp;/g, " ");
    content = content.replace(/&lt;/g, "<");
    content = content.replace(/&gt;/g, ">");
    content = content.replace(/&amp;/g, "&");
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&apos;/g, "'");

    return content;
}

export async function exportCodexContentAsUsfm(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    try {
        debug("Starting exportCodexContentAsUsfm function");
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

        const exportFolder = vscode.Uri.file(userSelectedPath);
        await vscode.workspace.fs.createDirectory(exportFolder);

        const skipValidation =
            options?.skipValidation ||
            (selectedFiles.length > 5 && !DEBUG);
        if (skipValidation) {
            debug(
                `Skipping validation: ${options?.skipValidation ? "user preference" : "large export"}`
            );
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
                let skippedFiles = 0;
                let exportedFiles = 0;
                const increment = 100 / selectedFiles.length;

                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    progress.report({
                        message: `Processing file ${i + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    try {
                        debug(`Processing file: ${file.fsPath}`);

                        const bookCode =
                            basename(file.fsPath).split(".")[0] || "";
                        const sourceFileName = `${bookCode}.source`;
                        const sourceFile = vscode.Uri.joinPath(
                            vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                            ".project",
                            "sourceTexts",
                            sourceFileName
                        );

                        let sourceData: Uint8Array | null = null;
                        try {
                            sourceData =
                                await vscode.workspace.fs.readFile(
                                    sourceFile
                                );
                        } catch (error) {
                            vscode.window.showWarningMessage(
                                `Source file not found for ${bookCode} at ${sourceFile.fsPath}, skipping...`
                            );
                            skippedFiles++;
                            continue;
                        }

                        const codexNotebook =
                            await readCodexNotebookFromUri(file);

                        const textCells = codexNotebook.cells.filter(
                            (cell) =>
                                (cell.kind === 2 || cell.kind === 1) &&
                                cell.metadata?.type === CodexCellTypes.TEXT
                        );

                        if (textCells.length === 0) {
                            debug(`Skipping empty file: ${file.fsPath}`);
                            skippedFiles++;
                            continue;
                        }

                        const hasContent = textCells.some(
                            (cell) => cell.value.trim().length > 0
                        );
                        if (!hasContent) {
                            debug(
                                `Skipping file with no text content: ${file.fsPath}`
                            );
                            skippedFiles++;
                            continue;
                        }

                        let usfmContent = "";
                        const fullBookName = getFullBookName(bookCode);
                        let verseCount = 0;
                        let hasVerses = false;
                        let currentChapter = 0;
                        let chapterContent = "";
                        let lastChapter = "";
                        let isFirstChapter = true;

                        usfmContent += `\\id ${bookCode} EN\n`;
                        usfmContent += `\\rem Exported from Codex Translation Editor v${extensionVersion}\n`;
                        usfmContent += `\\rem Export Date: ${exportDate}\n`;
                        usfmContent += `\\rem Source File: ${file.fsPath}\n`;
                        usfmContent += `\\h ${fullBookName}\n`;
                        usfmContent += `\\toc1 ${fullBookName}\n`;
                        usfmContent += `\\toc2 ${fullBookName}\n`;
                        usfmContent += `\\toc3 ${bookCode}\n`;
                        usfmContent += `\\mt1 ${fullBookName}\n`;

                        const relevantCells = codexNotebook.cells.filter(
                            (cell) => {
                                const metadata = cell.metadata as any;
                                return (
                                    (cell.kind === 2 || cell.kind === 1) &&
                                    cell.metadata?.type &&
                                    cell.metadata?.type !==
                                        CodexCellTypes.MILESTONE &&
                                    cell.value.trim().length > 0 &&
                                    !metadata?.merged
                                );
                            }
                        );

                        totalCells += relevantCells.length;

                        const chapterCells: { [key: string]: number } = {};
                        for (const cell of relevantCells) {
                            const cellMetadata = cell.metadata;
                            const cellContent = cell.value.trim();

                            if (
                                cellMetadata.type ===
                                    CodexCellTypes.PARATEXT &&
                                cellContent.startsWith("<h1>")
                            ) {
                                const chapterTitle = cellContent
                                    .replace(/<\/?h1>/g, "")
                                    .trim();
                                const chapterMatch = chapterTitle.match(
                                    /Chapter (\d+)/i
                                );
                                if (chapterMatch) {
                                    const chapterNum = parseInt(
                                        chapterMatch[1],
                                        10
                                    );
                                    chapterCells[cellMetadata.id] =
                                        chapterNum;
                                }
                            } else if (
                                cellMetadata.type === CodexCellTypes.TEXT
                            ) {
                                const verseRef = getVerseRefForCell(cell);
                                if (verseRef) {
                                    const chapterMatch =
                                        verseRef.match(/\s(\d+):/);
                                    if (chapterMatch) {
                                        const chapterNum = parseInt(
                                            chapterMatch[1],
                                            10
                                        );
                                        if (
                                            !lastChapter ||
                                            chapterNum > parseInt(
                                                lastChapter,
                                                10
                                            )
                                        ) {
                                            if (
                                                !Object.values(
                                                    chapterCells
                                                ).includes(chapterNum)
                                            ) {
                                                chapterCells[
                                                    `auto_${chapterNum}`
                                                ] = chapterNum;
                                            }
                                        }
                                    }
                                }
                            }
                        }

                        for (const cell of relevantCells) {
                            const cellMetadata = cell.metadata;
                            let cellContent = cell.value.trim();

                            cellContent = convertHtmlToUsfm(cellContent);

                            if (
                                cellMetadata.type ===
                                CodexCellTypes.PARATEXT
                            ) {
                                if (cellContent.startsWith("Chapter ")) {
                                    const chapterMatch = cellContent.match(
                                        /Chapter (\d+)/i
                                    );
                                    if (chapterMatch) {
                                        if (lastChapter !== "") {
                                            usfmContent += chapterContent;
                                        } else if (isFirstChapter) {
                                            isFirstChapter = false;
                                        }

                                        const chapterNum = parseInt(
                                            chapterMatch[1],
                                            10
                                        );
                                        currentChapter = chapterNum;
                                        lastChapter =
                                            chapterNum.toString();
                                        chapterContent = `\\c ${chapterNum}\n\\p\n`;
                                    } else {
                                        chapterContent += `\\p ${cellContent}\n`;
                                    }
                                } else {
                                    chapterContent += `\\p ${cellContent}\n`;
                                }
                            } else if (
                                cellMetadata.type === CodexCellTypes.TEXT
                            ) {
                                const verseRef = getVerseRefForCell(cell);
                                if (verseRef) {
                                    const chapterMatch =
                                        verseRef.match(/\s(\d+):/);
                                    const verseMatch = verseRef.match(/\d+$/);

                                    if (chapterMatch && verseMatch) {
                                        const chapterNum = parseInt(
                                            chapterMatch[1],
                                            10
                                        );

                                        if (chapterNum !== currentChapter) {
                                            if (chapterContent) {
                                                usfmContent += chapterContent;
                                            }

                                            currentChapter = chapterNum;
                                            lastChapter = chapterNum.toString();
                                            chapterContent = `\\c ${chapterNum}\n\\p\n`;
                                            isFirstChapter = false;
                                        }

                                        if (
                                            lastChapter === "" &&
                                            isFirstChapter
                                        ) {
                                            lastChapter = "1";
                                            currentChapter = 1;
                                            chapterContent = `\\c 1\n\\p\n`;
                                            isFirstChapter = false;
                                        }

                                        const verseNumber = verseMatch[0];
                                        chapterContent += `\\v ${verseNumber} ${cellContent}\n`;
                                        verseCount++;
                                        hasVerses = true;
                                    }
                                }
                            }
                        }

                        if (chapterContent) {
                            usfmContent += chapterContent;
                        }

                        usfmContent =
                            usfmContent.replace(/\n{2,}/g, "\n").trim() + "\n";

                        if (!hasVerses) {
                            debug(
                                `Skipping file with no verses: ${file.fsPath}`
                            );
                            skippedFiles++;
                            continue;
                        }

                        if (!skipValidation) {
                            try {
                                debug(
                                    `Performing USFM validation for ${bookCode}`
                                );

                                const usfmParser = new grammar.USFMParser(
                                    usfmContent,
                                    grammar.LEVEL.RELAXED
                                );

                                const parseResult =
                                    usfmParser.toJSON() as any;

                                if (
                                    parseResult._messages &&
                                    parseResult._messages._warnings &&
                                    parseResult._messages._warnings.length > 0
                                ) {
                                    const seriousWarnings =
                                        parseResult._messages._warnings.filter(
                                            (warning: string) =>
                                                !warning.includes(
                                                    "Empty lines present"
                                                ) &&
                                                (warning.includes(
                                                    "Missing"
                                                ) ||
                                                    warning.includes(
                                                        "Error"
                                                    ) ||
                                                    warning.includes(
                                                        "Invalid"
                                                    ))
                                        );

                                    if (seriousWarnings.length > 0) {
                                        debug(
                                            `USFM validation warnings for ${bookCode}: ${seriousWarnings.length} serious issues found`
                                        );
                                        vscode.window.showWarningMessage(
                                            `${bookCode} has ${seriousWarnings.length} USFM validation issues`
                                        );
                                    }
                                }
                            } catch (validationError) {
                                console.error(
                                    `USFM validation error for ${bookCode}:`,
                                    validationError
                                );
                            }
                        }

                        const timestamp = new Date()
                            .toISOString()
                            .replace(/[:.]/g, "-");
                        const exportFileName = `${bookCode}_${timestamp}.usfm`;
                        const exportFile = vscode.Uri.joinPath(
                            exportFolder,
                            exportFileName
                        );
                        await vscode.workspace.fs.writeFile(
                            exportFile,
                            Buffer.from(usfmContent)
                        );

                        exportedFiles++;
                        totalVerses += verseCount;
                        debug(
                            `Export file created: ${exportFile.fsPath} with ${verseCount} verses`
                        );
                    } catch (error) {
                        console.error(
                            `Error processing file ${file.fsPath}:`,
                            error
                        );
                        skippedFiles++;
                        vscode.window.showErrorMessage(
                            `Error exporting ${basename(file.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                const skippedMessage =
                    skippedFiles > 0
                        ? ` (${skippedFiles} files skipped)`
                        : "";
                vscode.window.showInformationMessage(
                    `USFM Export completed: ${totalVerses} verses from ${exportedFiles} files exported to ${userSelectedPath}${skippedMessage}`
                );
            }
        );
    } catch (error) {
        console.error("USFM Export failed:", error);
        vscode.window.showErrorMessage(`USFM Export failed: ${error}`);
    }
}
