import * as vscode from "vscode";
import { registerProviders } from "./providers/registerProviders";
import { GlobalProvider } from "./globalProvider";
import { registerCommands } from "./activationHelpers/contextAware/commands";
import { registerBacktranslationCommands } from "./smartEdits/registerBacktranslationCommands";
import { registerProjectManager } from "./projectManager";
import {
    temporaryMigrationScript_checkMatthewNotebook,
    migration_changeDraftFolderToFilesFolder,
    migration_chatSystemMessageSetting,
    migration_chatSystemMessageToMetadata,
    migration_lineNumbersSettings,
    migration_editHistoryFormat,
    migration_addMilestoneCells,
    migration_reorderMisplacedParatextCells,
    migration_addGlobalReferences,
    migration_verseRangeLabelsAndPositions,
    migration_cellIdsToUuid,
    migration_recoverTempFilesAndMergeDuplicates,
} from "./projectManager/utils/migrationUtils";
import { createIndexWithContext } from "./activationHelpers/contextAware/contentIndexes/indexes";
import { StatusBarItem } from "vscode";
import { initNativeSqlite, isNativeSqliteReady } from "./utils/nativeSqlite";
import { ensureSqliteNativeBinary } from "./utils/sqliteNativeBinaryManager";
import { isOnline } from "./utils/connectivityChecker";
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
import {
    registerSplashScreenProvider,
    showSplashScreen,
    updateSplashScreenTimings,
    updateSplashScreenSync,
    closeSplashScreen,
} from "./providers/SplashScreen/register";
import { openCellLabelImporter } from "./cellLabelImporter/cellLabelImporter";
import { openCodexMigrationTool } from "./codexMigrationTool/codexMigrationTool";
import { CodexCellEditorProvider } from "./providers/codexCellEditorProvider/codexCellEditorProvider";
import { checkForUpdatesOnStartup, registerUpdateCommands } from "./utils/updateChecker";
import { fileExists } from "./utils/webviewUtils";
import { checkIfProjectIsInitialized } from "./projectManager/utils/projectUtils";
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
import { checkTools, getUnavailableTools } from "./utils/toolsManager";
import { downloadFFmpeg, downloadFFprobe } from "./utils/ffmpegManager";
import { MissingToolsWarningProvider } from "./providers/MissingToolsWarning/MissingToolsWarningProvider";
import { cleanupOrphanedProjectFiles } from "./utils/fileUtils";
// markUserAsUpdatedInRemoteList is now called in performProjectUpdate before window reload
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

const DEBUG_MODE = false;
function debug(...args: any[]): void {
    if (DEBUG_MODE) {
        console.log("[Extension]", ...args);
    }
}

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
    debug(`[Activation] ${step}: ${duration.toFixed(2)}ms`);

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
            debug(`[Activation] ${currentStepName}: ${finalDuration.toFixed(2)}ms`);
        }
    }

    currentStepName = null;
    currentStepStartTime = null;

    return globalThis.performance.now();
}

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
    // Collect tabs: open non-codex editors first, then codex editors sequentially
    const nonCodexOps: Array<() => Promise<void>> = [];
    const codexTabs: Array<{ uri: string; groupIndex: number; viewType: string; }> = [];

    for (const group of layout) {
        for (const tab of group.tabs) {
            if (!tab.uri) continue;
            const uriStr = tab.uri as string;
            const viewType = tab.viewType as string | undefined;
            const groupIndex = tab.groupIndex as number;

            if (viewType === "codex.cellEditor") {
                codexTabs.push({ uri: uriStr, groupIndex, viewType });
            } else {
                nonCodexOps.push(async () => {
                    try {
                        const uri = vscode.Uri.parse(uriStr);
                        // Check if file exists before trying to open
                        if (!(await fileExists(uri))) {
                            return; // Skip missing files
                        }

                        if (viewType && viewType !== "default") {
                            await vscode.commands.executeCommand(
                                "vscode.openWith",
                                uri,
                                viewType,
                                { viewColumn: groupIndex + 1 }
                            );
                        } else {
                            const doc = await vscode.workspace.openTextDocument(uri);
                            await vscode.window.showTextDocument(doc, groupIndex + 1);
                        }
                    } catch {
                        // Ignore missing files
                    }
                });
            }
        }
    }

    // Open all non-codex editors in parallel
    for (const op of nonCodexOps) {
        await op();
    }

    // Sort codex tabs so .source files open before .codex for the same basename
    codexTabs.sort((a, b) => {
        const aPath = a.uri.toLowerCase();
        const bPath = b.uri.toLowerCase();
        const aIsSource = aPath.endsWith(".source");
        const bIsSource = bPath.endsWith(".source");
        if (aIsSource !== bIsSource) return aIsSource ? -1 : 1;
        return aPath.localeCompare(bPath);
    });

    // Sequentially open Codex editors and wait for readiness
    const provider = CodexCellEditorProvider.getInstance();
    for (const tab of codexTabs) {
        try {
            const uri = vscode.Uri.parse(tab.uri);

            // Check if file exists before trying to open
            if (!(await fileExists(uri))) {
                continue; // Skip missing files
            }

            await vscode.commands.executeCommand(
                "vscode.openWith",
                uri,
                tab.viewType,
                { viewColumn: tab.groupIndex + 1 }
            );

            if (provider) {
                // Wait for the specific webview to be ready (with timeout)
                await provider.waitForWebviewReady(tab.uri, 4000);
            }
        } catch {
            // Ignore missing files
        }
        // Yield to allow controllerchange to settle between openings
        await new Promise((r) => setTimeout(r, 10));
    }
    // Optionally, focus the previously active tab/group
    // Clear the saved layout after restore
    await context.globalState.update(TAB_LAYOUT_KEY, undefined);
}

export async function activate(context: vscode.ExtensionContext) {
    const activationStart = globalThis.performance.now();

    // Ensure OS temp directory exists in test/web environments (mock FS may not have /tmp)
    try {
        const tmp = os.tmpdir();
        const tmpUri = vscode.Uri.file(tmp);
        await vscode.workspace.fs.createDirectory(tmpUri);
    } catch (e) {
        console.warn("[Extension] Could not ensure temp directory exists:", e);
    }

    // Save tab layout and close all editors before showing splash screen
    try {
        await saveTabLayout(context);
        await vscode.commands.executeCommand("workbench.action.closeAllEditors");
    } catch (e) {
        console.error("Error saving/closing tabs before splash screen:", e);
    }

    // Initialize audio processor for on-demand FFmpeg downloads
    initializeAudioProcessor(context);
    // Initialize audio merger for merging audio files
    initializeAudioMerger(context);

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

        // Check for metadata.json early — this determines if we're in a Codex project
        const workspaceFolders = vscode.workspace.workspaceFolders;
        let metadataExists = false;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
            try {
                await vscode.workspace.fs.stat(metadataUri);
                metadataExists = true;
            } catch {
                metadataExists = false;
            }
        }

        // Comments migration is now manual via command palette: "Codex: Migrate Legacy Comments"
        // Repair still runs at startup to fix any corrupted data
        const migrationStart = globalThis.performance.now();
        if (metadataExists && workspaceFolders) {
            try {
                const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
                CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true).catch(() => {
                    // Silent fallback - don't block startup if repair fails
                });
            } catch (error) {
                console.error("[Extension] Error during startup comments repair:", error);
            }
        }
        stepStart = trackTiming("Repairing Comments", migrationStart);

        // Initialize Frontier API first - needed before startup flow.
        // This is a realtime step because frontier-auth downloads the Git runtime
        // on first activation, which can take significant time on slow connections.
        startRealtimeStep("Downloading Git Runtime");
        const extension = await waitForExtensionActivation(
            "frontier-rnd.frontier-authentication",
            120_000, // 2 minutes — the Git binary download can be slow
        );
        if (extension?.isActive) {
            authApi = extension.exports;
        }
        stepStart = finishRealtimeStep();

        // If metadata.json is missing but the workspace has a .git with a remote,
        // try to recover metadata.json from git history / remote.
        if (!metadataExists && workspaceFolders && workspaceFolders.length > 0) {
            const recoveryStart = globalThis.performance.now();
            try {
                const wsPath = workspaceFolders[0].uri.fsPath;
                const gitFolderUri = vscode.Uri.joinPath(workspaceFolders[0].uri, ".git");
                await vscode.workspace.fs.stat(gitFolderUri);

                const { listRemotes } = await import("./utils/dugiteGit");
                const remotes = await listRemotes(wsPath);
                if (remotes.length > 0) {
                    const { recoverMetadataFromGit } = await import("./projectManager/utils/projectUtils");
                    const recovered = await recoverMetadataFromGit(wsPath);
                    if (recovered) {
                        metadataExists = true;
                        console.log("[Extension] Recovered metadata.json from git — startup flow will handle UI");
                    } else {
                        console.warn(
                            "[Extension] metadata.json is missing and could not be recovered from the remote repository. " +
                            "The startup flow will prompt the user to re-create the project configuration."
                        );
                    }
                }
            } catch {
                // No .git folder or git binary unavailable — skip recovery
            }
            trackTiming("Metadata Recovery Check", recoveryStart);
        }

        // Ensure git repo exists and config files are up-to-date.
        // If metadata.json exists but .git doesn't (e.g., project created while git was
        // unavailable), auto-initialize git now that the binary may be available.
        const gitConfigStart = globalThis.performance.now();
        if (metadataExists) {
            try {
                const { ensureGitRepoInitialized, ensureGitConfigsAreUpToDate } = await import("./projectManager/utils/projectUtils");
                await ensureGitRepoInitialized();
                await ensureGitConfigsAreUpToDate();
                console.log("[Extension] Git configuration files updated on startup");
            } catch (error) {
                console.error("[Extension] Error updating git config files on startup:", error);
            }
        }
        stepStart = trackTiming("Updating Git Configuration", gitConfigStart);

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

        // Register remote updating commands (for admins to force project updating)
        const { registerRemoteUpdatingCommands } = await import("./commands/remoteUpdatingCommands");
        registerRemoteUpdatingCommands(context);

        // Register project swap commands (for instance admins to swap repositories)
        const { registerProjectSwapCommands } = await import("./commands/projectSwapCommands");
        registerProjectSwapCommands(context);

        stepStart = trackTiming("Configuring Startup Workflow", startupStart);

        // Check connectivity once so we can skip network-dependent downloads when offline.
        const networkAvailable = await isOnline();
        if (!networkAvailable) {
            console.log("[Extension] Offline — will skip tool downloads and use cached binaries if available");
        }

        // Download the native SQLite binary if not already present.
        // ensureSqliteNativeBinary returns instantly from local cache/disk,
        // and only attempts a network download if the binary isn't present locally.
        const sqliteBinaryStart = globalThis.performance.now();
        try {
            const binaryPath = await ensureSqliteNativeBinary(context);
            console.log("[SQLite] Binary path resolved:", binaryPath);
            initNativeSqlite(binaryPath);
            console.log("[SQLite] Native module initialized successfully");
        } catch (error: any) {
            if (!networkAvailable) {
                console.log("[SQLite] Offline — binary not cached locally, search unavailable until online");
            } else {
                console.error("[SQLite] Failed to set up native binary:", error?.message || error);
                console.error("[SQLite] Stack:", error?.stack);
            }
        }
        stepStart = trackTiming("Setting up search engine", sqliteBinaryStart);

        // Download audio tools (ffmpeg/ffprobe) if not already present.
        // downloadFFmpeg/downloadFFprobe check local cache first, only
        // hitting the network if the binary isn't present on disk.
        const audioToolsStart = globalThis.performance.now();
        try {
            updateSplashScreenSync(0, "Setting up audio tools...");
            await Promise.all([
                downloadFFmpeg(context),
                downloadFFprobe(context),
            ]);
        } catch (error) {
            if (!networkAvailable) {
                console.log("[Extension] Offline — audio tools not cached locally, audio features unavailable until online");
            } else {
                console.error("[Extension] Error downloading audio tools:", error);
            }
        }
        stepStart = trackTiming("Setting up audio tools", audioToolsStart);

        // Run a fresh tool availability check after all download attempts
        const toolCheckStart = globalThis.performance.now();
        let toolCheckResult: Awaited<ReturnType<typeof checkTools>>;
        let unavailableTools: string[];
        try {
            toolCheckResult = await checkTools(context, authApi);
            unavailableTools = getUnavailableTools(toolCheckResult);
        } catch (error) {
            console.error("[Extension] checkTools() threw unexpectedly:", error);
            toolCheckResult = { git: false, sqlite: false, ffmpeg: false, ffprobe: false };
            unavailableTools = getUnavailableTools(toolCheckResult);
        }
        stepStart = trackTiming("Checking tool availability", toolCheckStart);

        const ok = (v: boolean) => v ? "ok" : "MISSING";
        console.info(
            `[Extension] Tools status — git: ${ok(toolCheckResult.git)}, sqlite: ${ok(toolCheckResult.sqlite)}, ffmpeg: ${ok(toolCheckResult.ffmpeg)}, ffprobe: ${ok(toolCheckResult.ffprobe)}`
        );

        // When offline, non-critical tools (git, audio) being unavailable is
        // expected and not actionable -- skip the blocking warning panel.
        const hasCriticalMissing = !toolCheckResult.sqlite;
        const showWarningPanel =
            unavailableTools.length > 0 && (networkAvailable || hasCriticalMissing);

        if (unavailableTools.length > 0 && !showWarningPanel) {
            console.log(
                "[Extension] Offline -- non-critical tools unavailable (%s), continuing without warning panel",
                unavailableTools.join(", ")
            );
        }

        if (showWarningPanel) {
            console.warn(
                "[Extension] Unavailable tools after download attempts:",
                unavailableTools.join(", ")
            );

            const warningProvider = new MissingToolsWarningProvider(context);
            context.subscriptions.push(warningProvider);

            // Start showing the warning panel (creates the tab synchronously),
            // then close the splash. This ensures a visible tab exists at all
            // times, preventing the WelcomeView from flashing during the gap.
            const userActionPromise = warningProvider.show(
                toolCheckResult,
                async () => {
                    const retryOnline = await isOnline();
                    if (!retryOnline) {
                        console.warn("[Extension] Offline — cannot retry tool downloads");
                        return checkTools(context, authApi).catch(() => toolCheckResult);
                    }

                    const current = await checkTools(context, authApi).catch(() => toolCheckResult);

                    if (!current.git) {
                        try {
                            await authApi?.retryGitBinaryDownload?.();
                        } catch (e) {
                            console.error("[Extension] Git binary retry failed:", e);
                        }
                    }
                    if (!current.sqlite) {
                        try {
                            const binaryPath = await ensureSqliteNativeBinary(context);
                            initNativeSqlite(binaryPath);
                        } catch (e) {
                            console.error("[Extension] SQLite retry failed:", e);
                        }
                    }
                    if (!current.ffmpeg) {
                        try { await downloadFFmpeg(context); } catch (e) {
                            console.error("[Extension] FFmpeg retry failed:", e);
                        }
                    }
                    if (!current.ffprobe) {
                        try { await downloadFFprobe(context); } catch (e) {
                            console.error("[Extension] FFprobe retry failed:", e);
                        }
                    }
                    return checkTools(context, authApi).catch(() => current);
                }
            );

            // Now that the warning tab exists, close the splash screen.
            closeSplashScreen();

            const userAction = await userActionPromise;

            if (userAction === "blocked" && !toolCheckResult.sqlite) {
                // SQLite is missing and the user closed the panel without
                // continuing. The extension cannot function without SQLite.
                return;
            }
        }

        // Check for pending update (swap) downloads (after workspace is ready)
        if (workspaceFolders && workspaceFolders.length > 0) {
            checkPendingSwapDownloads(workspaceFolders[0].uri).catch(err => {
                console.error("[Extension] Error checking pending update (swap) downloads:", err);
            });
        }

        vscode.workspace.getConfiguration().update("workbench.startupEditor", "none", true);

        // Initialize extension based on workspace state
        const pendingOpenSourceUploader = context.globalState.get<boolean>("pendingOpenSourceUploader");
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

            // Check for pending project creation after reload
            const pendingCreate = context.globalState.get("pendingProjectCreate");
            if (pendingCreate) {
                const pendingName = context.globalState.get<string>("pendingProjectCreateName");
                const pendingProjectId = context.globalState.get<string>("pendingProjectCreateId");
                const pendingSourceLangStr = context.globalState.get<string>("pendingProjectCreateSourceLanguage");
                const pendingTargetLangStr = context.globalState.get<string>("pendingProjectCreateTargetLanguage");
                const pendingCategory =
                    context.globalState.get<string>("pendingProjectCreateCategory") || "Translation";
                console.debug("[Extension] Resuming project creation for:", pendingName, "with projectId:", pendingProjectId);

                // Clear flags immediately to prevent re-triggering on subsequent reloads
                await context.globalState.update("pendingProjectCreate", undefined);
                await context.globalState.update("pendingProjectCreateName", undefined);
                await context.globalState.update("pendingProjectCreateId", undefined);
                await context.globalState.update("pendingProjectCreateSourceLanguage", undefined);
                await context.globalState.update("pendingProjectCreateTargetLanguage", undefined);
                await context.globalState.update("pendingProjectCreateCategory", undefined);
                await context.globalState.update("pendingOpenSourceUploader", undefined);

                // Only create the project if metadata.json doesn't already exist.
                // A stale pendingProjectCreate flag (e.g. from a failed folder creation or
                // multi-window race) should NOT re-trigger creation on an existing project.
                const pendingMetadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
                let pendingMetadataExists = false;
                try {
                    await vscode.workspace.fs.stat(pendingMetadataUri);
                    pendingMetadataExists = true;
                } catch {
                    // metadata.json doesn't exist, safe to create
                }

                if (pendingMetadataExists) {
                    console.debug("[Extension] Skipping pending project creation — metadata.json already exists (stale flag)");
                } else {
                    try {
                        const { createNewProject } = await import("./utils/projectCreationUtils/projectCreationUtils");
                        const sourceLanguage = pendingSourceLangStr ? JSON.parse(pendingSourceLangStr) : undefined;
                        const targetLanguage = pendingTargetLangStr ? JSON.parse(pendingTargetLangStr) : undefined;
                        await createNewProject({
                            projectName: pendingName,
                            projectId: pendingProjectId,
                            sourceLanguage,
                            targetLanguage,
                            projectCategory: pendingCategory,
                        });

                        if (sourceLanguage?.refName && targetLanguage?.refName) {
                            const workspaceUri = workspaceFolders[0].uri;
                            import("./copilotSettings/copilotSettings").then(({ generateChatSystemMessage }) =>
                                generateChatSystemMessage(sourceLanguage, targetLanguage, workspaceUri).then(async (msg) => {
                                    if (msg) {
                                        const { MetadataManager } = await import("./utils/metadataManager");
                                        await MetadataManager.setChatSystemMessage(msg, workspaceUri);
                                        console.debug("[Extension] Pre-generated chat system message during project creation");
                                    }
                                })
                            ).catch((err) => {
                                console.debug("[Extension] Background system message generation failed (non-critical):", err);
                            });
                        }
                    } catch (error) {
                        console.error("Failed to resume project creation:", error);
                        vscode.window.showErrorMessage("Failed to create project after reload.");
                    }
                }

                // Re-check metadataExists after pending project creation so downstream
                // initialization (indexes, backtranslation commands, etc.) uses the correct value.
                if (!metadataExists) {
                    const freshMetadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");
                    try {
                        await vscode.workspace.fs.stat(freshMetadataUri);
                        metadataExists = true;
                    } catch {
                        // still doesn't exist
                    }
                }
            }

            const metadataUri = vscode.Uri.joinPath(workspaceFolders[0].uri, "metadata.json");

            if (metadataExists) {
                // Ensure all installed extension versions are recorded in metadata
                // This handles: 1) Adding missing versions (e.g., frontierAuthentication added after project creation)
                //               2) Updating to newer versions (never downgrades)
                try {
                    await MetadataManager.ensureExtensionVersionsRecorded(workspaceFolders[0].uri);
                } catch (error) {
                    console.warn("[Extension] Error ensuring extension version requirements:", error);
                }
            }

            trackTiming("Initializing Workspace", workspaceStart);

            await initializeExtension(context, metadataExists);

            // Ensure local project settings exist when a Codex project is open
            if (metadataExists) {
                try {
                    // Only ensure settings once a repo is fully initialized (avoid during clone checkout)
                    try {
                        const projectUri = workspaceFolders[0].uri;
                        const gitDir = vscode.Uri.joinPath(projectUri, ".git");
                        await vscode.workspace.fs.stat(gitDir);
                        const { afterProjectDetectedEnsureLocalSettings } = await import("./projectManager/utils/projectUtils");
                        await afterProjectDetectedEnsureLocalSettings(projectUri);
                    } catch {
                        // No .git yet; skip until project is fully initialized/opened
                    }
                } catch (e) {
                    console.warn("[Extension] Failed to ensure local project settings exist:", e);
                }
            }

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

        if (metadataExists) {
            registerBacktranslationCommands(context);
        }
        await Promise.all([
            registerProviders(context),
            registerCommands(context),
        ]);

        // Register metadata commands for frontier-authentication to call
        // This implements the "single writer" principle - only codex-editor writes to metadata.json
        registerMetadataCommands(context);

        // Initialize A/B testing registry (always-on)
        initializeABTesting();

        // If this activation follows a "create for upload" project creation, open the source uploader
        if (pendingOpenSourceUploader) {
            await vscode.commands.executeCommand("codex-project-manager.openSourceUpload");
        }

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

        if (!toolCheckResult.git) {
            const gitStatusBarItem = vscode.window.createStatusBarItem(
                vscode.StatusBarAlignment.Left,
                0
            );
            gitStatusBarItem.text = "$(warning) Offline (missing sync tools)";
            gitStatusBarItem.tooltip =
                "Git sync tools could not be downloaded. Sync and collaboration features are unavailable. Download the Codex application from codexeditor.app for full support.";
            gitStatusBarItem.backgroundColor = new vscode.ThemeColor(
                "statusBarItem.warningBackground"
            );
            gitStatusBarItem.show();
            context.subscriptions.push(gitStatusBarItem);
        }

        stepStart = trackTiming("Initializing Status Bar", statusBarStart);

        // Show activation summary
        const totalDuration = globalThis.performance.now() - activationStart;
        // Don't add "Total Activation Time" to timings array since it's already calculated above
        debug(`[Activation] Total Activation Time: ${totalDuration.toFixed(2)}ms`);

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

        // Only run migrations in actual Codex projects — they write completion flags
        // to .vscode/settings.json even when no project files exist
        if (metadataExists) {
            // NOTE: migration_chatSystemMessageSetting() now runs BEFORE sync (see line ~768)
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
        }

        // Remove leftover files from features that have been removed
        await cleanupOrphanedProjectFiles();

        // After migrations complete, trigger sync directly
        // (All migrations have finished executing since they're awaited sequentially)
        try {
            const hasCodexProject = await checkIfProjectIsInitialized();
            if (hasCodexProject) {
                const workspaceFolderPath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

                const { ensureGitDisabledInSettings, validateAndFixProjectMetadata } = await import("./projectManager/utils/projectUtils");
                await ensureGitDisabledInSettings();
                debug("✅ [PRE-SYNC] Disabled VS Code Git before sync operations");

                // Auto-fix metadata structure (scope, name) on startup
                try {
                    if (vscode.workspace.workspaceFolders?.[0]) {
                        await validateAndFixProjectMetadata(vscode.workspace.workspaceFolders[0].uri);
                        debug("✅ [PRE-SYNC] Validated and fixed project metadata structure");
                    }
                } catch (e) {
                    console.error("Error validating metadata on startup:", e);
                }

                const authApi = getAuthApi();
                if (authApi && typeof (authApi as any).getAuthStatus === "function") {
                    const authStatus = authApi.getAuthStatus();
                    if (authStatus.isAuthenticated) {
                        // Validate and fix projectId/projectName AFTER migrations complete
                        // This ensures projectName updates aren't overwritten by migrations
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
                        const pendingUpdateSync = context.globalState.get<any>("codex.pendingUpdateSync");
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
                    }
                }
            }
        } catch (error) {
            console.error("❌ [POST-MIGRATIONS] Error triggering sync after migrations:", error);
        }

        trackTiming("Running Post-activation Tasks", postActivationStart);

        // Register update commands and check for updates (non-blocking)
        registerUpdateCommands(context);

        // Version checking removed from this extension

        // Don't close splash screen yet - we still have sync operations to show
        // The splash screen will be closed after all operations complete
    } catch (error) {
        console.error("Error during extension activation:", error);
        vscode.window.showErrorMessage(`Failed to activate Codex Editor: ${error}`);
    }

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

    // Command: Migrate validations for user edits across project
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.migrateValidationsForUserEdits",
            async () => {
                await migration_addValidationsForUserEdits();
            }
        )
    );

    // Command: Fix verse range labels and positions (manual migration, not run by default)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.runVerseRangeLabelsAndPositionsMigration",
            async () => {
                try {
                    await migration_verseRangeLabelsAndPositions();
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("Verse range migration failed:", error);
                    await vscode.window.showErrorMessage(
                        `Verse range migration failed: ${msg}`
                    );
                }
            }
        )
    );

    // Command: Migrate legacy comments (manual migration, not run by default)
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.runCommentsMigration",
            async () => {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (!workspaceFolders || workspaceFolders.length === 0) {
                    await vscode.window.showWarningMessage("No workspace folder open.");
                    return;
                }
                try {
                    const migrated = await CommentsMigrator.migrateProjectComments(workspaceFolders[0].uri);
                    const commentsFilePath = vscode.Uri.joinPath(workspaceFolders[0].uri, ".project", "comments.json");
                    await CommentsMigrator.repairExistingCommentsFile(commentsFilePath, true);
                    if (migrated) {
                        await vscode.window.showInformationMessage("Comments migration completed successfully.");
                    } else {
                        await vscode.window.showInformationMessage("No comments migration needed.");
                    }
                } catch (error) {
                    const msg = error instanceof Error ? error.message : String(error);
                    console.error("Comments migration failed:", error);
                    await vscode.window.showErrorMessage(
                        `Comments migration failed: ${msg}`
                    );
                }
            }
        )
    );

    // Comments-related commands
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.focusCommentsView", () => {
            return vscode.commands.executeCommand("comments-sidebar.focus");
        })
    );

    // Parallel Passages with Replace mode command
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.openParallelPassagesWithReplace", async () => {
            // Set pending enable replace flag first, then focus the view
            // The webview will receive the message when it's ready via onWebviewReady hook
            const provider = GlobalProvider.getInstance().getProvider("search-passages-sidebar");
            if (provider && "setPendingEnableReplace" in provider) {
                (provider as { setPendingEnableReplace: () => void; }).setPendingEnableReplace();
            }
            await vscode.commands.executeCommand("search-passages-sidebar.focus");
        })
    );

    // In-Tab Search (Cmd+F) - Opens floating search bar in CodexCellEditor
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.toggleInTabSearch", async () => {
            const cellEditorProvider = CodexCellEditorProvider.getInstance();
            if (cellEditorProvider) {
                cellEditorProvider.toggleInTabSearch();
            }
        })
    );

    // Parallel Passages (Cmd+Shift+F) - Opens the sidebar for cross-file semantic search
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.openParallelPassagesAllFiles", async () => {
            await vscode.commands.executeCommand("search-passages-sidebar.focus");
        })
    );

    // Ensure sync commands exist in all environments (including tests)
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

    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.navigateToCellInComments", (cellId: string) => {
            // Get the comments provider and send reload message
            const commentsProvider = GlobalProvider.getInstance().getProvider("comments-sidebar") as any;
            if (commentsProvider && commentsProvider._view) {
                // Send a reload message directly to the webview with the cellId
                commentsProvider._view.webview.postMessage({
                    command: "reload",
                    data: {
                        cellId: cellId,
                    }
                });
            }
        })
    );

    // Batch transcription command
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

            provider.postMessageToWebviews({ type: "startBatchTranscription", content: { count } } as any);
            vscode.window.showInformationMessage(`Starting transcription for up to ${count} cells...`);
        })
    );

    // Register the missing comments-sidebar.reload command
    context.subscriptions.push(
        vscode.commands.registerCommand("codex-editor-extension.comments-sidebar.reload", (options: any) => {
            const commentsProvider = GlobalProvider.getInstance().getProvider("comments-sidebar") as any;
            if (!commentsProvider) return;

            if (commentsProvider._view) {
                // Webview is live — post directly (VS Code queues until JS is ready)
                commentsProvider._view.webview.postMessage({
                    command: "reload",
                    data: options,
                });
            } else {
                // Webview hasn't been created yet; queue data for delivery
                // once the webview initializes and sends getCurrentCellId
                commentsProvider.setPendingReloadData(options);
            }
        })
    );




}

async function initializeExtension(context: vscode.ExtensionContext, metadataExists: boolean) {
    const initStart = globalThis.performance.now();

    debug("Initializing extension");

    if (metadataExists) {
        // Break down index creation
        const totalIndexStart = globalThis.performance.now();

        // Use real-time progress for context index setup since it can take a while
        // Note: SQLiteIndexManager handles its own detailed progress tracking
        if (isNativeSqliteReady()) {
            startRealtimeStep("AI learning your project structure");
            await createIndexWithContext(context);
            finishRealtimeStep();
        } else {
            console.warn("[Extension] Skipping content index creation — SQLite native module not available");
        }

        // Don't track "Total Index Creation" since it would show cumulative time
        // The individual steps above already show the breakdown
        const totalIndexDuration = globalThis.performance.now() - totalIndexStart;
        debug(`[AI Learning] Total AI learning preparation: ${totalIndexDuration.toFixed(2)}ms`);

        // Skip version check during splash screen - will be performed before sync
        updateSplashScreenSync(50, "Finalizing initialization...");

        // Skip sync during splash screen - will be performed after workspace loads
        updateSplashScreenSync(100, "Initialization complete");
        debug("✅ [SPLASH SCREEN PHASE] Extension initialization complete, sync will run after workspace loads");
    }

    // Calculate and log total initialize extension time but don't add to main timing array
    // since it's a summary of the sub-steps already tracked
    const totalInitDuration = globalThis.performance.now() - initStart;
    debug(`[Activation] Total Initialize Extension: ${totalInitDuration.toFixed(2)}ms`);
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
            registerBacktranslationCommands(context);
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

async function executeCommandsAfter(
    context: vscode.ExtensionContext
) {
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
        debug(
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

/**
 * Check if there are pending update (swap) downloads and automatically download files
 * This runs when a project opens that was previously paused for downloads
 */
async function checkPendingSwapDownloads(projectUri: vscode.Uri): Promise<void> {
    try {
        const { getSwapPendingState, checkPendingDownloadsComplete, clearSwapPendingState, downloadPendingSwapFiles, saveSwapPendingState, performProjectSwap } =
            await import("./providers/StartupFlow/performProjectSwap");

        const pendingState = await getSwapPendingState(projectUri.fsPath);

        if (!pendingState || pendingState.swapState !== "pending_downloads") {
            return; // No pending update (swap) downloads
        }

        console.log("[Extension] Found pending update (swap) downloads, starting automatic download...");

        // Check if downloads are already complete
        const { complete: alreadyComplete, remaining } = await checkPendingDownloadsComplete(projectUri.fsPath);

        if (alreadyComplete) {
            // Already done - show continue modal
            await promptContinueSwap(projectUri, pendingState);
            return;
        }

        // Show progress and automatically download the files
        const totalFiles = pendingState.filesNeedingDownload.length;

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Downloading media for project update...",
            cancellable: true
        }, async (progress, token) => {
            // Show initial count in message
            progress.report({ message: `0/${totalFiles} files` });
            // Set up cancellation handler
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
                // Some downloads failed - show warning and let user decide
                const action = await vscode.window.showWarningMessage(
                    `Downloaded ${result.downloaded}/${result.total} files. ${result.failed.length} file(s) failed to download. Continue with update anyway?`,
                    { modal: true },
                    "Continue Update",
                    "Retry",
                    "Cancel Update"
                );

                if (action === "Retry") {
                    // Reopen to retry
                    vscode.commands.executeCommand("workbench.action.reloadWindow");
                } else if (action === "Continue Update") {
                    await promptContinueSwap(projectUri, pendingState);
                } else {
                    await cancelSwap(projectUri, pendingState);
                }
            } else {
                // All downloads successful
                await promptContinueSwap(projectUri, pendingState);
            }
        });

    } catch (error) {
        console.error("[Extension] Error checking pending update (swap) downloads:", error);
    }
}

/**
 * Show modal to continue or cancel update (swap) after downloads complete
 */
async function promptContinueSwap(projectUri: vscode.Uri, pendingState: any): Promise<void> {
    const { saveSwapPendingState, performProjectSwap, clearSwapPendingState } =
        await import("./providers/StartupFlow/performProjectSwap");

    const newProjectName = pendingState.newProjectUrl.split('/').pop()?.replace('.git', '') || 'new project';

    const action = await vscode.window.showInformationMessage(
        `All required media files have been downloaded. Ready to continue the project update to "${newProjectName}".`,
        { modal: true },
        "Continue Update"
    );

    if (action === "Continue Update") {
        // Re-validate update (swap) is still active before executing
        try {
            const { checkProjectSwapRequired } = await import("./utils/projectSwapManager");
            const recheck = await checkProjectSwapRequired(projectUri.fsPath, undefined, true);
            if (recheck.remoteUnreachable) {
                await vscode.window.showWarningMessage(
                    "Server Unreachable\n\n" +
                    "The update cannot be completed because the server is not reachable. " +
                    "Please check your internet connection or try again later.\n\n" +
                    "The pending update state has been preserved and will resume when connectivity is restored.",
                    { modal: true },
                    "OK"
                );
                return; // Don't clear pending state - preserve for when connectivity returns
            }
            if (recheck.userAlreadySwapped && recheck.activeEntry) {
                // User already completed this update (swap) - clear pending state and inform
                const { clearSwapPendingState: clearPending } = await import("./providers/StartupFlow/performProjectSwap");
                await clearPending(projectUri.fsPath);

                const swapTargetLabel =
                    recheck.activeEntry.newProjectName || recheck.activeEntry.newProjectUrl || "the new project";
                await vscode.window.showWarningMessage(
                    `Already Updated\n\n` +
                    `You have already updated to ${swapTargetLabel}.\n\n` +
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
                    "Update Cancelled\n\n" +
                    "The project update has been cancelled or is no longer required.",
                    { modal: true },
                    "OK"
                );
                return;
            }
        } catch {
            // Non-fatal - proceed with update (swap) if re-check fails
        }

        // Mark as ready and trigger update (swap)
        await saveSwapPendingState(projectUri.fsPath, {
            ...pendingState,
            swapState: "ready_to_swap"
        });

        // Perform the update (swap)
        const projectName = projectUri.fsPath.split(/[\\/]/).pop() || "project";

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: "Completing project update...",
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

            progress.report({ message: "Opening updated project..." });
            const { MetadataManager } = await import("./utils/metadataManager");
            await MetadataManager.safeOpenFolder(
                vscode.Uri.file(newPath),
                projectUri
            );
        });
    } else {
        // User clicked Cancel or closed the modal
        await cancelSwap(projectUri, pendingState);
    }
}

/**
 * Cancel a pending update (swap).
 * Since we no longer change media strategy during update (swap), just clear the pending state.
 */
async function cancelSwap(projectUri: vscode.Uri, _pendingState: any): Promise<void> {
    const { clearSwapPendingState } = await import("./providers/StartupFlow/performProjectSwap");
    await clearSwapPendingState(projectUri.fsPath);
    vscode.window.showInformationMessage("Project update cancelled.");
}

export async function deactivate() {
    // Clean up real-time progress timer
    if (currentStepTimer) {
        clearInterval(currentStepTimer);
        currentStepTimer = null;
    }

    // Close the index manager's database connection and clear the global reference
    try {
        const { clearSQLiteIndexManager } = await import(
            "./activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager"
        );
        await clearSQLiteIndexManager();
    } catch (e) {
        console.error("[Deactivate] Error clearing index manager:", e);
    }
}

export function getAutoCompleteStatusBarItem(): StatusBarItem {
    return autoCompleteStatusBarItem;
}

export function getNotebookMetadataManager(): NotebookMetadataManager {
    return notebookMetadataManager;
}

export function getAuthApi(): FrontierAPI | undefined {
    if (!authApi) {
        const extension = vscode.extensions.getExtension("frontier-rnd.frontier-authentication");
        if (extension?.isActive) {
            const exports = extension.exports as any;
            // Defensive: only treat as auth API if it has expected surface area
            if (exports && typeof exports.getAuthStatus === "function") {
                authApi = exports;
            }
        }
    }
    return authApi;
}
