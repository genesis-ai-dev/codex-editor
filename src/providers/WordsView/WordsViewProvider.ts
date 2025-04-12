import * as vscode from "vscode";
import {
    getWordFrequencies,
    initializeWordsIndex,
    WordFrequency,
    WordOccurrence,
} from "../../activationHelpers/contextAware/miniIndex/indexes/wordsIndex";
import { readSourceAndTargetFiles } from "../../activationHelpers/contextAware/miniIndex/indexes/fileReaders";

export class WordsViewProvider implements vscode.Disposable {
    public static readonly viewType = "frontier.wordsView";
    private _panel?: vscode.WebviewPanel;
    private _wordFrequencies: WordFrequency[] = [];
    private _selectedOccurrences: Set<string> = new Set();
    private _sortMode: "frequency" | "leftContext" | "rightContext" = "frequency";

    // Pagination and view state
    private _currentPage = 1;
    private _pageSize = 50;
    private _expandedWords: Set<string> = new Set();
    private _totalPages = 1;

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
            "KWIC View",
            vscode.ViewColumn.One,
            {
                enableScripts: true,
                retainContextWhenHidden: true,
            }
        );

        this._panel.onDidDispose(() => {
            this._panel = undefined;
        });

        this._panel.webview.onDidReceiveMessage(async (message) => {
            let page: number;
            switch (message.command) {
                case "toggleSelection":
                    this._toggleOccurrenceSelection(message.id);
                    break;
                case "replaceSelected":
                    await this._replaceSelectedOccurrences(message.replacement);
                    break;
                case "sortBy":
                    this._sortMode = message.sortMode;
                    await this.updateContent();
                    break;
                case "nextPage":
                    if (this._currentPage < this._totalPages) {
                        this._currentPage++;
                        await this.updateContent(false);
                    }
                    break;
                case "prevPage":
                    if (this._currentPage > 1) {
                        this._currentPage--;
                        await this.updateContent(false);
                    }
                    break;
                case "goToPage":
                    page = parseInt(message.page);
                    if (!isNaN(page) && page >= 1 && page <= this._totalPages) {
                        this._currentPage = page;
                        await this.updateContent(false);
                    }
                    break;
                case "toggleWordExpand":
                    this._toggleWordExpand(message.word);
                    await this.updateContent(false);
                    break;
            }
        });

        await this.updateContent();
    }

    private _toggleWordExpand(word: string) {
        if (this._expandedWords.has(word)) {
            this._expandedWords.delete(word);
        } else {
            this._expandedWords.add(word);
        }
    }

    private _toggleOccurrenceSelection(id: string) {
        if (this._selectedOccurrences.has(id)) {
            this._selectedOccurrences.delete(id);
        } else {
            this._selectedOccurrences.add(id);
        }

        // Update UI to reflect selection change
        this._panel?.webview.postMessage({
            command: "updateSelection",
            id,
            selected: this._selectedOccurrences.has(id),
        });
    }

    private async _replaceSelectedOccurrences(replacement: string) {
        if (this._selectedOccurrences.size === 0) {
            vscode.window.showInformationMessage("No occurrences selected for replacement");
            return;
        }

        // Group the occurrences by file
        const fileEdits = new Map<string, { occurrence: WordOccurrence; replacement: string }[]>();

        for (const wordFreq of this._wordFrequencies) {
            if (!wordFreq.occurrences) continue;

            for (const occurrence of wordFreq.occurrences) {
                const id = this._getOccurrenceId(occurrence);
                if (this._selectedOccurrences.has(id)) {
                    const key = occurrence.fileUri.toString();
                    if (!fileEdits.has(key)) {
                        fileEdits.set(key, []);
                    }
                    fileEdits.get(key)?.push({ occurrence, replacement });
                }
            }
        }

        // Apply edits to each file
        const workspaceEdit = new vscode.WorkspaceEdit();

        for (const [fileUriStr, edits] of fileEdits.entries()) {
            const fileUri = vscode.Uri.parse(fileUriStr);

            try {
                const document = await vscode.workspace.openTextDocument(fileUri);

                // Sort edits from last to first to avoid position shifts
                edits.sort((a, b) => {
                    if (a.occurrence.lineNumber !== b.occurrence.lineNumber) {
                        return b.occurrence.lineNumber - a.occurrence.lineNumber;
                    }
                    // Use original position if available
                    const aPos =
                        a.occurrence.originalStartPosition !== undefined
                            ? a.occurrence.originalStartPosition
                            : a.occurrence.startPosition;
                    const bPos =
                        b.occurrence.originalStartPosition !== undefined
                            ? b.occurrence.originalStartPosition
                            : b.occurrence.startPosition;
                    return bPos - aPos;
                });

                for (const edit of edits) {
                    const linePosition = document.lineAt(edit.occurrence.lineNumber).range.start;
                    // Use original position if available
                    const startPosition =
                        edit.occurrence.originalStartPosition !== undefined
                            ? edit.occurrence.originalStartPosition
                            : edit.occurrence.startPosition;

                    const startPos = new vscode.Position(
                        edit.occurrence.lineNumber,
                        linePosition.character + startPosition
                    );
                    const endPos = new vscode.Position(
                        edit.occurrence.lineNumber,
                        linePosition.character + startPosition + edit.occurrence.word.length
                    );

                    workspaceEdit.replace(
                        fileUri,
                        new vscode.Range(startPos, endPos),
                        edit.replacement
                    );
                }
            } catch (error) {
                console.error(`Error processing file ${fileUriStr}:`, error);
            }
        }

        // Apply all edits at once
        const success = await vscode.workspace.applyEdit(workspaceEdit);

        if (success) {
            vscode.window.showInformationMessage(
                `Successfully replaced ${this._selectedOccurrences.size} occurrences`
            );
            this._selectedOccurrences.clear();

            // Re-index to update the view
            await this.updateContent();
        } else {
            vscode.window.showErrorMessage("Failed to apply replacements");
        }
    }

    private _getOccurrenceId(occurrence: WordOccurrence): string {
        return `${occurrence.fileUri.toString()}_${occurrence.cellIndex}_${occurrence.lineNumber}_${occurrence.startPosition}`;
    }

    private async updateContent(reindex = true) {
        if (!this._panel) {
            return;
        }

        if (reindex) {
            // Initialize word index
            const { targetFiles } = await readSourceAndTargetFiles();
            const wordsIndex = await initializeWordsIndex(
                new Map<string, WordOccurrence[]>(),
                targetFiles
            );
            this._wordFrequencies = getWordFrequencies(wordsIndex);

            // Sort according to current sort mode
            this._sortFrequencies();

            // Reset pagination
            this._currentPage = 1;
            this._totalPages = Math.ceil(this._wordFrequencies.length / this._pageSize);
        }

        // Generate HTML with KWIC view
        this._panel.webview.html = this._generateKwicHtml();
    }

    private _sortFrequencies() {
        switch (this._sortMode) {
            case "frequency":
                this._wordFrequencies.sort((a, b) => b.frequency - a.frequency);
                break;
            case "leftContext":
                // Sort by left context of first occurrence
                this._wordFrequencies.sort((a, b) => {
                    const aContext = a.occurrences?.[0]?.leftContext || "";
                    const bContext = b.occurrences?.[0]?.leftContext || "";
                    return aContext.localeCompare(bContext);
                });

                // Also sort occurrences within each word
                this._wordFrequencies.forEach((wf) => {
                    if (wf.occurrences) {
                        wf.occurrences.sort((a, b) => a.leftContext.localeCompare(b.leftContext));
                    }
                });
                break;
            case "rightContext":
                // Sort by right context of first occurrence
                this._wordFrequencies.sort((a, b) => {
                    const aContext = a.occurrences?.[0]?.rightContext || "";
                    const bContext = b.occurrences?.[0]?.rightContext || "";
                    return aContext.localeCompare(bContext);
                });

                // Also sort occurrences within each word
                this._wordFrequencies.forEach((wf) => {
                    if (wf.occurrences) {
                        wf.occurrences.sort((a, b) => a.rightContext.localeCompare(b.rightContext));
                    }
                });
                break;
        }
    }

    private _generateKwicHtml(): string {
        return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>KWIC View</title>
            <style>
                :root {
                    --primary-color: #007acc;
                    --primary-hover: #005999;
                    --secondary-color: #6c757d;
                    --highlight-color: #de935f;
                    --header-bg: #edf2f7;
                    --item-hover: rgba(0, 122, 204, 0.08);
                    --item-selected: rgba(0, 122, 204, 0.2);
                    --border-color: #e2e8f0;
                    --border-radius: 6px;
                    --shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                }
                
                body {
                    padding: 20px;
                    margin: 0;
                    background-color: var(--vscode-editor-background);
                    color: var(--vscode-editor-foreground);
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Oxygen, Ubuntu, Cantarell, 'Open Sans', 'Helvetica Neue', sans-serif;
                    line-height: 1.5;
                    font-size: 14px;
                }
                
                * {
                    box-sizing: border-box;
                }
                
                .container {
                    max-width: 900px;
                    margin: 0 auto;
                }
                
                .stats-bar {
                    margin-bottom: 24px;
                    padding: 16px;
                    background: var(--header-bg);
                    border-radius: var(--border-radius);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    box-shadow: var(--shadow);
                    color: var(--vscode-foreground);
                }
                
                .control-panel {
                    margin-bottom: 24px;
                    display: grid;
                    grid-template-columns: 1fr auto;
                    gap: 16px;
                }
                
                .search-container {
                    position: relative;
                }
                
                .search-container svg {
                    position: absolute;
                    left: 12px;
                    top: 50%;
                    transform: translateY(-50%);
                    color: var(--secondary-color);
                    width: 16px;
                    height: 16px;
                }
                
                .search-box {
                    width: 100%;
                    padding: 10px 12px 10px 36px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: var(--border-radius);
                    font-size: 14px;
                    transition: all 0.2s ease;
                }
                
                .search-box:focus {
                    border-color: var(--primary-color);
                    outline: none;
                    box-shadow: 0 0 0 2px rgba(0, 122, 204, 0.2);
                }
                
                .button-group {
                    display: flex;
                    gap: 8px;
                }
                
                .option-bar {
                    display: flex;
                    justify-content: space-between;
                    margin-bottom: 16px;
                }
                
                button {
                    padding: 8px 16px;
                    background: var(--vscode-button-background);
                    color: var(--vscode-button-foreground);
                    border: none;
                    border-radius: var(--border-radius);
                    cursor: pointer;
                    font-size: 14px;
                    font-weight: 500;
                    transition: background 0.2s;
                    white-space: nowrap;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    min-width: 80px;
                }
                
                button svg {
                    margin-right: 6px;
                }
                
                button:hover {
                    background: var(--vscode-button-hoverBackground);
                }
                
                button:disabled {
                    opacity: 0.6;
                    cursor: not-allowed;
                }
                
                button.active {
                    background: var(--primary-color);
                    color: white;
                }
                
                button.ghost {
                    background: transparent;
                    color: var(--vscode-foreground);
                    border: 1px solid var(--border-color);
                }
                
                button.ghost:hover {
                    background: var(--item-hover);
                }
                
                button.danger {
                    background: #e53e3e;
                }
                
                button.danger:hover {
                    background: #c53030;
                }
                
                .word-list {
                    margin-bottom: 24px;
                }
                
                .word-card {
                    margin-bottom: 12px;
                    border: 1px solid var(--border-color);
                    border-radius: var(--border-radius);
                    overflow: hidden;
                    transition: box-shadow 0.2s;
                    position: relative;
                }
                
                .word-card:hover {
                    box-shadow: var(--shadow);
                }
                
                .word-header {
                    font-weight: 500;
                    padding: 14px 16px;
                    background: var(--header-bg);
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    cursor: pointer;
                    border-bottom: 1px solid transparent;
                    transition: background 0.2s;
                }
                
                .word-header:hover {
                    background: #e2e8f0;
                }
                
                .word {
                    font-size: 16px;
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .frequency {
                    font-size: 13px;
                    color: var(--secondary-color);
                    background: rgba(108, 117, 125, 0.1);
                    padding: 2px 8px;
                    border-radius: 12px;
                }
                
                .chevron {
                    width: 20px;
                    height: 20px;
                    transform: rotate(0deg);
                    transition: transform 0.3s ease;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }
                
                .chevron.expanded {
                    transform: rotate(90deg);
                }
                
                .chevron svg {
                    width: 16px;
                    height: 16px;
                }
                
                .word-occurrences {
                    border-top: 1px solid var(--border-color);
                    padding: 0;
                    margin: 0;
                }
                
                .occurrence-group {
                    padding: 0;
                    margin: 0;
                }
                
                .kwic-item {
                    display: flex;
                    padding: 12px 16px;
                    cursor: pointer;
                    transition: background 0.15s;
                    border-bottom: 1px solid var(--border-color);
                    position: relative;
                }
                
                .kwic-item:last-child {
                    border-bottom: none;
                }
                
                .kwic-item:hover {
                    background: var(--item-hover);
                }
                
                .kwic-item.selected {
                    background: var(--item-selected);
                }
                
                .kwic-item.selected::before {
                    content: '';
                    position: absolute;
                    left: 0;
                    top: 0;
                    bottom: 0;
                    width: 3px;
                    background-color: var(--primary-color);
                }
                
                .left-context {
                    flex: 1;
                    text-align: right;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding-right: 8px;
                    opacity: 0.85;
                    direction: rtl;
                }
                
                .keyword {
                    font-weight: 500;
                    padding: 0 8px;
                    white-space: nowrap;
                    color: var(--highlight-color);
                    position: relative;
                }
                
                .right-context {
                    flex: 1;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    padding-left: 8px;
                    opacity: 0.85;
                }
                
                .file-info {
                    font-size: 12px;
                    color: var(--secondary-color);
                    margin-top: 4px;
                    position: absolute;
                    bottom: 4px;
                    right: 16px;
                }
                
                .pagination {
                    display: flex;
                    justify-content: center;
                    align-items: center;
                    margin: 32px 0;
                    gap: 12px;
                }
                
                .page-info {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                }
                
                .page-input {
                    width: 50px;
                    text-align: center;
                    padding: 6px 8px;
                    border-radius: var(--border-radius);
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    font-size: 14px;
                }
                
                .hidden {
                    display: none;
                }
                
                #replacement-panel {
                    position: fixed;
                    bottom: 0;
                    left: 0;
                    right: 0;
                    background: var(--vscode-editor-background);
                    border-top: 1px solid var(--border-color);
                    padding: 16px 20px;
                    display: flex;
                    gap: 12px;
                    align-items: center;
                    box-shadow: 0 -2px 10px rgba(0, 0, 0, 0.1);
                    z-index: 100;
                    display: none;
                }
                
                #replacement-input {
                    flex: 1;
                    padding: 8px 12px;
                    background: var(--vscode-input-background);
                    color: var(--vscode-input-foreground);
                    border: 1px solid var(--vscode-input-border);
                    border-radius: var(--border-radius);
                    font-size: 14px;
                }
                
                .empty-state {
                    text-align: center;
                    padding: 32px;
                    color: var(--secondary-color);
                }
                
                .icon {
                    display: inline-block;
                    vertical-align: middle;
                }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="stats-bar">
                    <div>Total unique words: <strong>${this._wordFrequencies.length}</strong></div>
                    <div>Page <strong>${this._currentPage}</strong> of <strong>${this._totalPages}</strong></div>
                </div>
                
                <div class="control-panel">
                    <div class="search-container">
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <circle cx="11" cy="11" r="8"></circle>
                            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                        </svg>
                        <input type="text" id="searchBox" class="search-box" placeholder="Search words...">
                    </div>
                    
                    <div class="button-group">
                        <button id="selectAll" class="ghost">
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path>
                                <polyline points="22 4 12 14.01 9 11.01"></polyline>
                            </svg>
                            Select All
                        </button>
                        <button id="replaceButton" disabled>
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                            Replace (0)
                        </button>
                    </div>
                </div>
                
                <div class="option-bar">
                    <div class="button-group">
                        <button id="sortFrequency" class="${this._sortMode === "frequency" ? "active" : ""}">Frequency</button>
                        <button id="sortLeft" class="${this._sortMode === "leftContext" ? "active" : ""}">Left Context</button>
                        <button id="sortRight" class="${this._sortMode === "rightContext" ? "active" : ""}">Right Context</button>
                    </div>
                </div>
                
                <div class="pagination">
                    <button id="prevPage" class="ghost" ${this._currentPage <= 1 ? "disabled" : ""}>
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        Previous
                    </button>
                    
                    <div class="page-info">
                        <input type="text" class="page-input" id="pageInput" value="${this._currentPage}">
                        <span>of ${this._totalPages}</span>
                    </div>
                    
                    <button id="nextPage" class="ghost" ${this._currentPage >= this._totalPages ? "disabled" : ""}>
                        Next
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
                
                <div id="kwicContainer" class="word-list">
                    ${this._generateWordsList()}
                </div>
                
                <div class="pagination">
                    <button id="prevPage2" class="ghost" ${this._currentPage <= 1 ? "disabled" : ""}>
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="15 18 9 12 15 6"></polyline>
                        </svg>
                        Previous
                    </button>
                    
                    <div class="page-info">
                        <input type="text" class="page-input" id="pageInput2" value="${this._currentPage}">
                        <span>of ${this._totalPages}</span>
                    </div>
                    
                    <button id="nextPage2" class="ghost" ${this._currentPage >= this._totalPages ? "disabled" : ""}>
                        Next
                        <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </button>
                </div>
            </div>
            
            <div id="replacement-panel">
                <span>Replace with:</span>
                <input type="text" id="replacement-input" placeholder="New text...">
                <button id="apply-replacement">Apply</button>
                <button id="cancel-replacement" class="ghost">Cancel</button>
            </div>
            
            <script>
                (function() {
                    const vscode = acquireVsCodeApi();
                    const searchBox = document.getElementById('searchBox');
                    const kwicContainer = document.getElementById('kwicContainer');
                    const sortFrequencyBtn = document.getElementById('sortFrequency');
                    const sortLeftBtn = document.getElementById('sortLeft');
                    const sortRightBtn = document.getElementById('sortRight');
                    const selectAllBtn = document.getElementById('selectAll');
                    const replaceBtn = document.getElementById('replaceButton');
                    const replacementPanel = document.getElementById('replacement-panel');
                    const replacementInput = document.getElementById('replacement-input');
                    const applyReplacementBtn = document.getElementById('apply-replacement');
                    const cancelReplacementBtn = document.getElementById('cancel-replacement');
                    const prevPageBtn = document.getElementById('prevPage');
                    const nextPageBtn = document.getElementById('nextPage');
                    const prevPageBtn2 = document.getElementById('prevPage2');
                    const nextPageBtn2 = document.getElementById('nextPage2');
                    const pageInput = document.getElementById('pageInput');
                    const pageInput2 = document.getElementById('pageInput2');
                    
                    // Track selected state
                    let selectedCount = ${this._selectedOccurrences.size};
                    
                    // Initialize word headers for expansion/collapse
                    document.querySelectorAll('.word-header').forEach(header => {
                        header.addEventListener('click', () => {
                            const word = header.getAttribute('data-word');
                            const chevron = header.querySelector('.chevron');
                            chevron.classList.toggle('expanded');
                            vscode.postMessage({ command: 'toggleWordExpand', word });
                        });
                    });
                    
                    // Listen for messages from the extension
                    window.addEventListener('message', event => {
                        const message = event.data;
                        switch (message.command) {
                            case 'updateSelection':
                                const element = document.getElementById(message.id);
                                if (element) {
                                    if (message.selected) {
                                        element.classList.add('selected');
                                        selectedCount++;
                                    } else {
                                        element.classList.remove('selected');
                                        selectedCount--;
                                    }
                                }
                                updateReplaceButtonState();
                                break;
                        }
                    });
                    
                    // Search functionality
                    searchBox.addEventListener('keyup', function(e) {
                        const term = e.target.value.toLowerCase();
                        
                        if (term === '') {
                            document.querySelectorAll('.word-card').forEach(card => {
                                card.style.display = '';
                            });
                            return;
                        }
                        
                        document.querySelectorAll('.word-card').forEach(card => {
                            const word = card.getAttribute('data-word').toLowerCase();
                            
                            if (word.includes(term)) {
                                card.style.display = '';
                            } else {
                                card.style.display = 'none';
                            }
                        });
                        
                        // If no results, show empty state
                        const visibleCards = [...document.querySelectorAll('.word-card')].filter(
                            card => card.style.display !== 'none'
                        );
                        
                        if (visibleCards.length === 0) {
                            if (!document.getElementById('empty-state')) {
                                const emptyState = document.createElement('div');
                                emptyState.id = 'empty-state';
                                emptyState.className = 'empty-state';
                                emptyState.textContent = 'No words matching "' + term + '"';
                                kwicContainer.appendChild(emptyState);
                            }
                        } else {
                            const emptyState = document.getElementById('empty-state');
                            if (emptyState) {
                                emptyState.remove();
                            }
                        }
                    });
                    
                    // Sorting functionality
                    sortFrequencyBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'sortBy', sortMode: 'frequency' });
                    });
                    
                    sortLeftBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'sortBy', sortMode: 'leftContext' });
                    });
                    
                    sortRightBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'sortBy', sortMode: 'rightContext' });
                    });
                    
                    // Pagination
                    prevPageBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'prevPage' });
                    });
                    
                    nextPageBtn.addEventListener('click', () => {
                        vscode.postMessage({ command: 'nextPage' });
                    });
                    
                    prevPageBtn2.addEventListener('click', () => {
                        vscode.postMessage({ command: 'prevPage' });
                    });
                    
                    nextPageBtn2.addEventListener('click', () => {
                        vscode.postMessage({ command: 'nextPage' });
                    });
                    
                    function handlePageInput(input) {
                        input.addEventListener('keyup', (e) => {
                            if (e.key === 'Enter') {
                                const page = parseInt(input.value);
                                if (!isNaN(page)) {
                                    vscode.postMessage({ command: 'goToPage', page });
                                }
                            }
                        });
                    }
                    
                    handlePageInput(pageInput);
                    handlePageInput(pageInput2);
                    
                    // Selection functionality
                    function updateReplaceButtonState() {
                        replaceBtn.disabled = selectedCount === 0;
                        replaceBtn.innerHTML = \`
                            <svg class="icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                                <polyline points="23 4 23 10 17 10"></polyline>
                                <polyline points="1 20 1 14 7 14"></polyline>
                                <path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path>
                            </svg>
                            Replace (\${selectedCount})
                        \`;
                    }
                    
                    // Attach click event to all kwic items for selection toggle
                    document.querySelectorAll('.kwic-item').forEach(item => {
                        item.addEventListener('click', (e) => {
                            // Don't trigger if clicking on the file info
                            if (e.target.closest('.file-info')) {
                                return;
                            }
                            
                            const id = item.id;
                            vscode.postMessage({ command: 'toggleSelection', id });
                        });
                    });
                    
                    // Select All button
                    selectAllBtn.addEventListener('click', () => {
                        const allItems = document.querySelectorAll('.kwic-item:not([style*="display: none"])');
                        const allSelected = selectedCount === allItems.length;
                        
                        allItems.forEach(item => {
                            if (allSelected) {
                                if (item.classList.contains('selected')) {
                                    item.classList.remove('selected');
                                    vscode.postMessage({ command: 'toggleSelection', id: item.id });
                                }
                            } else {
                                if (!item.classList.contains('selected')) {
                                    item.classList.add('selected');
                                    vscode.postMessage({ command: 'toggleSelection', id: item.id });
                                }
                            }
                        });
                    });
                    
                    // Replace functionality
                    replaceBtn.addEventListener('click', () => {
                        replacementPanel.style.display = 'flex';
                        replacementInput.focus();
                    });
                    
                    applyReplacementBtn.addEventListener('click', () => {
                        const replacement = replacementInput.value;
                        vscode.postMessage({ command: 'replaceSelected', replacement });
                        replacementPanel.style.display = 'none';
                        replacementInput.value = '';
                    });
                    
                    cancelReplacementBtn.addEventListener('click', () => {
                        replacementPanel.style.display = 'none';
                        replacementInput.value = '';
                    });
                    
                    // Handle keyboard shortcuts
                    document.addEventListener('keydown', (e) => {
                        // Escape to cancel replacement
                        if (e.key === 'Escape' && replacementPanel.style.display === 'flex') {
                            cancelReplacementBtn.click();
                        }
                        
                        // Ctrl+Enter to apply replacement
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && replacementPanel.style.display === 'flex') {
                            applyReplacementBtn.click();
                        }
                    });
                    
                    // Initialize button state
                    updateReplaceButtonState();
                    
                    // Focus search box on load
                    searchBox.focus();
                })();
            </script>
        </body>
        </html>`;
    }

    private _generateWordsList(): string {
        // Get paginated list of words
        const startIdx = (this._currentPage - 1) * this._pageSize;
        const endIdx = Math.min(startIdx + this._pageSize, this._wordFrequencies.length);
        const pagedWords = this._wordFrequencies.slice(startIdx, endIdx);

        if (pagedWords.length === 0) {
            return `<div class="empty-state">No words found</div>`;
        }

        let html = "";

        for (const wordFreq of pagedWords) {
            const isExpanded = this._expandedWords.has(wordFreq.word);

            html += `
            <div class="word-card" data-word="${wordFreq.word}">
                <div class="word-header" data-word="${wordFreq.word}">
                    <div class="word">
                        <span>${wordFreq.word}</span>
                        <span class="frequency">${wordFreq.frequency}</span>
                    </div>
                    <div class="chevron ${isExpanded ? "expanded" : ""}">
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                            <polyline points="9 18 15 12 9 6"></polyline>
                        </svg>
                    </div>
                </div>
                
                <div id="word-section-${wordFreq.word}" class="word-occurrences ${isExpanded ? "" : "hidden"}">
                    <div class="occurrence-group">
            `;

            if (isExpanded && wordFreq.occurrences) {
                for (const occurrence of wordFreq.occurrences) {
                    const id = this._getOccurrenceId(occurrence);
                    const isSelected = this._selectedOccurrences.has(id);

                    html += `
                    <div id="${id}" class="kwic-item ${isSelected ? "selected" : ""}">
                        <div class="left-context">${this._escapeHtml(occurrence.leftContext)}</div>
                        <div class="keyword">${this._escapeHtml(occurrence.word)}</div>
                        <div class="right-context">${this._escapeHtml(occurrence.rightContext)}</div>
                        <div class="file-info">${occurrence.fileName} (line ${occurrence.lineNumber + 1})</div>
                    </div>
                    `;
                }
            }

            html += `
                    </div>
                </div>
            </div>`;
        }

        return html;
    }

    private _escapeHtml(text: string): string {
        return text
            .replace(/&/g, "&amp;")
            .replace(/</g, "&lt;")
            .replace(/>/g, "&gt;")
            .replace(/"/g, "&quot;")
            .replace(/'/g, "&#039;");
    }
}
