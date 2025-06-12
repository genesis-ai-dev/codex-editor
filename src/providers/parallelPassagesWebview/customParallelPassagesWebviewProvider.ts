import * as vscode from "vscode";
import {
    GlobalMessage,
    TranslationPair,
} from "../../../types";
import { BaseWebviewProvider } from "../../globalProvider";

async function openFileAtLocation(uri: string, cellId: string) {
    try {
        const parsedUri = vscode.Uri.parse(uri);
        const stringUri = parsedUri.toString();
        // This is a quick fix to open the correct uri.
        if (stringUri.includes(".codex") || stringUri.includes(".source")) {
            await vscode.commands.executeCommand("vscode.openWith", parsedUri, "codex.cellEditor");
            // After opening the file, we need to navigate to the specific cell
            // This might require an additional step or command
            // For example:
            // await vscode.commands.executeCommand("codex.navigateToCell", cellId);
        }
    } catch (error) {
        console.error(`Failed to open file: ${uri}`, error);
        vscode.window.showErrorMessage(`Failed to open file: ${uri}`);
    }
}



export class CustomWebviewProvider extends BaseWebviewProvider {
    protected getWebviewId(): string {
        return "parallel-passages-sidebar";
    }

    protected getScriptPath(): string[] {
        return ["ParallelView", "index.js"];
    }

    public async pinCellById(cellId: string, retryCount = 0) {
        const maxRetries = 3;
        const retryDelay = 300; // milliseconds

        // First, ensure the webview is visible
        console.log("pinCellByIdProvider", cellId);
        await vscode.commands.executeCommand("parallel-passages-sidebar.focus");

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
                cellId
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

            this._view.webview.postMessage({
                command: "pinCell",
                data: translationPair,
            });
        } else {
            vscode.window.showErrorMessage("Failed to open parallel passages view");
        }
    }

    protected async handleMessage(message: any): Promise<void> {
        switch (message.command) {
            case "openFileAtLocation":
                await openFileAtLocation(message.uri, message.word);
                break;
            case "requestPinning":
                await this.pinCellById(message.content.cellId);
                break;
            case "search":
                try {
                    const command = message.completeOnly
                        ? "codex-editor-extension.searchParallelCells"
                        : "codex-editor-extension.searchAllCells";

                    const results = await vscode.commands.executeCommand<TranslationPair[]>(
                        command,
                        message.query,
                        15, // k value
                        message.completeOnly ? false : true, // includeIncomplete for searchAllCells
                        false, // showInfo
                        { isParallelPassagesWebview: true } // options to get raw content for HTML display
                    );
                    if (results) {
                        this._view!.webview.postMessage({
                            command: "searchResults",
                            data: results,
                        });
                    }
                } catch (error) {
                    console.error("Error searching cells:", error);
                }
                break;

            default:
                console.log(`Unknown command: ${message.command}`);
        }
    }
}
