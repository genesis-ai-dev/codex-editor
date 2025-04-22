import * as vscode from "vscode";
import { registerTextSelectionHandler } from "./handlers/textSelectionHandler";
import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
import { registerSourceCodeLens } from "./sourceCodeLensProvider";
import { indexVerseRefsInSourceText } from "./commands/indexVrefsCommand";
import { registerProviders } from "./providers/registerProviders";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { registerCompletionsCodeLensProviders } from "./activationHelpers/contextAware/completionsCodeLensProviders";
import { initializeBibleData } from "./activationHelpers/contextAware/sourceData";
import { registerLanguageServer } from "./tsServer/registerLanguageServer";
import { registerClientCommands } from "./tsServer/registerClientCommands";
import registerClientOnRequests from "./tsServer/registerClientOnRequests";
import { registerSmartEditCommands } from "./smartEdits/registerSmartEditCommands";
import { LanguageClient } from "vscode-languageclient/node";
import { registerProjectManager } from "./projectManager";
import {
    temporaryMigrationScript_checkMatthewNotebook,
    migration_changeDraftFolderToFilesFolder,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/miniIndex/indexes";
import { registerSourceUploadCommands } from "./providers/SourceUpload/registerCommands";
import { migrateSourceFiles } from "./utils/codexNotebookUtils";
import { StatusBarItem } from "vscode";
import { Database } from "sql.js";
import {
    importWiktionaryJSONL,
    ingestJsonlDictionaryEntries,
    initializeSqlJs,
    registerLookupWordCommand,
} from "./sqldb";
import {
    createTableIndexes,
    parseTableFile,
    TableRecord,
} from "./activationHelpers/contextAware/miniIndex/indexes/dynamicTableIndex";
import MiniSearch from "minisearch";
import { registerStartupFlowCommands } from "./providers/StartupFlow/registerCommands";
import { registerPreflightCommand } from "./providers/StartupFlow/preflight";
import { NotebookMetadataManager } from "./utils/notebookMetadataManager";
import { waitForExtensionActivation } from "./utils/vscode";
import { WordsViewProvider } from "./providers/WordsView/WordsViewProvider";
import { FrontierAPI } from "../webviews/codex-webviews/src/StartupFLow/types";

interface ActivationTiming {
    step: string;
    duration: number;
    startTime: number;
}

const activationTimings: ActivationTiming[] = [];

function trackTiming(step: string, startTime: number) {
    const duration = globalThis.performance.now() - startTime;
    activationTimings.push({ step, duration, startTime });
    console.log(`[Activation] ${step}: ${duration.toFixed(2)}ms`);
    return globalThis.performance.now();
}

declare global {
    // eslint-disable-next-line
    var db: Database | undefined;
}

let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;
let autoCompleteStatusBarItem: StatusBarItem;
let tableIndexMap: Map<string, MiniSearch<TableRecord>>;
let commitTimeout: any;
const COMMIT_DELAY = 5000; // Delay in milliseconds
let notebookMetadataManager: NotebookMetadataManager;
let authApi: FrontierAPI | undefined;
let wordsViewProvider: WordsViewProvider | undefined;

export async function activate(context: vscode.ExtensionContext) {
    const activationStart = globalThis.performance.now();
    let stepStart = activationStart;

    try {
        // Initialize Frontier API
        stepStart = trackTiming("Initialize Frontier API", stepStart);
        const extension = await waitForExtensionActivation("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            authApi = extension.exports;
        }

        // Initialize metadata manager
        stepStart = trackTiming("Initialize Metadata Manager", stepStart);
        notebookMetadataManager = NotebookMetadataManager.getInstance(context);
        await notebookMetadataManager.initialize();

        // Register project manager first to ensure it's available
        stepStart = trackTiming("Register Project Manager", stepStart);
        registerProjectManager(context);

        // // Show project manager view immediately
        // await vscode.commands.executeCommand("workbench.view.extension.project-manager");

        // Register startup flow commands
        stepStart = trackTiming("Register Startup Flow", stepStart);
        await registerStartupFlowCommands(context);
        registerPreflightCommand(context);

        // Initialize SqlJs
        stepStart = trackTiming("Initialize SqlJs", stepStart);
        try {
            global.db = await initializeSqlJs(context);
            console.log("initializeSqlJs db", global.db);
        } catch (error) {
            console.error("Error initializing SqlJs:", error);
        }
        if (global.db) {
            const importCommand = vscode.commands.registerCommand(
                "extension.importWiktionaryJSONL",
                () => global.db && importWiktionaryJSONL(global.db)
            );
            context.subscriptions.push(importCommand);
            registerLookupWordCommand(global.db, context);
            ingestJsonlDictionaryEntries(global.db);
        }

        vscode.workspace.getConfiguration().update("workbench.startupEditor", "none", true);

        // Initialize extension based on workspace state
        stepStart = trackTiming("Initialize Workspace", stepStart);
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            if (!vscode.workspace.isTrusted) {
                console.log("Workspace not trusted. Waiting for trust...");
                vscode.window
                    .showWarningMessage(
                        "This workspace needs to be trusted before Codex Editor can fully activate.",
                        "Trust Workspace"
                    )
                    .then((selection) => {
                        if (selection === "Trust Workspace") {
                            vscode.commands.executeCommand("workbench.action.trustWorkspace");
                        }
                    });
                return;
            }

            const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");

            let metadataExists = false;
            try {
                await vscode.workspace.fs.stat(metadataUri);
                metadataExists = true;
            } catch {
                metadataExists = false;
            }

            if (!metadataExists) {
                console.log("metadata.json not found. Waiting for initialization.");
                await watchForInitialization(context, metadataUri);
            } else {
                await initializeExtension(context, metadataExists);
            }
            watchTableFiles(context);
        } else {
            console.log("No workspace folder found");
            vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
        }

        // Register remaining components
        stepStart = trackTiming("Register Core Components", stepStart);
        let componentStart = stepStart;

        componentStart = trackTiming("• Register Smart Edit Commands", componentStart);
        registerSmartEditCommands(context);

        componentStart = trackTiming("• Register Source Upload Commands", componentStart);
        await registerSourceUploadCommands(context);

        componentStart = trackTiming("• Register Providers", componentStart);
        registerProviders(context);

        componentStart = trackTiming("• Register Commands", componentStart);
        await registerCommands(context);

        componentStart = trackTiming("• Initialize Webviews", componentStart);
        await initializeWebviews(context);

        // Track total time for core components
        trackTiming("Total Core Components", stepStart);

        // Execute post-activation tasks
        stepStart = trackTiming("Post-activation Tasks", stepStart);
        await executeCommandsAfter();
        await temporaryMigrationScript_checkMatthewNotebook();
        await migration_changeDraftFolderToFilesFolder();
        await migrateSourceFiles();

        // Initialize status bar
        stepStart = trackTiming("Initialize Status Bar", stepStart);
        autoCompleteStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        autoCompleteStatusBarItem.text = "$(sync~spin) Auto-completing...";
        autoCompleteStatusBarItem.hide();
        context.subscriptions.push(autoCompleteStatusBarItem);

        // Show activation summary
        const totalDuration = globalThis.performance.now() - activationStart;
        trackTiming("Total Activation Time", activationStart);

        // Sort timings by duration (descending) and format the message
        const sortedTimings = [...activationTimings].sort((a, b) => b.duration - a.duration);
        const summaryMessage = [
            `Codex Editor activated in ${totalDuration.toFixed(2)}ms`,
            "",
            "Top 5 longest steps:",
            ...sortedTimings.slice(0, 5).map((t) => `${t.step}: ${t.duration.toFixed(2)}ms`),
        ].join("\n");

        console.info(summaryMessage);

        // Show notification with details
        // vscode.window
        //     .showInformationMessage(summaryMessage, "Show All Timings")
        //     .then((selection) => {
        //         if (selection === "Show All Timings") {
        //             // Create and show output channel with complete timing information
        //             const channel = vscode.window.createOutputChannel("Codex Editor Activation");
        //             channel.appendLine("Complete activation timing breakdown:");
        //             sortedTimings.forEach((t) => {
        //                 channel.appendLine(`${t.step}: ${t.duration.toFixed(2)}ms`);
        //             });
        //             channel.show();
        //         }
        //     });

        // Register Words View Provider
        wordsViewProvider = new WordsViewProvider(context.extensionUri);

        const showWordsViewCommand = vscode.commands.registerCommand(
            "frontier.showWordsView",
            () => {
                wordsViewProvider?.show();
            }
        );

        context.subscriptions.push(showWordsViewCommand);
    } catch (error) {
        console.error("Error during extension activation:", error);
        vscode.window.showErrorMessage(`Failed to activate Codex Editor: ${error}`);
    }
}

async function initializeExtension(context: vscode.ExtensionContext, metadataExists: boolean) {
    const initStart = globalThis.performance.now();
    let stepStart = initStart;

    console.log("Initializing extension");

    if (metadataExists) {
        stepStart = trackTiming("• Show Project Overview", stepStart);
        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");

        stepStart = trackTiming("• Register CodeLens Providers", stepStart);
        registerCodeLensProviders(context);

        stepStart = trackTiming("• Register Text Selection Handler", stepStart);
        registerTextSelectionHandler(context, () => undefined);

        // Break down language server initialization
        const lsStart = globalThis.performance.now();
        client = await registerLanguageServer(context);
        if (client && global.db) {
            stepStart = trackTiming("  • Language Server Setup", lsStart);
            clientCommandsDisposable = registerClientCommands(context, client);
            context.subscriptions.push(clientCommandsDisposable);

            stepStart = trackTiming("  • Register Client Requests", stepStart);
            try {
                await registerClientOnRequests(client, global.db);
                stepStart = trackTiming("  • Start Language Server", stepStart);
                await client.start();
            } catch (error) {
                console.error("Error registering client requests:", error);
            }
        }
        trackTiming("• Total Language Server", lsStart);

        // Break down index creation
        const indexStart = globalThis.performance.now();
        stepStart = trackTiming("  • Index Verse Refs", indexStart);
        await indexVerseRefsInSourceText();

        stepStart = trackTiming("  • Create Context Index", stepStart);
        await createIndexWithContext(context);

        stepStart = trackTiming("  • Create Table Indexes", stepStart);
        tableIndexMap = await createTableIndexes();

        trackTiming("• Total Index Creation", indexStart);
    } else {
        stepStart = trackTiming("• Show Project Overview (No Metadata)", stepStart);
        vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
    }

    trackTiming("Total Initialize Extension", initStart);
}

let watcher: vscode.FileSystemWatcher | undefined;

function watchTableFiles(context: vscode.ExtensionContext) {
    const watcher = vscode.workspace.createFileSystemWatcher("**/*.{csv,tsv,tab}");

    watcher.onDidChange(async (uri) => {
        // Recreate the index for the changed file
        const [records, fields] = await parseTableFile(uri);

        if (fields.length === 0) {
            tableIndexMap.delete(uri.fsPath);
            console.warn(`Headers missing after change in ${uri.fsPath}. Index removed.`);
            return;
        }

        const tableIndex = new MiniSearch<TableRecord>({
            fields: fields,
            storeFields: ["id", ...fields],
            idField: "id",
        });

        tableIndex.addAll(records);

        tableIndexMap.set(uri.fsPath, tableIndex);

        console.log(`Updated index for file: ${uri.fsPath}`);
    });

    watcher.onDidCreate(async (uri) => {
        // Create an index for the new file
        const [records, fields] = await parseTableFile(uri);

        if (fields.length === 0) {
            console.warn(`No headers found in new table file: ${uri.fsPath}. Skipping file.`);
            return;
        }

        const tableIndex = new MiniSearch<TableRecord>({
            fields: fields,
            storeFields: ["id", ...fields],
            idField: "id",
        });

        tableIndex.addAll(records);

        tableIndexMap.set(uri.fsPath, tableIndex);

        console.log(`Created index for new file: ${uri.fsPath}`);
    });

    watcher.onDidDelete((uri) => {
        // Remove the index for the deleted file
        if (tableIndexMap.delete(uri.fsPath)) {
            console.log(`Removed index for deleted file: ${uri.fsPath}`);
        }
    });

    context.subscriptions.push(watcher);
}

async function watchForInitialization(context: vscode.ExtensionContext, metadataUri: vscode.Uri) {
    const fs = vscode.workspace.fs;
    watcher = vscode.workspace.createFileSystemWatcher("**/*");

    const checkInitialization = async () => {
        let metadataExists = false;
        try {
            await fs.stat(metadataUri);
            metadataExists = true;
        } catch {
            metadataExists = false;
        }

        if (metadataExists) {
            watcher?.dispose();
            await initializeExtension(context, metadataExists);
        }
    };

    watcher.onDidCreate(checkInitialization);
    watcher.onDidChange(checkInitialization);
    watcher.onDidDelete(checkInitialization);

    context.subscriptions.push(watcher);

    // Show project overview immediately, don't wait for metadata
    vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
}

function registerCodeLensProviders(context: vscode.ExtensionContext) {
    registerReferencesCodeLens(context);
    registerSourceCodeLens(context);
    registerCompletionsCodeLensProviders(context);
}

async function executeCommandsAfter() {
    vscode.commands.executeCommand("workbench.action.focusAuxiliaryBar");
    vscode.commands.executeCommand("workbench.action.focusActivityBar");
    // Focus our main menu instead of the navigation view
    vscode.commands.executeCommand("codex-editor.mainMenu.focus");
    vscode.commands.executeCommand("codex-editor-extension.setEditorFontToTargetLanguage");
    // Configure auto-save in settings
    await vscode.workspace
        .getConfiguration()
        .update("files.autoSave", "afterDelay", vscode.ConfigurationTarget.Global);
    await vscode.workspace
        .getConfiguration()
        .update("files.autoSaveDelay", 1000, vscode.ConfigurationTarget.Global);
}

export function deactivate() {
    if (clientCommandsDisposable) {
        clientCommandsDisposable.dispose();
    }
    if (client) {
        return client.stop();
    }
    if (global.db) {
        global.db.close();
    }
}

export function getAutoCompleteStatusBarItem(): StatusBarItem {
    return autoCompleteStatusBarItem;
}

export function getNotebookMetadataManager(): NotebookMetadataManager {
    return notebookMetadataManager;
}

export function getAuthApi(): FrontierAPI | undefined {
    return authApi;
}
