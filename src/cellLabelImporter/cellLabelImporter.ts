import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";
import * as xlsx from "xlsx";
import { FileData } from "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders";
import {
    NotebookMetadataManager,
    getNotebookMetadataManager,
} from "../utils/notebookMetadataManager";
import { importLabelsFromVscodeUri } from "./fileHandler";
import { matchCellLabels } from "./matcher";
import { copyToTempStorage, getColumnHeaders } from "./utils";
import { updateCellLabels } from "./updater";
import { getNonce } from "../utils/getNonce";
import { safePostMessageToPanel } from "../utils/webviewUtils";

const DEBUG_CELL_LABEL_IMPORTER = false;
function debug(message: string, ...args: any[]): void {
    if (DEBUG_CELL_LABEL_IMPORTER) {
        console.log(`[CellLabelImporter] ${message}`, ...args);
    }
}

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
    sourceFileUri?: string; // Track which file this label belongs to
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


    const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "index.js")); // Adjust if filename is different
    // const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(distPath, "index.css")); // Adjust if CSS is separate and named differently

    // URIs for common VS Code styles and icons (copied from navigationWebviewProvider)
    const styleResetUri = webview.asWebviewUri(
        vscode.Uri.joinPath(context.extensionUri, "src", "assets", "reset.css")
    );
    // Note: vscode.css was removed in favor of Tailwind CSS in individual webviews
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

    // --- Variables to manage temporary files and import sources for the current session ---
    let currentSessionTempFileUris: vscode.Uri[] = [];
    let currentImportSourceNames: string[] = [];
    // ---

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

    panel.webview.html = await getHtmlForCellLabelImporterView(panel.webview, context);

    // Initial data load for the webview (if any part needs to be ready immediately)
    // For example, pre-load available source files for the exclusion list.
    // Otherwise, the webview can request data when it's ready, or data is sent on events like file import.
    // Let's try sending availableSourceFiles after a short delay or on a 'webviewReady' message if implemented in React app.
    // For simplicity now, we can post it once, the React app will manage if it arrives before or after it asks.

    // Example: if you wanted to pre-populate the file exclusion list right away
    // (async () => {
    //     const { sourceFiles } = await loadSourceAndTargetFiles();
    //     safePostMessageToPanel(panel, {
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
        debug("[Extension] Received message from CellLabelImporterView:", message);
        switch (message.command) {
            case "importFile":
                try {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: true });
                    // Clear previous session's temp files and sources if any (idempotent)
                    currentSessionTempFileUris.forEach(async (tempUri) => {
                        try {
                            await vscode.workspace.fs.delete(tempUri);
                        } catch (e) {
                            /* ignore */
                        }
                    });
                    currentSessionTempFileUris = [];
                    currentImportSourceNames = [];

                    const fileUris = await vscode.window.showOpenDialog({
                        canSelectFiles: true,
                        canSelectFolders: false,
                        canSelectMany: true,
                        filters: { Spreadsheets: ["xlsx", "csv", "tsv"] },
                        title: "Import Cell Labels from File(s)",
                        openLabel: "Import",
                        defaultUri: vscode.Uri.file(workspaceRoot),
                    });

                    if (!fileUris || fileUris.length === 0) {
                        safePostMessageToPanel(panel, { command: "setLoading", isLoading: false });
                        return;
                    }

                    const allImportedData: ImportedRow[] = [];
                    const allColumnHeaders = new Set<string>(); // Stores normalized headers
                    const localImportSourceNames: string[] = []; // Use local for this loop

                    for (const sourceFileUri of fileUris) {
                        const tempFileUri = await copyToTempStorage(sourceFileUri, context);
                        currentSessionTempFileUris.push(tempFileUri); // Add to session list for cleanup
                        const fileData: ImportedRow[] =
                            await importLabelsFromVscodeUri(tempFileUri);
                        localImportSourceNames.push(path.basename(sourceFileUri.fsPath));

                        if (fileData.length > 0) {
                            const normalizedRowsForCurrentFile = fileData.map((originalRow) => {
                                const normalizedRow: ImportedRow = {};
                                Object.keys(originalRow).forEach((originalHeader) => {
                                    const normalizedHeader = originalHeader.trim().toUpperCase();
                                    allColumnHeaders.add(normalizedHeader);
                                    normalizedRow[normalizedHeader] = originalRow[originalHeader];
                                });
                                return normalizedRow;
                            });
                            allImportedData.push(...normalizedRowsForCurrentFile);
                        }
                    }

                    currentImportSourceNames = localImportSourceNames; // Store for session
                    const finalHeaders = Array.from(allColumnHeaders);

                    const processedImportData = allImportedData.map(
                        (rowWithSomeNormalizedHeaders) => {
                            const completeRow: ImportedRow = {};
                            for (const finalNormalizedHeader of finalHeaders) {
                                completeRow[finalNormalizedHeader] =
                                    rowWithSomeNormalizedHeaders[finalNormalizedHeader];
                            }
                            return completeRow;
                        }
                    );

                    const { sourceFiles } = await loadSourceAndTargetFiles();

                    safePostMessageToPanel(panel, {
                        command: "updateHeaders",
                        headers: finalHeaders,
                        importSource: currentImportSourceNames.join(", "),
                        availableSourceFiles: sourceFiles.map((f) => ({
                            path: f.uri.fsPath,
                            id: f.id,
                            name: path.basename(f.uri.fsPath),
                        })),
                    });
                    safePostMessageToPanel(panel, {
                        command: "storeImportData",
                        data: processedImportData,
                        // URI is no longer sent; extension handles cleanup via session
                    });
                } catch (error: any) {
                    console.error("Error during importFile:", error);
                    vscode.window.showErrorMessage(`Error importing file: ${error.message}`);
                    safePostMessageToPanel(panel, {
                        command: "showError",
                        error: `Error importing file: ${error.message}`,
                    });
                } finally {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: false });
                }
                break;

            case "processLabels":
                try {
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: true });
                    const {
                        data,
                        selectedColumn,
                        selectedColumns,
                        selectedTargetFilePath,
                        matchColumn,
                        matchFieldPath,
                    } = message;

                    if (!data || (!selectedColumn && (!selectedColumns || selectedColumns.length === 0))) {
                        vscode.window.showErrorMessage(
                            "Missing data or selected column(s) for processing."
                        );
                        safePostMessageToPanel(panel, {
                            command: "showError",
                            error: "Missing data or selected column(s).",
                        });
                        // No return here, finally block will still execute for cleanup & setLoading
                    } else if (!selectedTargetFilePath) {
                        vscode.window.showErrorMessage(
                            "Please select a target file to import labels into."
                        );
                        safePostMessageToPanel(panel, {
                            command: "showError",
                            error: "No target file selected.",
                        });
                    } else {
                        const { sourceFiles, targetFiles } = await loadSourceAndTargetFiles();

                        // Filter to only the selected file
                        const selectedFile = sourceFiles.find(
                            (file) => file.uri.fsPath === selectedTargetFilePath
                        );

                        if (!selectedFile) {
                            vscode.window.showErrorMessage(
                                `Selected file not found: ${selectedTargetFilePath}`
                            );
                            safePostMessageToPanel(panel, {
                                command: "showError",
                                error: "Selected file not found.",
                            });
                        } else {
                            const filesToProcess = [selectedFile];

                            const labelSelector = selectedColumn || selectedColumns;
                            const matchedLabels = await matchCellLabels(
                                data, // Data already has normalized headers from importFile
                                filesToProcess,
                                targetFiles,
                                labelSelector as any, // string or string[]
                                {
                                    matchColumn,
                                    matchFieldPath,
                                }
                            );

                            safePostMessageToPanel(panel, {
                                command: "displayLabels",
                                labels: matchedLabels,
                                importSource: currentImportSourceNames.join(", "), // Use session import names
                                availableSourceFiles: sourceFiles.map((f) => ({
                                    path: f.uri.fsPath,
                                    id: f.id,
                                    name: path.basename(f.uri.fsPath),
                                })),
                            });
                        }
                    }
                } catch (error: any) {
                    console.error("Error during processLabels:", error);
                    vscode.window.showErrorMessage(`Error processing labels: ${error.message}`);
                    safePostMessageToPanel(panel, {
                        command: "showError",
                        error: `Error processing labels: ${error.message}`,
                    });
                } finally {
                    // Clean up all temp files for the session after processing attempt
                    for (const tempUri of currentSessionTempFileUris) {
                        try {
                            await vscode.workspace.fs.delete(tempUri);
                            console.log(
                                "[TempFileCleanup] Deleted after processing:",
                                tempUri.fsPath
                            );
                        } catch (e) {
                            console.warn(
                                "[TempFileCleanup] Failed to delete after processing:",
                                tempUri.fsPath,
                                e
                            );
                        }
                    }
                    currentSessionTempFileUris = []; // Reset for next import
                    currentImportSourceNames = []; // Reset for next import
                    safePostMessageToPanel(panel, { command: "setLoading", isLoading: false });
                }
                break;

            case "requestMetadataFields":
                try {
                    const filePath: string | null = message.filePath;
                    if (!filePath) {
                        safePostMessageToPanel(panel, {
                            command: "updateMetadataFields",
                            fields: [],
                        });
                        break;
                    }

                    const { sourceFiles } = await loadSourceAndTargetFiles();
                    const selectedFile = sourceFiles.find((file) => file.uri.fsPath === filePath);
                    if (!selectedFile) {
                        safePostMessageToPanel(panel, {
                            command: "updateMetadataFields",
                            fields: [],
                        });
                        break;
                    }

                    const fields = getMetadataFieldsForFile(selectedFile);
                    safePostMessageToPanel(panel, {
                        command: "updateMetadataFields",
                        fields,
                    });
                } catch (error: any) {
                    console.error("Error during requestMetadataFields:", error);
                    safePostMessageToPanel(panel, {
                        command: "updateMetadataFields",
                        fields: [],
                    });
                }
                break;

            case "cancelImportCleanup": // New handler for webview's "Cancel Import"
                debug("[TempFileCleanup] Received cancelImportCleanup command.");
                for (const tempUri of currentSessionTempFileUris) {
                    try {
                        await vscode.workspace.fs.delete(tempUri);
                        debug("[TempFileCleanup] Deleted on cancel import:", tempUri.fsPath);
                    } catch (e) {
                        console.warn(
                            "[TempFileCleanup] Failed to delete on cancel import:",
                            tempUri.fsPath,
                            e
                        );
                    }
                }
                currentSessionTempFileUris = [];
                currentImportSourceNames = [];
                // Webview handles its own UI reset, no message needed back from extension for this command.
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
                    safePostMessageToPanel(panel, {
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

            // Final cleanup of any session temp files when panel is closed
            debug("[TempFileCleanup] Panel disposed. Cleaning up session temp files if any.");
            const urisToClean = [...currentSessionTempFileUris]; // Copy before clearing
            currentSessionTempFileUris = [];
            currentImportSourceNames = [];

            for (const tempUri of urisToClean) {
                vscode.workspace.fs.delete(tempUri).then(
                    () =>
                        debug("[TempFileCleanup] Deleted on panel dispose:", tempUri.fsPath),
                    (e) =>
                        console.warn(
                            "[TempFileCleanup] Failed to delete on panel dispose:",
                            tempUri.fsPath,
                            e
                        )
                );
            }
        },
        null,
        context.subscriptions
    );

    // Add the panel itself to disposables managed by the extension context
    context.subscriptions.push(panel);
}

function collectMetadataFieldPaths(
    value: any,
    prefix: string,
    fields: Set<string>
): void {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) return;

    if (typeof value === "object") {
        for (const key of Object.keys(value)) {
            if (key === "edits") continue;
            const nextPrefix = `${prefix}.${key}`;
            const nextValue = value[key];
            if (nextValue !== null && typeof nextValue === "object" && !Array.isArray(nextValue)) {
                collectMetadataFieldPaths(nextValue, nextPrefix, fields);
            } else if (nextValue !== undefined) {
                fields.add(nextPrefix);
            }
        }
        return;
    }

    fields.add(prefix);
}

function getMetadataFieldsForFile(file: FileData): string[] {
    const fields = new Set<string>();
    file.cells.forEach((cell) => {
        if (cell.metadata) {
            collectMetadataFieldPaths(cell.metadata, "metadata", fields);
        }
    });
    return Array.from(fields).sort();
}

// Load source and target files
async function loadSourceAndTargetFiles(): Promise<{
    sourceFiles: FileData[];
    targetFiles: FileData[];
}> {
    const { readSourceAndTargetFiles } = await import(
        "../activationHelpers/contextAware/contentIndexes/indexes/fileReaders"
    );
    const files = await readSourceAndTargetFiles();
    console.log(
        `[loadSourceAndTargetFiles] Found ${files.sourceFiles.length} source files and ${files.targetFiles.length} target files.`
    );
    return files;
}
