import * as vscode from 'vscode';

const DEBUG_MODE = true;
const debug = (message: string) => {
    if (DEBUG_MODE) {
        console.log(`[UpdateChecker] ${message}`);
    }
};


interface UpdateInfo {
    available: boolean;
    version?: string;
    releaseNotes?: string;
    downloadUrl?: string;
    state?: 'readyToInstall' | 'readyToDownload';
}

const UPDATE_DISMISSED_KEY = 'codex-editor.updateDismissed';
const LAST_UPDATE_CHECK_KEY = 'codex-editor.lastUpdateCheck';
const UPDATE_CHECK_INTERVAL = 24 * 60 * 60 * 1000; // 24 hours in milliseconds

/**
 * Monitors update state silently and shows notifications only when updates are available
 * This avoids triggering explicit update checks that show "no updates available" dialogs
 */
export async function checkForUpdatesOnStartup(context: vscode.ExtensionContext): Promise<void> {
    try {
        const now = Date.now();
        const lastCheck = context.globalState.get<number>(LAST_UPDATE_CHECK_KEY, 0);

        // Only check once per day to avoid being too aggressive
        if (now - lastCheck < UPDATE_CHECK_INTERVAL) {
            debug('Skipping update check - checked recently');
            return;
        }

        debug('Monitoring update state...');

        // Simply check the current update state without triggering explicit checks
        // This relies on VS Code's automatic background update checks
        const currentState = await vscode.commands.executeCommand('_update.state') as any;
        debug(`Current update state: ${JSON.stringify(currentState)}`);

        let updateInfo: any = null;

        if (currentState) {
            switch (currentState.type) {
                case 'ready':
                    debug('Update is ready to install (StateType.Ready)');
                    updateInfo = {
                        available: true,
                        state: 'readyToInstall',
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    break;

                case 'downloaded':
                    debug('Update is downloaded and ready to install (StateType.Downloaded)');
                    updateInfo = {
                        available: true,
                        state: 'readyToInstall',
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    break;

                case 'available for download':
                    debug('Update is available for download (StateType.AvailableForDownload)');
                    updateInfo = {
                        available: true,
                        state: 'readyToDownload',
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    break;

                case 'downloading':
                    debug('Update is currently downloading - will check again later');
                    break;

                case 'updating':
                    debug('Update is being applied');
                    break;

                case 'checking for updates':
                    debug('VS Code is currently checking for updates');
                    break;

                case 'idle':
                case 'uninitialized':
                case 'disabled':
                default:
                    debug(`No update available (state: ${currentState.type})`);
                    break;
            }
        }

        // Update the last check timestamp
        await context.globalState.update(LAST_UPDATE_CHECK_KEY, now);

        if (!updateInfo || !updateInfo.available) {
            debug('No updates available');
            return;
        }

        debug(`Update available: ${JSON.stringify(updateInfo)}`);

        // Check if user has dismissed this specific version
        const dismissedVersion = context.globalState.get<string>(UPDATE_DISMISSED_KEY);
        const currentVersion = updateInfo.version || updateInfo.state || 'current';

        if (dismissedVersion === currentVersion) {
            debug('Update dismissed by user for this version');
            return;
        }

        // Show update notification with actions
        await showUpdateNotification(context, updateInfo);

    } catch (error) {
        console.error('[UpdateChecker] Error monitoring updates:', error);
        // Fail silently - don't bother users with update check errors
    }
}

/**
 * Shows a dismissible update notification with action buttons
 */
async function showUpdateNotification(context: vscode.ExtensionContext, updateInfo: UpdateInfo): Promise<void> {
    let message: string;
    let actions: string[];

    // Determine message and actions based on update state
    if (updateInfo.state === 'readyToInstall') {
        // Update is downloaded and ready to install
        message = updateInfo.version && updateInfo.version !== 'unknown'
            ? `Codex Editor update ready to install: Version ${updateInfo.version}`
            : 'Codex Editor update is ready to install';
        actions = ['Restart Now', 'Release Notes', 'Skip'];
    } else if (updateInfo.state === 'readyToDownload') {
        // Update is available but needs to be downloaded
        message = updateInfo.version && updateInfo.version !== 'unknown'
            ? `Codex Editor update available: Version ${updateInfo.version}`
            : 'A Codex Editor update is available';
        actions = ['Download Now', 'Release Notes', 'Skip'];
    } else {
        // Fallback for unknown state
        message = updateInfo.version && updateInfo.version !== 'unknown'
            ? `Codex Editor update available: Version ${updateInfo.version}`
            : 'A Codex Editor update is available';
        actions = ['Download', 'Restart', 'Release Notes', 'Skip'];
    }

    try {
        const selection = await vscode.window.showInformationMessage(
            message,
            { modal: false }, // Non-modal so it doesn't block the user
            ...actions
        );

        if (!selection) {
            return; // User dismissed without selecting
        }

        switch (selection) {
            case 'Download Now':
            case 'Download':
                await downloadUpdate();
                break;

            case 'Restart Now':
            case 'Restart':
                await installUpdate();
                break;

            case 'Release Notes':
                await showReleaseNotes();
                break;

            case 'Skip': {
                // Remember that user dismissed this version
                const versionToRemember = updateInfo.version || updateInfo.state || 'current';
                await context.globalState.update(UPDATE_DISMISSED_KEY, versionToRemember);
                vscode.window.showInformationMessage('Update notifications disabled for this version.');
                break;
            }

            default:
                // Do nothing - will check again in 24 hours
                debug('User chose to be reminded later');
                break;
        }
    } catch (error) {
        console.error('[UpdateChecker] Error showing update notification:', error);
    }
}

/**
 * Downloads the available update
 */
async function downloadUpdate(): Promise<void> {
    try {
        debug('Downloading update...');

        // Use the correct VS Code command for downloading updates
        await vscode.commands.executeCommand('update.downloadUpdate');

        vscode.window.showInformationMessage(
            'Update download started. You will be notified when it\'s ready to install.',
            'OK'
        );
    } catch (error) {
        console.error('[UpdateChecker] Error downloading update:', error);
        vscode.window.showErrorMessage(`Failed to download update: ${(error as Error).message}`);
    }
}

/**
 * Installs the update (either by installing or restarting depending on state)
 */
async function installUpdate(): Promise<void> {
    try {
        debug('Installing update...');

        // Get the current update state to determine the correct action
        const currentState = await vscode.commands.executeCommand('_update.state') as any;
        debug(`Install update - current state: ${JSON.stringify(currentState)}`);

        if (currentState) {
            switch (currentState.type) {
                case 'ready':
                    // StateType.Ready - update is ready, need to restart to apply
                    debug('Using update.restartToUpdate (StateType.Ready)');
                    await vscode.commands.executeCommand('update.restartToUpdate');
                    break;

                case 'downloaded':
                    // StateType.Downloaded - update is downloaded, need to install
                    debug('Using update.installUpdate (StateType.Downloaded)');
                    await vscode.commands.executeCommand('update.installUpdate');
                    break;

                default:
                    vscode.window.showErrorMessage('No update is ready to install. Please check for updates first.');
                    break;
            }
        } else {
            vscode.window.showErrorMessage('Unable to determine update state.');
        }
    } catch (error) {
        console.error('[UpdateChecker] Error installing update:', error);
        vscode.window.showErrorMessage(`Failed to install update: ${(error as Error).message}`);
    }
}

/**
 * Shows the current release notes
 */
async function showReleaseNotes(): Promise<void> {
    try {
        debug('Showing release notes...');
        // Use the correct command ID from VS Code source
        await vscode.commands.executeCommand('update.showCurrentReleaseNotes');
    } catch (error) {
        console.error('[UpdateChecker] Error showing release notes:', error);
        vscode.window.showErrorMessage('Failed to show release notes');
    }
}

/**
 * Manually trigger an update check (for commands/testing)
 * Note: This will show VS Code's built-in "no updates available" dialog if no updates are found
 */
export async function manualUpdateCheck(context: vscode.ExtensionContext): Promise<void> {
    try {
        // Get the current update state first
        let currentState = await vscode.commands.executeCommand('_update.state') as any;
        debug(`Manual check - current state: ${JSON.stringify(currentState)}`);

        // Handle current states that don't need a fresh check
        if (currentState) {
            switch (currentState.type) {
                case 'ready':
                case 'downloaded': {
                    // Update is already available
                    const readyUpdateInfo = {
                        available: true,
                        state: 'readyToInstall' as const,
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    await showUpdateNotification(context, readyUpdateInfo);
                    return;
                }

                case 'available for download': {
                    // Update is already available for download
                    const downloadUpdateInfo = {
                        available: true,
                        state: 'readyToDownload' as const,
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    await showUpdateNotification(context, downloadUpdateInfo);
                    return;
                }

                case 'downloading':
                    vscode.window.showInformationMessage('An update is currently downloading. Please wait for it to complete.');
                    return;

                case 'updating':
                    vscode.window.showInformationMessage('An update is currently being applied.');
                    return;

                case 'checking for updates':
                    vscode.window.showInformationMessage('Already checking for updates. Please wait.');
                    return;
            }
        }

        // If we get here, we need to trigger a fresh update check
        // This will show VS Code's built-in dialog if no updates are found
        debug('Triggering manual update check');
        await vscode.commands.executeCommand('update.checkForUpdate');

        // Wait for the check to complete
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Get the state again after checking
        currentState = await vscode.commands.executeCommand('_update.state') as any;
        debug(`Manual check - new state: ${JSON.stringify(currentState)}`);

        // Show our notification if updates were found
        if (currentState) {
            let updateInfo: any = null;

            switch (currentState.type) {
                case 'ready':
                case 'downloaded':
                    updateInfo = {
                        available: true,
                        state: 'readyToInstall',
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    break;

                case 'available for download':
                    updateInfo = {
                        available: true,
                        state: 'readyToDownload',
                        version: currentState.update?.version,
                        releaseNotes: currentState.update?.releaseNotes,
                        url: currentState.update?.url
                    };
                    break;
            }

            if (updateInfo) {
                // Show our notification regardless of dismissal for manual checks
                await showUpdateNotification(context, updateInfo);
            }
            // If no updateInfo, VS Code's built-in dialog already handled the "no updates" case
        }

    } catch (error) {
        console.error('[UpdateChecker] Error in manual update check:', error);
        vscode.window.showErrorMessage(`Update check failed: ${(error as Error).message}`);
    }
}

/**
 * Registers update-related commands
 */
export function registerUpdateCommands(context: vscode.ExtensionContext): void {
    const commands = [
        vscode.commands.registerCommand('codex-editor.checkForUpdates', () => manualUpdateCheck(context)),
        vscode.commands.registerCommand('codex-editor.resetUpdateDismissal', async () => {
            await context.globalState.update(UPDATE_DISMISSED_KEY, undefined);
            vscode.window.showInformationMessage('Update dismissal reset. You will see update notifications again.');
        })
    ];

    context.subscriptions.push(...commands);
} 