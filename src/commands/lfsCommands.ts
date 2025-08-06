import * as vscode from "vscode";
import { LFSHelper } from "../utils/lfsUtils";
import { LFSAudioHandler } from "../providers/codexCellEditorProvider/lfsAudioHandler";

/**
 * Commands for managing Git LFS in Codex projects
 */
export function registerLFSCommands(context: vscode.ExtensionContext) {

    // Initialize LFS in current project
    const initializeLFS = vscode.commands.registerCommand(
        'codex-editor-extension.lfs.initialize',
        async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage("No workspace folder found");
                return;
            }

            const confirmed = await vscode.window.showInformationMessage(
                "Initialize Git LFS for this project? This will:\n\n• Update .gitignore to allow attachment tracking\n• Configure .gitattributes for LFS\n• Track ALL audio files + large video/image files in LFS",
                { modal: true },
                "Yes", "No"
            );

            if (confirmed !== "Yes") {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Initializing Git LFS...",
                cancellable: false
            }, async (progress) => {
                progress.report({ message: "Updating .gitignore..." });
                const success = await LFSHelper.initializeLFS(workspaceFolder.uri);

                if (success) {
                    vscode.window.showInformationMessage(
                        "✅ Git LFS initialized successfully!\n\n• .gitignore updated to allow attachment tracking\n• .gitattributes configured for LFS\n• ALL audio files + large video/images will sync via LFS"
                    );
                } else {
                    vscode.window.showErrorMessage("Failed to initialize Git LFS");
                }
            });
        }
    );

    // Check LFS status
    const checkLFSStatus = vscode.commands.registerCommand(
        'codex-editor-extension.lfs.status',
        async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage("No workspace folder found");
                return;
            }

            vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Checking LFS status...",
                cancellable: false
            }, async (progress) => {
                const status = await LFSAudioHandler.checkLFSStatus(workspaceFolder);

                const sizeMB = (bytes: number) => (bytes / (1024 * 1024)).toFixed(2);

                const message = [
                    `📊 LFS Status Report`,
                    ``,
                    `📁 Total audio files: ${status.totalFiles}`,
                    `🚀 Files in LFS: ${status.lfsFiles}`,
                    `📄 Regular files: ${status.regularFiles}`,
                    `💾 Total size: ${sizeMB(status.totalSize)} MB`,
                    `✨ LFS savings: ${sizeMB(status.lfsSavings)} MB`
                ].join('\n');

                vscode.window.showInformationMessage(message);
            });
        }
    );

    // Migrate existing attachments to LFS
    const migrateToLFS = vscode.commands.registerCommand(
        'codex-editor-extension.lfs.migrate',
        async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage("No workspace folder found");
                return;
            }

            // First check if LFS is supported on the remote
            const lfsCheck = await LFSHelper.checkLFSSupport(workspaceFolder.uri);
            if (!lfsCheck.supported) {
                console.error("[LFS] Remote may not support LFS:", lfsCheck.error);

                const continueAnyway = await vscode.window.showWarningMessage(
                    `⚠️ Git LFS may not be enabled on the remote repository.\n\n${lfsCheck.error || 'The remote server may not have LFS configured.'}\n\nMake sure:\n1. The remote repository has LFS enabled\n2. You have proper permissions\n3. The Git server supports LFS\n\nDo you want to continue anyway?`,
                    { modal: true },
                    "Continue Anyway", "Cancel"
                );

                if (continueAnyway !== "Continue Anyway") {
                    return;
                }
            }

            const confirmed = await vscode.window.showWarningMessage(
                "Migrate existing large attachments to Git LFS? This will move large audio/video files to LFS storage.",
                { modal: true },
                "Yes", "No"
            );

            if (confirmed !== "Yes") {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Migrating attachments to LFS...",
                cancellable: false
            }, async (progress) => {
                const result = await LFSAudioHandler.migrateAttachmentsToLFS(
                    workspaceFolder,
                    (current, total, fileName) => {
                        progress.report({
                            message: `Processing ${fileName} (${current}/${total})`,
                            increment: (1 / total) * 100
                        });
                    }
                );

                if (result.success) {
                    let message = `✅ Migration completed! Migrated ${result.migratedCount} files to LFS.`;

                    if (result.errors.length > 0) {
                        message += `\n\n⚠️ Some files had issues:\n${result.errors.slice(0, 5).join('\n')}`;
                        if (result.errors.length > 5) {
                            message += `\n... and ${result.errors.length - 5} more`;
                        }

                        // If all files failed with JSON structure error, provide more guidance
                        if (result.errors.every(e => e.includes('Unexpected JSON structure'))) {
                            message += "\n\n📝 This error usually means the Git server doesn't have LFS enabled. Please contact your Git server administrator.";
                        }
                    }

                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showErrorMessage(`Migration failed: ${result.errors.join(', ')}`);
                }
            });
        }
    );

    // Checkout/download LFS files
    const checkoutLFS = vscode.commands.registerCommand(
        'codex-editor-extension.lfs.checkout',
        async () => {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                vscode.window.showErrorMessage("No workspace folder found");
                return;
            }

            const confirmed = await vscode.window.showInformationMessage(
                "Download all LFS files to local workspace? This will restore the actual audio files from LFS storage.",
                { modal: true },
                "Yes", "No"
            );

            if (confirmed !== "Yes") {
                return;
            }

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: "Downloading LFS files...",
                cancellable: false
            }, async (progress) => {
                const result = await LFSAudioHandler.checkoutLFSFiles(
                    workspaceFolder,
                    (current, total, fileName) => {
                        progress.report({
                            message: `Downloading ${fileName} (${current}/${total})`,
                            increment: (1 / total) * 100
                        });
                    }
                );

                if (result.success) {
                    let message = `✅ LFS checkout completed! Downloaded ${result.downloadedCount} files.`;

                    if (result.errors.length > 0) {
                        message += `\n\n⚠️ Some files had issues:\n${result.errors.slice(0, 3).join('\n')}`;
                        if (result.errors.length > 3) {
                            message += `\n... and ${result.errors.length - 3} more`;
                        }
                    }

                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showErrorMessage(`LFS checkout failed: ${result.errors.join(', ')}`);
                }
            });
        }
    );

    // Show LFS help/documentation
    const showLFSHelp = vscode.commands.registerCommand(
        'codex-editor-extension.lfs.help',
        async () => {
            const helpContent = `
# Git LFS in Codex Projects

Git LFS (Large File Storage) helps manage large binary files efficiently in your translation projects.

## What is LFS?

Instead of storing large files directly in Git (which can make repositories slow and large), LFS stores them separately and keeps small "pointer" files in Git. This makes your repository fast while still tracking large files.

## Files That Use LFS

🎵 **Audio Files**: .wav, .mp3, .m4a, .ogg, .webm (ALL files, regardless of size)
🎬 **Video Files**: .mp4, .avi, .mov, .mkv (files over 10MB)
🖼️ **Images**: .jpg, .jpeg, .png (files over 10MB)

**Why ALL audio files?** Audio recordings are binary files that don't benefit from Git's text-based features. For consistency and performance, ALL audio files go to LFS.

## Benefits

✅ Faster git operations (clone, pull, push)
✅ Smaller repository size
✅ Consistent audio file handling
✅ Better performance with binary attachments
✅ Efficient storage of all recordings

## Commands

- **Initialize LFS**: Set up LFS for this project
- **Check Status**: View LFS usage statistics  
- **Migrate Files**: Move existing large files to LFS
- **Help**: Show this guide

## How It Works

1. When you add a large audio recording, it's automatically stored in LFS
2. Git only tracks a small pointer file
3. The actual audio is stored efficiently in LFS
4. Everything works transparently - no changes to your workflow!
            `.trim();

            const panel = vscode.window.createWebviewPanel(
                'lfsHelp',
                'Git LFS Help',
                vscode.ViewColumn.One,
                { enableScripts: false }
            );

            panel.webview.html = `
                <!DOCTYPE html>
                <html>
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <style>
                        body { 
                            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
                            line-height: 1.6;
                            max-width: 800px;
                            margin: 0 auto;
                            padding: 20px;
                            color: var(--vscode-foreground);
                            background: var(--vscode-editor-background);
                        }
                        h1, h2 { color: var(--vscode-textLink-foreground); }
                        code { 
                            background: var(--vscode-textCodeBlock-background);
                            padding: 2px 4px;
                            border-radius: 3px;
                        }
                        pre {
                            background: var(--vscode-textCodeBlock-background);
                            padding: 10px;
                            border-radius: 5px;
                            overflow-x: auto;
                        }
                    </style>
                </head>
                <body>
                    <div>${helpContent.replace(/\n/g, '<br>')}</div>
                </body>
                </html>
            `;
        }
    );

    // Register all commands
    context.subscriptions.push(
        initializeLFS,
        checkLFSStatus,
        migrateToLFS,
        checkoutLFS,
        showLFSHelp
    );

    console.log("[LFS] Commands registered successfully");
}