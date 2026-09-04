import * as vscode from "vscode";
import { basename } from "path";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";
import { readCodexNotebookFromUri, getActiveCells, isContentCellType } from "./exportHandlerUtils";
import { buildUsfmBody } from "./usfmBodyBuilder";
import { toExportFileName } from "./exportFileNameUtils";
import type { ExportOptions } from "./exportHandler";
import type { ExportProgressReporter } from "./exportProgress";

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

export async function exportCodexContentAsUsfm(
    userSelectedPath: string,
    filesToExport: string[],
    reporter: ExportProgressReporter,
    options?: ExportOptions,
    token?: vscode.CancellationToken
) {
    try {
        debug("Starting exportCodexContentAsUsfm function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            reporter.error("No project folder found. Please open a project first.");
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
            reporter.error("No files selected for export.");
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

        let totalCells = 0;
        let totalVerses = 0;
        let skippedFiles = 0;
        let exportedFiles = 0;
        const warnings: string[] = [];

        for (let i = 0; i < selectedFiles.length; i++) {
            if (token?.isCancellationRequested) return;
            const file = selectedFiles[i];
            reporter.report({
                stage: "writing",
                message: `Processing file ${i + 1}/${selectedFiles.length}`,
                file: basename(file.fsPath),
                current: i + 1,
                total: selectedFiles.length,
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
                    reporter.fileMissing(`${bookCode} (source not found)`, "source-not-found");
                    skippedFiles++;
                    continue;
                }

                const codexNotebook =
                    await readCodexNotebookFromUri(file);

                const activeCells = getActiveCells(codexNotebook.cells);

                const textCells = activeCells.filter(
                    (cell) =>
                        (cell.kind === 2 || cell.kind === 1) &&
                        isContentCellType(cell.metadata?.type)
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

                usfmContent += `\\id ${bookCode} EN\n`;
                usfmContent += `\\rem Exported from Codex Translation Editor v${extensionVersion}\n`;
                usfmContent += `\\rem Export Date: ${exportDate}\n`;
                usfmContent += `\\rem Source File: ${file.fsPath}\n`;
                usfmContent += `\\h ${fullBookName}\n`;
                usfmContent += `\\toc1 ${fullBookName}\n`;
                usfmContent += `\\toc2 ${fullBookName}\n`;
                usfmContent += `\\toc3 ${bookCode}\n`;
                usfmContent += `\\mt1 ${fullBookName}\n`;

                const relevantCells = activeCells.filter(
                    (cell) => {
                        return (
                            (cell.kind === 2 || cell.kind === 1) &&
                            cell.metadata?.type &&
                            cell.metadata?.type !==
                            CodexCellTypes.MILESTONE &&
                            cell.value.trim().length > 0
                        );
                    }
                );

                totalCells += relevantCells.length;

                const { body, verseCount, hasVerses } = buildUsfmBody(relevantCells, {
                    paratextAsHeadings: options?.paratextAsHeadings,
                });
                usfmContent += body;

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
                                warnings.push(
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

                const exportFileName = toExportFileName(bookCode, ".usfm");
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
                warnings.push(
                    `Error exporting ${basename(file.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }

        reporter.complete({
            exportPath: userSelectedPath,
            filesExported: exportedFiles,
            extraMessages: [
                `${totalVerses} verses from ${exportedFiles} file(s) exported${skippedFiles > 0 ? ` (${skippedFiles} file(s) skipped)` : ""}.`,
                ...warnings,
            ],
        });
    } catch (error) {
        console.error("USFM Export failed:", error);
        reporter.error(`USFM Export failed: ${error}`);
    }
}
