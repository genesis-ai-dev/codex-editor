import * as fs from 'fs';
import * as path from 'path';
import MiniSearch from 'minisearch';
import * as vscode from 'vscode';
import { verseRefRegex } from '../../../../utils/verseRefUtils';
import { StatusBarHandler } from '../statusBarHandler';

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

export async function createTranslationPairsIndex(context: vscode.ExtensionContext, translationPairsIndex: MiniSearch, workspaceFolder: vscode.WorkspaceFolder, statusBarHandler: StatusBarHandler): Promise<void> {

    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Translation Pairs Index. Returning empty index.');
        return;
    }

    let completeDraft = '';

    async function indexAllDocuments(): Promise<number> {
        let indexed = 0;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Workspace folder not found.');
            return indexed;
        }

        const targetBibleFiles = await vscode.workspace.findFiles('**/*.codex');

        // Process .codex files for indexing and complete draft
        for (const file of targetBibleFiles) {
            try {
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
                                // Add to index
                                const indexedDoc = createIndexDoc(vref, verseContent, file.fsPath, indexed);
                                translationPairsIndex.add(indexedDoc);
                                indexed++;

                                // Add to complete draft
                                completeDraft += verseContent + '\n';
                            }
                        }
                    }
                }
            } catch (error) {
                console.error(`Error processing file ${file.fsPath}:`, error);
                vscode.window.showErrorMessage(`Failed to process file: ${file.fsPath}`);
            }
        }

        // Write the complete draft to a file
        const completeDraftPath = path.join(workspaceFolder, '.project', 'complete_drafts.txt');
        fs.writeFileSync(completeDraftPath, completeDraft);

        console.log(`Total verses indexed: ${indexed}`);
        console.log(`Complete draft created at: ${completeDraftPath}`);
        return indexed;
    }

    function createIndexDoc(vref: string, content: string, uri: string, id: number): minisearchDoc {
        const [book, chapterVerse] = vref.split(' ');
        const [chapter, verse] = chapterVerse.split(':');
        return {
            id: id.toString(),
            vref,
            book,
            chapter,
            verse,
            sourceContent: '', // Empty for .codex files
            targetContent: content,
            uri,
            line: -1 // We don't have line numbers for .codex files
        };
    }

    async function indexDocument(document: vscode.TextDocument, targetVerseMap: Map<string, string>): Promise<number> {
        const uri = document.uri.toString();
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
                }
                batch = [];
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

        const lines = document.getText().split('\n');
        for (let i = 0; i < lines.length; i++) {
            const indexedDoc = indexLine(lines[i], i, uri, targetVerseMap);
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


    // Subscriptions

    context.subscriptions.push(
        // vscode.workspace.onDidChangeTextDocument(debouncedUpdateIndex),
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            if (doc.languageId === 'scripture' || doc.fileName.endsWith('.codex')) {
                await indexDocument(doc, new Map<string, string>());
            }
        })
    );

    // Build the index

    await initializeIndexing().catch(error => {
        console.error('Error initializing indexing:', error);
        vscode.window.showErrorMessage('Failed to initialize indexing.');
    });

    console.log('Translation pairs index created with', translationPairsIndex.documentCount, 'documents');
    console.log('Sample document:', JSON.stringify(translationPairsIndex.search('*')[0], null, 2));
}