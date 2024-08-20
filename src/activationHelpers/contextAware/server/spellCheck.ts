
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
        const isInDictionary = this.dictionary.entries.some(entry => entry.headWord.toLowerCase() === lowercaseWord);

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
        const diagnostics = context.diagnostics.filter(diag => diag.source === 'Spell-Check');

        diagnostics.forEach(diagnostic => {
            const word = document.getText(diagnostic.range);
            const spellCheckResult = this.spellChecker.spellCheck(word);

            spellCheckResult.corrections.forEach((correction: string) => {
                const action = new vscode.CodeAction(`${word} → ${correction}`, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(document.uri, diagnostic.range, correction);
                actions.push(action);
            });

            const addToDictionaryAction = new vscode.CodeAction(`${word} → 📖`, vscode.CodeActionKind.QuickFix);
            addToDictionaryAction.command = {
                command: 'extension.addToDictionary',
                title: 'Add to Dictionary',
                arguments: [word]
            };
            actions.push(addToDictionaryAction);
        });

        return actions;
    }
}