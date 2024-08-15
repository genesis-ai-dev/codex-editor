import * as vscode from "vscode";
import { Dictionary, DictionaryEntry, SpellCheckResult, SpellCheckDiagnostic } from "../../../../types";
import { verseRefRegex } from "../../../utils/verseRefUtils";

export class SpellChecker {
    private dictionary: Dictionary;

    constructor(dictionary: Dictionary) {
        this.dictionary = dictionary;
    }

    public spellCheck(word: string): SpellCheckResult {
        const lowercaseWord = word.toLowerCase();
        const isInDictionary = this.dictionary.entries.some(entry => entry.headWord.toLowerCase() === lowercaseWord);

        if (isInDictionary) {
            return { word, corrections: [] };
        }

        let suggestions: string[] = [];
        if (this.dictionary.entries.length > 0) {
            suggestions = this.dictionary.entries
                .map(entry => ({
                    word: entry.headWord,
                    distance: this.levenshteinDistance(lowercaseWord, entry.headWord.toLowerCase())
                }))
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 3)
                .map(suggestion => suggestion.word);
        }

        return { word, corrections: suggestions };
    }

    public provideDiagnostics(document: vscode.TextDocument): SpellCheckDiagnostic[] {
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
                    const spellCheckResult = this.spellCheck(word);
                    if (spellCheckResult.corrections.length > 0 || this.dictionary.entries.length === 0) {
                        const range = new vscode.Range(
                            new vscode.Position(lineIndex, editWindow),
                            new vscode.Position(lineIndex, editWindow + word.length)
                        );
                        diagnostics.push({
                            range,
                            message: `Possible spelling mistake. ${spellCheckResult.corrections.length > 0 ? `Suggestions: ${spellCheckResult.corrections.join(', ')}` : 'No suggestions available.'}`,
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

    public provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext): vscode.CodeAction[] {
        const diagnostics = context.diagnostics.filter(diagnostic => diagnostic.source === 'Spell-Check');
        const actions: vscode.CodeAction[] = [];

        diagnostics.forEach(diagnostic => {
            const word = document.getText(diagnostic.range);
            const spellCheckResult = this.spellCheck(word);

            // Add suggestions as quick fixes
            spellCheckResult.corrections.forEach(suggestion => {
                const action = new vscode.CodeAction(`Change to '${suggestion}'`, vscode.CodeActionKind.QuickFix);
                action.edit = new vscode.WorkspaceEdit();
                action.edit.replace(document.uri, diagnostic.range, suggestion);
                action.diagnostics = [diagnostic];
                action.isPreferred = true;
                actions.push(action);
            });

            // Add 'Add to Dictionary' action
            const addToDictionaryAction = new vscode.CodeAction('Add to Dictionary', vscode.CodeActionKind.QuickFix);
            addToDictionaryAction.command = {
                command: 'easyLanguageServer.addToDictionary',
                title: 'Add to Dictionary',
                arguments: [word]
            };
            addToDictionaryAction.diagnostics = [diagnostic];
            actions.push(addToDictionaryAction);
        });

        return actions;
    }

    private levenshteinDistance(a: string, b: string): number {
        const matrix = [];
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
}

export class DictionaryManager {
    public dictionary: Dictionary;
    public dictionaryPath: vscode.Uri;

    constructor(dictionaryPath: vscode.Uri) {
        this.dictionaryPath = dictionaryPath;
        this.dictionary = this.loadDictionary();
    }

    private loadDictionary(): Dictionary {
        try {
            const dictionaryContent = vscode.workspace.fs.readFile(this.dictionaryPath);
            return JSON.parse(dictionaryContent.toString());
        } catch (error) {
            console.error('Error loading dictionary:', error);
            return { entries: [] };
        }
    }

    public async addToDictionary(word: string): Promise<void> {
        const newEntry: DictionaryEntry = {
            id: this.generateUniqueId(),
            headWord: word,
            hash: 'unknown'
        };
        this.dictionary.entries.push(newEntry);

        try {
            const serializedDictionary = JSON.stringify(this.dictionary, null, 2);
            await vscode.workspace.fs.writeFile(this.dictionaryPath, Buffer.from(serializedDictionary));
        } catch (error) {
            console.error('Error saving dictionary:', error);
            throw new Error('Failed to save dictionary. Please try again.');
        }
    }

    private generateUniqueId(): string {
        return Math.random().toString(36).substr(2, 9);
    }
}