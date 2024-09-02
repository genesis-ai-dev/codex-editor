"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder, getWorkSpaceUri } from "../../../../utils";
import { StatusBarHandler } from '../statusBarHandler';
import { createTranslationPairsIndex } from "./translationPairsIndex";
import { createSourceBibleIndex } from "./sourceBibleIndex";
import { searchTargetVersesByQuery, getTranslationPairsFromSourceVerseQuery, getSourceVerseByVrefFromAllSourceVerses, getTargetVerseByVref, getTranslationPairFromProject, handleTextSelection } from "./search";
import MiniSearch from "minisearch";
import { createZeroDraftIndex, ZeroDraftIndexRecord, getContentOptionsForVref, insertDraftsIntoTargetNotebooks, insertDraftsInCurrentEditor, VerseWithMetadata } from "./zeroDraftIndex";
import { initializeWordsIndex, getWordFrequencies, getWordsAboveThreshold, getWordFrequency } from "./wordsIndex";

type WordFrequencyMap = Map<string, number>;

export interface IndexMetadata {
    lastIndexed: number;
    fileTimestamps: { [filePath: string]: number };
}

export interface Manifest {
    sourceBibleIndex: IndexMetadata;
    translationPairsIndex: IndexMetadata;
    zeroDraftIndex: IndexMetadata;
    wordsIndex: IndexMetadata;
}

export async function loadIndexMetadata(indexName?: string): Promise<IndexMetadata | null> {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        return null;
    }
    const metadataFilePath = vscode.Uri.joinPath(workspaceUri, '.project', `indicesManifest.json`);
    try {
        const document = await vscode.workspace.openTextDocument(metadataFilePath);
        const content = document.getText();
        const metadata = JSON.parse(content);
        if (!indexName) {
            return metadata;
        }
        if (!metadata[indexName]) {
            return null;
        }
        return metadata[indexName];
    } catch (error) {
        console.log('Error loading index metadata:', error);
        return null;
    }
}

async function openIndicesManifest(): Promise<Manifest | null> {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        return null;
    }
    const metadataFilePath = vscode.Uri.joinPath(workspaceUri, '.project', `indicesManifest.json`);
    const document = await vscode.workspace.openTextDocument(metadataFilePath);
    const content = document.getText();
    return JSON.parse(content) as Manifest;
}

export async function saveIndexMetadata(indexName: "sourceBibleIndex" | "translationPairsIndex" | "zeroDraftIndex" | "wordsIndex", metadata: IndexMetadata): Promise<void> {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        return;
    }
    const metadataFilePath = vscode.Uri.joinPath(workspaceUri, '.project', `indicesManifest.json`);
    try {
        const manifest = await openIndicesManifest();
        if (manifest) {
            manifest[indexName] = metadata;
        }
        const content = JSON.stringify(manifest, null, 2);
        const edit = new vscode.WorkspaceEdit();
        edit.createFile(metadataFilePath, { overwrite: true });
        edit.insert(metadataFilePath, new vscode.Position(0, 0), content);
        await vscode.workspace.applyEdit(edit);
    } catch (error) {
        console.error('Error saving index metadata:', error);
    }
}

export async function createIndexWithContext(context: vscode.ExtensionContext) {

    const workspaceFolder = getWorkSpaceFolder();
    const statusBarHandler = StatusBarHandler.getInstance();
    context.subscriptions.push(statusBarHandler);

    const config = vscode.workspace.getConfiguration('translators-copilot-server');
    const isCopilotEnabled = config.get<boolean>('enable', true);
    if (!isCopilotEnabled) {
        vscode.window.showInformationMessage("Translators Copilot Server is disabled. Language server not activated.");
        return;
    }
    vscode.window.showInformationMessage("Translators Copilot Server activated");

    const translationPairsIndex = new MiniSearch({
        fields: ['vref', 'book', 'chapter', 'sourceContent', 'targetContent'],
        storeFields: ['id', 'vref', 'book', 'chapter', 'sourceContent', 'targetContent', 'uri', 'line'],
        searchOptions: {
            boost: { vref: 2 },
            fuzzy: 0.2
        }
    });

    const sourceBibleIndex = new MiniSearch({
        fields: ['content'],
        storeFields: ['vref', 'content', 'versions'],
        idField: 'vref',
    });

    const zeroDraftIndex = new MiniSearch<ZeroDraftIndexRecord>({
        fields: ['content', 'verses'],
        storeFields: ['vref', 'content', 'modelVersions', 'verses'],
        idField: 'vref',
    });

    let wordsIndex: WordFrequencyMap = new Map<string, number>();

    async function rebuildIndexes() {
        statusBarHandler.setIndexingActive();
        try {
            // Clean
            translationPairsIndex?.removeAll();
            sourceBibleIndex?.removeAll();
            zeroDraftIndex?.removeAll();
            wordsIndex.clear();
            // Rebuild
            await createTranslationPairsIndex(context, translationPairsIndex, statusBarHandler);
            await createSourceBibleIndex(sourceBibleIndex, statusBarHandler);
            await createZeroDraftIndex(zeroDraftIndex, statusBarHandler);
            wordsIndex = await initializeWordsIndex(wordsIndex, workspaceFolder);
        } catch (error) {
            console.error('Error rebuilding full index:', error);
            vscode.window.showErrorMessage('Failed to rebuild full index. Check the logs for details.');
        } finally {
            statusBarHandler.setIndexingComplete();
        }
    }

    await rebuildIndexes();
    console.log('Zero Draft index contents:', zeroDraftIndex.documentCount);

    // Push commands to the context once the indexes are built
    context.subscriptions.push(
        ...[
            vscode.workspace.onDidSaveTextDocument(async (document) => {
                if (document.fileName.endsWith('.codex')) {
                    await rebuildIndexes();
                }
            }),
            vscode.commands.registerCommand('translators-copilot.searchTargetVersesByQuery', async (query?: string, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: 'Enter a query to search target verses',
                        placeHolder: 'e.g. love, faith, hope'
                    });
                    if (!query) return; // User cancelled the input
                    showInfo = true;
                }
                const results = await searchTargetVersesByQuery(translationPairsIndex, query);
                if (showInfo) {
                    vscode.window.showInformationMessage(`Found ${results.length} results for query: ${query}`);
                }
                return results;
            }),
            /** 
             * This `getTranslationPairsFromSourceVerseQuery` command uses the 
             * translation pair index to search for source verse. This ensures that 
             * the source verses are paired up with populated target verses.
             */
            vscode.commands.registerCommand('translators-copilot.getTranslationPairsFromSourceVerseQuery', async (query?: string, k: number = 10, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: 'Enter a query to search source verses',
                        placeHolder: 'e.g. love, faith, hope'
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }
                const results = getTranslationPairsFromSourceVerseQuery(translationPairsIndex, query, k);
                if (showInfo && results.length > 0) {
                    vscode.window.showInformationMessage(`Source verses for query: ${query}`);
                }
                return results;
            }),
            /**
             * This `getSourceVerseByVrefFromAllSourceVerses` command uses the source bible index to get a 
             * source verse by verse reference. We need to use this index because the current
             * verse being 'autocompleted' is probably not populated in the translation pairs
             * index, because it hasn't been translated yet.
             */
            vscode.commands.registerCommand('translators-copilot.getSourceVerseByVrefFromAllSourceVerses', async (vref?: string, showInfo: boolean = false) => {
                if (!vref) {
                    vref = await vscode.window.showInputBox({
                        prompt: 'Enter a verse reference',
                        placeHolder: 'e.g. GEN 1:1'
                    });
                    if (!vref) return; // User cancelled the input
                    showInfo = true;
                }
                const results = await getSourceVerseByVrefFromAllSourceVerses(sourceBibleIndex, vref);
                if (showInfo && results) {
                    vscode.window.showInformationMessage(`Source verse for ${vref}: ${results.content}`);
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
                const results = await getTargetVerseByVref(translationPairsIndex, vref);
                if (showInfo && results) {
                    vscode.window.showInformationMessage(`Target verse for ${vref}: ${results.targetContent}`);
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
                const result = await getTranslationPairFromProject(translationPairsIndex, vref);
                if (showInfo) {
                    if (result) {
                        vscode.window.showInformationMessage(`Translation pair for ${vref}: Source: ${result.sourceVerse.content}, Target: ${result.targetVerse.content}`);
                    } else {
                        vscode.window.showInformationMessage(`No translation pair found for ${vref}`);
                    }
                }
                return result;
            }),
            vscode.commands.registerCommand('translators-copilot.forceReindex', async () => {
                vscode.window.showInformationMessage('Force re-indexing started');
                await rebuildIndexes();
                vscode.window.showInformationMessage('Force re-indexing completed');
            }),
            vscode.commands.registerCommand('translators-copilot.showIndexOptions', async () => {
                const option = await vscode.window.showQuickPick(['Force Reindex'], {
                    placeHolder: 'Select an indexing option'
                });

                if (option === 'Force Reindex') {
                    await rebuildIndexes();
                }
            }),
            vscode.commands.registerCommand('translators-copilot.getZeroDraftContentOptions', async (vref?: string) => {
                if (!vref) {
                    vref = await vscode.window.showInputBox({
                        prompt: 'Enter a verse reference',
                        placeHolder: 'e.g. GEN 1:1'
                    });
                    if (!vref) return; // User cancelled the input
                }
                const contentOptions = getContentOptionsForVref(zeroDraftIndex, vref);
                if (contentOptions) {
                    vscode.window.showInformationMessage(`Found ${contentOptions?.verses?.length} content options for ${vref}`,
                        { detail: contentOptions?.verses?.map(verse => verse.content).join('\n') }
                    );
                    console.log('Content options for', vref, { contentOptions });
                } else {
                    vscode.window.showInformationMessage(`No content options found for ${vref}`);
                }
                return contentOptions;
            }),

            vscode.commands.registerCommand('translators-copilot.insertZeroDraftsIntoNotebooks', async () => {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders) {
                    vscode.window.showErrorMessage('No workspace folder found');
                    return;
                }

                const zeroDraftFolder = vscode.Uri.joinPath(workspaceFolders[0].uri, 'files', 'zero_drafts');
                const zeroDraftFiles = await vscode.workspace.findFiles(new vscode.RelativePattern(zeroDraftFolder, '*.{jsonl,json,tsv,txt}'));

                const zeroDraftFileOptions = zeroDraftFiles.map(file => ({
                    label: file.fsPath.split('/').pop() || '',
                    description: 'Select a zero draft file to insert into notebooks',
                    detail: file.path
                }));

                const selectedFile = await vscode.window.showQuickPick(
                    zeroDraftFileOptions,
                    { placeHolder: 'Select a zero draft file to insert into notebooks' }
                );

                let forceInsert: string | undefined;

                if (selectedFile) {
                    forceInsert = await vscode.window.showQuickPick(
                        ['No', 'Yes'],
                        { placeHolder: 'Force insert and overwrite existing verse drafts?' }
                    );

                    if (forceInsert === 'Yes') {
                        const confirm = await vscode.window.showWarningMessage(
                            'This will overwrite existing verse drafts. Are you sure?',
                            { modal: true },
                            'Yes', 'No'
                        );
                        if (confirm !== 'Yes') {
                            forceInsert = 'No';
                        }
                    }

                    await insertDraftsIntoTargetNotebooks({
                        zeroDraftFilePath: selectedFile.detail,
                        forceInsert: forceInsert === 'Yes'
                    });
                }
            }),

            vscode.commands.registerCommand('translators-copilot.insertZeroDraftsInCurrentEditor', async () => {
                const forceInsert = await vscode.window.showQuickPick(
                    ['No', 'Yes'],
                    { placeHolder: 'Force insert and overwrite existing verse drafts?' }
                );

                if (forceInsert === 'Yes') {
                    const confirm = await vscode.window.showWarningMessage(
                        'This will overwrite existing verse drafts in the current editor. Are you sure?',
                        { modal: true },
                        'Yes', 'No'
                    );
                    if (confirm !== 'Yes') return;
                }

                await insertDraftsInCurrentEditor(zeroDraftIndex, forceInsert === 'Yes');
            }),
            // get word frequencies
            vscode.commands.registerCommand('translators-copilot.getWordFrequencies', async (): Promise<Array<{ word: string, frequency: number }>> => {
                vscode.window.showInformationMessage(`Getting word frequencies`);
                return getWordFrequencies(wordsIndex);
            }),
            vscode.commands.registerCommand('translators-copilot.getWordsAboveThreshold', async () => {
                const config = vscode.workspace.getConfiguration('translators-copilot');
                const threshold = config.get<number>('wordFrequencyThreshold', 50);
                const wordsAboveThreshold = getWordsAboveThreshold(wordsIndex, threshold);
                vscode.window.showInformationMessage(`Words above threshold: ${wordsAboveThreshold}`);
                return wordsAboveThreshold;
            })
        ]);

    const functionsToExpose = {
        handleTextSelection,
    };

    return functionsToExpose;
}