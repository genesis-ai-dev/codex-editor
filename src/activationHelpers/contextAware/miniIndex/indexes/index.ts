"use strict";
import * as vscode from "vscode";
import { getWorkSpaceFolder, getWorkSpaceUri } from "../../../../utils";
import { IndexingStatusBarHandler } from "../statusBarHandler";
// MiniSearch index creation imports removed - SQLite is now used directly
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
    getAllUntranslatedCells,
    getUntranslatedCellsByBook,
    getTranslationProgressSummary,
} from "./search";
// MiniSearch import removed - SQLite is now used directly
import {
    ZeroDraftIndexRecord,
    getContentOptionsForCellId,
    insertDraftsIntoTargetNotebooks,
    insertDraftsInCurrentEditor,
    CellWithMetadata,
} from "./zeroDraftIndex";
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
import {
    registerFileStatsWebviewProvider,
    updateFileStatsWebview,
} from "../../../../providers/fileStats/register";
import { Database } from "sql.js-fts5";
import {
    initializeTranslationPairsDb,
    createTranslationPairsIndex as createSqliteTranslationPairsIndex,
    saveTranslationPairsDb
} from "../../../../sqldb/translationPairsDb";
import {
    initializeIncrementalIndexingDb,
    saveIncrementalIndexingDb
} from "../../../../sqldb/incrementalIndexingDb";
// Incremental indexing wrapper removed - using SQLite directly
import {
    initializeSourceTextDb,
    createSourceTextIndex as createSqliteSourceTextIndex,
    saveSourceTextDb
} from "../../../../sqldb/sourceTextDb";
import {
    initializeZeroDraftDb,
    createZeroDraftIndex as createSqliteZeroDraftIndex,
    saveZeroDraftDb
} from "../../../../sqldb/zeroDraftDb";
import {
    initializeVerseRefDb,
    indexVerseRefsInSourceText as createSqliteVerseRefIndex,
    saveVerseRefDb
} from "../../../../sqldb/verseRefDb";
import {
    initializeDynamicTableDb,
    createDynamicTableIndex as createSqliteDynamicTableIndex,
    saveDynamicTableDb
} from "../../../../sqldb/dynamicTableDb";
import {
    initializeFuzzySearchDb,
    saveFuzzySearchDb
} from "../../../../sqldb/fuzzySearchDb";
import {
    initializePrefixMatchingDb,
    savePrefixMatchingDb
} from "../../../../sqldb/prefixMatchingDb";
import {
    initializeFieldBoostingDb,
    saveFieldBoostingDb
} from "../../../../sqldb/fieldBoostingDb";
import {
    initializeIndexFreshnessDb,
    checkIndexFreshness,
    recordIndexBuild,
    saveIndexFreshnessDb,
    ensureFreshnessTablesExist,
    FreshnessCheckResult
} from "../../../../sqldb/indexFreshnessDb";
import * as sqlDynamicTable from "../../../../sqldb/dynamicTableDb";
import * as sqlFuzzySearch from "../../../../sqldb/fuzzySearchDb";
import * as sqlPrefixMatching from "../../../../sqldb/prefixMatchingDb";
import * as sqlFieldBoosting from "../../../../sqldb/fieldBoostingDb";
import * as sqlIncremental from "../../../../sqldb/incrementalIndexingDb";
// Feature flags removed - SQLite is now used directly

type WordFrequencyMap = Map<string, WordOccurrence[]>;

// Global flags to prevent duplicate registration
let commandsRegistered = false;
let fileStatsProviderRegistered = false;

async function isDocumentAlreadyOpen(uri: vscode.Uri): Promise<boolean> {
    const openTextDocuments = vscode.workspace.textDocuments;
    return openTextDocuments.some((doc) => doc.uri.toString() === uri.toString());
}

export async function createIndexWithContext(context: vscode.ExtensionContext) {
    const metadataManager = getNotebookMetadataManager();
    const workspaceUri = getWorkSpaceUri();
    if (!workspaceUri) {
        console.error("No workspace folder found. Aborting index creation.");
        return;
    }

    const statusBarHandler = IndexingStatusBarHandler.getInstance();
    context.subscriptions.push(statusBarHandler);

    // Get the unified index database instance from global
    const sqliteDb = (global as any).indexDb as Database;
    if (sqliteDb) {
        console.log("Initializing SQLite databases in parallel...");
        console.time("SQLite Database Initialization");
        
        try {
            // Parallelize database initialization for better performance
            await Promise.all([
                initializeTranslationPairsDb(sqliteDb),
                initializeSourceTextDb(sqliteDb),
                initializeZeroDraftDb(sqliteDb),
                initializeVerseRefDb(sqliteDb),
                initializeDynamicTableDb(sqliteDb),
                initializeIncrementalIndexingDb(sqliteDb),
                initializeFuzzySearchDb(sqliteDb),
                initializePrefixMatchingDb(sqliteDb),
                initializeFieldBoostingDb(sqliteDb),
                initializeIndexFreshnessDb(sqliteDb),
                (async () => {
                    const { initializeCellLabelDb } = await import('../../../../sqldb/cellLabelDb');
                    await initializeCellLabelDb(sqliteDb);
                })()
            ]);
            
            console.timeEnd("SQLite Database Initialization");
            console.log("✅ All SQLite databases initialized successfully");
        } catch (error) {
            console.error("❌ Error initializing SQLite databases:", error);
            vscode.window.showErrorMessage(
                `Failed to initialize SQLite databases: ${error}. The extension may not function properly.`
            );
            // Don't return here - allow the extension to continue with reduced functionality
        }
    }

    // MiniSearch instances removed - SQLite is now used directly

    let wordsIndex: WordFrequencyMap = new Map<string, WordOccurrence[]>();
    let filesIndex: Map<string, FileInfo> = new Map<string, FileInfo>();

    // Register file stats webview provider only once
    let fileStatsProvider;
    if (!fileStatsProviderRegistered) {
        fileStatsProvider = registerFileStatsWebviewProvider(context, filesIndex);
        fileStatsProviderRegistered = true;
    }

    // Debounced functions for incremental updates
    const debouncedRebuildIndexes = debounce(rebuildIndexes, 3000);
    const debouncedUpdateTranslationPairsIndex = debounce(async (doc: vscode.TextDocument) => {
        // SQLite incremental updates will be handled directly
        console.log('Document changed, triggering incremental update:', doc.fileName);
    }, 3000);
    const debouncedUpdateSourceTextIndex = debounce(async (doc: vscode.TextDocument) => {
        // SQLite incremental updates will be handled directly
        console.log('Source text document changed:', doc.fileName);
    }, 3000);
    const debouncedUpdateWordsIndex = debounce(async (doc: vscode.TextDocument) => {
        wordsIndex = await initializeWordsIndex(wordsIndex, []);
    }, 3000);
    const debouncedUpdateFilesIndex = debounce(async (doc: vscode.TextDocument) => {
        filesIndex = await initializeFilesIndex();
    }, 3000);
    const debouncedUpdateZeroDraftIndex = debounce(async (uri: vscode.Uri) => {
        // SQLite incremental updates will be handled directly
        console.log('Zero draft file changed:', uri.fsPath);
    }, 3000);

    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    async function rebuildIndexes(force: boolean = false) {
        statusBarHandler.setIndexingActive();
        try {
            // Check if SQLite database is available
            if (!sqliteDb) {
                console.error("SQLite database is not available. Index creation will be skipped.");
                vscode.window.showErrorMessage(
                    "SQLite database is not initialized. Please check that sql.js loaded correctly. Index creation has been skipped."
                );
                statusBarHandler.setIndexingComplete();
                return;
            }

            // sql.js-fts5 has built-in FTS5 support, no need to test

            if (force) {
            // Clear SQLite records
            if (sqliteDb) {
                sqliteDb.exec("DELETE FROM translation_pairs");
                sqliteDb.exec("DELETE FROM source_text");
                sqliteDb.exec("DELETE FROM zero_draft_records");
                sqliteDb.exec("DELETE FROM zero_draft_cells");
            }
            wordsIndex.clear();
            filesIndex.clear();
        }

            // Read all source and target files once
            const { sourceFiles, targetFiles } = await readSourceAndTargetFiles();

            // Check index freshness for each index type (unless forced)
            console.log("Checking index freshness...");
            console.time("Index Freshness Checks");
            
            // Ensure freshness tables exist before proceeding
            const tablesExist = ensureFreshnessTablesExist(sqliteDb);
            if (!tablesExist) {
                console.warn("Could not ensure freshness tables exist. Proceeding with force rebuild.");
                force = true;
            }
            
            const sourceUris = sourceFiles.map(f => f.uri);
            const targetUris = targetFiles.map(f => f.uri);
            const allUris = [...sourceUris, ...targetUris];
            
            // Get freshness status for all indexes
            const freshnessResults: { [key: string]: FreshnessCheckResult } = {};
            if (!force) {
                const freshnessChecks = await Promise.all([
                    checkIndexFreshness(sqliteDb, 'translation_pairs', allUris),
                    checkIndexFreshness(sqliteDb, 'source_text', sourceUris),
                    checkIndexFreshness(sqliteDb, 'zero_draft', []),
                    checkIndexFreshness(sqliteDb, 'dynamic_table', []),
                    checkIndexFreshness(sqliteDb, 'verse_ref', sourceUris),
                    checkIndexFreshness(sqliteDb, 'cell_label', allUris)
                ]);
                
                freshnessResults['translation_pairs'] = freshnessChecks[0];
                freshnessResults['source_text'] = freshnessChecks[1];
                freshnessResults['zero_draft'] = freshnessChecks[2];
                freshnessResults['dynamic_table'] = freshnessChecks[3];
                freshnessResults['verse_ref'] = freshnessChecks[4];
                freshnessResults['cell_label'] = freshnessChecks[5];
                
                // Log freshness check results
                for (const [indexName, result] of Object.entries(freshnessResults)) {
                    const status = result.needsRebuild ? '🔄 REBUILD' : '✅ FRESH';
                    console.log(`${status} ${indexName}: ${result.reason}`);
                }
                
                const totalFresh = Object.values(freshnessResults).filter(r => !r.needsRebuild).length;
                const totalIndexes = Object.keys(freshnessResults).length;
                console.log(`Index freshness: ${totalFresh}/${totalIndexes} indexes are up-to-date`);
            } else {
                console.log("Force rebuild requested - skipping freshness checks");
                // Mark all indexes as needing rebuild
                for (const indexName of ['translation_pairs', 'source_text', 'zero_draft', 'dynamic_table', 'verse_ref', 'cell_label']) {
                    freshnessResults[indexName] = { needsRebuild: true, reason: 'Force rebuild requested' };
                }
            }
            
            console.timeEnd("Index Freshness Checks");

            console.log("Creating SQLite indexes (with freshness optimization)...");
            const indexCreationId = `Parallel Index Creation ${Date.now()}`;
            console.time(indexCreationId);

            // Parallelize independent index creation operations (only for indexes that need rebuilding)
            const indexCreationPromises = [];

            // Translation pairs index (only if needed)
            if (freshnessResults['translation_pairs']?.needsRebuild) {
                indexCreationPromises.push(
                    (async () => {
                        try {
                            console.log("Creating SQLite translation pairs index...");
                            const startTime = performance.now();
                            await createSqliteTranslationPairsIndex(
                                sqliteDb,
                                sourceFiles,
                                targetFiles,
                                metadataManager,
                                force
                            );
                            const buildTime = performance.now() - startTime;
                            await recordIndexBuild(sqliteDb, 'translation_pairs', buildTime, allUris);
                            console.log(`✅ SQLite translation pairs index created successfully (${buildTime.toFixed(2)}ms)`);
                        } catch (error) {
                            console.error("❌ Error creating SQLite translation pairs index:", error);
                            throw new Error(`Failed to create translation pairs index: ${error}`);
                        }
                    })()
                );
            } else {
                console.log("⏭️ SQLite translation pairs index is up-to-date, skipping");
            }

            // Source text index (only if needed)
            if (freshnessResults['source_text']?.needsRebuild) {
                indexCreationPromises.push(
                    (async () => {
                        try {
                            console.log("Creating SQLite source text index...");
                            const startTime = performance.now();
                            await createSqliteSourceTextIndex(
                                sqliteDb,
                                sourceFiles,
                                metadataManager,
                                force
                            );
                            const buildTime = performance.now() - startTime;
                            await recordIndexBuild(sqliteDb, 'source_text', buildTime, sourceUris);
                            console.log(`✅ SQLite source text index created successfully (${buildTime.toFixed(2)}ms)`);
                        } catch (error) {
                            console.error("❌ Error creating SQLite source text index:", error);
                            throw new Error(`Failed to create source text index: ${error}`);
                        }
                    })()
                );
            } else {
                console.log("⏭️ SQLite source text index is up-to-date, skipping");
            }

            // Zero draft index (only if needed)
            if (sqliteDb && freshnessResults['zero_draft']?.needsRebuild) {
                indexCreationPromises.push(
                    (async () => {
                        try {
                            console.log("Creating SQLite zero draft index...");
                            const startTime = performance.now();
                            await createSqliteZeroDraftIndex(sqliteDb, force);
                            const buildTime = performance.now() - startTime;
                            await recordIndexBuild(sqliteDb, 'zero_draft', buildTime, []);
                            console.log(`✅ SQLite zero draft index created successfully (${buildTime.toFixed(2)}ms)`);
                        } catch (error) {
                            console.error("❌ Error creating SQLite zero draft index:", error);
                            throw error;
                        }
                    })()
                );
            } else if (sqliteDb) {
                console.log("⏭️ SQLite zero draft index is up-to-date, skipping");
            }

            // Dynamic table index (only if needed)
            if (sqliteDb && freshnessResults['dynamic_table']?.needsRebuild) {
                indexCreationPromises.push(
                    (async () => {
                        try {
                            console.log("Creating SQLite dynamic table index...");
                            const startTime = performance.now();
                            await createSqliteDynamicTableIndex(sqliteDb, force);
                            const buildTime = performance.now() - startTime;
                            await recordIndexBuild(sqliteDb, 'dynamic_table', buildTime, []);
                            console.log(`✅ SQLite dynamic table index created successfully (${buildTime.toFixed(2)}ms)`);
                        } catch (error) {
                            console.error("❌ Error creating SQLite dynamic table index:", error);
                            throw error;
                        }
                    })()
                );
            } else if (sqliteDb) {
                console.log("⏭️ SQLite dynamic table index is up-to-date, skipping");
            }

            // Cell label index (only if needed)
            if (sqliteDb && freshnessResults['cell_label']?.needsRebuild) {
                indexCreationPromises.push(
                    (async () => {
                        try {
                            console.log("Creating SQLite cell label index...");
                            const startTime = performance.now();
                            const { createCellLabelIndex } = await import('../../../../sqldb/cellLabelDb');
                            await createCellLabelIndex(sqliteDb, sourceFiles, targetFiles, force);
                            const buildTime = performance.now() - startTime;
                            await recordIndexBuild(sqliteDb, 'cell_label', buildTime, allUris);
                            console.log(`✅ SQLite cell label index created successfully (${buildTime.toFixed(2)}ms)`);
                        } catch (error) {
                            console.error("❌ Error creating SQLite cell label index:", error);
                            throw error;
                        }
                    })()
                );
            } else if (sqliteDb) {
                console.log("⏭️ SQLite cell label index is up-to-date, skipping");
            }

            // Words and files indexes (can run in parallel with SQLite operations)
            indexCreationPromises.push(
                (async () => {
                    console.log("Creating words index...");
                    wordsIndex = await initializeWordsIndex(wordsIndex, targetFiles);
                    console.log("✅ Words index created successfully");
                })()
            );

            indexCreationPromises.push(
                (async () => {
                    console.log("Creating files index...");
                    filesIndex = await initializeFilesIndex();
                    console.log("✅ Files index created successfully");
                })()
            );

            // Wait for all index creation operations to complete
            await Promise.all(indexCreationPromises);

            console.timeEnd(indexCreationId);
            console.log("✅ All indexes created successfully");

            // Save all SQLite database states (these are quick operations)
            if (sqliteDb) {
                saveIncrementalIndexingDb(sqliteDb);
                saveFuzzySearchDb(sqliteDb);
                savePrefixMatchingDb(sqliteDb);
                saveFieldBoostingDb(sqliteDb);
                saveIndexFreshnessDb(sqliteDb);
                
                // Save the unified index database to disk
                try {
                    const { saveUnifiedIndexDb } = await import('../../../../sqldb/unifiedIndexDb');
                    await saveUnifiedIndexDb();
                    console.log("💾 All index data saved to unified database");
                } catch (error) {
                    console.error("❌ Error saving unified index database:", error);
                }
            }

            // Update the file stats webview
            updateFileStatsWebview(filesIndex);

            // Update complete drafts
            try {
                await updateCompleteDrafts(targetFiles);
            } catch (error) {
                console.error("Error updating complete drafts:", error);
                vscode.window.showWarningMessage(
                    "Failed to update complete drafts. Some drafts may be out of sync."
                );
            }

            // Update status bar with SQLite index counts
            let translationPairsCount = 0;
            let sourceTextCount = 0;
            if (sqliteDb) {
                const tpStmt = sqliteDb.prepare("SELECT COUNT(*) as count FROM translation_pairs");
                tpStmt.step();
                translationPairsCount = tpStmt.getAsObject().count as number;
                tpStmt.free();
                
                const stStmt = sqliteDb.prepare("SELECT COUNT(*) as count FROM source_text");
                stStmt.step();
                sourceTextCount = stStmt.getAsObject().count as number;
                stStmt.free();
            }
            statusBarHandler.updateIndexCounts(translationPairsCount, sourceTextCount);
        } catch (error) {
            console.error("Error rebuilding full index:", error);
            vscode.window.showErrorMessage(
                "Failed to rebuild full index. Check the logs for details."
            );
        }
        statusBarHandler.setIndexingComplete();
    }

    await rebuildIndexes();
    // Get zero draft document count from SQLite
    let zeroDraftDocumentCount = 0;
    if (sqliteDb) {
        const stmt = sqliteDb.prepare("SELECT COUNT(*) as count FROM zero_draft_records");
        stmt.step();
        const result = stmt.getAsObject();
        zeroDraftDocumentCount = result.count as number;
        stmt.free();
    }
    console.log("Zero Draft index contents:", zeroDraftDocumentCount);

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
            debouncedUpdateFilesIndex(doc);
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

    // Declare command variables outside the conditional block
    let searchTargetCellsByQueryCommand: vscode.Disposable;
    let getTranslationPairsFromSourceCellQueryCommand: vscode.Disposable;
    let getSourceCellByCellIdFromAllSourceCellsCommand: vscode.Disposable;
    let getTargetCellByCellIdCommand: vscode.Disposable;
    let getTranslationPairFromProjectCommand: vscode.Disposable;
    let forceReindexCommand: vscode.Disposable;
    let showIndexOptionsCommand: vscode.Disposable;
    let getZeroDraftContentOptionsCommand: vscode.Disposable;
    let insertZeroDraftsIntoNotebooksCommand: vscode.Disposable;
    let insertZeroDraftsInCurrentEditorCommand: vscode.Disposable;
    let getWordFrequenciesCommand: vscode.Disposable;
    let refreshWordIndexCommand: vscode.Disposable;
    let getWordsAboveThresholdCommand: vscode.Disposable;
    let searchParallelCellsCommand: vscode.Disposable;
    let searchSimilarCellIdsCommand: vscode.Disposable;
    let findNextUntranslatedSourceCellCommand: vscode.Disposable;
    let searchAllCellsCommand: vscode.Disposable;
    let getFileStatsCommand: vscode.Disposable;
    let getFileInfoCommand: vscode.Disposable;
    let getAllUntranslatedCellsCommand: vscode.Disposable;
    let getUntranslatedCellsByBookCommand: vscode.Disposable;
    let getTranslationProgressSummaryCommand: vscode.Disposable;
    let searchTableRecordsCommand: vscode.Disposable;
    let searchTableColumnCommand: vscode.Disposable;
    let getTableRecordsByFileCommand: vscode.Disposable;
    let getAllTableMetadataCommand: vscode.Disposable;
    let getTableStatisticsCommand: vscode.Disposable;
    let processAllPendingChangesCommand: vscode.Disposable;
    let getIncrementalIndexingStatsCommand: vscode.Disposable;
    let cleanupOldChangesCommand: vscode.Disposable;
    let performFuzzySearchCommand: vscode.Disposable;
    let performSimilaritySearchCommand: vscode.Disposable;
    let performPhoneticSearchCommand: vscode.Disposable;
    let getFuzzySearchStatsCommand: vscode.Disposable;
    let clearFuzzySearchIndexCommand: vscode.Disposable;
    let performPrefixSearchCommand: vscode.Disposable;
    let performWordPrefixSearchCommand: vscode.Disposable;
    let performBiblicalPrefixSearchCommand: vscode.Disposable;
    let getPrefixMatchingStatsCommand: vscode.Disposable;
    let clearPrefixMatchingIndexCommand: vscode.Disposable;
    let performFieldBoostSearchCommand: vscode.Disposable;
    let performFieldSpecificSearchCommand: vscode.Disposable;
    let performBiblicalFieldBoostSearchCommand: vscode.Disposable;
    let getFieldBoostingStatsCommand: vscode.Disposable;
    let clearFieldBoostingIndexCommand: vscode.Disposable;
    let getIndexFreshnessStatusCommand: vscode.Disposable;
    let invalidateIndexCommand: vscode.Disposable;

    // Only register commands once to prevent duplicate registration errors
    if (!commandsRegistered) {
        searchTargetCellsByQueryCommand = vscode.commands.registerCommand(
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
                const results = await searchTargetCellsByQuery(query);
                if (showInfo) {
                    const resultsString = results
                        .map((r: any) => `${r.cellId || r.id}: ${r.sourceCell?.content || r.targetCell?.content || r.sourceContent || r.targetContent}`)
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

    getTranslationPairsFromSourceCellQueryCommand = vscode.commands.registerCommand(
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
            const results = getTranslationPairsFromSourceCellQuery(query, k);
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

    getSourceCellByCellIdFromAllSourceCellsCommand = vscode.commands.registerCommand(
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
            const results = await getSourceCellByCellIdFromAllSourceCells(cellId);
            console.log("getSourceCellByCellIdFromAllSourceCells results:", results);
            if (showInfo && results) {
                vscode.window.showInformationMessage(
                    `Source cell for ${cellId}: ${results.content}`
                );
            }
            return results;
        }
    );

    getTargetCellByCellIdCommand = vscode.commands.registerCommand(
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
            const results = await getTargetCellByCellId(cellId);
            if (showInfo && results) {
                vscode.window.showInformationMessage(
                    `Target cell for ${cellId}: ${JSON.stringify(results)}`
                );
            }
            return results;
        }
    );

    forceReindexCommand = vscode.commands.registerCommand(
        "translators-copilot.forceReindex",
        async () => {
            vscode.window.showInformationMessage("Force re-indexing started");
            await rebuildIndexes(true);
            vscode.window.showInformationMessage("Force re-indexing completed");
        }
    );

    showIndexOptionsCommand = vscode.commands.registerCommand(
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

    getZeroDraftContentOptionsCommand = vscode.commands.registerCommand(
        "translators-copilot.getZeroDraftContentOptions",
        async (cellId?: string) => {
            if (!cellId) {
                cellId = await vscode.window.showInputBox({
                    prompt: "Enter a cell ID",
                    placeHolder: "e.g. GEN 1:1",
                });
                if (!cellId) return; // User cancelled the input
            }
            const contentOptions = getContentOptionsForCellId(cellId);
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

    insertZeroDraftsIntoNotebooksCommand = vscode.commands.registerCommand(
        "translators-copilot.insertZeroDraftsIntoNotebooks",
        async () => {
            const workspaceFolders = vscode.workspace.workspaceFolders;
            if (!workspaceFolders) {
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

    insertZeroDraftsInCurrentEditorCommand = vscode.commands.registerCommand(
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

            await insertDraftsInCurrentEditor(forceInsert === "Yes");
        }
    );

    getWordFrequenciesCommand = vscode.commands.registerCommand(
        "translators-copilot.getWordFrequencies",
        async (): Promise<Array<{ word: string; frequency: number }>> => {
            return getWordFrequencies(wordsIndex);
        }
    );

    refreshWordIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.refreshWordIndex",
        async () => {
            const { targetFiles } = await readSourceAndTargetFiles();
            wordsIndex = await initializeWordsIndex(new Map(), targetFiles);
            console.log("Word index refreshed");
        }
    );

    getWordsAboveThresholdCommand = vscode.commands.registerCommand(
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

    searchParallelCellsCommand = vscode.commands.registerCommand(
        "translators-copilot.searchParallelCells",
        async (query?: string, k: number = 15, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query to search parallel cells",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            // Search translation pairs with boosted weights for complete pairs and target content
            const results = searchAllCells(query, k, false);

            // Remove duplicates based on cellId
            const uniqueResults = results.filter(
                (v, i, a) => a.findIndex((t) => t.cellId === v.cellId) === i
            );

            // If we have fewer unique results than requested, try to get more
            if (uniqueResults.length < k) {
                const additionalResults = searchTranslationPairs(
                    query,
                    false, // includeIncomplete set to false
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
    searchSimilarCellIdsCommand = vscode.commands.registerCommand(
        "translators-copilot.searchSimilarCellIds",
        async (cellId: string) => {
            return searchSimilarCellIds(cellId);
        }
    );
    getTranslationPairFromProjectCommand = vscode.commands.registerCommand(
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
                cellId
            );
            if (showInfo) {
                if (result) {
                    vscode.window.showInformationMessage(
                        `Translation pair for ${cellId}: Source: ${result.sourceCell.content}, Target: ${result.targetCell.content}`
                    );
                } else {
                    vscode.window.showInformationMessage(`No translation pair found for ${cellId}`);
                }
            }
            return result;
        }
    );

    findNextUntranslatedSourceCellCommand = vscode.commands.registerCommand(
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

    searchAllCellsCommand = vscode.commands.registerCommand(
        "translators-copilot.searchAllCells",
        async (
            query?: string,
            k: number = 15,
            includeIncomplete: boolean = true,
            showInfo: boolean = false
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
                query,
                k,
                includeIncomplete
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
    getFileStatsCommand = vscode.commands.registerCommand(
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
    getFileInfoCommand = vscode.commands.registerCommand(
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

    // Enhanced untranslated cell lookup commands
    getAllUntranslatedCellsCommand = vscode.commands.registerCommand(
        "translators-copilot.getAllUntranslatedCells",
        async (limit?: number, showInfo: boolean = false) => {
            if (!limit) {
                const input = await vscode.window.showInputBox({
                    prompt: "Enter the maximum number of untranslated cells to retrieve",
                    placeHolder: "e.g. 50",
                    value: "50",
                });
                if (!input) return []; // User cancelled the input
                limit = parseInt(input, 10);
                if (isNaN(limit)) limit = 50;
                showInfo = true;
            }
            
            const results = getAllUntranslatedCells(
                limit
            );

            if (showInfo) {
                const message = `Found ${results.length} untranslated cells (limit: ${limit})`;
                vscode.window.showInformationMessage(message);
            }
            
            return results;
        }
    );

    getUntranslatedCellsByBookCommand = vscode.commands.registerCommand(
        "translators-copilot.getUntranslatedCellsByBook",
        async (book?: string, showInfo: boolean = false) => {
            if (!book) {
                book = await vscode.window.showInputBox({
                    prompt: "Enter the book abbreviation (e.g. GEN, MAT, REV)",
                    placeHolder: "e.g. GEN",
                });
                if (!book) return null; // User cancelled the input
                showInfo = true;
            }
            
            const result = getUntranslatedCellsByBook(
                book.toUpperCase()
            );

            if (showInfo) {
                const message = `Book: ${book}\nTotal Cells: ${result.totalCells}\nTranslated: ${result.translatedCells}\nUntranslated: ${result.untranslatedCells.length}\nProgress: ${result.progressPercentage}%`;
                vscode.window.showInformationMessage(message);
            }
            
            return result;
        }
    );

    getTranslationProgressSummaryCommand = vscode.commands.registerCommand(
        "translators-copilot.getTranslationProgressSummary",
        async (showInfo: boolean = false) => {
            const results = getTranslationProgressSummary();

            // Always show info for this command
            {
                // Create a webview to display the progress summary
                const panel = vscode.window.createWebviewPanel(
                    "translationProgress",
                    "Translation Progress Summary",
                    vscode.ViewColumn.One,
                    {}
                );

                const totalCells = results.reduce((sum: number, book: any) => sum + book.totalCells, 0);
                const totalTranslated = results.reduce((sum: number, book: any) => sum + book.translatedCells, 0);
                const overallProgress = totalCells > 0 ? Math.round((totalTranslated / totalCells) * 100) : 0;

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                            .book { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            .progress-bar { width: 100%; height: 20px; background-color: #e0e0e0; border-radius: 10px; overflow: hidden; margin: 5px 0; }
                            .progress-fill { height: 100%; background-color: #4CAF50; transition: width 0.3s ease; }
                            .stats { display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.9em; color: #666; }
                        </style>
                    </head>
                    <body>
                        <h1>Translation Progress Summary</h1>
                        
                        <div class="summary">
                            <h2>Overall Progress</h2>
                            <div class="progress-bar">
                                <div class="progress-fill" style="width: ${overallProgress}%"></div>
                            </div>
                            <div class="stats">
                                <span>Total: ${totalCells} cells</span>
                                <span>Translated: ${totalTranslated} cells</span>
                                <span>Progress: ${overallProgress}%</span>
                            </div>
                        </div>
                        
                        <h2>Progress by Book</h2>
                                                 ${results.map((book: any) => `
                            <div class="book">
                                <h3>${book.book}</h3>
                                <div class="progress-bar">
                                    <div class="progress-fill" style="width: ${book.progressPercentage}%"></div>
                                </div>
                                <div class="stats">
                                    <span>Total: ${book.totalCells}</span>
                                    <span>Translated: ${book.translatedCells}</span>
                                    <span>Untranslated: ${book.totalCells - book.translatedCells}</span>
                                    <span>${book.progressPercentage}%</span>
                                </div>
                            </div>
                        `).join('')}
                    </body>
                    </html>
                `;
            }
            
            return results;
        }
    );

    // Dynamic table commands
    searchTableRecordsCommand = vscode.commands.registerCommand(
        "translators-copilot.searchTableRecords",
        async (query?: string, filePath?: string, limit?: number, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query to search table records",
                    placeHolder: "e.g. John, love, faith",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }
            
            if (!limit) {
                const input = await vscode.window.showInputBox({
                    prompt: "Enter the maximum number of results to return",
                    placeHolder: "e.g. 50",
                    value: "50",
                });
                if (input) {
                    limit = parseInt(input, 10);
                    if (isNaN(limit)) limit = 50;
                } else {
                    limit = 50;
                }
            }

            const db = (global as any).db;
            if (!db) {
                vscode.window.showErrorMessage("SQLite database not available");
                return [];
            }
            const results = sqlDynamicTable.searchTableRecords(db, query, filePath, limit);

            if (showInfo) {
                const message = `Found ${results.length} table records for query: ${query}`;
                vscode.window.showInformationMessage(message);
            }
            
            return results;
        }
    );

    searchTableColumnCommand = vscode.commands.registerCommand(
        "translators-copilot.searchTableColumn",
        async (columnName?: string, query?: string, filePath?: string, limit?: number, showInfo: boolean = false) => {
            if (!columnName) {
                columnName = await vscode.window.showInputBox({
                    prompt: "Enter the column name to search in",
                    placeHolder: "e.g. name, description, category",
                });
                if (!columnName) return []; // User cancelled the input
                showInfo = true;
            }

            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: `Enter a query to search in column "${columnName}"`,
                    placeHolder: "e.g. John, love, faith",
                });
                if (!query) return []; // User cancelled the input
            }
            
            if (!limit) {
                const input = await vscode.window.showInputBox({
                    prompt: "Enter the maximum number of results to return",
                    placeHolder: "e.g. 50",
                    value: "50",
                });
                if (input) {
                    limit = parseInt(input, 10);
                    if (isNaN(limit)) limit = 50;
                } else {
                    limit = 50;
                }
            }

            const db = (global as any).db;
            if (!db) {
                vscode.window.showErrorMessage("SQLite database not available");
                return [];
            }
            const results = sqlDynamicTable.searchTableColumn(db, columnName, query, filePath, limit);

            if (showInfo) {
                const message = `Found ${results.length} records in column "${columnName}" for query: ${query}`;
                vscode.window.showInformationMessage(message);
            }
            
            return results;
        }
    );

    getTableRecordsByFileCommand = vscode.commands.registerCommand(
        "translators-copilot.getTableRecordsByFile",
        async (filePath?: string, limit?: number, showInfo: boolean = false) => {
            if (!filePath) {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite database not available");
                    return [];
                }
                const availableFiles = sqlDynamicTable.getAllTableMetadata(db);
                
                if (availableFiles.length === 0) {
                    vscode.window.showInformationMessage("No table files found.");
                    return [];
                }

                const fileOptions = availableFiles.map((metadata: any) => ({
                    label: metadata.fileName,
                    description: metadata.filePath,
                    detail: metadata.filePath,
                }));

                const selectedFile = await vscode.window.showQuickPick(fileOptions, {
                    placeHolder: "Select a table file to view records",
                });

                if (!selectedFile) return []; // User cancelled
                filePath = selectedFile.detail;
                showInfo = true;
            }
            
            if (!limit) {
                const input = await vscode.window.showInputBox({
                    prompt: "Enter the maximum number of records to return",
                    placeHolder: "e.g. 100",
                    value: "100",
                });
                if (input) {
                    limit = parseInt(input, 10);
                    if (isNaN(limit)) limit = 100;
                } else {
                    limit = 100;
                }
            }

            const db = (global as any).db;
            if (!db) {
                vscode.window.showErrorMessage("SQLite database not available");
                return [];
            }
            const results = sqlDynamicTable.getTableRecordsByFile(db, filePath!, limit);

            if (showInfo) {
                const fileName = filePath!.split('/').pop() || filePath;
                const message = `Found ${results.length} records in file: ${fileName}`;
                vscode.window.showInformationMessage(message);
            }
            
            return results;
        }
    );

    getAllTableMetadataCommand = vscode.commands.registerCommand(
        "translators-copilot.getAllTableMetadata",
        async (showInfo: boolean = false) => {
            const db = (global as any).db;
            if (!db) {
                vscode.window.showErrorMessage("SQLite database not available");
                return [];
            }
            const results = sqlDynamicTable.getAllTableMetadata(db);

            // Always show info for this command
            {
                // Create a webview to display the table metadata
                const panel = vscode.window.createWebviewPanel(
                    "tableMetadata",
                    "Table Files Overview",
                    vscode.ViewColumn.One,
                    {}
                );

                const totalFiles = results.length;
                const totalRows = results.reduce((sum, table) => sum + table.totalRows, 0);

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                            .table-file { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            .stats { display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.9em; color: #666; }
                            .headers { margin-top: 10px; }
                            .header-tag { display: inline-block; background-color: #e0e0e0; padding: 2px 6px; margin: 2px; border-radius: 3px; font-size: 0.8em; }
                        </style>
                    </head>
                    <body>
                        <h1>Table Files Overview</h1>
                        
                        <div class="summary">
                            <h2>Summary</h2>
                            <div class="stats">
                                <span>Total Files: ${totalFiles}</span>
                                <span>Total Records: ${totalRows}</span>
                            </div>
                        </div>
                        
                        <h2>Table Files</h2>
                        ${results.map(table => `
                            <div class="table-file">
                                <h3>${table.fileName}</h3>
                                <div class="stats">
                                    <span>Rows: ${table.totalRows}</span>
                                    <span>Columns: ${table.headers.length}</span>
                                    <span>Format: ${table.delimiter === ',' ? 'CSV' : 'TSV'}</span>
                                    <span>Modified: ${new Date(table.lastModified).toLocaleDateString()}</span>
                                </div>
                                <div class="headers">
                                    <strong>Columns:</strong>
                                    ${table.headers.map(header => `<span class="header-tag">${header}</span>`).join('')}
                                </div>
                            </div>
                        `).join('')}
                    </body>
                    </html>
                `;
            }
            
            return results;
        }
    );

    getTableStatisticsCommand = vscode.commands.registerCommand(
        "translators-copilot.getTableStatistics",
        async (filePath?: string, showInfo: boolean = false) => {
            if (!filePath) {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite database not available");
                    return null;
                }
                const availableFiles = sqlDynamicTable.getAllTableMetadata(db);
                
                if (availableFiles.length === 0) {
                    vscode.window.showInformationMessage("No table files found.");
                    return null;
                }

                const fileOptions = availableFiles.map((metadata: any) => ({
                    label: metadata.fileName,
                    description: metadata.filePath,
                    detail: metadata.filePath,
                }));

                const selectedFile = await vscode.window.showQuickPick(fileOptions, {
                    placeHolder: "Select a table file to view statistics",
                });

                if (!selectedFile) return null; // User cancelled
                filePath = selectedFile.detail;
                showInfo = true;
            }

            const db = (global as any).db;
            if (!db) {
                vscode.window.showErrorMessage("SQLite database not available");
                return null;
            }
            const result = sqlDynamicTable.getTableStatistics(db, filePath!);

            if (showInfo && result) {
                // Create a webview to display the table statistics
                const panel = vscode.window.createWebviewPanel(
                    "tableStatistics",
                    `Table Statistics: ${filePath!.split('/').pop()}`,
                    vscode.ViewColumn.One,
                    {}
                );

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                            .column { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            .stats { display: flex; justify-content: space-between; margin-top: 5px; font-size: 0.9em; color: #666; }
                        </style>
                    </head>
                    <body>
                        <h1>Table Statistics</h1>
                        <h2>${filePath!.split('/').pop()}</h2>
                        
                        <div class="summary">
                            <h3>Overview</h3>
                            <div class="stats">
                                <span>Total Rows: ${result.totalRows}</span>
                                <span>Total Columns: ${result.columnCount}</span>
                            </div>
                        </div>
                        
                        <h3>Column Statistics</h3>
                        ${result.columns.map(column => `
                            <div class="column">
                                <h4>${column.name}</h4>
                                <div class="stats">
                                    <span>Unique Values: ${column.uniqueValues}</span>
                                    <span>Null/Empty: ${column.nullCount}</span>
                                    <span>Fill Rate: ${Math.round(((result.totalRows - column.nullCount) / result.totalRows) * 100)}%</span>
                                </div>
                            </div>
                        `).join('')}
                    </body>
                    </html>
                `;
            }
            
            return result;
        }
    );

    // Incremental indexing management commands
    processAllPendingChangesCommand = vscode.commands.registerCommand(
        "translators-copilot.processAllPendingChanges",
        async () => {
            try {
                vscode.window.showInformationMessage("Processing all pending incremental changes...");
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showInformationMessage("SQLite incremental indexing not available.");
                    return;
                }
                // Process pending changes for all resource types
                const resourceTypes: Array<'translation_pair' | 'source_text' | 'zero_draft' | 'dynamic_table' | 'verse_ref'> = [
                    'translation_pair', 'source_text', 'zero_draft', 'dynamic_table', 'verse_ref'
                ];
                
                for (const resourceType of resourceTypes) {
                    await sqlIncremental.processPendingChangesBatch(db, resourceType, 100, async (changes) => {
                        console.log(`Processing ${changes.length} ${resourceType} changes`);
                        // The actual processing logic would be implemented here
                        // For now, we just log the changes
                    });
                }
                vscode.window.showInformationMessage("All pending changes processed successfully!");
            } catch (error) {
                console.error("Error processing pending changes:", error);
                vscode.window.showErrorMessage("Failed to process pending changes. Check the logs for details.");
            }
        }
    );

    getIncrementalIndexingStatsCommand = vscode.commands.registerCommand(
        "translators-copilot.getIncrementalIndexingStats",
        async (showInfo: boolean = false) => {
            const db = (global as any).db;
            if (!db) {
                const stats = {
                    enabled: false,
                    message: 'SQLite incremental indexing not available'
                };
                vscode.window.showInformationMessage(stats.message);
                return stats;
            }
            const stats = sqlIncremental.getIncrementalIndexingStats(db);
            
            // Always show info for this command
            {
                // SQLite fuzzy search is always enabled when database is available

                // Create a webview to display the incremental indexing statistics
                const panel = vscode.window.createWebviewPanel(
                    "incrementalIndexingStats",
                    "Incremental Indexing Statistics",
                    vscode.ViewColumn.One,
                    {}
                );

                panel.webview.html = `
                    <!DOCTYPE html>
                    <html>
                    <head>
                        <meta charset="UTF-8">
                        <meta name="viewport" content="width=device-width, initial-scale=1.0">
                        <style>
                            body { font-family: Arial, sans-serif; margin: 20px; }
                            .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                            .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                            .stat-card { padding: 15px; border: 1px solid #ddd; border-radius: 5px; text-align: center; }
                            .stat-number { font-size: 2em; font-weight: bold; color: #007acc; }
                            .stat-label { font-size: 0.9em; color: #666; margin-top: 5px; }
                            .batch { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            .batch-header { display: flex; justify-content: space-between; align-items: center; }
                            .status { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; }
                            .status.completed { background-color: #d4edda; color: #155724; }
                            .status.failed { background-color: #f8d7da; color: #721c24; }
                            .status.processing { background-color: #fff3cd; color: #856404; }
                            .status.pending { background-color: #d1ecf1; color: #0c5460; }
                        </style>
                    </head>
                    <body>
                        <h1>Incremental Indexing Statistics</h1>
                        
                        <div class="summary">
                            <h2>System Status</h2>
                            <p><strong>Status:</strong> Enabled</p>
                        </div>
                        
                        <div class="stats-grid">
                            <div class="stat-card">
                                <div class="stat-number">${stats.totalChanges}</div>
                                <div class="stat-label">Total Changes</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${stats.pendingChanges}</div>
                                <div class="stat-label">Pending Changes</div>
                            </div>
                            <div class="stat-card">
                                <div class="stat-number">${stats.processedChanges}</div>
                                <div class="stat-label">Processed Changes</div>
                            </div>
                        </div>
                        
                        <h2>Changes by Type</h2>
                        <div class="stats-grid">
                            ${Object.entries(stats.changesByType).map(([type, count]) => `
                                <div class="stat-card">
                                    <div class="stat-number">${count}</div>
                                    <div class="stat-label">${type.replace('_', ' ').toUpperCase()}</div>
                                </div>
                            `).join('')}
                        </div>
                        
                        <h2>Recent Batch Processing</h2>
                        ${stats.recentBatches.length === 0 ? '<p>No recent batch processing activity.</p>' : 
                            stats.recentBatches.map((batch: any) => `
                                <div class="batch">
                                    <div class="batch-header">
                                        <h3>${batch.batchType}</h3>
                                        <span class="status ${batch.status}">${batch.status.toUpperCase()}</span>
                                    </div>
                                    <div>
                                        <strong>Progress:</strong> ${batch.processedItems}/${batch.totalItems} items
                                        ${batch.endTime ? `<br><strong>Duration:</strong> ${Math.round((new Date(batch.endTime).getTime() - new Date(batch.startTime).getTime()) / 1000)}s` : ''}
                                        ${batch.errorMessage ? `<br><strong>Error:</strong> ${batch.errorMessage}` : ''}
                                    </div>
                                </div>
                            `).join('')
                        }
                    </body>
                    </html>
                `;
            }
            
            return stats;
        }
    );

    cleanupOldChangesCommand = vscode.commands.registerCommand(
        "translators-copilot.cleanupOldChanges",
        async () => {
            const db = (global as any).db;
            if (!db) {
                vscode.window.showInformationMessage("SQLite incremental indexing not available.");
                return;
            }

            const daysInput = await vscode.window.showInputBox({
                prompt: "Enter number of days to keep processed changes (default: 7)",
                placeHolder: "7",
                value: "7"
            });

            if (!daysInput) return; // User cancelled

            const days = parseInt(daysInput) || 7;
            
            try {
                const { cleanupOldChanges } = await import('../../../../sqldb/incrementalIndexingDb');
                const deletedCount = cleanupOldChanges(db, days);
                vscode.window.showInformationMessage(`Cleaned up ${deletedCount} old processed changes (older than ${days} days).`);
            } catch (error) {
                console.error("Error cleaning up old changes:", error);
                vscode.window.showErrorMessage("Failed to cleanup old changes. Check the logs for details.");
            }
        }
    );

    // Fuzzy search commands
    performFuzzySearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performFuzzySearch",
        async (query?: string, resourceType?: string, fuzziness?: number, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for fuzzy search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            if (fuzziness === undefined) {
                const fuzzinessInput = await vscode.window.showInputBox({
                    prompt: "Enter fuzziness level (0.1 = strict, 0.5 = very fuzzy)",
                    placeHolder: "0.2",
                    value: "0.2"
                });
                if (!fuzzinessInput) return []; // User cancelled
                fuzziness = parseFloat(fuzzinessInput) || 0.2;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showInformationMessage("SQLite fuzzy search not available.");
                    return [];
                }

                const config: Partial<sqlFuzzySearch.FuzzySearchConfig> = {
                    maxDistance: Math.ceil(fuzziness * 10),
                    minScore: 0.1,
                    enablePhonetic: true,
                    enableNgram: true,
                    boostExactMatch: 2.0,
                    boostPrefixMatch: 1.5,
                    caseSensitive: false,
                };

                const results = sqlFuzzySearch.performFuzzySearch(db, query, resourceType, 50, config);

                if (showInfo) {
                    const message = `Found ${results.length} fuzzy search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing fuzzy search:", error);
                vscode.window.showErrorMessage("Failed to perform fuzzy search. Check the logs for details.");
                return [];
            }
        }
    );

    performSimilaritySearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performSimilaritySearch",
        async (query?: string, resourceType?: string, minSimilarity?: number, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for similarity search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            if (minSimilarity === undefined) {
                const similarityInput = await vscode.window.showInputBox({
                    prompt: "Enter minimum similarity (0.1 = very loose, 0.9 = very strict)",
                    placeHolder: "0.6",
                    value: "0.6"
                });
                if (!similarityInput) return []; // User cancelled
                minSimilarity = parseFloat(similarityInput) || 0.6;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showInformationMessage("SQLite fuzzy search not available.");
                    return [];
                }
                const results = sqlFuzzySearch.performSimilaritySearch(db, query, resourceType, 50, minSimilarity);

                if (showInfo) {
                    const message = `Found ${results.length} similarity search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing similarity search:", error);
                vscode.window.showErrorMessage("Failed to perform similarity search. Check the logs for details.");
                return [];
            }
        }
    );

    performPhoneticSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performPhoneticSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for phonetic search (finds similar-sounding words)",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showInformationMessage("SQLite fuzzy search not available.");
                    return [];
                }
                const config: Partial<sqlFuzzySearch.FuzzySearchConfig> = {
                    enablePhonetic: true,
                    enableNgram: false,
                    minScore: 0.3,
                    maxDistance: 5,
                };
                const results = sqlFuzzySearch.performFuzzySearch(db, query, resourceType, 50, config);

                if (showInfo) {
                    const message = `Found ${results.length} phonetic search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing phonetic search:", error);
                vscode.window.showErrorMessage("Failed to perform phonetic search. Check the logs for details.");
                return [];
            }
        }
    );

    getFuzzySearchStatsCommand = vscode.commands.registerCommand(
        "translators-copilot.getFuzzySearchStats",
        async (showInfo: boolean = false) => {
            try {
                const db = (global as any).db;
                if (!db) {
                    const stats = {
                        enabled: false,
                        message: 'SQLite fuzzy search not available'
                    };
                    vscode.window.showInformationMessage(stats.message);
                    return stats;
                }
                const stats = sqlFuzzySearch.getFuzzySearchStats(db);
                
                // Always show info for this command
                {
                    // SQLite fuzzy search is always enabled when database is available

                    // Create a webview to display the fuzzy search statistics
                    const panel = vscode.window.createWebviewPanel(
                        "fuzzySearchStats",
                        "Fuzzy Search Statistics",
                        vscode.ViewColumn.One,
                        {}
                    );

                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                                .stat-card { padding: 15px; border: 1px solid #ddd; border-radius: 5px; text-align: center; }
                                .stat-number { font-size: 2em; font-weight: bold; color: #007acc; }
                                .stat-label { font-size: 0.9em; color: #666; margin-top: 5px; }
                                .resource-type { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            </style>
                        </head>
                        <body>
                            <h1>Fuzzy Search Statistics</h1>
                            
                            <div class="summary">
                                <h2>System Status</h2>
                                <p><strong>Status:</strong> Enabled</p>
                            </div>
                            
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-number">${stats.totalRecords}</div>
                                    <div class="stat-label">Total Records</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgContentLength}</div>
                                    <div class="stat-label">Avg Content Length</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgWordCount}</div>
                                    <div class="stat-label">Avg Word Count</div>
                                </div>
                            </div>
                            
                            <h2>Records by Type</h2>
                            ${Object.entries(stats.recordsByType).map(([type, count]) => `
                                <div class="resource-type">
                                    <h3>${type.replace('_', ' ').toUpperCase()}</h3>
                                    <p><strong>Records:</strong> ${count}</p>
                                </div>
                            `).join('')}
                        </body>
                        </html>
                    `;
                }
                
                return stats;
            } catch (error) {
                console.error("Error getting fuzzy search stats:", error);
                vscode.window.showErrorMessage("Failed to get fuzzy search stats. Check the logs for details.");
                return null;
            }
        }
    );

    clearFuzzySearchIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.clearFuzzySearchIndex",
        async () => {
            const resourceType = await vscode.window.showQuickPick([
                'translation_pair',
                'source_text',
                'zero_draft',
                'dynamic_table',
                'verse_ref',
                'all'
            ], {
                placeHolder: "Select resource type to clear (or 'all' for all types)",
            });

            if (!resourceType) return; // User cancelled

            const confirm = await vscode.window.showWarningMessage(
                `This will clear the fuzzy search index for ${resourceType === 'all' ? 'all resource types' : resourceType}. Are you sure?`,
                { modal: true },
                "Yes",
                "No"
            );

            if (confirm !== "Yes") return;

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite fuzzy search not available.");
                    return;
                }
                sqlFuzzySearch.clearFuzzySearchIndex(db, resourceType === 'all' ? undefined : resourceType);
                vscode.window.showInformationMessage(`Fuzzy search index cleared for ${resourceType}.`);
            } catch (error) {
                console.error("Error clearing fuzzy search index:", error);
                vscode.window.showErrorMessage("Failed to clear fuzzy search index. Check the logs for details.");
            }
        }
    );

    // Prefix matching commands
    performPrefixSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performPrefixSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for prefix search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite prefix matching not available.");
                    return [];
                }
                const results = sqlPrefixMatching.performPrefixSearch(db, query, resourceType, 50);

                if (showInfo) {
                    const message = `Found ${results.length} prefix search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing prefix search:", error);
                vscode.window.showErrorMessage("Failed to perform prefix search. Check the logs for details.");
                return [];
            }
        }
    );

    performWordPrefixSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performWordPrefixSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for word-boundary prefix search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite prefix matching not available.");
                    return [];
                }
                const results = sqlPrefixMatching.performWordPrefixSearch(db, query, resourceType, 50);

                if (showInfo) {
                    const message = `Found ${results.length} word prefix search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing word prefix search:", error);
                vscode.window.showErrorMessage("Failed to perform word prefix search. Check the logs for details.");
                return [];
            }
        }
    );

    performBiblicalPrefixSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performBiblicalPrefixSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a biblical reference for intelligent prefix search",
                    placeHolder: "e.g. GEN, GEN 1, GEN 1:1",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite prefix matching not available.");
                    return [];
                }
                const results = sqlPrefixMatching.performPrefixSearch(db, query, resourceType, 50);

                if (showInfo) {
                    const message = `Found ${results.length} biblical prefix search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing biblical prefix search:", error);
                vscode.window.showErrorMessage("Failed to perform biblical prefix search. Check the logs for details.");
                return [];
            }
        }
    );

    getPrefixMatchingStatsCommand = vscode.commands.registerCommand(
        "translators-copilot.getPrefixMatchingStats",
        async (showInfo: boolean = false) => {
            try {
                const db = (global as any).db;
                if (!db) {
                    const stats = {
                        enabled: false,
                        message: 'SQLite prefix matching not available'
                    };
                    vscode.window.showInformationMessage(stats.message);
                    return stats;
                }
                const stats = sqlPrefixMatching.getPrefixMatchingStats(db);
                
                // Always show info for this command
                {
                    // SQLite prefix matching is always enabled when database is available

                    // Create a webview to display the prefix matching statistics
                    const panel = vscode.window.createWebviewPanel(
                        "prefixMatchingStats",
                        "Prefix Matching Statistics",
                        vscode.ViewColumn.One,
                        {}
                    );

                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                                .stat-card { padding: 15px; border: 1px solid #ddd; border-radius: 5px; text-align: center; }
                                .stat-number { font-size: 2em; font-weight: bold; color: #007acc; }
                                .stat-label { font-size: 0.9em; color: #666; margin-top: 5px; }
                                .resource-type { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                            </style>
                        </head>
                        <body>
                            <h1>Prefix Matching Statistics</h1>
                            
                            <div class="summary">
                                <h2>System Status</h2>
                                <p><strong>Status:</strong> Enabled</p>
                            </div>
                            
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-number">${stats.totalRecords}</div>
                                    <div class="stat-label">Total Records</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgContentLength}</div>
                                    <div class="stat-label">Avg Content Length</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgWordCount}</div>
                                    <div class="stat-label">Avg Word Count</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${Math.round(stats.indexSize / 1024)} KB</div>
                                    <div class="stat-label">Index Size</div>
                                </div>
                            </div>
                            
                            <h2>Records by Type</h2>
                            ${Object.entries(stats.recordsByType).map(([type, count]) => `
                                <div class="resource-type">
                                    <h3>${type.replace('_', ' ').toUpperCase()}</h3>
                                    <p><strong>Records:</strong> ${count}</p>
                                </div>
                            `).join('')}
                        </body>
                        </html>
                    `;
                }
                
                return stats;
            } catch (error) {
                console.error("Error getting prefix matching stats:", error);
                vscode.window.showErrorMessage("Failed to get prefix matching stats. Check the logs for details.");
                return null;
            }
        }
    );

    clearPrefixMatchingIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.clearPrefixMatchingIndex",
        async () => {
            const resourceType = await vscode.window.showQuickPick([
                'translation_pair',
                'source_text',
                'zero_draft',
                'dynamic_table',
                'verse_ref',
                'all'
            ], {
                placeHolder: "Select resource type to clear (or 'all' for all types)",
            });

            if (!resourceType) return; // User cancelled

            const confirm = await vscode.window.showWarningMessage(
                `This will clear the prefix matching index for ${resourceType === 'all' ? 'all resource types' : resourceType}. Are you sure?`,
                { modal: true },
                "Yes",
                "No"
            );

            if (confirm !== "Yes") return;

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite prefix matching not available.");
                    return;
                }
                sqlPrefixMatching.clearPrefixMatchingIndex(db, resourceType === 'all' ? undefined : resourceType);
                vscode.window.showInformationMessage(`Prefix matching index cleared for ${resourceType}.`);
            } catch (error) {
                console.error("Error clearing prefix matching index:", error);
                vscode.window.showErrorMessage("Failed to clear prefix matching index. Check the logs for details.");
            }
        }
    );

    // Field boosting commands
    performFieldBoostSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performFieldBoostSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for field boosting search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite field boosting not available.");
                    return [];
                }
                const results = sqlFieldBoosting.performFieldBoostSearch(
                    db,
                    query,
                    resourceType,
                    50,
                    { fieldBoosts: { cellId: 2, content: 1.5, sourceContent: 1.5, targetContent: 1.5 } }
                );

                if (showInfo) {
                    const message = `Found ${results.length} field boosting search results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing field boosting search:", error);
                vscode.window.showErrorMessage("Failed to perform field boosting search. Check the logs for details.");
                return [];
            }
        }
    );

    performFieldSpecificSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performFieldSpecificSearch",
        async (query?: string, fieldName?: string, boost?: number, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a query for field-specific search",
                    placeHolder: "e.g. love, faith, hope",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!fieldName) {
                fieldName = await vscode.window.showQuickPick([
                    'cellId',
                    'content',
                    'sourceContent',
                    'targetContent',
                    'document',
                    'section'
                ], {
                    placeHolder: "Select field to search in",
                });
                if (!fieldName) return []; // User cancelled
            }

            if (boost === undefined) {
                const boostInput = await vscode.window.showInputBox({
                    prompt: "Enter boost value for the field (1.0 = normal, 2.0 = double weight)",
                    placeHolder: "2.0",
                    value: "2.0"
                });
                if (!boostInput) return []; // User cancelled
                boost = parseFloat(boostInput) || 2.0;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite field boosting not available.");
                    return [];
                }
                const results = sqlFieldBoosting.performFieldSpecificSearch(
                    db,
                    query,
                    fieldName,
                    boost,
                    undefined,
                    50
                );

                if (showInfo) {
                    const message = `Found ${results.length} results in field "${fieldName}" for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing field-specific search:", error);
                vscode.window.showErrorMessage("Failed to perform field-specific search. Check the logs for details.");
                return [];
            }
        }
    );

    performBiblicalFieldBoostSearchCommand = vscode.commands.registerCommand(
        "translators-copilot.performBiblicalFieldBoostSearch",
        async (query?: string, resourceType?: string, showInfo: boolean = false) => {
            if (!query) {
                query = await vscode.window.showInputBox({
                    prompt: "Enter a biblical reference for intelligent field boosting search",
                    placeHolder: "e.g. GEN, GEN 1, GEN 1:1",
                });
                if (!query) return []; // User cancelled the input
                showInfo = true;
            }

            if (!resourceType) {
                resourceType = await vscode.window.showQuickPick([
                    'translation_pair',
                    'source_text',
                    'zero_draft',
                    'dynamic_table',
                    'verse_ref',
                    'all'
                ], {
                    placeHolder: "Select resource type to search (or 'all' for all types)",
                });
                if (!resourceType) return []; // User cancelled
                if (resourceType === 'all') resourceType = undefined;
            }

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite field boosting not available.");
                    return [];
                }
                const results = sqlFieldBoosting.performFieldBoostSearch(db, query, resourceType, 50, {});

                if (showInfo) {
                    const message = `Found ${results.length} biblical field boosting results for "${query}"`;
                    vscode.window.showInformationMessage(message);
                }

                return results;
            } catch (error) {
                console.error("Error performing biblical field boosting search:", error);
                vscode.window.showErrorMessage("Failed to perform biblical field boosting search. Check the logs for details.");
                return [];
            }
        }
    );

    getFieldBoostingStatsCommand = vscode.commands.registerCommand(
        "translators-copilot.getFieldBoostingStats",
        async (showInfo: boolean = false) => {
            try {
                const db = (global as any).db;
                if (!db) {
                    const stats = {
                        enabled: false,
                        message: 'SQLite field boosting not available'
                    };
                    vscode.window.showInformationMessage(stats.message);
                    return stats;
                }
                const stats = sqlFieldBoosting.getFieldBoostingStats(db);
                
                // Always show info for this command
                {
                    // SQLite field boosting is always enabled when database is available

                    // Create a webview to display the field boosting statistics
                    const panel = vscode.window.createWebviewPanel(
                        "fieldBoostingStats",
                        "Field Boosting Statistics",
                        vscode.ViewColumn.One,
                        {}
                    );

                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                                .stat-card { padding: 15px; border: 1px solid #ddd; border-radius: 5px; text-align: center; }
                                .stat-number { font-size: 2em; font-weight: bold; color: #007acc; }
                                .stat-label { font-size: 0.9em; color: #666; margin-top: 5px; }
                                .resource-type { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                                .field-list { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 10px; }
                                .field-tag { background-color: #e0e0e0; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; }
                            </style>
                        </head>
                        <body>
                            <h1>Field Boosting Statistics</h1>
                            
                            <div class="summary">
                                <h2>System Status</h2>
                                <p><strong>Status:</strong> Enabled</p>
                            </div>
                            
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-number">${stats.totalRecords}</div>
                                    <div class="stat-label">Total Records</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgContentLength}</div>
                                    <div class="stat-label">Avg Content Length</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${stats.avgFieldCount}</div>
                                    <div class="stat-label">Avg Field Count</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${Math.round(stats.indexSize / 1024)} KB</div>
                                    <div class="stat-label">Index Size</div>
                                </div>
                            </div>
                            
                            <h2>Records by Type</h2>
                            ${Object.entries(stats.recordsByType).map(([type, count]) => `
                                <div class="resource-type">
                                    <h3>${type.replace('_', ' ').toUpperCase()}</h3>
                                    <p><strong>Records:</strong> ${count}</p>
                                    ${stats.fieldsByType[type] ? `
                                        <p><strong>Fields:</strong></p>
                                        <div class="field-list">
                                            ${stats.fieldsByType[type].map((field: string) => `<span class="field-tag">${field}</span>`).join('')}
                                        </div>
                                    ` : ''}
                                </div>
                            `).join('')}
                        </body>
                        </html>
                    `;
                }
                
                return stats;
            } catch (error) {
                console.error("Error getting field boosting stats:", error);
                vscode.window.showErrorMessage("Failed to get field boosting stats. Check the logs for details.");
                return null;
            }
        }
    );

    clearFieldBoostingIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.clearFieldBoostingIndex",
        async () => {
            const resourceType = await vscode.window.showQuickPick([
                'translation_pair',
                'source_text',
                'zero_draft',
                'dynamic_table',
                'verse_ref',
                'all'
            ], {
                placeHolder: "Select resource type to clear (or 'all' for all types)",
            });

            if (!resourceType) return; // User cancelled

            const confirm = await vscode.window.showWarningMessage(
                `This will clear the field boosting index for ${resourceType === 'all' ? 'all resource types' : resourceType}. Are you sure?`,
                { modal: true },
                "Yes",
                "No"
            );

            if (confirm !== "Yes") return;

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite field boosting not available.");
                    return;
                }
                sqlFieldBoosting.clearFieldBoostingIndex(db, resourceType === 'all' ? undefined : resourceType);
                vscode.window.showInformationMessage(`Field boosting index cleared for ${resourceType}.`);
            } catch (error) {
                console.error("Error clearing field boosting index:", error);
                vscode.window.showErrorMessage("Failed to clear field boosting index. Check the logs for details.");
            }
        }
    );

    // Index freshness commands
    getIndexFreshnessStatusCommand = vscode.commands.registerCommand(
        "translators-copilot.getIndexFreshnessStatus",
        async (showInfo: boolean = false) => {
            try {
                const db = (global as any).db;
                if (!db) {
                    const status = {
                        enabled: false,
                        message: 'SQLite database not available'
                    };
                    vscode.window.showInformationMessage(status.message);
                    return status;
                }

                const { getAllIndexMetadata } = await import('../../../../sqldb/indexFreshnessDb');
                const indexes = getAllIndexMetadata(db);
                
                // Always show info for this command
                {
                    // Create a webview to display the index freshness status
                    const panel = vscode.window.createWebviewPanel(
                        "indexFreshnessStatus",
                        "Index Freshness Status",
                        vscode.ViewColumn.One,
                        {}
                    );

                    const totalIndexes = indexes.length;
                    const totalBuildTime = indexes.reduce((sum, idx) => sum + idx.buildTimeMs, 0);

                    panel.webview.html = `
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="UTF-8">
                            <meta name="viewport" content="width=device-width, initial-scale=1.0">
                            <style>
                                body { font-family: Arial, sans-serif; margin: 20px; }
                                .summary { margin-bottom: 30px; padding: 15px; background-color: #f5f5f5; border-radius: 5px; }
                                .stats-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 15px; margin-bottom: 30px; }
                                .stat-card { padding: 15px; border: 1px solid #ddd; border-radius: 5px; text-align: center; }
                                .stat-number { font-size: 2em; font-weight: bold; color: #007acc; }
                                .stat-label { font-size: 0.9em; color: #666; margin-top: 5px; }
                                .index { margin-bottom: 15px; padding: 10px; border: 1px solid #ddd; border-radius: 3px; }
                                .index-header { display: flex; justify-content: space-between; align-items: center; }
                                .status { padding: 2px 8px; border-radius: 3px; font-size: 0.8em; }
                                .status.fresh { background-color: #d4edda; color: #155724; }
                                .status.old { background-color: #fff3cd; color: #856404; }
                                .status.missing { background-color: #f8d7da; color: #721c24; }
                            </style>
                        </head>
                        <body>
                            <h1>Index Freshness Status</h1>
                            
                            <div class="summary">
                                <h2>Overview</h2>
                                <p><strong>Total Indexes:</strong> ${totalIndexes}</p>
                                <p><strong>Total Build Time:</strong> ${totalBuildTime.toFixed(2)}ms</p>
                            </div>
                            
                            <div class="stats-grid">
                                <div class="stat-card">
                                    <div class="stat-number">${totalIndexes}</div>
                                    <div class="stat-label">Total Indexes</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${Math.round(totalBuildTime / 1000)}s</div>
                                    <div class="stat-label">Total Build Time</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${indexes.reduce((sum, idx) => sum + idx.sourceFileCount, 0)}</div>
                                    <div class="stat-label">Total Source Files</div>
                                </div>
                                <div class="stat-card">
                                    <div class="stat-number">${indexes.reduce((sum, idx) => sum + idx.indexSize, 0)}</div>
                                    <div class="stat-label">Total Index Records</div>
                                </div>
                            </div>
                            
                            <h2>Index Details</h2>
                            ${indexes.length === 0 ? '<p>No index metadata found.</p>' : 
                                indexes.map(index => {
                                    const lastBuilt = new Date(index.lastBuiltAt);
                                    const age = Date.now() - index.lastBuiltAt;
                                    const ageHours = Math.round(age / (1000 * 60 * 60));
                                    const status = age < 24 * 60 * 60 * 1000 ? 'fresh' : 'old';
                                    
                                    return `
                                        <div class="index">
                                            <div class="index-header">
                                                <h3>${index.indexName}</h3>
                                                <span class="status ${status}">${ageHours}h ago</span>
                                            </div>
                                            <div>
                                                <strong>Last Built:</strong> ${lastBuilt.toLocaleString()}<br>
                                                <strong>Build Time:</strong> ${index.buildTimeMs.toFixed(2)}ms<br>
                                                <strong>Source Files:</strong> ${index.sourceFileCount}<br>
                                                <strong>Index Size:</strong> ${index.indexSize} records
                                            </div>
                                        </div>
                                    `;
                                }).join('')
                            }
                        </body>
                        </html>
                    `;
                }
                
                return indexes;
            } catch (error) {
                console.error("Error getting index freshness status:", error);
                vscode.window.showErrorMessage("Failed to get index freshness status. Check the logs for details.");
                return null;
            }
        }
    );

    invalidateIndexCommand = vscode.commands.registerCommand(
        "translators-copilot.invalidateIndex",
        async () => {
            const indexType = await vscode.window.showQuickPick([
                'translation_pairs',
                'source_text',
                'zero_draft',
                'dynamic_table',
                'verse_ref',
                'cell_label',
                'all'
            ], {
                placeHolder: "Select index to invalidate (force rebuild on next startup)",
            });

            if (!indexType) return; // User cancelled

            const confirm = await vscode.window.showWarningMessage(
                `This will force ${indexType === 'all' ? 'all indexes' : indexType} to rebuild on the next startup. Are you sure?`,
                { modal: true },
                "Yes",
                "No"
            );

            if (confirm !== "Yes") return;

            try {
                const db = (global as any).db;
                if (!db) {
                    vscode.window.showErrorMessage("SQLite database not available.");
                    return;
                }

                const { invalidateIndex } = await import('../../../../sqldb/indexFreshnessDb');
                
                if (indexType === 'all') {
                    const allIndexes = ['translation_pairs', 'source_text', 'zero_draft', 'dynamic_table', 'verse_ref', 'cell_label'];
                    for (const index of allIndexes) {
                        invalidateIndex(db, index);
                    }
                    vscode.window.showInformationMessage("All indexes invalidated and will rebuild on next startup.");
                } else {
                    invalidateIndex(db, indexType);
                    vscode.window.showInformationMessage(`Index '${indexType}' invalidated and will rebuild on next startup.`);
                }
            } catch (error) {
                console.error("Error invalidating index:", error);
                vscode.window.showErrorMessage("Failed to invalidate index. Check the logs for details.");
            }
        }
    );

        // Update the subscriptions
        context.subscriptions.push(
            ...[
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
                searchSimilarCellIdsCommand,
                findNextUntranslatedSourceCellCommand,
                searchAllCellsCommand,
                getFileStatsCommand,
                getFileInfoCommand,
                getAllUntranslatedCellsCommand,
                getUntranslatedCellsByBookCommand,
                getTranslationProgressSummaryCommand,
                searchTableRecordsCommand,
                searchTableColumnCommand,
                getTableRecordsByFileCommand,
                getAllTableMetadataCommand,
                getTableStatisticsCommand,
                processAllPendingChangesCommand,
                getIncrementalIndexingStatsCommand,
                cleanupOldChangesCommand,
                performFuzzySearchCommand,
                performSimilaritySearchCommand,
                performPhoneticSearchCommand,
                getFuzzySearchStatsCommand,
                clearFuzzySearchIndexCommand,
                performPrefixSearchCommand,
                performWordPrefixSearchCommand,
                performBiblicalPrefixSearchCommand,
                getPrefixMatchingStatsCommand,
                clearPrefixMatchingIndexCommand,
                performFieldBoostSearchCommand,
                performFieldSpecificSearchCommand,
                performBiblicalFieldBoostSearchCommand,
                getFieldBoostingStatsCommand,
                clearFieldBoostingIndexCommand,
                getIndexFreshnessStatusCommand,
                invalidateIndexCommand,
            ]
        );

        // Mark commands as registered to prevent duplicate registration
        commandsRegistered = true;
    }

    // Always add these subscriptions (they're not commands)
    context.subscriptions.push(
        onDidSaveTextDocument,
        onDidChangeTextDocument,
        zeroDraftWatcher
    );

    const functionsToExpose = {
        handleTextSelection,
        searchAllCells,
        searchParallelCells,
        searchTranslationPairs,
    };

    return functionsToExpose;
}
