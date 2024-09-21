import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export function registerClientCommands(
    context: vscode.ExtensionContext,
    client: LanguageClient
): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.commands.registerCommand(
            "translators-copilot.spellCheckText",
            async (text: string) => {
                if (client) {
                    console.log("CLIENT: Sending spellcheck/check request:", { text });
                    return client.sendRequest("spellcheck/check", { text });
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand(
            "translators-copilot.getSimilarWords",
            async (word: string) => {
                if (client) {
                    return client.sendRequest("server.getSimilarWords", [word]);
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand(
            "spellcheck.addWord",
            async (word: string) => {
                console.log("spellcheck.addWord", { word });
                if (client) {
                    console.log("sending request inside addWord");
                    return client.sendRequest("spellcheck/addWord", { word });
                }
            }
        )
    );

    // Add all disposables to the extension context
    context.subscriptions.push(...disposables);

    // Return a disposable that will dispose of all registered commands
    return {
        dispose: () => {
            disposables.forEach((d) => d.dispose());
        },
    };
}

async function getLanguageClient(): Promise<LanguageClient | undefined> {
    const extension = vscode.extensions.getExtension("codex-editor-extension");
    if (extension) {
        if (!extension.isActive) {
            await extension.activate();
        }
        return extension.exports.languageClient;
    }
    return undefined;
}
