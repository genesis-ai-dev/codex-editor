import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { StatusBarHandler } from '../statusBarHandler';
import { zeroDraftDocumentLoader } from '../../../../utils/zeroDraftUtils';
import { verseRefRegex } from '../../../../utils/verseRefUtils';

export interface ZeroDraftIndexRecord {
    id: string;
    vref: string;
    verses: VerseWithMetadata[];
}

export interface VerseWithMetadata {
    content: string;
    source: string;
    uploadedAt: string;
    originalFileCreatedAt: string;
    originalFileModifiedAt: string;
    metadata?: { [key: string]: any };
}

async function processZeroDraftFile(uri: vscode.Uri, zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>): Promise<number> {
    const document = await vscode.workspace.openTextDocument(uri);
    const records = zeroDraftDocumentLoader(document);

    const fileStats = await vscode.workspace.fs.stat(uri);
    const originalFileCreatedAt = new Date(fileStats.ctime).toISOString();
    const originalFileModifiedAt = new Date(fileStats.mtime).toISOString();

    let recordsProcessed = 0;

    for (const record of records) {
        recordsProcessed++;
        record.verses.forEach(verse => {
            verse.originalFileCreatedAt = originalFileCreatedAt;
            verse.originalFileModifiedAt = originalFileModifiedAt;
        });

        const existingRecord = zeroDraftIndex.getStoredFields(record.vref) as ZeroDraftIndexRecord | undefined;

        if (existingRecord) {
            // Update existing record
            const updatedVerses = [...existingRecord.verses, ...record.verses];
            zeroDraftIndex.replace({
                id: record.vref,
                vref: record.vref,
                verses: updatedVerses
            });
        } else {
            // Add new record
            zeroDraftIndex.add({
                id: record.vref,
                vref: record.vref,
                verses: record.verses
            });
        }
    }

    console.log(`Processed file ${uri.fsPath}, current document count: ${zeroDraftIndex.documentCount}`);
    return recordsProcessed;
}

export async function processZeroDraftFileWithoutIndexing(uri: vscode.Uri): Promise<ZeroDraftIndexRecord[]> {
    const document = await vscode.workspace.openTextDocument(uri);
    const records = zeroDraftDocumentLoader(document);
    console.log(`Processed file ${uri.fsPath}, current document count: ${records.length}`);
    return records;
}

export async function createZeroDraftIndex(zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>, force: boolean = false): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error('No workspace folder found');
        return;
    }

    const zeroDraftFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, 'files', 'zero_drafts');
    const zeroDraftFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(zeroDraftFolder, '*.{jsonl,json,tsv,txt}'));
    console.log('Found', zeroDraftFiles.length, 'Zero Draft files');

    let totalRecordsProcessed = 0;

    // Batch process files
    const batchSize = 10;
    for (let i = 0; i < zeroDraftFiles.length; i += batchSize) {
        const batch = zeroDraftFiles.slice(i, i + batchSize);
        const results = await Promise.all(batch.map(file => processZeroDraftFile(file, zeroDraftIndex)));
        totalRecordsProcessed += results.reduce((sum, count) => sum + count, 0);
    }

    console.log(`Zero Draft index created with ${zeroDraftIndex.documentCount} unique verses from ${totalRecordsProcessed} total records`);
    console.log('Zero Draft index contents:', zeroDraftIndex.search('*').length, 'records');

    // Set up file system watcher
    const watcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(zeroDraftFolder, '*.{jsonl,json,tsv,txt}')
    );
    watcher.onDidChange(async (uri) => await updateIndex(uri, zeroDraftIndex));
    watcher.onDidCreate(async (uri) => await updateIndex(uri, zeroDraftIndex));
    watcher.onDidDelete(async (uri) => await removeFromIndex(uri, zeroDraftIndex));

    console.log('Watching for changes to zero_draft directory in workspace');
}

async function updateIndex(uri: vscode.Uri, zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>, force: boolean = false) {
    await processZeroDraftFile(uri, zeroDraftIndex);
    console.log(`Updated Zero Draft index for file: ${uri.fsPath}`);
}

async function removeFromIndex(uri: vscode.Uri, zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>) {
    const recordsToRemove = Array.from(zeroDraftIndex.search('*')).filter(
        record => record.verses.some((verse: VerseWithMetadata) => verse.source === uri.fsPath)
    );

    for (const record of recordsToRemove) {
        zeroDraftIndex.remove(record.vref);
    }

    console.log(`Removed records from Zero Draft index for file: ${uri.fsPath}`);
}

// New function to get content options for a given vref
export function getContentOptionsForVref(zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>, vref: string): Partial<ZeroDraftIndexRecord> | null {
    const result = zeroDraftIndex.getStoredFields(vref);
    if (!result) {
        return null;
    }
    const partialRecord: Partial<ZeroDraftIndexRecord> = {
        vref: result.vref as string,
        verses: result.verses as VerseWithMetadata[],
    };
    console.log(`Retrieving content for vref ${vref}:`, partialRecord);
    return partialRecord;
}

export async function insertDraftsIntoTargetNotebooks({
    zeroDraftFilePath,
    forceInsert = false
}: {
    zeroDraftFilePath: string; // which file to use
    forceInsert?: boolean;
}): Promise<void> {
    const notebookFiles = await vscode.workspace.findFiles('**/*.codex');
    const relevantRecords = await processZeroDraftFileWithoutIndexing(vscode.Uri.file(zeroDraftFilePath));

    let insertedCount = 0;
    let skippedCount = 0;

    // Create a map for quick lookup of zero drafts grouped by book
    const zeroDraftMap = new Map<string, Map<string, string>>();
    for (const record of relevantRecords) {
        const book = record.vref.split(' ')[0];
        if (!zeroDraftMap.has(book)) {
            zeroDraftMap.set(book, new Map());
        }
        zeroDraftMap.get(book)!.set(record.vref, record.verses[0].content.trim());
    }

    for (const [book, drafts] of zeroDraftMap.entries()) {
        const notebookFiles = await vscode.workspace.findFiles(`**/${book}.codex`);
        console.log(`Found ${drafts.size} verses for book ${book}`);

        for (const notebookFile of notebookFiles) {
            const notebook = await vscode.workspace.openNotebookDocument(notebookFile);
            const workspaceEdit = new vscode.WorkspaceEdit();

            for (let cellIndex = 0; cellIndex < notebook.cellCount; cellIndex++) {
                const cell = notebook.cellAt(cellIndex);
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    const lines = cell.document.getText().split('\n');
                    const newLines: string[] = [];
                    let cellModified = false;

                    for (const line of lines) {
                        const trimmedLine = line.trim();
                        const match = trimmedLine.match(verseRefRegex);
                        if (match) {
                            const vref = match[0];
                            const zeroDraft = drafts.get(vref);
                            if (zeroDraft) {
                                if (forceInsert || trimmedLine === vref) {
                                    newLines.push(`${vref} ${zeroDraft}`);
                                    cellModified = true;
                                    insertedCount++;
                                } else {
                                    newLines.push(line);
                                    skippedCount++;
                                }
                            } else {
                                newLines.push(line);
                            }
                        } else {
                            newLines.push(line);
                        }
                    }

                    if (cellModified) {
                        const updatedCell = new vscode.NotebookCellData(
                            vscode.NotebookCellKind.Code,
                            newLines.join('\n'),
                            cell.document.languageId
                        );
                        updatedCell.metadata = { ...cell.metadata };

                        const notebookEdit = new vscode.NotebookEdit(
                            new vscode.NotebookRange(cellIndex, cellIndex + 1),
                            [updatedCell]
                        );
                        workspaceEdit.set(notebook.uri, [notebookEdit]);
                    }
                }
            }

            if (insertedCount > 0) {
                await vscode.workspace.applyEdit(workspaceEdit);
            }
        }
    }

    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} verses from file: ${zeroDraftFilePath}`
    );
}

export async function insertDraftsInCurrentEditor(zeroDraftIndex: MiniSearch, forceInsert: boolean = false): Promise<void> {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found');
        return;
    }

    const document = editor.document;
    const text = document.getText();
    const lines = text.split('\n');
    let insertedCount = 0;
    let skippedCount = 0;
    let modified = false;

    const edit = new vscode.WorkspaceEdit();

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        const match = line.match(verseRefRegex);
        if (match) {
            const vref = match[0]; // Use the full match as vref
            const contentOptions = getContentOptionsForVref(zeroDraftIndex, vref);
            if (contentOptions && contentOptions.verses && contentOptions.verses.length > 0) {
                const zeroDraft = contentOptions.verses[0].content.trim();

                if (forceInsert || line === vref) {
                    const range = new vscode.Range(
                        new vscode.Position(i, 0),
                        new vscode.Position(i, line.length)
                    );
                    edit.replace(document.uri, range, `${vref} ${zeroDraft}`);
                    modified = true;
                    insertedCount++;
                } else {
                    skippedCount++;
                }
            }
        }
    }

    if (modified) {
        await vscode.workspace.applyEdit(edit);
    }

    vscode.window.showInformationMessage(
        `Inserted ${insertedCount} drafts, skipped ${skippedCount} verses in the current editor.`
    );
}