import { CellLabelData, WebviewContentOptions } from "./types";
import { getNonce } from "./utils";

/**
 * Generate HTML content for the webview
 */
export function getWebviewContent(
    cellLabels: CellLabelData[],
    options: WebviewContentOptions = {}
): string {
    // Split labels into pages for performance
    const itemsPerPage = 50;
    const totalPages = Math.ceil(cellLabels.length / itemsPerPage);

    return `<!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Import Cell Labels</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                color: var(--vscode-foreground);
                background-color: var(--vscode-editor-background);
                padding: 20px;
            }
            .import-info {
                margin-bottom: 20px;
                font-style: italic;
                color: var(--vscode-descriptionForeground);
            }
            .column-selector {
                margin-bottom: 20px;
                padding: 15px;
                background-color: var(--vscode-editor-lineHighlightBackground);
                border-radius: 4px;
            }
            .column-selector h3 {
                margin-top: 0;
            }
            .column-selector select {
                width: 100%;
                max-width: 400px;
                padding: 8px;
                background-color: var(--vscode-input-background);
                color: var(--vscode-input-foreground);
                border: 1px solid var(--vscode-input-border);
                border-radius: 2px;
                margin-bottom: 10px;
            }
            table {
                width: 100%;
                border-collapse: collapse;
                margin-bottom: 20px;
            }
            th, td {
                padding: 8px;
                text-align: left;
                border-bottom: 1px solid var(--vscode-panel-border);
            }
            th {
                background-color: var(--vscode-editor-lineHighlightBackground);
                font-weight: bold;
            }
            .matched {
                background-color: var(--vscode-diffEditor-insertedTextBackground);
            }
            .unmatched {
                background-color: var(--vscode-diffEditor-removedTextBackground);
                opacity: 0.7;
            }
            button {
                background-color: var(--vscode-button-background);
                color: var(--vscode-button-foreground);
                border: none;
                padding: 6px 12px;
                cursor: pointer;
                margin-right: 8px;
            }
            button:hover {
                background-color: var(--vscode-button-hoverBackground);
            }
            .actions {
                display: flex;
                justify-content: space-between;
                margin-top: 20px;
            }
            .pagination {
                display: flex;
                justify-content: center;
                margin: 20px 0;
            }
            .pagination button {
                margin: 0 5px;
            }
            .current-page {
                background-color: var(--vscode-button-secondaryBackground);
            }
            .checkbox-container {
                display: flex;
                align-items: center;
                margin-bottom: 10px;
            }
            .checkbox-container input {
                margin-right: 8px;
            }
            .summary {
                margin-bottom: 20px;
            }
            .empty-state {
                text-align: center;
                padding: 40px;
                color: var(--vscode-descriptionForeground);
            }
            .new-label {
                font-weight: bold;
            }
            .current-label {
                color: var(--vscode-descriptionForeground);
                text-decoration: line-through;
            }
            #columnSelectorContainer {
                display: none;
            }
            #tableView {
                display: none;
            }
        </style>
    </head>
    <body>
        <h1>Cell Label Importer</h1>
        
        <div id="initialImport" ${cellLabels.length > 0 ? 'class="hidden"' : ""}>
            <div class="empty-state">
                <p>No cell labels loaded yet.</p>
                <button id="importBtn">Import From File</button>
            </div>
        </div>

        <div id="columnSelectorContainer">
            <div class="import-info">
                Imported from: <span id="importedFileName"></span>
            </div>
            <div class="column-selector">
                <h3>Select Column to Use as Cell Label</h3>
                <p>Choose which column from your spreadsheet will be used for cell labels:</p>
                <select id="columnSelector"></select>
                <p>Preview of selected column:</p>
                <div id="columnPreview" style="max-height: 150px; overflow-y: auto; margin-bottom: 10px; padding: 10px; background-color: var(--vscode-input-background); border-radius: 2px;"></div>
                <button id="processLabelsBtn">Process Labels</button>
                <button id="cancelImportBtn">Cancel</button>
            </div>
        </div>
        
        <div id="tableView" ${cellLabels.length === 0 ? 'class="hidden"' : ""}>
            ${
                options.importSource
                    ? `
                <div class="import-info">
                    Imported from: ${options.importSource}
                </div>
            `
                    : ""
            }
            
            <div class="summary">
                <div>Total imported rows: <strong>${cellLabels.length}</strong></div>
                <div>Matched cells: <strong>${cellLabels.filter((l) => l.matched).length}</strong></div>
                <div>Unmatched cells: <strong>${cellLabels.filter((l) => !l.matched).length}</strong></div>
            </div>
            
            <div class="checkbox-container">
                <input type="checkbox" id="selectAll" ${cellLabels.filter((l) => l.matched).length > 0 ? "checked" : ""}>
                <label for="selectAll">Select all matched cells</label>
            </div>
            
            <div class="pagination" id="paginationTop"></div>
            
            <table>
                <thead>
                    <tr>
                        <th>Select</th>
                        <th>Cell ID</th>
                        <th>Time Range</th>
                        <th>New Label</th>
                        <th>Current Label</th>
                    </tr>
                </thead>
                <tbody id="labelTableBody">
                    <!-- Table rows will be inserted here via JavaScript -->
                </tbody>
            </table>
            
            <div class="pagination" id="paginationBottom"></div>
            
            <div class="actions">
                <div>
                    <button id="importNewBtn">Import New File</button>
                </div>
                <div>
                    <button id="cancelBtn">Cancel</button>
                    <button id="saveBtn">Save Selected</button>
                </div>
            </div>
        </div>
        
        <script>
            (function() {
                const vscode = acquireVsCodeApi();
                
                // State management
                const state = {
                    labels: ${JSON.stringify(cellLabels)},
                    selectedIds: ${JSON.stringify(cellLabels.filter((l) => l.matched).map((l) => l.cellId))},
                    currentPage: 1,
                    itemsPerPage: ${itemsPerPage},
                    totalPages: ${totalPages},
                    importData: null,
                    importUri: null,
                    headers: [],
                    selectedColumn: null,
                    importSource: ${JSON.stringify(options.importSource || "")}
                };
                
                // Save state
                vscode.setState(state);
                
                // Initial setup based on whether we have data
                if (state.labels.length > 0) {
                    document.getElementById('tableView').style.display = 'block';
                    document.getElementById('initialImport').style.display = 'none';
                    document.getElementById('columnSelectorContainer').style.display = 'none';
                } else {
                    document.getElementById('tableView').style.display = 'none';
                    document.getElementById('initialImport').style.display = 'block';
                    document.getElementById('columnSelectorContainer').style.display = 'none';
                }
                
                // Import button
                document.getElementById('importBtn')?.addEventListener('click', () => {
                    vscode.postMessage({ command: 'importFile' });
                });
                
                // Import new button (from table view)
                document.getElementById('importNewBtn')?.addEventListener('click', () => {
                    vscode.postMessage({ command: 'importFile' });
                });
                
                // Process labels button
                document.getElementById('processLabelsBtn')?.addEventListener('click', () => {
                    const selectedColumn = document.getElementById('columnSelector').value;
                    if (!selectedColumn) {
                        // Show error message
                        return;
                    }
                    
                    state.selectedColumn = selectedColumn;
                    vscode.setState(state);
                    
                    vscode.postMessage({ 
                        command: 'processLabels',
                        data: state.importData,
                        uri: state.importUri,
                        selectedColumn
                    });
                });
                
                // Cancel button in column selector
                document.getElementById('cancelImportBtn')?.addEventListener('click', () => {
                    // Reset to initial state
                    document.getElementById('tableView').style.display = 'none';
                    document.getElementById('initialImport').style.display = 'block';
                    document.getElementById('columnSelectorContainer').style.display = 'none';
                });
                
                // Handle messages from the extension
                window.addEventListener('message', event => {
                    const message = event.data;
                    
                    if (message.command === 'updateHeaders') {
                        // Show the column selector UI
                        document.getElementById('tableView').style.display = 'none';
                        document.getElementById('initialImport').style.display = 'none';
                        document.getElementById('columnSelectorContainer').style.display = 'block';
                        
                        // Set filename
                        document.getElementById('importedFileName').textContent = message.importSource;
                        
                        // Populate the column selector dropdown
                        const columnSelector = document.getElementById('columnSelector');
                        columnSelector.innerHTML = '';
                        
                        // Add a placeholder option
                        const placeholderOption = document.createElement('option');
                        placeholderOption.value = '';
                        placeholderOption.textContent = '-- Select a column --';
                        placeholderOption.disabled = true;
                        placeholderOption.selected = true;
                        columnSelector.appendChild(placeholderOption);
                        
                        message.headers.forEach(header => {
                            const option = document.createElement('option');
                            option.value = header;
                            option.textContent = header;
                            columnSelector.appendChild(option);
                        });
                        
                        // Store headers in state
                        state.headers = message.headers;
                        vscode.setState(state);
                        
                        // Set up change handler for column preview
                        columnSelector.addEventListener('change', updateColumnPreview);
                    }
                    
                    if (message.command === 'storeImportData') {
                        // Store import data for later processing
                        state.importData = message.data;
                        state.importUri = message.uri;
                        vscode.setState(state);
                    }
                });
                
                // Function to update the column preview
                function updateColumnPreview() {
                    const columnSelector = document.getElementById('columnSelector');
                    const selectedColumn = columnSelector.value;
                    const previewEl = document.getElementById('columnPreview');
                    
                    if (!selectedColumn || !state.importData || state.importData.length === 0) {
                        previewEl.innerHTML = '<em>No preview available</em>';
                        return;
                    }
                    
                    // Get up to 5 values from the selected column
                    const previewValues = state.importData
                        .slice(0, 5)
                        .map(row => row[selectedColumn])
                        .filter(val => val) // Filter out empty values
                        .map(val => \`<div>\${val}</div>\`)
                        .join('');
                    
                    previewEl.innerHTML = previewValues || '<em>No data found in this column</em>';
                }
                
                // Cancel button
                document.getElementById('cancelBtn')?.addEventListener('click', () => {
                    vscode.postMessage({ command: 'cancel' });
                });
                
                // Save button
                document.getElementById('saveBtn')?.addEventListener('click', () => {
                    vscode.postMessage({ 
                        command: 'save', 
                        labels: state.labels,
                        selectedIds: state.selectedIds
                    });
                });
                
                // Select all checkbox
                const selectAll = document.getElementById('selectAll');
                if (selectAll) {
                    selectAll.addEventListener('change', (e) => {
                        const checked = e.target.checked;
                        
                        if (checked) {
                            // Select all matched cells
                            state.selectedIds = state.labels
                                .filter(label => label.matched)
                                .map(label => label.cellId);
                        } else {
                            // Deselect all
                            state.selectedIds = [];
                        }
                        
                        vscode.setState(state);
                        renderTable();
                    });
                }
                
                // Render pagination
                function renderPagination() {
                    const paginationTop = document.getElementById('paginationTop');
                    const paginationBottom = document.getElementById('paginationBottom');
                    
                    if (!paginationTop || !paginationBottom) return;
                    
                    // Clear existing buttons
                    paginationTop.innerHTML = '';
                    paginationBottom.innerHTML = '';
                    
                    if (state.totalPages <= 1) return;
                    
                    // Previous button
                    const prevBtn = document.createElement('button');
                    prevBtn.textContent = '←';
                    prevBtn.disabled = state.currentPage === 1;
                    prevBtn.addEventListener('click', () => {
                        if (state.currentPage > 1) {
                            state.currentPage--;
                            vscode.setState(state);
                            renderTable();
                            renderPagination();
                        }
                    });
                    
                    // Next button
                    const nextBtn = document.createElement('button');
                    nextBtn.textContent = '→';
                    nextBtn.disabled = state.currentPage === state.totalPages;
                    nextBtn.addEventListener('click', () => {
                        if (state.currentPage < state.totalPages) {
                            state.currentPage++;
                            vscode.setState(state);
                            renderTable();
                            renderPagination();
                        }
                    });
                    
                    // Page buttons
                    const maxVisiblePages = 5;
                    const startPage = Math.max(1, state.currentPage - Math.floor(maxVisiblePages / 2));
                    const endPage = Math.min(state.totalPages, startPage + maxVisiblePages - 1);
                    
                    // Add previous button
                    paginationTop.appendChild(prevBtn.cloneNode(true));
                    paginationBottom.appendChild(prevBtn);
                    
                    // Add page buttons
                    for (let i = startPage; i <= endPage; i++) {
                        const pageBtn = document.createElement('button');
                        pageBtn.textContent = i.toString();
                        pageBtn.classList.toggle('current-page', i === state.currentPage);
                        pageBtn.addEventListener('click', () => {
                            state.currentPage = i;
                            vscode.setState(state);
                            renderTable();
                            renderPagination();
                        });
                        
                        const pageBtnClone = pageBtn.cloneNode(true);
                        pageBtnClone.addEventListener('click', () => {
                            state.currentPage = i;
                            vscode.setState(state);
                            renderTable();
                            renderPagination();
                        });
                        
                        paginationTop.appendChild(pageBtnClone);
                        paginationBottom.appendChild(pageBtn);
                    }
                    
                    // Add next button
                    const nextBtnClone = nextBtn.cloneNode(true);
                    nextBtnClone.addEventListener('click', () => {
                        if (state.currentPage < state.totalPages) {
                            state.currentPage++;
                            vscode.setState(state);
                            renderTable();
                            renderPagination();
                        }
                    });
                    
                    paginationTop.appendChild(nextBtnClone);
                    paginationBottom.appendChild(nextBtn);
                }
                
                // Render table
                function renderTable() {
                    const tableBody = document.getElementById('labelTableBody');
                    if (!tableBody) return;
                    
                    tableBody.innerHTML = '';
                    
                    const start = (state.currentPage - 1) * state.itemsPerPage;
                    const end = Math.min(start + state.itemsPerPage, state.labels.length);
                    
                    for (let i = start; i < end; i++) {
                        const label = state.labels[i];
                        const row = document.createElement('tr');
                        row.className = label.matched ? 'matched' : 'unmatched';
                        
                        // Create cells
                        
                        // Checkbox cell
                        const checkboxCell = document.createElement('td');
                        if (label.matched) {
                            const checkbox = document.createElement('input');
                            checkbox.type = 'checkbox';
                            checkbox.checked = state.selectedIds.includes(label.cellId);
                            checkbox.dataset.cellId = label.cellId;
                            checkbox.addEventListener('change', (e) => {
                                const cellId = e.target.dataset.cellId;
                                
                                if (e.target.checked) {
                                    if (!state.selectedIds.includes(cellId)) {
                                        state.selectedIds.push(cellId);
                                    }
                                } else {
                                    state.selectedIds = state.selectedIds.filter(id => id !== cellId);
                                }
                                
                                // Update the selectAll checkbox
                                if (selectAll) {
                                    const matchedCells = state.labels.filter(l => l.matched).length;
                                    selectAll.checked = state.selectedIds.length === matchedCells;
                                }
                                
                                vscode.setState(state);
                            });
                            checkboxCell.appendChild(checkbox);
                        }
                        
                        // Cell ID cell
                        const cellIdCell = document.createElement('td');
                        cellIdCell.textContent = label.cellId || '(No match)';
                        
                        // Time range cell
                        const timeCell = document.createElement('td');
                        timeCell.textContent = \`\${label.startTime} → \${label.endTime}\`;
                        
                        // New label cell
                        const newLabelCell = document.createElement('td');
                        newLabelCell.className = 'new-label';
                        newLabelCell.textContent = label.newLabel || '(Empty)';
                        
                        // Current label cell
                        const currentLabelCell = document.createElement('td');
                        currentLabelCell.className = 'current-label';
                        currentLabelCell.textContent = label.currentLabel || '(None)';
                        
                        // Append cells
                        row.appendChild(checkboxCell);
                        row.appendChild(cellIdCell);
                        row.appendChild(timeCell);
                        row.appendChild(newLabelCell);
                        row.appendChild(currentLabelCell);
                        
                        tableBody.appendChild(row);
                    }
                }
                
                // Initial render
                if (state.labels.length > 0) {
                    renderTable();
                    renderPagination();
                }
            })();
        </script>
    </body>
    </html>`;
}
