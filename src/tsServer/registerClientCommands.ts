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
                    return client.sendRequest("server.getSimilarWords", [
                        word,
                    ]);
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand("spellcheck.addWord", async (words: string | string[]) => {
            console.log("spellcheck.addWord", { words });
            if (client) {
                console.log("sending request inside addWord");
                const wordsArray = Array.isArray(words) ? words : [words];
                return client.sendRequest("spellcheck/addWord", { words: wordsArray });
            }
        })
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
