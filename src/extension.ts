import * as vscode from "vscode";
import { registerProviders } from "./providers/registerProviders";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { initializeWebviews } from "./activationHelpers/contextAware/webviewInitializers";
import { registerLanguageServer } from "./tsServer/registerLanguageServer";
import { registerClientCommands } from "./tsServer/registerClientCommands";
import registerClientOnRequests from "./tsServer/registerClientOnRequests";
import { registerSmartEditCommands } from "./smartEdits/registerSmartEditCommands";
import { LanguageClient } from "vscode-languageclient/node";
import { registerProjectManager } from "./projectManager";
import {
    temporaryMigrationScript_checkMatthewNotebook,
    migration_changeDraftFolderToFilesFolder,
    migration_chatSystemMessageSetting,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/contentIndexes/indexes";
import { registerSourceUploadCommands } from "./providers/SourceUpload/registerCommands";
import { migrateSourceFiles } from "./utils/codexNotebookUtils";
import { StatusBarItem } from "vscode";
import { Database } from "fts5-sql-bundle";
import {
    importWiktionaryJSONL,
    ingestJsonlDictionaryEntries,
    initializeSqlJs,
    registerLookupWordCommand,
} from "./sqldb";
import { registerStartupFlowCommands } from "./providers/StartupFlow/registerCommands";
import { registerPreflightCommand } from "./providers/StartupFlow/preflight";
import { NotebookMetadataManager } from "./utils/notebookMetadataManager";
import { waitForExtensionActivation } from "./utils/vscode";
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
    updateSplashScreenSync,
    closeSplashScreen,
} from "./providers/SplashScreen/register";
import { openBookNameEditor } from "./bookNameSettings/bookNameSettings";
import { openCellLabelImporter } from "./cellLabelImporter/cellLabelImporter";
import { checkForUpdatesOnStartup, registerUpdateCommands } from "./utils/updateChecker";
import { CommentsMigrator } from "./utils/commentsMigrationUtils";

export interface ActivationTiming {
    step: string;
    duration: number;
    startTime: number;
}

const activationTimings: ActivationTiming[] = [];
let currentStepTimer: NodeJS.Timeout | null = null;
let currentStepStartTime: number | null = null;
let currentStepName: string | null = null;
let lastStepEndTime: number | null = null;

function trackTiming(step: string, stepStartTime: number): number {
    const stepEndTime = globalThis.performance.now();
    const duration = stepEndTime - stepStartTime; // Duration of THIS step only

    activationTimings.push({ step, duration, startTime: stepStartTime });
    console.log(`[Activation] ${step}: ${duration.toFixed(2)}ms`);

    // Stop any previous real-time timer
    if (currentStepTimer) {
        clearInterval(currentStepTimer);
        currentStepTimer = null;
    }

    // Update splash screen with latest timing information
    updateSplashScreenTimings(activationTimings);

    lastStepEndTime = stepEndTime;
    return stepEndTime; // Return the END time for the next step to use as its start time
}

function startRealtimeStep(stepName: string): number {
    const startTime = globalThis.performance.now();

    // Stop any previous timer
    if (currentStepTimer) {
        clearInterval(currentStepTimer);
    }

    currentStepName = stepName;
    currentStepStartTime = startTime;

    // Add initial timing entry
    activationTimings.push({ step: stepName, duration: 0, startTime });
    updateSplashScreenTimings(activationTimings);

    // Start real-time updates every 100ms
    currentStepTimer = setInterval(() => {
        if (currentStepStartTime && currentStepName) {
            const currentDuration = globalThis.performance.now() - currentStepStartTime;

            // Update the last timing entry with current duration
            const lastIndex = activationTimings.length - 1;
            if (lastIndex >= 0 && activationTimings[lastIndex].step === currentStepName) {
                activationTimings[lastIndex].duration = currentDuration;
                updateSplashScreenTimings(activationTimings);
            }
        }
    }, 100) as unknown as NodeJS.Timeout;

    return startTime;
}

function finishRealtimeStep(): number {
    if (currentStepTimer) {
        clearInterval(currentStepTimer);
        currentStepTimer = null;
    }

    if (currentStepStartTime && currentStepName) {
        const finalDuration = globalThis.performance.now() - currentStepStartTime;

        // Update the last timing entry with final duration
        const lastIndex = activationTimings.length - 1;
        if (lastIndex >= 0 && activationTimings[lastIndex].step === currentStepName) {
            activationTimings[lastIndex].duration = finalDuration;
            updateSplashScreenTimings(activationTimings);
            console.log(`[Activation] ${currentStepName}: ${finalDuration.toFixed(2)}ms`);
        }
    }

    currentStepName = null;
    currentStepStartTime = null;

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
        trackTiming("Initializing Splash Screen", splashStart);
    } catch (error) {
        console.error("Error showing splash screen:", error);
        // Continue with activation even if splash screen fails
    }

    let stepStart = activationStart;

    try {
        // Configure editor layout
        const layoutStart = globalThis.performance.now();
        // Use maximizeEditorHideSidebar directly to create a clean, focused editor experience on startup
        // note: there may be no active editor yet, so we need to see if the welcome view is needed initially
        await vscode.commands.executeCommand("workbench.action.maximizeEditorHideSidebar");
        stepStart = trackTiming("Configuring Editor Layout", layoutStart);

        // Setup pre-activation commands
        const preCommandsStart = globalThis.performance.now();
        await executeCommandsBefore(context);
        stepStart = trackTiming("Setting up Pre-activation Commands", preCommandsStart);

        // Initialize metadata manager
        const metadataStart = globalThis.performance.now();
        notebookMetadataManager = NotebookMetadataManager.getInstance(context);
        await notebookMetadataManager.initialize();
        stepStart = trackTiming("Loading Project Metadata", metadataStart);

        // Migrate comments early during project startup
        const migrationStart = globalThis.performance.now();
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            try {
                await CommentsMigrator.migrateProjectComments(vscode.workspace.workspaceFolders[0].uri);
            } catch (error) {
                console.error("[Extension] Error during startup comments migration:", error);
                // Don't fail startup due to migration errors
            }
        }
        stepStart = trackTiming("Migrating Legacy Comments", migrationStart);

        // Initialize Frontier API first - needed before startup flow
        const authStart = globalThis.performance.now();
        const extension = await waitForExtensionActivation("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            authApi = extension.exports;
        }
        stepStart = trackTiming("Connecting Authentication Service", authStart);

        // Run independent initialization steps in parallel (excluding auth which is needed by startup flow)
        const parallelInitStart = globalThis.performance.now();
        await Promise.all([
            // Register project manager first to ensure it's available
            registerProjectManager(context),
            // Register welcome view provider
            registerWelcomeViewProvider(context),
        ]);
        stepStart = trackTiming("Setting up Basic Components", parallelInitStart);

        // Register startup flow commands after auth is available
        const startupStart = globalThis.performance.now();
        await registerStartupFlowCommands(context);
        registerPreflightCommand(context);
        stepStart = trackTiming("Configuring Startup Workflow", startupStart);

        // Initialize SqlJs with real-time progress since it loads WASM files
        // Only initialize database if we have a workspace (database is for project content)
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            startRealtimeStep("Loading Database Engine");
            try {
                global.db = await initializeSqlJs(context);

            } catch (error) {
                console.error("Error initializing SqlJs:", error);
            }
            stepStart = finishRealtimeStep();
            if (global.db) {
                const importCommand = vscode.commands.registerCommand(
                    "extension.importWiktionaryJSONL",
                    () => global.db && importWiktionaryJSONL(global.db)
                );
                context.subscriptions.push(importCommand);
                registerLookupWordCommand(global.db, context);
                ingestJsonlDictionaryEntries(global.db);
            }
        } else {
            // No workspace, skip database initialization
            stepStart = trackTiming("Loading Database Engine (skipped - no workspace)", globalThis.performance.now());
        }

        vscode.workspace.getConfiguration().update("workbench.startupEditor", "none", true);

        // Initialize extension based on workspace state
        const workspaceStart = globalThis.performance.now();
        if (workspaceFolders && workspaceFolders.length > 0) {
            if (!vscode.workspace.isTrusted) {

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

            trackTiming("Initializing Workspace", workspaceStart);

            // Always initialize extension to ensure language server is available before webviews
            await initializeExtension(context, metadataExists);

            if (!metadataExists) {
                const watchStart = globalThis.performance.now();
                await watchForInitialization(context, metadataUri);
                trackTiming("Watching for Initialization", watchStart);
            }
        } else {
            vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
            trackTiming("Initializing Workspace", workspaceStart);
        }

        // Register remaining components in parallel
        const coreComponentsStart = globalThis.performance.now();

        await Promise.all([
            registerSmartEditCommands(context),
            registerSourceUploadCommands(context),
            registerProviders(context),
            registerCommands(context),
            initializeWebviews(context),
        ]);

        // Track total time for core components
        stepStart = trackTiming("Loading Core Components", coreComponentsStart);

        // Initialize status bar
        const statusBarStart = globalThis.performance.now();
        autoCompleteStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        autoCompleteStatusBarItem.text = "$(sync~spin) Auto-completing...";
        autoCompleteStatusBarItem.hide();
        context.subscriptions.push(autoCompleteStatusBarItem);
        stepStart = trackTiming("Initializing Status Bar", statusBarStart);

        // Show activation summary
        const totalDuration = globalThis.performance.now() - activationStart;
        // Don't add "Total Activation Time" to timings array since it's already calculated above
        console.log(`[Activation] Total Activation Time: ${totalDuration.toFixed(2)}ms`);

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
        const postActivationStart = globalThis.performance.now();
        await executeCommandsAfter(context);
        await migration_chatSystemMessageSetting();
        await temporaryMigrationScript_checkMatthewNotebook();
        await migration_changeDraftFolderToFilesFolder();
        await migrateSourceFiles();
        trackTiming("Running Post-activation Tasks", postActivationStart);

        // Register update commands and check for updates (non-blocking)
        registerUpdateCommands(context);

        // Don't close splash screen yet - we still have sync operations to show
        // The splash screen will be closed after all operations complete
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

    console.log("Initializing extension");

    if (metadataExists) {
        // Break down language server initialization
        const totalLsStart = globalThis.performance.now();

        startRealtimeStep("Initializing Language Server");
        const lsStart = globalThis.performance.now();
        client = await registerLanguageServer(context);
        const lsDuration = globalThis.performance.now() - lsStart;
        console.log(`[Activation]  Start Language Server: ${lsDuration.toFixed(2)}ms`);

        // Always register client commands to prevent "command not found" errors
        // If language server failed, commands will return appropriate fallbacks
        const regServicesStart = globalThis.performance.now();
        clientCommandsDisposable = registerClientCommands(context, client);
        context.subscriptions.push(clientCommandsDisposable);
        const regServicesDuration = globalThis.performance.now() - regServicesStart;
        console.log(`[Activation]  Register Language Services: ${regServicesDuration.toFixed(2)}ms`);

        if (client && global.db) {
            const optimizeStart = globalThis.performance.now();
            try {
                await registerClientOnRequests(client, global.db);
                await client.start();
            } catch (error) {
                console.error("Error registering client requests:", error);
            }
            const optimizeDuration = globalThis.performance.now() - optimizeStart;
            console.log(`[Activation]  Optimize Language Processing: ${optimizeDuration.toFixed(2)}ms`);
        } else {
            if (!client) {
                console.warn("Language server failed to initialize - spellcheck and alert features will use fallback behavior");
            }
            if (!global.db) {
                console.info("[Database] Database not available - dictionary features will be limited. This is normal during initial setup or if database initialization failed.");
            }
        }
        finishRealtimeStep();
        const totalLsDuration = globalThis.performance.now() - totalLsStart;
        console.log(`[Activation] Language Server Ready: ${totalLsDuration.toFixed(2)}ms`);

        // Break down index creation  
        const totalIndexStart = globalThis.performance.now();

        const verseRefsStart = globalThis.performance.now();
        // Index verse refs would go here, but it seems to be missing from this section
        const verseRefsDuration = globalThis.performance.now() - verseRefsStart;
        console.log(`[Activation]  Index Verse Refs: ${verseRefsDuration.toFixed(2)}ms`);

        // Use real-time progress for context index setup since it can take a while
        // Note: SQLiteIndexManager handles its own detailed progress tracking
        startRealtimeStep("Initializing Search Database");
        await createIndexWithContext(context);
        finishRealtimeStep();

        // Don't track "Total Index Creation" since it would show cumulative time
        // The individual steps above already show the breakdown
        const totalIndexDuration = globalThis.performance.now() - totalIndexStart;
        console.log(`[Activation] Total Index Creation: ${totalIndexDuration.toFixed(2)}ms`);

        // Perform initial sync during splash screen phase if auth API is available and user is authenticated
        updateSplashScreenSync(60, "Checking authentication...");
        console.log("🔄 [SPLASH SCREEN PHASE] Starting sync during splash screen...");

        if (authApi) {
            try {
                const authStatus = authApi.getAuthStatus();
                if (authStatus.isAuthenticated) {
                    console.log("🔄 [SPLASH SCREEN PHASE] User is authenticated, performing initial sync during splash screen");
                    updateSplashScreenSync(70, "Synchronizing project...");
                    const syncStart = globalThis.performance.now();

                    const syncManager = SyncManager.getInstance();
                    // During startup, don't show info messages for connection issues
                    try {
                        await syncManager.executeSync("Initial workspace sync", false);
                        trackTiming("Completing Project Synchronization", syncStart);
                        updateSplashScreenSync(100, "Synchronization complete");
                        console.log("✅ [SPLASH SCREEN PHASE] Sync completed during splash screen");
                    } catch (error) {
                        console.error("❌ [SPLASH SCREEN PHASE] Error during initial sync:", error);
                        trackTiming("Failing Project Synchronization", syncStart);
                        updateSplashScreenSync(100, "Synchronization failed");
                    }
                } else {
                    console.log("⏭️ [SPLASH SCREEN PHASE] User is not authenticated, skipping initial sync");
                    updateSplashScreenSync(85, "Skipping sync (not authenticated)");
                    const skipStart = globalThis.performance.now();
                    // Just log this, no need to track timing for a skip
                    console.log(`[Activation] Project Synchronization Skipped (Not Authenticated): 0ms`);
                }
            } catch (error) {
                console.error("❌ [SPLASH SCREEN PHASE] Error checking auth status or during initial sync:", error);
                updateSplashScreenSync(85, "Authentication error");
                const errorStart = globalThis.performance.now();
                // Just log this, no need to track timing for an error
                console.log(`[Activation] Project Synchronization Failed due to auth error: 0ms`);
            }
        } else {
            console.log("⏭️ [SPLASH SCREEN PHASE] Auth API not available, skipping initial sync");
            updateSplashScreenSync(85, "Skipping sync (offline mode)");
            // Just log this, no need to track timing for a skip
            console.log(`[Activation] Project Synchronization Skipped (Auth API Unavailable): 0ms`);
        }
    }

    // Calculate and log total initialize extension time but don't add to main timing array
    // since it's a summary of the sub-steps already tracked
    const totalInitDuration = globalThis.performance.now() - initStart;
    console.log(`[Activation] Total Initialize Extension: ${totalInitDuration.toFixed(2)}ms`);
}

let watcher: vscode.FileSystemWatcher | undefined;

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

async function executeCommandsBefore(context: vscode.ExtensionContext) {
    // Start status bar command non-blocking
    void vscode.commands.executeCommand("workbench.action.toggleStatusbarVisibility");

    // Batch all config updates with Promise.all instead of sequential awaits
    const config = vscode.workspace.getConfiguration();
    await Promise.all([
        config.update("workbench.statusBar.visible", false, true),
        config.update("breadcrumbs.filePath", "last", true),
        config.update("breadcrumbs.enabled", false, true), // hide breadcrumbs for now... it shows the file name which cannot be localized
        config.update("workbench.editor.editorActionsLocation", "hidden", true),
        config.update("workbench.editor.showTabs", "none", true), // Hide tabs during splash screen
        config.update("window.autoDetectColorScheme", true, true),
        config.update("workbench.editor.revealIfOpen", true, true),
        config.update("workbench.layoutControl.enabled", false, true),
        config.update("workbench.tips.enabled", false, true),
        config.update("workbench.editor.limit.perEditorGroup", false, true),
        config.update("workbench.editor.limit.value", 4, true),
    ]);

    registerCommandsBefore(context);
}

async function executeCommandsAfter(context: vscode.ExtensionContext) {
    try {
        // Update splash screen for post-activation tasks
        updateSplashScreenSync(90, "Configuring editor settings...");

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

    // Final splash screen update and close
    updateSplashScreenSync(100, "Finalizing setup...");

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

    await vscode.commands.executeCommand("workbench.action.evenEditorWidths");

    // Check for updates in the background after everything else is ready
    checkForUpdatesOnStartup(context).catch(error => {
        console.error('[Extension] Error during startup update check:', error);
    });
}

export function deactivate() {
    // Clean up real-time progress timer
    if (currentStepTimer) {
        clearInterval(currentStepTimer);
        currentStepTimer = null;
    }

    if (clientCommandsDisposable) {
        clientCommandsDisposable.dispose();
    }
    if (client) {
        return client.stop();
    }
    if (global.db) {
        global.db.close();
    }

    // Clean up the global index manager
    import("./activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager").then(
        ({ clearSQLiteIndexManager }) => {
            clearSQLiteIndexManager();
        }
    ).catch(console.error);
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
