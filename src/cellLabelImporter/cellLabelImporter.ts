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
import { importLabelsFromVscodeUri } from "./fileHandler";
import { matchCellLabels } from "./matcher";
import { copyToTempStorage, getColumnHeaders } from "./utils";
import { updateCellLabels } from "./updater";

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

// Helper function to generate nonce (from navigationWebviewProvider)
function getNonce(): string {
    let text = "";
    const possible = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
    for (let i = 0; i < 32; i++) {
        text += possible.charAt(Math.floor(Math.random() * possible.length));
    }
    return text;
}

async function getHtmlForCellLabelImporterView(
    webview: vscode.Webview,
    context: vscode.ExtensionContext
): Promise<string> {
    const distPath = vscode.Uri.joinPath(
        context.extensionUri,
        "webviews",
        "codex-webviews",
        "dist",
        "CellLabelImporterView"
    );

    // Option 1: Look for a pre-built index.html (if Vite generates one with hashed assets)
    // This is more robust to asset hash changes.
    // For this to work, ensure CellLabelImporterView build output includes an index.html in its root.
    // const indexPath = vscode.Uri.joinPath(distPath, 'index.html');
    // try {
    //     const indexContentBytes = await vscode.workspace.fs.readFile(indexPath);
    //     let indexContent = new TextDecoder().decode(indexContentBytes);
    //     // Replace asset paths with webview URIs
    //     indexContent = indexContent.replace(/(href|src)=\"/g, `$1="${webview.asWebviewUri(distPath)}/`);
    //     // Add nonce to script tags if needed by your CSP and how Vite injects scripts
    //     // This part can be tricky and depends on Vite's output structure.
    //     return indexContent;
    // } catch (e) {
    //     console.warn("Could not read pre-built index.html for CellLabelImporterView, falling back to explicit asset paths.", e);
    // }

    // Option 2: Explicitly link to known (potentially unhashed or predictably named) assets.
    // This is simpler if Vite's output names are predictable and don't include hashes, or if you handle hashes manually.
    // The `package.json` uses `vite build`, which often produces hashed assets. We might need to adjust build or use a manifest.
    // For now, let's assume a common output `index.js` (or main.js/bundle.js) and potentially `index.css`.
    // This might need adjustment based on actual Vite output for `CellLabelImporterView`.

    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "index.js")); // Adjust if filename is different
    // const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "index.css")); // Adjust if CSS is separate and named differently

    // URIs for common VS Code styles and icons (copied from navigationWebviewProvider)
    const styleResetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "reset.css")
    );
    const styleVSCodeUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "vscode.css")
    );
    const codiconsUri = webview.asWebviewUri(
        vscode.Uri.joinPath(
            context.extensionUri,
            "node_modules",
            "@vscode/codicons",
            "dist",
            "codicon.css"
        )
    );
    const nonce = getNonce();

    return `<!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <meta http-equiv="Content-Security-Policy" content="default-src 'none';
                img-src ${webview.cspSource} https: data:;
                style-src ${webview.cspSource} 'unsafe-inline'; 
                script-src 'nonce-${nonce}';
                font-src ${webview.cspSource};">
            <link href="${styleResetUri}" rel="stylesheet">
            <link href="${styleVSCodeUri}" rel="stylesheet">
            <link href="${codiconsUri}" rel="stylesheet">
            
            <script nonce="${nonce}">
                const vscode = acquireVsCodeApi();
                // Persisted state can be passed to the webview this way if needed before React app loads,
                // though the React app also tries to load it via vscode.getState().
                // const persistedState = \${JSON.stringify(vscode.getState ? vscode.getState() : {})}; 
                // Or, post it after webview is ready.
            </script>
        </head>
        <body>
            <div id="root"></div>
            <script nonce="${nonce}" src="${scriptUri}"></script>
        </body>
        </html>`;
}

export async function openCellLabelImporter(context: vscode.ExtensionContext) {
    const panel = vscode.window.createWebviewPanel(
        "cellLabelImporter",
        "Import Cell Labels (React)",
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            retainContextWhenHidden: true,
            localResourceRoots: [
                context.extensionUri,
                vscode.Uri.joinPath(context.extensionUri, "webviews", "codex-webviews", "dist"),
            ],
        }
    );

    context.subscriptions.push(panel);
    let disposables: vscode.Disposable[] = [];

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        vscode.window.showErrorMessage("No workspace folder is open.");
        panel.dispose();
        return;
    }
    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    const metadataManager = getNotebookMetadataManager();
    await metadataManager.initialize();
    await metadataManager.loadMetadata();

    const sourceTextIndex = new MiniSearch<SourceCellVersions>({
        fields: ["cellId", "content"],
        storeFields: ["cellId", "content", "versions", "notebookId"],
        idField: "cellId",
    });

    panel.webview.html = await getHtmlForCellLabelImporterView(panel.webview, context);

    // Initial data load for the webview (if any part needs to be ready immediately)
    // For example, pre-load available source files for the exclusion list.
    // Otherwise, the webview can request data when it's ready, or data is sent on events like file import.
    // Let's try sending availableSourceFiles after a short delay or on a 'webviewReady' message if implemented in React app.
    // For simplicity now, we can post it once, the React app will manage if it arrives before or after it asks.

    // Example: if you wanted to pre-populate the file exclusion list right away
    // (async () => {
    //     const { sourceFiles } = await loadSourceAndTargetFiles();
    //     panel.webview.postMessage({
    //         command: 'initialData', // Or use a more specific command like 'setAvailableSourceFiles'
    //         availableSourceFiles: sourceFiles.map(f => ({ path: f.uri.fsPath, id: f.id, name: path.basename(f.uri.fsPath) }))
    //     });
    // })();

    const tempDirUri = vscode.Uri.joinPath(context.globalStorageUri, "temp");
    try {
        await vscode.workspace.fs.createDirectory(tempDirUri);
    } catch (error) {
        // console.error("Failed to create temp directory:", error); // Often fails if exists, which is fine
    }

    const messageListener = panel.webview.onDidReceiveMessage(async (message) => {
        console.log("[Extension] Received message from CellLabelImporterView:", message);
        switch (message.command) {
            case "importFile":
                try {
                    panel.webview.postMessage({ command: "setLoading", isLoading: true });
                    const fileUris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: true, // Allow multiple files
                        filters: { Spreadsheets: ["xlsx", "csv", "tsv"] },
                        title: "Import Cell Labels from File(s)",
                        openLabel: "Import",
                        defaultUri: vscode.Uri.file(workspaceRoot),
                    });

                    if (!fileUris || fileUris.length === 0) {
                        panel.webview.postMessage({ command: "setLoading", isLoading: false });
                        return;
                    }

                    const allImportedData: ImportedRow[] = [];
                    const allColumnHeaders = new Set<string>();
                    const importSourceNames: string[] = [];
                    const tempFileUris: vscode.Uri[] = []; // To keep track for potential cleanup

                    for (const sourceFileUri of fileUris) {
                        const tempFileUri = await copyToTempStorage(sourceFileUri, context);
                        tempFileUris.push(tempFileUri); // Store for later use or cleanup
                        const currentFileData = await importLabelsFromVscodeUri(tempFileUri);

                        // Get headers for current file and add to overall set
                        if (currentFileData.length > 0) {
                            Object.keys(currentFileData[0]).forEach((header) =>
                                allColumnHeaders.add(header)
                            );
                        }
                        allImportedData.push(...currentFileData);
                        importSourceNames.push(path.basename(sourceFileUri.fsPath));
                    }

                    // Ensure all rows have all columns, filling missing ones with undefined
                    // This is important if files have divergent columns
                    const finalHeaders = Array.from(allColumnHeaders);
                    const processedImportData = allImportedData.map((row) => {
                        const newRow: ImportedRow = {};
                        for (const header of finalHeaders) {
                            newRow[header] = row[header]; // Will be undefined if not present in original row
                        }
                        return newRow;
                    });

                    const { sourceFiles } = await loadSourceAndTargetFiles();

                    panel.webview.postMessage({
                        command: "updateHeaders",
                        headers: finalHeaders,
                        importSource: importSourceNames.join(", "), // Display all imported filenames
                        availableSourceFiles: sourceFiles.map((f) => ({
                            path: f.uri.fsPath,
                            id: f.id,
                            name: path.basename(f.uri.fsPath),
                        })),
                    });
                    panel.webview.postMessage({
                        command: "storeImportData",
                        data: processedImportData, // Send processed data
                        // For multiple files, a single URI for cleanup is tricky.
                        // The old logic deleted a single temp file after processing.
                        // Now, multiple temp files are created.
                        // We'll need to adjust cleanup logic if we want to clean them all up.
                        // For now, let's pass an array of temp URIs, or handle cleanup differently.
                        // Let's send a representative URI for now, or null, and address detailed cleanup later.
                        // The existing `cleanupTempFile` command in the webview expects a single URI.
                        // And the processLabels cleanup also expects a single URI.
                        // This part needs careful thought.
                        // For now, we'll send the URI of the *first* temp file for display/logging,
                        // but this doesn't solve the cleanup of *all* temp files from a multi-import.
                        // A simple approach for now: the webview won't be responsible for cleaning these up on cancel.
                        // The extension will clean them up after 'processLabels' (if possible) or not at all.
                        // Let's send a generic identifier or the first file's URI for the 'uri' field,
                        // as the webview uses it for display in 'importSource' if 'processLabels' is called.
                        uri: tempFileUris.length > 0 ? tempFileUris[0].toString() : null,
                    });
                } catch (error: any) {
                    console.error("Error during importFile:", error);
                    vscode.window.showErrorMessage(`Error importing file: ${error.message}`);
                    panel.webview.postMessage({
                        command: "showError",
                        error: `Error importing file: ${error.message}`,
                    });
                    panel.webview.postMessage({ command: "setLoading", isLoading: false });
                }
                break;

            case "processLabels":
                try {
                    panel.webview.postMessage({ command: "setLoading", isLoading: true });
                    const { data, uri, selectedColumn, excludedFilePaths } = message;
                    if (!data || !selectedColumn) {
                        vscode.window.showErrorMessage(
                            "Missing data or selected column for processing."
                        );
                        panel.webview.postMessage({
                            command: "showError",
                            error: "Missing data or selected column.",
                        });
                        panel.webview.postMessage({ command: "setLoading", isLoading: false });
                        return;
                    }

                    const { sourceFiles, targetFiles } = await loadSourceAndTargetFiles();
                    let filesToProcess = [...sourceFiles];
                    if (excludedFilePaths && excludedFilePaths.length > 0) {
                        filesToProcess = filesToProcess.filter(
                            (file) => !excludedFilePaths.includes(file.uri.fsPath)
                        );
                    }

                    sourceTextIndex.removeAll();
                    await createSourceTextIndex(
                        sourceTextIndex,
                        filesToProcess,
                        metadataManager,
                        true
                    );
                    const matchedLabels = await matchCellLabels(
                        data,
                        filesToProcess,
                        targetFiles,
                        selectedColumn
                    );

                    panel.webview.postMessage({
                        command: "displayLabels",
                        labels: matchedLabels,
                        importSource: path.basename(vscode.Uri.parse(uri).fsPath), // Keep track of original import source for display
                        availableSourceFiles: sourceFiles.map((f) => ({
                            path: f.uri.fsPath,
                            id: f.id,
                            name: path.basename(f.uri.fsPath),
                        })), // Send full list for UI consistency
                    });
                    panel.webview.postMessage({ command: "setLoading", isLoading: false });

                    // Clean up temp file for the processed import
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.parse(uri));
                    } catch (e) {
                        console.warn("Failed to delete temp import file after processing:", uri, e);
                    }
                } catch (error: any) {
                    console.error("Error during processLabels:", error);
                    vscode.window.showErrorMessage(`Error processing labels: ${error.message}`);
                    panel.webview.postMessage({
                        command: "showError",
                        error: `Error processing labels: ${error.message}`,
                    });
                    panel.webview.postMessage({ command: "setLoading", isLoading: false });
                }
                break;

            case "cleanupTempFile": // New case from React App
                if (message.uri) {
                    try {
                        await vscode.workspace.fs.delete(vscode.Uri.parse(message.uri));
                        console.log("Temp file deleted on cancel:", message.uri);
                    } catch (e) {
                        console.warn("Failed to delete temp file on cancel:", message.uri, e);
                    }
                }
                break;

            case "save":
                try {
                    const updatedLabels: CellLabelData[] = message.labels; // Assuming CellLabelData structure matches
                    const selectedLabelsToSave = updatedLabels.filter(
                        (label: any) => label.matched && message.selectedIds.includes(label.cellId)
                    );
                    if (selectedLabelsToSave.length === 0) {
                        vscode.window.showInformationMessage("No cell labels selected for update.");
                        return;
                    }
                    await updateCellLabels(selectedLabelsToSave);
                    vscode.window.showInformationMessage(
                        `Updated ${selectedLabelsToSave.length} cell labels successfully.`
                    );
                    panel.dispose(); // Close panel on successful save
                } catch (error: any) {
                    vscode.window.showErrorMessage(`Failed to save cell labels: ${error.message}`);
                    panel.webview.postMessage({
                        command: "showError",
                        error: `Failed to save: ${error.message}`,
                    });
                }
                break;

            case "cancel":
                panel.dispose();
                break;

            case "logError": // For the webview to log errors to the extension console
                console.error("[CellLabelImporterView Error]:", message.message);
                break;
        }
    });

    disposables.push(messageListener);
    panel.onDidDispose(
        () => {
            disposables.forEach((d) => d.dispose());
            disposables = [];
        },
        null,
        context.subscriptions
    ); // Add to context.subscriptions for proper disposal of panel resources

    // Add the panel itself to disposables managed by the extension context
    context.subscriptions.push(panel);
}

// Load source and target files
async function loadSourceAndTargetFiles(): Promise<{
    sourceFiles: FileData[];
    targetFiles: FileData[];
}> {
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/miniIndex/indexes/fileReaders"
    );
    const files = await readSourceAndTargetFiles();
    console.log(
        `[loadSourceAndTargetFiles] Found ${files.sourceFiles.length} source files and ${files.targetFiles.length} target files.`
    );
    return files;
}
