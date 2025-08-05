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
                "Initialize Git LFS for this project? This will:\n\n• Update .gitignore to allow attachment tracking\n• Configure .gitattributes for LFS\n• Enable efficient handling of large audio/video files",
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
                        "✅ Git LFS initialized successfully!\n\n• .gitignore updated to allow attachment tracking\n• .gitattributes configured for LFS\n• Large files will now sync efficiently"
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
                    }

                    vscode.window.showInformationMessage(message);
                } else {
                    vscode.window.showErrorMessage(`Migration failed: ${result.errors.join(', ')}`);
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

The following files are automatically handled by LFS when they're over 10MB:

🎵 **Audio Files**: .wav, .mp3, .m4a, .ogg
🎬 **Video Files**: .mp4, .avi, .mov, .mkv  
🖼️ **Images**: .jpg, .jpeg, .png

## Benefits

✅ Faster git operations (clone, pull, push)
✅ Smaller repository size
✅ Better performance with large attachments
✅ Efficient storage of audio recordings

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
        showLFSHelp
    );

    console.log("[LFS] Commands registered successfully");
}