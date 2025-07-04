import { GetAlertCodes, AlertCodesServerResponse } from "@types";
import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export function registerClientCommands(
    context: vscode.ExtensionContext,
    client: LanguageClient | undefined
): vscode.Disposable {
    const disposables: vscode.Disposable[] = [];

    disposables.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.spellCheckText",
            async (text: string, cellId: string) => {
                if (client) {
                    return client.sendRequest("spellcheck/check", { text, cellId });
                } else {
                    console.warn("Language server not available for spell check");
                    return null;
                }
            }
        )
    );
    disposables.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.alertCodes",
            async (args: GetAlertCodes): Promise<AlertCodesServerResponse> => {
                if (client) {
                    const ret = client.sendRequest<AlertCodesServerResponse>(
                        "spellcheck/getAlertCodes",
                        args
                    );

                    return ret;
                } else {
                    console.warn("Language server not available for alert codes, returning empty results");
                    // Return empty results for all cells to prevent errors
                    return args.map((arg) => ({
                        code: 0,
                        cellId: arg.cellId,
                        savedSuggestions: { suggestions: [] },
                    }));
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.getSimilarWords",
            async (word: string) => {
                if (client) {
                    return client.sendRequest("server.getSimilarWords", [word]);
                } else {
                    console.warn("Language server not available for similar words");
                    return [];
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand("spellcheck.addWord", async (words: string | string[]) => {
            console.log("spellcheck.addWord command executed", { words });
            if (client) {
                console.log("sending request to language server");
                const wordsArray = Array.isArray(words) ? words : [words];
                try {
                    const response = await client.sendRequest("spellcheck/addWord", {
                        words: wordsArray,
                    });
                    console.log("Add word response from language server:", response);
                } catch (error: any) {
                    console.error("Error sending request to language server:", error);
                    vscode.window.showErrorMessage(`Error adding word: ${error.message}`);
                }
            } else {
                console.warn("Language server is not available, cannot add word");
                vscode.window.showWarningMessage("Spellcheck service is not available");
            }
        })
    );

    context.subscriptions.push(...disposables);

    return {
        dispose: () => {
            disposables.forEach((d) => d.dispose());
        },
    };
}
