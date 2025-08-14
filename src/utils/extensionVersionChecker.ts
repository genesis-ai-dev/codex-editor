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

const VERSION_MODAL_COOLDOWN_KEY = 'codex-editor.versionModalLastShown';
const VERSION_MODAL_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours in milliseconds



/**
 * Gets the current version of an installed extension
 */
function getCurrentExtensionVersion(extensionId: string): string | null {
    const extension = vscode.extensions.getExtension(extensionId);
    return extension?.packageJSON?.version || null;
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
    const extensionNames = outdatedExtensions.map(ext => ext.displayName).join(' and ');
    const message = outdatedExtensions.length === 1
        ? `${extensionNames} needs to be updated to enable syncing.`
        : `${extensionNames} need to be updated to enable syncing.`;

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
} 