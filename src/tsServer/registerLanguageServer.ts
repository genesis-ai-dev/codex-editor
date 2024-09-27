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
    const config = vscode.workspace.getConfiguration("translators-copilot-server");
    const isCopilotEnabled = config.get<boolean>("enable", true);
    if (!isCopilotEnabled) {
        vscode.window.showInformationMessage(
            "Translators Copilot Server is disabled. Project was not indexed."
        );
        return;
    }

    console.log("Registering the Codex Copilot Language Server...");
    const serverModule = context.asAbsolutePath("out/server.js");
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
        // Let's only select the Codex Notebooks to get language server features
        documentSelector: [
            { notebook: NOTEBOOK_TYPE, language: "*" },
            { scheme: "file", pattern: "**/*.codex" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{dictionary,codex,source}"),
        },
    };

    console.log("Creating the Codex Copilot Language Server client...");
    const client = new LanguageClient(
        "codexCopilotLanguageServer",
        "Codex Copilot Language Server",
        serverOptions,
        clientOptions
    );

    console.log("Attempting to start the Codex Copilot Language Server...");
    try {
        await client.start().then(() => {
            context.subscriptions.push(client);
            // Listen for custom notifications from the server
            client.onNotification("custom/dictionaryUpdated", () => {
                vscode.commands.executeCommand("dictionaryTable.dictionaryUpdated");
            });
            console.log("Codex Copilot Language Server started successfully.");
        });
    } catch (error) {
        console.error("Failed to start the Codex Copilot Language Server:", error);
        console.error("Server module path:", serverModule);
        console.error("Client options:", JSON.stringify(clientOptions, null, 2));
        vscode.window.showErrorMessage(`Failed to start Codex Copilot Language Server: ${error}`);

        // Attempt to restart the server
        console.log("Attempting to restart the Codex Copilot Language Server...");
        try {
            await client.stop();
            await new Promise((resolve) => setTimeout(resolve, 1000)); // Wait for 1 second
            await client.start();
            console.log("Codex Copilot Language Server restarted successfully.");
            context.subscriptions.push(client);
        } catch (restartError: any) {
            console.error("Failed to restart the Codex Copilot Language Server:", restartError);
            vscode.window.showErrorMessage(
                `Failed to restart Codex Copilot Language Server: ${restartError.message}`
            );
        }
    }

    return client;
}

export function deactivate(client: LanguageClient): Thenable<void> | undefined {
    if (!client) {
        console.log("No Codex Copilot Language Server client to stop.");
        return undefined;
    }
    console.log("Stopping Codex Copilot Language Server...");
    return client.stop().then(
        () => console.log("Codex Copilot Language Server stopped successfully."),
        (error) => console.error("Error stopping Codex Copilot Language Server:", error)
    );
}
