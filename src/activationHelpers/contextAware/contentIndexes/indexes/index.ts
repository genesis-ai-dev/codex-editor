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
import { updateSplashScreenTimings } from "../../../../providers/SplashScreen/register";

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

    // Keep real-time progress enabled during startup for splash screen feedback
    // indexManager.disableRealtimeProgress(); // Commented out to show progress during startup

    await indexManager.initialize(context);

    // Register the index manager globally for immediate access
    const { setSQLiteIndexManager } = await import("./sqliteIndexManager");
    setSQLiteIndexManager(indexManager);

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
            console.log(`[Index] Starting rebuild - force: ${force}, current document count: ${translationPairsIndex.documentCount}`);

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
                console.log("[Index] Force rebuild - clearing existing indexes...");
                await translationPairsIndex.removeAll();

                // Yield control to prevent blocking
                await new Promise(resolve => setImmediate(resolve));

                await sourceTextIndex.removeAll();
                wordsIndex.clear();
                filesIndex.clear();

                // Yield control again after clearing
                await new Promise(resolve => setImmediate(resolve));
            }

            // Read all source and target files once
            const readFilesStart = globalThis.performance.now();
            console.log("[Index] Reading source and target files...");
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
            const readFilesDuration = globalThis.performance.now() - readFilesStart;
            console.log(`[Index] Found ${sourceFiles.length} source files and ${targetFiles.length} target files`);

            // Track progress for splash screen
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                translationPairsIndex.addProgressEntry(
                    `Read ${sourceFiles.length + targetFiles.length} project files`,
                    readFilesDuration,
                    readFilesStart
                );
            }

            if (sourceFiles.length === 0 && targetFiles.length === 0) {
                console.warn("[Index] No source or target files found - cannot rebuild index");
                vscode.window.showWarningMessage("Codex: No source or target files found. Please ensure your project has .codex files.");
                statusBarHandler.setIndexingComplete();
                return;
            }

            // Rebuild indexes using the read data
            const translationPairsStart = globalThis.performance.now();
            console.log("[Index] Creating translation pairs index...");
            await createTranslationPairsIndex(
                context,
                translationPairsIndex,
                sourceFiles,
                targetFiles,
                metadataManager,
                force || translationPairsIndex.documentCount === 0
            );
            const translationPairsDuration = globalThis.performance.now() - translationPairsStart;

            // Track progress for splash screen
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                translationPairsIndex.addProgressEntry(
                    `Index ${translationPairsIndex.documentCount} translation pairs`,
                    translationPairsDuration,
                    translationPairsStart
                );
            }

            // Yield control after translation pairs indexing
            await new Promise(resolve => setImmediate(resolve));

            const sourceTextStart = globalThis.performance.now();
            console.log("[Index] Creating source text index...");
            await createSourceTextIndex(
                sourceTextIndex,
                sourceFiles,
                metadataManager,
                force || sourceTextIndex.documentCount === 0
            );
            const sourceTextDuration = globalThis.performance.now() - sourceTextStart;

            // Track progress for splash screen
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                translationPairsIndex.addProgressEntry(
                    `Index ${sourceTextIndex.documentCount} source texts`,
                    sourceTextDuration,
                    sourceTextStart
                );
            }

            // Yield control after source text indexing
            await new Promise(resolve => setImmediate(resolve));

            const wordsIndexStart = globalThis.performance.now();
            console.log("[Index] Initializing words index...");
            wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
            const wordsIndexDuration = globalThis.performance.now() - wordsIndexStart;

            // Track progress for splash screen
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                translationPairsIndex.addProgressEntry(
                    `Index ${wordsIndex.size} unique words`,
                    wordsIndexDuration,
                    wordsIndexStart
                );
            }

            const filesIndexStart = globalThis.performance.now();
            console.log("[Index] Initializing files index...");
            filesIndex = await initializeFilesIndex();
            const filesIndexDuration = globalThis.performance.now() - filesIndexStart;

            // Track progress for splash screen
            if (translationPairsIndex instanceof SQLiteIndexManager) {
                translationPairsIndex.addProgressEntry(
                    `Index ${filesIndex.size} file entries`,
                    filesIndexDuration,
                    filesIndexStart
                );
            }

            // Yield control after files indexing
            await new Promise(resolve => setImmediate(resolve));

            // Update complete drafts
            try {
                const completeDraftsStart = globalThis.performance.now();
                console.log("[Index] Updating complete drafts...");
                await updateCompleteDrafts(targetFiles);
                const completeDraftsDuration = globalThis.performance.now() - completeDraftsStart;

                // Track progress for splash screen
                if (translationPairsIndex instanceof SQLiteIndexManager) {
                    translationPairsIndex.addProgressEntry(
                        `Update complete drafts`,
                        completeDraftsDuration,
                        completeDraftsStart
                    );
                }
            } catch (error) {
                console.error("Error updating complete drafts:", error);
                vscode.window.showWarningMessage(
                    "Failed to update complete drafts. Some drafts may be out of sync."
                );
            }

            // Update status bar with index counts
            const finalDocCount = translationPairsIndex.documentCount;
            console.log(`[Index] Rebuild complete - indexed ${finalDocCount} documents`);

            statusBarHandler.updateIndexCounts(
                finalDocCount,
                sourceTextIndex.documentCount
            );

            if (finalDocCount === 0) {
                console.warn("[Index] Warning: No documents were indexed after rebuild");
                vscode.window.showWarningMessage("Codex: Index rebuild completed but no documents were indexed. Please check your .codex files.");
            }

        } catch (error) {
            console.error("Error rebuilding full index:", error);
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error("Full error details:", errorMessage);

            vscode.window.showErrorMessage(
                `Codex: Failed to rebuild search index. Error: ${errorMessage.substring(0, 100)}${errorMessage.length > 100 ? '...' : ''}`
            );

            // Re-throw the error so calling code can handle it
            throw error;
        } finally {
            statusBarHandler.setIndexingComplete();
        }
    }

    // Check if database was recreated during initialization (schema migration)
    // The SQLiteIndexManager handles schema migrations automatically during initialize()
    let databaseWasRecreated = false;
    if (translationPairsIndex instanceof SQLiteIndexManager) {
        // Check if the database is empty (indicating it was just recreated)
        const currentDocCount = translationPairsIndex.documentCount;
        if (currentDocCount === 0 && isIndexContextInitialized) {
            // Database was likely recreated due to schema migration
            databaseWasRecreated = true;
            console.log("[Index] Database appears to have been recreated during schema migration");
        }
    }

    // Check if we need to rebuild - only rebuild if database is empty or was recreated
    // Don't rebuild just because this is the first initialization - if database has documents, use them
    const currentDocCount = translationPairsIndex.documentCount;
    const needsRebuild = databaseWasRecreated || currentDocCount === 0;

    console.log(`[Index] Current document count: ${currentDocCount}, needs rebuild: ${needsRebuild}`);

    if (needsRebuild) {
        let rebuildReason = "empty database detected";
        if (databaseWasRecreated) {
            rebuildReason = "schema migration to clean format";
        }

        console.log(`[Index] Triggering rebuild due to: ${rebuildReason}`);

        if (databaseWasRecreated) {
            vscode.window.showInformationMessage("Codex: Rebuilding search index with new clean format...");
        } else if (currentDocCount === 0) {
            vscode.window.showInformationMessage("Codex: Building search index...");
        }

        // Make the rebuild process non-blocking to prevent extension host unresponsiveness
        setImmediate(async () => {
            try {
                await rebuildIndexes(true); // Always force rebuild when we determine it's needed

                const finalCount = translationPairsIndex.documentCount;
                console.log(`[Index] Rebuild completed with ${finalCount} documents`);

                if (databaseWasRecreated) {
                    vscode.window.showInformationMessage(`Codex: Search index upgraded successfully to new clean format! Indexed ${finalCount} documents.`);
                } else if (finalCount > 0) {
                    vscode.window.showInformationMessage(`Codex: Search index built successfully! Indexed ${finalCount} documents.`);
                } else {
                    vscode.window.showWarningMessage("Codex: Search index built but no documents were indexed. Please check your .codex files.");
                }
            } catch (error) {
                console.error("[Index] Error during rebuild:", error);
                const errorMessage = error instanceof Error ? error.message : String(error);
                vscode.window.showErrorMessage(`Codex: Failed to rebuild search index. Error: ${errorMessage.substring(0, 100)}${errorMessage.length > 100 ? '...' : ''}`);
            }
        });
    } else {
        // For subsequent calls, just update the status bar with current counts
        console.log(`[Index] Index already up to date with ${currentDocCount} documents, no rebuild needed`);
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

        // CRITICAL: Handle custom document changes (the missing piece from the background issue)
        // We'll register this listener with the CodexCellEditorProvider instead
        // since onDidChangeCustomDocument is a provider-level event, not workspace-level

        const searchTargetCellsByQueryCommand = vscode.commands.registerCommand(
            "codex-editor-extension.searchTargetCellsByQuery",
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
            "codex-editor-extension.getTranslationPairsFromSourceCellQuery",
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
            "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
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
            "codex-editor-extension.getTargetCellByCellId",
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
            "codex-editor-extension.forceReindex",
            async () => {
                vscode.window.showInformationMessage("Force re-indexing started");
                await rebuildIndexes(true);
                vscode.window.showInformationMessage("Force re-indexing completed");
            }
        );

        const showIndexOptionsCommand = vscode.commands.registerCommand(
            "codex-editor-extension.showIndexOptions",
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
            "codex-editor-extension.getWordFrequencies",
            async (): Promise<Array<{ word: string; frequency: number; }>> => {
                return getWordFrequencies(wordsIndex);
            }
        );

        const refreshWordIndexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.refreshWordIndex",
            async () => {
                const { targetFiles } = await readSourceAndTargetFiles();
                wordsIndex = await initializeWordsIndex(new Map(), targetFiles);
                console.log("Word index refreshed");
            }
        );

        const getWordsAboveThresholdCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getWordsAboveThreshold",
            async () => {
                const config = vscode.workspace.getConfiguration("codex-editor-extension");
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
            "codex-editor-extension.searchParallelCells",
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
            "codex-editor-extension.searchSimilarCellIds",
            async (cellId: string) => {
                return searchSimilarCellIds(translationPairsIndex, cellId);
            }
        );
        const getTranslationPairFromProjectCommand = vscode.commands.registerCommand(
            "codex-editor-extension.getTranslationPairFromProject",
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
            "codex-editor-extension.findNextUntranslatedSourceCell",
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
            "codex-editor-extension.searchAllCells",
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
            "codex-editor-extension.getFileStats",
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
            "codex-editor-extension.getFileInfo",
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
            "codex-editor-extension.verifyDataIntegrity",
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

        const deleteDatabaseAndReindexCommand = vscode.commands.registerCommand(
            "codex-editor-extension.deleteDatabaseAndReindex",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        await translationPairsIndex.deleteDatabaseAndTriggerReindex();
                    } else {
                        vscode.window.showErrorMessage("Database deletion only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error during database deletion:", error);
                    vscode.window.showErrorMessage("Failed to delete database. Check the logs for details.");
                }
            }
        );

        const forceCompleteRebuildCommand = vscode.commands.registerCommand(
            "codex-editor-extension.forceCompleteRebuild",
            async () => {
                try {
                    const choice = await vscode.window.showWarningMessage(
                        "This will completely rebuild the search index from scratch. This may take several minutes. Continue?",
                        { modal: true },
                        "Yes, Rebuild Index"
                    );

                    if (choice === "Yes, Rebuild Index") {
                        vscode.window.showInformationMessage("Codex: Starting complete index rebuild...");

                        // Force a complete rebuild
                        await rebuildIndexes(true);

                        const finalCount = translationPairsIndex.documentCount;
                        vscode.window.showInformationMessage(`Codex: Index rebuild completed! Indexed ${finalCount} documents.`);
                    }
                } catch (error) {
                    console.error("Error during complete rebuild:", error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Codex: Failed to rebuild index. Error: ${errorMessage.substring(0, 100)}${errorMessage.length > 100 ? '...' : ''}`);
                }
            }
        );

        const checkIndexStatusCommand = vscode.commands.registerCommand(
            "codex-editor-extension.checkIndexStatus",
            async () => {
                try {
                    const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();
                    const currentDocCount = translationPairsIndex.documentCount;

                    let statusMessage = `Index Status:\n`;
                    statusMessage += `• Documents in index: ${currentDocCount}\n`;
                    statusMessage += `• Source files found: ${sourceFiles.length}\n`;
                    statusMessage += `• Target files found: ${targetFiles.length}\n`;

                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const stats = await translationPairsIndex.getContentStats();
                        statusMessage += `• Total cells in database: ${stats.totalCells}\n`;
                        statusMessage += `• Cells with content: ${stats.totalCells - stats.cellsWithMissingContent}\n`;
                    }

                    const action = currentDocCount === 0 ? "Rebuild Index" : "View Details";
                    const choice = await vscode.window.showInformationMessage(statusMessage, action, "OK");

                    if (choice === "Rebuild Index") {
                        vscode.commands.executeCommand("codex-editor-extension.forceCompleteRebuild");
                    } else if (choice === "View Details") {
                        console.log("=== Index Status Details ===");
                        console.log(`Documents in index: ${currentDocCount}`);
                        console.log(`Source files: ${sourceFiles.length}`);
                        console.log(`Target files: ${targetFiles.length}`);
                        if (translationPairsIndex instanceof SQLiteIndexManager) {
                            const stats = await translationPairsIndex.getContentStats();
                            console.log("Database stats:", stats);
                        }
                    }
                } catch (error) {
                    console.error("Error checking index status:", error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    vscode.window.showErrorMessage(`Codex: Failed to check index status. Error: ${errorMessage}`);
                }
            }
        );

        const forceSchemaResetCommand = vscode.commands.registerCommand(
            "codex-editor-extension.forceSchemaReset",
            async () => {
                try {
                    if (translationPairsIndex instanceof SQLiteIndexManager) {
                        const choice = await vscode.window.showWarningMessage(
                            "This will reset the schema version to force migration on next restart. Continue?",
                            "Yes, Reset",
                            "Cancel"
                        );

                        if (choice === "Yes, Reset") {
                            // Reset schema version to force migration
                            await (translationPairsIndex as any).setSchemaVersion(2);
                            vscode.window.showInformationMessage("Schema version reset. Please reload the extension to trigger migration.");
                        }
                    } else {
                        vscode.window.showErrorMessage("Schema reset only available for SQLite index");
                    }
                } catch (error) {
                    console.error("Error resetting schema:", error);
                    vscode.window.showErrorMessage("Failed to reset schema. Check the logs for details.");
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
                deleteDatabaseAndReindexCommand,
                forceCompleteRebuildCommand,
                checkIndexStatusCommand,
                forceSchemaResetCommand,
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
