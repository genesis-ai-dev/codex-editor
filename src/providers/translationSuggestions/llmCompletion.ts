import * as vscode from 'vscode';
import { CompletionConfig } from './inlineCompletionsProvider';

export function llmCompletion(document: vscode.TextDocument, position: vscode.Position, completionConfig: CompletionConfig, token: vscode.CancellationToken): Promise<string> {
    return Promise.resolve("Hello, world from llmCompletion!");
}

