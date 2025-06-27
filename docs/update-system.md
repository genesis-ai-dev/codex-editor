# Update Notification System

## Overview

Codex Editor includes a completely non-intrusive update notification system that follows VS Code best practices. The system monitors VS Code's automatic update checks and only shows notifications when updates are actually available, eliminating annoying "no updates available" dialogs.

## How It Works

### Passive Monitoring

- **Startup Monitoring**: Silently monitors update state after extension activation
- **Frequency**: State checks are limited to once per 24 hours to avoid being intrusive
- **Zero Dialogs**: Never shows "no updates available" messages during startup
- **Background Reliance**: Relies on VS Code's automatic background update checks

### User Experience

- **Non-Modal**: Notifications don't block the user interface
- **Dismissible**: Users can choose "Skip" to dismiss notifications for specific versions
- **Actionable**: Clear options for handling available updates
- **Respectful**: Honors user preferences and dismissal choices
- **Silent**: Completely silent when no updates are available

## Notification Actions

The notification shows different options based on the update state:

### When Update is Ready to Install

- **Restart Now** - Immediately restarts VS Code to apply the update
- **Release Notes** - Shows what's new in the update
- **Skip** - Dismisses notifications for this specific version

### When Update is Available for Download

- **Download Now** - Downloads the update in the background
- **Release Notes** - Shows what's new in the update
- **Skip** - Dismisses notifications for this specific version

The system intelligently determines which actions are appropriate based on VS Code's current update state (ready to install vs. available for download).

## Available Commands

The system registers two commands in VS Code:

### `codex-editor.checkForUpdates`

- Manually triggers an update check
- First checks if updates are already available (no dialog)
- Only triggers fresh check if needed (may show VS Code's built-in "no updates" dialog)
- Shows Codex Editor notification if updates are found
- Useful for users who want to check on demand

### `codex-editor.resetUpdateDismissal`

- Clears the "Skip" dismissal setting
- Re-enables update notifications for all versions
- Useful if users change their mind about seeing updates

## Technical Details

### VS Code Integration

The system uses VS Code's internal update state and commands:

- `_update.state` - Monitors current update state (ready, downloaded, available, idle, etc.)
- `update.checkForUpdate` - Triggers explicit update checks (manual only)
- `update.downloadUpdate` - Downloads available updates
- `update.restartToUpdate` - Restarts to apply ready updates
- `update.installUpdate` - Installs downloaded updates
- `update.showCurrentReleaseNotes` - Shows release notes

### State-Based Detection

The system reads VS Code's update state machine:

- **ready** - Update downloaded and ready to install (restart required)
- **downloaded** - Update downloaded and ready to install (Windows)
- **available for download** - Update available but needs downloading
- **downloading** - Update currently downloading (no notification)
- **updating** - Update being applied (no notification)
- **idle** - No update available or activity

### Storage

User preferences are stored in VS Code's global state:

- `codex-editor.updateDismissed` - Tracks dismissed version
- `codex-editor.lastUpdateCheck` - Prevents excessive state checking

### Performance

- **Passive**: No active update checking - only state monitoring
- **Non-blocking**: State monitoring doesn't affect extension startup
- **Throttled**: Limited to once per day maximum
- **Silent**: Relies on VS Code's automatic background update checks
- **Error Handling**: Fails silently to avoid disrupting users

## Benefits

1. **Completely Silent**: Never shows annoying "no updates available" dialogs
2. **Passive Monitoring**: Relies on VS Code's automatic update checks instead of triggering explicit checks
3. **Smart State Detection**: Reads VS Code's internal update state for accurate information
4. **Context-Aware Actions**: Shows appropriate buttons based on update state (download vs. restart)
5. **User Control**: Full control over when and how to handle updates
6. **Follows VS Code Patterns**: Uses VS Code's internal update state machine
7. **Respectful**: Honors user preferences and doesn't spam notifications
8. **Professional**: Clean, dismissible notifications with clear actions

## Development Notes

The update system is implemented in `src/utils/updateChecker.ts` and automatically registered during extension activation. It integrates seamlessly with VS Code's built-in update infrastructure.

## Testing

To test the update system during development:

1. **Check Current State**: Use the command palette: `Codex Editor: Check for Updates`
    - If updates are already available, shows Codex Editor notification immediately
    - If no updates, may show VS Code's built-in "no updates available" dialog
2. **Reset Dismissals**: Use `Codex Editor: Reset Update Dismissal` to re-enable notifications for testing

3. **Monitor State**: The system automatically monitors VS Code's update state in the background
    - Notifications appear when VS Code's automatic update checks find updates
    - No action needed - the system is completely passive

## Example Scenarios

- **Codex with Update Ready**: Shows "Codex Editor update is ready to install" with "Restart Now" button
- **VSCodium with No Updates**: Shows nothing (completely silent)
- **Update Available for Download**: Shows "A Codex Editor update is available" with "Download Now" button
