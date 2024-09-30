import MiniSearch from "minisearch";
import * as vscode from "vscode";
import { StatusBarHandler } from "../statusBarHandler";
import { zeroDraftDocumentLoader } from "../../../../utils/zeroDraftUtils";
import { verseRefRegex } from "../../../../utils/verseRefUtils";

export interface ZeroDraftIndexRecord {
    id: string;
    cellId: string;
    cells: CellWithMetadata[];
}

export interface CellWithMetadata {
    content: string;
    source: string;
    uploadedAt: string;
    originalFileCreatedAt: string;
    originalFileModifiedAt: string;
    metadata?: { [key: string]: any };
}

async function processZeroDraftFile(
    uri: vscode.Uri,
    zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>
): Promise<number> {
    const document = await vscode.workspace.openTextDocument(uri);
    const records = zeroDraftDocumentLoader(document);

    const fileStats = await vscode.workspace.fs.stat(uri);
    const originalFileCreatedAt = new Date(fileStats.ctime).toISOString();
    const originalFileModifiedAt = new Date(fileStats.mtime).toISOString();

    let recordsProcessed = 0;

    for (const record of records) {
        recordsProcessed++;
        record.cells.forEach((cell) => {
            cell.originalFileCreatedAt = originalFileCreatedAt;
            cell.originalFileModifiedAt = originalFileModifiedAt;
        });

        const existingRecord = zeroDraftIndex.getStoredFields(record.cellId) as
            | ZeroDraftIndexRecord
            | undefined;

        if (existingRecord) {
            // Update existing record
            const updatedCells = [...existingRecord.cells, ...record.cells];
            zeroDraftIndex.replace({
                id: record.cellId,
                cellId: record.cellId,
                cells: updatedCells,
            });
        } else {
            // Add new record
            zeroDraftIndex.add({
                id: record.cellId,
                cellId: record.cellId,
                cells: record.cells,
            });
        }
    }

    console.log(
        `Processed file ${uri.fsPath}, current document count: ${zeroDraftIndex.documentCount}`
    );
    return recordsProcessed;
}

export async function processZeroDraftFileWithoutIndexing(
    uri: vscode.Uri
): Promise<ZeroDraftIndexRecord[]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const records = zeroDraftDocumentLoader(document);
    console.log(`Processed file ${uri.fsPath}, current document count: ${records.length}`);
    return records;
}

export async function createZeroDraftIndex(
    zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>,
    force: boolean = false
): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error("No workspace folder found");
        return;
    }

    const zeroDraftFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, "files", "zero_drafts");
    const zeroDraftFiles = await vscode.workspace.findFiles(
        new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
    );
    console.log("Found", zeroDraftFiles.length, "Zero Draft files");

    let totalRecordsProcessed = 0;

    // Batch process files
    const batchSize = 10;
    for (let i = 0; i < zeroDraftFiles.length; i += batchSize) {
        const batch = zeroDraftFiles.slice(i, i + batchSize);
        const results = await Promise.all(
            batch.map((file) => processZeroDraftFile(file, zeroDraftIndex))
        );
        totalRecordsProcessed += results.reduce((sum, count) => sum + count, 0);
    }

    console.log(
        `Zero Draft index created with ${zeroDraftIndex.documentCount} unique verses from ${totalRecordsProcessed} total records`
    );
    console.log("Zero Draft index contents:", zeroDraftIndex.search("*").length, "records");

    // Set up file system watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
    );
    watcher.onDidChange(async (uri) => await updateIndex(uri, zeroDraftIndex));
    watcher.onDidCreate(async (uri) => await updateIndex(uri, zeroDraftIndex));
    watcher.onDidDelete(async (uri) => await removeFromIndex(uri, zeroDraftIndex));

    console.log("Watching for changes to zero_draft directory in workspace");
}

async function updateIndex(
    uri: vscode.Uri,
    zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>,
    force: boolean = false
) {
    await processZeroDraftFile(uri, zeroDraftIndex);
    console.log(`Updated Zero Draft index for file: ${uri.fsPath}`);
}

async function removeFromIndex(uri: vscode.Uri, zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>) {
    const recordsToRemove = Array.from(zeroDraftIndex.search("*")).filter((record) =>
        record.cells.some((cell: CellWithMetadata) => cell.source === uri.fsPath)
    );

    for (const record of recordsToRemove) {
        zeroDraftIndex.remove(record.cellId);
    }

    console.log(`Removed records from Zero Draft index for file: ${uri.fsPath}`);
}

// Updated function to get content options for a given cellId
export function getContentOptionsForCellId(
    zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>,
    cellId: string
): Partial<ZeroDraftIndexRecord> | null {
    const result = zeroDraftIndex.getStoredFields(cellId);
    if (!result) {
        return null;
    }
    const partialRecord: Partial<ZeroDraftIndexRecord> = {
        cellId: result.cellId as string,
        cells: result.cells as CellWithMetadata[],
    };
    console.log(`Retrieving content for cellId ${cellId}:`, partialRecord);
    return partialRecord;
}

export async function insertDraftsIntoTargetNotebooks({
    zeroDraftFilePath,
    forceInsert = false,
}: {
    zeroDraftFilePath: string;
    forceInsert?: boolean;
}): Promise<void> {
    const notebookFiles = await vscode.workspace.findFiles("**/*.codex");
    const relevantRecords = await processZeroDraftFileWithoutIndexing(
        vscode.Uri.file(zeroDraftFilePath)
    );

    let insertedCount = 0;
    let skippedCount = 0;

    // Create a map for quick lookup of zero drafts grouped by book
    const zeroDraftMap = new Map<string, Map<string, string>>();
    for (const record of relevantRecords) {
        const book = record.cellId.split(" ")[0];
        if (!zeroDraftMap.has(book)) {
            zeroDraftMap.set(book, new Map());
        }
        zeroDraftMap.get(book)!.set(record.cellId, record.cells[0].content.trim());
    }

    for (const [book, drafts] of zeroDraftMap.entries()) {
        const notebookFiles = await vscode.workspace.findFiles(`**/${book}.codex`);
        console.log(`Found ${drafts.size} cells for book ${book}`);

        for (const notebookFile of notebookFiles) {
            const notebook = await vscode.workspace.openNotebookDocument(notebookFile);
            const workspaceEdit = new vscode.WorkspaceEdit();

            for (let cellIndex = 0; cellIndex < notebook.cellCount; cellIndex++) {
                const cell = notebook.cellAt(cellIndex);
                if (
                    cell.kind === vscode.NotebookCellKind.Code &&
                    cell.document.languageId === "scripture"
                ) {
                    const cellContent = cell.document.getText().trim();
                    const zeroDraft = drafts.get(cell.metadata?.id);
                    if (zeroDraft) {
                        if (forceInsert || cellContent === "") {
                            const updatedCell = new vscode.NotebookCellData(
                                vscode.NotebookCellKind.Code,
                                zeroDraft,
                                "scripture"
                            );
                            updatedCell.metadata = { ...cell.metadata };

                            const notebookEdit = new vscode.NotebookEdit(
                                new vscode.NotebookRange(cellIndex, cellIndex + 1),
                                [updatedCell]
                            );
                            workspaceEdit.set(notebook.uri, [notebookEdit]);
                            insertedCount++;
                        } else {
                            skippedCount++;
                        }
                    }
                }
            }

            if (insertedCount > 0) {
                await vscode.workspace.applyEdit(workspaceEdit);
            }
        }
    }

    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} cells from file: ${zeroDraftFilePath}`
    );
}

export async function insertDraftsInCurrentEditor(
    zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>,
    forceInsert: boolean = false
): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage("No active editor found");
        return;
    }

    const document = editor.document;
    let insertedCount = 0;
    let skippedCount = 0;

    const edit = new vscode.WorkspaceEdit();

    for (let i = 0; i < document.lineCount; i++) {
        const line = document.lineAt(i);
        const trimmedLine = line.text.trim();
        const match = trimmedLine.match(verseRefRegex);
        if (match) {
            const cellId = match[0];
            const contentOptions = getContentOptionsForCellId(zeroDraftIndex, cellId);
            if (contentOptions && contentOptions.cells && contentOptions.cells.length > 0) {
                const zeroDraft = contentOptions.cells[0].content.trim();

                if (forceInsert || trimmedLine === cellId) {
                    const range = line.range;
                    edit.replace(document.uri, range, `${cellId} ${zeroDraft}`);
                    insertedCount++;
                } else {
                    skippedCount++;
                }
            }
        }
    }

    if (insertedCount > 0) {
        await vscode.workspace.applyEdit(edit);
    }

    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} cells in the current editor.`
    );
}
