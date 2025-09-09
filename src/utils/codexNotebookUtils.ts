import * as vscode from "vscode";
import { CodexContentSerializer } from "../serializer";
import { getProjectMetadata, getWorkSpaceFolder } from ".";
import { generateFiles as generateFile } from "./fileUtils";
import { getAllBookRefs, getAllBookChapterRefs, getAllVrefs } from ".";
import { vrefData } from "./verseRefUtils/verseData";
import { extractVerseRefFromLine, verseRefRegex } from "./verseRefUtils";
import { getTestamentForBook } from "./verseRefUtils/verseData";
import grammar, { ParsedUSFM } from "usfm-grammar";
import { WebVTTParser } from "webvtt-parser";
import {
    CodexNotebookAsJSONData,
    CustomCellMetaData,
    CustomNotebookCellData,
    CustomNotebookMetadata,
} from "../../types";
import { CodexCellTypes } from "../../types/enums";
import { NotebookMetadataManager, getNotebookMetadataManager } from "./notebookMetadataManager";
import { getWorkSpaceUri } from "./index";
import { basename } from "path";

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
    metadata?: CustomCellMetaData;
}

interface deprecated_CodexCell extends vscode.NotebookCellData {
    metadata?: {
        type: any;
        data: {
            chapter: string;
        };
        cellLabel?: string;
    };
}

export const createCodexNotebook = async (
    cells: CodexCell[] = []
): Promise<vscode.NotebookDocument> => {
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
                (cell) => new vscode.NotebookCellData(cell.kind, cell.value, "html") as CodexCell
            )
            : [];
    const data = new vscode.NotebookData(cellData);
    const doc = await vscode.workspace.openNotebookDocument(NOTEBOOK_TYPE, data);
    return doc;
};

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
    const workspaceFolder = getWorkSpaceFolder();

    if (!workspaceFolder) {
        return;
    }
    const workspaceRoot = workspaceFolder;
    for (const book of allBooks) {
        try {
            let file;
            try {
                file = await vscode.workspace.fs.readFile(
                    vscode.Uri.joinPath(
                        vscode.Uri.file(workspaceRoot),
                        "files",
                        "target",
                        `${book}.codex`
                    )
                );
            } catch (error) {
                continue;
            }

            const serializer = new CodexContentSerializer();
            const notebookData = await serializer.deserializeNotebook(
                file,
                new vscode.CancellationTokenSource().token
            );
            if (notebookData.cells[0].metadata?.type === "paratext") {
                console.log("Skipping notebook for book because it is already migrated", book);
                continue;
            }
            console.log("after deserializeNotebook", { notebookData });
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
            // @ts-expect-error: perf is not defined in the type because it is the old type
            if (notebookData.cells[0].metadata.perf) {
                // add the performance data to the top of the notebook in the notebook metadata
                // @ts-expect-error: perf is not defined in the type because it is the old type
                notebookData.metadata.perf = notebookData.cells[0].metadata.perf;
            }

            for (const cell of notebookData.cells) {
                if (cell.kind === vscode.NotebookCellKind.Markup) {
                    // @ts-expect-error: type is not defined in the type because it is the old type
                    if (cell.metadata?.type === "chapter-heading") {
                        // This is a chapter heading cell
                        const chapter = cell.metadata.data?.chapter;
                        if (chapter && book) {
                            const h1Content = `${chapterHeadingText} ${chapter}`;
                            const newCell = new vscode.NotebookCellData(
                                vscode.NotebookCellKind.Code,
                                `<h1>${h1Content}</h1>`,
                                "html"
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
                    (cell.languageId === "scripture" ||
                        // @ts-expect-error: language is not defined in the type because it is the old type
                        cell.language === "scripture" ||
                        cell.languageId === "html")
                ) {
                    console.log({ cell });
                    // This is a cell containing all verses for a chapter
                    const lines = cell.value.split("\n");
                    for (const line of lines) {
                        console.log({ cell });
                        const verseRef = extractVerseRefFromLine(line);
                        const content = line.replace(verseRefRegex, "");
                        const verseCell = new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            content,
                            "html"
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
                            cellLabel: verseRef,
                        };
                        newCells.push(verseCell as CodexCell);
                    }
                }
            }
            console.log({ newCells });
            const updatedNotebookData = new vscode.NotebookData(newCells);

            const notebookMetadata: CustomNotebookMetadata = {
                id: book,
                originalName: book,
                sourceFsPath: vscode.Uri.joinPath(
                    vscode.workspace.workspaceFolders![0].uri,
                    ".project",
                    "sourceTexts",
                    `${book}.source`
                ).fsPath,
                codexFsPath: vscode.Uri.joinPath(
                    vscode.workspace.workspaceFolders![0].uri,
                    "files",
                    "target",
                    `${book}.codex`
                ).fsPath,
                corpusMarker: corpusMarker,
                navigation: navigationCells,
                sourceCreatedAt: "migrated from old format Fall 2024",
                codexLastModified: "",
            };

            if (notebookData?.metadata?.perf) {
                notebookMetadata.perf = notebookData.metadata.perf;
            }

            updatedNotebookData.metadata = notebookMetadata;
            const notebookCreationPromise = serializer
                .serializeNotebook(updatedNotebookData, new vscode.CancellationTokenSource().token)
                .then((notebookFile) => {
                    const filePath = vscode.Uri.joinPath(
                        vscode.Uri.file(workspaceRoot),
                        "files",
                        "target",
                        `${book}.codex`
                    ).fsPath;
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
    // Note: Comments are now stored in .project/comments.json and created by CustomWebviewProvider
    // This function is kept for backward compatibility but no longer creates files
    // The actual comments file is created by CustomWebviewProvider.initializeCommentsFile()
    console.log("[createProjectCommentFiles] Comments file is now managed by CustomWebviewProvider");
}

export async function importLocalUsfmSourceBible(
    passedUri?: vscode.Uri,
    notebookId?: string
): Promise<string[]> {
    let folderUri: vscode.Uri | undefined;
    const importedNotebookIds: string[] = [];

    if (!passedUri) {
        const selectedUris = await vscode.window.showOpenDialog({
            canSelectFiles: true,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: "Select USFM File or Folder",
        });
        folderUri = selectedUris?.[0];
    } else {
        folderUri = passedUri;
    }

    if (!folderUri) {
        vscode.window.showErrorMessage("No file or folder selected");
        return importedNotebookIds;
    }

    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return importedNotebookIds;
    }

    const stat = await vscode.workspace.fs.stat(folderUri);
    const isDirectory = stat.type === vscode.FileType.Directory;

    const usfmFiles = isDirectory
        ? await vscode.workspace.fs.readDirectory(folderUri)
        : [[folderUri, vscode.FileType.File]];

    const usfmFileExtensions = [".usfm", ".sfm", ".SFM", ".USFM"];
    for (const [fileName, fileType] of usfmFiles) {
        if (
            fileType === vscode.FileType.File &&
            usfmFileExtensions.some((ext) => fileName.toString().toLowerCase().endsWith(ext))
        ) {
            const fileUri = isDirectory
                ? vscode.Uri.joinPath(folderUri, fileName as string)
                : folderUri;
            const processedNotebookId = await processUsfmFile(fileUri, notebookId);
            if (processedNotebookId) importedNotebookIds.push(processedNotebookId);
        }
    }

    vscode.window.showInformationMessage(`USFM file(s) imported successfully.`);
    return importedNotebookIds;
}

async function processUsfmFile(fileUri: vscode.Uri, notebookId?: string): Promise<string> {
    console.log(`Processing file: ${fileUri.fsPath}`);
    const fileContent = await vscode.workspace.fs.readFile(fileUri);
    console.log(`File content length: ${fileContent.byteLength} bytes`);

    try {
        const relaxedUsfmParser = new grammar.USFMParser(
            new TextDecoder().decode(fileContent),
            grammar.LEVEL.RELAXED
        );
        let jsonOutput;
        try {
            jsonOutput = relaxedUsfmParser.toJSON() as any as ParsedUSFM;
        } catch (error) {
            vscode.window.showErrorMessage(
                `Error parsing USFM file ${fileUri.fsPath}: ${error instanceof Error ? error.message : String(error)
                }`
            );
            return notebookId || "";
        }
        console.log(
            `Parsed JSON output for ${fileUri.fsPath}:`,
            JSON.stringify(jsonOutput, null, 2)
        );

        const bookCode = jsonOutput.book.bookCode;
        const metadataManager = getNotebookMetadataManager();
        await metadataManager.initialize();
        const baseName = basename(fileUri.fsPath).split(".")[0] || `new_source`;
        const generatedNotebookId = notebookId || metadataManager.generateNewId(baseName);

        const cells: vscode.NotebookCellData[] = [];

        jsonOutput.chapters.forEach((chapter: any) => {
            // Add chapter heading
            const chapterHeadingCell = new vscode.NotebookCellData(
                vscode.NotebookCellKind.Code,
                `<h1>Chapter ${chapter.chapterNumber}</h1>`,
                "paratext"
            );
            chapterHeadingCell.metadata = {
                type: "paratext",
                id: `${bookCode} ${chapter.chapterNumber}:0`,
            };
            cells.push(chapterHeadingCell);

            // Add verse cells
            chapter.contents.forEach((content: any) => {
                if (content.verseNumber && content.verseText) {
                    const verseCell = new vscode.NotebookCellData(
                        vscode.NotebookCellKind.Code,
                        content.verseText,
                        "scripture"
                    );
                    verseCell.metadata = {
                        type: "text",
                        id: `${bookCode} ${chapter.chapterNumber}:${content.verseNumber}`,
                    };
                    cells.push(verseCell);
                }
            });
        });

        const bookData = {
            cells,
            metadata: {
                id: generatedNotebookId,
                originalName: baseName,
                data: {
                    corpusMarker: getTestamentForBook(bookCode),
                },
            },
        };

        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            throw new Error("No workspace folder found");
        }

        const bookFilePath = vscode.Uri.joinPath(
            workspaceFolder.uri,
            ".project",
            "sourceTexts",
            `${baseName}.source`
        );

        await vscode.workspace.fs.writeFile(
            bookFilePath,
            new TextEncoder().encode(JSON.stringify(bookData, null, 2))
        );

        console.log(`Created .source file for ${bookCode}`);
        return generatedNotebookId;
    } catch (error) {
        console.error(`Error processing file ${fileUri.fsPath}:`, error);
        vscode.window.showErrorMessage(
            `Error processing file ${fileUri.fsPath}: ${error instanceof Error ? error.message : String(error)
            }`
        );
        return notebookId || "";
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
                        "html"
                    );
                    verseCell.metadata = {
                        type: "text",
                        id: verse,
                        data: {},
                        cellLabel: verse,
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
                    const fileUri = vscode.Uri.joinPath(
                        getWorkSpaceUri()!,
                        "files",
                        "target",
                        `${book}.codex`
                    );
                    return generateFile({
                        filepath: fileUri.fsPath,
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

// Update the splitSourceFileByBook function to handle transformed content better

export async function splitSourceFileByBook(
    sourceUri: vscode.Uri,
    workspacePath: string,
    language: string
): Promise<vscode.Uri[]> {
    const content = await vscode.workspace.fs.readFile(sourceUri);
    const textContent = Buffer.from(content).toString("utf-8");
    const lines = textContent.split("\n").filter((line) => line.trim());

    // Group verses by book
    const bookGroups = new Map<string, string[]>();

    lines.forEach((line) => {
        const match = line.match(/^([\w\s]+)\s+\d+:\d+\s+.+$/);
        if (match) {
            const book = match[1].trim();
            if (!bookGroups.has(book)) {
                bookGroups.set(book, []);
            }
            bookGroups.get(book)!.push(line);
        }
    });

    const createdFiles: vscode.Uri[] = [];

    // Create source directory if it doesn't exist
    const sourceTextDir = vscode.Uri.joinPath(
        vscode.Uri.file(workspacePath),
        "files",
        "source",
        `${language}Texts`
    );

    try {
        await vscode.workspace.fs.createDirectory(sourceTextDir);
    } catch (error) {
        // Directory might already exist
    }

    // Create a file for each book
    for (const [book, verses] of bookGroups) {
        const safeBookName = book.replace(/[^a-zA-Z0-9]/g, "");
        const sourceFilePath = vscode.Uri.joinPath(sourceTextDir, `${safeBookName}.source`);

        await vscode.workspace.fs.writeFile(
            sourceFilePath,
            Buffer.from(verses.join("\n"), "utf-8")
        );

        createdFiles.push(sourceFilePath);
    }

    return createdFiles;
}

export async function migrateSourceFiles() {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
    if (!workspaceFolder) {
        return;
    }

    const sourceTextsFolderUri = vscode.Uri.joinPath(
        workspaceFolder.uri,
        ".project",
        "sourceTexts"
    );

    try {
        await vscode.workspace.fs.stat(sourceTextsFolderUri);
    } catch {
        console.log("No source texts folder found. Skipping migration.");
        return;
    }

    const sourceFiles = await vscode.workspace.fs.readDirectory(sourceTextsFolderUri);

    for (const [fileName, fileType] of sourceFiles) {
        if (fileType === vscode.FileType.File && fileName.endsWith(".source")) {
            const fileUri = vscode.Uri.joinPath(sourceTextsFolderUri, fileName);

            try {
                const fileContent = await vscode.workspace.fs.readFile(fileUri);
                const sourceData = JSON.parse(fileContent.toString());

                const books = new Set<string>();
                for (const cell of sourceData.cells) {
                    if (cell.metadata && cell.metadata.id) {
                        const [book] = cell.metadata.id.split(" ");
                        books.add(book);
                    }
                }

                if (books.size > 1) {
                    console.log(`Splitting ${fileName} into multiple files...`);
                    await splitSourceFileByBook(fileUri, workspaceFolder.uri.fsPath, "source");

                    // Rename the original file
                    const newFileName = fileName.replace(".source", ".source.combined");
                    const newFileUri = vscode.Uri.joinPath(sourceTextsFolderUri, newFileName);
                    try {
                        await vscode.workspace.fs.rename(fileUri, newFileUri);
                        console.log(`Renamed original file to ${newFileName}`);
                    } catch (error) {
                        console.error(`Failed to rename ${fileName}: ${error}`);
                    }
                }
            } catch (error) {
                console.error(`Error processing ${fileName}: ${error}`);
            }
        }
    }

    console.log("Source file migration completed.");
}

export async function writeSourceFile(uri: vscode.Uri, content: string): Promise<void> {
    // Write to a temp file next to the target (same dir), not inside the target path
    const uniqueSuffix = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
    const tempUri = vscode.Uri.file(`${uri.fsPath}.${uniqueSuffix}.tmp`);
    try {
        // Ensure parent directory exists
        const parentDirPath = uri.fsPath.substring(0, uri.fsPath.lastIndexOf("/"));
        if (parentDirPath) {
            await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDirPath));
        }
        await vscode.workspace.fs.writeFile(tempUri, Buffer.from(content));
        await vscode.workspace.fs.rename(tempUri, uri, { overwrite: true });
    } catch (error) {
        console.error("Error writing file:", error);
        throw error;
    }
}

export async function splitSourceFile(uri: vscode.Uri): Promise<void> {
    try {
        const content = await vscode.workspace.fs.readFile(uri);
        const text = content.toString();
        const books = text.split(/\\id /).filter(Boolean);

        for (const book of books) {
            const bookId = book.substring(0, 3).toLowerCase();
            const parentDirPath = uri.fsPath.substring(0, uri.fsPath.lastIndexOf("/"));
            const bookFilePath = `${parentDirPath}/${bookId}.source`;
            const bookUri = vscode.Uri.file(bookFilePath);
            // Create dir and write directly; atomicity not required for split outputs
            try {
                await vscode.workspace.fs.createDirectory(vscode.Uri.file(parentDirPath));
            } catch (e) {
                // Directory may already exist; ignore
            }
            await vscode.workspace.fs.writeFile(bookUri, Buffer.from(`\\id ${book}`));
        }
    } catch (error) {
        console.error("Error splitting file:", error);
        throw error;
    }
}
