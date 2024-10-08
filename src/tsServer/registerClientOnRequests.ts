import { LanguageClient } from "vscode-languageclient/node";
import * as vscode from "vscode";

export default function registerClientOnRequests(client: LanguageClient) {
    // FIXME: This needs a better/cooler name.
    client.onRequest(
        "workspace/executeCommand",
        async (params: { command: string; args: any[] }) => {
            try {
                // Execute the command in the main extension context
                const result = await vscode.commands.executeCommand(params.command, ...params.args);
                return result;
            } catch (error) {
                console.error("Error executing command:", error);
                throw error;
            }
        }
    );
}
