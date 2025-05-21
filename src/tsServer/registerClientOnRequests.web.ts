import { LanguageClient } from "vscode-languageclient/browser";
import * as vscode from "vscode";

// Define message types
export const CustomRequests = {
    CheckWord: "custom/checkWord",
    GetSuggestions: "custom/getSuggestions",
    AddWords: "custom/addWords",
} as const;

// For web environment, we'll implement a simplified version
export default function registerClientOnRequests(
    context: vscode.ExtensionContext,
    client: LanguageClient
): vscode.Disposable {
    // Register the handlers
    client.onRequest(
        "workspace/executeCommand",
        async (params: { command: string; args: any[] }) => {
            try {
                // Execute the command in the main extension context
                const result = await vscode.commands.executeCommand(params.command, ...params.args);
                return result;
            } catch (error) {
                console.error("Error executing command (web):", error);
                throw error;
            }
        }
    );
    
    // Note: The dictionary operations (CheckWord, GetSuggestions, AddWords)
    // will need a web-compatible implementation for storing and accessing
    // dictionary data. For now, we'll return placeholder responses.
    
    client.onRequest(
        CustomRequests.CheckWord,
        async ({ word, caseSensitive = false }: { word: string; caseSensitive: boolean }) => {
            console.log("CheckWord request in web environment:", word);
            // In a real implementation, this would check against a web-compatible storage
            return { exists: false, webEnvironment: true };
        }
    );
    
    client.onRequest(CustomRequests.GetSuggestions, async (word: string) => {
        console.log("GetSuggestions request in web environment:", word);
        // In a real implementation, this would provide suggestions from a web-compatible storage
        return [];
    });
    
    client.onRequest(CustomRequests.AddWords, async (words: string[]) => {
        console.log("AddWords request in web environment:", words);
        // In a real implementation, this would add words to a web-compatible storage
        return true;
    });
    
    // Return a disposable to clean up the handlers
    return {
        dispose: () => {
            // No specific cleanup needed
        }
    };
} 