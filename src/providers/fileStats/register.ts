import * as vscode from "vscode";
import { FileStatsWebviewProvider } from "./FileStatsWebviewProvider";
import { FileInfo } from "../../activationHelpers/contextAware/miniIndex/indexes/filesIndex";

let provider: FileStatsWebviewProvider;

export function registerFileStatsWebviewProvider(
    context: vscode.ExtensionContext,
    filesIndex: Map<string, FileInfo>
): FileStatsWebviewProvider {
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

    return provider;
}

export function updateFileStatsWebview(filesIndex: Map<string, FileInfo>): void {
    if (provider) {
        provider.updateFilesIndex(filesIndex);
    }
}
