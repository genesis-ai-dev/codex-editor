"use strict";
import * as vscode from "vscode";
import { verseRefRegex } from "../../../utils/verseRefUtils";
import { Dictionary, DictionaryEntry, SpellCheckResult, SpellCheckDiagnostic } from "../../../../types";


export class SpellChecker {
    private dictionary: Dictionary | null = null;
    private dictionaryPath: vscode.Uri;

    constructor(workspaceFolder: string | undefined) {
        this.dictionaryPath = vscode.Uri.file(`${workspaceFolder}/files/project.dictionary`);
    }

    async initializeDictionary() {
        try {
            await this.ensureDictionaryExists();
            await this.loadDictionary();
        } catch (error: any) {
            vscode.window.showErrorMessage(`Failed to initialize dictionary: ${error.message}`);
            this.dictionary = { entries: [] };
        }
    }

    private async ensureDictionaryExists() {
        try {
            await vscode.workspace.fs.stat(this.dictionaryPath);
        } catch {
            const emptyDictionary = { entries: [] };
            await vscode.workspace.fs.writeFile(
                this.dictionaryPath,
                Buffer.from(JSON.stringify(emptyDictionary))
            );
            vscode.window.showInformationMessage("Created new empty dictionary.");
        }
    }

    private async loadDictionary() {
        const content = await vscode.workspace.fs.readFile(this.dictionaryPath);
        this.dictionary = JSON.parse(content.toString());
        if (this.dictionary && Array.isArray(this.dictionary.entries)) {
            const wordCount = this.dictionary.entries.length;
            vscode.window.showInformationMessage(`Dictionary loaded with ${wordCount} words.`);
        } else {
            this.dictionary = { entries: [] };
            vscode.window.showInformationMessage("Initialized empty dictionary.");
        }
    }

    spellCheck(word: string): SpellCheckResult {
        if (!this.dictionary || this.dictionary.entries.length === 0) {
            return { word, corrections: ['[Dictionary is empty]'] };
        }

        const lowercaseWord = word.toLowerCase();
        const isInDictionary = this.dictionary.entries.some(entry => 
            entry.headWord === lowercaseWord || 
            entry.headWord === lowercaseWord.replace(/['-]/g, '') // Check without punctuation
        );

        if (isInDictionary) {
            return { word, corrections: [] };
        }

        const suggestions = this.getSuggestions(lowercaseWord);
        return { word, corrections: suggestions };
    }

    private getSuggestions(word: string): string[] {
        return this.dictionary!.entries
            .map(entry => ({
                word: entry.headWord,
                distance: this.levenshteinDistance(word, entry.headWord.toLowerCase())
            }))
            .sort((a, b) => a.distance - b.distance)
            .slice(0, 3)
            .map(suggestion => suggestion.word);
    }

    private levenshteinDistance(a: string, b: string): number {
        const matrix: number[][] = [];

        for (let i = 0; i <= b.length; i++) {
            matrix[i] = [i];
        }
        for (let j = 0; j <= a.length; j++) {
            matrix[0][j] = j;
        }

        for (let i = 1; i <= b.length; i++) {
            for (let j = 1; j <= a.length; j++) {
                if (b.charAt(i - 1) === a.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1,
                        matrix[i][j - 1] + 1,
                        matrix[i - 1][j] + 1
                    );
                }
            }
        }

        return matrix[b.length][a.length];
    }

    async addToDictionary(word: string) {
        // Trim whitespace and remove leading/trailing punctuation
        word = word.trim().replace(/^[^\p{L}]+|[^\p{L}]+$/gu, "").toLowerCase();

        if (!this.dictionary) {
            this.dictionary = { entries: [] };
        }

        const newEntry: DictionaryEntry = {
            id: this.generateUniqueId(),
            headWord: word,
            hash: this.generateHash(word)
        };
        this.dictionary.entries.push(newEntry);

        try {
            const serializedDictionary = JSON.stringify(this.dictionary, null, 2);
            await vscode.workspace.fs.writeFile(this.dictionaryPath, Buffer.from(serializedDictionary));
        } catch (error) {
            console.error('Error saving dictionary:', error);
            vscode.window.showErrorMessage('Failed to save dictionary. Please try again.');
        }
    }

    private generateUniqueId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    private generateHash(word: string): string {
        // FIXME: this should be an image hash
        return word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0).toString();
    }
}

export class SpellCheckDiagnosticsProvider {
    private diagnosticCollection: vscode.DiagnosticCollection;
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.diagnosticCollection = vscode.languages.createDiagnosticCollection('spell-check');
        this.spellChecker = spellChecker;
    }

    updateDiagnostics(document: vscode.TextDocument) {
        const diagnostics = this.provideDiagnostics(document);
        this.diagnosticCollection.set(document.uri, diagnostics);
    }

    refreshDiagnostics() {
        vscode.workspace.textDocuments.forEach(doc => {
            if (doc.languageId === 'scripture') {
                this.updateDiagnostics(doc);
            }
        });
    }

    private provideDiagnostics(document: vscode.TextDocument): SpellCheckDiagnostic[] {
        const diagnostics: SpellCheckDiagnostic[] = [];
        const text = document.getText();
        const lines = text.split('\n');

        lines.forEach((line, lineIndex) => {
            const trimmedLine = line.trimStart();
            const match = trimmedLine.match(verseRefRegex);
            const startIndex = match && trimmedLine.startsWith(match[0]) ? match[0].length : 0;

            const words = line.slice(startIndex).split(/\s+/);
            let editWindow = startIndex;

            words.forEach(word => {
                if (word.length > 0) {
                    const spellCheckResult = this.spellChecker.spellCheck(word);
                    if (spellCheckResult.corrections.length > 0) {
                        const range = new vscode.Range(
                            new vscode.Position(lineIndex, editWindow),
                            new vscode.Position(lineIndex, editWindow + word.length)
                        );
                        diagnostics.push({
                            range,
                            message: `Possible spelling mistake. Suggestions: ${spellCheckResult.corrections.join(', ')}`,
                            severity: vscode.DiagnosticSeverity.Information,
                            source: 'Spell-Check'
                        });
                    }
                }
                editWindow += word.length + 1; // +1 for space
            });

            // Check for repeated punctuation
            const repeatedPunctuationRegex = /([!?,.])\1+/g;
            let match2;
            while ((match2 = repeatedPunctuationRegex.exec(line)) !== null) {
                const range = new vscode.Range(
                    new vscode.Position(lineIndex, match2.index),
                    new vscode.Position(lineIndex, match2.index + match2[0].length)
                );
                diagnostics.push({
                    range,
                    message: `Repeated punctuation: "${match2[0]}"`,
                    severity: vscode.DiagnosticSeverity.Information,
                    source: 'Punctuation-Check'
                });
            }

            // Check for whitespace around punctuation
            const whitespaceAroundPunctuationRegex = /\s([!?,.])\s/g;
            while ((match2 = whitespaceAroundPunctuationRegex.exec(line)) !== null) {
                const range = new vscode.Range(
                    new vscode.Position(lineIndex, match2.index),
                    new vscode.Position(lineIndex, match2.index + match2[0].length)
                );
                diagnostics.push({
                    range,
                    message: `Whitespace around punctuation: "${match2[0]}"`,
                    severity: vscode.DiagnosticSeverity.Information,
                    source: 'Punctuation-Check'
                });
            }
        });

        return diagnostics;
    }
}

export class SpellCheckCodeActionProvider implements vscode.CodeActionProvider {
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.spellChecker = spellChecker;
    }

    provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken): vscode.CodeAction[] {
        const actions: vscode.CodeAction[] = [];
        const diagnostics = context.diagnostics.filter(diag => diag.source === 'Spell-Check' || diag.source === 'Punctuation-Check');

        diagnostics.forEach(diagnostic => {
            const word = document.getText(diagnostic.range);
            if (diagnostic.source === 'Spell-Check') {
                const spellCheckResult = this.spellChecker.spellCheck(word);

                spellCheckResult.corrections.forEach((correction: string) => {
                    const action = new vscode.CodeAction(`${word} → ${correction}`, vscode.CodeActionKind.QuickFix);
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, diagnostic.range, correction);
                    actions.push(action);
                });

                const addToDictionaryAction = new vscode.CodeAction(`${word} → 📖`, vscode.CodeActionKind.QuickFix);
                addToDictionaryAction.command = {
                    command: 'extension.addToDictionaryOptions',
                    title: 'Add to Dictionary Options',
                    arguments: [word, document, diagnostic.range]
                };
                actions.push(addToDictionaryAction);
            } else if (diagnostic.source === 'Punctuation-Check') {
                if (diagnostic.message.startsWith('Repeated punctuation')) {
                    const correctedPunctuation = word[0]; // Just keep the first punctuation mark
                    const action = new vscode.CodeAction(`Fix repeated punctuation`, vscode.CodeActionKind.QuickFix);
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, diagnostic.range, correctedPunctuation);
                    actions.push(action);
                } else if (diagnostic.message.startsWith('Whitespace around punctuation')) {
                    const correctedPunctuation = word.trim(); // Remove whitespace around punctuation
                    const action = new vscode.CodeAction(`Fix whitespace around punctuation`, vscode.CodeActionKind.QuickFix);
                    action.edit = new vscode.WorkspaceEdit();
                    action.edit.replace(document.uri, diagnostic.range, correctedPunctuation);
                    actions.push(action);
                }
            }
        });

        return actions;
    }
}

export class SpellCheckCompletionItemProvider implements vscode.CompletionItemProvider {
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.spellChecker = spellChecker;
    }

    provideCompletionItems(
        document: vscode.TextDocument,
        position: vscode.Position,
        token: vscode.CancellationToken,
        context: vscode.CompletionContext
    ): vscode.ProviderResult<vscode.CompletionItem[] | vscode.CompletionList> {
        const linePrefix = document.lineAt(position).text.substr(0, position.character);
        const wordMatch = linePrefix.match(/\S+$/);
        if (!wordMatch) {
            return undefined;
        }

        const currentWord = wordMatch[0];
        const spellCheckResult = this.spellChecker.spellCheck(currentWord);

        return spellCheckResult.corrections.map(suggestion => {
            const completionItem = new vscode.CompletionItem(suggestion);
            completionItem.kind = vscode.CompletionItemKind.Text;
            completionItem.detail = 'Spelling suggestion';
            completionItem.range = new vscode.Range(position.translate(0, -currentWord.length), position);
            return completionItem;
        });
    }
}
export function registerSpellCheckProviders(context: vscode.ExtensionContext, spellChecker: SpellChecker) {
    const diagnosticsProvider = new SpellCheckDiagnosticsProvider(spellChecker);
    const codeActionProvider = new SpellCheckCodeActionProvider(spellChecker);
    const completionItemProvider = new SpellCheckCompletionItemProvider(spellChecker);

    context.subscriptions.push(
        vscode.languages.registerCodeActionsProvider('scripture', codeActionProvider),
        vscode.languages.registerCompletionItemProvider('scripture', completionItemProvider),
        vscode.workspace.onDidOpenTextDocument(doc => {
            if (doc.fileName.endsWith('.bible')) {
                return;
            }
            if (doc.languageId === 'scripture') {
                diagnosticsProvider.updateDiagnostics(doc);
            }
        }),
        vscode.workspace.onDidChangeTextDocument(event => {
            if (event.document.fileName.endsWith('.bible')) {
                return;
            }
            if (event.document.languageId === 'scripture') {
                diagnosticsProvider.updateDiagnostics(event.document);
                vscode.commands.executeCommand('editor.action.triggerSuggest');
            }
        }),
        vscode.commands.registerCommand('extension.addToDictionary', async (word: string) => {
            await spellChecker.addToDictionary(word);
            vscode.window.showInformationMessage(`Added '${word}' to dictionary.`);
            diagnosticsProvider.refreshDiagnostics();
        }),
        vscode.commands.registerCommand('extension.addToDictionaryOptions', async (word: string, document: vscode.TextDocument, range: vscode.Range) => {
            const options = ['Add this word', 'Add all words on this line'];
            const selection = await vscode.window.showQuickPick(options, {
                placeHolder: 'Choose an option to add to dictionary'
            });

            if (selection === options[0]) {
                await spellChecker.addToDictionary(word);
                vscode.window.showInformationMessage(`Added '${word}' to dictionary.`);
            } else if (selection === options[1]) {
                const line = document.lineAt(range.start.line).text;
                const words = line.split(/\s+/).filter(w => w.length > 0);
                for (const w of words) {
                    await spellChecker.addToDictionary(w);
                }
                vscode.window.showInformationMessage(`Added all words from the line to dictionary.`);
            }

            diagnosticsProvider.refreshDiagnostics();
        })
    );

    // Update diagnostics for all open documents
    vscode.workspace.textDocuments.forEach(document => {
        if (document.fileName.endsWith('.bible')) {
            return;
        }
        if (document.languageId === 'scripture') {
            diagnosticsProvider.updateDiagnostics(document);
        }
    });
}