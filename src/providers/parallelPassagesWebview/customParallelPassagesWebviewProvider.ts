import * as vscode from "vscode";
import {
    GlobalMessage,
    TranslationPair,
} from "../../../types";
import { BaseWebviewProvider } from "../../globalProvider";
import { safePostMessageToView } from "../../utils/webviewUtils";
import { CodexCellEditorProvider } from "../codexCellEditorProvider/codexCellEditorProvider";
import { updateWorkspaceState } from "../../utils/workspaceEventListener";

function normalizeUri(uri: string): string {
    if (!uri) return "";
    try {
        return vscode.Uri.parse(uri).toString();
    } catch {
        return uri;
    }
}

function isCellInSelectedFiles(pair: TranslationPair, selectedFiles: string[]): boolean {
    if (!selectedFiles || selectedFiles.length === 0) return true;

    const sourceUri = pair.sourceCell?.uri || "";
    const targetUri = pair.targetCell?.uri || "";
    const normalizedSource = normalizeUri(sourceUri);
    const normalizedTarget = normalizeUri(targetUri);

    return selectedFiles.some(selectedUri => {
        const normalizedSelected = normalizeUri(selectedUri);
        return normalizedSource === normalizedSelected || normalizedTarget === normalizedSelected;
    });
}



export class CustomWebviewProvider extends BaseWebviewProvider {
    // Pending search data to send when webview becomes ready
    private pendingSearchData: { query: string; replaceText?: string } | null = null;
    // Pending flag to enable replace mode when webview becomes ready
    private pendingEnableReplace: boolean = false;
    // Track whether webview has signaled ready
    private _isWebviewReady: boolean = false;

    protected getWebviewId(): string {
        return "search-passages-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["ParallelView", "index.js"];
    }

    // Set pending search data to be sent when webview is ready
    // If webview is already ready, sends immediately
    public setPendingSearch(query: string, replaceText?: string): void {
        this.pendingSearchData = { query, replaceText };
        if (this._isWebviewReady) {
            this.sendPendingSearch();
        }
    }

    // Set pending flag to enable replace mode when webview is ready
    // If webview is already ready, sends immediately
    public setPendingEnableReplace(): void {
        this.pendingEnableReplace = true;
        if (this._isWebviewReady) {
            this.sendPendingEnableReplace();
        }
    }

    // Send pending search data to webview and clear it
    private sendPendingSearch(): void {
        if (this.pendingSearchData && this._view?.webview) {
            safePostMessageToView(this._view, {
                command: "populateSearch",
                query: this.pendingSearchData.query,
                replaceText: this.pendingSearchData.replaceText,
            });
            this.pendingSearchData = null;
        }
    }

    // Send enable replace message to webview and clear flag
    private sendPendingEnableReplace(): void {
        if (this.pendingEnableReplace && this._view?.webview) {
            safePostMessageToView(this._view, {
                command: "enableReplace",
            });
            this.pendingEnableReplace = false;
        }
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

    private async getProjectFiles(): Promise<Array<{ uri: string; name: string; type: "source" | "target"; }>> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) {
                return [];
            }

            const [sourceFileUris, codexFileUris] = await Promise.all([
                vscode.workspace.findFiles(".project/sourceTexts/*.source"),
                vscode.workspace.findFiles("files/target/*.codex")
            ]);

            const files: Array<{ uri: string; name: string; type: "source" | "target"; }> = [];

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

    // Reset ready state when webview is recreated
    protected onWebviewResolved(): void {
        this._isWebviewReady = false;
    }

    // Override the onWebviewReady hook to send pending data
    protected onWebviewReady(): void {
        this._isWebviewReady = true;
        this.sendPendingSearch();
        this.sendPendingEnableReplace();
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
                    const searchScope = message.searchScope || "both";
                    const selectedFiles = message.selectedFiles || [];
                    const completeOnly = message.completeOnly || false;

                    // Include incomplete (source-only) cells when:
                    // 1. completeOnly is unchecked, OR
                    // 2. searching source scope specifically
                    const includeIncomplete = !completeOnly || searchScope === "source";

                    const results = await vscode.commands.executeCommand<TranslationPair[]>(
                        "codex-editor-extension.searchAllCells",
                        message.query,
                        500, // Max results
                        includeIncomplete,
                        false, // showInfo
                        {
                            isParallelPassagesWebview: true,
                            searchScope: searchScope,
                            selectedFiles: selectedFiles,
                            completeOnly: completeOnly,
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
                    const { cellId, newContent, selectedFiles, retainValidations = false } = message;

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

                    if (!isCellInSelectedFiles(translationPair, selectedFiles)) {
                        return;
                    }

                    const provider = CodexCellEditorProvider.getInstance();
                    if (!provider) {
                        vscode.window.showErrorMessage("Codex editor provider not available");
                        return;
                    }

                    const success = await provider.updateCellContentDirect(targetUri, cellId, newContent, retainValidations);

                    if (success) {
                        // Re-index the cell to update search index
                        const { getSQLiteIndexManager } = await import("../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
                        const indexManager = getSQLiteIndexManager();
                        if (indexManager) {
                            // Wait for the document save to complete
                            await new Promise(resolve => setTimeout(resolve, 200));
                            // Index the specific file to update search results
                            await vscode.commands.executeCommand("codex-editor-extension.indexSpecificFiles", [targetUri]);
                            // Wait for indexing to complete
                            await new Promise(resolve => setTimeout(resolve, 300));
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
                            data: { cellId, translationPair: updatedPair, success: true, shouldReSearch: true },
                        });
                    } else {
                        safePostMessageToView(this._view, {
                            command: "cellReplaced",
                            data: { cellId, success: false, error: "Failed to update cell content" },
                        });
                    }
                } catch (error) {
                    console.error("Error replacing cell:", error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    safePostMessageToView(this._view, {
                        command: "cellReplaced",
                        data: { cellId: message.cellId, success: false, error: errorMessage },
                    });
                }
                break;

            case "showErrorMessage":
                vscode.window.showErrorMessage(message.message || "An error occurred");
                break;

            case "replaceAll":
                try {
                    const replacements = message.replacements || [];
                    const selectedFiles = message.selectedFiles || [];
                    const skippedCount = message.skippedCount || 0;
                    const retainValidations = message.retainValidations || false;

                    const provider = CodexCellEditorProvider.getInstance();
                    if (!provider) {
                        safePostMessageToView(this._view, {
                            command: "replaceAllComplete",
                            data: { successCount: 0, totalCount: replacements.length, errors: ["Codex editor provider not available"] },
                        });
                        return;
                    }

                    let successCount = 0;
                    const updatedPairs: TranslationPair[] = [];
                    const errors: Array<{ cellId: string; error: string; }> = [];

                    for (const replacement of replacements) {
                        try {
                            const { cellId, newContent } = replacement;

                            const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                                "codex-editor-extension.getTranslationPairFromProject",
                                cellId,
                                { isParallelPassagesWebview: true }
                            );

                            if (!translationPair || !translationPair.targetCell.uri) {
                                errors.push({ cellId, error: "Cell not found" });
                                continue;
                            }

                            const targetUri = translationPair.targetCell.uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");

                            if (!isCellInSelectedFiles(translationPair, selectedFiles)) {
                                continue;
                            }

                            const success = await provider.updateCellContentDirect(targetUri, cellId, newContent, retainValidations);

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

                                safePostMessageToView(this._view, {
                                    command: "replaceAllProgress",
                                    data: { completed: successCount, total: replacements.length },
                                });
                            } else {
                                errors.push({ cellId, error: "Failed to update cell content" });
                            }
                        } catch (error) {
                            const errorMessage = error instanceof Error ? error.message : String(error);
                            console.error(`Error replacing cell ${replacement.cellId}:`, error);
                            errors.push({ cellId: replacement.cellId, error: errorMessage });
                        }
                    }

                    // Re-index all modified files and flush writes after all replacements
                    const { getSQLiteIndexManager } = await import("../../activationHelpers/contextAware/contentIndexes/indexes/sqliteIndexManager");
                    const indexManager = getSQLiteIndexManager();
                    if (indexManager) {
                        // Collect unique target URIs that were modified
                        const modifiedUris = new Set<string>();
                        for (const replacement of replacements) {
                            try {
                                const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                                    "codex-editor-extension.getTranslationPairFromProject",
                                    replacement.cellId,
                                    { isParallelPassagesWebview: true }
                                );
                                if (translationPair?.targetCell.uri) {
                                    const targetUri = translationPair.targetCell.uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
                                    modifiedUris.add(targetUri);
                                }
                            } catch (error) {
                                // Skip if we can't get the URI
                            }
                        }

                        // Wait a bit for all saves to complete
                        await new Promise(resolve => setTimeout(resolve, 200));

                        // Re-index all modified files
                        if (modifiedUris.size > 0) {
                            await vscode.commands.executeCommand("codex-editor-extension.indexSpecificFiles", Array.from(modifiedUris));
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }

                        await indexManager.flushPendingWrites();
                    }

                    // Show info message if some matches were skipped
                    if (skippedCount > 0) {
                        vscode.window.showInformationMessage(
                            `Replaced ${successCount} match(es). ${skippedCount} match(es) skipped (interrupted by HTML tags).`
                        );
                    }

                    safePostMessageToView(this._view, {
                        command: "replaceAllComplete",
                        data: { successCount, totalCount: replacements.length, updatedPairs, errors },
                    });
                } catch (error) {
                    console.error("Error replacing all cells:", error);
                    const errorMessage = error instanceof Error ? error.message : String(error);
                    safePostMessageToView(this._view, {
                        command: "replaceAllComplete",
                        data: { successCount: 0, totalCount: 0, errors: [errorMessage] },
                    });
                }
                break;

            default:
                console.log(`Unknown command: ${message.command}`);
        }
    }
}
