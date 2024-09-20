import * as vscode from "vscode";
import {
    LanguageClient,
    LanguageClientOptions,
    ServerOptions,
    TransportKind,
} from "vscode-languageclient/node";

export async function registerLanguageServer(context: vscode.ExtensionContext, client: LanguageClient): Promise<LanguageClient> {
    console.log("Registering the Scripture Language Server...");
    const serverModule = context.asAbsolutePath("out/server.js"); // Changed from "out/tsServer/server.js"
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
            { scheme: "file", language: "*" },
            { scheme: "vscode-notebook-cell", language: "*" },
            { notebook: "codex-type", language: "*" },
        ],
        synchronize: {
            fileEvents:
                vscode.workspace.createFileSystemWatcher("**/.clientrc"),
        },
    };

    console.log("Creating the Scripture Language Server client...");
    client = new LanguageClient(
        "scriptureLanguageServer",
        "Scripture Language Server",
        serverOptions,
        clientOptions,
    );

    console.log("Attempting to start the Scripture Language Server...");
    try {
        await client.start();
        console.log("Scripture Language Server started successfully.");
        context.subscriptions.push(client);
    } catch (error) {
        console.error("Failed to start the Scripture Language Server:", error);
        console.error("Server module path:", serverModule);
        console.error("Client options:", JSON.stringify(clientOptions, null, 2));
        vscode.window.showErrorMessage(`Failed to start Scripture Language Server: ${error}`);

        // Attempt to restart the server
        console.log("Attempting to restart the Scripture Language Server...");
        try {
            await client.stop();
            await new Promise(resolve => setTimeout(resolve, 1000)); // Wait for 1 second
            await client.start();
            console.log("Scripture Language Server restarted successfully.");
            context.subscriptions.push(client);
        } catch (restartError: any) {
            console.error("Failed to restart the Scripture Language Server:", restartError);
            vscode.window.showErrorMessage(`Failed to restart Scripture Language Server: ${restartError.message}`);
        }
    }

    return client;
}

export function deactivate(client: LanguageClient): Thenable<void> | undefined {
    if (!client) {
        console.log("No Scripture Language Server client to stop.");
        return undefined;
    }
    console.log("Stopping Scripture Language Server...");
    return client.stop().then(
        () => console.log("Scripture Language Server stopped successfully."),
        error => console.error("Error stopping Scripture Language Server:", error)
    );
}
