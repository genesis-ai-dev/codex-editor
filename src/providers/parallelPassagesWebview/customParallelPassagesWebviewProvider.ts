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

    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case "openFileAtLocation":
                await this.openFileAtLocation(message.uri, message.word);
                break;
            case "requestPinning":
                await this.pinCellById(message.content.cellId);
                break;
            case "search":
                try {
                    const replaceMode = !!(message.replaceText && message.replaceText.trim());
                    const command = message.completeOnly
                        ? "codex-editor-extension.searchParallelCells"
                        : "codex-editor-extension.searchAllCells";

                    const results = await vscode.commands.executeCommand<TranslationPair[]>(
                        command,
                        message.query,
                        15, // k value
                        message.completeOnly ? false : true, // includeIncomplete for searchAllCells
                        false, // showInfo
                        { 
                            isParallelPassagesWebview: true,
                            replaceMode: replaceMode // Pass replace mode flag
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
                    const { cellId, newContent } = message;

                    const translationPair = await vscode.commands.executeCommand<TranslationPair>(
                        "codex-editor-extension.getTranslationPairFromProject",
                        cellId,
                        { isParallelPassagesWebview: true }
                    );

                    if (!translationPair || !translationPair.targetCell.uri) {
                        vscode.window.showErrorMessage(`Could not find target cell for ${cellId}`);
                        return;
                    }

                    const provider = CodexCellEditorProvider.getInstance();
                    if (!provider) {
                        vscode.window.showErrorMessage("Codex editor provider not available");
                        return;
                    }

                    const targetUri = translationPair.targetCell.uri.replace(".source", ".codex").replace(".project/sourceTexts/", "files/target/");
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
