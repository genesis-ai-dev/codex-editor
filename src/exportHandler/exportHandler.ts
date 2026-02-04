import * as vscode from "vscode";
import JSZip from "jszip";
import { extractVerseRefFromLine } from "../utils/verseRefUtils";
import * as grammar from "usfm-grammar";
import { CodexCellTypes } from "../../types/enums";
import { basename } from "path";
import * as path from "path";
import * as fs from "fs";
import { exec } from "child_process";
import { promisify } from "util";
import { removeHtmlTags, generateSrtData } from "./subtitleUtils";
import { generateVttData } from "./vttUtils";
// import { exportRtfWithPandoc } from "../../webviews/codex-webviews/src/NewSourceUploader/importers/rtf/pandocNodeBridge";

const execAsync = promisify(exec);

/**
 * PERFORMANCE OPTIMIZATION NOTE:
 *
 * This file uses direct JSON file reading instead of opening files as VS Code Notebooks.
 * This approach is significantly faster, especially for large exports, as it:
 *
 * 1. Avoids the overhead of VS Code's notebook document loading
 * 2. Reduces memory usage by not creating full notebook objects
 * 3. Eliminates UI-related processing that happens with notebook documents
 *
 * The CodexNotebookAsJSONData interface defines the structure of the JSON data
 * that we read directly from the .codex files.
 */

import { CodexNotebookAsJSONData } from "../../types";

// Debug flag
const DEBUG = false;

// Custom debug function
function debug(...args: any[]) {
    if (DEBUG) {
        console.log("[DEBUG]", ...args);
    }
}

/**
 * Reads a .codex notebook from disk and parses its JSON content
 */
async function readCodexNotebookFromUri(uri: vscode.Uri): Promise<CodexNotebookAsJSONData> {
    const fileData = await vscode.workspace.fs.readFile(uri);
    return JSON.parse(Buffer.from(fileData).toString()) as CodexNotebookAsJSONData;
}

/**
 * Returns only active cells, excluding merged and deleted ones (based on metadata.data)
 * Keeps the original cell order intact
 */
function getActiveCells(cells: CodexNotebookAsJSONData["cells"]) {
    return cells.filter((cell) => {
        const data = (cell.metadata as any)?.data;
        const isMerged = !!(data && data.merged);
        const isDeleted = !!(data && data.deleted);
        return !isMerged && !isDeleted;
    });
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
    AUDIO = "audio",
    SUBTITLES_SRT = "subtitles-srt",
    SUBTITLES_VTT_WITH_STYLES = "subtitles-vtt-with-styles",
    SUBTITLES_VTT_WITHOUT_STYLES = "subtitles-vtt-without-styles",
    XLIFF = "xliff",
    CSV = "csv",
    TSV = "tsv",
    REBUILD_EXPORT = "rebuild-export",
    BACKTRANSLATIONS = "backtranslations",
}

export interface ExportOptions {
    skipValidation?: boolean;
    removeIds?: boolean;
}

// IDML Round-trip export: Uses idmlExporter or biblicaExporter based on filename
async function exportCodexContentAsIdmlRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportFolder);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting IDML Round-trip",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import both exporters
            const { exportIdmlRoundtrip } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/indesign/idmlExporter");
            const { exportIdmlRoundtrip: exportBiblicaIdml } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/biblica/biblicaExporter");

            // For each selected codex file, find its original attachment and create a translated copy in export folder
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);
                    const bookCode = fileName.split(".")[0] || "";

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Detect if this is a Biblica file based on corpusMarker metadata (more reliable than filename)
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker || '';
                    const importerType = (codexNotebook.metadata as any)?.importerType || '';
                    const fileType = (codexNotebook.metadata as any)?.fileType || '';
                    const isBiblicaFile =
                        corpusMarker === 'biblica' ||
                        corpusMarker === 'biblica-idml' ||
                        importerType === 'biblica' ||
                        fileType === 'biblica' ||
                        importerType === 'biblica-experimental' || // Backward compatibility
                        fileType === 'biblica-experimental' || // Backward compatibility
                        fileName.toLowerCase().endsWith('-biblica.codex');
                    const exporterType = isBiblicaFile ? 'Biblica' : 'Standard';

                    console.log(`[IDML Export] Processing ${fileName} (corpusMarker: ${corpusMarker}) using ${exporterType} exporter`);

                    // Lookup original attachment by originalFileName or originalName metadata on the notebook (fallback to {bookCode}.idml)
                    // Note: NewSourceUploaderProvider stores it as "originalName", but some importers use "originalFileName"
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName ||
                        (codexNotebook.metadata as any)?.originalName ||
                        `${bookCode}.idml`;
                    const originalsDir = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "originals"
                    );
                    const originalFileUri = vscode.Uri.joinPath(originalsDir, originalFileName);

                    // Load original IDML
                    const idmlData = await vscode.workspace.fs.readFile(originalFileUri);

                    // Use the appropriate exporter based on file type
                    let updatedIdmlData: Uint8Array;
                    if (isBiblicaFile) {
                        updatedIdmlData = await exportBiblicaIdml(idmlData, codexNotebook.cells);
                    } else {
                        updatedIdmlData = await exportIdmlRoundtrip(idmlData, codexNotebook.cells);
                    }

                    // Save duplicated, injected IDML into the chosen export folder
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const suffix = isBiblicaFile ? '_biblica_translated' : '_translated';
                    const injectedName = originalFileName.replace(/\.idml$/i, `_${timestamp}${suffix}.idml`);
                    const injectedUri = vscode.Uri.joinPath(exportFolder, injectedName);
                    await vscode.workspace.fs.writeFile(injectedUri, updatedIdmlData);

                    console.log(`[IDML Export] ${exporterType} export completed: ${injectedName}`);
                } catch (err) {
                    console.error("IDML round-trip export failed:", err);
                    vscode.window.showErrorMessage(`IDML round-trip export failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            vscode.window.showInformationMessage(`IDML round-trip export completed to ${userSelectedPath}`);
        }
    );
}

// DOCX Round-trip export: Uses experimental DOCX exporter for round-trip functionality
async function exportCodexContentAsDocxRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportFolder);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting DOCX Round-trip (Experimental)",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import experimental DOCX exporter
            const { exportDocxWithTranslations } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/docx/experiment/docxExporter");

            // For each selected codex file, find its original attachment and create a translated copy in export folder
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);
                    const bookCode = fileName.split(".")[0] || "";

                    console.log(`[DOCX Export] Processing ${fileName} using experimental round-trip exporter`);

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Check if this is a round-trip DOCX file
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker;
                    if (corpusMarker !== 'docx-roundtrip') {
                        console.warn(`[DOCX Export] Skipping ${fileName} - not imported with round-trip importer (corpusMarker: ${corpusMarker})`);
                        vscode.window.showWarningMessage(`Skipping ${fileName} - not imported with DOCX round-trip importer`);
                        continue;
                    }

                    // Lookup original attachment by originalFileName metadata
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName || `${bookCode}.docx`;
                    // Originals are stored under `.project/attachments/files/originals/` (preferred).
                    // Fallback to legacy `.project/attachments/originals/` if needed.
                    const originalsDirPreferred = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "files",
                        "originals"
                    );
                    const originalsDirLegacy = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "originals"
                    );
                    const preferredUri = vscode.Uri.joinPath(originalsDirPreferred, originalFileName);
                    const legacyUri = vscode.Uri.joinPath(originalsDirLegacy, originalFileName);
                    let originalFileUri = preferredUri;
                    try {
                        await vscode.workspace.fs.stat(preferredUri);
                    } catch {
                        originalFileUri = legacyUri;
                    }

                    // Load original DOCX
                    const docxData = await vscode.workspace.fs.readFile(originalFileUri);

                    // Export with translations
                    const updatedDocxData = await exportDocxWithTranslations(
                        docxData.buffer as ArrayBuffer,
                        codexNotebook.cells
                    );

                    // Save translated DOCX into the chosen export folder
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const exportedName = originalFileName.replace(/\.docx$/i, `_${timestamp}_translated.docx`);
                    const exportedUri = vscode.Uri.joinPath(exportFolder, exportedName);
                    await vscode.workspace.fs.writeFile(exportedUri, new Uint8Array(updatedDocxData));

                    console.log(`[DOCX Export] Round-trip export completed: ${exportedName}`);
                } catch (err) {
                    console.error("DOCX round-trip export failed:", err);
                    vscode.window.showErrorMessage(`DOCX round-trip export failed: ${err instanceof Error ? err.message : String(err)}`);
                }
            }

            vscode.window.showInformationMessage(`DOCX round-trip export completed to ${userSelectedPath}`);
        }
    );
}

// PDF Round-trip export
async function exportCodexContentAsPdfRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportFolder);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting PDF Round-trip",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import PDF exporter
            const { exportPdfWithTranslations } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/pdf/pdfExporter");

            // For each selected codex file, find its original attachment and create a translated copy in export folder
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);
                    const bookCode = fileName.split(".")[0] || "";

                    console.log(`[PDF Export] Processing ${fileName} using PDF exporter`);

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Check if this is a PDF file
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker || '';
                    const isPdfFile = corpusMarker === 'pdf' || corpusMarker === 'pdf-importer' || corpusMarker === 'pdf-sentence';
                    if (!isPdfFile) {
                        console.warn(`[PDF Export] Skipping ${fileName} - not imported with PDF importer (corpusMarker: ${corpusMarker})`);
                        vscode.window.showWarningMessage(`Skipping ${fileName} - not imported with PDF importer`);
                        continue;
                    }

                    // Lookup original attachment by originalFileName metadata
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName || `${bookCode}.pdf`;
                    const originalsDir = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "originals"
                    );
                    const originalFileUri = vscode.Uri.joinPath(originalsDir, originalFileName);

                    // Load original PDF
                    const pdfData = await vscode.workspace.fs.readFile(originalFileUri);

                    // Use PDF exporter to create translated PDF
                    // Convert Uint8Array to proper ArrayBuffer for pdf-lib
                    const pdfBuffer = new Uint8Array(pdfData).buffer as ArrayBuffer;
                    const updatedPdfData = await exportPdfWithTranslations(pdfBuffer, codexNotebook.cells);

                    // Save updated PDF into the chosen export folder
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const translatedName = originalFileName.replace(/\.pdf$/i, `_${timestamp}_translated.pdf`);
                    const translatedUri = vscode.Uri.joinPath(exportFolder, translatedName);

                    await vscode.workspace.fs.writeFile(translatedUri, new Uint8Array(updatedPdfData));

                    console.log(`[PDF Export] ✓ Exported ${translatedName}`);

                } catch (error) {
                    console.error(`[PDF Export] Error exporting ${filePath}:`, error);
                    vscode.window.showErrorMessage(`Failed to export ${basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            vscode.window.showInformationMessage(`PDF round-trip export completed to ${userSelectedPath}`);
        }
    );
}

/**
 * OBS (Open Bible Stories) Round-trip export
 */
async function exportCodexContentAsObsRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportFolder);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting OBS Markdown Round-trip",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import OBS exporter
            const { exportObsWithTranslations } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/obs/obsExporter");

            // For each selected codex file, reconstruct the OBS markdown with translations
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);

                    console.log(`[OBS Export] Processing ${fileName} using OBS markdown exporter`);

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Check if this is an OBS file
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker;
                    if (corpusMarker !== 'obs') {
                        console.warn(`[OBS Export] Skipping ${fileName} - not imported with OBS importer (corpusMarker: ${corpusMarker})`);
                        vscode.window.showWarningMessage(`Skipping ${fileName} - not imported with OBS importer`);
                        continue;
                    }

                    // Get the stored OBS story structure
                    let obsStoryJson = (codexNotebook.metadata as any)?.obsStory;

                    // If obsStory is not in metadata, reconstruct it from cells
                    if (!obsStoryJson) {
                        console.warn(`[OBS Export] No OBS story structure in metadata for ${fileName}, reconstructing from cells...`);

                        const { extractObsStoryFromCells } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/obs/obsExporter");
                        const reconstructedStory = extractObsStoryFromCells(codexNotebook.cells);
                        obsStoryJson = JSON.stringify(reconstructedStory);

                        console.log('[OBS Export] Reconstructed story structure from cells');
                    } else {
                        console.log('[OBS Export] Retrieved OBS story structure from metadata');
                    }

                    // Export with translations
                    const updatedMarkdown = await exportObsWithTranslations(
                        codexNotebook.cells,
                        obsStoryJson // Pass the JSON string, exporter will parse it
                    );

                    console.log('[OBS Export] Generated markdown with translations, length:', updatedMarkdown.length);

                    // Determine output filename
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName || `${fileName.split('.')[0]}.md`;
                    const baseFileName = originalFileName.replace(/\.md$/i, '');

                    // Create timestamped filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split('T')[0]; // YYYY-MM-DD format
                    const exportedName = `${baseFileName}_${timestamp}_translated.md`;
                    const exportedUri = vscode.Uri.joinPath(exportFolder, exportedName);

                    // Write markdown content
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(exportedUri, encoder.encode(updatedMarkdown));

                    console.log(`[OBS Export] ✓ Exported ${exportedName}`);

                } catch (error) {
                    console.error(`[OBS Export] Error exporting ${filePath}:`, error);
                    vscode.window.showErrorMessage(`Failed to export ${basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            vscode.window.showInformationMessage(`OBS markdown round-trip export completed to ${userSelectedPath}`);
        }
    );
}

/**
 * USFM (Unified Standard Format Marker) Round-trip export
 * Rebuilds original USFM file with translated content
 */
async function exportCodexContentAsUsfmRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting USFM Round-trip",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import USFM exporter from experimental (now standalone implementation)
            const experimentalExporter = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/usfm/experimental/usfmExporter");
            const exportUsfmRoundtrip = experimentalExporter.exportUsfmRoundtrip;

            // For each selected codex file, reconstruct the USFM with translations
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);
                    const bookCode = fileName.split(".")[0] || "";

                    console.log(`[USFM Export] Processing ${fileName} using USFM round-trip exporter`);

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Check if this is a USFM file (experimental or standalone)
                    const importerType = (codexNotebook.metadata as any)?.importerType;
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker;

                    if (importerType !== 'usfm-experimental' && corpusMarker !== 'usfm') {
                        console.warn(`[USFM Export] Skipping ${fileName} - not imported with USFM importer (importerType: ${importerType}, corpusMarker: ${corpusMarker})`);
                        vscode.window.showWarningMessage(`Skipping ${fileName} - not imported with USFM importer`);
                        continue;
                    }

                    // Get original file name from metadata with fallback
                    // Try multiple sources: codex metadata, source notebook metadata, or construct from bookCode
                    let metadataOriginalFileName = (codexNotebook.metadata as any)?.originalFileName;
                    const metadataBookCode = (codexNotebook.metadata as any)?.bookCode;
                    const finalBookCode = metadataBookCode || bookCode;

                    // If not found in codex metadata, try source notebook metadata
                    if (!metadataOriginalFileName) {
                        try {
                            const sourceFileName = fileName.replace('.codex', '.source');
                            const sourceFileUri = vscode.Uri.joinPath(
                                workspaceFolders[0].uri,
                                ".project",
                                "sourceTexts",
                                sourceFileName
                            );
                            const sourceNotebook = await readCodexNotebookFromUri(sourceFileUri);
                            metadataOriginalFileName = (sourceNotebook.metadata as any)?.originalFileName;
                            if (metadataOriginalFileName) {
                                console.log(`[USFM Export] Found originalFileName in source notebook: ${metadataOriginalFileName}`);
                            }
                        } catch (error) {
                            // Source notebook not found or error reading it, continue with fallbacks
                            console.log(`[USFM Export] Could not read source notebook for originalFileName`);
                        }
                    }

                    // Try common USFM file extensions
                    const possibleExtensions = ['.usfm', '.sfm', '.USFM', '.SFM'];
                    let originalFileName = metadataOriginalFileName;

                    // If no originalFileName, try to find it in originals folder
                    if (!originalFileName && finalBookCode) {
                        const originalsDir = vscode.Uri.joinPath(
                            workspaceFolders[0].uri,
                            ".project",
                            "attachments",
                            "originals"
                        );

                        // Try each extension
                        for (const ext of possibleExtensions) {
                            const testFileName = `${finalBookCode}${ext}`;
                            const testUri = vscode.Uri.joinPath(originalsDir, testFileName);
                            try {
                                await vscode.workspace.fs.stat(testUri);
                                originalFileName = testFileName;
                                console.log(`[USFM Export] Found original file: ${testFileName}`);
                                break;
                            } catch {
                                // File doesn't exist, try next extension
                            }
                        }
                    }

                    // Final fallback: construct filename from bookCode
                    if (!originalFileName) {
                        originalFileName = `${finalBookCode}.usfm`;
                        console.log(`[USFM Export] Using fallback filename: ${originalFileName}`);
                    }

                    // Load original USFM file from attachments/originals
                    const originalsDir = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "originals"
                    );
                    const originalFileUri = vscode.Uri.joinPath(originalsDir, originalFileName);

                    let originalUsfmContent: string;
                    try {
                        const originalFileData = await vscode.workspace.fs.readFile(originalFileUri);
                        originalUsfmContent = new TextDecoder('utf-8').decode(originalFileData);
                        console.log(`[USFM Export] Loaded original USFM file: ${originalFileName}`);
                    } catch (error) {
                        // Fallback: try to get from structureMetadata if available
                        const structureMetadata = (codexNotebook.metadata as any)?.structureMetadata;
                        if (structureMetadata?.originalUsfmContent) {
                            originalUsfmContent = structureMetadata.originalUsfmContent;
                            console.log(`[USFM Export] Using original USFM content from metadata (file not found at ${originalFileUri.fsPath})`);
                        } else {
                            throw new Error(`Original USFM file not found at ${originalFileUri.fsPath} and no original content in metadata`);
                        }
                    }

                    // Build codex cells array
                    // Include id property if it exists (some cells have id at top level, others in metadata.id)
                    const codexCells = codexNotebook.cells.map(cell => {
                        const cellData: any = {
                            kind: cell.kind,
                            value: cell.value,
                            metadata: cell.metadata,
                        };
                        // Include id if it exists at top level (for ProcessedCell structure)
                        if ((cell as any).id) {
                            cellData.id = (cell as any).id;
                        }
                        return cellData;
                    });

                    // Get lineMappings from structureMetadata if available (for standalone exporter)
                    const structureMetadata = (codexNotebook.metadata as any)?.structureMetadata;
                    const lineMappings = structureMetadata?.lineMappings;

                    // Debug: Log structureMetadata and lineMappings
                    if (lineMappings) {
                        console.log(`[USFM Export] Found lineMappings: ${lineMappings.length} entries`);
                        const sampleMapping = lineMappings.find((m: any) => m.cellId);
                        console.log(`[USFM Export] Sample mapping with cellId:`, sampleMapping);
                        console.log(`[USFM Export] Mappings with cellId count:`, lineMappings.filter((m: any) => m.cellId && m.cellId !== '').length);
                    } else {
                        console.warn(`[USFM Export] No lineMappings found in structureMetadata`);
                        console.log(`[USFM Export] structureMetadata keys:`, structureMetadata ? Object.keys(structureMetadata) : 'null');
                    }

                    // Export USFM with translations
                    // If we have lineMappings, use them for precise round-trip export
                    let updatedUsfmContent: string;
                    if (lineMappings) {
                        updatedUsfmContent = await exportUsfmRoundtrip(originalUsfmContent, lineMappings, codexCells);
                    } else {
                        // Use backward-compatible signature (no lineMappings - fallback mode)
                        updatedUsfmContent = await exportUsfmRoundtrip(originalUsfmContent, codexCells);
                    }

                    // Save to export folder
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const exportedName = originalFileName.replace(/\.(usfm|sfm|USFM|SFM)$/i, `_${timestamp}_translated.$1`);
                    const exportedUri = vscode.Uri.joinPath(exportFolder, exportedName);

                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(exportedUri, encoder.encode(updatedUsfmContent));

                    console.log(`[USFM Export] ✓ Exported ${exportedName}`);

                } catch (error) {
                    console.error(`[USFM Export] Error exporting ${filePath}:`, error);
                    vscode.window.showErrorMessage(`Failed to export ${basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            vscode.window.showInformationMessage(`USFM round-trip export completed to ${userSelectedPath}`);
        }
    );
}

/**
 * TMS (Translation Memory System) Round-trip export
 * Supports both TMX and XLIFF formats
 */
async function exportCodexContentAsTmsRoundtrip(
    userSelectedPath: string,
    filesToExport: string[],
    _options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    const exportFolder = vscode.Uri.file(userSelectedPath);
    await vscode.workspace.fs.createDirectory(exportFolder);

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Exporting TMS Round-trip",
            cancellable: false,
        },
        async (progress) => {
            const increment = filesToExport.length > 0 ? 100 / filesToExport.length : 100;

            // Import TMS exporter
            const { exportTmsWithTranslations } = await import("../../webviews/codex-webviews/src/NewSourceUploader/importers/tms/tmsExporter");

            // For each selected codex file, reconstruct the TMS file with translations
            for (const [index, filePath] of filesToExport.entries()) {
                progress.report({ message: `Processing ${index + 1}/${filesToExport.length}`, increment });
                try {
                    const file = vscode.Uri.file(filePath);
                    const fileName = basename(file.fsPath);

                    console.log(`[TMS Export] Processing ${fileName} using TMS exporter`);

                    // Read codex notebook
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    // Check if this is a TMS file - check both corpusMarker and fileFormat for backwards compatibility
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker;
                    const fileFormat = (codexNotebook.metadata as any)?.fileFormat || corpusMarker; // Fallback to corpusMarker for old files
                    const fileType = (codexNotebook.metadata as any)?.fileType; // Direct file type field (tmx or xliff)
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName; // Get original filename (stored as originalFileName in metadata)

                    if (corpusMarker !== 'tms' && fileFormat !== 'tms-tmx' && fileFormat !== 'tms-xliff') {
                        console.warn(`[TMS Export] Skipping ${fileName} - not imported with TMS importer (corpusMarker: ${corpusMarker}, fileFormat: ${fileFormat})`);
                        vscode.window.showWarningMessage(`Skipping ${fileName} - not imported with TMS importer`);
                        continue;
                    }

                    // Determine file type with multiple fallback strategies:
                    // 1. Use fileType metadata if available (new imports)
                    // 2. Check fileFormat metadata (tms-tmx or tms-xliff)
                    // 3. Extract from originalFileName if available (most reliable for old imports)
                    // 4. Default to tmx
                    let determinedFileType: 'tmx' | 'xliff';
                    if (fileType) {
                        determinedFileType = fileType;
                    } else if (originalFileName) {
                        // Extract extension from original filename
                        const lowerFileName = originalFileName.toLowerCase();
                        if (lowerFileName.endsWith('.xliff') || lowerFileName.endsWith('.xlf')) {
                            determinedFileType = 'xliff';
                        } else if (lowerFileName.endsWith('.tmx')) {
                            determinedFileType = 'tmx';
                        } else {
                            determinedFileType = (fileFormat === 'tms-tmx' ? 'tmx' : 'xliff');
                        }
                    } else if (fileFormat === 'tms-tmx' || fileFormat === 'tmx') {
                        determinedFileType = 'tmx';
                    } else {
                        determinedFileType = 'xliff';
                    }

                    const fileExtension = determinedFileType === 'tmx' ? '.tmx' : '.xliff';

                    // Use originalFileName from metadata, or construct fallback
                    const finalOriginalFileName = originalFileName || `${fileName.split('.')[0]}${fileExtension}`;
                    const originalsDir = vscode.Uri.joinPath(
                        workspaceFolders[0].uri,
                        ".project",
                        "attachments",
                        "originals"
                    );
                    const originalFileUri = vscode.Uri.joinPath(originalsDir, finalOriginalFileName);

                    // Load original TMS file
                    const tmsData = await vscode.workspace.fs.readFile(originalFileUri);
                    const originalTmsContent = new TextDecoder('utf-8').decode(tmsData);

                    console.log(`[TMS Export] Loaded original ${determinedFileType.toUpperCase()} file:`, finalOriginalFileName, 'length:', originalTmsContent.length);

                    // Export with translations
                    const updatedTmsContent = await exportTmsWithTranslations(
                        originalTmsContent,
                        codexNotebook.cells,
                        determinedFileType
                    );

                    console.log(`[TMS Export] Generated ${determinedFileType.toUpperCase()} with translations, length:`, updatedTmsContent.length);

                    // Determine output filename
                    const baseFileName = finalOriginalFileName.replace(/\.(tmx|xliff|xlf)$/i, '');

                    // Create timestamped filename
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-").split('T')[0]; // YYYY-MM-DD format
                    const exportedName = `${baseFileName}_${timestamp}_translated${fileExtension}`;
                    const exportedUri = vscode.Uri.joinPath(exportFolder, exportedName);

                    // Write TMS content
                    const encoder = new TextEncoder();
                    await vscode.workspace.fs.writeFile(exportedUri, encoder.encode(updatedTmsContent));

                    console.log(`[TMS Export] ✓ Exported ${exportedName}`);

                } catch (error) {
                    console.error(`[TMS Export] Error exporting ${filePath}:`, error);
                    vscode.window.showErrorMessage(`Failed to export ${basename(filePath)}: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            vscode.window.showInformationMessage(`TMS round-trip export completed to ${userSelectedPath}`);
        }
    );
}

/**
 * Rebuild Export: Intelligently routes files to appropriate exporters based on corpusMarker metadata
 * This enables round-trip export for multiple file types in a single export operation
 */
async function exportCodexContentAsRebuild(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder found.");
        return;
    }

    return vscode.window.withProgress(
        {
            location: vscode.ProgressLocation.Notification,
            title: "Rebuilding Exports",
            cancellable: false,
        },
        async (progress) => {
            // Group files by their corpusMarker (file type)
            const filesByType: Record<string, string[]> = {};
            const unsupportedFiles: Array<{ file: string; marker: string; }> = [];

            progress.report({ message: "Analyzing file types...", increment: 10 });

            // Analyze each file's corpusMarker
            for (const filePath of filesToExport) {
                try {
                    const file = vscode.Uri.file(filePath);
                    const codexNotebook = await readCodexNotebookFromUri(file);
                    const corpusMarker = (codexNotebook.metadata as any)?.corpusMarker;
                    const importerType = (codexNotebook.metadata as any)?.importerType;
                    const fileType = (codexNotebook.metadata as any)?.fileType;
                    const originalFileName = (codexNotebook.metadata as any)?.originalFileName;

                    console.log(`[Rebuild Export] File: ${basename(filePath)}, corpusMarker: ${corpusMarker}, importerType: ${importerType}, fileType: ${fileType}`);

                    // Group by supported types
                    if (corpusMarker === 'docx-roundtrip') {
                        filesByType['docx'] = filesByType['docx'] || [];
                        filesByType['docx'].push(filePath);
                    } else if (
                        corpusMarker === 'biblica' ||
                        corpusMarker === 'biblica-idml' ||
                        corpusMarker === 'idml-roundtrip' ||
                        corpusMarker.startsWith('idml-') ||
                        importerType === 'biblica' ||
                        fileType === 'biblica' ||
                        importerType === 'biblica-experimental' || // Backward compatibility
                        fileType === 'biblica-experimental' // Backward compatibility
                    ) {
                        // Biblica files and IDML files both use the IDML exporter
                        // Includes Biblica importer which uses the same IDML format
                        filesByType['idml'] = filesByType['idml'] || [];
                        filesByType['idml'].push(filePath);

                    } else if (corpusMarker === 'obs' || importerType === 'obs') {
                        // OBS (Open Bible Stories) markdown files use the OBS exporter
                        // Fallback: also detect by importerType for older files
                        filesByType['obs'] = filesByType['obs'] || [];
                        filesByType['obs'].push(filePath);
                    } else if (
                        corpusMarker === 'tms' || // New: Unified TMS corpus marker
                        corpusMarker === 'tms-tmx' || // Legacy: Backwards compatibility
                        corpusMarker === 'tms-xliff' || // Legacy: Backwards compatibility
                        // Fallback detection for TMS files without corpusMarker
                        (importerType === 'tms') || // New: Check importerType
                        (importerType === 'translation' && (fileType === 'tmx' || fileType === 'xliff')) ||
                        (originalFileName && (originalFileName.endsWith('.tmx') || originalFileName.endsWith('.xliff') || originalFileName.endsWith('.xlf')))
                    ) {
                        // TMS (Translation Memory System) files use the TMS exporter
                        filesByType['tms'] = filesByType['tms'] || [];
                        filesByType['tms'].push(filePath);
                    } else if (
                        corpusMarker === 'usfm' ||
                        importerType === 'usfm-experimental' ||
                        importerType === 'usfm' ||
                        // Also check for NT/OT corpus markers with USFM file extensions (Bible books imported as USFM)
                        ((corpusMarker === 'NT' || corpusMarker === 'OT') &&
                            originalFileName &&
                            (originalFileName.endsWith('.usfm') || originalFileName.endsWith('.sfm') || originalFileName.endsWith('.USFM') || originalFileName.endsWith('.SFM'))) ||
                        (originalFileName && (originalFileName.endsWith('.usfm') || originalFileName.endsWith('.sfm') || originalFileName.endsWith('.USFM') || originalFileName.endsWith('.SFM')))
                    ) {
                        // USFM files use the USFM round-trip exporter
                        filesByType['usfm'] = filesByType['usfm'] || [];
                        filesByType['usfm'].push(filePath);
                    } else {
                        unsupportedFiles.push({ file: basename(filePath), marker: corpusMarker || importerType || 'unknown' });
                    }
                } catch (error) {
                    console.error(`[Rebuild Export] Error analyzing ${filePath}:`, error);
                    unsupportedFiles.push({ file: basename(filePath), marker: 'error' });
                }
            }

            // Report analysis results
            const typeCount = Object.keys(filesByType).length;
            const supportedCount = Object.values(filesByType).reduce((sum, files) => sum + files.length, 0);

            console.log(`[Rebuild Export] Found ${supportedCount} supported files across ${typeCount} types`);
            console.log(`[Rebuild Export] File groups:`, Object.keys(filesByType).map(type => `${type}: ${filesByType[type].length}`).join(', '));

            // Export each file type group
            let processedCount = 0;
            const totalFiles = supportedCount;

            // Export DOCX files
            if (filesByType['docx']?.length > 0) {
                console.log(`[Rebuild Export] Exporting ${filesByType['docx'].length} DOCX file(s)...`);
                progress.report({
                    message: `Exporting ${filesByType['docx'].length} DOCX file(s)...`,
                    increment: 30
                });
                try {
                    await exportCodexContentAsDocxRoundtrip(userSelectedPath, filesByType['docx'], options);
                    processedCount += filesByType['docx'].length;
                } catch (error) {
                    console.error('[Rebuild Export] DOCX export failed:', error);
                    vscode.window.showErrorMessage(`DOCX export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Export IDML files
            if (filesByType['idml']?.length > 0) {
                console.log(`[Rebuild Export] Exporting ${filesByType['idml'].length} IDML file(s)...`);
                progress.report({
                    message: `Exporting ${filesByType['idml'].length} IDML file(s)...`,
                    increment: 20
                });
                try {
                    await exportCodexContentAsIdmlRoundtrip(userSelectedPath, filesByType['idml'], options);
                    processedCount += filesByType['idml'].length;
                } catch (error) {
                    console.error('[Rebuild Export] IDML export failed:', error);
                    vscode.window.showErrorMessage(`IDML export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }
            // Export OBS files
            if (filesByType['obs']?.length > 0) {
                console.log(`[Rebuild Export] Exporting ${filesByType['obs'].length} OBS markdown file(s)...`);
                progress.report({
                    message: `Exporting ${filesByType['obs'].length} OBS file(s)...`,
                    increment: 20
                });
                try {
                    await exportCodexContentAsObsRoundtrip(userSelectedPath, filesByType['obs'], options);
                    processedCount += filesByType['obs'].length;
                } catch (error) {
                    console.error('[Rebuild Export] OBS export failed:', error);
                    vscode.window.showErrorMessage(`OBS export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Export TMS files
            if (filesByType['tms']?.length > 0) {
                console.log(`[Rebuild Export] Exporting ${filesByType['tms'].length} TMS file(s)...`);
                progress.report({
                    message: `Exporting ${filesByType['tms'].length} TMS file(s)...`,
                    increment: 20
                });
                try {
                    await exportCodexContentAsTmsRoundtrip(userSelectedPath, filesByType['tms'], options);
                    processedCount += filesByType['tms'].length;
                } catch (error) {
                    console.error('[Rebuild Export] TMS export failed:', error);
                    vscode.window.showErrorMessage(`TMS export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            // Export USFM files
            if (filesByType['usfm']?.length > 0) {
                console.log(`[Rebuild Export] Exporting ${filesByType['usfm'].length} USFM file(s)...`);
                progress.report({
                    message: `Exporting ${filesByType['usfm'].length} USFM file(s)...`,
                    increment: 20
                });
                try {
                    await exportCodexContentAsUsfmRoundtrip(userSelectedPath, filesByType['usfm'], options);
                    processedCount += filesByType['usfm'].length;
                } catch (error) {
                    console.error('[Rebuild Export] USFM export failed:', error);
                    vscode.window.showErrorMessage(`USFM export failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                }
            }

            progress.report({ message: "Complete", increment: 30 });

            // Show summary
            const messages: string[] = [];
            if (processedCount > 0) {
                messages.push(`✓ Successfully exported ${processedCount} file(s)`);
            }
            if (unsupportedFiles.length > 0) {
                messages.push(`⚠ Skipped ${unsupportedFiles.length} unsupported file(s)`);
                console.warn('[Rebuild Export] Unsupported files:', unsupportedFiles);
            }

            if (messages.length > 0) {
                vscode.window.showInformationMessage(messages.join('\n'));
            }

            // Show details for unsupported files
            if (unsupportedFiles.length > 0) {
                const unsupportedList = unsupportedFiles
                    .map(f => `  • ${f.file} (type: ${f.marker})`)
                    .join('\n');

                vscode.window.showWarningMessage(
                    `The following files were skipped (unsupported or coming soon):\n${unsupportedList}\n\nSupported types: DOCX, IDML, Biblica, PDF`,
                    { modal: false }
                );
            }
        }
    );
}

export async function exportCodexContent(
    format: CodexExportFormat,
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    switch (format) {
        case CodexExportFormat.PLAINTEXT:
            await exportCodexContentAsPlaintext(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.USFM:
            await exportCodexContentAsUsfm(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.HTML:
            await exportCodexContentAsHtml(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.AUDIO: {
            const { exportAudioAttachments } = await import("./audioExporter");
            await exportAudioAttachments(userSelectedPath, filesToExport, { includeTimestamps: (options as any)?.includeTimestamps });
            break;
        }
        case CodexExportFormat.SUBTITLES_VTT_WITH_STYLES:
            await exportCodexContentAsSubtitlesVtt(userSelectedPath, filesToExport, options, true);
            break;
        case CodexExportFormat.SUBTITLES_VTT_WITHOUT_STYLES:
            await exportCodexContentAsSubtitlesVtt(userSelectedPath, filesToExport, options, false);
            break;
        case CodexExportFormat.SUBTITLES_SRT:
            await exportCodexContentAsSubtitlesSrt(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.XLIFF:
            await exportCodexContentAsXliff(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.CSV:
            await exportCodexContentAsCsv(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.TSV:
            await exportCodexContentAsTsv(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.REBUILD_EXPORT:
            await exportCodexContentAsRebuild(userSelectedPath, filesToExport, options);
            break;
        case CodexExportFormat.BACKTRANSLATIONS:
            await exportCodexContentAsBacktranslations(userSelectedPath, filesToExport, options);
            break;
    }
}

// Compact helpers for id handling and lookups
function idCandidates(id: string): string[] {
    const raw = (id || "").trim();
    if (!raw) return [];
    const noSuffix = raw.replace(/_\d+_complete\s+/, " ").replace(/\s+/g, " ").trim();
    const set = new Set<string>([raw, noSuffix]);
    const m = noSuffix.match(/^(\S+)\s+(\d+)\s*:\s*(\d+)$/);
    if (m) {
        const book = m[1];
        const ref = `${Number(m[2])}:${Number(m[3])}`;
        set.add(`${book} ${ref}`);
        set.add(ref);
    }
    return Array.from(set);
}

function addCandidates(map: Map<string, string>, id: string, value: string) {
    for (const k of idCandidates(id)) if (!map.has(k)) map.set(k, value);
}

function firstFrom(map: Map<string, string>, keys: string[]): string {
    for (const k of keys) {
        const v = map.get(k);
        if (v !== undefined) return v;
    }
    return "";
}

export const exportCodexContentAsSubtitlesSrt = async (
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) => {
    try {
        debug("Starting exportCodexContentAsSubtitlesSrt function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

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
                title: "Exporting Codex Content as SRT Subtitles",
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
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

                    // Read and filter active cells (exclude merged/deleted)
                    const codexData = await readCodexNotebookFromUri(file);
                    const cells = getActiveCells(codexData.cells);

                    totalCells += cells.length;
                    debug(`File has ${cells.length} active cells`);

                    // Generate SRT content
                    const srtContent = generateSrtData(cells, false); // Don't include styles for SRT

                    // Write file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const fileName = basename(file.fsPath).replace(".codex", "") || "unknown";
                    const exportFileName = `${fileName}_${timestamp}.srt`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(srtContent));
                    debug(`Export file created: ${exportFile.fsPath}`);
                }

                vscode.window.showInformationMessage(
                    `SRT Export completed: ${totalCells} cells from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("SRT Export failed:", error);
        vscode.window.showErrorMessage(`SRT Export failed: ${error}`);
    }
};

export const exportCodexContentAsSubtitlesVtt = async (
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions,
    includeStyles: boolean = true
) => {
    try {
        debug("Starting exportCodexContentAsSubtitlesVtt function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

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
                title: "Exporting Codex Content as VTT Subtitles",
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
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

                    // Read and filter active cells (exclude merged/deleted)
                    const codexData = await readCodexNotebookFromUri(file);
                    const cells = getActiveCells(codexData.cells);

                    totalCells += cells.length;
                    debug(`File has ${cells.length} active cells`);

                    // Generate VTT content
                    const vttContent = generateVttData(cells, includeStyles, file.fsPath); // Include styles for VTT
                    debug({ vttContent, cells, includeStyles });

                    // Write file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const fileName = basename(file.fsPath).replace(".codex", "") || "unknown";
                    const exportFileName = `${fileName}_${timestamp}.vtt`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);

                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(vttContent));
                    debug(`Export file created: ${exportFile.fsPath}`);
                }

                vscode.window.showInformationMessage(
                    `VTT Export completed: ${totalCells} cells from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("VTT Export failed:", error);
        vscode.window.showErrorMessage(`VTT Export failed: ${error}`);
    }
};

async function exportCodexContentAsPlaintext(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
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

                    // Read and filter active cells (exclude merged/deleted)
                    const codexData = await readCodexNotebookFromUri(file);
                    const cells = getActiveCells(codexData.cells);

                    debug(`File has ${cells.length} active cells`);

                    let exportContent = "";
                    let currentChapter = "";
                    let chapterContent = "";
                    const includeIds = !(options?.removeIds);

                    // Already filtered for merged and deleted
                    const activeCells = cells;

                    for (const cell of activeCells) {
                        totalCells++;
                        if (cell.kind === 2 || cell.kind === 1) { //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
                            // vscode.NotebookCellKind.Code
                            const cellMetadata = cell.metadata;

                            if (cellMetadata.type === "paratext" && cell.value.startsWith("<h1>")) {
                                debug("Found chapter heading cell");
                                if (chapterContent) {
                                    exportContent += chapterContent + "\n\n";
                                }
                                // Clean HTML from chapter heading
                                currentChapter = cell.value.replace(/<\/?[^>]+(>|$)/g, "").trim();
                                chapterContent = `${currentChapter}\n`;
                                debug(`New chapter: ${currentChapter}`);
                            } else if (cellMetadata.type === "text" && cellMetadata.id) {
                                debug(`Processing verse cell: ${cellMetadata.id}`);
                                const verseRef = cellMetadata.id;
                                // Clean HTML from verse content
                                const verseContent = cell.value
                                    .replace(/<\/?[^>]+(>|$)/g, "")
                                    .trim();
                                if (verseContent) {
                                    chapterContent += includeIds ? `${verseRef} ${verseContent}\n` : `${verseContent}\n`;
                                    totalVerses++;
                                }
                            }
                        }
                    }

                    // Add the last chapter's content
                    if (chapterContent) {
                        exportContent += chapterContent + "\n\n";
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

                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(exportContent));
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

/**
 * Converts HTML formatting to USFM equivalents
 * @param html The HTML content to convert
 * @returns The content with HTML converted to USFM markers
 */
function convertHtmlToUsfm(html: string): string {
    if (!html) return "";

    let content = html;

    // Convert headings (except h1 which is handled separately for chapters)
    content = content.replace(/<h2>(.*?)<\/h2>/gi, "\\s1 $1");
    content = content.replace(/<h3>(.*?)<\/h3>/gi, "\\s2 $1");
    content = content.replace(/<h4>(.*?)<\/h4>/gi, "\\s3 $1");

    // Convert emphasis
    content = content.replace(/<em>(.*?)<\/em>/gi, "\\em $1\\em*");
    content = content.replace(/<i>(.*?)<\/i>/gi, "\\it $1\\it*");

    // Convert bold
    content = content.replace(/<strong>(.*?)<\/strong>/gi, "\\bd $1\\bd*");
    content = content.replace(/<b>(.*?)<\/b>/gi, "\\bd $1\\bd*");

    // Convert underline
    content = content.replace(/<u>(.*?)<\/u>/gi, "\\ul $1\\ul*");

    // Convert superscript and subscript
    content = content.replace(/<sup>(.*?)<\/sup>/gi, "\\sup $1\\sup*");
    content = content.replace(/<sub>(.*?)<\/sub>/gi, "\\sub $1\\sub*");

    // Convert lists
    content = content.replace(/<ul>(.*?)<\/ul>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;

        return items
            .map((item: string) => {
                return "\\li " + item.replace(/<\/?li>/gi, "").trim();
            })
            .join("\n");
    });

    // Convert ordered lists
    content = content.replace(/<ol>(.*?)<\/ol>/gis, (match, listContent) => {
        const items = listContent.match(/<li>(.*?)<\/li>/gis);
        if (!items) return match;

        return items
            .map((item: string, index: number) => {
                return `\\li${index + 1} ` + item.replace(/<\/?li>/gi, "").trim();
            })
            .join("\n");
    });

    // Remove other HTML tags
    content = content.replace(/<[^>]*>/g, "");

    // Replace HTML entities
    content = content.replace(/&nbsp;/g, " ");
    content = content.replace(/&lt;/g, "<");
    content = content.replace(/&gt;/g, ">");
    content = content.replace(/&amp;/g, "&");
    content = content.replace(/&quot;/g, '"');
    content = content.replace(/&apos;/g, "'");

    return content;
}

async function exportCodexContentAsUsfm(
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

        // Create export directory if it doesn't exist
        const exportFolder = vscode.Uri.file(userSelectedPath);
        await vscode.workspace.fs.createDirectory(exportFolder);

        // Determine if we should skip validation based on user preference or file count
        const skipValidation = options?.skipValidation || (selectedFiles.length > 5 && !DEBUG);
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

                // Process files sequentially but with optimized processing
                for (let i = 0; i < selectedFiles.length; i++) {
                    const file = selectedFiles[i];
                    progress.report({
                        message: `Processing file ${i + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    try {
                        debug(`Processing file: ${file.fsPath}`);

                        // Get the source file path - look in .project/sourceTexts/
                        const bookCode = basename(file.fsPath).split(".")[0] || "";
                        const sourceFileName = `${bookCode}.source`;
                        const sourceFile = vscode.Uri.joinPath(
                            vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                            ".project",
                            "sourceTexts",
                            sourceFileName
                        );

                        // Read both source and codex files
                        let sourceData: Uint8Array | null = null;
                        try {
                            sourceData = await vscode.workspace.fs.readFile(sourceFile);
                        } catch (error) {
                            vscode.window.showWarningMessage(
                                `Source file not found for ${bookCode} at ${sourceFile.fsPath}, skipping...`
                            );
                            skippedFiles++;
                            continue;
                        }

                        const sourceNotebook = JSON.parse(
                            Buffer.from(sourceData).toString()
                        ) as CodexNotebookAsJSONData;
                        const codexNotebook = await readCodexNotebookFromUri(file);

                        // Quick check - only look for text cells with content
                        const textCells = codexNotebook.cells.filter(
                            (cell) =>
                                (cell.kind === 2 || cell.kind === 1) && //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
                                cell.metadata?.type === CodexCellTypes.TEXT
                        );

                        // Skip empty files
                        if (textCells.length === 0) {
                            debug(`Skipping empty file: ${file.fsPath}`);
                            skippedFiles++;
                            continue;
                        }

                        // Check if any text cells have content
                        const hasContent = textCells.some((cell) => cell.value.trim().length > 0);

                        if (!hasContent) {
                            debug(`Skipping file with no text content: ${file.fsPath}`);
                            skippedFiles++;
                            continue;
                        }

                        // Process file content
                        let usfmContent = "";
                        const fullBookName = getFullBookName(bookCode);
                        let verseCount = 0;
                        let hasVerses = false;
                        let currentChapter = 0; // Track current chapter number

                        // Add USFM header in the correct order
                        // 1. ID marker must come first - include language code (default to 'en' if unknown)
                        usfmContent += `\\id ${bookCode} EN\n`;

                        // 2. Add metadata as USFM comments
                        usfmContent += `\\rem Exported from Codex Translation Editor v${extensionVersion}\n`;
                        usfmContent += `\\rem Export Date: ${exportDate}\n`;
                        usfmContent += `\\rem Source File: ${file.fsPath}\n`;

                        // 3. Add header and title markers with proper book name
                        usfmContent += `\\h ${fullBookName}\n`;
                        usfmContent += `\\toc1 ${fullBookName}\n`; // Long table of contents text
                        usfmContent += `\\toc2 ${fullBookName}\n`; // Short table of contents text
                        usfmContent += `\\toc3 ${bookCode}\n`; // Book abbreviation
                        usfmContent += `\\mt1 ${fullBookName}\n`; // Main title, level 1

                        let chapterContent = "";
                        let lastChapter = "";
                        let isFirstChapter = true;

                        // Pre-filter cells to only process relevant ones
                        const relevantCells = codexNotebook.cells.filter(
                            (cell) => {
                                const metadata = cell.metadata as any;
                                return (cell.kind === 2 || cell.kind === 1) && //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
                                    cell.metadata?.type &&
                                    cell.metadata?.type !== CodexCellTypes.MILESTONE &&
                                    cell.value.trim().length > 0 &&
                                    !metadata?.merged; // Exclude merged cells
                            }
                        );

                        totalCells += relevantCells.length;

                        // First pass: identify all chapters
                        const chapterCells: { [key: string]: number; } = {};
                        for (const cell of relevantCells) {
                            const cellMetadata = cell.metadata;
                            const cellContent = cell.value.trim();

                            if (
                                cellMetadata.type === CodexCellTypes.PARATEXT &&
                                cellContent.startsWith("<h1>")
                            ) {
                                const chapterTitle = cellContent.replace(/<\/?h1>/g, "").trim();
                                const chapterMatch = chapterTitle.match(/Chapter (\d+)/i);
                                if (chapterMatch) {
                                    const chapterNum = parseInt(chapterMatch[1], 10);
                                    chapterCells[cellMetadata.id] = chapterNum;
                                }
                            } else if (
                                cellMetadata.type === CodexCellTypes.TEXT &&
                                cellMetadata.id
                            ) {
                                // Extract chapter from verse reference (e.g., "MRK 1:1" -> "1")
                                const chapterMatch = cellMetadata.id.match(/\s(\d+):/);
                                if (chapterMatch) {
                                    const chapterNum = parseInt(chapterMatch[1], 10);
                                    if (!lastChapter || chapterNum > parseInt(lastChapter, 10)) {
                                        // This is a verse from a new chapter
                                        if (!Object.values(chapterCells).includes(chapterNum)) {
                                            // We don't have a chapter heading for this chapter
                                            chapterCells[`auto_${chapterNum}`] = chapterNum;
                                        }
                                    }
                                }
                            }
                        }

                        // Sort chapters by number
                        const sortedChapters = Object.entries(chapterCells)
                            .sort((a, b) => a[1] - b[1])
                            .map((entry) => entry[1]);

                        // Second pass: process cells with proper chapter handling
                        for (const cell of relevantCells) {
                            const cellMetadata = cell.metadata;
                            let cellContent = cell.value.trim();

                            // Convert HTML to USFM
                            cellContent = convertHtmlToUsfm(cellContent);

                            if (cellMetadata.type === CodexCellTypes.PARATEXT) {
                                // Handle chapter headings
                                if (cellContent.startsWith("Chapter ")) {
                                    const chapterMatch = cellContent.match(/Chapter (\d+)/i);
                                    if (chapterMatch) {
                                        if (lastChapter !== "") {
                                            usfmContent += chapterContent;
                                        } else if (isFirstChapter) {
                                            isFirstChapter = false;
                                        }

                                        const chapterNum = parseInt(chapterMatch[1], 10);
                                        currentChapter = chapterNum;
                                        lastChapter = chapterNum.toString();
                                        chapterContent = `\\c ${chapterNum}\n\\p\n`;
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
                                const chapterMatch = verseRef.match(/\s(\d+):/);
                                const verseMatch = verseRef.match(/\d+$/);

                                if (chapterMatch && verseMatch) {
                                    const chapterNum = parseInt(chapterMatch[1], 10);

                                    // If we're in a new chapter, add chapter marker
                                    if (chapterNum !== currentChapter) {
                                        if (chapterContent) {
                                            usfmContent += chapterContent;
                                        }

                                        currentChapter = chapterNum;
                                        lastChapter = chapterNum.toString();
                                        chapterContent = `\\c ${chapterNum}\n\\p\n`;
                                        isFirstChapter = false;
                                    }

                                    // If we haven't started a chapter yet, add chapter 1 automatically
                                    if (lastChapter === "" && isFirstChapter) {
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

                        // Add the last chapter's content
                        if (chapterContent) {
                            usfmContent += chapterContent;
                        }

                        // Clean up the USFM content to avoid "Empty lines present" warning
                        usfmContent = usfmContent.replace(/\n{2,}/g, "\n").trim() + "\n";

                        // Skip files with no verses
                        if (!hasVerses) {
                            debug(`Skipping file with no verses: ${file.fsPath}`);
                            skippedFiles++;
                            continue;
                        }

                        // Only validate if we're not skipping validation
                        if (!skipValidation) {
                            try {
                                // USFM validation can be very slow for large files
                                // This is why we offer an option to skip it
                                debug(`Performing USFM validation for ${bookCode}`);

                                // Create a USFM grammar parser instance
                                const usfmParser = new grammar.USFMParser(
                                    usfmContent,
                                    grammar.LEVEL.RELAXED
                                );

                                // Parse the USFM content
                                const parseResult = usfmParser.toJSON() as any;

                                // Check for serious validation issues
                                if (
                                    parseResult._messages &&
                                    parseResult._messages._warnings &&
                                    parseResult._messages._warnings.length > 0
                                ) {
                                    // Filter out the "Empty lines present" warning
                                    const seriousWarnings = parseResult._messages._warnings.filter(
                                        (warning: string) =>
                                            !warning.includes("Empty lines present") &&
                                            (warning.includes("Missing") ||
                                                warning.includes("Error") ||
                                                warning.includes("Invalid"))
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
                                // Continue with export despite validation error
                            }
                        }

                        // Write file
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                        const exportFileName = `${bookCode}_${timestamp}.usfm`;
                        const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);
                        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(usfmContent));

                        exportedFiles++;
                        totalVerses += verseCount;
                        debug(
                            `Export file created: ${exportFile.fsPath} with ${verseCount} verses`
                        );
                    } catch (error) {
                        console.error(`Error processing file ${file.fsPath}:`, error);
                        skippedFiles++;
                        vscode.window.showErrorMessage(
                            `Error exporting ${basename(file.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                // Show a more detailed completion message
                const skippedMessage = skippedFiles > 0 ? ` (${skippedFiles} files skipped)` : "";
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

async function exportCodexContentAsHtml(
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

                    // Read and filter active cells (exclude merged/deleted)
                    const codexData = await readCodexNotebookFromUri(file);
                    const cells = getActiveCells(codexData.cells);

                    debug(`File has ${cells.length} active cells`);

                    // Extract book code from filename (e.g., "MAT.codex" -> "MAT")
                    const bookCode = basename(file.fsPath).split(".")[0] || "";
                    const chapters: { [key: string]: string; } = {};

                    // Already filtered for merged and deleted
                    const activeCells = cells;

                    // First pass: Organize content by chapters
                    for (const cell of activeCells) {
                        totalCells++;
                        if (cell.kind === 2 || cell.kind === 1) { //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
                            // vscode.NotebookCellKind.Code
                            const cellMetadata = cell.metadata;
                            const cellContent = cell.value.trim();

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

async function exportCodexContentAsXliff(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    try {
        debug("Starting exportCodexContentAsXliff function");
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        // Get project configuration for language codes
        const projectConfig = vscode.workspace.getConfiguration("codex-project-manager");
        const sourceLanguage = projectConfig.get("sourceLanguage") as
            | { refName: string; }
            | undefined;
        const targetLanguage = projectConfig.get("targetLanguage") as
            | { refName: string; }
            | undefined;

        if (!sourceLanguage?.refName || !targetLanguage?.refName) {
            vscode.window.showErrorMessage(
                "Source and target languages must be configured before exporting to XLIFF."
            );
            return;
        }

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
                title: "Exporting Codex Content as XLIFF",
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

                    // Extract book code from filename (e.g., "MAT.codex" -> "MAT")
                    const currentBookCode = basename(file.fsPath).split(".")[0] || "";

                    // Get the source file path - look in .project/sourceTexts/
                    const sourceFileName = `${currentBookCode}.source`;
                    const sourceFile = vscode.Uri.joinPath(
                        vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                        ".project",
                        "sourceTexts",
                        sourceFileName
                    );

                    // Read both source and codex files
                    let sourceData: Uint8Array | null = null;
                    try {
                        sourceData = await vscode.workspace.fs.readFile(sourceFile);
                    } catch (error) {
                        vscode.window.showWarningMessage(
                            `Source file not found for ${currentBookCode} at ${sourceFile.fsPath}, skipping...`
                        );
                        continue;
                    }

                    const sourceNotebook = JSON.parse(
                        Buffer.from(sourceData).toString()
                    ) as CodexNotebookAsJSONData;
                    const codexNotebook = await readCodexNotebookFromUri(file);

                    debug(`File has ${codexNotebook.cells.length} cells`);

                    const chapters: {
                        [key: string]: {
                            verses: { [key: string]: { source: string; target: string; }; };
                        };
                    } = {};

                    // Create maps for quick lookup of cells by ID
                    const sourceCellsMap = new Map(
                        sourceNotebook.cells
                            .filter((cell) => {
                                const metadata = cell.metadata as any;
                                return cell.metadata?.id && !metadata?.merged;
                            })
                            .map((cell) => [cell.metadata.id, cell])
                    );

                    const codexCellsMap = new Map(
                        codexNotebook.cells
                            .filter((cell) => {
                                const metadata = cell.metadata as any;
                                return cell.metadata?.id && !metadata?.merged;
                            })
                            .map((cell) => [cell.metadata.id, cell])
                    );

                    // First pass: Organize content by chapters and verses
                    for (const [cellId, codexCell] of codexCellsMap) {
                        totalCells++;
                        if (codexCell.kind === 2 || codexCell.kind === 1) { //haven't tested this additional cell.kind === 1 but in theory it should make life easier if we have any more files that want to use markdown and not code.
                            // vscode.NotebookCellKind.Code
                            const cellMetadata = codexCell.metadata;
                            const cellContent = codexCell.value.trim();

                            if (!cellContent) continue;

                            if (cellMetadata.type === CodexCellTypes.TEXT && cellMetadata.id) {
                                // Extract chapter and verse numbers from reference (e.g., "MRK 1:1" -> "1" and "1")
                                const chapterMatch = cellMetadata.id.match(/\s(\d+):/);
                                const verseMatch = cellMetadata.id.match(/\d+$/);

                                if (chapterMatch && verseMatch) {
                                    const chapterNum = chapterMatch[1];
                                    const verseNum = verseMatch[0];

                                    if (!chapters[chapterNum]) {
                                        chapters[chapterNum] = { verses: {} };
                                    }

                                    // Get the corresponding source cell content
                                    const sourceCell = sourceCellsMap.get(cellId);
                                    let sourceContent = sourceCell?.value.trim() || "";

                                    // Use original content from metadata if available (for structure preservation)
                                    const metadata = sourceCell?.metadata as any;
                                    if (metadata?.data?.originalContent) {
                                        sourceContent = metadata.data.originalContent;
                                    }

                                    chapters[chapterNum].verses[verseNum] = {
                                        source: sourceContent,
                                        target: cellContent,
                                    };
                                    totalVerses++;
                                }
                            }
                        }
                    }

                    // Generate XLIFF content
                    const xliffContent = `<?xml version="1.0" encoding="UTF-8"?>
<xliff version="2.0" xmlns="urn:oasis:names:tc:xliff:document:2.0" srcLang="${sourceLanguage.refName}" trgLang="${targetLanguage.refName}">
    <file id="${currentBookCode}" original="${currentBookCode}.codex">
        <unit id="${currentBookCode}">
            <segment>
                <source>${currentBookCode}</source>
                <target>${currentBookCode}</target>
            </segment>
        </unit>
        ${Object.entries(chapters)
                            .map(
                                ([chapterNum, chapterData]) => `
        <unit id="${currentBookCode}_${chapterNum}">
            <segment>
                <source>Chapter ${chapterNum}</source>
                <target>Chapter ${chapterNum}</target>
            </segment>
            ${Object.entries(chapterData.verses)
                                        .map(
                                            ([verseNum, content]) => `
            <unit id="${currentBookCode}_${chapterNum}_${verseNum}">
                <segment>
                    <source>${content.source}</source>
                    <target>${content.target}</target>
                </segment>
            </unit>`
                                        )
                                        .join("")}
        </unit>`
                            )
                            .join("")}
    </file>
</xliff>`;

                    // Write XLIFF file
                    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                    const exportFileName = `${currentBookCode}_${timestamp}.xliff`;
                    const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);
                    await vscode.workspace.fs.writeFile(exportFile, Buffer.from(xliffContent));
                    debug(`XLIFF file created: ${exportFile.fsPath}`);
                }

                vscode.window.showInformationMessage(
                    `XLIFF Export completed: ${totalVerses} verses from ${selectedFiles.length} files exported to ${userSelectedPath}`
                );
            }
        );
    } catch (error) {
        console.error("XLIFF Export failed:", error);
        vscode.window.showErrorMessage(`XLIFF Export failed: ${error}`);
    }
}

/**
 * Escapes a string for CSV format
 * @param value The string to escape
 * @returns The escaped string
 */
function escapeCsvValue(value: string): string {
    if (!value) return '""';

    // Remove HTML tags
    const cleanValue = value.replace(/<[^>]*>/g, '');

    // If the value contains quotes, commas, or newlines, wrap in quotes and escape internal quotes
    if (cleanValue.includes('"') || cleanValue.includes(',') || cleanValue.includes('\n') || cleanValue.includes('\r')) {
        return '"' + cleanValue.replace(/"/g, '""') + '"';
    }

    return cleanValue;
}

/**
 * Escapes a string for TSV format
 * @param value The string to escape
 * @returns The escaped string
 */
function escapeTsvValue(value: string): string {
    if (!value) return '';

    // Remove HTML tags
    const cleanValue = value.replace(/<[^>]*>/g, '');

    // Replace tabs, newlines, and carriage returns with spaces
    return cleanValue.replace(/[\t\n\r]/g, ' ');
}

/**
 * Formats a timestamp value appropriately
 * @param fieldName The name of the field being formatted
 * @param value The value to format
 * @returns The formatted timestamp or original value
 */
function formatTimestampField(fieldName: string, value: any): string {
    if (value === undefined || value === null || value === '') {
        return '';
    }

    // Convert to string for processing
    const stringValue = String(value);

    // If it's already a formatted timestamp (contains --> or :), leave it as-is
    if (stringValue.includes('-->') || stringValue.includes(':')) {
        return stringValue;
    }

    // Check if field name suggests it's a timestamp and value is numeric
    const isTimestampField = /^(start|end|begin|stop|duration)Time$/i.test(fieldName) ||
        /time$/i.test(fieldName) ||
        /^(start|end|begin|stop)$/i.test(fieldName);

    if (isTimestampField && !isNaN(parseFloat(stringValue))) {
        const seconds = parseFloat(stringValue);

        // If it looks like milliseconds (very large number), convert to seconds
        const actualSeconds = seconds > 10000 ? seconds / 1000 : seconds;

        // Format as HH:MM:SS.mmm
        const hours = Math.floor(actualSeconds / 3600);
        const minutes = Math.floor((actualSeconds % 3600) / 60);
        const secs = actualSeconds % 60;

        // Format with leading zeros
        const hoursStr = hours.toString().padStart(2, '0');
        const minutesStr = minutes.toString().padStart(2, '0');
        const secsStr = secs.toFixed(3).padStart(6, '0');

        return `${hoursStr}:${minutesStr}:${secsStr}`;
    }

    // Return original value if not a timestamp field
    return stringValue;
}

async function exportCodexContentAsCsv(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    await exportCodexContentAsDelimited(userSelectedPath, filesToExport, 'csv', options);
}

async function exportCodexContentAsTsv(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    await exportCodexContentAsDelimited(userSelectedPath, filesToExport, 'tsv', options);
}

async function exportCodexContentAsDelimited(
    userSelectedPath: string,
    filesToExport: string[],
    format: 'csv' | 'tsv',
    options?: ExportOptions
) {
    try {
        const formatName = format.toUpperCase();
        debug(`Starting exportCodexContentAs${formatName} function`);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        // Filter codex files based on user selection
        const selectedFiles = filesToExport.map((path) => vscode.Uri.file(path));
        debug(`Selected files for export: ${selectedFiles.length}`);
        if (selectedFiles.length === 0) {
            vscode.window.showInformationMessage("No files selected for export.");
            return;
        }

        const delimiter = format === 'csv' ? ',' : '\t';
        const escapeFunction = format === 'csv' ? escapeCsvValue : escapeTsvValue;
        const fileExtension = format === 'csv' ? 'csv' : 'tsv';

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: `Exporting Codex Content as ${formatName}`,
                cancellable: false,
            },
            async (progress) => {
                let totalCells = 0;
                let totalVerses = 0;
                let skippedFiles = 0;
                let exportedFiles = 0;
                const increment = 100 / selectedFiles.length;

                // Create export directory if it doesn't exist
                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                for (const [index, file] of selectedFiles.entries()) {
                    progress.report({
                        message: `Processing file ${index + 1}/${selectedFiles.length}`,
                        increment,
                    });

                    try {
                        debug(`Processing file: ${file.fsPath}`);

                        // Extract book code from filename (e.g., "MAT.codex" -> "MAT")
                        const currentBookCode = basename(file.fsPath).split(".")[0] || "";

                        // Get the source file path - look in .project/sourceTexts/
                        const sourceFileName = `${currentBookCode}.source`;
                        const sourceFile = vscode.Uri.joinPath(
                            vscode.Uri.file(workspaceFolders[0].uri.fsPath),
                            ".project",
                            "sourceTexts",
                            sourceFileName
                        );

                        // Read both source and codex files
                        let sourceData: Uint8Array | null = null;
                        try {
                            sourceData = await vscode.workspace.fs.readFile(sourceFile);
                        } catch (error) {
                            vscode.window.showWarningMessage(
                                `Source file not found for ${currentBookCode} at ${sourceFile.fsPath}, skipping...`
                            );
                            skippedFiles++;
                            continue;
                        }

                        const codexData = await vscode.workspace.fs.readFile(file);

                        const sourceNotebook = JSON.parse(
                            Buffer.from(sourceData).toString()
                        ) as CodexNotebookAsJSONData;
                        const codexNotebook = JSON.parse(
                            Buffer.from(codexData).toString()
                        ) as CodexNotebookAsJSONData;

                        debug(`File has ${codexNotebook.cells.length} cells`);

                        // Create maps for quick lookup of cells by ID
                        const sourceCellsMap = new Map(
                            sourceNotebook.cells
                                .filter((cell) => {
                                    const metadata = cell.metadata;
                                    return (cell.kind === 2 || cell.kind === 1) &&
                                        cell.metadata?.id &&
                                        cell.metadata?.type === CodexCellTypes.TEXT &&
                                        !metadata?.data?.merged;
                                })
                                .map((cell) => [cell.metadata.id, cell])
                        );

                        const codexCellsMap = new Map(
                            codexNotebook.cells
                                .filter((cell) => {
                                    const metadata = cell.metadata;
                                    return (cell.kind === 2 || cell.kind === 1) &&
                                        cell.metadata?.id &&
                                        cell.metadata?.type === CodexCellTypes.TEXT &&
                                        !metadata?.data?.merged;
                                })
                                .map((cell) => [cell.metadata.id, cell])
                        );

                        // First pass: collect all possible metadata fields (excluding edits)
                        const allMetadataFields = new Set<string>();
                        for (const [cellId, codexCell] of codexCellsMap) {
                            const cellMetadata = codexCell.metadata as { type: string; id: string; data?: any; };
                            if (cellMetadata.data && typeof cellMetadata.data === 'object') {
                                Object.keys(cellMetadata.data).forEach(field => {
                                    if (field !== 'edits') {
                                        allMetadataFields.add(field);
                                    }
                                });
                            }
                        }

                        // Sort metadata fields for consistent column order
                        const sortedMetadataFields = Array.from(allMetadataFields).sort();

                        // Collect all verse data with metadata, preserving original cell order
                        const verseData: Array<{
                            id: string;
                            source: string;
                            target: string;
                            metadata: { [key: string]: any; };
                        }> = [];

                        // Process cells in their original order from the notebook
                        for (const codexCell of codexNotebook.cells) {
                            if (codexCell.kind === 2 || codexCell.kind === 1) { // vscode.NotebookCellKind.Code
                                const cellMetadata = codexCell.metadata as { type: string; id: string; data?: any; };

                                if (cellMetadata.type === CodexCellTypes.TEXT &&
                                    cellMetadata.id &&
                                    !cellMetadata?.data?.merged) {
                                    totalCells++;
                                    const sourceCell = sourceCellsMap.get(cellMetadata.id);

                                    // Include the verse even if source is missing (will be empty)
                                    const sourceContent = sourceCell?.value || "";
                                    const targetContent = codexCell.value || "";

                                    // Extract metadata (excluding edits)
                                    const metadata: { [key: string]: any; } = {};
                                    if (cellMetadata.data && typeof cellMetadata.data === 'object') {
                                        for (const field of sortedMetadataFields) {
                                            metadata[field] = cellMetadata.data[field] || "";
                                        }
                                    }

                                    verseData.push({
                                        id: cellMetadata.id,
                                        source: sourceContent,
                                        target: targetContent,
                                        metadata: metadata
                                    });

                                    totalVerses++;
                                }
                            }
                        }

                        // Skip empty files
                        if (verseData.length === 0) {
                            debug(`Skipping file with no verses: ${file.fsPath}`);
                            skippedFiles++;
                            continue;
                        }

                        // Data is already in correct order from original notebook

                        // Generate delimited content with metadata columns
                        const metadataHeaders = sortedMetadataFields.map(field => field).join(delimiter);
                        const headerRow = metadataHeaders
                            ? `ID${delimiter}Source${delimiter}Target${delimiter}${metadataHeaders}\n`
                            : `ID${delimiter}Source${delimiter}Target\n`;
                        let content = headerRow;

                        for (const verse of verseData) {
                            const escapedId = escapeFunction(verse.id);
                            const escapedSource = escapeFunction(verse.source);
                            const escapedTarget = escapeFunction(verse.target);

                            // Add metadata values with proper timestamp formatting
                            const metadataValues = sortedMetadataFields.map(field => {
                                const value = verse.metadata[field];
                                const formattedValue = formatTimestampField(field, value);
                                return escapeFunction(formattedValue);
                            }).join(delimiter);

                            const row = metadataValues
                                ? `${escapedId}${delimiter}${escapedSource}${delimiter}${escapedTarget}${delimiter}${metadataValues}\n`
                                : `${escapedId}${delimiter}${escapedSource}${delimiter}${escapedTarget}\n`;

                            content += row;
                        }

                        // Write file
                        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                        const exportFileName = `${currentBookCode}_${timestamp}.${fileExtension}`;
                        const exportFile = vscode.Uri.joinPath(exportFolder, exportFileName);
                        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(content));

                        exportedFiles++;
                        debug(`${formatName} file created: ${exportFile.fsPath} with ${verseData.length} verses`);
                    } catch (error) {
                        console.error(`Error processing file ${file.fsPath}:`, error);
                        skippedFiles++;
                        vscode.window.showErrorMessage(
                            `Error exporting ${basename(file.fsPath)}: ${error instanceof Error ? error.message : String(error)}`
                        );
                    }
                }

                // Show completion message
                const skippedMessage = skippedFiles > 0 ? ` (${skippedFiles} files skipped)` : "";
                vscode.window.showInformationMessage(
                    `${formatName} Export completed: ${totalVerses} verses from ${exportedFiles} files exported to ${userSelectedPath}${skippedMessage}`
                );
            }
        );
    } catch (error) {
        console.error(`${format.toUpperCase()} Export failed:`, error);
        vscode.window.showErrorMessage(`${format.toUpperCase()} Export failed: ${error}`);
    }
}

async function exportCodexContentAsBacktranslations(
    userSelectedPath: string,
    filesToExport: string[],
    options?: ExportOptions
) {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage("No workspace folder found.");
            return;
        }

        const backtranslationsPath = path.join(workspaceFolders[0].uri.fsPath, "files", "backtranslations.json");
        let backtranslationsData: { [cellId: string]: any; } = {};
        try {
            const backtranslationsUri = vscode.Uri.file(backtranslationsPath);
            const backtranslationsContent = await vscode.workspace.fs.readFile(backtranslationsUri);
            backtranslationsData = JSON.parse(Buffer.from(backtranslationsContent).toString());
        } catch (error) {
            vscode.window.showWarningMessage("No backtranslations found.");
            return;
        }

        if (Object.keys(backtranslationsData).length === 0) {
            vscode.window.showInformationMessage("No backtranslations to export.");
            return;
        }

        return vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: "Exporting Backtranslations",
                cancellable: false,
            },
            async (progress) => {
                progress.report({ message: "Loading backtranslations..." });

                const exportFolder = vscode.Uri.file(userSelectedPath);
                await vscode.workspace.fs.createDirectory(exportFolder);

                const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
                const fileGroups = new Map<string, Array<{ cellId: string; bt: any; }>>();
                let skipped = 0;

                for (const [cellId, bt] of Object.entries(backtranslationsData)) {
                    if (!bt.filePath) {
                        skipped++;
                        continue;
                    }

                    const filePath = path.isAbsolute(bt.filePath)
                        ? bt.filePath
                        : path.join(workspaceFolders[0].uri.fsPath, bt.filePath);
                    if (!fileGroups.has(filePath)) {
                        fileGroups.set(filePath, []);
                    }
                    fileGroups.get(filePath)!.push({ cellId, bt });
                }

                let totalExported = 0;
                let filesWritten = 0;

                for (const [targetPath, entries] of fileGroups) {
                    try {
                        const targetUri = vscode.Uri.file(targetPath);
                        const sourcePath = targetPath.replace(/\.codex$/, ".source");
                        const sourceUri = vscode.Uri.file(sourcePath);

                        const targetData = await vscode.workspace.fs.readFile(targetUri);
                        const targetNotebook = JSON.parse(Buffer.from(targetData).toString()) as CodexNotebookAsJSONData;

                        let sourceNotebook: CodexNotebookAsJSONData | null = null;
                        try {
                            const sourceData = await vscode.workspace.fs.readFile(sourceUri);
                            sourceNotebook = JSON.parse(Buffer.from(sourceData).toString()) as CodexNotebookAsJSONData;
                        } catch (error) {
                            void error;
                        }

                        const targetCellsMap = new Map(
                            targetNotebook.cells
                                .filter((cell) => (cell.kind === 2 || cell.kind === 1) && (cell as any).metadata?.id)
                                .map((cell) => [cell.metadata.id, (cell as any).value || ""])
                        );

                        const sourceCellsMap = new Map(
                            targetNotebook.cells
                                .filter((cell) => (cell.kind === 2 || cell.kind === 1) && (cell as any).metadata?.id)
                                .map((cell) => [cell.metadata.id, (cell.metadata as any)?.data?.originalText || ""])
                        );

                        let content = "Cell ID,Source Text,Translation,Backtranslation\n";
                        for (const { cellId, bt } of entries) {
                            const source = sourceCellsMap.get(cellId) || "";
                            const target = targetCellsMap.get(cellId) || "";
                            const backText = (bt && (bt.backtranslation || bt)) || "";
                            content += `${escapeCsvValue(cellId)},${escapeCsvValue(source)},${escapeCsvValue(target)},${escapeCsvValue(backText)}\n`;
                            totalExported++;
                        }

                        const fileName = basename(targetPath, ".codex");
                        const exportFile = vscode.Uri.joinPath(exportFolder, `${fileName}_backtranslations_${timestamp}.csv`);
                        await vscode.workspace.fs.writeFile(exportFile, Buffer.from(content));
                        filesWritten++;
                    } catch (error) {
                        console.error(`Error exporting backtranslations for ${targetPath}:`, error);
                    }
                }

                const skipMessage = skipped > 0 ? ` (${skipped} skipped - no file path stored)` : "";
                vscode.window.showInformationMessage(`Exported ${totalExported} backtranslations to ${filesWritten} file(s)${skipMessage}`);
            }
        );
    } catch (error) {
        console.error("Backtranslations export failed:", error);
        vscode.window.showErrorMessage(`Backtranslations export failed: ${error}`);
    }
}

// TODO: Add an html export - one file per chapter.. perhaps a default css file if needed. last part of id as superscript. Only show ids on TEXT rather than PARATEXT cells.
