import * as vscode from "vscode";
import * as fs from "fs";
import { CodexContentSerializer } from "../serializer";
import { getProjectMetadata, getWorkSpaceFolder } from ".";
import { generateFiles as generateFile } from "./fileUtils";
import { getAllBookRefs, getAllBookChapterRefs, getAllVrefs } from ".";
import { vrefData } from "./verseRefUtils/verseData";
import { LanguageProjectStatus } from "codex-types";
import { extractVerseRefFromLine, verseRefRegex } from "./verseRefUtils";
import grammar from "usfm-grammar";
import { ParsedUSFM } from "../../types/usfm-grammar";

export const NOTEBOOK_TYPE = "codex-type";

/**
 * Interface representing a Codex cell with optional metadata.
 *
 * This interface extends the vscode.NotebookCellData with additional metadata that
 * specifies the type of cell and associated data. The metadata includes the type of the cell,
 * which is defined by the CellTypes enum, and data that contains the chapter information.
 *
 * @property {CellTypes} [type] - The type of the cell, as defined by the CellTypes enum.
 * @property {Object} [data] - An object containing additional data for the cell.
 * @property {string} [chapter] - The chapter number or identifier associated with the cell.
 */
export interface CodexCell extends vscode.NotebookCellData {
    metadata?: {
        type: "text" | "paratext";
        id: string;
        data: {
            [key: string]: any | undefined;
        };
    };
}

interface deprecated_CodexCell extends vscode.NotebookCellData {
    metadata?: {
        type: any;
        data: {
            chapter: string;
        };
    };
}

export const createCodexNotebook = async (cells: vscode.NotebookCellData[] = []) => {
    /**
     * Creates a Codex notebook with the provided cell data.
     *
     * This function takes an array of NotebookCellData objects and uses them to create a new Codex notebook.
     * If no cells are provided, an empty array is used by default. Each cell in the array is transformed into
     * a NotebookCellData object, which is then used to create the notebook data. A new notebook document is
     * opened with this data in the Codex-specific notebook type.
     *
     * @param {vscode.NotebookCellData[]} cells - An array of NotebookCellData objects to populate the notebook.
     * @returns {Promise<vscode.NotebookDocument>} A promise that resolves to the created NotebookDocument.
     */
    const cellData =
        cells.length > 0
            ? cells.map(
                  (cell) => new vscode.NotebookCellData(cell.kind, cell.value, cell.languageId)
              )
            : [];
    const data = new vscode.NotebookData(cellData);
    const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
    return doc;
};

export interface NotebookMetadata {
    data: {
        corpusMarker?: string;
        [key: string]: any | undefined;
    };
    navigation: NavigationCell[];
}

export interface NavigationCell {
    cellId: string;
    children: NavigationCell[];
    label: string;
}

/**
 * Creates a Codex notebook for each book in the Bible.
 *
 * This function generates a Codex notebook for each book in the Bible. If a list of books is provided,
 * notebooks will only be created for those books. Otherwise, notebooks will be created for all books.
 * Each notebook contains a code cell for each chapter in the book. Each chapter cell is preceded by a
 * markdown cell with the chapter number and followed by a markdown cell for notes for the chapter.
 *
 * @param {Object} options - An object containing options for the notebook creation.
 * @param {boolean} options.shouldOverWrite - A boolean indicating whether existing notebooks should be overwritten.
 * @param {string[]} options.books - An array of book names for which to create notebooks. If not provided, notebooks will be created for all books.
 * @returns {Promise<void>} A promise that resolves when all notebooks have been created.
 */
export async function updateProjectNotebooksToUseCellsForVerseContent({
    shouldOverWrite = true,
    books = undefined,
}: {
    shouldOverWrite?: boolean;
    books?: string[] | undefined;
} = {}) {
    const notebookCreationPromises = [];

    const allBooks = books ? books : getAllBookRefs();
    // Loop over all books and createCodexNotebook for each
    for (const book of allBooks) {
        try {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            const file = await vscode.workspace.fs.readFile(
                vscode.Uri.file(`${workspaceRoot}/files/target/${book}.codex`)
            );

            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                file,
                new vscode.CancellationTokenSource().token
            );

            const newCells: vscode.NotebookCellData[] = [];
            const chapterHeadingText = `Chapter`;

            const canonicalOrder = Object.keys(vrefData);
            const corpora = {
                "Old Testament": canonicalOrder.slice(0, 39),
                "New Testament": canonicalOrder.slice(39),
            };

            let corpusMarker;
            if (corpora["Old Testament"].includes(book)) {
                corpusMarker = "Old Testament";
            } else if (corpora["New Testament"].includes(book)) {
                corpusMarker = "New Testament";
            } else {
                corpusMarker = "Other";
            }

            const navigationCells: NavigationCell[] = [];

            for (const cell of notebookData.cells) {
                if (cell.kind === vscode.NotebookCellKind.Markup) {
                    if (cell.metadata?.type === "chapter-heading") {
                        // This is a chapter heading cell
                        const chapter = cell.metadata.data?.chapter;
                        if (chapter && book) {
                            const h1Content = `${chapterHeadingText} ${chapter}`;
                            const newCell = new vscode.NotebookCellData(
                                vscode.NotebookCellKind.Code,
                                `<h1>${h1Content}</h1>`,
                                "paratext"
                            );
                            const randomId = Math.random().toString(36).substring(2, 15);
                            const cellId = `${book} ${chapter}:1:${randomId}`;
                            newCell.metadata = {
                                type: "paratext",
                                id: cellId,
                            };
                            navigationCells.push({
                                cellId: cellId,
                                children: [],
                                label: `${chapterHeadingText} ${chapter}`,
                            });
                            newCells.push(newCell);
                        } else {
                            console.warn(
                                `Skipping chapter heading cell for ${book} ${chapter} because it is apparently malformed:`,
                                cell
                            );
                        }
                    } else if (cell.value.includes("Notes")) {
                        // This is a notes cell - we don't need to do anything with it
                        // newCells.push(cell);
                    }
                } else if (
                    cell.kind === vscode.NotebookCellKind.Code &&
                    cell.languageId === "scripture"
                ) {
                    // This is a cell containing all verses for a chapter
                    const lines = cell.value.split("\n");
                    for (const line of lines) {
                        const verseRef = extractVerseRefFromLine(line);
                        const content = line.replace(verseRefRegex, "");
                        const verseCell = new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            content,
                            "scripture"
                        );
                        if (!verseRef) {
                            console.warn(
                                `Skipping verse cell for ${book} because it is apparently malformed:`,
                                cell
                            );
                            continue;
                        }
                        verseCell.metadata = {
                            type: "text",
                            id: verseRef,
                            data: {},
                        };
                        newCells.push(verseCell as CodexCell);
                    }
                }
            }

            const updatedNotebookData = new vscode.NotebookData(newCells);

            const notebookMetadata = {
                data: {
                    corpusMarker: corpusMarker,
                },
                navigation: navigationCells,
            };

            updatedNotebookData.metadata = notebookMetadata;
            const notebookCreationPromise = serializer
                .serializeNotebook(updatedNotebookData, new vscode.CancellationTokenSource().token)
                .then((notebookFile) => {
                    const filePath = `files/target/${book}.codex`;
                    return generateFile({
                        filepath: filePath,
                        fileContent: notebookFile,
                        shouldOverWrite,
                    });
                });
            notebookCreationPromises.push(notebookCreationPromise);
        } catch (e) {
            vscode.window.showErrorMessage(
                `Error encountered while migrating notebook for book ${book}. Please inspect this file and open it with the text editor to see if it is malformed. Error: ${e}`
            );
        }
    }
    await Promise.all(notebookCreationPromises);
}

export async function createProjectCommentFiles({
    shouldOverWrite = false,
}: {
    shouldOverWrite?: boolean;
} = {}) {
    // Save the notebook using generateFiles
    const commentsFilePath = `comments.json`;
    const notebookCommentsFilePath = `file-comments.json`;
    await generateFile({
        filepath: commentsFilePath,
        fileContent: new TextEncoder().encode("[]"),
        shouldOverWrite,
    });
    await generateFile({
        filepath: notebookCommentsFilePath,
        fileContent: new TextEncoder().encode("[]"),
        shouldOverWrite,
    });
}

export async function importLocalUsfmSourceBible() {
    const folderUri = await vscode.window.showOpenDialog({
        canSelectFiles: false,
        canSelectFolders: true,
        canSelectMany: false,
        openLabel: "Select USFM Folder",
    });

    if (!folderUri || folderUri.length === 0) {
        vscode.window.showInformationMessage("No folder selected");
        return;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        vscode.window.showErrorMessage("No workspace folder found");
        return;
    }

    const usfmFiles = await vscode.workspace.fs.readDirectory(folderUri[0]);
    const bibleContent: string[] = [];

    console.log(`Found ${usfmFiles.length} files in the selected folder`);

    const usfmFileExtensions = [".usfm", ".sfm", ".SFM", ".USFM"];
    for (const [fileName, fileType] of usfmFiles) {
        if (
            fileType === vscode.FileType.File &&
            usfmFileExtensions.some((ext) => fileName.toLowerCase().endsWith(ext))
        ) {
            console.log(`Processing file: ${fileName}`);
            const fileUri = vscode.Uri.joinPath(folderUri[0], fileName);
            const fileContent = await vscode.workspace.fs.readFile(fileUri);
            console.log(`File content length: ${fileContent.byteLength} bytes`);

            try {
                const relaxedUsfmParser = new grammar.USFMParser(
                    new TextDecoder().decode(fileContent),
                    grammar.LEVEL.RELAXED
                );
                const jsonOutput = relaxedUsfmParser.toJSON() as any as ParsedUSFM;
                console.log(
                    `Parsed JSON output for ${fileName}:`,
                    JSON.stringify(jsonOutput, null, 2)
                );

                // Convert JSON output to .bible format
                const bookCode = jsonOutput.book.bookCode;
                const verses = jsonOutput.chapters.flatMap((chapter: any) =>
                    chapter.contents
                        .filter(
                            (content: any) =>
                                content.verseNumber !== undefined || content.verseText !== undefined
                        )
                        .map(
                            (verse: any) =>
                                `${bookCode} ${chapter.chapterNumber}:${verse.verseNumber} ${verse.verseText || verse.text}`
                        )
                );

                console.log(`Extracted ${verses.length} verses from ${fileName}`);
                bibleContent.push(...verses);
            } catch (error) {
                console.error(`Error processing file ${fileName}:`, error);
                vscode.window.showErrorMessage(
                    `Error processing file ${fileName}: ${error instanceof Error ? error.message : String(error)}`
                );
            }
        }
    }

    console.log(`Total verses extracted: ${bibleContent.length}`);

    const bibleFileName = await vscode.window.showInputBox({
        prompt: "Enter a name for the Bible file",
        placeHolder: "e.g., MyBible",
    });

    if (!bibleFileName) {
        vscode.window.showInformationMessage("Bible import cancelled");
        return;
    }
    // Fix: Use the workspace folder directly to create the target path
    const targetFolderPath = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".project",
        "sourceTextBibles"
    );
    const bibleFilePath = vscode.Uri.joinPath(targetFolderPath, `${bibleFileName}.bible`);

    // Ensure the target folder exists
    try {
        await vscode.workspace.fs.createDirectory(targetFolderPath);
    } catch (error) {
        console.error(
            `Error creating directory: ${error instanceof Error ? error.message : String(error)}`
        );
        vscode.window.showErrorMessage(
            `Failed to create directory: ${targetFolderPath.toString()}`
        );
        return;
    }

    const bibleData: any = {
        cells: [],
        metadata: {
            data: {
                corpusMarker: undefined, // We'll set this later
            },
            navigation: [],
        },
    };

    let currentBook = "";
    let currentChapter = "";
    let chapterCellId = "";
    let testament: "OT" | "NT" | undefined;

    for (const verse of bibleContent) {
        const [bookCode, chapterVerse, ...textParts] = verse.split(" ");
        const [chapter, verseNumber] = chapterVerse.split(":");
        const text = textParts.join(" ");

        if (!testament && vrefData[bookCode]) {
            testament = vrefData[bookCode].testament as "OT" | "NT";
        }

        if (bookCode !== currentBook || chapter !== currentChapter) {
            currentBook = bookCode;
            currentChapter = chapter;
            chapterCellId = `${bookCode} ${chapter}:1:${Math.random().toString(36).substr(2, 11)}`;
            bibleData.cells.push({
                kind: 2,
                language: "paratext",
                value: `<h1>${bookCode} Chapter ${chapter}</h1>`,
                metadata: {
                    type: "paratext",
                    id: chapterCellId,
                },
            });
            bibleData.metadata.navigation.push({
                cellId: chapterCellId,
                children: [],
                label: `${bookCode} Chapter ${chapter}`,
            });
        }

        bibleData.cells.push({
            kind: 2,
            language: "scripture",
            value: text,
            metadata: {
                type: "text",
                id: `${bookCode} ${chapter}:${verseNumber}`,
                data: {},
            },
        });
    }

    // Set the corpusMarker based on the testament
    bibleData.metadata.data.corpusMarker =
        testament === "OT" ? "Old Testament" : testament === "NT" ? "New Testament" : undefined;

    try {
        vscode.workspace.fs.writeFile(
            bibleFilePath,
            Buffer.from(JSON.stringify(bibleData, null, 2), "utf-8")
        );
        vscode.window.showInformationMessage(
            `Bible imported successfully: ${bibleFilePath.toString()}`
        );
    } catch (error) {
        console.error(
            `Error generating file: ${error instanceof Error ? error.message : String(error)}`
        );
        vscode.window.showErrorMessage(`Failed to create Bible file: ${bibleFilePath.toString()}`);
    }
}

/**
 * Creates a Codex notebook for each book in the Bible.
 *
 * This function generates a Codex notebook for each book in the Bible. If a list of books is provided,
 * notebooks will only be created for those books. Otherwise, notebooks will be created for all books.
 * Each notebook contains a code cell for each chapter in the book. Each chapter cell is preceded by a
 * markdown cell with the chapter number and followed by a markdown cell for notes for the chapter.
 *
 * @param {Object} options - An object containing options for the notebook creation.
 * @param {boolean} options.shouldOverWrite - A boolean indicating whether existing notebooks should be overwritten.
 * @param {string[]} options.books - An array of book names for which to create notebooks. If not provided, notebooks will be created for all books.
 * @param {vscode.Uri[]} options.foldersWithUsfmToConvert - An array of URIs for folders containing USFM files to convert to notebooks.
 * @returns {Promise<void>} A promise that resolves when all notebooks have been created.
 */
const importProjectAndConvertToJson = async (
    folderWithUsfmToConvert: vscode.Uri[]
): Promise<ParsedUSFM[]> => {
    const projectFileContent: ParsedUSFM[] = [];
    const directoryPath = folderWithUsfmToConvert[0].fsPath;

    try {
        const files = await vscode.workspace.fs.readDirectory(folderWithUsfmToConvert[0]);

        for (const [file] of files) {
            if (
                file.endsWith(".SFM") ||
                file.endsWith(".sfm") ||
                file.endsWith(".USFM") ||
                file.endsWith(".usfm")
            ) {
                const fileUri = vscode.Uri.joinPath(folderWithUsfmToConvert[0], file);
                const contents = await vscode.workspace.fs.readFile(fileUri);
                let fileName = "";
                try {
                    const myUsfmParser = new grammar.USFMParser(
                        new TextDecoder("utf-8").decode(contents),
                        grammar.LEVEL.RELAXED
                    );

                    fileName = file.replace(/\.[^/.]+$/, "") + ".json";
                    const jsonOutput = myUsfmParser.toJSON() as any as ParsedUSFM;
                    projectFileContent.push(jsonOutput);
                } catch (error) {
                    vscode.window.showErrorMessage(
                        `Error generating files for ${fileName}: ${error}`
                    );
                }
            }
        }
    } catch (error) {
        vscode.window.showErrorMessage(
            `Error reading directory: ${error instanceof Error ? error.message : String(error)}`
        );
        // Optionally, you can log the error or handle it in any other way you see fit
        console.error("Error reading directory:", error);
    }
    return projectFileContent;
};

export async function createProjectNotebooks({
    shouldOverWrite = false,
    books = undefined,
    foldersWithUsfmToConvert = undefined,
}: {
    shouldOverWrite?: boolean;
    books?: string[] | undefined;
    foldersWithUsfmToConvert?: vscode.Uri[] | undefined;
} = {}) {
    const notebookCreationPromises = [];
    let projectFileContent: ParsedUSFM[] | undefined = undefined;
    if (foldersWithUsfmToConvert) {
        projectFileContent = await importProjectAndConvertToJson(foldersWithUsfmToConvert);
    }

    const allBooks = books ? books : getAllBookRefs();
    const chapterHeadingText = `Chapter`;

    for (const book of allBooks) {
        try {
            const newCells: vscode.NotebookCellData[] = [];
            const navigationCells: NavigationCell[] = [];

            const canonicalOrder = Object.keys(vrefData);
            const corpora = {
                "Old Testament": canonicalOrder.slice(0, 39),
                "New Testament": canonicalOrder.slice(39),
            };

            let corpusMarker;
            if (corpora["Old Testament"].includes(book)) {
                corpusMarker = "Old Testament";
            } else if (corpora["New Testament"].includes(book)) {
                corpusMarker = "New Testament";
            } else {
                corpusMarker = "Other";
            }

            const importedBook = projectFileContent?.find(
                (projectFile) => projectFile?.book?.bookCode === book
            );

            for (const chapter of getAllBookChapterRefs(book)) {
                const h1Content = `${chapterHeadingText} ${chapter}`;
                const newCell = new vscode.NotebookCellData(
                    vscode.NotebookCellKind.Code,
                    `<h1>${h1Content}</h1>`,
                    "paratext"
                );
                const randomId = Math.random().toString(36).substring(2, 15);
                const cellId = `${book} ${chapter}:1:${randomId}`;
                newCell.metadata = {
                    type: "paratext",
                    id: cellId,
                };
                navigationCells.push({
                    cellId: cellId,
                    children: [],
                    label: `${chapterHeadingText} ${chapter}`,
                });
                newCells.push(newCell);

                const numberOfVrefsForChapter = vrefData[book].chapterVerseCountPairings[chapter];
                const verses = getAllVrefs(book, chapter, numberOfVrefsForChapter);

                for (const verse of verses.split("\n")) {
                    const verseCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Code,
                        "",
                        "scripture"
                    );
                    verseCell.metadata = {
                        type: "text",
                        id: verse,
                        data: {},
                    };
                    newCells.push(verseCell);
                }
            }

            const updatedNotebookData = new vscode.NotebookData(newCells);

            const notebookMetadata = {
                data: {
                    corpusMarker: corpusMarker,
                },
                navigation: navigationCells,
            };

            updatedNotebookData.metadata = notebookMetadata;

            const serializer = new CodexContentSerializer();
            const notebookCreationPromise = serializer
                .serializeNotebook(updatedNotebookData, new vscode.CancellationTokenSource().token)
                .then((notebookFile) => {
                    const filePath = `files/target/${book}.codex`;
                    return generateFile({
                        filepath: filePath,
                        fileContent: notebookFile,
                        shouldOverWrite,
                    });
                });
            notebookCreationPromises.push(notebookCreationPromise);
        } catch (e) {
            vscode.window.showErrorMessage(
                `Error encountered while creating notebook for book ${book}. Error: ${e}`
            );
        }
    }
    await Promise.all(notebookCreationPromises);
}
