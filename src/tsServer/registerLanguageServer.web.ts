import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    CloseAction,
    ErrorAction,
} from "vscode-languageclient/browser";
import { NOTEBOOK_TYPE } from "../utils/codexNotebookUtils";

let client: LanguageClient | undefined;

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

    console.log("Registering the Codex Copilot Language Server (Web)...");
    
    // Get the web worker script URI
    const serverMain = vscode.Uri.joinPath(context.extensionUri, 'out/server.js');

    const clientOptions: LanguageClientOptions = {
        documentSelector: [
            { notebook: NOTEBOOK_TYPE, language: "*" },
            { scheme: "file", pattern: "**/*.codex" },
        ],
        synchronize: {
            fileEvents: vscode.workspace.createFileSystemWatcher("**/*.{dictionary,codex,source}"),
        },
        errorHandler: {
            error: () => ({ action: ErrorAction.Continue }),
            closed: () => ({ action: CloseAction.Restart })
        }
    };

    // Create language client
    client = new LanguageClient(
        "codexCopilotLanguageServer",
        "Codex Copilot Language Server",
        clientOptions,
        new Worker(serverMain.toString()) // Create worker directly
    );

    console.log("Attempting to start the Codex Copilot Language Server (Web)...");
    try {
        await client.start();
        context.subscriptions.push(
            client.onDidChangeState((e) => {
                console.log(`Language Client State Changed: ${e.oldState} -> ${e.newState}`);
            })
        );
        
        client.onNotification("custom/dictionaryUpdated", () => {
            vscode.commands.executeCommand("dictionaryTable.dictionaryUpdated");
        });
        
        console.log("Codex Copilot Language Server (Web) started successfully.");
    } catch (error) {
        console.error("Failed to start the Codex Copilot Language Server (Web):", error);
        
        // Attempt to restart the server
        try {
            if (client) {
                await client.stop();
                await new Promise((resolve) => setTimeout(resolve, 1000));
                await client.start();
                console.log("Codex Copilot Language Server (Web) restarted successfully.");
            }
        } catch (restartError: any) {
            console.error("Failed to restart the Codex Copilot Language Server (Web):", restartError);
            client = undefined;
        }
    }

    return client;
}

export function deactivate(): Thenable<void> | undefined {
    if (!client) {
        console.log("No Codex Copilot Language Server client to stop.");
        return undefined;
    }
    console.log("Stopping Codex Copilot Language Server (Web)...");
    return client.stop().then(
        () => console.log("Codex Copilot Language Server (Web) stopped successfully."),
        (error) => console.error("Error stopping Codex Copilot Language Server (Web):", error)
    );
} 