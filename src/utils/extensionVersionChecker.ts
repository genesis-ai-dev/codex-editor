import * as vscode from 'vscode';
import semver from 'semver';
import { ProjectMetadata } from '../../types';

const DEBUG_MODE = false;
const debug = (message: string) => {
    if (DEBUG_MODE) {
        console.log(`[ExtensionVersionChecker] ${message}`);
    }
};

interface ExtensionVersionInfo {
    extensionId: string;
    currentVersion: string;
    latestVersion: string;
    isOutdated: boolean;
    downloadUrl: string;
    displayName: string;
}

interface OpenVSXExtensionInfo {
    version: string;
    engines: {
        vscode: string;
    };
    downloadCount?: number;
    downloads?: {
        universal?: string;
    };
    timestamp: string;
    files: {
        download: string;
    };
    namespace: string;
    name: string;
}

interface VersionCheckResult {
    hasOutdatedExtensions: boolean;
    outdatedExtensions: ExtensionVersionInfo[];
    allExtensions: ExtensionVersionInfo[];
}

const EXTENSION_CHECK_KEY = 'codex-editor.extensionVersionCheck';
const VERSION_MODAL_COOLDOWN_KEY = 'codex-editor.versionModalLastShown';
const VERSION_MODAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds

// Extension configurations
const EXTENSIONS_TO_CHECK = [
    {
        id: 'project-accelerate.codex-editor-extension',
        displayName: 'Codex Editor',
        openVsxPath: 'project-accelerate/codex-editor-extension'
    },
    {
        id: 'frontier-rnd.frontier-authentication',
        displayName: 'Frontier Authentication',
        openVsxPath: 'frontier-rnd/frontier-authentication'
    }
];

/**
 * Fetches the latest version information from open-vsx.org
 */
async function fetchLatestVersionFromOpenVSX(openVsxPath: string): Promise<OpenVSXExtensionInfo | null> {
    try {
        const url = `https://open-vsx.org/api/${openVsxPath}/latest`;
        debug(`Fetching version info from: ${url}`);
        console.log(`[ExtensionVersionChecker] 🌐 API Request: ${url}`);

        const response = await fetch(url);
        console.log(`[ExtensionVersionChecker] 📡 API Response: ${response.status} ${response.statusText}`);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as OpenVSXExtensionInfo;
        debug(`Retrieved version: ${data.version}`);
        console.log(`[ExtensionVersionChecker] 📋 API Data received: ${JSON.stringify({
            version: data.version,
            timestamp: data.timestamp,
            downloadCount: data.downloadCount,
            namespace: data.namespace,
            name: data.name,
            hasDownload: !!data.files?.download
        }, null, 2)}`);

        return data;
    } catch (error) {
        console.error(`[ExtensionVersionChecker] ❌ Error fetching latest version for ${openVsxPath}:`, error);
        return null;
    }
}

/**
 * Gets the current version of an installed extension
 */
function getCurrentExtensionVersion(extensionId: string): string | null {
    const extension = vscode.extensions.getExtension(extensionId);
    return extension?.packageJSON?.version || null;
}

/**
 * Checks all configured extensions for version updates
 */
export async function checkExtensionVersions(context: vscode.ExtensionContext): Promise<VersionCheckResult> {
    debug('Starting extension version check...');
    console.log('[ExtensionVersionChecker] Starting comprehensive version check...');

    const results: ExtensionVersionInfo[] = [];
    let hasOutdatedExtensions = false;

    // Log all installed extensions for context
    const allInstalledExtensions = vscode.extensions.all
        .filter(ext => !ext.id.startsWith('vscode.'))
        .map(ext => `${ext.id} v${ext.packageJSON?.version || 'unknown'}`)
        .sort();

    console.log('[ExtensionVersionChecker] All installed extensions:');
    allInstalledExtensions.forEach(ext => console.log(`  - ${ext}`));

    console.log('[ExtensionVersionChecker] Checking configured extensions:');

    for (const extensionConfig of EXTENSIONS_TO_CHECK) {
        console.log(`[ExtensionVersionChecker] === Checking ${extensionConfig.displayName} ===`);

        const currentVersion = getCurrentExtensionVersion(extensionConfig.id);

        if (!currentVersion) {
            console.warn(`[ExtensionVersionChecker] ❌ Extension ${extensionConfig.id} not found or version not available`);
            debug(`Extension ${extensionConfig.id} not found or version not available`);
            continue;
        }

        console.log(`[ExtensionVersionChecker] 📦 Current: ${extensionConfig.displayName} v${currentVersion}`);
        debug(`Checking ${extensionConfig.displayName}: current version ${currentVersion}`);

        console.log(`[ExtensionVersionChecker] 🔍 Fetching latest version from open-vsx.org...`);
        const latestInfo = await fetchLatestVersionFromOpenVSX(extensionConfig.openVsxPath);

        if (!latestInfo) {
            console.error(`[ExtensionVersionChecker] ❌ Could not fetch latest version for ${extensionConfig.displayName} from open-vsx.org`);
            debug(`Could not fetch latest version for ${extensionConfig.displayName}`);
            continue;
        }

        const latestVersion = latestInfo.version;
        console.log(`[ExtensionVersionChecker] 🌐 Latest: ${extensionConfig.displayName} v${latestVersion} (published: ${latestInfo.timestamp})`);
        console.log(`[ExtensionVersionChecker] 📊 Downloads: ${latestInfo.downloads?.universal ? 'Available' : 'N/A'}`);

        const isOutdated = semver.lt(currentVersion, latestVersion);

        if (isOutdated) {
            hasOutdatedExtensions = true;
            debug(`${extensionConfig.displayName} is outdated: ${currentVersion} < ${latestVersion}`);
        } else if (semver.gt(currentVersion, latestVersion)) {
            debug(`${extensionConfig.displayName} is ahead: ${currentVersion} > ${latestVersion}`);
        } else {
            debug(`${extensionConfig.displayName} is up to date: ${currentVersion} >= ${latestVersion}`);
        }

        const versionInfo: ExtensionVersionInfo = {
            extensionId: extensionConfig.id,
            currentVersion,
            latestVersion,
            isOutdated,
            downloadUrl: latestInfo.files.download,
            displayName: extensionConfig.displayName
        };

        results.push(versionInfo);
        console.log(`[ExtensionVersionChecker] === End ${extensionConfig.displayName} ===\n`);
    }

    const result: VersionCheckResult = {
        hasOutdatedExtensions,
        outdatedExtensions: results.filter(r => r.isOutdated),
        allExtensions: results
    };

    console.log('[ExtensionVersionChecker] === VERSION CHECK SUMMARY ===');
    console.log(`[ExtensionVersionChecker] Total extensions checked: ${results.length}`);
    console.log(`[ExtensionVersionChecker] Up-to-date: ${results.filter(r => !r.isOutdated).length}`);
    console.log(`[ExtensionVersionChecker] Outdated: ${result.outdatedExtensions.length}`);

    if (result.outdatedExtensions.length > 0) {
        console.log('[ExtensionVersionChecker] Outdated extensions:');
        result.outdatedExtensions.forEach(ext => {
            console.log(`[ExtensionVersionChecker]   - ${ext.displayName}: ${ext.currentVersion} → ${ext.latestVersion}`);
        });
    }

    console.log('[ExtensionVersionChecker] === END SUMMARY ===');
    debug(`Version check complete. Outdated extensions: ${result.outdatedExtensions.length}`);
    return result;
}

/**
 * Shows notification for outdated extensions and handles user actions
 */
async function showOutdatedExtensionsNotification(
    context: vscode.ExtensionContext,
    outdatedExtensions: ExtensionVersionInfo[]
): Promise<boolean> {
    const extensionNames = outdatedExtensions.map(ext => ext.displayName).join(', ');
    const message = outdatedExtensions.length === 1
        ? `${extensionNames} extension is outdated.\n\nPlease update to enable syncing.`
        : `${extensionNames} extensions are outdated.\n\nPlease update to enable syncing.`;

    const actions = ['View Extensions'];

    try {
        const selection = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            ...actions
        );

        switch (selection) {
            case 'View Extensions':
                await vscode.commands.executeCommand('workbench.view.extensions');
                // Show detailed info about each outdated extension
                for (const ext of outdatedExtensions) {
                    vscode.window.showInformationMessage(
                        `${ext.displayName}: Update from v${ext.currentVersion} to v${ext.latestVersion}`,
                        'Search in Extensions'
                    ).then(choice => {
                        if (choice === 'Search in Extensions') {
                            vscode.commands.executeCommand('workbench.extensions.search', ext.extensionId);
                        }
                    });
                }
                return false; // Keep syncing disabled

            default:
                return false; // Keep syncing disabled
        }
    } catch (error) {
        console.error('[ExtensionVersionChecker] Error showing notification:', error);
        return false; // Keep syncing disabled on error
    }
}

/**
 * Disables auto-sync in the configuration
 */
async function disableAutoSync(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('codex-project-manager');
        const currentValue = config.get<boolean>('autoSyncEnabled', true);

        if (!currentValue) {
            console.log('[ExtensionVersionChecker] ℹ️  Auto-sync was already disabled');
            return;
        }

        await config.update('autoSyncEnabled', false, vscode.ConfigurationTarget.Global);
        console.log('[ExtensionVersionChecker] 🔒 Auto-sync disabled due to outdated extensions');
        debug('Auto-sync disabled due to outdated extensions');
    } catch (error) {
        console.error('[ExtensionVersionChecker] ❌ Error disabling auto-sync:', error);
    }
}

/**
 * Re-enables auto-sync in the configuration
 */
async function enableAutoSync(): Promise<void> {
    try {
        const config = vscode.workspace.getConfiguration('codex-project-manager');
        const currentValue = config.get<boolean>('autoSyncEnabled', true);

        if (currentValue) {
            console.log('[ExtensionVersionChecker] ℹ️  Auto-sync was already enabled');
            return;
        }

        await config.update('autoSyncEnabled', true, vscode.ConfigurationTarget.Global);
        console.log('[ExtensionVersionChecker] 🔓 Auto-sync re-enabled - extensions are up to date');
        debug('Auto-sync re-enabled - extensions are up to date');
    } catch (error) {
        console.error('[ExtensionVersionChecker] ❌ Error enabling auto-sync:', error);
    }
}

/**
 * Main function to check extension versions and handle sync accordingly
 * Called during startup before any sync operations
 */
export async function checkExtensionVersionsOnStartup(context: vscode.ExtensionContext): Promise<boolean> {
    try {
        console.log('[ExtensionVersionChecker] ═══ STARTUP VERSION CHECK ═══');

        const now = Date.now();
        const lastCheck = context.globalState.get<number>(EXTENSION_CHECK_KEY, 0);
        const versionCheckDisabled = context.globalState.get<boolean>('codex-editor.versionCheckDisabled', false);

        console.log(`[ExtensionVersionChecker] Version check disabled: ${versionCheckDisabled}`);
        console.log(`[ExtensionVersionChecker] Last check: ${lastCheck > 0 ? new Date(lastCheck).toISOString() : 'Never'}`);
        console.log(`[ExtensionVersionChecker] Time since last check: ${lastCheck > 0 ? Math.round((now - lastCheck) / 1000 / 60) : 'N/A'} minutes`);

        // If user has disabled version checking, allow syncing
        if (versionCheckDisabled) {
            console.log('[ExtensionVersionChecker] ✅ Version checking is disabled by user - allowing sync');
            debug('Version checking is disabled by user');
            return true;
        }

        // Always perform version check on startup (no cooldown)
        console.log('[ExtensionVersionChecker] 🔄 Version check will run on every startup (no cooldown)');

        console.log('[ExtensionVersionChecker] 🔍 Performing fresh extension version check...');
        debug('Performing extension version check...');
        const versionResult = await checkExtensionVersions(context);

        // Update the last check timestamp
        await context.globalState.update(EXTENSION_CHECK_KEY, now);
        console.log('[ExtensionVersionChecker] ⏰ Updated last check timestamp');

        if (versionResult.hasOutdatedExtensions) {
            console.warn(
                `[ExtensionVersionChecker] ⚠️  Found ${versionResult.outdatedExtensions.length} outdated extension(s):`,
                versionResult.outdatedExtensions.map(ext => `${ext.displayName} (${ext.currentVersion} → ${ext.latestVersion})`).join(', ')
            );

            // Disable auto-sync immediately
            console.log('[ExtensionVersionChecker] 🚫 Disabling auto-sync due to outdated extensions...');
            await disableAutoSync();

            // Show notification and get user response
            console.log('[ExtensionVersionChecker] 🔔 Showing user notification...');
            const allowSync = await showOutdatedExtensionsNotification(context, versionResult.outdatedExtensions);

            if (!allowSync) {
                console.log('[ExtensionVersionChecker] 🛑 User chose to keep syncing disabled - sync blocked');
            } else {
                console.log('[ExtensionVersionChecker] ✅ User chose to allow syncing despite outdated extensions');
            }

            return allowSync;
        } else {
            console.log('[ExtensionVersionChecker] ✅ All extensions are up to date - allowing sync');
            debug('All extensions are up to date');
            // Ensure auto-sync is enabled (in case it was previously disabled)
            await enableAutoSync();
            return true;
        }

    } catch (error) {
        console.error('[ExtensionVersionChecker] ❌ Error during startup version check:', error);
        console.log('[ExtensionVersionChecker] ⚠️  Allowing sync to continue despite error to avoid blocking user');
        // On error, allow syncing to avoid blocking the user
        return true;
    } finally {
        console.log('[ExtensionVersionChecker] ═══ END STARTUP VERSION CHECK ═══\n');
    }
}

/**
 * Manual version check command (for testing or user-initiated checks)
 */
export async function manualVersionCheck(context: vscode.ExtensionContext): Promise<void> {
    try {
        console.log('[ExtensionVersionChecker] ═══ MANUAL VERSION CHECK REQUESTED ═══');
        console.log('[ExtensionVersionChecker] 👤 User-initiated version check starting...');

        const versionResult = await checkExtensionVersions(context);

        if (versionResult.hasOutdatedExtensions) {
            console.log('[ExtensionVersionChecker] 🔔 Showing user notification for outdated extensions...');
            const allowSync = await showOutdatedExtensionsNotification(context, versionResult.outdatedExtensions);

            if (allowSync) {
                console.log('[ExtensionVersionChecker] ✅ User chose to allow sync despite outdated extensions');
                await enableAutoSync();
            } else {
                console.log('[ExtensionVersionChecker] 🚫 User chose to disable sync due to outdated extensions');
                await disableAutoSync();
            }
        } else {
            console.log('[ExtensionVersionChecker] ✅ All extensions up to date - showing success message');
            vscode.window.showInformationMessage(
                'All extensions are up to date!',
                'OK'
            );
            await enableAutoSync();
        }

        console.log('[ExtensionVersionChecker] ═══ END MANUAL VERSION CHECK ═══');
    } catch (error) {
        console.error('[ExtensionVersionChecker] ❌ Error during manual version check:', error);
        vscode.window.showErrorMessage(`Version check failed: ${(error as Error).message}`);
    }
}

/**
 * Result of metadata version check
 */
interface MetadataVersionCheckResult {
    canSync: boolean;
    metadataUpdated: boolean;
    reason?: string;
    needsUserAction?: boolean;
    outdatedExtensions?: ExtensionVersionInfo[];
}

/**
 * Checks and updates extension versions in project metadata file
 * This is called during sync to ensure version compatibility
 */
export async function checkAndUpdateMetadataVersions(): Promise<MetadataVersionCheckResult> {
    try {
        console.log('[MetadataVersionChecker] ═══ METADATA VERSION CHECK ═══');

        // Get workspace folder and metadata file
        const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
        if (!workspaceFolder) {
            console.warn('[MetadataVersionChecker] ❌ No workspace folder found');
            return { canSync: false, metadataUpdated: false, reason: 'No workspace folder' };
        }

        const metadataPath = vscode.Uri.joinPath(workspaceFolder.uri, 'metadata.json');

        // Read metadata file
        let metadata: ProjectMetadata;
        try {
            const metadataContent = await vscode.workspace.fs.readFile(metadataPath);
            metadata = JSON.parse(new TextDecoder().decode(metadataContent));
        } catch (error) {
            console.warn('[MetadataVersionChecker] ❌ Could not read metadata.json:', error);
            return { canSync: false, metadataUpdated: false, reason: 'Could not read metadata file' };
        }

        // Ensure meta object exists
        if (!metadata.meta) {
            metadata.meta = {} as any;
        }

        // Get current extension versions
        const codexEditorVersion = getCurrentExtensionVersion('project-accelerate.codex-editor-extension');
        const frontierAuthVersion = getCurrentExtensionVersion('frontier-rnd.frontier-authentication');

        console.log('[MetadataVersionChecker] 📦 Current versions:');
        console.log(`  - Codex Editor: ${codexEditorVersion || 'not found'}`);
        console.log(`  - Frontier Authentication: ${frontierAuthVersion || 'not found'}`);

        // Check if either extension is missing
        if (!codexEditorVersion || !frontierAuthVersion) {
            const missingExtensions = [];
            if (!codexEditorVersion) missingExtensions.push('Codex Editor');
            if (!frontierAuthVersion) missingExtensions.push('Frontier Authentication');

            console.error(`[MetadataVersionChecker] ❌ Missing required extensions: ${missingExtensions.join(', ')}`);
            return {
                canSync: false,
                metadataUpdated: false,
                reason: `Missing required extensions: ${missingExtensions.join(', ')}`,
                needsUserAction: true
            };
        }

        // Initialize requiredExtensions if it doesn't exist
        if (!metadata.meta.requiredExtensions) {
            console.log('[MetadataVersionChecker] ➕ Adding extension version requirements to metadata');
            metadata.meta.requiredExtensions = {
                codexEditor: codexEditorVersion,
                frontierAuthentication: frontierAuthVersion
            };

            // Save updated metadata
            await saveMetadata(metadataPath, metadata);

            console.log('[MetadataVersionChecker] ✅ Added current extension versions to metadata');
            return { canSync: true, metadataUpdated: true };
        }

        // Check versions against metadata requirements
        const metadataCodexVersion = metadata.meta.requiredExtensions.codexEditor;
        const metadataFrontierVersion = metadata.meta.requiredExtensions.frontierAuthentication;

        console.log('[MetadataVersionChecker] 📋 Metadata requires:');
        console.log(`  - Codex Editor: ${metadataCodexVersion || 'not set'}`);
        console.log(`  - Frontier Authentication: ${metadataFrontierVersion || 'not set'}`);

        let metadataUpdated = false;
        const outdatedExtensions: ExtensionVersionInfo[] = [];

        // Check Codex Editor version
        if (metadataCodexVersion) {
            if (semver.lt(codexEditorVersion, metadataCodexVersion)) {
                console.warn(`[MetadataVersionChecker] ⚠️  Codex Editor outdated: ${codexEditorVersion} < ${metadataCodexVersion}`);
                outdatedExtensions.push({
                    extensionId: 'project-accelerate.codex-editor-extension',
                    currentVersion: codexEditorVersion,
                    latestVersion: metadataCodexVersion,
                    isOutdated: true,
                    downloadUrl: '',
                    displayName: 'Codex Editor'
                });
            } else if (semver.gt(codexEditorVersion, metadataCodexVersion)) {
                console.log(`[MetadataVersionChecker] 🚀 Updating Codex Editor version: ${metadataCodexVersion} → ${codexEditorVersion}`);
                metadata.meta.requiredExtensions.codexEditor = codexEditorVersion;
                metadataUpdated = true;
            }
        } else {
            console.log('[MetadataVersionChecker] ➕ Setting Codex Editor version in metadata');
            metadata.meta.requiredExtensions.codexEditor = codexEditorVersion;
            metadataUpdated = true;
        }

        // Check Frontier Authentication version
        if (metadataFrontierVersion) {
            if (semver.lt(frontierAuthVersion, metadataFrontierVersion)) {
                console.warn(`[MetadataVersionChecker] ⚠️  Frontier Authentication outdated: ${frontierAuthVersion} < ${metadataFrontierVersion}`);
                outdatedExtensions.push({
                    extensionId: 'frontier-rnd.frontier-authentication',
                    currentVersion: frontierAuthVersion,
                    latestVersion: metadataFrontierVersion,
                    isOutdated: true,
                    downloadUrl: '',
                    displayName: 'Frontier Authentication'
                });
            } else if (semver.gt(frontierAuthVersion, metadataFrontierVersion)) {
                console.log(`[MetadataVersionChecker] 🚀 Updating Frontier Authentication version: ${metadataFrontierVersion} → ${frontierAuthVersion}`);
                metadata.meta.requiredExtensions.frontierAuthentication = frontierAuthVersion;
                metadataUpdated = true;
            }
        } else {
            console.log('[MetadataVersionChecker] ➕ Setting Frontier Authentication version in metadata');
            metadata.meta.requiredExtensions.frontierAuthentication = frontierAuthVersion;
            metadataUpdated = true;
        }

        // Save metadata if updated
        if (metadataUpdated) {
            await saveMetadata(metadataPath, metadata);
            console.log('[MetadataVersionChecker] 💾 Metadata updated with latest extension versions');
        }

        // Determine if sync is allowed
        const canSync = outdatedExtensions.length === 0;

        if (!canSync) {
            console.warn(`[MetadataVersionChecker] 🚫 Sync blocked due to ${outdatedExtensions.length} outdated extension(s)`);
            return {
                canSync: false,
                metadataUpdated,
                reason: `Extensions need updating: ${outdatedExtensions.map(ext => `${ext.displayName} (${ext.currentVersion} → ${ext.latestVersion})`).join(', ')}`,
                needsUserAction: true,
                outdatedExtensions
            };
        }

        console.log('[MetadataVersionChecker] ✅ All extension versions compatible with metadata');
        return { canSync: true, metadataUpdated };

    } catch (error) {
        console.error('[MetadataVersionChecker] ❌ Error during metadata version check:', error);
        return {
            canSync: false,
            metadataUpdated: false,
            reason: `Version check failed: ${(error as Error).message}`
        };
    } finally {
        console.log('[MetadataVersionChecker] ═══ END METADATA VERSION CHECK ═══\n');
    }
}

/**
 * Helper function to save metadata file
 */
async function saveMetadata(metadataPath: vscode.Uri, metadata: ProjectMetadata): Promise<void> {
    const metadataContent = JSON.stringify(metadata, null, 4);
    await vscode.workspace.fs.writeFile(metadataPath, new TextEncoder().encode(metadataContent));
}

/**
 * Checks if we should show the version modal based on cooldown period
 */
function shouldShowVersionModal(context: vscode.ExtensionContext, isManualSync: boolean): boolean {
    // Always show for manual sync
    if (isManualSync) {
        console.log('[VersionModalCooldown] Manual sync - showing modal');
        return true;
    }

    // Check cooldown for auto-sync
    const lastShown = context.workspaceState.get<number>(VERSION_MODAL_COOLDOWN_KEY, 0);
    const now = Date.now();
    const timeSinceLastShown = now - lastShown;

    if (timeSinceLastShown >= VERSION_MODAL_COOLDOWN_MS) {
        console.log(`[VersionModalCooldown] Auto-sync - cooldown expired (${Math.round(timeSinceLastShown / 1000 / 60)} minutes ago), showing modal`);
        return true;
    } else {
        const remainingMs = VERSION_MODAL_COOLDOWN_MS - timeSinceLastShown;
        const remainingMinutes = Math.round(remainingMs / 1000 / 60);
        console.log(`[VersionModalCooldown] Auto-sync - in cooldown period, ${remainingMinutes} minutes remaining`);
        return false;
    }
}

/**
 * Updates the timestamp for when the version modal was last shown
 */
async function updateVersionModalTimestamp(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(VERSION_MODAL_COOLDOWN_KEY, Date.now());
    console.log('[VersionModalCooldown] Updated last shown timestamp');
}

/**
 * Resets the version modal cooldown (called on extension activation)
 */
export async function resetVersionModalCooldown(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(VERSION_MODAL_COOLDOWN_KEY, 0);
    console.log('[VersionModalCooldown] Reset cooldown timestamp on extension activation');
}

/**
 * Shows notification for metadata version mismatches
 */
async function showMetadataVersionMismatchNotification(
    context: vscode.ExtensionContext,
    outdatedExtensions: ExtensionVersionInfo[]
): Promise<boolean> {
    const extensionNames = outdatedExtensions.map(ext => ext.displayName).join(', ');
    const message = outdatedExtensions.length === 1
        ? `${extensionNames} extension needs to be updated.\n\nPlease update to enable syncing.`
        : `${extensionNames} extensions need to be updated.\n\nPlease update to enable syncing.`;

    const actions = ['Update Extensions'];

    try {
        const selection = await vscode.window.showWarningMessage(
            message,
            { modal: true },
            ...actions
        );

        switch (selection) {
            case 'Update Extensions':
                await vscode.commands.executeCommand('workbench.view.extensions');
                // Show detailed info about each outdated extension
                for (const ext of outdatedExtensions) {
                    vscode.window.showInformationMessage(
                        `Update ${ext.displayName} from v${ext.currentVersion} to v${ext.latestVersion}`,
                        'Search in Extensions'
                    ).then(choice => {
                        if (choice === 'Search in Extensions') {
                            vscode.commands.executeCommand('workbench.extensions.search', ext.extensionId);
                        }
                    });
                }

                // Update timestamp when modal is shown
                await updateVersionModalTimestamp(context);
                return false; // Don't allow sync until updated

            default:
                return false; // Cancel the sync operation
        }
    } catch (error) {
        console.error('[MetadataVersionChecker] Error showing notification:', error);
        return false; // Don't allow sync on error
    }
}

/**
 * Checks metadata versions and handles user interaction for sync operations
 */
export async function checkMetadataVersionsForSync(
    context: vscode.ExtensionContext,
    isManualSync: boolean = false
): Promise<boolean> {
    const result = await checkAndUpdateMetadataVersions();

    if (result.canSync) {
        return true;
    }

    if (result.needsUserAction && result.outdatedExtensions) {
        // Check if we should show the modal based on cooldown period
        const shouldShow = shouldShowVersionModal(context, isManualSync);

        if (shouldShow) {
            // Show user notification and get their choice
            return await showMetadataVersionMismatchNotification(context, result.outdatedExtensions);
        } else {
            // In cooldown period for auto-sync, silently block sync
            console.log('[MetadataVersionChecker] Auto-sync blocked due to outdated extensions (in cooldown period)');
            return false;
        }
    }

    // For other failures, just log and don't allow sync
    console.warn('[MetadataVersionChecker] Sync not allowed:', result.reason);
    return false;
}

/**
 * Registers version check related commands
 */
export function registerVersionCheckCommands(context: vscode.ExtensionContext): void {
    const commands = [
        vscode.commands.registerCommand('codex-editor.checkExtensionVersions', () => manualVersionCheck(context)),
        vscode.commands.registerCommand('codex-editor.enableVersionCheck', async () => {
            await context.globalState.update('codex-editor.versionCheckDisabled', false);
            vscode.window.showInformationMessage('Extension version checking enabled.');
        }),
        vscode.commands.registerCommand('codex-editor.disableVersionCheck', async () => {
            await context.globalState.update('codex-editor.versionCheckDisabled', true);
            vscode.window.showInformationMessage('Extension version checking disabled.');
        })
    ];

    context.subscriptions.push(...commands);
} 