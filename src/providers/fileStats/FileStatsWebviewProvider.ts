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
                sourceContentWords: pair.sourceFile.contentWords,
                codexWords: pair.codexFile.totalWords,
                codexContentWords: pair.codexFile.contentWords,
                sourceCells: pair.sourceFile.totalCells,
                sourceContentCells: pair.sourceFile.contentCells,
                codexCells: pair.codexFile.totalCells,
                codexContentCells: pair.codexFile.contentCells,
                sourceProgress: pair.sourceFile.contentWords > 0 ? 100 : 0,
                codexProgress:
                    pair.sourceFile.contentWords > 0
                        ? Math.round(
                              (pair.codexFile.contentWords / pair.sourceFile.contentWords) * 100
                          )
                        : 0,
                // Include sample cells for debugging
                sourceSamples: pair.sourceFile.cells.slice(0, 3).map((cell) => ({
                    id: cell.id,
                    type: cell.type,
                    value: cell.value,
                    wordCount: cell.wordCount,
                    isParatext: cell.isParatext,
                    // Include original and cleaned text for debugging
                    originalText: cell.value,
                    cleanedText: this.stripHtml(cell.value),
                })),
                codexSamples: pair.codexFile.cells.slice(0, 3).map((cell) => ({
                    id: cell.id,
                    type: cell.type,
                    value: cell.value,
                    wordCount: cell.wordCount,
                    isParatext: cell.isParatext,
                    // Include original and cleaned text for debugging
                    originalText: cell.value,
                    cleanedText: this.stripHtml(cell.value),
                })),
            })),
        };
    }

    // Helper method to strip HTML for display
    private stripHtml(text: string): string {
        if (!text) return "";
        return text.replace(/<\/?[^>]+(>|$)/g, "");
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
                case "exportCSV":
                    this.exportCSV(message.csvContent);
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

    private async exportCSV(csvContent: string): Promise<void> {
        // Ask user where to save the file
        const defaultFileName = `translation-progress-${new Date().toISOString().slice(0, 10)}.csv`;
        const uri = await vscode.window.showSaveDialog({
            defaultUri: vscode.Uri.file(defaultFileName),
            filters: {
                "CSV Files": ["csv"],
            },
        });

        if (uri) {
            try {
                // Write the CSV content to the selected file
                await vscode.workspace.fs.writeFile(uri, Buffer.from(csvContent, "utf8"));
                vscode.window.showInformationMessage(
                    `Translation statistics exported to ${uri.fsPath}`
                );
            } catch (error) {
                console.error("Error exporting CSV:", error);
                vscode.window.showErrorMessage(`Failed to export CSV: ${error}`);
            }
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
                        <div class="header-actions">
                            <button id="export-csv-btn" title="Export to CSV">Export CSV</button>
                            <button id="refresh-btn" title="Refresh Data">↻</button>
                        </div>
                    </header>

                    <div class="stats-overview">
                        <div class="stat-box">
                            <h2>Source Words</h2>
                            <div id="source-words" class="stat-value">Loading...</div>
                            <div class="stat-subtitle">Content only: <span id="source-content-words">...</span></div>
                        </div>
                        <div class="stat-box">
                            <h2>Codex Words</h2>
                            <div id="codex-words" class="stat-value">Loading...</div>
                            <div class="stat-subtitle">Content only: <span id="codex-content-words">...</span></div>
                        </div>
                        <div class="stat-box">
                            <h2>Progress</h2>
                            <div id="progress-percentage" class="stat-value">Loading...</div>
                            <div class="stat-subtitle">Based on content cells</div>
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
                        let currentData = null;

                        document.getElementById('refresh-btn').addEventListener('click', () => {
                            vscode.postMessage({ command: 'refresh' });
                        });

                        document.getElementById('export-csv-btn').addEventListener('click', () => {
                            if (currentData) {
                                exportToCSV(currentData);
                            } else {
                                vscode.postMessage({ command: 'refresh' });
                            }
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
                                    currentData = message.data;
                                    updateUI(message.data);
                                    break;
                            }
                        });

                        function updateUI(data) {
                            // Update the stats overview
                            document.getElementById('source-words').textContent = data.stats.totalSourceWords.toLocaleString();
                            document.getElementById('codex-words').textContent = data.stats.totalCodexWords.toLocaleString();
                            document.getElementById('source-content-words').textContent = data.stats.totalSourceContentWords.toLocaleString();
                            document.getElementById('codex-content-words').textContent = data.stats.totalCodexContentWords.toLocaleString();
                            
                            const progressPercentage = data.stats.totalSourceContentWords > 0 
                                ? Math.round((data.stats.totalCodexContentWords / data.stats.totalSourceContentWords) * 100) 
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
                                            <span>\${file.sourceContentWords.toLocaleString()} → \${file.codexContentWords.toLocaleString()}</span>
                                            <span>\${file.codexProgress}%</span>
                                        </div>
                                    </div>
                                    <div class="file-progress">
                                        <div class="file-progress-bar" style="width: \${file.codexProgress}%"></div>
                                    </div>
                                    <div class="file-details" style="display: none;">
                                        <div class="file-stats-detailed">
                                            <div class="stat-row">
                                                <span>Source: <strong>\${file.sourceWords.toLocaleString()}</strong> total words / <strong>\${file.sourceContentWords.toLocaleString()}</strong> content words</span>
                                            </div>
                                            <div class="stat-row">
                                                <span>Codex: <strong>\${file.codexWords.toLocaleString()}</strong> total words / <strong>\${file.codexContentWords.toLocaleString()}</strong> content words</span>
                                            </div>
                                            <div class="stat-row">
                                                <span>Cells: <strong>\${file.sourceCells}</strong> source / <strong>\${file.sourceContentCells}</strong> content / <strong>\${file.codexContentCells}</strong> translated</span>
                                            </div>
                                        </div>
                                        <div class="file-actions">
                                            <button class="view-file-btn">Open in Editor</button>
                                            <button class="toggle-samples-btn">Show Samples</button>
                                        </div>
                                        <div class="file-samples" style="display: none;">
                                            <div class="sample-section">
                                                <h3>Source Samples (First 3 Cells)</h3>
                                                \${file.sourceSamples.map((sample, idx) => \`
                                                    <div class="sample-cell \${sample.isParatext ? 'paratext-cell' : ''}">
                                                        <div class="sample-header">
                                                            <span>Cell \${idx + 1} | ID: \${sample.id || 'N/A'} | Type: \${sample.type || 'N/A'} | Words: \${sample.wordCount} \${sample.isParatext ? '(Paratext)' : ''}</span>
                                                        </div>
                                                        <div class="sample-content">
                                                            <div class="original-text">
                                                                <strong>Original:</strong> 
                                                                <pre>\${sample.originalText.substring(0, 200)}\${sample.originalText.length > 200 ? '...' : ''}</pre>
                                                            </div>
                                                            <div class="cleaned-text">
                                                                <strong>Cleaned:</strong> 
                                                                <pre>\${sample.cleanedText.substring(0, 200)}\${sample.cleanedText.length > 200 ? '...' : ''}</pre>
                                                            </div>
                                                        </div>
                                                    </div>
                                                \`).join('')}
                                            </div>
                                            <div class="sample-section">
                                                <h3>Codex Samples (First 3 Cells)</h3>
                                                \${file.codexSamples.map((sample, idx) => \`
                                                    <div class="sample-cell \${sample.isParatext ? 'paratext-cell' : ''}">
                                                        <div class="sample-header">
                                                            <span>Cell \${idx + 1} | ID: \${sample.id || 'N/A'} | Type: \${sample.type || 'N/A'} | Words: \${sample.wordCount} \${sample.isParatext ? '(Paratext)' : ''}</span>
                                                        </div>
                                                        <div class="sample-content">
                                                            <div class="original-text">
                                                                <strong>Original:</strong> 
                                                                <pre>\${sample.originalText.substring(0, 200)}\${sample.originalText.length > 200 ? '...' : ''}</pre>
                                                            </div>
                                                            <div class="cleaned-text">
                                                                <strong>Cleaned:</strong> 
                                                                <pre>\${sample.cleanedText.substring(0, 200)}\${sample.cleanedText.length > 200 ? '...' : ''}</pre>
                                                            </div>
                                                        </div>
                                                    </div>
                                                \`).join('')}
                                            </div>
                                        </div>
                                    </div>
                                \`;
                                
                                // Toggle file details on click
                                const fileHeader = fileElement.querySelector('.file-header');
                                if (fileHeader) {
                                    fileHeader.addEventListener('click', (e) => {
                                        const detailsElement = fileElement.querySelector('.file-details');
                                        if (detailsElement) {
                                            const isVisible = detailsElement.style.display !== 'none';
                                            detailsElement.style.display = isVisible ? 'none' : 'block';
                                        }
                                    });
                                }
                                
                                // View file button
                                const viewFileBtn = fileElement.querySelector('.view-file-btn');
                                if (viewFileBtn) {
                                    viewFileBtn.addEventListener('click', (e) => {
                                        e.stopPropagation(); // Prevent triggering the header click
                                        vscode.postMessage({ 
                                            command: 'viewFile', 
                                            fileId: file.id 
                                        });
                                    });
                                }
                                
                                // Toggle samples button
                                const toggleSamplesBtn = fileElement.querySelector('.toggle-samples-btn');
                                if (toggleSamplesBtn) {
                                    toggleSamplesBtn.addEventListener('click', (e) => {
                                        e.stopPropagation(); // Prevent triggering the header click
                                        const samplesElement = fileElement.querySelector('.file-samples');
                                        if (samplesElement) {
                                            const isVisible = samplesElement.style.display !== 'none';
                                            samplesElement.style.display = isVisible ? 'none' : 'block';
                                            toggleSamplesBtn.textContent = isVisible ? 'Show Samples' : 'Hide Samples';
                                        }
                                    });
                                }
                                
                                fileListElement.appendChild(fileElement);
                            });
                        }

                        function exportToCSV(data) {
                            // Create CSV content
                            const headerRow = [
                                'File',
                                'Source Words (Total)',
                                'Source Words (Content)',
                                'Codex Words (Total)',
                                'Codex Words (Content)',
                                'Progress (%)'
                            ];
                            const dataRows = data.filePairs.map(file => [
                                file.codexFileName,
                                file.sourceWords,
                                file.sourceContentWords,
                                file.codexWords,
                                file.codexContentWords,
                                file.codexProgress
                            ]);
                            
                            // Add summary row
                            dataRows.push([
                                'TOTAL',
                                data.stats.totalSourceWords,
                                data.stats.totalSourceContentWords,
                                data.stats.totalCodexWords,
                                data.stats.totalCodexContentWords,
                                data.stats.totalSourceContentWords > 0 
                                    ? Math.round((data.stats.totalCodexContentWords / data.stats.totalSourceContentWords) * 100) 
                                    : 0
                            ]);
                            
                            // Convert to CSV string
                            const csvContent = [
                                headerRow.join(','),
                                ...dataRows.map(row => row.join(','))
                            ].join('\\n');
                            
                            // Request the extension to save the file
                            vscode.postMessage({
                                command: 'exportCSV',
                                csvContent
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
