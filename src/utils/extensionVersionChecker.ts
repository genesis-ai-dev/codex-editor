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

        const response = await fetch(url);

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        const data = await response.json() as OpenVSXExtensionInfo;
        debug(`Retrieved version: ${JSON.stringify({
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

    const results: ExtensionVersionInfo[] = [];
    let hasOutdatedExtensions = false;

    // Log all installed extensions for context
    const allInstalledExtensions = vscode.extensions.all
        .filter(ext => !ext.id.startsWith('vscode.'))
        .map(ext => `${ext.id} v${ext.packageJSON?.version || 'unknown'}`)
        .sort();

    allInstalledExtensions.forEach(ext => debug(`  - ${ext}`));

    for (const extensionConfig of EXTENSIONS_TO_CHECK) {
        const currentVersion = getCurrentExtensionVersion(extensionConfig.id);

        if (!currentVersion) {
            console.warn(`[ExtensionVersionChecker] ❌ Extension ${extensionConfig.id} not found or version not available`);
            debug(`Extension ${extensionConfig.id} not found or version not available`);
            continue;
        }

        debug(`Checking ${extensionConfig.displayName}: current version ${currentVersion}`);

        const latestInfo = await fetchLatestVersionFromOpenVSX(extensionConfig.openVsxPath);

        if (!latestInfo) {
            console.error(`[ExtensionVersionChecker] ❌ Could not fetch latest version for ${extensionConfig.displayName} from open-vsx.org`);
            debug(`Could not fetch latest version for ${extensionConfig.displayName}`);
            continue;
        }

        const latestVersion = latestInfo.version;

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
    }

    const result: VersionCheckResult = {
        hasOutdatedExtensions,
        outdatedExtensions: results.filter(r => r.isOutdated),
        allExtensions: results
    };

    if (result.outdatedExtensions.length > 0) {
        debug('[ExtensionVersionChecker] Outdated extensions:');
        result.outdatedExtensions.forEach(ext => {
            debug(`[ExtensionVersionChecker]   - ${ext.displayName}: ${ext.currentVersion} → ${ext.latestVersion}`);
        });
    }

    debug('[ExtensionVersionChecker] === END SUMMARY ===');
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
            debug('[ExtensionVersionChecker] ℹ️  Auto-sync was already disabled');
            return;
        }

        await config.update('autoSyncEnabled', false, vscode.ConfigurationTarget.Global);
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
            debug('[ExtensionVersionChecker] ℹ️  Auto-sync was already enabled');
            return;
        }

        await config.update('autoSyncEnabled', true, vscode.ConfigurationTarget.Global);
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
        const now = Date.now();
        const lastCheck = context.globalState.get<number>(EXTENSION_CHECK_KEY, 0);
        const versionCheckDisabled = context.globalState.get<boolean>('codex-editor.versionCheckDisabled', false);

        debug(`[ExtensionVersionChecker] Version check disabled: ${versionCheckDisabled}`);
        debug(`[ExtensionVersionChecker] Last check: ${lastCheck > 0 ? new Date(lastCheck).toISOString() : 'Never'}`);
        debug(`[ExtensionVersionChecker] Time since last check: ${lastCheck > 0 ? Math.round((now - lastCheck) / 1000 / 60) : 'N/A'} minutes`);

        // If user has disabled version checking, allow syncing
        if (versionCheckDisabled) {
            debug('[ExtensionVersionChecker] ✅ Version checking is disabled by user - allowing sync');
            debug('Version checking is disabled by user');
            return true;
        }

        // Always perform version check on startup (no cooldown)
        debug('[ExtensionVersionChecker] 🔄 Version check will run on every startup (no cooldown)');

        debug('[ExtensionVersionChecker] 🔍 Performing fresh extension version check...');
        debug('Performing extension version check...');
        const versionResult = await checkExtensionVersions(context);

        // Update the last check timestamp
        await context.globalState.update(EXTENSION_CHECK_KEY, now);
        debug('[ExtensionVersionChecker] ⏰ Updated last check timestamp');

        if (versionResult.hasOutdatedExtensions) {
            console.warn(
                `[ExtensionVersionChecker] ⚠️  Found ${versionResult.outdatedExtensions.length} outdated extension(s):`,
                versionResult.outdatedExtensions.map(ext => `${ext.displayName} (${ext.currentVersion} → ${ext.latestVersion})`).join(', ')
            );

            // Disable auto-sync immediately
            debug('[ExtensionVersionChecker] 🚫 Disabling auto-sync due to outdated extensions...');
            await disableAutoSync();

            // Show notification and get user response
            debug('[ExtensionVersionChecker] 🔔 Showing user notification...');
            const allowSync = await showOutdatedExtensionsNotification(context, versionResult.outdatedExtensions);

            if (!allowSync) {
                debug('[ExtensionVersionChecker] 🛑 User chose to keep syncing disabled - sync blocked');
            } else {
                debug('[ExtensionVersionChecker] ✅ User chose to allow syncing despite outdated extensions');
            }

            return allowSync;
        } else {
            debug('[ExtensionVersionChecker] ✅ All extensions are up to date - allowing sync');
            debug('All extensions are up to date');
            // Ensure auto-sync is enabled (in case it was previously disabled)
            await enableAutoSync();
            return true;
        }

    } catch (error) {
        console.error('[ExtensionVersionChecker] ❌ Error during startup version check:', error);
        debug('[ExtensionVersionChecker] ⚠️  Allowing sync to continue despite error to avoid blocking user');
        // On error, allow syncing to avoid blocking the user
        return true;
    } finally {
        debug('[ExtensionVersionChecker] ═══ END STARTUP VERSION CHECK ═══\n');
    }
}

/**
 * Manual version check command (for testing or user-initiated checks)
 */
export async function manualVersionCheck(context: vscode.ExtensionContext): Promise<void> {
    try {
        debug('[ExtensionVersionChecker] ═══ MANUAL VERSION CHECK REQUESTED ═══');
        debug('[ExtensionVersionChecker] 👤 User-initiated version check starting...');

        const versionResult = await checkExtensionVersions(context);

        if (versionResult.hasOutdatedExtensions) {
            debug('[ExtensionVersionChecker] 🔔 Showing user notification for outdated extensions...');
            const allowSync = await showOutdatedExtensionsNotification(context, versionResult.outdatedExtensions);

            if (allowSync) {
                debug('[ExtensionVersionChecker] ✅ User chose to allow sync despite outdated extensions');
                await enableAutoSync();
            } else {
                debug('[ExtensionVersionChecker] 🚫 User chose to disable sync due to outdated extensions');
                await disableAutoSync();
            }
        } else {
            debug('[ExtensionVersionChecker] ✅ All extensions up to date - showing success message');
            vscode.window.showInformationMessage(
                'All extensions are up to date!',
                'OK'
            );
            await enableAutoSync();
        }

        debug('[ExtensionVersionChecker] ═══ END MANUAL VERSION CHECK ═══');
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
        debug('[MetadataVersionChecker] ═══ METADATA VERSION CHECK ═══');

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

        debug('[MetadataVersionChecker] 📦 Current versions:');
        debug(`  - Codex Editor: ${codexEditorVersion || 'not found'}`);
        debug(`  - Frontier Authentication: ${frontierAuthVersion || 'not found'}`);

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
            debug('[MetadataVersionChecker] ➕ Adding extension version requirements to metadata');
            metadata.meta.requiredExtensions = {
                codexEditor: codexEditorVersion,
                frontierAuthentication: frontierAuthVersion
            };

            // Save updated metadata
            await saveMetadata(metadataPath, metadata);

            debug('[MetadataVersionChecker] ✅ Added current extension versions to metadata');
            return { canSync: true, metadataUpdated: true };
        }

        // Check versions against metadata requirements
        const metadataCodexVersion = metadata.meta.requiredExtensions.codexEditor;
        const metadataFrontierVersion = metadata.meta.requiredExtensions.frontierAuthentication;

        debug('[MetadataVersionChecker] 📋 Metadata requires:');
        debug(`  - Codex Editor: ${metadataCodexVersion || 'not set'}`);
        debug(`  - Frontier Authentication: ${metadataFrontierVersion || 'not set'}`);

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
                debug(`[MetadataVersionChecker] 🚀 Updating Codex Editor version: ${metadataCodexVersion} → ${codexEditorVersion}`);
                metadata.meta.requiredExtensions.codexEditor = codexEditorVersion;
                metadataUpdated = true;
            }
        } else {
            debug('[MetadataVersionChecker] ➕ Setting Codex Editor version in metadata');
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
                debug(`[MetadataVersionChecker] 🚀 Updating Frontier Authentication version: ${metadataFrontierVersion} → ${frontierAuthVersion}`);
                metadata.meta.requiredExtensions.frontierAuthentication = frontierAuthVersion;
                metadataUpdated = true;
            }
        } else {
            debug('[MetadataVersionChecker] ➕ Setting Frontier Authentication version in metadata');
            metadata.meta.requiredExtensions.frontierAuthentication = frontierAuthVersion;
            metadataUpdated = true;
        }

        // Save metadata if updated
        if (metadataUpdated) {
            await saveMetadata(metadataPath, metadata);
            debug('[MetadataVersionChecker] 💾 Metadata updated with latest extension versions');
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

        debug('[MetadataVersionChecker] ✅ All extension versions compatible with metadata');
        return { canSync: true, metadataUpdated };

    } catch (error) {
        console.error('[MetadataVersionChecker] ❌ Error during metadata version check:', error);
        return {
            canSync: false,
            metadataUpdated: false,
            reason: `Version check failed: ${(error as Error).message}`
        };
    } finally {
        debug('[MetadataVersionChecker] ═══ END METADATA VERSION CHECK ═══\n');
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
        debug('[VersionModalCooldown] Manual sync - showing modal');
        return true;
    }

    // Check cooldown for auto-sync
    const lastShown = context.workspaceState.get<number>(VERSION_MODAL_COOLDOWN_KEY, 0);
    const now = Date.now();
    const timeSinceLastShown = now - lastShown;

    if (timeSinceLastShown >= VERSION_MODAL_COOLDOWN_MS) {
        debug(`[VersionModalCooldown] Auto-sync - cooldown expired (${Math.round(timeSinceLastShown / 1000 / 60)} minutes ago), showing modal`);
        return true;
    } else {
        const remainingMs = VERSION_MODAL_COOLDOWN_MS - timeSinceLastShown;
        const remainingMinutes = Math.round(remainingMs / 1000 / 60);
        debug(`[VersionModalCooldown] Auto-sync - in cooldown period, ${remainingMinutes} minutes remaining`);
        return false;
    }
}

/**
 * Updates the timestamp for when the version modal was last shown
 */
async function updateVersionModalTimestamp(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(VERSION_MODAL_COOLDOWN_KEY, Date.now());
    debug('[VersionModalCooldown] Updated last shown timestamp');
}

/**
 * Resets the version modal cooldown (called on extension activation)
 */
export async function resetVersionModalCooldown(context: vscode.ExtensionContext): Promise<void> {
    await context.workspaceState.update(VERSION_MODAL_COOLDOWN_KEY, 0);
    debug('[VersionModalCooldown] Reset cooldown timestamp on extension activation');
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
            debug('[MetadataVersionChecker] Auto-sync blocked due to outdated extensions (in cooldown period)');
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