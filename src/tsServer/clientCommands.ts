import * as vscode from "vscode";
import { LanguageClient } from "vscode-languageclient/node";

export async function registerClientCommands(context: vscode.ExtensionContext, client: LanguageClient) {
    const spellcheckCommand = vscode.commands.registerCommand('spellcheck.checkText', async (text: string) => {
        if (client) {
            return client.sendRequest("spellcheck/check", { text });
        }
    });

    const getSimilarWordsCommand = vscode.commands.registerCommand(
        "server.getSimilarWords",
        async (word: string) => {
            const client = await getLanguageClient();
            if (client) {
                return client.sendRequest(
                    "server.getSimilarWords",
                    [word],
                );
            }
        },
    );

    const addWordCommand = vscode.commands.registerCommand(
        "spellcheck.addWord",
        async (word: string) => {
            console.log("spellcheck.addWord", { word });
            const client = await getLanguageClient();
            if (client) {
                console.log("sending request inside addWord");
                return client.sendRequest("spellcheck/addWord", { word });
            }
        },
    );

    const existingCommands = await vscode.commands.getCommands();
    const commandsToRegister = [
        { command: spellcheckCommand, name: 'spellcheck.checkText' },
        { command: addWordCommand, name: 'spellcheck.addWord' },
        { command: getSimilarWordsCommand, name: 'server.getSimilarWords' }
    ];

    for (const { command, name } of commandsToRegister) {
        if (existingCommands.includes(name)) {
            console.warn(`Warning: Command '${name}' is already registered.`);
        } else {
            context.subscriptions.push(command);
        }
    }
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
