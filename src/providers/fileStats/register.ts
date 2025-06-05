import * as vscode from "vscode";
import { FileStatsWebviewProvider } from "./FileStatsWebviewProvider";
import { FileInfo } from "../../activationHelpers/contextAware/contentIndexes/indexes/filesIndex";

let provider: FileStatsWebviewProvider;
let isRegistered = false;

export function registerFileStatsWebviewProvider(
    context: vscode.ExtensionContext,
    filesIndex: Map<string, FileInfo>
): FileStatsWebviewProvider {
    // If already registered, just update the provider and return
    if (isRegistered && provider) {
        provider.updateFilesIndex(filesIndex);
        return provider;
    }

    provider = new FileStatsWebviewProvider(context.extensionUri, filesIndex);

    // Register a command to show the file stats panel
    context.subscriptions.push(
        vscode.commands.registerCommand("translators-copilot.showFileStatsView", () => {
            provider.show();
            return true;
        })
    );

    // Register a command to refresh the file stats
    context.subscriptions.push(
        vscode.commands.registerCommand("translators-copilot.refreshFileStats", async () => {
            vscode.commands.executeCommand("translators-copilot.forceReindex");
        })
    );

    isRegistered = true;
    return provider;
}

export function updateFileStatsWebview(filesIndex: Map<string, FileInfo>): void {
    if (provider) {
        provider.updateFilesIndex(filesIndex);
    }
}
