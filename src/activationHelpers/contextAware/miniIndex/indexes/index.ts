"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder } from "../../../../utils";
import { StatusBarHandler } from '../statusBarHandler';
import { createTranslationPairsIndex } from "./translationPairsIndex";
import { createSourceBibleIndex } from "./sourceBibleIndex";
import { searchTargetVersesByQuery, getTranslationPairsFromSourceVerseQuery, getSourceVerseByVrefFromAllSourceVerses, getTargetVerseByVref, getTranslationPairFromProject, handleTextSelection, searchParallelVerses } from "./search";
import MiniSearch from "minisearch";
import { createZeroDraftIndex, ZeroDraftIndexRecord, getContentOptionsForVref, insertDraftsIntoTargetNotebooks, insertDraftsInCurrentEditor, VerseWithMetadata } from "./zeroDraftIndex";
import { initializeWordsIndex, getWordFrequencies, getWordsAboveThreshold, getWordFrequency } from "./wordsIndex";

type WordFrequencyMap = Map<string, number>;

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

    async function rebuildIndexes(force: boolean = false) {
        statusBarHandler.setIndexingActive();
        try {
            // Clean
            if (force) {
                translationPairsIndex?.removeAll();
                sourceBibleIndex?.removeAll();
                zeroDraftIndex?.removeAll();
                wordsIndex.clear();
            }
            // Rebuild
            await createTranslationPairsIndex(context, translationPairsIndex, force || translationPairsIndex.documentCount === 0);
            await createSourceBibleIndex(sourceBibleIndex, force || sourceBibleIndex.documentCount === 0);
            await createZeroDraftIndex(zeroDraftIndex, force || zeroDraftIndex.documentCount === 0);
            wordsIndex = await initializeWordsIndex(wordsIndex, workspaceFolder);
        } catch (error) {
            console.error('Error rebuilding full index:', error);
            vscode.window.showErrorMessage('Failed to rebuild full index. Check the logs for details.');
        }
        statusBarHandler.setIndexingComplete();
    }

    await rebuildIndexes();
    console.log('Zero Draft index contents:', zeroDraftIndex.documentCount);

    // Define individual command variables
    const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.fileName.endsWith('.codex')) {
            await rebuildIndexes();
        }
    });

    const searchTargetVersesByQueryCommand = vscode.commands.registerCommand('translators-copilot.searchTargetVersesByQuery', async (query?: string, showInfo: boolean = false) => {
        if (!query) {
            query = await vscode.window.showInputBox({
                prompt: 'Enter a query to search target verses',
                placeHolder: 'e.g. love, faith, hope'
            });
            if (!query) return; // User cancelled the input
            showInfo = true;
        }
        try {
            const results = await searchTargetVersesByQuery(translationPairsIndex, query);
            if (showInfo) {
                const resultsString = results.map(r => `${r.vref}: ${r.targetContent || 'undefined'}`).join('\n');
                vscode.window.showInformationMessage(`Found ${results.length} results for query: ${query}\n${resultsString}`);
            }
            return results;
        } catch (error) {
            console.error('Error searching target verses:', error);
            vscode.window.showErrorMessage('Failed to search target verses. Check the logs for details.');
            return [];
        }
    });

    const getTranslationPairsFromSourceVerseQueryCommand = vscode.commands.registerCommand('translators-copilot.getTranslationPairsFromSourceVerseQuery', async (query?: string, k: number = 10, showInfo: boolean = false) => {
        if (!query) {
            query = await vscode.window.showInputBox({
                prompt: 'Enter a query to search source verses',
                placeHolder: 'e.g. love, faith, hope'
            });
            if (!query) return []; // User cancelled the input
            showInfo = true;
        }
        const results = getTranslationPairsFromSourceVerseQuery(translationPairsIndex, query, k);
        if (showInfo) {
            const resultsString = results.map(r => `${r.vref}: ${r.sourceVerse.content}`).join('\n');
            vscode.window.showInformationMessage(`Found ${results.length} results for query: ${query}\n${resultsString}`);
        }
        return results;
    });

    const getSourceVerseByVrefFromAllSourceVersesCommand = vscode.commands.registerCommand('translators-copilot.getSourceVerseByVrefFromAllSourceVerses', async (vref?: string, showInfo: boolean = false) => {
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
    });

    const getTargetVerseByVrefCommand = vscode.commands.registerCommand('translators-copilot.getTargetVerseByVref', async (vref?: string, showInfo: boolean = false) => {
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
    });

    const forceReindexCommand = vscode.commands.registerCommand('translators-copilot.forceReindex', async () => {
        vscode.window.showInformationMessage('Force re-indexing started');
        await rebuildIndexes(true);
        vscode.window.showInformationMessage('Force re-indexing completed');
    });

    const showIndexOptionsCommand = vscode.commands.registerCommand('translators-copilot.showIndexOptions', async () => {
        const option = await vscode.window.showQuickPick(['Force Reindex'], {
            placeHolder: 'Select an indexing option'
        });

        if (option === 'Force Reindex') {
            await rebuildIndexes();
        }
    });

    const getZeroDraftContentOptionsCommand = vscode.commands.registerCommand('translators-copilot.getZeroDraftContentOptions', async (vref?: string) => {
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
    });

    const insertZeroDraftsIntoNotebooksCommand = vscode.commands.registerCommand('translators-copilot.insertZeroDraftsIntoNotebooks', async () => {
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
    });

    const insertZeroDraftsInCurrentEditorCommand = vscode.commands.registerCommand('translators-copilot.insertZeroDraftsInCurrentEditor', async () => {
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
    });

    const getWordFrequenciesCommand = vscode.commands.registerCommand('translators-copilot.getWordFrequencies', async (): Promise<Array<{ word: string, frequency: number }>> => {
        vscode.window.showInformationMessage(`Getting word frequencies`);
        return getWordFrequencies(wordsIndex);
    });

    const getWordsAboveThresholdCommand = vscode.commands.registerCommand('translators-copilot.getWordsAboveThreshold', async () => {
        const config = vscode.workspace.getConfiguration('translators-copilot');
        const threshold = config.get<number>('wordFrequencyThreshold', 50);
        if (wordsIndex.size === 0) {
            wordsIndex = await initializeWordsIndex(wordsIndex, workspaceFolder);
        }
        const wordsAboveThreshold = getWordsAboveThreshold(wordsIndex, threshold);
        vscode.window.showInformationMessage(`Words above threshold: ${wordsAboveThreshold}`);
        return wordsAboveThreshold;
    });

    const searchParallelVersesCommand = vscode.commands.registerCommand('translators-copilot.searchParallelVerses', async (query?: string, k: number = 5, showInfo: boolean = false) => {
        if (!query) {
            query = await vscode.window.showInputBox({
                prompt: 'Enter a query to search parallel verses',
                placeHolder: 'e.g. love, faith, hope'
            });
            if (!query) return []; // User cancelled the input
            showInfo = true;
        }
        const results = searchParallelVerses(translationPairsIndex, sourceBibleIndex, query, k);
        if (showInfo) {
            const resultsString = results.map(r => `${r.vref}: Source: ${r.sourceVerse.content}, Target: ${r.targetVerse.content}`).join('\n');
            vscode.window.showInformationMessage(`Found ${results.length} parallel verses for query: ${query}\n${resultsString}`);
        }
        return results;
    });

    const getTranslationPairFromProjectCommand = vscode.commands.registerCommand('translators-copilot.getTranslationPairFromProject', async (vref?: string, showInfo: boolean = false) => {
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
    });

    // Push commands to the context once the indexes are built
    context.subscriptions.push(
        ...[
            onDidSaveTextDocument,
            searchTargetVersesByQueryCommand,
            getTranslationPairsFromSourceVerseQueryCommand,
            getSourceVerseByVrefFromAllSourceVersesCommand,
            getTargetVerseByVrefCommand,
            getTranslationPairFromProjectCommand,
            forceReindexCommand,
            showIndexOptionsCommand,
            getZeroDraftContentOptionsCommand,
            insertZeroDraftsIntoNotebooksCommand,
            insertZeroDraftsInCurrentEditorCommand,
            getWordFrequenciesCommand,
            getWordsAboveThresholdCommand,
            searchParallelVersesCommand
        ]
    );




    const functionsToExpose = {
        handleTextSelection,
    };

    return functionsToExpose;
}