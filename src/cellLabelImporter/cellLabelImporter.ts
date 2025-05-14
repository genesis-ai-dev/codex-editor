import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as xlsx from "xlsx";
import MiniSearch from "minisearch";
import { SourceCellVersions } from "../../types";
import { FileData } from "../activationHelpers/contextAware/miniIndex/indexes/fileReaders";
import { createSourceTextIndex } from "../activationHelpers/contextAware/miniIndex/indexes/sourceTextIndex";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../utils/notebookMetadataManager";
import { CodexContentSerializer } from "../serializer";

// Interface for the cell label data
interface CellLabelData {
    cellId: string;
    startTime: string;
    endTime: string;
    character?: string;
    dialogue?: string;
    newLabel: string;
    currentLabel?: string;
    matched: boolean;
}

// Interface for the imported Excel/CSV format
interface ImportedRow {
    index?: string;
    type?: string;
    start?: string;
    end?: string;
    character?: string;
    dialogue?: string;
    CHARACTER?: string;
    DIALOGUE?: string;
    [key: string]: any; // Allow any string keys for dynamic column names
}

// Extended cell metadata interface to include cellLabel
interface CellMetadata {
    type?: string;
    id?: string;
    edits?: Array<{
        cellValue: string;
        timestamp: number;
        type: string;
        author?: string;
    }>;
    cellLabel?: string;
}

export async function openCellLabelImporter(context: vscode.ExtensionContext) {
    // Create the webview panel
    const panel = vscode.window.createWebviewPanel(
        "cellLabelImporter",
        "Import Cell Labels",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
        }
    );

    // Add the panel to disposables to ensure proper cleanup
    context.subscriptions.push(panel);

    // Track active panel
    let disposables: vscode.Disposable[] = [];

    // Get workspace folder
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        panel.dispose();
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Initialize the metadata manager for accessing notebook metadata
    const metadataManager = getNotebookMetadataManager();
    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    // Initialize source text index for matching cell IDs
    const sourceTextIndex = new MiniSearch<SourceCellVersions>({
        fields: ["cellId", "content"],
        storeFields: ["cellId", "content", "versions", "notebookId"],
        idField: "cellId",
    });

    // Load initial HTML without any data
    panel.webview.html = getWebviewContent([]);

    // Ensure temp directory exists
    const tempDirUri = vscode.Uri.joinPath(context.globalStorageUri, "temp");
    try {
        await vscode.workspace.fs.createDirectory(tempDirUri);
    } catch (error) {
        console.error("Failed to create temp directory:", error);
    }

    // Handle messages from the webview
    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        switch (message.command) {
            case "importFile":
                try {
                    const fileUris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: false,
                        filters: {
                            Spreadsheets: ["xlsx", "csv", "tsv"],
                        },
                        title: "Import Cell Labels from File",
                        openLabel: "Import",
                        defaultUri: vscode.Uri.file(workspaceRoot),
                    });

                    if (!fileUris || fileUris.length === 0) {
                        return; // User canceled
                    }

                    const sourceFileUri = fileUris[0];

                    try {
                        // Create a temp copy of the file inside the extension's storage
                        const tempFileUri = await copyToTempStorage(sourceFileUri, context);

                        // Now read the labels from the temp file
                        const importedLabels = await importLabelsFromVscodeUri(tempFileUri);

                        // Extract column headers for selection
                        const columnHeaders = getColumnHeaders(importedLabels);

                        // Send only the column headers first for selection
                        panel.webview.postMessage({
                            command: "updateHeaders",
                            headers: columnHeaders,
                            importSource: path.basename(sourceFileUri.fsPath),
                        });

                        // Store the imported data and URI for later use
                        panel.webview.postMessage({
                            command: "storeImportData",
                            data: importedLabels,
                            uri: tempFileUri.toString(),
                        });

                        // Clean up temp file - now handled after processing
                    } catch (error) {
                        console.error("Error accessing file:", error);
                        vscode.window.showErrorMessage(
                            `Cannot access file: ${sourceFileUri.fsPath}. Error: ${error instanceof Error ? error.message : String(error)}`
                        );
                        return;
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Error importing file: ${error.message}`);
                    console.error("Full error details:", error);
                }
                break;

            case "processLabels":
                try {
                    // Get the stored data and selected column
                    const { data, uri, selectedColumn } = message;

                    if (!data || !selectedColumn) {
                        vscode.window.showErrorMessage("Missing data or selected column");
                        return;
                    }

                    // Create source text index for matching
                    const { sourceFiles, targetFiles } = await loadSourceAndTargetFiles();
                    await createSourceTextIndex(
                        sourceTextIndex,
                        sourceFiles,
                        metadataManager,
                        true
                    );

                    // Match the imported labels with existing cell IDs using the selected column
                    const matchedLabels = await matchCellLabels(
                        data,
                        sourceFiles,
                        targetFiles,
                        selectedColumn
                    );

                    // Update the webview with the matched data
                    panel.webview.html = getWebviewContent(matchedLabels, {
                        importSource: path.basename(vscode.Uri.parse(uri).fsPath),
                    });

                    // Clean up temp file
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.parse(uri));
                    } catch (error) {
                        console.error("Failed to delete temp file:", error);
                    }
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Error processing labels: ${error.message}`);
                    console.error("Full error details:", error);
                }
                break;

            case "save":
                try {
                    const updatedLabels: CellLabelData[] = message.labels;
                    const selectedLabels = updatedLabels.filter(
                        (label) => label.matched && message.selectedIds.includes(label.cellId)
                    );

                    if (selectedLabels.length === 0) {
                        vscode.window.showInformationMessage("No cell labels selected for update.");
                        return;
                    }

                    await updateCellLabels(selectedLabels);
                    vscode.window.showInformationMessage(
                        `Updated ${selectedLabels.length} cell labels successfully.`
                    );
                    panel.dispose();
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to save cell labels: ${error.message}`);
                }
                break;

            case "cancel":
                panel.dispose();
                break;
        }
    });

    // Add message listener to disposables
    disposables.push(messageListener);

    // Clean up when the panel is closed
    panel.onDidDispose(
        () => {
            // Clean up all disposables
            disposables.forEach((d) => d.dispose());
            disposables = [];
        },
        null,
        disposables
    );

    // Add the disposables to context.subscriptions
    context.subscriptions.push(...disposables);
}

// Helper function to copy a file to temp storage
async function copyToTempStorage(
    sourceUri: vscode.Uri,
    context: vscode.ExtensionContext
): Promise<vscode.Uri> {
    // Create a temp file path in extension's storage area
    const tempDirUri = vscode.Uri.joinPath(context.globalStorageUri, "temp");
    await vscode.workspace.fs.createDirectory(tempDirUri);

    const fileName = path.basename(sourceUri.fsPath);
    const tempFileUri = vscode.Uri.joinPath(tempDirUri, `${Date.now()}-${fileName}`);

    // Read the original file using VS Code's API
    const fileData = await vscode.workspace.fs.readFile(sourceUri);

    // Write it to the temp location
    await vscode.workspace.fs.writeFile(tempFileUri, fileData);

    return tempFileUri;
}

// Helper function to get column headers from imported data
function getColumnHeaders(importedData: ImportedRow[]): string[] {
    if (importedData.length === 0) {
        return [];
    }

    // Get the first row and extract all keys
    const firstRow = importedData[0];
    return Object.keys(firstRow);
}

// Import labels from Excel or CSV file using VSCode's file system API
async function importLabelsFromVscodeUri(fileUri: vscode.Uri): Promise<ImportedRow[]> {
    try {
        // Read the file using VSCode's file system API
        const fileData = await vscode.workspace.fs.readFile(fileUri);

        // Determine file type based on extension
        const fileExt = path.extname(fileUri.fsPath).toLowerCase();

        let workbook;
        // Use xlsx to parse the file data directly from the buffer
        if (fileExt === ".csv" || fileExt === ".tsv") {
            const content = new TextDecoder().decode(fileData);
            const delimiter = fileExt === ".tsv" ? "\t" : ",";
            workbook = xlsx.read(content, { type: "string", raw: true, FS: delimiter });
        } else {
            // Default to xlsx
            workbook = xlsx.read(fileData, { type: "buffer" });
        }

        const sheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[sheetName];

        // Convert to JSON, preserving the original column names
        const rows: any[] = xlsx.utils.sheet_to_json(worksheet, { raw: false });

        // If no rows found, throw an error
        if (rows.length === 0) {
            throw new Error(`No data found in the file: ${fileUri.fsPath}`);
        }

        // Return data with original column names
        return rows;
    } catch (error) {
        console.error("Error importing labels:", error);
        throw new Error(
            `Failed to import file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Keep the old function for backward compatibility, but modify it to use the new approach
async function importLabelsFromFile(filePath: string): Promise<ImportedRow[]> {
    try {
        // Convert file path to URI and use the VSCode API to read it
        const fileUri = vscode.Uri.file(filePath);
        return await importLabelsFromVscodeUri(fileUri);
    } catch (error) {
        console.error("Error importing labels from file path:", error);
        throw new Error(
            `Failed to import file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

// Helper function to convert timestamp from HH:MM:SS,mmm format to seconds
function convertTimestampToSeconds(timestamp: string): number {
    if (!timestamp) return 0;

    // Handle different timestamp formats
    let match;

    // Format: HH:MM:SS,mmm
    match = timestamp.match(/(\d+):(\d+):(\d+),(\d+)/);
    if (match) {
        const hours = parseInt(match[1]);
        const minutes = parseInt(match[2]);
        const seconds = parseInt(match[3]);
        const milliseconds = parseInt(match[4]);
        return hours * 3600 + minutes * 60 + seconds + milliseconds / 1000;
    }

    // Format: MM:SS.mmm
    match = timestamp.match(/(\d+):(\d+)\.(\d+)/);
    if (match) {
        const minutes = parseInt(match[1]);
        const seconds = parseInt(match[2]);
        const milliseconds = parseInt(match[3]);
        return minutes * 60 + seconds + milliseconds / 1000;
    }

    // If it's already in seconds format
    if (!isNaN(parseFloat(timestamp))) {
        return parseFloat(timestamp);
    }

    return 0;
}

// Match imported labels with existing cell IDs
async function matchCellLabels(
    importedRows: ImportedRow[],
    sourceFiles: FileData[],
    targetFiles: FileData[],
    labelColumn: string
): Promise<CellLabelData[]> {
    const result: CellLabelData[] = [];

    // Create a map of all cells by their start time
    const cellMap = new Map<number, { cellId: string; currentLabel?: string }>();

    // Extract all cells from source files and create a time-based lookup
    sourceFiles.forEach((file) => {
        file.cells.forEach((cell) => {
            if (cell.metadata?.id) {
                const cellId = cell.metadata.id;

                // Extract the start time from the cell ID (e.g., "cue-25.192-29.029")
                const timeMatch = cellId.match(/cue-(\d+(?:\.\d+)?)-/);
                if (timeMatch && timeMatch[1]) {
                    const startTimeSeconds = parseFloat(timeMatch[1]);
                    cellMap.set(startTimeSeconds, {
                        cellId,
                        currentLabel: (cell.metadata as CellMetadata).cellLabel,
                    });
                }
            }
        });
    });

    // Process each imported row
    importedRows.forEach((row) => {
        // Check if the row has a type field and it equals "cue"
        // If not, try to determine if this is a subtitle by other means
        const isCue =
            row.type === "cue" ||
            (row.start && row.end) || // Has time fields
            Object.keys(row).some((key) => key.toLowerCase().includes("time")); // Has time-related fields

        if (isCue) {
            // Find start time field - could be named differently
            let startField = "start";
            if (!row.start) {
                const possibleStarts = Object.keys(row).filter(
                    (key) =>
                        key.toLowerCase().includes("start") ||
                        key.toLowerCase().includes("begin") ||
                        key.toLowerCase().includes("from")
                );

                if (possibleStarts.length > 0) {
                    startField = possibleStarts[0];
                }
            }

            // Convert the imported row's start time to seconds
            const startTimeSeconds = convertTimestampToSeconds(row[startField] || "");

            // Find which field to use for the label based on user selection
            const labelValue = row[labelColumn] ? row[labelColumn].toString().trim() : "";

            // Skip empty labels
            if (!labelValue) {
                return;
            }

            // Try to find a matching cell
            // First, look for an exact time match
            let match = cellMap.get(startTimeSeconds);

            // If no exact match, look for the closest cell within a small threshold (e.g., 0.5 seconds)
            if (!match) {
                const threshold = 0.5; // 0.5 second threshold
                let closestDiff = threshold;
                let closestCell: { cellId: string; currentLabel?: string } | undefined;

                cellMap.forEach((cell, time) => {
                    const diff = Math.abs(time - startTimeSeconds);
                    if (diff < closestDiff) {
                        closestDiff = diff;
                        closestCell = cell;
                    }
                });

                match = closestCell;
            }

            // Determine end time field
            let endField = "end";
            if (!row.end) {
                const possibleEnds = Object.keys(row).filter(
                    (key) =>
                        key.toLowerCase().includes("end") ||
                        key.toLowerCase().includes("stop") ||
                        key.toLowerCase().includes("to")
                );

                if (possibleEnds.length > 0) {
                    endField = possibleEnds[0];
                }
            }

            result.push({
                cellId: match?.cellId || "",
                startTime: row[startField] || "",
                endTime: row[endField] || "",
                character: row.character || row.CHARACTER || "",
                dialogue: row.dialogue || row.DIALOGUE || "",
                newLabel: labelValue,
                currentLabel: match?.currentLabel,
                matched: !!match,
            });
        }
    });

    return result;
}

// Load source and target files
async function loadSourceAndTargetFiles(): Promise<{
    sourceFiles: FileData[];
    targetFiles: FileData[];
}> {
    // Use the dynamic import to avoid TS errors
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/miniIndex/indexes/fileReaders"
    );
    return await readSourceAndTargetFiles();
}

// Update cell labels in both source and target files
async function updateCellLabels(labels: CellLabelData[]): Promise<void> {
    const { sourceFiles, targetFiles } = await loadSourceAndTargetFiles();

    // Create a map for quick lookup of cell IDs
    const labelsMap = new Map<string, string>();
    labels.forEach((label) => {
        if (label.cellId && label.newLabel) {
            labelsMap.set(label.cellId, label.newLabel);
        }
    });

    // Update labels in source files
    for (const file of sourceFiles) {
        let fileModified = false;

        for (const cell of file.cells) {
            if (cell.metadata?.id && labelsMap.has(cell.metadata.id)) {
                (cell.metadata as CellMetadata).cellLabel = labelsMap.get(cell.metadata.id);
                fileModified = true;
            }
        }

        if (fileModified) {
            await saveNotebookFile(file);
        }
    }

    // Update labels in target files
    for (const file of targetFiles) {
        let fileModified = false;

        for (const cell of file.cells) {
            if (cell.metadata?.id && labelsMap.has(cell.metadata.id)) {
                (cell.metadata as CellMetadata).cellLabel = labelsMap.get(cell.metadata.id);
                fileModified = true;
            }
        }

        if (fileModified) {
            await saveNotebookFile(file);
        }
    }
}

// Save the modified notebook file
async function saveNotebookFile(file: FileData): Promise<void> {
    try {
        // Create a serializer
        const serializer = new CodexContentSerializer();

        // Convert file data back to notebook format
        const notebookData = {
            cells: file.cells.map((cell) => ({
                kind: 2, // Assuming all cells are "text" type
                value: cell.value,
                languageId: "scripture",
                metadata: cell.metadata,
            })),
        };

        // Serialize the notebook with a proper cancellation token
        const cancellationToken = new vscode.CancellationTokenSource().token;
        const content = await serializer.serializeNotebook(notebookData, cancellationToken);

        // Write the file
        await vscode.workspace.fs.writeFile(file.uri, content);
    } catch (error) {
        console.error(`Failed to save notebook file: ${file.uri.toString()}`, error);
        throw new Error(
            `Failed to save notebook file: ${error instanceof Error ? error.message : String(error)}`
        );
    }
}

function getWebviewContent(cellLabels: CellLabelData[], options: { importSource?: string } = {}) {
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
