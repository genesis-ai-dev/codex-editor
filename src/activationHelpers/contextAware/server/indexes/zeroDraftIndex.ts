import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { StatusBarHandler } from '../statusBarHandler';
import { zeroDraftDocumentLoader } from '../../../../utils/zeroDraftUtils';

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
            console.log(`Updated existing record for ${record.vref}, now has ${updatedVerses.length} verses`);
        } else {
            // Add new record
            zeroDraftIndex.add({
                id: record.vref,
                vref: record.vref,
                verses: record.verses
            });
            console.log(`Added new record for ${record.vref} with ${record.verses.length} verses`);
        }
    }

    console.log(`Processed file ${uri.fsPath}, current document count: ${zeroDraftIndex.documentCount}`);
    return recordsProcessed;
}

export async function createZeroDraftIndex(zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>, statusBarHandler: StatusBarHandler): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        console.error('No workspace folder found');
        return;
    }

    const zeroDraftFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, 'files', 'zero_drafts');
    const zeroDraftFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(zeroDraftFolder, '*.{jsonl,json,tsv,txt}'));
    console.log('Found', zeroDraftFiles.length, 'Zero Draft files');

    let totalRecordsProcessed = 0;

    for (const file of zeroDraftFiles) {
        const recordsProcessed = await processZeroDraftFile(file, zeroDraftIndex);
        totalRecordsProcessed += recordsProcessed;
        console.log(`Processed ${recordsProcessed} records from ${file.fsPath}, current document count: ${zeroDraftIndex.documentCount}`);
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

async function updateIndex(uri: vscode.Uri, zeroDraftIndex: MiniSearch<ZeroDraftIndexRecord>) {
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

// Placeholder function for inserting drafts into target notebooks
export async function insertDraftsIntoTargetNotebooks(zeroDraftFilePath: string): Promise<void> {
    // TODO: Implement the logic to insert drafts from the specified file into target notebooks
    console.log(`Inserting drafts from ${zeroDraftFilePath} into target notebooks`);
}