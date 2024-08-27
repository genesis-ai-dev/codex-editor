import {
    Diagnostic,
    DiagnosticSeverity,
    Range,
    TextDocument,
    CodeAction,
    CodeActionKind,
    CompletionItem,
    CompletionItemKind,
    Position,
    TextEdit,
    CancellationToken,
    CompletionContext
} from 'vscode-languageserver/node';
import { verseRefRegex } from "./types";
import { Dictionary, DictionaryEntry, SpellCheckResult } from "./types";
import * as fs from 'fs';
import * as path from 'path';

export class SpellChecker {
    private dictionary: Dictionary | null = null;
    private dictionaryPath: string;

    constructor(workspaceFolder: string | undefined) {
        this.dictionaryPath = path.join(workspaceFolder || '', 'files', 'project.dictionary');
        console.log("Dictionary path: " + this.dictionaryPath);
    }
    async initializeDictionary() {
        try {
            await this.ensureDictionaryExists();
            await this.loadDictionary();
        } catch (error: any) {
            console.error(`Failed to initialize dictionary: ${error.message}`);
            this.dictionary = { entries: [] };
        }
    }

    private async ensureDictionaryExists() {
        try {
            await fs.promises.access(this.dictionaryPath);
        } catch {
            const emptyDictionary = { entries: [] };
            await fs.promises.writeFile(
                this.dictionaryPath,
                JSON.stringify(emptyDictionary)
            );
            console.log("Created new empty dictionary.");
        }
    }

    private async loadDictionary() {
        const content = await fs.promises.readFile(this.dictionaryPath, 'utf8');
        this.dictionary = JSON.parse(content);
        if (this.dictionary && Array.isArray(this.dictionary.entries)) {
            const wordCount = this.dictionary.entries.length;
            console.log(`Dictionary loaded with ${wordCount} words.`);
        } else {
            this.dictionary = { entries: [] };
            console.log("Initialized empty dictionary.");
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
            await fs.promises.writeFile(this.dictionaryPath, serializedDictionary);
        } catch (error) {
            console.error('Error saving dictionary:', error);
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
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.spellChecker = spellChecker;
    }

    updateDiagnostics(document: TextDocument): Diagnostic[] {
        return this.provideDiagnostics(document);
    }

    private provideDiagnostics(document: TextDocument): Diagnostic[] {
        const diagnostics: Diagnostic[] = [];
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
                        const range: Range = {
                            start: { line: lineIndex, character: editWindow },
                            end: { line: lineIndex, character: editWindow + word.length }
                        };
                        diagnostics.push({
                            range,
                            message: `Possible spelling mistake. Suggestions: ${spellCheckResult.corrections.join(', ')}`,
                            severity: DiagnosticSeverity.Information,
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
                const range: Range = {
                    start: { line: lineIndex, character: match2.index },
                    end: { line: lineIndex, character: match2.index + match2[0].length }
                };
                diagnostics.push({
                    range,
                    message: `Repeated punctuation: "${match2[0]}"`,
                    severity: DiagnosticSeverity.Information,
                    source: 'Punctuation-Check'
                });
            }

            // Check for whitespace around punctuation
            const whitespaceAroundPunctuationRegex = /\s([!?,.])\s/g;
            while ((match2 = whitespaceAroundPunctuationRegex.exec(line)) !== null) {
                const range: Range = {
                    start: { line: lineIndex, character: match2.index },
                    end: { line: lineIndex, character: match2.index + match2[0].length }
                };
                diagnostics.push({
                    range,
                    message: `Whitespace around punctuation: "${match2[0]}"`,
                    severity: DiagnosticSeverity.Information,
                    source: 'Punctuation-Check'
                });
            }
        });

        return diagnostics;
    }
}

export class SpellCheckCodeActionProvider {
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.spellChecker = spellChecker;
    }

    provideCodeActions(document: TextDocument, range: Range, context: { diagnostics: Diagnostic[] }): CodeAction[] {
        const actions: CodeAction[] = [];
        const diagnostics = context.diagnostics.filter(diag => diag.source === 'Spell-Check' || diag.source === 'Punctuation-Check');

        diagnostics.forEach(diagnostic => {
            const word = document.getText(diagnostic.range);
            if (diagnostic.source === 'Spell-Check') {
                const spellCheckResult = this.spellChecker.spellCheck(word);

                spellCheckResult.corrections.forEach((correction: string) => {
                    const action: CodeAction = {
                        title: `${word} → ${correction}`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [TextEdit.replace(diagnostic.range, correction)]
                            }
                        }
                    };
                    actions.push(action);
                });

                // Add to dictionary action
                const addToDictionaryAction: CodeAction = {
                    title: `Add '${word}' to dictionary`,
                    kind: CodeActionKind.QuickFix,
                    command: {
                        title: 'Add to Dictionary',
                        command: 'spellcheck.addToDictionary',
                        arguments: [word]
                    }
                };
                actions.push(addToDictionaryAction);
            } else if (diagnostic.source === 'Punctuation-Check') {
                if (diagnostic.message.startsWith('Repeated punctuation')) {
                    const correctedPunctuation = word[0]; // Just keep the first punctuation mark
                    const action: CodeAction = {
                        title: `Fix repeated punctuation`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [TextEdit.replace(diagnostic.range, correctedPunctuation)]
                            }
                        }
                    };
                    actions.push(action);
                } else if (diagnostic.message.startsWith('Whitespace around punctuation')) {
                    const correctedPunctuation = word.trim(); // Remove whitespace around punctuation
                    const action: CodeAction = {
                        title: `Fix whitespace around punctuation`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [TextEdit.replace(diagnostic.range, correctedPunctuation)]
                            }
                        }
                    };
                    actions.push(action);
                }
            }
        });

        return actions;
    }
}

export class SpellCheckCompletionItemProvider {
    private spellChecker: SpellChecker;

    constructor(spellChecker: SpellChecker) {
        this.spellChecker = spellChecker;
    }

    provideCompletionItems(
        document: TextDocument, 
        position: Position, 
        token: CancellationToken, 
        context: CompletionContext
    ): CompletionItem[] {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const linePrefix = text.substr(0, offset);
        const wordMatch = linePrefix.match(/\S+$/);
        if (!wordMatch) {
            return [];
        }

        const currentWord = wordMatch[0];
        const spellCheckResult = this.spellChecker.spellCheck(currentWord);

        return spellCheckResult.corrections.map(suggestion => ({
            label: suggestion,
            kind: CompletionItemKind.Text,
            detail: 'Spelling suggestion'
        }));
    }
}