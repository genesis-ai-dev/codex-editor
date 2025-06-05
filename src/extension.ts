import * as vscode from "vscode";
// import { registerTextSelectionHandler } from "./handlers/textSelectionHandler";
// import { registerReferencesCodeLens } from "./referencesCodeLensProvider";
// import { registerSourceCodeLens } from "./sourceCodeLensProvider";
// import { indexVerseRefsInSourceText } from "./commands/indexVrefsCommand";
import { registerProviders } from "./providers/registerProviders";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
// import { registerCompletionsCodeLensProviders } from "./activationHelpers/contextAware/completionsCodeLensProviders";
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
import { createIndexWithContext } from "./activationHelpers/contextAware/contentIndexes/indexes";
import { registerSourceUploadCommands } from "./providers/SourceUpload/registerCommands";
import { registerNewSourceUploadCommands } from "./providers/NewSourceUploader/registerCommands";
import { migrateSourceFiles } from "./utils/codexNotebookUtils";
import { StatusBarItem } from "vscode";
import { Database } from "fts5-sql-bundle";
import {
    importWiktionaryJSONL,
    ingestJsonlDictionaryEntries,
    initializeSqlJs,
    registerLookupWordCommand,
} from "./sqldb";
// import {
//     createTableIndexes,
//     parseTableFile,
//     TableRecord,
// } from "./activationHelpers/contextAware/contentIndexes/indexes/dynamicTableIndex";
import { registerStartupFlowCommands } from "./providers/StartupFlow/registerCommands";
import { registerPreflightCommand } from "./providers/StartupFlow/preflight";
import { NotebookMetadataManager } from "./utils/notebookMetadataManager";
import { waitForExtensionActivation } from "./utils/vscode";
import { WordsViewProvider } from "./providers/WordsView/WordsViewProvider";
import { FrontierAPI } from "../webviews/codex-webviews/src/StartupFlow/types";
import { registerCommandsBefore } from "./activationHelpers/contextAware/commandsBefore";
import {
    registerWelcomeViewProvider,
    showWelcomeViewIfNeeded,
} from "./providers/WelcomeView/register";
import { SyncManager } from "./projectManager/syncManager";
import {
    registerSplashScreenProvider,
    showSplashScreen,
    updateSplashScreenTimings,
    closeSplashScreen,
} from "./providers/SplashScreen/register";
import { openBookNameEditor } from "./bookNameSettings/bookNameSettings";
import { openCellLabelImporter } from "./cellLabelImporter/cellLabelImporter";

export interface ActivationTiming {
    step: string;
    duration: number;
    startTime: number;
}

const activationTimings: ActivationTiming[] = [];

function trackTiming(step: string, startTime: number) {
    const duration = globalThis.performance.now() - startTime;
    activationTimings.push({ step, duration, startTime });
    console.log(`[Activation] ${step}: ${duration.toFixed(2)}ms`);

    // Update splash screen with latest timing information
    updateSplashScreenTimings(activationTimings);

    return globalThis.performance.now();
}

declare global {
    // eslint-disable-next-line
    var db: Database | undefined;
}

let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;
let autoCompleteStatusBarItem: StatusBarItem;
// let commitTimeout: any;
// const COMMIT_DELAY = 5000; // Delay in milliseconds
let notebookMetadataManager: NotebookMetadataManager;
let authApi: FrontierAPI | undefined;
let savedTabLayout: any[] = [];
const TAB_LAYOUT_KEY = "codexEditor.tabLayout";

// Helper to save tab layout and persist to globalState
async function saveTabLayout(context: vscode.ExtensionContext) {
    const layout = vscode.window.tabGroups.all.map((group, groupIndex) => ({
        isActive: group.isActive,
        tabs: group.tabs.map((tab) => {
            // Try to get URI and viewType for all tab types
            let uri: string | undefined = undefined;
            let viewType: string | undefined = undefined;
            if ((tab as any).input) {
                uri =
                    (tab as any).input?.uri?.toString?.() ||
                    (tab as any).input?.resource?.toString?.();
                viewType = (tab as any).input?.viewType;
            }
            return {
                label: tab.label,
                uri,
                viewType,
                isActive: tab.isActive,
                isPinned: tab.isPinned,
                groupIndex,
            };
        }),
    }));
    savedTabLayout = layout;
    await context.globalState.update(TAB_LAYOUT_KEY, layout);
}

// Helper to restore tab layout from globalState
async function restoreTabLayout(context: vscode.ExtensionContext) {
    const layout = context.globalState.get<any[]>(TAB_LAYOUT_KEY) || [];
    for (const group of layout) {
        for (const tab of group.tabs) {
            if (tab.uri) {
                try {
                    if (tab.viewType && tab.viewType !== "default") {
                        await vscode.commands.executeCommand(
                            "vscode.openWith",
                            vscode.Uri.parse(tab.uri),
                            tab.viewType,
                            { viewColumn: tab.groupIndex + 1 }
                        );
                    } else {
                        const doc = await vscode.workspace.openTextDocument(
                            vscode.Uri.parse(tab.uri)
                        );
                        await vscode.window.showTextDocument(doc, tab.groupIndex + 1);
                    }
                } catch (e) {
                    // File may not exist, ignore
                }
            }
        }
    }
    // Optionally, focus the previously active tab/group
    // Clear the saved layout after restore
    await context.globalState.update(TAB_LAYOUT_KEY, undefined);
}

export async function activate(context: vscode.ExtensionContext) {
    const activationStart = globalThis.performance.now();

    // Save tab layout and close all editors before showing splash screen
    try {
        await saveTabLayout(context);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } catch (e) {
        console.error("Error saving/closing tabs before splash screen:", e);
    }

    // Register and show splash screen immediately before anything else
    try {
        // Register splash screen as the very first action
        const splashStart = activationStart;
        registerSplashScreenProvider(context);
        showSplashScreen(activationStart);
        trackTiming("Initialize Splash Screen", splashStart);
    } catch (error) {
        console.error("Error showing splash screen:", error);
        // Continue with activation even if splash screen fails
    }

    let stepStart = activationStart;

    try {
        stepStart = trackTiming("Maximize Editor Hide Sidebar", stepStart);
        // Use maximizeEditorHideSidebar directly to create a clean, focused editor experience on startup
        // note: there may be no active editor yet, so we need to see if the welcome view is needed initially
        await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
        stepStart = trackTiming("Execute Commands Before", stepStart);
        await executeCommandsBefore(context);

        // Initialize Frontier API
        stepStart = trackTiming("Initialize Frontier API", stepStart);
        const extension = await waitForExtensionActivation("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            authApi = extension.exports;
        }

        stepStart = trackTiming("Execute Commands Before", stepStart);

        // Initialize metadata manager
        stepStart = trackTiming("Initialize Metadata Manager", stepStart);
        notebookMetadataManager = NotebookMetadataManager.getInstance(context);
        await notebookMetadataManager.initialize();

        // Register project manager first to ensure it's available
        stepStart = trackTiming("Register Project Manager", stepStart);
        registerProjectManager(context);

        // Register welcome view provider
        stepStart = trackTiming("Register Welcome View", stepStart);
        registerWelcomeViewProvider(context);

        // // Now we can safely check if we need to show the welcome view
        // await showWelcomeViewIfNeeded();

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
                // DEBUGGING: Here is where the splash screen disappears - it was visible up till now
                await vscode.workspace.fs.stat(metadataUri);
                metadataExists = true;
            } catch {
                metadataExists = false;
            }

            if (!metadataExists) {
                console.log("metadata.json not found. Waiting for initialization.");
                await watchForInitialization(context, metadataUri);
            } else {
                // DEBUGGING: Here is where the splash screen reappears
                await initializeExtension(context, metadataExists);
            }
            // watchTableFiles(context);
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

        componentStart = trackTiming("• Register New Source Upload Commands", componentStart);
        await registerNewSourceUploadCommands(context);

        componentStart = trackTiming("• Register Providers", componentStart);
        registerProviders(context);

        componentStart = trackTiming("• Register Commands", componentStart);
        await registerCommands(context);

        componentStart = trackTiming("• Initialize Webviews", componentStart);
        await initializeWebviews(context);

        // Track total time for core components
        trackTiming("Total Core Components", stepStart);

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

        // Execute post-activation tasks
        stepStart = trackTiming("Post-activation Tasks", stepStart);
        await executeCommandsAfter();
        await temporaryMigrationScript_checkMatthewNotebook();
        await migration_changeDraftFolderToFilesFolder();
        await migrateSourceFiles();

        // Close splash screen and then check if we need to show the welcome view
        closeSplashScreen(async () => {
            console.log(
                "[Extension] Splash screen closed, checking if welcome view needs to be shown"
            );
            // Show tabs again after splash screen closes
            await vscode.workspace
                .getConfiguration()
                .update("workbench.editor.showTabs", "multiple", true);
            // Restore tab layout after splash screen closes
            await restoreTabLayout(context);
            // Check if we need to show the welcome view after initialization
            await showWelcomeViewIfNeeded();
        });

        // Instead of calling showWelcomeViewIfNeeded directly, it will be called by the splash screen callback
        // showWelcomeViewIfNeeded();
    } catch (error) {
        console.error("Error during extension activation:", error);
        vscode.window.showErrorMessage(`Failed to activate Codex Editor: ${error}`);
    }

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.openBookNameEditor", openBookNameEditor)
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.openCellLabelImporter", () =>
            openCellLabelImporter(context)
        )
    );
}

async function initializeExtension(context: vscode.ExtensionContext, metadataExists: boolean) {
    const initStart = globalThis.performance.now();
    let stepStart = initStart;

    console.log("Initializing extension");

    if (metadataExists) {
        // stepStart = trackTiming("• Register Text Selection Handler", stepStart);
        // registerTextSelectionHandler(context, () => undefined);

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
        // await indexVerseRefsInSourceText();

        stepStart = trackTiming("  • Create Context Index", stepStart);
        await createIndexWithContext(context);

        // stepStart = trackTiming("  • Create Table Indexes", stepStart);

        trackTiming("• Total Index Creation", indexStart);
    } else {
        // stepStart = trackTiming("• Show Project Overview (No Metadata)", stepStart);
        // vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
    }

    trackTiming("Total Initialize Extension", initStart);
}

let watcher: vscode.FileSystemWatcher | undefined;

// function watchTableFiles(context: vscode.ExtensionContext) {
//     const watcher = vscode.workspace.createFileSystemWatcher("**/*.{csv,tsv,tab}");

//     watcher.onDidChange(async (uri) => {
//         // Recreate the index for the changed file
//         const [records, fields] = await parseTableFile(uri);

//         if (fields.length === 0) {
//             tableIndexMap.delete(uri.fsPath);
//             console.warn(`Headers missing after change in ${uri.fsPath}. Index removed.`);
//             return;
//         }

//         const tableIndex = new MiniSearch<TableRecord>({
//             fields: fields,
//             storeFields: ["id", ...fields],
//             idField: "id",
//         });

//         tableIndex.addAll(records);

//         tableIndexMap.set(uri.fsPath, tableIndex);

//         console.log(`Updated index for file: ${uri.fsPath}`);
//     });

//     watcher.onDidCreate(async (uri) => {
//         // Create an index for the new file
//         const [records, fields] = await parseTableFile(uri);

//         if (fields.length === 0) {
//             console.warn(`No headers found in new table file: ${uri.fsPath}. Skipping file.`);
//             return;
//         }

//         const tableIndex = new MiniSearch<TableRecord>({
//             fields: fields,
//             storeFields: ["id", ...fields],
//             idField: "id",
//         });

//         tableIndex.addAll(records);

//         tableIndexMap.set(uri.fsPath, tableIndex);

//         console.log(`Created index for new file: ${uri.fsPath}`);
//     });

//     watcher.onDidDelete((uri) => {
//         // Remove the index for the deleted file
//         if (tableIndexMap.delete(uri.fsPath)) {
//             console.log(`Removed index for deleted file: ${uri.fsPath}`);
//         }
//     });

//     context.subscriptions.push(watcher);
// }

async function watchForInitialization(context: vscode.ExtensionContext, metadataUri: vscode.Uri) {
    watcher = vscode.workspace.createFileSystemWatcher("**/*");

    const checkInitialization = async () => {
        let metadataExists = false;
        try {
            await vscode.workspace.fs.stat(metadataUri);
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
}

function registerCodeLensProviders(context: vscode.ExtensionContext) {
    // registerReferencesCodeLens(context);
    // registerSourceCodeLens(context);
    // registerCompletionsCodeLensProviders(context);
}

async function executeCommandsBefore(context: vscode.ExtensionContext) {
    // Hide status bar
    await vscode.commands.executeCommand("workbench.action.toggleStatusbarVisibility");

    // Update settings for minimal UI   
    const config = vscode.workspace.getConfiguration();
    await config.update("workbench.statusBar.visible", false, true);
    await config.update("breadcrumbs.filePath", "last", true);
    await config.update("breadcrumbs.enabled", false, true); // hide breadcrumbs for now... it shows the file name which cannot be localized
    await config.update("workbench.editor.editorActionsLocation", "hidden", true);
    await config.update("workbench.editor.showTabs", "none", true); // Hide tabs during splash screen
    await config.update("window.autoDetectColorScheme", true, true);
    await config.update("workbench.editor.revealIfOpen", true, true);
    await config.update("workbench.layoutControl.enabled", true, true);
    await config.update("workbench.tips.enabled", false, true);
    await config.update("workbench.editor.limit.perEditorGroup", false, true);
    await config.update("workbench.editor.limit.value", 4, true);

    registerCommandsBefore(context);
}

async function executeCommandsAfter() {
    try {
        await vscode.commands.executeCommand(
            "codex-editor-extension.setEditorFontToTargetLanguage"
        );
    } catch (error) {
        console.warn("Failed to set editor font, possibly due to network issues:", error);
    }
    // Configure auto-save in settings
    await vscode.workspace
        .getConfiguration()
        .update("files.autoSave", "afterDelay", vscode.ConfigurationTarget.Global);
    await vscode.workspace
        .getConfiguration()
        .update("files.autoSaveDelay", 1000, vscode.ConfigurationTarget.Global);

    // Perform initial sync if auth API is available and user is authenticated
    if (authApi) {
        try {
            const authStatus = authApi.getAuthStatus();
            if (authStatus.isAuthenticated) {
                console.log("User is authenticated, performing initial sync");
                const syncStart = globalThis.performance.now();
                trackTiming("Starting Project Synchronization", syncStart);

                const syncManager = SyncManager.getInstance();
                // During startup, don't show info messages for connection issues
                try {
                    await syncManager.executeSync("Initial workspace sync", false);
                    trackTiming("Project Synchronization Complete", syncStart);
                } catch (error) {
                    console.error("Error during initial sync:", error);
                    trackTiming("Project Synchronization Failed", syncStart);
                }
            } else {
                console.log("User is not authenticated, skipping initial sync");
                trackTiming(
                    "Project Synchronization Skipped (Not Authenticated)",
                    globalThis.performance.now()
                );
            }
        } catch (error) {
            console.error("Error checking auth status or during initial sync:", error);
            trackTiming(
                "Project Synchronization Failed due to auth error",
                globalThis.performance.now()
            );
        }
    } else {
        console.log("Auth API not available, skipping initial sync");
        trackTiming(
            "Project Synchronization Skipped (Auth API Unavailable)",
            globalThis.performance.now()
        );
    }

    // Check if we need to show the welcome view after initialization
    // showWelcomeViewIfNeeded();
    await vscode.commands.executeCommand("workbench.action.evenEditorWidths");
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
