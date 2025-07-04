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
                if (!client) {
                    console.error("[Language Server] spellCheckText failed: Language server client is not available - this indicates a language server initialization failure");
                    // Return structure that consumers expect
                    return { corrections: [], matches: [] };
                }

                try {
                    return await client.sendRequest("spellcheck/check", { text, cellId });
                } catch (error) {
                    console.error("[Language Server] spellCheckText request failed:", {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        text: text.substring(0, 100), // Log first 100 chars for debugging
                        cellId,
                        clientState: client ? "initialized" : "not_initialized"
                    });
                    // Return safe fallback
                    return { corrections: [], matches: [] };
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand(
            "codex-editor-extension.alertCodes",
            async (args: GetAlertCodes): Promise<AlertCodesServerResponse> => {
                if (!client) {
                    console.error("[Language Server] alertCodes failed: Language server client is not available - this indicates a language server initialization failure", {
                        requestedCells: args.length,
                        cellIds: args.map(arg => arg.cellId)
                    });
                    // Return safe fallback maintaining expected structure
                    return args.map((arg) => ({
                        code: 0, // 0 = no alerts (safe fallback)
                        cellId: arg.cellId,
                        savedSuggestions: { suggestions: [] },
                    }));
                }

                try {
                    return await client.sendRequest<AlertCodesServerResponse>(
                        "spellcheck/getAlertCodes",
                        args
                    );
                } catch (error) {
                    console.error("[Language Server] alertCodes request failed:", {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        requestedCells: args.length,
                        cellIds: args.map(arg => arg.cellId),
                        clientState: client ? "initialized" : "not_initialized"
                    });
                    // Return safe fallback for all requested cells
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
                if (!client) {
                    console.error("[Language Server] getSimilarWords failed: Language server client is not available - this indicates a language server initialization failure", {
                        word
                    });
                    return [];
                }

                try {
                    return await client.sendRequest("server.getSimilarWords", [word]);
                } catch (error) {
                    console.error("[Language Server] getSimilarWords request failed:", {
                        error: error instanceof Error ? error.message : String(error),
                        stack: error instanceof Error ? error.stack : undefined,
                        word,
                        clientState: client ? "initialized" : "not_initialized"
                    });
                    return [];
                }
            }
        )
    );

    disposables.push(
        vscode.commands.registerCommand("spellcheck.addWord", async (words: string | string[]) => {
            console.log("spellcheck.addWord command executed", { words });

            if (!client) {
                console.error("[Language Server] addWord failed: Language server client is not available - this indicates a language server initialization failure", {
                    words: Array.isArray(words) ? words : [words]
                });
                vscode.window.showErrorMessage("Cannot add word to dictionary: Spellcheck service is not available due to language server issues");
                return;
            }

            const wordsArray = Array.isArray(words) ? words : [words];
            console.log("sending request to language server");

            try {
                const response = await client.sendRequest("spellcheck/addWord", {
                    words: wordsArray,
                });
                console.log("Add word response from language server:", response);
            } catch (error) {
                console.error("[Language Server] addWord request failed:", {
                    error: error instanceof Error ? error.message : String(error),
                    stack: error instanceof Error ? error.stack : undefined,
                    words: wordsArray,
                    clientState: client ? "initialized" : "not_initialized"
                });
                vscode.window.showErrorMessage(`Failed to add word to dictionary: ${error instanceof Error ? error.message : String(error)}`);
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
