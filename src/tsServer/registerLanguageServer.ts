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
    const config = vscode.workspace.getConfiguration("codex-editor-extension-server");
    const isCopilotEnabled = config.get<boolean>("enable", true);
    if (!isCopilotEnabled) {
        vscode.window.showInformationMessage(
            "Codex Extension Server is disabled. Project was not indexed."
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
        await client.start();
        context.subscriptions.push(client);
        client.onNotification("custom/dictionaryUpdated", () => {
            vscode.commands.executeCommand("dictionaryTable.dictionaryUpdated");
        });
        console.log("Codex Copilot Language Server started successfully.");
    } catch (error) {
        console.error("Failed to start the Codex Copilot Language Server:", error);
        console.error("Server module path:", serverModule);
        console.error("Client options:", JSON.stringify(clientOptions, null, 2));
        // Attempt to restart the server
        try {
            await client.stop();
            await new Promise((resolve) => setTimeout(resolve, 1000));
            await client.start();
            console.log("Codex Copilot Language Server restarted successfully.");
            context.subscriptions.push(client);
        } catch (restartError: any) {
            console.error("Failed to restart the Codex Copilot Language Server:", restartError);
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
