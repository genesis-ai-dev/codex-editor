import * as vscode from "vscode";
import { getWordFrequencies } from "../../activationHelpers/contextAware/miniIndex/indexes/wordsIndex";
import { readSourceAndTargetFiles } from "../../activationHelpers/contextAware/miniIndex/indexes/fileReaders";
import { initializeWordsIndex } from "../../activationHelpers/contextAware/miniIndex/indexes/wordsIndex";

export class WordsViewProvider implements vscode.Disposable {
    public static readonly viewType = "frontier.wordsView";
    private _panel?: vscode.WebviewPanel;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    dispose() {
        this._panel?.dispose();
        this._panel = undefined;
    }

    public async show() {
        if (this._panel) {
            this._panel.reveal();
            return;
        }

        this._panel = vscode.window.createWebviewPanel(
            WordsViewProvider.viewType,
            "Project Words",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        await this.updateContent();
    }

    private async updateContent() {
        if (!this._panel) {
            return;
        }

        // Initialize word index
        const { targetFiles } = await readSourceAndTargetFiles();
        const wordsIndex = await initializeWordsIndex(new Map(), targetFiles);
        const wordFrequencies = getWordFrequencies(wordsIndex);

        // Sort by frequency descending
        wordFrequencies.sort((a, b) => b.frequency - a.frequency);

        this._panel.webview.html = `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Project Words</title>
            <style>
                body {
                    padding: 20px;
                    margin: 0;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: var(--vscode-font-family);
                }
                .container {
                    max-width: 800px;
                    margin: 0 auto;
                }
                .stats {
                    margin-bottom: 20px;
                    padding: 10px;
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    border-radius: 4px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                }
                th, td {
                    padding: 8px;
                    text-align: left;
                    border-bottom: 1px solid var(--vscode-editor-lineHighlightBorder);
                }
                th {
                    background: var(--vscode-editor-inactiveSelectionBackground);
                    position: sticky;
                    top: 0;
                }
                .search-box {
                    width: 100%;
                    padding: 8px;
                    margin-bottom: 20px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: 4px;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="stats">
                    Total unique words: ${wordFrequencies.length}
                </div>
                <input type="text" id="searchBox" class="search-box" placeholder="Search words...">
                <table id="wordsTable">
                    <thead>
                        <tr>
                            <th>Word</th>
                            <th>Frequency</th>
                        </tr>
                    </thead>
                    <tbody>
                        ${wordFrequencies
                            .map(
                                (wf) => `
                            <tr>
                                <td>${wf.word}</td>
                                <td>${wf.frequency}</td>
                            </tr>
                        `
                            )
                            .join("")}
                    </tbody>
                </table>
            </div>
            <script>
                const searchBox = document.getElementById('searchBox');
                const table = document.getElementById('wordsTable');
                const rows = table.getElementsByTagName('tr');

                searchBox.addEventListener('keyup', function(e) {
                    const term = e.target.value.toLowerCase();
                    
                    for(let i = 1; i < rows.length; i++) {
                        const word = rows[i].getElementsByTagName('td')[0].textContent.toLowerCase();
                        rows[i].style.display = word.includes(term) ? '' : 'none';
                    }
                });
            </script>
        </body>
        </html>`;
    }
} 