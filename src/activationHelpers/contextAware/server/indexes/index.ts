"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder } from "../../../../utils";
import { StatusBarHandler } from '../statusBarHandler';
import { TranslationPair, SourceVerseVersions } from "../../../../../types";
import { createTranslationPairsIndex } from "./translationPairsIndex";
import { createSourceBibleIndex } from "./sourceBibleIndex";
import { searchTargetVersesByQuery, getTranslationPairsFromSourceVerseQuery, getSourceVerseByVrefFromAllSourceVerses, getTargetVerseByVref, getTranslationPairFromProject, handleTextSelection } from "./search";
import MiniSearch from "minisearch";

const workspaceFolder = getWorkSpaceFolder();

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

    const minisearchIndexPath = vscode.Uri.file(
        `${workspaceFolder}/.vscode/minisearch_index.json`
    );

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

    async function rebuildIndexes() {
        statusBarHandler.setIndexingActive();
        try {
            // Clean
            translationPairsIndex?.removeAll();
            sourceBibleIndex?.removeAll();

            // Rebuild
            await createTranslationPairsIndex(context, translationPairsIndex, workspaceFolder, statusBarHandler);
            await createSourceBibleIndex(sourceBibleIndex, statusBarHandler);
        } catch (error) {
            console.error('Error rebuilding full index:', error);
            vscode.window.showErrorMessage('Failed to rebuild full index. Check the logs for details.');
        } finally {
            statusBarHandler.setIndexingComplete();
        }
    }

    await rebuildIndexes();

    // Push commands to the context once the indexes are built
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
        })
    ]);

    const functionsToExpose = {
        handleTextSelection,
    };

    return functionsToExpose;
}