// MiniSearch import removed - SQLite is now used directly
import * as vscode from "vscode";
import { zeroDraftDocumentLoader } from "../../../../utils/zeroDraftUtils";
import { verseRefRegex } from "../../../../utils/verseRefUtils";
import * as sqlZeroDraft from "../../../../sqldb/zeroDraftDb";

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
    uri: vscode.Uri
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

        // SQLite indexing is handled by createZeroDraftIndex function
        // Individual record updates would need to be implemented if needed
    }

    console.log(
        `Processed file ${uri.fsPath}, processed ${recordsProcessed} records`
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
            batch.map((file) => processZeroDraftFile(file))
        );
        totalRecordsProcessed += results.reduce((sum, count) => sum + count, 0);
    }

    const db = (global as any).db;
    const documentCount = db ? sqlZeroDraft.getDocumentCount(db) : 0;
    console.log(
        `Zero Draft index created with ${documentCount} unique cells from ${totalRecordsProcessed} total records`
    );
    console.log("Zero Draft index contents:", documentCount, "records");

    // Set up file system watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
    );
    watcher.onDidChange(async (uri) => await updateIndex(uri));
    watcher.onDidCreate(async (uri) => await updateIndex(uri));
    watcher.onDidDelete(async (uri) => await removeFromIndex(uri));

    console.log("Watching for changes to zero_draft directory in workspace");
}

async function updateIndex(
    uri: vscode.Uri,
    force: boolean = false
) {
    await processZeroDraftFile(uri);
    console.log(`Updated Zero Draft index for file: ${uri.fsPath}`);
}

async function removeFromIndex(uri: vscode.Uri) {
    const db = (global as any).db;
    const removedCount = db ? sqlZeroDraft.removeRecordsBySource(db, uri.fsPath) : 0;
    console.log(`Removed ${removedCount} records from Zero Draft index for file: ${uri.fsPath}`);
}

// Updated function to get content options for a given cellId
export function getContentOptionsForCellId(
    cellId: string
): Partial<ZeroDraftIndexRecord> | null {
    const db = (global as any).db;
    return db ? sqlZeroDraft.getContentOptionsForCellId(db, cellId) : null;
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
                    cell.metadata?.type === "scripture"
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
            const contentOptions = getContentOptionsForCellId(cellId);
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
