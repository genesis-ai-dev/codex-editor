import vscode from "vscode";
import { CodexCellEditorProvider } from "./providers/codexCellEditorProvider/codexCellEditorProvider";
import { CustomWebviewProvider } from "./providers/parallelPassagesWebview/customParallelPassagesWebviewProvider";
import { GlobalContentType, GlobalMessage } from "../types";

export class GlobalProvider {
    private static instance: GlobalProvider;
    private providers: Map<string, CodexCellEditorProvider | CustomWebviewProvider>;

    private constructor() {
        this.providers = new Map();
    }

    public static getInstance(): GlobalProvider {
        if (!GlobalProvider.instance) {
            GlobalProvider.instance = new GlobalProvider();
        }
        return GlobalProvider.instance;
    }

    public registerProvider(
        key: string,
        provider: CodexCellEditorProvider | CustomWebviewProvider
    ): void {
        console.log("registering provider: ", { key, provider });
        this.providers.set(key, provider);
    }
    public handleMessage(message: any) {
        if ("destination" in message) {
            console.log("routing message: ", { message });
            const destination = message.destination;
            if (destination === "webview") {
                this.postMessageToAllWebviews(message);
            } else if (destination === "provider") {
                this.postMessageToAllProviders(message);
            }
        }
    }
    public postMessageToAllProviders(message: any) {
        this.providers.forEach((provider, key) => {
            provider.receiveMessage(message);
        });
    }
    public postMessageToAllWebviews({
        command,
        content,
    }: {
        command: string;
        content: GlobalContentType;
    }): void {
        // Implement logic to post message to all webviews
        // This is a placeholder implementation
        const message: GlobalMessage = {
            command,
            destination: "all",
            content,
        };
        console.log("Posting message to all webviews:", message);
        this.providers.forEach((provider, key) => {
            provider.postMessage(message);
        });
    }
    public async openWebview(key: string): Promise<void> {
        // This is only really relevant to panels
        try {
            // Check if the command exists before executing it
            const allCommands = await vscode.commands.getCommands();
            const focusCommand = `${key}.focus`;
            if (allCommands.includes(focusCommand)) {
                await vscode.commands.executeCommand(focusCommand);
            } else {
                console.warn(`Command '${focusCommand}' not found. Skipping focus.`);
            }
        } catch (error) {
            console.error(`Error opening webview: ${error}`);
        }
    }

    public async openAndPostMessageToWebview({
        key,
        command,
        destination,
        content,
    }: {
        key: string;
        command: string;
        destination: "webview" | "provider" | "all";
        content: GlobalContentType;
    }): Promise<void> {
        const message: GlobalMessage = {
            command,
            destination,
            content,
        };
        await this.openWebview(key);

        // Check for it to be open
        if (this.providers.has(key)) {
            this.providers.get(key)?.postMessage(message);
            console.log(
                `post: Message posted to webview with key: ${key} and message: ${JSON.stringify(message)}`
            );
        } else {
            throw new Error(`Webview with key '${key}' not found.`);
        }
    }
}
