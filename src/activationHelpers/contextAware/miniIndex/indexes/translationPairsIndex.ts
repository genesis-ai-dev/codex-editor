import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { verseRefRegex } from '../../../../utils/verseRefUtils';
import { StatusBarHandler } from '../statusBarHandler';
import * as fs from 'fs';
import * as path from 'path';
import { loadIndexMetadata, saveIndexMetadata } from './index';
import { getWorkSpaceFolder } from '../../../../utils';
export interface minisearchDoc {
    id: string;
    vref: string;
    book: string;
    chapter: string;
    verse: string;
    sourceContent: string;
    targetContent: string;
    uri: string;
    line: number;
}

interface IndexMetadata {
    lastIndexed: number;
    fileTimestamps: { [filePath: string]: number };
}

export async function createTranslationPairsIndex(context: vscode.ExtensionContext, translationPairsIndex: MiniSearch<minisearchDoc>, statusBarHandler: StatusBarHandler): Promise<void> {
    const workspaceFolder = getWorkSpaceFolder();
    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Translation Pairs Index. Returning empty index.');
        return;
    }

    const metadata: IndexMetadata = await loadIndexMetadata("translationPairsIndex") || { lastIndexed: 0, fileTimestamps: {} };

    async function indexAllDocuments(): Promise<number> {
        console.log('Starting indexAllDocuments');
        let indexed = 0;

        const sourceBibleFiles = await vscode.workspace.findFiles('**/*.bible');
        const targetBibleFiles = await vscode.workspace.findFiles('**/*.codex');

        // Create a map of verse references to target verses
        const targetVerseMap = new Map<string, string>();
        const completeDrafts: string[] = [];

        // Batch process target files
        const batchSize = 10;
        for (let i = 0; i < targetBibleFiles.length; i += batchSize) {
            const batch = targetBibleFiles.slice(i, i + batchSize);
            await Promise.all(batch.map(file => processTargetFile(file, targetVerseMap, completeDrafts, metadata)));
        }

        // Write complete drafts to file
        if (workspaceFolder) {
            await writeCompleteDrafts(workspaceFolder, completeDrafts);
        }

        // Batch process source files
        for (let i = 0; i < sourceBibleFiles.length; i += batchSize) {
            const batch = sourceBibleFiles.slice(i, i + batchSize);
            const results = await Promise.all(batch.map((fileUri: vscode.Uri) => indexDocument(fileUri, targetVerseMap, metadata)));
            indexed += results.reduce((sum, count) => sum + count, 0);
        }

        console.log(`Total verses indexed: ${indexed}`);
        console.log('Sample document from translationPairsIndex:', translationPairsIndex.search('*')[0]);
        return indexed;
    }

    async function indexDocument(documentUri: vscode.Uri, targetVerseMap: Map<string, string>, metadata: IndexMetadata): Promise<number> {
        let indexedCount = 0;
        const batchSize = 1000;
        let batch: minisearchDoc[] = [];

        const processBatch = () => {
            if (batch.length > 0) {
                try {
                    translationPairsIndex.addAll(batch);
                    indexedCount += batch.length;
                } catch (error) {
                    if (error instanceof Error && error.message.includes('duplicate ID')) {
                        processBatchRecursively(batch);
                    } else {
                        throw error;
                    }
                } batch = [];
            }
        };

        const processBatchRecursively = (currentBatch: minisearchDoc[]) => {
            if (currentBatch.length === 0) return;
            const smallerBatch = currentBatch.filter((_, index) => index % 10 === 0);
            try {
                translationPairsIndex.addAll(smallerBatch);
                indexedCount += smallerBatch.length;
            } catch (error) {
                if (error instanceof Error && error.message.includes('duplicate ID')) {
                    for (const doc of smallerBatch) {
                        try {
                            translationPairsIndex.add(doc);
                            indexedCount++;
                        } catch (innerError) {
                            if (innerError instanceof Error && innerError.message.includes('duplicate ID')) {
                                console.info(`Skipped duplicate ID: ${doc.id}`);
                            } else {
                                throw innerError;
                            }
                        }
                    }
                } else {
                    throw error;
                }
            }
            processBatchRecursively(currentBatch.filter((_, index) => index % 10 !== 0));
        };

        const document = await vscode.workspace.openTextDocument(documentUri);
        const lines = document.getText().split('\n');
        for (let i = 0; i < lines.length; i++) {
            const indexedDoc = indexLine(lines[i], i, documentUri.toString(), targetVerseMap);
            if (indexedDoc) {
                batch.push(indexedDoc);
                if (batch.length >= batchSize) {
                    processBatch();
                }
            }
        }

        processBatch(); // Process any remaining documents in the batch
        return indexedCount;
    }

    function indexLine(line: string, lineIndex: number, uri: string, targetVerseMap: Map<string, string>): minisearchDoc | null {
        const match = line.match(verseRefRegex);
        if (match) {
            const [vref] = match;
            // Only index if there's a corresponding target verse
            if (targetVerseMap.has(vref)) {
                const [book, chapterVerse] = vref.split(' ');
                const [chapter, verse] = chapterVerse.split(':');
                const sourceContent = line.substring(match.index! + match[0].length).trim();
                const targetContent = targetVerseMap.get(vref)!;
                const id = `${uri}:${lineIndex}:${vref}`;
                return {
                    id,
                    vref,
                    book,
                    chapter,
                    verse,
                    sourceContent,
                    targetContent,
                    uri,
                    line: lineIndex
                };
            }
        }
        return null;
    }

    async function initializeIndexing() {
        const startTime = Date.now();
        try {
            await rebuildFullIndex();
        } catch (error) {
            console.error('Error during index initialization:', error);
            vscode.window.showErrorMessage('Failed to initialize indexing. Check the logs for details.');
        } finally {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            console.log(`Index initialized in ${duration.toFixed(2)} seconds`);
        }
    }

    async function rebuildFullIndex() {
        statusBarHandler.setIndexingActive();
        await indexAllDocuments();
        statusBarHandler.setIndexingComplete();
    }

    async function processTargetFile(file: vscode.Uri, targetVerseMap: Map<string, string>, completeDrafts: string[], metadata: IndexMetadata): Promise<void> {
        const stats = await vscode.workspace.fs.stat(file);
        if (metadata.fileTimestamps[file.fsPath] && stats.mtime <= metadata.fileTimestamps[file.fsPath]) {
            return; // File hasn't changed, skip processing
        }

        const document = await vscode.workspace.openNotebookDocument(file);
        const cells = document.getCells();
        for (const cell of cells) {
            const lines = cell.document.getText().split('\n');
            for (const line of lines) {
                const match = line.match(verseRefRegex);
                if (match) {
                    const [vref] = match;
                    const verseContent = line.substring(match.index! + match[0].length).trim();
                    if (verseContent) {
                        targetVerseMap.set(vref, verseContent);
                        completeDrafts.push(verseContent);
                    }
                }
            }
        }

        metadata.fileTimestamps[file.fsPath] = stats.mtime;
    }

    async function writeCompleteDrafts(workspaceFolder: string, completeDrafts: string[]): Promise<void> {
        const completeDraftPath = path.join(workspaceFolder, '.project', 'complete_drafts.txt');
        try {
            await fs.promises.mkdir(path.dirname(completeDraftPath), { recursive: true });
            await fs.promises.writeFile(completeDraftPath, completeDrafts.join('\n'), 'utf8');
            console.log(`Complete drafts written to ${completeDraftPath}`);
        } catch (error) {
            console.error(`Error writing complete drafts: ${error}`);
        }
    }

    // Subscriptions

    context.subscriptions.push(
        // vscode.workspace.onDidChangeTextDocument(debouncedUpdateIndex),
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            if (doc.languageId === 'scripture' || doc.fileName.endsWith('.codex')) {
                await indexDocument(doc.uri, new Map<string, string>(), metadata);
            }
        })
    );

    // Build the index

    console.log('Starting index initialization');
    await initializeIndexing().catch(error => {
        console.error('Error initializing indexing:', error);
        vscode.window.showErrorMessage('Failed to initialize indexing.');
    });

    // Save updated metadata
    await saveIndexMetadata("translationPairsIndex", metadata);
}