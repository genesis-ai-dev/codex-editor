import * as vscode from 'vscode';
import * as path from 'path';

/**
 * Automatically migrates legacy .x-m4a audio files to .m4a on startup
 * Runs silently without user notification, similar to database corruption repair
 * 
 * This follows the pattern of automatic repairs in:
 * - sqliteIndexManager.ts (database corruption)
 * - commentsMigrationUtils.ts (comment data repair)
 * 
 * This runs during extension activation if a workspace with metadata exists
 */
export async function autoMigrateLegacyAudioFiles(): Promise<void> {
    try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const attachmentsRoot = path.join(workspaceRoot, '.project', 'attachments');

        // Quick check: do we even have an attachments folder?
        try {
            await vscode.workspace.fs.stat(vscode.Uri.file(attachmentsRoot));
        } catch {
            return; // No attachments folder = no problem
        }

        // Search for .x-m4a files
        const pattern = new vscode.RelativePattern(attachmentsRoot, '**/*.x-m4a');
        const xm4aFiles = await vscode.workspace.findFiles(pattern);

        if (xm4aFiles.length === 0) {
            return; // No legacy files found
        }

        console.log(`[Audio Migration] Found ${xm4aFiles.length} legacy .x-m4a file(s) - auto-migrating silently`);

        // Import and run migration silently
        const { migrateXM4aFiles } = await import('./audioMigration');
        const result = await migrateXM4aFiles();

        // Log results but don't show UI
        if (result.renamedFiles.length > 0) {
            console.log(`[Audio Migration] Successfully migrated ${result.renamedFiles.length} file(s)`);
        }
        if (result.updatedCodexFiles.length > 0) {
            console.log(`[Audio Migration] Updated ${result.updatedCodexFiles.length} .codex file(s)`);
        }
        if (result.errors.length > 0) {
            console.error(`[Audio Migration] Encountered ${result.errors.length} error(s):`, result.errors);
        }
    } catch (error) {
        // Don't fail startup if migration fails - just log it
        console.error('[Audio Migration] Error during automatic migration:', error);
    }
}

