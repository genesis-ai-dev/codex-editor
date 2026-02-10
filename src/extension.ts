import * as vscode from "vscode";
import { registerProviders } from "./providers/registerProviders";
import { GlobalProvider } from "./globalProvider";
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
    migration_lineNumbersSettings,
    migration_editHistoryFormat,
    migration_addMilestoneCells,
    migration_reorderMisplacedParatextCells,
    migration_addGlobalReferences,
    migration_cellIdsToUuid,
    migration_recoverTempFilesAndMergeDuplicates,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/contentIndexes/indexes";
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
import { MetadataManager, registerMetadataCommands } from "./utils/metadataManager";
import { openCellLabelImporter } from "./cellLabelImporter/cellLabelImporter";
import { openCodexMigrationTool } from "./codexMigrationTool/codexMigrationTool";
import { CodexCellEditorProvider } from "./providers/codexCellEditorProvider/codexCellEditorProvider";
import { checkForUpdatesOnStartup, registerUpdateCommands } from "./utils/updateChecker";
import { checkIfMetadataAndGitIsInitialized } from "./projectManager/utils/projectUtils";
import { CommentsMigrator } from "./utils/commentsMigrationUtils";
import { initializeABTesting } from "./utils/abTestingSetup";
import {
    migration_addValidationsForUserEdits,
    migration_moveTimestampsToMetadataData,
    migration_promoteCellTypeToTopLevel,
    migration_addImporterTypeToMetadata,
    migration_hoistDocumentContextToNotebookMetadata,
} from "./projectManager/utils/migrationUtils";
import { initializeAudioProcessor } from "./utils/audioProcessor";
import { initializeAudioMerger } from "./utils/audioMerger";
import { createStartupStatusBar, StartupStatusBar } from "./utils/startupStatusBar";
import * as os from "os";
import * as path from "path";

const DEBUG_MODE = false;
function debug(...args: unknown[]): void {
    if (DEBUG_MODE) {
        console.log("[Extension]", ...args);
    }
}

declare global {
    // eslint-disable-next-line
    var db: Database | undefined;
}

let client: LanguageClient | undefined;
let clientCommandsDisposable: vscode.Disposable;
let autoCompleteStatusBarItem: StatusBarItem;
let notebookMetadataManager: NotebookMetadataManager;
let authApi: FrontierAPI | undefined;
let authInitPromise: Promise<void> | null = null;
let authInitComplete = false;

// Flag to prevent welcome view from showing during startup
let isStartupInProgress = true;

export function isStartingUp(): boolean {
    return isStartupInProgress;
}

export function setStartupComplete(): void {
    isStartupInProgress = false;
}

export async function activate(context: vscode.ExtensionContext): Promise<void> {
    const activationStart = performance.now();

    // 1. Create status bar indicator (replaces splash screen)
    const statusBar = createStartupStatusBar(context);
    statusBar.show("Initializing...");

    // Ensure OS temp directory exists in test/web environments
    try {
        const tmp = os.tmpdir();
        const tmpUri = vscode.Uri.file(tmp);
        await vscode.workspace.fs.createDirectory(tmpUri);
    } catch (e) {
        console.warn("[Extension] Could not ensure temp directory exists:", e);
    }

    // Initialize audio processors (lightweight, synchronous setup)
    initializeAudioProcessor(context);
    initializeAudioMerger(context);

    // CRITICAL: Initialize NotebookMetadataManager BEFORE providers (they depend on it)
    try {
        notebookMetadataManager = NotebookMetadataManager.getInstance(context);
        await notebookMetadataManager.initialize();
    } catch (error) {
        console.error("[Extension] Error initializing NotebookMetadataManager:", error);
    }

    // 2. Register ALL providers immediately (synchronous/fast operations)
    try {
        // Register project manager and welcome view first
        await registerProjectManager(context);
        registerWelcomeViewProvider(context);

        // Register all other providers
        await Promise.all([
            registerSmartEditCommands(context),
            registerProviders(context),
            registerCommands(context),
            initializeWebviews(context),
            (async () => registerTestingCommands(context))(),
        ]);

        // Register metadata commands for frontier-authentication to call
        registerMetadataCommands(context);

        // Register startup flow commands
        await registerStartupFlowCommands(context);
        registerPreflightCommand(context);

        // Register remote updating commands (for admins to force project updating)
        const { registerRemoteUpdatingCommands } = await import("./commands/remoteUpdatingCommands");
        registerRemoteUpdatingCommands(context);

        // Register project swap commands (for instance admins to swap repositories)
        const { registerProjectSwapCommands } = await import("./commands/projectSwapCommands");
        registerProjectSwapCommands(context);

        // Initialize status bar for auto-complete
        autoCompleteStatusBarItem = vscode.window.createStatusBarItem(
            vscode.StatusBarAlignment.Right,
            100
        );
        autoCompleteStatusBarItem.text = "$(sync~spin) Auto-completing...";
        autoCompleteStatusBarItem.hide();
        context.subscriptions.push(autoCompleteStatusBarItem);

        // Initialize A/B testing registry
        initializeABTesting();

    } catch (error) {
        console.error("Error registering providers:", error);
    }

    // Register additional commands
    registerAdditionalCommands(context);

    console.log(`[Activation] UI ready in ${(performance.now() - activationStart).toFixed(0)}ms`);

    // 3. Fire-and-forget background initialization
    void initializeInBackground(context, statusBar);
}

/**
 * Background initialization - all heavy operations run concurrently
 */
async function initializeInBackground(
    context: vscode.ExtensionContext,
    statusBar: StartupStatusBar
): Promise<void> {
    const bgStart = performance.now();

    try {
        statusBar.update("Setting up workspace...");

        // Execute pre-activation commands
        await executeCommandsBefore(context);

        // Check for untrusted workspace early
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0 && !vscode.workspace.isTrusted) {
            statusBar.complete("Workspace needs trust");
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
            setTimeout(() => statusBar.hide(), 3000);
            return;
        }

        // Run initialization tasks concurrently
        // Note: NotebookMetadataManager is already initialized in activate() before providers
        // Store auth promise so other code can wait for it
        authInitPromise = initializeAuth(statusBar);
        const initTasks: Promise<void>[] = [
            authInitPromise,
        ];

        // Add workspace-specific tasks only if we have a workspace
        if (workspaceFolders && workspaceFolders.length > 0) {
            initTasks.push(initializeDatabase(context, statusBar));
            initTasks.push(migrateComments(statusBar));
            initTasks.push(updateGitConfig(statusBar));

            // Check for pending swap downloads (after workspace is ready)
            checkPendingSwapDownloads(workspaceFolders[0].uri).catch(err => {
                console.error("[Extension] Error checking pending swap downloads:", err);
            });
        }

        await Promise.allSettled(initTasks);

        // Check for existing project and initialize extension
        if (workspaceFolders && workspaceFolders.length > 0) {
            const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
            let metadataExists = false;
            try {
                await vscode.workspace.fs.stat(metadataUri);
                metadataExists = true;

                // Ensure all installed extension versions are recorded in metadata
                try {
                    await MetadataManager.ensureExtensionVersionsRecorded(workspaceFolders[0].uri);
                } catch (error) {
                    console.warn("[Extension] Error ensuring extension version requirements:", error);
                }
            } catch {
                metadataExists = false;
            }

            // Check for pending project creation
            await handlePendingProjectCreation(context);

            // Initialize language server and indexing (depends on metadata)
            if (metadataExists) {
                statusBar.update("Starting language server...");
                await initializeLanguageServerAndIndex(context, statusBar);
            } else {
                // Watch for project initialization
                await watchForInitialization(context, metadataUri);
            }

            // Ensure local project settings exist
            try {
                const projectUri = workspaceFolders[0].uri;
                const gitDir = vscode.Uri.joinPath(projectUri, ".git");
                await vscode.workspace.fs.stat(gitDir);
                const { afterProjectDetectedEnsureLocalSettings } = await import("./projectManager/utils/projectUtils");
                await afterProjectDetectedEnsureLocalSettings(projectUri);
            } catch {
                // No .git yet; skip
            }
        } else {
            // No workspace - show project overview
            vscode.commands.executeCommand("codex-project-manager.showProjectOverview");
        }

        // Run post-activation tasks
        statusBar.update("Running migrations...");
        await runMigrations(context);

        // Sync if authenticated and have a project
        statusBar.update("Syncing...");
        await runInitialSync(context);

        // Execute post-activation commands
        await executeCommandsAfter(context);

        // Mark startup as complete - welcome view can now show when all editors are closed
        setStartupComplete();

        // Show welcome view if no editors are open
        await showWelcomeViewIfNeeded();

        // Run preflight check now that auth and other services are initialized
        // This ensures the startup flow only opens if actually needed
        vscode.commands.executeCommand("codex-project-manager.preflight");

        // Register update commands and check for updates
        registerUpdateCommands(context);
        checkForUpdatesOnStartup(context).catch(error => {
            console.error('[Extension] Error during startup update check:', error);
        });

        const bgDuration = performance.now() - bgStart;
        console.log(`[Activation] Background initialization completed in ${bgDuration.toFixed(0)}ms`);

        statusBar.complete("Ready");
        setTimeout(() => statusBar.hide(), 3000);

    } catch (error) {
        console.error("Error during background initialization:", error);
        statusBar.complete("Ready (with errors)");
        setTimeout(() => statusBar.hide(), 3000);
        // Still mark startup complete even on error so welcome view can work
        setStartupComplete();
    }
}

/**
 * Initialize authentication API
 */
async function initializeAuth(statusBar: StartupStatusBar): Promise<void> {
    try {
        statusBar.update("Connecting authentication...");
        const extension = await waitForExtensionActivation("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            authApi = extension.exports;
        }
    } catch (error) {
        console.error("[Extension] Error initializing auth:", error);
    } finally {
        authInitComplete = true;
    }
}

/**
 * Initialize SQLite database for dictionary/search
 */
async function initializeDatabase(context: vscode.ExtensionContext, statusBar: StartupStatusBar): Promise<void> {
    try {
        statusBar.update("Preparing search...");
        global.db = await initializeSqlJs(context);

        if (global.db) {
            const importCommand = vscode.commands.registerCommand(
                "extension.importWiktionaryJSONL",
                () => global.db && importWiktionaryJSONL(global.db)
            );
            context.subscriptions.push(importCommand);
            registerLookupWordCommand(global.db, context);
            ingestJsonlDictionaryEntries(global.db);
        }
    } catch (error) {
        console.error("[Extension] Error initializing database:", error);
    }
}

/**
 * Migrate comments early during startup
 */
async function migrateComments(statusBar: StartupStatusBar): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    try {
        statusBar.update("Migrating comments...");
        await CommentsMigrator.migrateProjectComments(workspaceFolders[0].uri);

        // Also repair any existing corrupted data
        const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
        CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true).catch(() => {
            // Silent fallback
        });
    } catch (error) {
        console.error("[Extension] Error during comments migration:", error);
    }
}

/**
 * Update git configuration files
 */
async function updateGitConfig(statusBar: StartupStatusBar): Promise<void> {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders || workspaceFolders.length === 0) return;

    try {
        statusBar.update("Updating git config...");
        const { ensureGitConfigsAreUpToDate } = await import("./projectManager/utils/projectUtils");
        await ensureGitConfigsAreUpToDate();
        debug("[Extension] Git configuration files updated");
    } catch (error) {
        console.error("[Extension] Error updating git config:", error);
    }
}

/**
 * Initialize language server and content indexing
 */
async function initializeLanguageServerAndIndex(
    context: vscode.ExtensionContext,
    statusBar: StartupStatusBar
): Promise<void> {
    try {
        // Start language server
        statusBar.update("Starting language server...");
        client = await registerLanguageServer(context);

        // Register client commands
        clientCommandsDisposable = registerClientCommands(context, client);
        context.subscriptions.push(clientCommandsDisposable);

        if (client && global.db) {
            try {
                await registerClientOnRequests(client, global.db);
                await client.start();
            } catch (error) {
                console.error("Error starting language client:", error);
            }
        } else {
            if (!client) {
                console.warn("Language server failed to initialize - spellcheck will use fallback");
            }
            if (!global.db) {
                console.info("[Database] Dictionary not available - dictionary features limited");
            }
        }

        // Create content indexes
        statusBar.update("Indexing content...");
        await createIndexWithContext(context);

    } catch (error) {
        console.error("[Extension] Error initializing language server:", error);
    }
}

/**
 * Handle pending project creation after reload
 */
async function handlePendingProjectCreation(context: vscode.ExtensionContext): Promise<void> {
    const pendingCreate = context.globalState.get("pendingProjectCreate");
    if (!pendingCreate) return;

    const pendingName = context.globalState.get<string>("pendingProjectCreateName");
    const pendingProjectId = context.globalState.get<string>("pendingProjectCreateId");
    debug("[Extension] Resuming project creation for:", pendingName);

    // Clear flags
    await context.globalState.update("pendingProjectCreate", undefined);
    await context.globalState.update("pendingProjectCreateName", undefined);
    await context.globalState.update("pendingProjectCreateId", undefined);

    try {
        const { createNewProject } = await import("./utils/projectCreationUtils/projectCreationUtils");
        await createNewProject({ projectName: pendingName, projectId: pendingProjectId });
    } catch (error) {
        console.error("Failed to resume project creation:", error);
        vscode.window.showErrorMessage("Failed to create project after reload.");
    }
}

/**
 * Run all migrations
 */
async function runMigrations(context: vscode.ExtensionContext): Promise<void> {
    try {
        await temporaryMigrationScript_checkMatthewNotebook();
        await migration_changeDraftFolderToFilesFolder();
        await migration_lineNumbersSettings(context);
        await migration_moveTimestampsToMetadataData(context);
        await migration_promoteCellTypeToTopLevel(context);
        await migration_editHistoryFormat(context);
        await migration_addImporterTypeToMetadata(context);
        await migration_hoistDocumentContextToNotebookMetadata(context);
        await migration_addMilestoneCells(context);
        await migration_reorderMisplacedParatextCells(context);
        await migration_addGlobalReferences(context);
        await migration_cellIdsToUuid(context);
        await migration_recoverTempFilesAndMergeDuplicates(context);
    } catch (error) {
        console.error("[Extension] Error running migrations:", error);
    }
}

/**
 * Run initial sync after migrations
 */
async function runInitialSync(context: vscode.ExtensionContext): Promise<void> {
    try {
        const hasCodexProject = await checkIfMetadataAndGitIsInitialized();
        if (!hasCodexProject) return;

        const workspaceFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

        // Disable VS Code Git before sync operations
        const { ensureGitDisabledInSettings, validateAndFixProjectMetadata } = await import("./projectManager/utils/projectUtils");
        await ensureGitDisabledInSettings();

        // Auto-fix metadata structure (scope, name) on startup
        try {
            if (vscode.workspace.workspaceFolders?.[0]) {
                await validateAndFixProjectMetadata(vscode.workspace.workspaceFolders[0].uri);
            }
        } catch (e) {
            console.error("Error validating metadata on startup:", e);
        }

        const api = getAuthApi();
        if (!api || typeof (api as { getAuthStatus?: () => { isAuthenticated: boolean } }).getAuthStatus !== "function") return;

        const authStatus = (api as { getAuthStatus: () => { isAuthenticated: boolean } }).getAuthStatus();
        if (!authStatus.isAuthenticated) return;

        // Validate and fix projectId/projectName AFTER migrations complete
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            try {
                const { validateAndFixProjectId } = await import("./utils/projectIdValidator");
                await validateAndFixProjectId(workspaceFolders[0].uri);
            } catch (validationError) {
                console.error("[Extension] Error validating projectId after migrations:", validationError);
            }
        }

        // Check if this is an update workspace
        const pendingUpdateSync = context.globalState.get<{
            projectPath?: string;
            commitMessage?: string;
            showSuccessMessage?: boolean;
            projectName?: string;
            backupFileName?: string;
        }>("codex.pendingUpdateSync");
        const isUpdateWorkspace =
            !!pendingUpdateSync &&
            typeof pendingUpdateSync.projectPath === "string" &&
            typeof workspaceFolderPath === "string" &&
            path.normalize(pendingUpdateSync.projectPath) === path.normalize(workspaceFolderPath);

        const syncManager = SyncManager.getInstance();
        if (isUpdateWorkspace && pendingUpdateSync?.commitMessage) {
            await syncManager.executeSync(String(pendingUpdateSync.commitMessage), true, context, false);
            await context.globalState.update("codex.pendingUpdateSync", undefined);
            if (pendingUpdateSync?.showSuccessMessage) {
                const projectName = pendingUpdateSync?.projectName || "Project";
                const backupFileName = pendingUpdateSync?.backupFileName;
                vscode.window.showInformationMessage(
                    backupFileName
                        ? `Project "${projectName}" has been updated and synced successfully! Backup saved to: ${backupFileName}`
                        : `Project "${projectName}" has been updated and synced successfully!`
                );
            }
        } else {
            await syncManager.executeSync("Initial workspace sync", true, context, false);
        }
    } catch (error) {
        console.error("[Extension] Error during initial sync:", error);
    }
}

let watcher: vscode.FileSystemWatcher | undefined;

async function watchForInitialization(context: vscode.ExtensionContext, metadataUri: vscode.Uri): Promise<void> {
    watcher = vscode.workspace.createFileSystemWatcher("**/*");

    const statusBar = createStartupStatusBar(context);

    const checkInitialization = async (): Promise<void> => {
        let metadataExists = false;
        try {
            await vscode.workspace.fs.stat(metadataUri);
            metadataExists = true;
        } catch {
            metadataExists = false;
        }

        if (metadataExists) {
            watcher?.dispose();
            await initializeLanguageServerAndIndex(context, statusBar);
        }
    };

    watcher.onDidCreate(checkInitialization);
    watcher.onDidChange(checkInitialization);
    watcher.onDidDelete(checkInitialization);

    context.subscriptions.push(watcher);
}

async function executeCommandsBefore(context: vscode.ExtensionContext): Promise<void> {
    // Start status bar command non-blocking
    void vscode.commands.executeCommand("workbench.action.toggleStatusbarVisibility");

    // Batch all config updates
    const config = vscode.workspace.getConfiguration();
    await Promise.all([
        config.update("workbench.statusBar.visible", false, true),
        config.update("breadcrumbs.filePath", "last", true),
        config.update("breadcrumbs.enabled", false, true),
        config.update("workbench.editor.editorActionsLocation", "hidden", true),
        config.update("workbench.editor.showTabs", "multiple", true),
        config.update("window.autoDetectColorScheme", true, true),
        config.update("workbench.editor.revealIfOpen", true, true),
        config.update("workbench.layoutControl.enabled", false, true),
        config.update("workbench.tips.enabled", false, true),
        config.update("workbench.editor.limit.perEditorGroup", false, true),
        config.update("workbench.editor.limit.value", 10, true),
        config.update("workbench.startupEditor", "none", true),
    ]);

    registerCommandsBefore(context);
}

async function executeCommandsAfter(context: vscode.ExtensionContext): Promise<void> {
    // Set editor font - non-critical, silently skip if command not available
    try {
        await vscode.commands.executeCommand("codex-editor-extension.setEditorFontToTargetLanguage");
    } catch {
        // Command may not be registered yet or font setting may fail - not critical
    }

    // Configure auto-save
    await vscode.workspace.getConfiguration().update("files.autoSave", "afterDelay", vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration().update("files.autoSaveDelay", 1000, vscode.ConfigurationTarget.Global);
    await vscode.workspace.getConfiguration().update("codex-project-manager.spellcheckIsEnabled", false, vscode.ConfigurationTarget.Global);

    await vscode.commands.executeCommand("workbench.action.evenEditorWidths");
}

/**
 * Register additional commands that don't need to be in the critical path
 */
function registerAdditionalCommands(context: vscode.ExtensionContext): void {
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.openCellLabelImporter", () =>
            openCellLabelImporter(context)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor.openCodexMigrationTool", () =>
            openCodexMigrationTool(context)
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.migrateValidationsForUserEdits",
            async () => {
                await migration_addValidationsForUserEdits();
            }
        )
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.focusCommentsView", () => {
            vscode.commands.executeCommand("comments-sidebar.focus");
        })
    );

    // Ensure sync commands exist
    void (async () => {
        try {
            const cmds = await vscode.commands.getCommands(true);
            if (!cmds.includes("extension.scheduleSync")) {
                const { SyncManager } = await import("./projectManager/syncManager");
                context.subscriptions.push(
                    vscode.commands.registerCommand("extension.scheduleSync", (message: string) => {
                        const syncManager = SyncManager.getInstance();
                        syncManager.scheduleSyncOperation(message);
                    })
                );
            }
        } catch (err) {
            console.warn("Failed to ensure scheduleSync registration", err);
        }
    })();

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.navigateToCellInComments", (cellId: string) => {
            const commentsProvider = GlobalProvider.getInstance().getProvider("comments-sidebar") as { _view?: { webview: { postMessage: (msg: unknown) => void } } } | undefined;
            if (commentsProvider?._view) {
                commentsProvider._view.webview.postMessage({
                    command: "reload",
                    data: { cellId },
                });
            }
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.generateTranscriptions", async () => {
            const countInput = await vscode.window.showInputBox({
                prompt: "How many cells to transcribe?",
                placeHolder: "e.g., 5",
                validateInput: (val) => (val && !isNaN(Number(val)) && Number(val) >= 1 ? undefined : "Enter a positive number"),
            });
            if (!countInput) return;
            const count = Math.max(1, Math.floor(Number(countInput)));

            const provider = GlobalProvider.getInstance().getProvider("codex-cell-editor") as CodexCellEditorProvider | undefined;
            if (!provider) {
                vscode.window.showErrorMessage("Open a Codex cell editor to run this command.");
                return;
            }

            provider.postMessageToWebviews({ type: "startBatchTranscription", content: { count } } as { type: string; content: { count: number } });
            vscode.window.showInformationMessage(`Starting transcription for up to ${count} cells...`);
        })
    );

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.comments-sidebar.reload", (options: unknown) => {
            const commentsProvider = GlobalProvider.getInstance().getProvider("comments-sidebar") as { _view?: { webview: { postMessage: (msg: unknown) => void } } } | undefined;
            if (commentsProvider?._view) {
                commentsProvider._view.webview.postMessage({
                    command: "reload",
                    data: options,
                });
            }
        })
    );
}

/**
 * Check if there are pending swap downloads and automatically download files
 * This runs when a project opens that was previously paused for downloads
 */
async function checkPendingSwapDownloads(projectUri: vscode.Uri): Promise<void> {
    try {
        const { getSwapPendingState, checkPendingDownloadsComplete, downloadPendingSwapFiles, performProjectSwap } =
            await import("./providers/StartupFlow/performProjectSwap");

        const pendingState = await getSwapPendingState(projectUri.fsPath);

        if (!pendingState || pendingState.swapState !== "pending_downloads") {
            return; // No pending swap downloads
        }

        console.log("[Extension] Found pending swap downloads, starting automatic download...");

        // Check if downloads are already complete
        const { complete: alreadyComplete } = await checkPendingDownloadsComplete(projectUri.fsPath);

        if (alreadyComplete) {
            await promptContinueSwap(projectUri, pendingState);
            return;
        }

        const totalFiles = pendingState.filesNeedingDownload.length;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Downloading media for swap...",
            cancellable: true
        }, async (progress, token) => {
            progress.report({ message: `0/${totalFiles} files` });
            let cancelled = false;
            token.onCancellationRequested(() => {
                cancelled = true;
            });

            const result = await downloadPendingSwapFiles(projectUri.fsPath, progress);

            if (cancelled) {
                vscode.window.showInformationMessage(
                    `Download paused. ${result.downloaded}/${result.total} files downloaded. Reopen project to resume.`
                );
                return;
            }

            console.log(`[Extension] Download complete: ${result.downloaded}/${result.total}, failed: ${result.failed.length}`);

            if (result.failed.length > 0) {
                const action = await vscode.window.showWarningMessage(
                    `Downloaded ${result.downloaded}/${result.total} files. ${result.failed.length} file(s) failed to download. Continue with swap anyway?`,
                    { modal: true },
                    "Continue Swap",
                    "Retry",
                    "Cancel Swap"
                );

                if (action === "Retry") {
                    vscode.commands.executeCommand("workbench.action.reloadWindow");
                } else if (action === "Continue Swap") {
                    await promptContinueSwap(projectUri, pendingState);
                } else {
                    await cancelSwap(projectUri, pendingState);
                }
            } else {
                await promptContinueSwap(projectUri, pendingState);
            }
        });

    } catch (error) {
        console.error("[Extension] Error checking pending swap downloads:", error);
    }
}

/**
 * Show modal to continue or cancel swap after downloads complete
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function promptContinueSwap(projectUri: vscode.Uri, pendingState: any): Promise<void> {
    const { saveSwapPendingState, performProjectSwap } =
        await import("./providers/StartupFlow/performProjectSwap");

    const newProjectName = pendingState.newProjectUrl.split('/').pop()?.replace('.git', '') || 'new project';

    const action = await vscode.window.showInformationMessage(
        `All required media files have been downloaded. Ready to continue the project swap to "${newProjectName}".`,
        { modal: true },
        "Continue Swap"
    );

    if (action === "Continue Swap") {
        // Re-validate swap is still active before executing
        try {
            const { checkProjectSwapRequired } = await import("./utils/projectSwapManager");
            const recheck = await checkProjectSwapRequired(projectUri.fsPath, undefined, true);
            if (recheck.remoteUnreachable) {
                await vscode.window.showWarningMessage(
                    "Server Unreachable\n\n" +
                    "The swap cannot be completed because the server is not reachable. " +
                    "Please check your internet connection or try again later.\n\n" +
                    "The pending swap state has been preserved and will resume when connectivity is restored.",
                    { modal: true },
                    "OK"
                );
                return; // Don't clear pending state - preserve for when connectivity returns
            }
            if (recheck.userAlreadySwapped && recheck.activeEntry) {
                // User already completed this swap - clear pending state and inform
                const { clearSwapPendingState: clearPending } = await import("./providers/StartupFlow/performProjectSwap");
                await clearPending(projectUri.fsPath);

                const swapTargetLabel =
                    recheck.activeEntry.newProjectName || recheck.activeEntry.newProjectUrl || "the new project";
                await vscode.window.showWarningMessage(
                    `Already Swapped\n\n` +
                    `You have already swapped to ${swapTargetLabel}.\n\n` +
                    `This project is deprecated but can still be opened.`,
                    { modal: true },
                    "OK"
                );
                return;
            }
            if (!recheck.required || !recheck.activeEntry || recheck.activeEntry.swapUUID !== pendingState.swapUUID) {
                // Update local metadata with merged data
                if (recheck.swapInfo) {
                    try {
                        const { sortSwapEntries, orderEntryFields } = await import("./utils/projectSwapManager");
                        await MetadataManager.safeUpdateMetadata(
                            projectUri,
                            (meta: any) => {
                                if (!meta.meta) { meta.meta = {}; }
                                const sorted = sortSwapEntries(recheck.swapInfo!.swapEntries || []);
                                meta.meta.projectSwap = { swapEntries: sorted.map(orderEntryFields) };
                                return meta;
                            }
                        );
                    } catch { /* non-fatal */ }
                }

                // Clean up localProjectSwap.json
                try {
                    const { deleteLocalProjectSwapFile } = await import("./utils/localProjectSettings");
                    await deleteLocalProjectSwapFile(projectUri);
                } catch { /* non-fatal */ }

                const { clearSwapPendingState } = await import("./providers/StartupFlow/performProjectSwap");
                await clearSwapPendingState(projectUri.fsPath);

                await vscode.window.showWarningMessage(
                    "Swap Cancelled\n\n" +
                    "The project swap has been cancelled or is no longer required.",
                    { modal: true },
                    "OK"
                );
                return;
            }
        } catch {
            // Non-fatal - proceed with swap if re-check fails
        }

        // Mark as ready and trigger swap
        await saveSwapPendingState(projectUri.fsPath, {
            ...pendingState,
            swapState: "ready_to_swap"
        });

        const projectName = projectUri.fsPath.split(/[\\/]/).pop() || "project";

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Completing project swap...",
            cancellable: false
        }, async (progress) => {
            const newPath = await performProjectSwap(
                progress,
                projectName,
                projectUri.fsPath,
                pendingState.newProjectUrl,
                pendingState.swapUUID,
                pendingState.swapInitiatedAt,
                pendingState.swapInitiatedBy,
                pendingState.swapReason
            );

            progress.report({ message: "Opening swapped project..." });
            await MetadataManager.safeOpenFolder(
                vscode.Uri.file(newPath),
                projectUri
            );
        });
    } else {
        await cancelSwap(projectUri, pendingState);
    }
}

/**
 * Cancel a pending swap.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function cancelSwap(projectUri: vscode.Uri, _pendingState: any): Promise<void> {
    const { clearSwapPendingState } = await import("./providers/StartupFlow/performProjectSwap");
    await clearSwapPendingState(projectUri.fsPath);
    vscode.window.showInformationMessage("Project swap cancelled.");
}

export function deactivate(): Thenable<void> | undefined {
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

    return undefined;
}

export function getAutoCompleteStatusBarItem(): StatusBarItem {
    return autoCompleteStatusBarItem;
}

export function getNotebookMetadataManager(): NotebookMetadataManager {
    return notebookMetadataManager;
}

/**
 * Wait for auth initialization to complete.
 * Call this before checking auth status to avoid race conditions.
 */
export function waitForAuthInit(): Promise<void> {
    return authInitPromise ?? Promise.resolve();
}

/**
 * Check if auth initialization has completed (regardless of whether auth was found).
 */
export function isAuthInitComplete(): boolean {
    return authInitComplete;
}

export function getAuthApi(): FrontierAPI | undefined {
    if (!authApi) {
        const extension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            const exports = extension.exports as { getAuthStatus?: () => unknown };
            if (exports && typeof exports.getAuthStatus === "function") {
                authApi = exports as FrontierAPI;
            }
        }
    }
    return authApi;
}
