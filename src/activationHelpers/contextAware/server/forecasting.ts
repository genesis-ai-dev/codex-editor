import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';

class MarkovChain {
    private chain: Map<string, Map<string, number>>;

    constructor() {
        this.chain = new Map();
    }

    addPair(word1: string, word2: string) {
        if (!this.chain.has(word1)) {
            this.chain.set(word1, new Map());
        }
        const nextWords = this.chain.get(word1)!;
        nextWords.set(word2, (nextWords.get(word2) || 0) + 1);
    }

    getNextWords(word: string): string[] {
        const nextWords = this.chain.get(word);
        if (!nextWords) return [];
        return Array.from(nextWords.entries())
            .sort((a, b) => b[1] - a[1])
            .map(entry => entry[0]);
    }
}

export class WordSuggestionProvider implements vscode.CompletionItemProvider {
    private markovChain: MarkovChain;

    constructor(workspaceFolder: string) {
        this.markovChain = new MarkovChain();
        this.buildMarkovChain(workspaceFolder);
    }

    private buildMarkovChain(workspaceFolder: string) {
        const completeDraftPath = path.join(workspaceFolder, '.project', 'complete_draftts.txt');
        if (!fs.existsSync(completeDraftPath)) {
            console.error(`File not found: ${completeDraftPath}`);
            return;
        }
        const content = fs.readFileSync(completeDraftPath, 'utf-8');
        const words = content.split(/\s+/).filter(word => word.length > 0);

        for (let i = 0; i < words.length - 1; i++) {
            const word1 = words[i].toLowerCase().replace(/[^\p{L}\s]/gu, "");
            const word2 = words[i + 1].toLowerCase().replace(/[^\p{L}\s]/gu, "");
            if (word1 && word2) {
                this.markovChain.addPair(word1, word2);
            }
        }
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const words = linePrefix.split(/\s+/).filter(word => word.length > 0);
        const lastWord = words[words.length - 1].toLowerCase().replace(/[^\p{L}\s]/gu, "");

        let suggestions: string[] = [];
        if (lastWord) {
            suggestions = this.markovChain.getNextWords(lastWord);
        }

        if (suggestions.length === 0 && words.length > 1) {
            const secondLastWord = words[words.length - 2].toLowerCase().replace(/[^\p{L}\s]/gu, "");
            suggestions = this.markovChain.getNextWords(secondLastWord);
        }

        return suggestions.slice(0, 5).map(word => {
            const completionItem = new vscode.CompletionItem(word);
            completionItem.kind = vscode.CompletionItemKind.Text;
            completionItem.detail = 'Suggested word';
            return completionItem;
        });
    }
}

export function registerWordSuggestionProvider(context: vscode.ExtensionContext) {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
    if (!workspaceFolder) {
        console.error('No workspace folder found');
        return;
    }

    const provider = new WordSuggestionProvider(workspaceFolder);
    const disposable = vscode.languages.registerCompletionItemProvider('scripture', provider, ' ');
    context.subscriptions.push(disposable);
}