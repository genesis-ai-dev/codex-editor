import * as vscode from "vscode";
import {
    GlobalMessage,
    TranslationPair,
} from "../../../types";
import { BaseWebviewProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
import { CodexCellEditorProvider } from "../codexCellEditorProvider/codexCellEditorProvider";
import { updateWorkspaceState } from "../../utils/workspaceEventListener";



export class CustomWebviewProvider extends BaseWebviewProvider {
    protected getWebviewId(): string {
        return "search-passages-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["ParallelView", "index.js"];
    }

    public async pinCellById(cellId: string, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300; // milliseconds

        // First, ensure the webview is visible
        console.log("pinCellByIdProvider", cellId);
        await vscode.commands.executeCommand("search-passages-sidebar.focus");

        // Wait for the webview to be ready
        if (!this._view && retryCount < maxRetries) {
            console.log(`Webview not ready, retrying (${retryCount + 1}/${maxRetries})...`);
            return new Promise((resolve) => {
                setTimeout(() => {
                    resolve(this.pinCellById(cellId, retryCount + 1));
                }, retryDelay);
            });
        }

        if (this._view) {
            // Get the translation pair for this cell
            let translationPair = await vscode.commands.executeCommand<TranslationPair>(
                "codex-editor-extension.getTranslationPairFromProject",
                cellId,
                { isParallelPassagesWebview: true }
            );

            if (!translationPair) {
                // If no translation pair is found, get only the source text
                const sourceCell = await vscode.commands.executeCommand(
                    "codex-editor-extension.getSourceCellByCellIdFromAllSourceCells",
                    cellId
                );

                if (sourceCell) {
                    // Create a new translation pair with empty target text
                    translationPair = {
                        cellId: cellId,
                        sourceCell: sourceCell,
                        targetCell: {
                            cellId: cellId,
                            content: "",
                            // Add any other required properties for targetCell with default values
                        },
                        // Add any other required properties for translationPair with default values
                    };
                } else {
                    console.error(`No source cell found for cell: ${cellId}`);
                    return;
                }
            }

            safePostMessageToView(this._view, {
                command: "pinCell",
                data: translationPair,
            });
        } else {
            vscode.window.showErrorMessage("Failed to open search passages view");
        }
    }

    private async openFileAtLocation(uri: string, cellId: string) {
        try {
            const parsedUri = vscode.Uri.parse(uri);
            const stringUri = parsedUri.toString();
            if (stringUri.includes(".codex") || stringUri.includes(".source")) {
                await vscode.commands.executeCommand("vscode.openWith", parsedUri, "codex.cellEditor");
                updateWorkspaceState(this._context, {
                    key: "cellToJumpTo",
                    value: cellId,
                });
            }
        } catch (error) {
            console.error(`Failed to open file: ${uri}`, error);
            vscode.window.showErrorMessage(`Failed to open file: ${uri}`);
        }
    }

    private async getProjectFiles(): Promise<Array<{ uri: string; name: string; type: "source" | "target" }>> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return [];
            }

            const [sourceFileUris, codexFileUris] = await Promise.all([
                vscode.workspace.findFiles(".project/sourceTexts/*.source"),
                vscode.workspace.findFiles("files/target/*.codex")
            ]);

            const files: Array<{ uri: string; name: string; type: "source" | "target" }> = [];

            // Add source files
            for (const uri of sourceFileUris) {
                const fileName = uri.path.split('/').pop()?.replace('.source', '') || 'Unknown';
                files.push({
                    uri: uri.toString(),
                    name: fileName,
                    type: "source"
                });
            }

            // Add target files
            for (const uri of codexFileUris) {
                const fileName = uri.path.split('/').pop()?.replace('.codex', '') || 'Unknown';
                files.push({
                    uri: uri.toString(),
                    name: fileName,
                    type: "target"
                });
            }

            return files.sort((a, b) => a.name.localeCompare(b.name));
        } catch (error) {
            console.error("Error getting project files:", error);
            return [];
        }
    }

    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case "getProjectFiles":
                try {
                    const files = await this.getProjectFiles();
                    safePostMessageToView(this._view, {
                        command: "projectFiles",
                        data: files,
                    });
                } catch (error) {
                    console.error("Error getting project files:", error);
                }
                break;
            case "openFileAtLocation":
                await this.openFileAtLocation(message.uri, message.word);
                break;
            case "requestPinning":
                await this.pinCellById(message.content.cellId);
                break;
            case "search":
                try {
                    const replaceMode = !!(message.replaceText && message.replaceText.trim());
                    const searchScope = message.searchScope || "both"; // "both" | "source" | "target"
                    const command = message.completeOnly
                        ? "codex-editor-extension.searchParallelCells"
                        : "codex-editor-extension.searchAllCells";

                    const selectedFiles = message.selectedFiles || []; // Array of file URIs
                    const results = await vscode.commands.executeCommand<TranslationPair[]>(
                        command,
                        message.query,
                        15, // k value
                        message.completeOnly ? false : true, // includeIncomplete for searchAllCells
                        false, // showInfo
                        { 
                            isParallelPassagesWebview: true,
                            replaceMode: replaceMode, // Pass replace mode flag
                            searchScope: searchScope, // Pass search scope: "both" | "source" | "target"
                            selectedFiles: selectedFiles // Pass selected file URIs for filtering
                        }
                    );
                    if (results) {
                        safePostMessageToView(this._view, {
                            command: "searchResults",
                            data: results,
                        });
                    }
                } catch (error) {
                    console.error("Error searching cells:", error);
                }
                break;

            case "replaceCell":
                try {
                    const { cellId, newContent, selectedFiles } = message;

                    const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                        "codex-editor-extension.getTranslationPairFromProject",
                        cellId,
                        { isParallelPassagesWebview: true }
                    );

                    if (!translationPair || !translationPair.targetCell.uri) {
                        vscode.window.showErrorMessage(`Could not find target cell for ${cellId}`);
                        return;
                    }

                    const targetUri = translationPair.targetCell.uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
                    
                    // Check if cell is in selected files (if files are selected)
                    if (selectedFiles && selectedFiles.length > 0) {
                        try {
                            const cellFileUri = vscode.Uri.parse(targetUri).toString();
                            const sourceUri = translationPair.sourceCell?.uri || "";
                            const normalizedSourceUri = sourceUri ? vscode.Uri.parse(sourceUri).toString() : "";
                            
                            // Check if either source or target file is selected
                            const isSelected = selectedFiles.some((selectedUri: string) => {
                                try {
                                    const normalizedSelected = vscode.Uri.parse(selectedUri).toString();
                                    return cellFileUri === normalizedSelected || normalizedSourceUri === normalizedSelected;
                                } catch {
                                    return targetUri === selectedUri || sourceUri === selectedUri;
                                }
                            });
                            
                            if (!isSelected) {
                                // Skip replacement if file is not selected
                                return;
                            }
                        } catch (error) {
                            console.error("Error checking file selection:", error);
                            // Continue with replacement if we can't parse URIs
                        }
                    }

                    const provider = CodexCellEditorProvider.getInstance();
                    if (!provider) {
                        vscode.window.showErrorMessage("Codex editor provider not available");
                        return;
                    }

                    const success = await provider.updateCellContentDirect(targetUri, cellId, newContent);

                    if (success) {
                        // Flush index writes to ensure search results update immediately
                        const { getSQLiteIndexManager } = await import("../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
                        const indexManager = getSQLiteIndexManager();
                        if (indexManager) {
                            await indexManager.flushPendingWrites();
                        }

                        const updatedPair: TranslationPair = {
                            ...translationPair,
                            targetCell: {
                                ...translationPair.targetCell,
                                content: newContent,
                            },
                        };

                        safePostMessageToView(this._view, {
                            command: "cellReplaced",
                            data: { cellId, translationPair: updatedPair },
                        });
                    }
                } catch (error) {
                    console.error("Error replacing cell:", error);
                    vscode.window.showErrorMessage(`Failed to replace cell: ${error}`);
                }
                break;

            case "replaceAll":
                try {
                    const replacements = message.replacements || [];
                    const selectedFiles = message.selectedFiles || [];

                    const provider = CodexCellEditorProvider.getInstance();
                    if (!provider) {
                        vscode.window.showErrorMessage("Codex editor provider not available");
                        return;
                    }

                    let successCount = 0;
                    const updatedPairs: TranslationPair[] = [];

                    for (const replacement of replacements) {
                        try {
                            const { cellId, newContent } = replacement;
                            
                            const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                                "codex-editor-extension.getTranslationPairFromProject",
                                cellId,
                                { isParallelPassagesWebview: true }
                            );

                            if (!translationPair || !translationPair.targetCell.uri) {
                                continue;
                            }

                            const targetUri = translationPair.targetCell.uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
                            
                            // Check if cell is in selected files (if files are selected)
                            if (selectedFiles && selectedFiles.length > 0) {
                                try {
                                    const cellFileUri = vscode.Uri.parse(targetUri).toString();
                                    const sourceUri = translationPair.sourceCell?.uri || "";
                                    const normalizedSourceUri = sourceUri ? vscode.Uri.parse(sourceUri).toString() : "";
                                    
                                    // Check if either source or target file is selected
                                    const isSelected = selectedFiles.some((selectedUri: string) => {
                                        try {
                                            const normalizedSelected = vscode.Uri.parse(selectedUri).toString();
                                            return cellFileUri === normalizedSelected || normalizedSourceUri === normalizedSelected;
                                        } catch {
                                            return targetUri === selectedUri || sourceUri === selectedUri;
                                        }
                                    });
                                    
                                    if (!isSelected) {
                                        // Skip replacement if file is not selected
                                        continue;
                                    }
                                } catch (error) {
                                    console.error("Error checking file selection:", error);
                                    // Continue with replacement if we can't parse URIs
                                }
                            }
                            const success = await provider.updateCellContentDirect(targetUri, cellId, newContent);

                            if (success) {
                                successCount++;
                                const updatedPair: TranslationPair = {
                                    ...translationPair,
                                    targetCell: {
                                        ...translationPair.targetCell,
                                        content: newContent,
                                    },
                                };
                                updatedPairs.push(updatedPair);
                            }
                        } catch (error) {
                            console.error(`Error replacing cell ${replacement.cellId}:`, error);
                        }
                    }

                    // Flush index writes after all replacements to ensure search results update immediately
                    const { getSQLiteIndexManager } = await import("../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
                    const indexManager = getSQLiteIndexManager();
                    if (indexManager) {
                        await indexManager.flushPendingWrites();
                    }

                    vscode.window.showInformationMessage(`Replaced ${successCount} of ${replacements.length} cells`);

                    if (updatedPairs.length > 0) {
                        safePostMessageToView(this._view, {
                            command: "cellsReplaced",
                            data: updatedPairs,
                        });
                    }
                } catch (error) {
                    console.error("Error replacing all cells:", error);
                    vscode.window.showErrorMessage(`Failed to replace cells: ${error}`);
                }
                break;

            default:
                console.log(`Unknown command: ${message.command}`);
        }
    }
}
