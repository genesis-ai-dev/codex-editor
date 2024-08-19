"use strict";
import * as vscode from "vscode";
import { verseRefRegex } from "../../../utils/verseRefUtils";
import { getWorkSpaceFolder } from "../../../utils";
import MiniSearch, { SearchResult } from 'minisearch';
import { debounce } from 'lodash';
import { StatusBarHandler } from './statusBarHandler';
import { MiniSearchVerseResult, TranslationPair } from "../../../../types";

const workspaceFolder = getWorkSpaceFolder();
interface FileManifest {
    [filePath: string]: number; // last modified timestamp
}

const manifestPath = vscode.Uri.file(
    `${workspaceFolder}/.project/copilot_server_minisearch_index_manifest.json`
);

async function loadManifest(): Promise<FileManifest> {
    try {
        const data = await vscode.workspace.fs.readFile(manifestPath);
        return JSON.parse(Buffer.from(data).toString('utf8'));
    } catch (error) {
        return {};
    }
}

async function saveManifest(manifest: FileManifest) {
    const data = JSON.stringify(manifest, null, 2);
    await vscode.workspace.fs.writeFile(manifestPath, Buffer.from(data, 'utf8'));
}

async function checkIfIndexNeedsUpdate(): Promise<boolean> {
    const manifest = await loadManifest();
    const currentTime = Date.now();
    const oneWeek = 7 * 24 * 60 * 60 * 1000; // milliseconds in a week
    if (!manifest['lastFullReindex'] || currentTime - manifest['lastFullReindex'] > oneWeek) {
        return true;
    }

    const filesToCheck = [
        ...await vscode.workspace.findFiles('**/*.bible'),
        ...await vscode.workspace.findFiles('**/*.codex')
    ];
    for (const file of filesToCheck) {
        const stats = await vscode.workspace.fs.stat(file);
        if (!manifest[file.fsPath] || stats.mtime > manifest[file.fsPath]) {
            return true;
        }
    }
    return false;
}

export async function createIndexWithContext(context: vscode.ExtensionContext) {
    const statusBarHandler = StatusBarHandler.getInstance();
    context.subscriptions.push(statusBarHandler);

    const config = vscode.workspace.getConfiguration('translators-copilot-server');
    const isCopilotEnabled = config.get<boolean>('enable', true);
    if (!isCopilotEnabled) {
        vscode.window.showInformationMessage("Translators Copilot Server is disabled. Language server not activated.");
        return;
    }
    vscode.window.showInformationMessage("Translators Copilot Server activated");
    let miniSearch = new MiniSearch({
        fields: ['vref', 'book', 'chapter', 'content'],
        storeFields: ['id', 'vref', 'book', 'chapter', 'content', 'uri', 'line', 'docType'],
        searchOptions: {
            boost: { vref: 2 },
            fuzzy: 0.2
        }
    });
    interface minisearchDoc {
        id: string;
        vref: string;
        book: string;
        chapter: string;
        verse: string;
        content: string;
        uri: string;
        line: number;
        docType: 'source' | 'target';
    }

    async function indexAllDocuments(): Promise<number> {
        let indexed = 0;
        if (!workspaceFolder) {
            vscode.window.showErrorMessage('Workspace folder not found.');
            return indexed;
        }

        const allFiles = [
            ...(await vscode.workspace.findFiles('**/*.bible')),
            ...(await vscode.workspace.findFiles('**/*.codex'))
        ];

        for (const file of allFiles) {
            try {
                const document = file.path.endsWith('.codex')
                    ? await vscode.workspace.openNotebookDocument(file)
                    : await vscode.workspace.openTextDocument(file);

                indexed += await indexDocument(document);
            } catch (error) {
                console.error(`Error indexing file ${file.fsPath}:`, error);
                vscode.window.showErrorMessage(`Failed to index file: ${file.fsPath}`);
            }
        }

        console.log(`Total verses indexed: ${indexed}`);
        return indexed;
    }

    async function indexDocument(document: vscode.TextDocument | vscode.NotebookDocument): Promise<number> {
        const uri = document.uri.toString();
        let indexedCount = 0;
        const batchSize = 1000;
        let batch: minisearchDoc[] = [];

        const processBatch = () => {
            if (batch.length > 0) {
                try {
                    miniSearch.addAll(batch);
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
                miniSearch.addAll(smallerBatch);
                indexedCount += smallerBatch.length;
            } catch (error) {
                if (error instanceof Error && error.message.includes('duplicate ID')) {
                    for (const doc of smallerBatch) {
                        try {
                            miniSearch.add(doc);
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

        const indexContent = (content: string, lineOffset: number = 0) => {
            const lines = content.split('\n');
            for (let i = 0; i < lines.length; i++) {
                const indexedDoc = indexLine(lines[i], i + lineOffset, uri);
                if (indexedDoc) {
                    batch.push(indexedDoc);
                    if (batch.length >= batchSize) {
                        processBatch();
                    }
                }
            }
        };

        if ('getText' in document) {
            indexContent(document.getText());
        } else if ('getCells' in document) {
            let lineOffset = 0;
            for (const cell of document.getCells()) {
                if (cell.kind === vscode.NotebookCellKind.Code) {
                    indexContent(cell.document.getText(), lineOffset);
                    lineOffset += cell.document.lineCount;
                }
            }
        }

        processBatch(); // Process any remaining documents in the batch
        return indexedCount;
    }

    function indexLine(line: string, lineIndex: number, uri: string): minisearchDoc | null {
        const match = line.match(verseRefRegex);
        if (match) {
            const [vref] = match;
            const [book, chapterVerse] = vref.split(' ');
            const [chapter, verse] = chapterVerse.split(':');
            const content = line.substring(match.index! + match[0].length).trim();
            const docType = uri.includes('.codex') ? 'target' : 'source';
            const id = `${docType}:${uri}:${lineIndex}:${vref}`;
            return {
                id,
                vref,
                book,
                chapter,
                verse,
                content,
                uri,
                line: lineIndex,
                docType
            };
        }
        return null;
    }

    const debouncedUpdateIndex = debounce(async (event: vscode.TextDocumentChangeEvent) => {
        const document = event.document;
        if (document.languageId === 'scripture' || document.fileName.endsWith('.codex')) {
            await indexDocument(document);
            await serializeIndex(miniSearch);
        }
    }, 1000);  // 1000ms debounce time

    const minisearchIndexPath = vscode.Uri.file(
        `${workspaceFolder}/.vscode/minisearch_index.json`
    );

    const debouncedSerializeIndex = debounce(async (miniSearch: MiniSearch) => {
        if (miniSearch.documentCount === 0) {
            console.warn("Attempting to serialize an empty index. Skipping serialization.");
            return;
        }

        const serialized = JSON.stringify(miniSearch.toJSON());
        try {
            await vscode.workspace.fs.writeFile(minisearchIndexPath, Buffer.from(serialized, 'utf8'));
            console.log(`Serialized index with ${miniSearch.documentCount} documents`);
        } catch (error) {
            console.error('Error serializing index:', error);
            vscode.window.showErrorMessage('Failed to serialize index. Please try again.');
        }
    }, 5000); // Debounce for 5 seconds

    async function serializeIndex(miniSearch: MiniSearch) {
        statusBarHandler.setIndexingActive();
        debouncedSerializeIndex(miniSearch);
        statusBarHandler.setIndexingComplete();
    }

    async function loadSerializedIndex(): Promise<MiniSearch | null> {
        try {
            const data = await vscode.workspace.fs.readFile(minisearchIndexPath);
            const dataString = Buffer.from(data).toString('utf8');
            JSON.parse(dataString);
            const loadedIndex = MiniSearch.loadJSON(dataString, {
                fields: ['vref', 'book', 'chapter', 'content'],
                storeFields: ['id', 'vref', 'book', 'chapter', 'content', 'uri', 'line', 'docType']
            });
            console.log(`Loaded index with ${loadedIndex.documentCount} documents`);
            return loadedIndex;
        } catch (error) {
            console.error('Error loading serialized index:', error);
            try {
                await vscode.workspace.fs.delete(minisearchIndexPath);
                console.log('Corrupted index file deleted, a new index will be created');
            } catch (unlinkError) {
                console.error('Error deleting corrupted index file:', unlinkError);
            }
            return null;
        }
    }

    async function initializeIndexing() {
        const startTime = Date.now();
        try {
            const loadedIndex = await loadSerializedIndex();
            if (loadedIndex) {
                miniSearch = loadedIndex;
                const needsUpdate = await checkIfIndexNeedsUpdate();
                if (needsUpdate) {
                    await updateIndex();
                }
            } else {
                await rebuildFullIndex();
            }
        } catch (error) {
            console.error('Error during index initialization:', error);
            vscode.window.showErrorMessage('Failed to initialize indexing. Check the logs for details.');
        } finally {
            const endTime = Date.now();
            const duration = (endTime - startTime) / 1000;
            console.log(`Index initialized in ${duration.toFixed(2)} seconds`);
        }
    }

    function clearIndex() {
        miniSearch.removeAll();
        vscode.window.showInformationMessage('Index cleared');
    }
    async function rebuildFullIndex() {
        statusBarHandler.setIndexingActive();
        clearIndex();
        try {
            await indexAllDocuments();
            await serializeIndex(miniSearch);
        } catch (error) {
            console.error('Error rebuilding full index:', error);
            vscode.window.showErrorMessage('Failed to rebuild full index. Check the logs for details.');
        } finally {
            statusBarHandler.setIndexingComplete();
        }
    }

    async function updateIndex() {
        statusBarHandler.setIndexingActive();
        const manifest = await loadManifest();
        const currentTime = Date.now();
        await indexAllDocuments();
        const filesToUpdate = [
            ...await vscode.workspace.findFiles('**/*.bible'),
            ...await vscode.workspace.findFiles('**/*.codex')
        ];
        for (const file of filesToUpdate) {
            const stats = await vscode.workspace.fs.stat(file);
            manifest[file.fsPath] = stats.mtime;
        }
        manifest['lastFullReindex'] = currentTime;
        await saveManifest(manifest);
        await new Promise(resolve => setTimeout(resolve, 5000)); // Wait for debounce
        await serializeIndex(miniSearch);
        statusBarHandler.setIndexingComplete();
    }

    context.subscriptions.push(
        vscode.workspace.onDidChangeTextDocument(debouncedUpdateIndex),
        vscode.workspace.onDidOpenTextDocument(async (doc) => {
            if (doc.languageId === 'scripture' || doc.fileName.endsWith('.codex')) {
                await indexDocument(doc);
            }
        })
    );

    async function hasFileChanged(filePath: vscode.Uri): Promise<boolean> {
        try {
            if (filePath.scheme === 'vscode-notebook-cell') {
                return true;
            }

            const stat = await vscode.workspace.fs.stat(filePath);
            const lastModified = stat.mtime;
            const manifest = await loadManifest();
            return !manifest[filePath.fsPath] || lastModified > manifest[filePath.fsPath];
        } catch (error) {
            console.error(`Error checking if file ${filePath.fsPath} has changed:`, error);
            return true; // Assume the file has changed if there's an error
        }
    }

    initializeIndexing().catch(error => {
        console.error('Error initializing indexing:', error);
        vscode.window.showErrorMessage('Failed to initialize indexing.');
    });

    function searchTargetVersesByQuery(query: string, k: number = 5, fuzziness: number = 0) {
        return miniSearch.search(query, {
            fields: ['vref', 'content'],
            combineWith: 'AND',
            prefix: false,
            fuzzy: fuzziness,
            filter: (result) => result.id.includes('.codex')
        }).slice(0, k);
    }

    function searchSourceVersesByQuery(query: string, k: number = 5, fuzziness: number = 0) {
        return miniSearch.search(query, {
            fields: ['vref', 'content'],
            combineWith: 'AND',
            prefix: false,
            fuzzy: fuzziness,
            filter: (result) => result.id.includes('.bible')
        }).slice(0, k);
    }

    function getSourceVerseByVref(vref: string) {
        return miniSearch.search(vref, {
            fields: ['vref'],
            combineWith: 'OR',
            prefix: true,
            fuzzy: 0.2,
            boost: {
                vref: 2,
                content: 1
            },
            filter: (result) => result.id.includes('.bible') && result.id.includes(vref)
        })[0];
    }

    function getTargetVerseByVref(vref: string) {
        return miniSearch.search(vref, {
            fields: ['vref'],
            combineWith: 'OR',
            prefix: true,
            fuzzy: 0.2,
            boost: {
                vref: 2,
                content: 1
            },
            filter: (result) => result.id.includes('.codex') && result.id.includes(vref)
        })[0];
    }

    function getTranslationPairFromProject(vref: string): TranslationPair | null {
        const results = miniSearch.search(vref, {
            fields: ['vref'],
            combineWith: 'AND',
            filter: (result) => result.vref === vref
        });

        const sourceVerse = results.find(result => result.docType === 'source');
        const targetVerse = results.find(result => result.docType === 'target');

        if (sourceVerse && targetVerse) {
            return {
                vref,
                sourceVerse: sourceVerse as MiniSearchVerseResult,
                targetVerse: targetVerse as MiniSearchVerseResult
            };
        }
        return null;
    }

    function getTranslationPairsFromSourceVerseQuery(query: string) {
        // Get the source verses that are similar to the query
        const sourceResults = miniSearch.search(query, {
            fields: ['vref', 'content'],
            combineWith: 'AND',
            prefix: false,
            fuzzy: 0.5,
            filter: (result) => result.id.includes('.bible')
        });

        const translationPairs = sourceResults.slice(0, 5).map(sourceVerse => {
            const targetVerses = miniSearch.search(sourceVerse.vref, {
                fields: ['vref'],
                combineWith: 'AND',
                prefix: true,
                filter: (result) => result.id.includes('.codex') && result.content
            });

            // Find the target verse with an exact vref match
            const targetVerse = targetVerses.find(tv => tv.vref === sourceVerse.vref);

            return targetVerse ? { sourceVerse, targetVerse } : null;
        }).filter(pair => pair !== null);

        return translationPairs;
    }

    function processSearchResults(results: any[], query: string) {
        vscode.window.showInformationMessage(`Processing ${results.length} results for query: ${query}`);
    }

    function handleTextSelection(selectedText: string) {
        return searchTargetVersesByQuery(selectedText);
    }

    context.subscriptions.push(...[
        vscode.commands.registerCommand('translators-copilot.searchTargetVersesByQuery', async (query?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: 'Enter a query to search target verses',
                    placeHolder: 'e.g. love, faith, hope'
                });
                if (!query) return; // User cancelled the input
                showInfo = true;
            }
            const results = await searchTargetVersesByQuery(query);
            if (showInfo) {
                vscode.window.showInformationMessage(`Found ${results.length} results for query: ${query}`);
            }
            return results;
        }),
        vscode.commands.registerCommand('translators-copilot.searchSourceVersesByQuery', async (query?: string, showInfo: boolean = false) => {
            console.log('Executing searchSourceVersesByQuery with query:', query);
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: 'Enter a query to search source verses',
                    placeHolder: 'e.g. love, faith, hope'
                });
                if (!query) return; // User cancelled the input
                showInfo = true;
            }
            const results = await searchSourceVersesByQuery(query);
            if (showInfo && results.length > 0) {
                vscode.window.showInformationMessage(`Source verses for query: ${query}`);
            }
            return results;
        }),
        vscode.commands.registerCommand('translators-copilot.getSourceVerseByVref', async (vref?: string, showInfo: boolean = false) => {
            if (!vref) {
                vref = await vscode.window.showInputBox({
                    prompt: 'Enter a verse reference',
                    placeHolder: 'e.g. GEN 1:1'
                });
                if (!vref) return; // User cancelled the input
                showInfo = true;
            }
            const results = await getSourceVerseByVref(vref);
            if (showInfo && results.length > 0) {
                vscode.window.showInformationMessage(`Source verse for ${vref}: ${results[0].content}`);
            }
            return results;
        }),
        vscode.commands.registerCommand('translators-copilot.getTargetVerseByVref', async (vref?: string, showInfo: boolean = false) => {
            if (!vref) {
                vref = await vscode.window.showInputBox({
                    prompt: 'Enter a verse reference',
                    placeHolder: 'e.g. GEN 1:1'
                });
                if (!vref) return; // User cancelled the input
                showInfo = true;
            }
            const results = await getTargetVerseByVref(vref);
            if (showInfo && results.length > 0) {
                vscode.window.showInformationMessage(`Target verse for ${vref}: ${results[0].content}`);
            }
            return results;
        }),
        vscode.commands.registerCommand('translators-copilot.getTranslationPairFromProject', async (vref?: string, showInfo: boolean = false) => {
            if (!vref) {
                vref = await vscode.window.showInputBox({
                    prompt: 'Enter a verse reference',
                    placeHolder: 'e.g. GEN 1:1'
                });
                if (!vref) return; // User cancelled the input
                showInfo = true;
            }
            const result = await getTranslationPairFromProject(vref);
            if (showInfo) {
                if (result) {
                    vscode.window.showInformationMessage(`Translation pair for ${vref}: Source: ${result.sourceVerse.content}, Target: ${result.targetVerse.content}`);
                } else {
                    vscode.window.showInformationMessage(`No translation pair found for ${vref}`);
                }
            }
            return result;
        }),
        vscode.commands.registerCommand('translators-copilot.getTranslationPairsFromSourceVerseQuery', async (query?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: 'Enter a query to search for translation pairs',
                    placeHolder: 'e.g. love, faith, hope'
                });
                if (!query) return; // User cancelled the input
                showInfo = true;
            }
            const results = getTranslationPairsFromSourceVerseQuery(query);
            if (showInfo && results.length > 0) {
                vscode.window.showInformationMessage(`Found ${results.length} translation pairs for query: ${query}`);
            }
            return results;
        }),
        vscode.commands.registerCommand('translators-copilot.forceReindex', async () => {
            vscode.window.showInformationMessage('Force re-indexing started');
            await rebuildFullIndex();
            vscode.window.showInformationMessage('Force re-indexing completed');
        }),
        vscode.commands.registerCommand('translators-copilot.showIndexOptions', async () => {
            const option = await vscode.window.showQuickPick(['Force Reindex'], {
                placeHolder: 'Select an indexing option'
            });

            if (option === 'Force Reindex') {
                vscode.commands.executeCommand('translators-copilot.forceReindex');
            }
        })
    ]);

    const functionsToExpose = {
        handleTextSelection,
        searchTargetVersesByQuery,
        getSourceVerseByVref,
        getTargetVerseByVref
    };

    return functionsToExpose;
}