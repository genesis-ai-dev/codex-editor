import * as vscode from 'vscode';

export class WordSuggestionProvider implements vscode.CompletionItemProvider {
    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        // Check if the character before the cursor is a space
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        if (!linePrefix.endsWith(' ')) {
            return undefined;
        }

        const completionItem = new vscode.CompletionItem('hello');
        completionItem.kind = vscode.CompletionItemKind.Text;
        completionItem.detail = 'Suggested word';
        
        return [completionItem];
    }
}

export function registerWordSuggestionProvider(context: vscode.ExtensionContext) {
    const provider = new WordSuggestionProvider();
    const disposable = vscode.languages.registerCompletionItemProvider('scripture', provider, ' ');
    context.subscriptions.push(disposable);
}
