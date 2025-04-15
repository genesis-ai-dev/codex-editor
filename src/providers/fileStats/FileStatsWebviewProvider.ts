import * as vscode from "vscode";
import * as path from "path";
import {
    getFilePairs,
    getWordCountStats,
    FileInfo,
} from "../../activationHelpers/contextAware/miniIndex/indexes/filesIndex";

export class FileStatsWebviewProvider {
    public static readonly viewType = "file-stats-webview";

    private _panel?: vscode.WebviewPanel;
    private readonly _extensionUri: vscode.Uri;
    private _filesIndex: Map<string, FileInfo>;

    constructor(extensionUri: vscode.Uri, filesIndex: Map<string, FileInfo>) {
        this._extensionUri = extensionUri;
        this._filesIndex = filesIndex;
    }

    public updateFilesIndex(filesIndex: Map<string, FileInfo>): void {
        this._filesIndex = filesIndex;
        this.updateWebview();
    }

    private updateWebview(): void {
        if (this._panel) {
            this._panel.webview.postMessage({
                command: "updateData",
                data: this.getFileStatsData(),
            });
        }
    }

    private getFileStatsData() {
        const stats = getWordCountStats(this._filesIndex);
        const filePairs = getFilePairs(this._filesIndex);

        return {
            stats,
            filePairs: filePairs.map((pair) => ({
                id: pair.codexFile.id,
                sourceFileName: pair.sourceFile.fileName,
                codexFileName: pair.codexFile.fileName,
                sourceWords: pair.sourceFile.totalWords,
                codexWords: pair.codexFile.totalWords,
                sourceProgress: pair.sourceFile.totalWords > 0 ? 100 : 0,
                codexProgress:
                    pair.sourceFile.totalWords > 0
                        ? Math.round((pair.codexFile.totalWords / pair.sourceFile.totalWords) * 100)
                        : 0,
            })),
        };
    }

    public show(): void {
        if (this._panel) {
            this._panel.reveal(vscode.ViewColumn.One);
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            FileStatsWebviewProvider.viewType,
            "Translation Progress Statistics",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                localResourceRoots: [this._extensionUri],
                retainContextWhenHidden: true,
            }
        );

        this._panel.webview.html = this.getHtmlForWebview(this._panel.webview);

        // Handle messages from the webview
        this._panel.webview.onDidReceiveMessage((message) => {
            switch (message.command) {
                case "ready":
                    this.updateWebview();
                    break;
                case "refresh":
                    vscode.commands.executeCommand("translators-copilot.refreshFileStats");
                    break;
                case "viewFile":
                    this.openFile(message.fileId);
                    break;
            }
        });

        // Clean up when the panel is closed
        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });
    }

    private openFile(fileId: string): void {
        const fileInfo = this._filesIndex.get(fileId);
        if (fileInfo) {
            vscode.commands.executeCommand(
                "vscode.openWith",
                fileInfo.codexFile.uri,
                "codex.cellEditor"
            );
        }
    }

    private getHtmlForWebview(webview: vscode.Webview): string {
        const styleUri = webview.asWebviewUri(
            vscode.Uri.joinPath(
                this._extensionUri,
                "src",
                "providers",
                "fileStats",
                "fileStatsView.css"
            )
        );

        const nonce = getNonce();

        return /* html */ `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Translation Progress Statistics</title>
            </head>
            <body>
                <div class="container">
                    <header>
                        <h1>Translation Progress Statistics</h1>
                        <button id="refresh-btn" title="Refresh Data">↻</button>
                    </header>

                    <div class="stats-overview">
                        <div class="stat-box">
                            <h2>Source Words</h2>
                            <div id="source-words" class="stat-value">Loading...</div>
                        </div>
                        <div class="stat-box">
                            <h2>Codex Words</h2>
                            <div id="codex-words" class="stat-value">Loading...</div>
                        </div>
                        <div class="stat-box">
                            <h2>Progress</h2>
                            <div id="progress-percentage" class="stat-value">Loading...</div>
                        </div>
                    </div>

                    <div class="progress-container">
                        <div id="progress-bar" class="progress-bar"></div>
                    </div>

                    <div class="files-section">
                        <h2>Files (<span id="files-count">0</span>)</h2>
                        <div id="file-list" class="file-list"></div>
                    </div>
                </div>

                <script nonce="${nonce}">
                    // Basic script to handle the webview interaction
                    (function() {
                        const vscode = acquireVsCodeApi();

                        document.getElementById('refresh-btn').addEventListener('click', () => {
                            vscode.postMessage({ command: 'refresh' });
                        });

                        // Notify the extension that the webview is ready
                        window.addEventListener('load', () => {
                            vscode.postMessage({ command: 'ready' });
                        });

                        // Handle messages from the extension
                        window.addEventListener('message', event => {
                            const message = event.data;
                            switch (message.command) {
                                case 'updateData':
                                    updateUI(message.data);
                                    break;
                            }
                        });

                        function updateUI(data) {
                            // Update the stats overview
                            document.getElementById('source-words').textContent = data.stats.totalSourceWords.toLocaleString();
                            document.getElementById('codex-words').textContent = data.stats.totalCodexWords.toLocaleString();
                            
                            const progressPercentage = data.stats.totalSourceWords > 0 
                                ? Math.round((data.stats.totalCodexWords / data.stats.totalSourceWords) * 100) 
                                : 0;
                                
                            document.getElementById('progress-percentage').textContent = \`\${progressPercentage}%\`;
                            document.getElementById('progress-bar').style.width = \`\${progressPercentage}%\`;
                            document.getElementById('files-count').textContent = data.stats.totalFiles;

                            // Update the file list
                            const fileListElement = document.getElementById('file-list');
                            fileListElement.innerHTML = '';

                            data.filePairs.sort((a, b) => a.codexFileName.localeCompare(b.codexFileName))
                                .forEach(file => {
                                const fileElement = document.createElement('div');
                                fileElement.className = 'file-item';
                                fileElement.innerHTML = \`
                                    <div class="file-header">
                                        <div class="file-name">\${file.codexFileName}</div>
                                        <div class="file-stats">
                                            <span>\${file.sourceWords.toLocaleString()} → \${file.codexWords.toLocaleString()}</span>
                                            <span>\${file.codexProgress}%</span>
                                        </div>
                                    </div>
                                    <div class="file-progress">
                                        <div class="file-progress-bar" style="width: \${file.codexProgress}%"></div>
                                    </div>
                                \`;
                                
                                fileElement.addEventListener('click', () => {
                                    vscode.postMessage({ 
                                        command: 'viewFile', 
                                        fileId: file.id 
                                    });
                                });
                                
                                fileListElement.appendChild(fileElement);
                            });
                        }
                    }());
                </script>
            </body>
            </html>
        `;
    }
}

function getNonce() {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}
