import * as vscode from "vscode";
import * as path from "path";
import * as fs from "fs";

export class WelcomeViewProvider {
    public static readonly viewType = "codex-welcome-view";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _lastOpenedCodexFile?: string;
    private _disposables: vscode.Disposable[] = [];

    constructor(extensionUri: vscode.Uri) {
        this._extensionUri = extensionUri;

        // Find the most recently opened .codex file
        this.findMostRecentCodexFile();

        // Track document opening/closing to update last opened file
        this._disposables.push(
            vscode.workspace.onDidOpenTextDocument((doc) => {
                if (doc.uri.fsPath.endsWith(".codex")) {
                    this._lastOpenedCodexFile = doc.uri.fsPath;
                }
            })
        );
    }

    public dispose() {
        this._panel?.dispose();
        this._disposables.forEach((d) => d.dispose());
    }

    private async findMostRecentCodexFile() {
        // Try project history first
        const config = vscode.workspace.getConfiguration("codex-project-manager");
        const projectHistory = config.get<Record<string, string>>("projectHistory") || {};

        // Sort projects by last opened time (descending)
        const sortedProjects = Object.entries(projectHistory).sort(
            (a, b) => new Date(b[1]).getTime() - new Date(a[1]).getTime()
        );

        for (const [projectPath, _] of sortedProjects) {
            if (fs.existsSync(projectPath)) {
                // Look for .codex files in this project
                try {
                    const workspaceFiles = await vscode.workspace.findFiles("**/*.codex", null, 10);
                    if (workspaceFiles.length > 0) {
                        this._lastOpenedCodexFile = workspaceFiles[0].fsPath;
                        return;
                    }
                } catch (error) {
                    console.error("Error finding .codex files:", error);
                }
            }
        }

        // As a fallback, look for any .codex files in the current workspace
        try {
            const workspaceFiles = await vscode.workspace.findFiles("**/*.codex", null, 1);
            if (workspaceFiles.length > 0) {
                this._lastOpenedCodexFile = workspaceFiles[0].fsPath;
            }
        } catch (error) {
            console.error("Error finding fallback .codex files:", error);
        }
    }

    public show() {
        // If the panel is already showing, just reveal it
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        // Create a new panel
        this._panel = vscode.window.createWebviewPanel(
            WelcomeViewProvider.viewType,
            "Welcome to Codex Editor",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        // Set the webview's html content
        this._panel.webview.html = this._getHtmlForWebview();

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage(async (message) => {
            switch (message.command) {
                case "openMainMenu":
                    // Show sidebar and focus main menu
                    await vscode.commands.executeCommand(
                        "workbench.action.toggleSidebarVisibility"
                    );
                    await vscode.commands.executeCommand("codex-editor.mainMenu.focus");
                    break;

                case "openLastFile":
                    if (this._lastOpenedCodexFile) {
                        const uri = vscode.Uri.file(this._lastOpenedCodexFile);
                        vscode.commands.executeCommand("vscode.openWith", uri, "codex.cellEditor");
                    } else {
                        vscode.window.showWarningMessage("No recently opened .codex files found");
                    }
                    break;

                case "createNewProject":
                    vscode.commands.executeCommand("codex-project-manager.createNewProject");
                    break;

                case "openExistingProject":
                    vscode.commands.executeCommand("codex-project-manager.openExistingProject");
                    break;

                case "webviewReady":
                    // Refresh our state when the webview is ready
                    await this.findMostRecentCodexFile();
                    // Update the UI if we found a file
                    if (this._lastOpenedCodexFile && this._panel) {
                        this._panel.webview.html = this._getHtmlForWebview();
                    }
                    break;
            }
        });

        // Reset when the panel is disposed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }

    private _getHtmlForWebview(): string {
        const webview = this._panel!.webview;

        // Get styles from the vscode-webview-ui-toolkit
        const codiconsUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                "node_modules",
                "@vscode/codicons",
                "dist",
                "codicon.css"
            )
        );

        const hasLastOpenedFile = !!this._lastOpenedCodexFile;
        const lastOpenedFileName = hasLastOpenedFile
            ? path.basename(this._lastOpenedCodexFile!)
            : "";

        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <link href="${codiconsUri}" rel="stylesheet" />
            <title>Welcome to Codex Editor</title>
            <style>
                body {
                    font-family: var(--vscode-font-family);
                    color: var(--vscode-foreground);
                    background-color: var(--vscode-editor-background);
                    padding: 20px;
                    margin: 0;
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    min-height: 100vh;
                }
                .container {
                    max-width: 800px;
                    text-align: center;
                }
                h1 {
                    font-size: 28px;
                    font-weight: 300;
                    margin-bottom: 20px;
                    color: var(--vscode-foreground);
                }
                .description {
                    font-size: 16px;
                    margin-bottom: 40px;
                    color: var(--vscode-descriptionForeground);
                    line-height: 1.5;
                }
                .actions {
                    display: flex;
                    flex-wrap: wrap;
                    justify-content: center;
                    gap: 20px;
                    margin-bottom: 40px;
                }
                .action-card {
                    background-color: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 8px;
                    padding: 20px;
                    width: 200px;
                    transition: all 0.2s ease;
                    cursor: pointer;
                    border: 1px solid transparent;
                }
                .action-card:hover {
                    background-color: var(--vscode-list-hoverBackground);
                    border-color: var(--vscode-focusBorder);
                }
                .icon-container {
                    font-size: 24px;
                    margin-bottom: 12px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                .card-title {
                    font-size: 16px;
                    font-weight: 500;
                    margin-bottom: 8px;
                }
                .card-description {
                    font-size: 13px;
                    color: var(--vscode-descriptionForeground);
                }
                .secondary-actions {
                    display: flex;
                    gap: 16px;
                    justify-content: center;
                }
                .secondary-button {
                    background: none;
                    border: none;
                    color: var(--vscode-textLink-foreground);
                    font-family: var(--vscode-font-family);
                    font-size: 14px;
                    cursor: pointer;
                    padding: 6px 10px;
                    border-radius: 4px;
                    display: flex;
                    align-items: center;
                    gap: 6px;
                }
                .secondary-button:hover {
                    background-color: var(--vscode-list-hoverBackground);
                }
                .status {
                    margin-top: 40px;
                    font-size: 12px;
                    color: var(--vscode-descriptionForeground);
                }
                .codicon {
                    font-family: codicon;
                    font-size: 20px;
                    line-height: 20px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>Welcome to Codex Editor</h1>
                <p class="description">
                    Codex Editor helps you create beautiful and accurate translations. 
                    Get started by opening the main menu or continuing your recent work.
                </p>
                
                <div class="actions">
                    <div class="action-card" id="openMainMenu">
                        <div class="icon-container">
                            <i class="codicon codicon-menu"></i>
                        </div>
                        <div class="card-title">Open Main Menu</div>
                        <div class="card-description">Navigate to your projects and tools</div>
                    </div>
                    
                    ${
                        hasLastOpenedFile
                            ? `
                    <div class="action-card" id="openLastFile">
                        <div class="icon-container">
                            <i class="codicon codicon-file"></i>
                        </div>
                        <div class="card-title">Resume Recent Work</div>
                        <div class="card-description">Open "${lastOpenedFileName}"</div>
                    </div>
                    `
                            : `
                    <div class="action-card" id="createNewProject">
                        <div class="icon-container">
                            <i class="codicon codicon-add"></i>
                        </div>
                        <div class="card-title">Create New Project</div>
                        <div class="card-description">Start a new translation project</div>
                    </div>
                    `
                    }
                </div>
                
                <div class="secondary-actions">
                    <button class="secondary-button" id="openExistingProject">
                        <i class="codicon codicon-folder-opened"></i>
                        Open Existing Project
                    </button>
                </div>
                
                <div class="status">
                    Waiting for your next action...
                </div>
            </div>
            
            <script>
                const vscode = acquireVsCodeApi();
                
                // Add event listeners to buttons
                document.getElementById('openMainMenu').addEventListener('click', () => {
                    vscode.postMessage({ command: 'openMainMenu' });
                });
                
                ${
                    hasLastOpenedFile
                        ? `
                document.getElementById('openLastFile').addEventListener('click', () => {
                    vscode.postMessage({ command: 'openLastFile' });
                });
                `
                        : `
                document.getElementById('createNewProject').addEventListener('click', () => {
                    vscode.postMessage({ command: 'createNewProject' });
                });
                `
                }
                
                document.getElementById('openExistingProject').addEventListener('click', () => {
                    vscode.postMessage({ command: 'openExistingProject' });
                });
                
                // Notify the extension that the webview is ready
                window.addEventListener('load', () => {
                    vscode.postMessage({ command: 'webviewReady' });
                });
            </script>
        </body>
        </html>`;
    }
}
