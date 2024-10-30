"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder, getWorkSpaceUri } from "../../../../utils";
import { StatusBarHandler } from "../statusBarHandler";
import { createTranslationPairsIndex } from "./translationPairsIndex";
import { createSourceTextIndex } from "./sourceTextIndex";
import {
    searchTargetCellsByQuery,
    getTranslationPairsFromSourceCellQuery,
    getSourceCellByCellIdFromAllSourceCells,
    getTargetCellByCellId,
    getTranslationPairFromProject,
    handleTextSelection,
    searchParallelCells,
} from "./search";
import MiniSearch, { SearchResult } from "minisearch";
import {
    createZeroDraftIndex,
    ZeroDraftIndexRecord,
    getContentOptionsForCellId,
    insertDraftsIntoTargetNotebooks,
    insertDraftsInCurrentEditor,
    CellWithMetadata,
} from "./zeroDraftIndex";
import { initializeWordsIndex, getWordFrequencies, getWordsAboveThreshold } from "./wordsIndex";
import { updateCompleteDrafts } from "../indexingUtils";
import { readSourceAndTargetFiles } from "./fileReaders";
import { debounce } from "lodash";
import { MinimalCellResult, TranslationPair } from "../../../../../types";
import { NotebookMetadataManager } from "../../../../utils/notebookMetadataManager";

type WordFrequencyMap = Map<string, number>;

async function isDocumentAlreadyOpen(uri: vscode.Uri): Promise<boolean> {
    const openTextDocuments = vscode.workspace.textDocuments;
    return openTextDocuments.some((doc) => doc.uri.toString() === uri.toString());
}

export async function createIndexWithContext(context: vscode.ExtensionContext) {
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.error("No workspace folder found. Aborting index creation.");
        return;
    }

    const statusBarHandler = StatusBarHandler.getInstance();
    context.subscriptions.push(statusBarHandler);

    const translationPairsIndex = new MiniSearch({
        fields: ["cellId", "document", "section", "sourceContent", "targetContent"],
        storeFields: [
            "id",
            "cellId",
            "document",
            "section",
            "sourceContent",
            "targetContent",
            "uri",
            "line",
        ],
        searchOptions: {
            boost: { cellId: 2 },
            fuzzy: 0.2,
        },
    });

    const sourceTextIndex = new MiniSearch({
        fields: ["content", "cellId"],
        storeFields: ["cellId", "content", "versions"],
        idField: "cellId",
    });

    const zeroDraftIndex = new MiniSearch<ZeroDraftIndexRecord>({
        fields: ["content", "cells"],
        storeFields: ["cellId", "content", "modelVersions", "cells"],
        idField: "cellId",
    });

    let wordsIndex: WordFrequencyMap = new Map<string, number>();

    const debouncedRebuildIndexes = debounce(rebuildIndexes, 3000, {
        leading: true,
        trailing: true,
    });

    // Debounced functions for individual indexes
    const debouncedUpdateTranslationPairsIndex = debounce(async (doc: vscode.TextDocument) => {
        if (!(await isDocumentAlreadyOpen(doc.uri))) {
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            await createTranslationPairsIndex(
                context,
                translationPairsIndex,
                sourceFiles,
                targetFiles,
                metadataManager
            );
        }
    }, 3000);

    const debouncedUpdateSourceTextIndex = debounce(async (doc: vscode.TextDocument) => {
        if (!(await isDocumentAlreadyOpen(doc.uri))) {
            const { sourceFiles } = await readSourceAndTargetFiles();
            await createSourceTextIndex(sourceTextIndex, sourceFiles, metadataManager);
        }
    }, 3000);

    const debouncedUpdateWordsIndex = debounce(async (doc: vscode.TextDocument) => {
        if (!(await isDocumentAlreadyOpen(doc.uri))) {
            const { targetFiles } = await readSourceAndTargetFiles();
            wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
        }
    }, 3000);

    const debouncedUpdateZeroDraftIndex = debounce(async (uri: vscode.Uri) => {
        if (!(await isDocumentAlreadyOpen(uri))) {
            await createZeroDraftIndex(zeroDraftIndex, zeroDraftIndex.documentCount === 0);
        }
    }, 3000);

    const metadataManager = new NotebookMetadataManager();
    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    async function rebuildIndexes(force: boolean = false) {
        statusBarHandler.setIndexingActive();
        try {
            if (force) {
                translationPairsIndex?.removeAll();
                sourceTextIndex?.removeAll();
                zeroDraftIndex?.removeAll();
                wordsIndex.clear();
            }

            // Read all source and target files once
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();

            // Rebuild indexes using the read data
            await createTranslationPairsIndex(
                context,
                translationPairsIndex,
                sourceFiles,
                targetFiles,
                metadataManager,
                force || translationPairsIndex.documentCount === 0
            );
            await createSourceTextIndex(
                sourceTextIndex,
                sourceFiles,
                metadataManager,
                force || sourceTextIndex.documentCount === 0
            );
            wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
            await createZeroDraftIndex(zeroDraftIndex, force || zeroDraftIndex.documentCount === 0);

            // Update complete drafts
            try {
                await updateCompleteDrafts(targetFiles);
            } catch (error) {
                console.error("Error updating complete drafts:", error);
                vscode.window.showWarningMessage(
                    "Failed to update complete drafts. Some drafts may be out of sync."
                );
            }

            // Update status bar with index counts
            statusBarHandler.updateIndexCounts(
                translationPairsIndex.documentCount,
                sourceTextIndex.documentCount
            );
        } catch (error) {
            console.error("Error rebuilding full index:", error);
            vscode.window.showErrorMessage(
                "Failed to rebuild full index. Check the logs for details."
            );
        }
        statusBarHandler.setIndexingComplete();
    }

    await rebuildIndexes();
    console.log("Zero Draft index contents:", zeroDraftIndex.documentCount);

    // Define individual command variables
    const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(async (document) => {
        if (document.fileName.endsWith(".codex")) {
            await debouncedRebuildIndexes();
        }
    });

    const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(async (event: any) => {
        const doc = event.document;
        if (doc.metadata?.type === "scripture" || doc.fileName.endsWith(".codex")) {
            debouncedUpdateTranslationPairsIndex(doc);
            debouncedUpdateSourceTextIndex(doc);
            debouncedUpdateWordsIndex(doc);
        }
    });

    const zeroDraftFolder = vscode.Uri.joinPath(workspaceUri || "", "files", "zero_drafts");
    const zeroDraftWatcher = vscode.workspace.createFileSystemWatcher(
        new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
    );
    zeroDraftWatcher.onDidChange(debouncedUpdateZeroDraftIndex);
    zeroDraftWatcher.onDidCreate(debouncedUpdateZeroDraftIndex);
    // FIXME: need to remove deleted docs
    // zeroDraftWatcher.onDidDelete(async (uri) => await removeFromIndex(uri, zeroDraftIndex));

    const searchTargetCellsByQueryCommand = vscode.commands.registerCommand(
        "translators-copilot.searchTargetCellsByQuery",
        async (query?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query to search target cells",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return; // User cancelled the input
                showInfo = true;
            }
            try {
                const results = await searchTargetCellsByQuery(translationPairsIndex, query);
                if (showInfo) {
                    const resultsString = results
                        .map((r: SearchResult) => `${r.id}: ${r.sourceContent || r.targetContent}`)
                        .join("\n");
                    vscode.window.showInformationMessage(
                        `Found ${results.length} results for query: ${query}\n${resultsString}`
                    );
                }
                return results;
            } catch (error) {
                console.error("Error searching target cells:", error);
                vscode.window.showErrorMessage(
                    "Failed to search target cells. Check the logs for details."
                );
                return [];
            }
        }
    );

    const getTranslationPairsFromSourceCellQueryCommand = vscode.commands.registerCommand(
        "translators-copilot.getTranslationPairsFromSourceCellQuery",
        async (query?: string, k: number = 10, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query to search source cells",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }
            const results = getTranslationPairsFromSourceCellQuery(translationPairsIndex, query, k);
            if (showInfo) {
                const resultsString = results
                    .map((r: TranslationPair) => `${r.cellId}: ${r.sourceCell.content}`)
                    .join("\n");
                vscode.window.showInformationMessage(
                    `Found ${results.length} results for query: ${query}\n${resultsString}`
                );
            }
            return results;
        }
    );

    const getSourceCellByCellIdFromAllSourceCellsCommand = vscode.commands.registerCommand(
        "translators-copilot.getSourceCellByCellIdFromAllSourceCells",
        async (cellId?: string, showInfo: boolean = false) => {
            if (!cellId) {
                cellId = await vscode.window.showInputBox({
                    prompt: "Enter a cell ID",
                    placeHolder: "e.g. GEN 1:1",
                });
                if (!cellId) return null; // User cancelled the input
                showInfo = true;
            }
            console.log(`Executing getSourceCellByCellIdFromAllSourceCells for cellId: ${cellId}`);
            const results = await getSourceCellByCellIdFromAllSourceCells(sourceTextIndex, cellId);
            console.log("getSourceCellByCellIdFromAllSourceCells results:", results);
            if (showInfo && results) {
                vscode.window.showInformationMessage(
                    `Source cell for ${cellId}: ${results.content}`
                );
            }
            return results;
        }
    );

    const getTargetCellByCellIdCommand = vscode.commands.registerCommand(
        "translators-copilot.getTargetCellByCellId",
        async (cellId?: string, showInfo: boolean = false) => {
            if (!cellId) {
                cellId = await vscode.window.showInputBox({
                    prompt: "Enter a cell ID",
                    placeHolder: "e.g. GEN 1:1",
                });
                if (!cellId) return; // User cancelled the input
                showInfo = true;
            }
            const results = await getTargetCellByCellId(translationPairsIndex, cellId);
            if (showInfo && results) {
                vscode.window.showInformationMessage(
                    `Target cell for ${cellId}: ${JSON.stringify(results)}`
                );
            }
            return results;
        }
    );

    const forceReindexCommand = vscode.commands.registerCommand(
        "translators-copilot.forceReindex",
        async () => {
            vscode.window.showInformationMessage("Force re-indexing started");
            await rebuildIndexes(true);
            vscode.window.showInformationMessage("Force re-indexing completed");
        }
    );

    const showIndexOptionsCommand = vscode.commands.registerCommand(
        "translators-copilot.showIndexOptions",
        async () => {
            const option = await vscode.window.showQuickPick(["Force Reindex"], {
                placeHolder: "Select an indexing option",
            });

            if (option === "Force Reindex") {
                await rebuildIndexes();
            }
        }
    );

    const getZeroDraftContentOptionsCommand = vscode.commands.registerCommand(
        "translators-copilot.getZeroDraftContentOptions",
        async (cellId?: string) => {
            if (!cellId) {
                cellId = await vscode.window.showInputBox({
                    prompt: "Enter a cell ID",
                    placeHolder: "e.g. GEN 1:1",
                });
                if (!cellId) return; // User cancelled the input
            }
            const contentOptions = getContentOptionsForCellId(zeroDraftIndex, cellId);
            if (contentOptions) {
                vscode.window.showInformationMessage(
                    `Found ${contentOptions?.cells?.length} content options for ${cellId}`,
                    {
                        detail: contentOptions?.cells
                            ?.map((cell: MinimalCellResult) => cell.content)
                            .join("\n"),
                    }
                );
                console.log("Content options for", cellId, { contentOptions });
            } else {
                vscode.window.showInformationMessage(`No content options found for ${cellId}`);
            }
            return contentOptions;
        }
    );

    const insertZeroDraftsIntoNotebooksCommand = vscode.commands.registerCommand(
        "translators-copilot.insertZeroDraftsIntoNotebooks",
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
                vscode.window.showErrorMessage("No workspace folder found");
                return;
            }

            const zeroDraftFolder = vscode.Uri.joinPath(
                workspaceFolders[0].uri,
                "files",
                "zero_drafts"
            );
            const zeroDraftFiles = await vscode.workspace.findFiles(
                new vscode.RelativePattern(zeroDraftFolder, "*.{jsonl,json,tsv,txt}")
            );

            const zeroDraftFileOptions = zeroDraftFiles.map((file) => ({
                label: vscode.workspace.asRelativePath(file),
                description: "Select a zero draft file to insert into notebooks",
                detail: file.fsPath,
            }));

            const selectedFile = await vscode.window.showQuickPick(zeroDraftFileOptions, {
                placeHolder: "Select a zero draft file to insert into notebooks",
            });

            let forceInsert: string | undefined;

            if (selectedFile) {
                forceInsert = await vscode.window.showQuickPick(["No", "Yes"], {
                    placeHolder: "Force insert and overwrite existing cell drafts?",
                });

                if (forceInsert === "Yes") {
                    const confirm = await vscode.window.showWarningMessage(
                        "This will overwrite existing cell drafts. Are you sure?",
                        { modal: true },
                        "Yes",
                        "No"
                    );
                    if (confirm !== "Yes") {
                        forceInsert = "No";
                    }
                }

                await insertDraftsIntoTargetNotebooks({
                    zeroDraftFilePath: selectedFile.detail,
                    forceInsert: forceInsert === "Yes",
                });
            }
        }
    );

    const insertZeroDraftsInCurrentEditorCommand = vscode.commands.registerCommand(
        "translators-copilot.insertZeroDraftsInCurrentEditor",
        async () => {
            const forceInsert = await vscode.window.showQuickPick(["No", "Yes"], {
                placeHolder: "Force insert and overwrite existing cell drafts?",
            });

            if (forceInsert === "Yes") {
                const confirm = await vscode.window.showWarningMessage(
                    "This will overwrite existing cell drafts in the current editor. Are you sure?",
                    { modal: true },
                    "Yes",
                    "No"
                );
                if (confirm !== "Yes") return;
            }

            await insertDraftsInCurrentEditor(zeroDraftIndex, forceInsert === "Yes");
        }
    );

    const getWordFrequenciesCommand = vscode.commands.registerCommand(
        "translators-copilot.getWordFrequencies",
        async (): Promise<Array<{ word: string; frequency: number }>> => {
            return getWordFrequencies(wordsIndex);
        }
    );

    const refreshWordIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.refreshWordIndex",
        async () => {
            const { targetFiles } = await readSourceAndTargetFiles();
            wordsIndex = await initializeWordsIndex(new Map(), targetFiles);
            console.log("Word index refreshed");
        }
    );

    const getWordsAboveThresholdCommand = vscode.commands.registerCommand(
        "translators-copilot.getWordsAboveThreshold",
        async () => {
            const config = vscode.workspace.getConfiguration("translators-copilot");
            const threshold = config.get<number>("wordFrequencyThreshold", 50);
            if (wordsIndex.size === 0) {
                const { targetFiles } = await readSourceAndTargetFiles();
                wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
            }
            const wordsAboveThreshold = await getWordsAboveThreshold(wordsIndex, threshold);
            console.log(`Words above threshold: ${wordsAboveThreshold}`);
            return wordsAboveThreshold;
        }
    );

    const searchParallelCellsCommand = vscode.commands.registerCommand(
        "translators-copilot.searchParallelCells",
        async (query?: string, k: number = 5, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query to search parallel cells",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }
            const results = searchParallelCells(translationPairsIndex, sourceTextIndex, query, k);

            // Remove duplicates based on cellId
            const uniqueResults = results.filter(
                (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
            );

            // If we have fewer unique results than requested, try to get more
            if (uniqueResults.length < k) {
                const additionalResults = searchParallelCells(
                    translationPairsIndex,
                    sourceTextIndex,
                    query,
                    k * 2
                );
                const allResults = [...uniqueResults, ...additionalResults];
                uniqueResults.splice(
                    0,
                    uniqueResults.length,
                    ...allResults
                        .filter((v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i)
                        .slice(0, k)
                );
            }

            if (showInfo) {
                const resultsString = uniqueResults
                    .map(
                        (r: TranslationPair) =>
                            `${r.cellId}: Source: ${r.sourceCell.content}, Target: ${r.targetCell.content}`
                    )
                    .join("\n");
                vscode.window.showInformationMessage(
                    `Found ${uniqueResults.length} unique parallel cells for query: ${query}\n${resultsString}`
                );
            }
            return uniqueResults;
        }
    );

    const getTranslationPairFromProjectCommand = vscode.commands.registerCommand(
        "translators-copilot.getTranslationPairFromProject",
        async (cellId?: string, showInfo: boolean = false) => {
            if (!cellId) {
                cellId = await vscode.window.showInputBox({
                    prompt: "Enter a cell ID",
                    placeHolder: "e.g. GEN 1:1",
                });
                if (!cellId) return; // User cancelled the input
                showInfo = true;
            }
            const result = await getTranslationPairFromProject(translationPairsIndex, cellId);
            if (showInfo) {
                if (result) {
                    vscode.window.showInformationMessage(
                        `Translation pair for ${cellId}: Source: ${result.sourceCell.content}, Target: ${result.targetCell.content}`
                    );
                } else {
                    vscode.window.showInformationMessage(`No translation pair found for ${cellId}`);
                }
            }
        }
    );

    // Update the subscriptions
    context.subscriptions.push(
        ...[
            onDidSaveTextDocument,
            onDidChangeTextDocument,
            zeroDraftWatcher,
            searchTargetCellsByQueryCommand,
            getTranslationPairsFromSourceCellQueryCommand,
            getSourceCellByCellIdFromAllSourceCellsCommand,
            getTargetCellByCellIdCommand,
            getTranslationPairFromProjectCommand,
            forceReindexCommand,
            showIndexOptionsCommand,
            getZeroDraftContentOptionsCommand,
            insertZeroDraftsIntoNotebooksCommand,
            insertZeroDraftsInCurrentEditorCommand,
            getWordFrequenciesCommand,
            refreshWordIndexCommand,
            getWordsAboveThresholdCommand,
            searchParallelCellsCommand,
        ]
    );

    const functionsToExpose = {
        handleTextSelection,
    };

    return functionsToExpose;
}
