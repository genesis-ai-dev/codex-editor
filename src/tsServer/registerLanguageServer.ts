import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";
import { NOTEBOOK_TYPE } from "../utils/codexNotebookUtils";

export async function registerLanguageServer(
    context: vscode.ExtensionContext
): Promise<LanguageClient | undefined> {
    try {
        const config = vscode.workspace.getConfiguration("codex-editor-extension-server");
        const isCopilotEnabled = config.get<boolean>("enable", true);

        if (!isCopilotEnabled) {
            console.log("[Language Server] Language server is disabled by configuration");
            vscode.window.showInformationMessage(
                "Codex Extension Server is disabled. Project was not indexed."
            );
            return undefined;
        }

        console.log("[Language Server] Registering the Codex Copilot Language Server...");
        const serverModule = context.asAbsolutePath("out/server.js");

        // Validate server module exists
        try {
            const fs = require('fs'); // eslint-disable-line @typescript-eslint/no-var-requires
            if (!fs.existsSync(serverModule)) {
                console.error("[Language Server] Server module file not found:", {
                    expectedPath: serverModule,
                    absolutePath: context.asAbsolutePath("out/server.js")
                });
                vscode.window.showErrorMessage("Language server module not found. Please ensure the extension is properly compiled.");
                return undefined;
            }
        } catch (fsError) {
            console.error("[Language Server] Failed to validate server module existence:", {
                error: fsError instanceof Error ? fsError.message : String(fsError),
                serverModule
            });
            // Continue anyway, let the language client handle the error
        }

        const debugOptions = { execArgv: ["--nolazy", "--inspect=6009"] };

        const serverOptions: ServerOptions = {
            run: { module: serverModule, transport: TransportKind.ipc },
            debug: {
                module: serverModule,
                transport: TransportKind.ipc,
                options: debugOptions,
            },
        };

        const clientOptions: LanguageClientOptions = {
            documentSelector: [
                { notebook: NOTEBOOK_TYPE, language: "*" },
                { scheme: "file", pattern: "**/*.codex" },
            ],
            synchronize: {
                fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{dictionary,codex,source}"),
            },
        };

        console.log("[Language Server] Creating the Codex Copilot Language Server client...");
        const client = new LanguageClient(
            "codexCopilotLanguageServer",
            "Codex Copilot Language Server",
            serverOptions,
            clientOptions
        );

        console.log("[Language Server] Attempting to start the Codex Copilot Language Server...");

        try {
            await client.start();
            context.subscriptions.push(client);

            // Set up notification handlers
            try {
                client.onNotification("custom/dictionaryUpdated", () => {
                    vscode.commands.executeCommand("dictionaryTable.dictionaryUpdated");
                });
            } catch (notificationError) {
                console.error("[Language Server] Failed to register dictionary notification handler:", {
                    error: notificationError instanceof Error ? notificationError.message : String(notificationError),
                    stack: notificationError instanceof Error ? notificationError.stack : undefined
                });
                // Continue - this is not critical for basic functionality
            }

            console.log("[Language Server] Codex Copilot Language Server started successfully.");
            return client;
        } catch (startError) {
            console.error("[Language Server] Failed to start language server on first attempt:", {
                error: startError instanceof Error ? startError.message : String(startError),
                stack: startError instanceof Error ? startError.stack : undefined,
                serverModule,
                clientOptions: JSON.stringify(clientOptions, null, 2)
            });

            // Attempt to restart the server
            console.log("[Language Server] Attempting to restart the language server...");
            try {
                await client.stop();
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await client.start();

                console.log("[Language Server] Codex Copilot Language Server restarted successfully.");
                context.subscriptions.push(client);

                // Re-register notification handlers after restart
                try {
                    client.onNotification("custom/dictionaryUpdated", () => {
                        vscode.commands.executeCommand("dictionaryTable.dictionaryUpdated");
                    });
                } catch (notificationError) {
                    console.error("[Language Server] Failed to register dictionary notification handler after restart:", {
                        error: notificationError instanceof Error ? notificationError.message : String(notificationError)
                    });
                }

                return client;
            } catch (restartError) {
                console.error("[Language Server] Critical failure: Failed to restart the language server:", {
                    error: restartError instanceof Error ? restartError.message : String(restartError),
                    stack: restartError instanceof Error ? restartError.stack : undefined,
                    originalError: startError instanceof Error ? startError.message : String(startError),
                    serverModule
                });

                vscode.window.showErrorMessage(
                    "Language server failed to start. Spellcheck and smart edit features will not be available. " +
                    "Check the console for detailed error information."
                );

                return undefined;
            }
        }
    } catch (error) {
        console.error("[Language Server] Critical failure during language server registration:", {
            error: error instanceof Error ? error.message : String(error),
            stack: error instanceof Error ? error.stack : undefined,
            contextAvailable: !!context
        });

        vscode.window.showErrorMessage(
            "Failed to initialize language server. Spellcheck and smart edit features will not be available."
        );

        return undefined;
    }
}

export function deactivate(client: LanguageClient): Thenable<void> | undefined {
    if (!client) {
        console.log("[Language Server] No Codex Copilot Language Server client to stop.");
        return undefined;
    }

    console.log("[Language Server] Stopping Codex Copilot Language Server...");
    return client.stop().then(
        () => console.log("[Language Server] Codex Copilot Language Server stopped successfully."),
        (error) => {
            console.error("[Language Server] Error stopping Codex Copilot Language Server:", {
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
        }
    );
}
