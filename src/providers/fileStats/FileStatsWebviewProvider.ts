import * as vscode from "vscode";
import * as path from "path";
import {
    getFilePairs,
    getWordCountStats,
    FileInfo,
} from "../../activationHelpers/contextAware/contentIndexes/indexes/filesIndex";
import { getNonce } from "../dictionaryTable/utilities/getNonce";

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
            "Translation Word Counts",
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

        return `<!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <link href="${styleUri}" rel="stylesheet" />
                <title>Translation Word Counts</title>
            </head>
            <body>
                <div class="container">
                    <header>
                        <h1>Translation Word Counts</h1>
                        <div class="header-actions">
                            <button id="export-csv-btn">Export CSV</button>
                            <button id="refresh-btn" title="Refresh Data">↻</button>
                        </div>
                    </header>

                    <table class="word-count-table">
                        <thead>
                            <tr>
                                <th>File</th>
                                <th>Source Words</th>
                                <th>Codex Words</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="file-list">
                        </tbody>
                        <tfoot>
                            <tr class="total-row">
                                <td><strong>Total</strong></td>
                                <td id="total-source-words">-</td>
                                <td id="total-codex-words">-</td>
                                <td></td>
                            </tr>
                        </tfoot>
                    </table>
                </div>

                <script nonce="${nonce}">
                    (function() {
                        const vscode = acquireVsCodeApi();
                        let currentData = null;

                        document.getElementById('refresh-btn').addEventListener('click', () => {
                            vscode.postMessage({ command: 'refresh' });
                        });

                        document.getElementById('export-csv-btn').addEventListener('click', () => {
                            if (currentData) {
                                exportToCSV(currentData);
                            }
                        });

                        window.addEventListener('load', () => {
                            vscode.postMessage({ command: 'ready' });
                        });

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
                            const fileListElement = document.getElementById('file-list');
                            fileListElement.innerHTML = '';

                            // Sort files alphabetically
                            data.filePairs.sort((a, b) => a.codexFileName.localeCompare(b.codexFileName))
                                .forEach(file => {
                                    const row = document.createElement('tr');
                                    
                                    // File name cell
                                    const fileNameCell = document.createElement('td');
                                    fileNameCell.textContent = file.codexFileName;
                                    row.appendChild(fileNameCell);
                                    
                                    // Source words cell
                                    const sourceWordsCell = document.createElement('td');
                                    sourceWordsCell.textContent = file.sourceContentWords.toLocaleString();
                                    row.appendChild(sourceWordsCell);
                                    
                                    // Codex words cell
                                    const codexWordsCell = document.createElement('td');
                                    codexWordsCell.textContent = file.codexContentWords.toLocaleString();
                                    row.appendChild(codexWordsCell);
                                    
                                    // Actions cell
                                    const actionsCell = document.createElement('td');
                                    const openButton = document.createElement('button');
                                    openButton.className = 'view-file-btn';
                                    openButton.setAttribute('data-file-id', file.id);
                                    openButton.textContent = 'Open';
                                    openButton.addEventListener('click', () => {
                                        vscode.postMessage({ 
                                            command: 'viewFile', 
                                            fileId: file.id 
                                        });
                                    });
                                    actionsCell.appendChild(openButton);
                                    row.appendChild(actionsCell);
                                    
                                    fileListElement.appendChild(row);
                                });

                            // Update totals
                            document.getElementById('total-source-words').textContent = 
                                data.stats.totalSourceContentWords.toLocaleString();
                            document.getElementById('total-codex-words').textContent = 
                                data.stats.totalCodexContentWords.toLocaleString();
                        }

                        function exportToCSV(data) {
                            const headerRow = [
                                'File',
                                'Source Words',
                                'Codex Words'
                            ];
                            
                            const dataRows = data.filePairs.map(file => [
                                file.codexFileName,
                                file.sourceContentWords,
                                file.codexContentWords
                            ]);
                            
                            dataRows.push([
                                'TOTAL',
                                data.stats.totalSourceContentWords,
                                data.stats.totalCodexContentWords
                            ]);
                            
                            const csvContent = [
                                headerRow.join(','),
                                ...dataRows.map(row => row.join(','))
                            ].join('\\n');
                            
                            vscode.postMessage({
                                command: 'exportCSV',
                                csvContent
                            });
                        }
                    }());
                </script>
            </body>
            </html>`;
    }
}
