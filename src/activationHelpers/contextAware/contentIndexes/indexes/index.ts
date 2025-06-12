"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder, getWorkSpaceUri } from "../../../../utils";
import { IndexingStatusBarHandler } from "../statusBarHandler";
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
    searchSimilarCellIds,
    findNextUntranslatedSourceCell,
    searchAllCells,
    searchTranslationPairs,
} from "./search";
import { SQLiteIndexManager } from "./sqliteIndex";

import {
    initializeWordsIndex,
    getWordFrequencies,
    getWordsAboveThreshold,
    WordOccurrence,
} from "./wordsIndex";
import { initializeFilesIndex, getFilePairs, getWordCountStats, FileInfo } from "./filesIndex";
import { updateCompleteDrafts } from "../indexingUtils";
import { readSourceAndTargetFiles } from "./fileReaders";
import { debounce } from "lodash";
import { MinimalCellResult, TranslationPair } from "../../../../../types";
import { getNotebookMetadataManager } from "../../../../utils/notebookMetadataManager";

type WordFrequencyMap = Map<string, WordOccurrence[]>;

async function isDocumentAlreadyOpen(uri: vscode.Uri): Promise<boolean> {
    const openTextDocuments = vscode.workspace.textDocuments;
    return openTextDocuments.some((doc) => doc.uri.toString() === uri.toString());
}

// Track if the index context has been initialized to prevent duplicate command registrations
let isIndexContextInitialized = false;

export async function createIndexWithContext(context: vscode.ExtensionContext) {
    const metadataManager = getNotebookMetadataManager();
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.error("No workspace folder found. Aborting index creation.");
        return;
    }

    const statusBarHandler = IndexingStatusBarHandler.getInstance();

    // Only register status bar handler once
    if (!isIndexContextInitialized) {
        context.subscriptions.push(statusBarHandler);
    }

    // Initialize SQLite index manager
    const indexManager = new SQLiteIndexManager();
    await indexManager.initialize(context);

    // Create separate instances for translation pairs and source text
    // These will use the same underlying database but provide different interfaces
    const translationPairsIndex = indexManager;
    const sourceTextIndex = indexManager;

    let wordsIndex: WordFrequencyMap = new Map<string, WordOccurrence[]>();
    let filesIndex: Map<string, FileInfo> = new Map<string, FileInfo>();

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

    const debouncedUpdateFilesIndex = debounce(async (doc: vscode.TextDocument) => {
        if (!(await isDocumentAlreadyOpen(doc.uri))) {
            filesIndex = await initializeFilesIndex();
        }
    }, 3000);

    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    async function rebuildIndexes(force: boolean = false) {
        statusBarHandler.setIndexingActive();
        try {
            // Check if we need to rebuild - skip if indexes already have content
            if (!force && translationPairsIndex.documentCount > 0) {
                console.log(
                    `Indexes already populated with ${translationPairsIndex.documentCount} documents, skipping rebuild`
                );
                statusBarHandler.updateIndexCounts(
                    translationPairsIndex.documentCount,
                    sourceTextIndex.documentCount
                );
                statusBarHandler.setIndexingComplete();
                return;
            }

            if (force) {
                await translationPairsIndex.removeAll();
                await sourceTextIndex.removeAll();
                wordsIndex.clear();
                filesIndex.clear();
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
            filesIndex = await initializeFilesIndex();


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

    // Only rebuild indexes on first initialization
    if (!isIndexContextInitialized) {
        await rebuildIndexes();
    } else {
        // For subsequent calls, just update the status bar with current counts
        console.log("Index context already initialized, skipping full rebuild");
        statusBarHandler.updateIndexCounts(
            translationPairsIndex.documentCount,
            sourceTextIndex.documentCount
        );
    }

    // Only register commands and event listeners once
    if (!isIndexContextInitialized) {
        // Define individual command variables
        const onDidSaveTextDocument = vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.fileName.endsWith(".codex")) {
                await debouncedRebuildIndexes();
            }
        });

        const onDidChangeTextDocument = vscode.workspace.onDidChangeTextDocument(
            async (event: any) => {
                const doc = event.document;
                if (doc.metadata?.type === "scripture" || doc.fileName.endsWith(".codex")) {
                    debouncedUpdateTranslationPairsIndex(doc);
                    debouncedUpdateSourceTextIndex(doc);
                    debouncedUpdateWordsIndex(doc);
                    debouncedUpdateFilesIndex(doc);
                }
            }
        );

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
                            .map((r: any) => `${r.id}: ${r.sourceContent || r.targetContent}`)
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
                const results = getTranslationPairsFromSourceCellQuery(
                    translationPairsIndex,
                    query,
                    k
                );
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
                console.log(
                    `Executing getSourceCellByCellIdFromAllSourceCells for cellId: ${cellId}`
                );
                const results = await getSourceCellByCellIdFromAllSourceCells(
                    sourceTextIndex,
                    cellId
                );
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

        const getWordFrequenciesCommand = vscode.commands.registerCommand(
            "translators-copilot.getWordFrequencies",
            async (): Promise<Array<{ word: string; frequency: number; }>> => {
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
            async (query?: string, k: number = 15, showInfo: boolean = false, options?: any) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search parallel cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }

                // Search translation pairs with boosted weights for complete pairs and target content
                const results = searchAllCells(
                    translationPairsIndex,
                    sourceTextIndex,
                    query,
                    k,
                    false,
                    options // Pass through options including isParallelPassagesWebview
                );

                // Remove duplicates based on cellId
                const uniqueResults = results.filter(
                    (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
                );

                // If we have fewer unique results than requested, try to get more
                if (uniqueResults.length < k) {
                    const additionalResults = searchTranslationPairs(
                        translationPairsIndex,
                        query,
                        false, // includeIncomplete set to false
                        k * 2,
                        { completeBoost: 1.5, targetContentBoost: 1.2, ...options }
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
        const searchSimilarCellIdsCommand = vscode.commands.registerCommand(
            "translators-copilot.searchSimilarCellIds",
            async (cellId: string) => {
                return searchSimilarCellIds(translationPairsIndex, cellId);
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
                const result = await getTranslationPairFromProject(
                    translationPairsIndex,
                    sourceTextIndex,
                    cellId
                );
                if (showInfo) {
                    if (result) {
                        vscode.window.showInformationMessage(
                            `Translation pair for ${cellId}: Source: ${result.sourceCell.content}, Target: ${result.targetCell.content}`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            `No translation pair found for ${cellId}`
                        );
                    }
                }
                return result;
            }
        );

        const findNextUntranslatedSourceCellCommand = vscode.commands.registerCommand(
            "translators-copilot.findNextUntranslatedSourceCell",
            async (query?: string, cellId?: string, showInfo: boolean = false) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search for the next untranslated source cell",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return null; // User cancelled the input
                    showInfo = true;
                }
                if (!cellId) {
                    cellId = await vscode.window.showInputBox({
                        prompt: "Enter the current cell ID to exclude from results",
                        placeHolder: "e.g. GEN 1:1",
                    });
                    if (!cellId) return null; // User cancelled the input
                }
                const result = await findNextUntranslatedSourceCell(
                    sourceTextIndex,
                    translationPairsIndex,
                    query,
                    cellId
                );
                if (showInfo) {
                    if (result) {
                        vscode.window.showInformationMessage(
                            `Next untranslated source cell: ${result.cellId}\nContent: ${result.content}`
                        );
                    } else {
                        vscode.window.showInformationMessage(
                            "No untranslated source cell found matching the query."
                        );
                    }
                }
                return result;
            }
        );

        const searchAllCellsCommand = vscode.commands.registerCommand(
            "translators-copilot.searchAllCells",
            async (
                query?: string,
                k: number = 15,
                includeIncomplete: boolean = true,
                showInfo: boolean = false,
                options?: any
            ) => {
                if (!query) {
                    query = await vscode.window.showInputBox({
                        prompt: "Enter a query to search all cells",
                        placeHolder: "e.g. love, faith, hope",
                    });
                    if (!query) return []; // User cancelled the input
                    showInfo = true;
                }
                const results = searchAllCells(
                    translationPairsIndex,
                    sourceTextIndex,
                    query,
                    k,
                    includeIncomplete,
                    options // Pass through options including isParallelPassagesWebview
                );

                console.log(`Search results for "${query}":`, results);

                if (showInfo) {
                    const resultsString = results
                        .map((r) => {
                            const targetContent = r.targetCell.content || "(No target text)";
                            return `${r.cellId}: Source: ${r.sourceCell.content}, Target: ${targetContent}`;
                        })
                        .join("\n");
                    vscode.window.showInformationMessage(
                        `Found ${results.length} cells for query: ${query}\n${resultsString}`
                    );
                }
                return results;
            }
        );

        // Add command to get file stats
        const getFileStatsCommand = vscode.commands.registerCommand(
            "translators-copilot.getFileStats",
            async () => {
                try {
                    const stats = getWordCountStats(filesIndex);
                    const message = `File Stats:\n- Total Files: ${stats.totalFiles}\n- Total Source Words: ${stats.totalSourceWords}\n- Total Codex Words: ${stats.totalCodexWords}`;
                    vscode.window.showInformationMessage(message);
                    return stats;
                } catch (error) {
                    console.error("Error getting file stats:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get file stats. Check the logs for details."
                    );
                    return null;
                }
            }
        );

        // Add command to get detailed file info
        const getFileInfoCommand = vscode.commands.registerCommand(
            "translators-copilot.getFileInfo",
            async () => {
                try {
                    const filePairs = getFilePairs(filesIndex);

                    // Create QuickPick items for each file pair
                    const items = filePairs.map((filePair) => ({
                        label: filePair.codexFile.fileName,
                        description: `Source: ${filePair.sourceFile.fileName}`,
                        detail: `Cells: ${filePair.codexFile.totalCells} | Words: ${filePair.codexFile.totalWords}`,
                        fileId: filePair.codexFile.id,
                    }));

                    // Show QuickPick to select a file
                    const selection = await vscode.window.showQuickPick(items, {
                        placeHolder: "Select a file to view details",
                        matchOnDescription: true,
                        matchOnDetail: true,
                    });

                    if (!selection) return null; // User cancelled

                    // Get the selected file info
                    const fileInfo = filesIndex.get(selection.fileId);
                    if (!fileInfo) return null;

                    // Create a virtual document to display the file info
                    const panel = vscode.window.createWebviewPanel(
                        "fileInfo",
                        `File Info: ${fileInfo.codexFile.fileName}`,
                        vscode.ViewColumn.One,
                        {}
                    );

                    // Generate HTML content
                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .file-info { margin-bottom: 20px; }
                                .cell { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; }
                                .cell-header { font-weight: bold; margin-bottom: 5px; }
                                .cell-content { white-space: pre-wrap; }
                                .stats { color: #666; }
                            </style>
                        </head>
                        <body>
                            <h1>File Information</h1>
                            
                            <div class="file-info">
                                <h2>Codex File</h2>
                                <p>Name: ${fileInfo.codexFile.fileName}</p>
                                <p>ID: ${fileInfo.codexFile.id}</p>
                                <p>Total Cells: ${fileInfo.codexFile.totalCells}</p>
                                <p>Total Words: ${fileInfo.codexFile.totalWords}</p>
                            </div>
                            
                            <div class="file-info">
                                <h2>Source File</h2>
                                <p>Name: ${fileInfo.sourceFile.fileName}</p>
                                <p>ID: ${fileInfo.sourceFile.id}</p>
                                <p>Total Cells: ${fileInfo.sourceFile.totalCells}</p>
                                <p>Total Words: ${fileInfo.sourceFile.totalWords}</p>
                            </div>
                            
                            <h2>Cells</h2>
                            <div>
                                ${fileInfo.codexFile.cells
                            .map(
                                (cell, index) => `
                                    <div class="cell">
                                        <div class="cell-header">Cell ${index + 1} - ID: ${cell.id || "N/A"} - Type: ${cell.type || "N/A"}</div>
                                        <div class="stats">Word Count: ${cell.wordCount}</div>
                                        <div class="cell-content">${cell.value}</div>
                                    </div>
                                `
                            )
                            .join("")}
                            </div>
                        </body>
                        </html>
                    `;

                    return fileInfo;
                } catch (error) {
                    console.error("Error getting file info:", error);
                    vscode.window.showErrorMessage(
                        "Failed to get file info. Check the logs for details."
                    );
                    return null;
                }
            }
        );

        const verifyDataIntegrityCommand = vscode.commands.registerCommand(
            "translators-copilot.verifyDataIntegrity",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const integrityResult = await translationPairsIndex.verifyDataIntegrity();
                        const stats = await translationPairsIndex.getContentStats();

                        let message = `Data Integrity Check:\n`;
                        message += `Total cells: ${integrityResult.totalCells}\n`;
                        message += `Cells with missing content: ${stats.cellsWithMissingContent}\n`;
                        message += `Cells with missing raw_content: ${stats.cellsWithMissingRawContent}\n`;
                        message += `Cells with different content: ${stats.cellsWithDifferentContent}\n`;
                        message += `Status: ${integrityResult.isValid ? '✅ VALID' : '❌ ISSUES FOUND'}\n`;

                        if (!integrityResult.isValid) {
                            message += `\nIssues found:\n${integrityResult.issues.slice(0, 10).join('\n')}`;
                            if (integrityResult.issues.length > 10) {
                                message += `\n... and ${integrityResult.issues.length - 10} more issues`;
                            }
                        }

                        const action = integrityResult.isValid ? "View Stats" : "View Issues";
                        const choice = await vscode.window.showInformationMessage(message, action, "OK");

                        if (choice === action) {
                            console.log('Full integrity check results:', integrityResult);
                            console.log('Full content stats:', stats);
                        }
                    } else {
                        vscode.window.showErrorMessage("Data integrity check only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error verifying data integrity:", error);
                    vscode.window.showErrorMessage("Failed to verify data integrity");
                }
            }
        );

        // Make sure to close the database when extension deactivates
        context.subscriptions.push({
            dispose: async () => {
                await indexManager.close();
            },
        });

        // Update the subscriptions
        context.subscriptions.push(
            ...[
                onDidSaveTextDocument,
                onDidChangeTextDocument,
                searchTargetCellsByQueryCommand,
                getTranslationPairsFromSourceCellQueryCommand,
                getSourceCellByCellIdFromAllSourceCellsCommand,
                getTargetCellByCellIdCommand,
                getTranslationPairFromProjectCommand,
                forceReindexCommand,
                showIndexOptionsCommand,
                getWordFrequenciesCommand,
                refreshWordIndexCommand,
                getWordsAboveThresholdCommand,
                searchParallelCellsCommand,
                searchSimilarCellIdsCommand,
                findNextUntranslatedSourceCellCommand,
                searchAllCellsCommand,
                getFileStatsCommand,
                getFileInfoCommand,
                verifyDataIntegrityCommand,
            ]
        );

        // Mark as initialized to prevent duplicate registrations
        isIndexContextInitialized = true;
    }

    const functionsToExpose = {
        handleTextSelection,
        searchAllCells,
        searchParallelCells,
        searchTranslationPairs,
    };

    return functionsToExpose;
}
