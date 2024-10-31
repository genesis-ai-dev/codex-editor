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
    CompletionContext,
    Connection,
    RequestType,
    HandlerResult,
} from "vscode-languageserver/node";
import { verseRefRegex } from "./types";
import { SpellCheckResult } from "./types";
import { Dictionary, DictionaryEntry } from "codex-types";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import { cleanWord } from "../utils/cleaningUtils";
import {
    readDictionaryServer,
    saveDictionaryServer,
    addWordsToDictionary,
} from "../utils/dictionaryUtils/server";
import { Database } from "sql.js";

let folderUri: URI | undefined;

// Define request types
interface CheckWordResponse {
    exists: boolean;
}

const CheckWordRequest = new RequestType<string, CheckWordResponse, never>("custom/checkWord");
const GetSuggestionsRequest = new RequestType<string, string[], never>("custom/getSuggestions");
const AddWordsRequest = new RequestType<string[], boolean, never>("custom/addWords");

export class SpellChecker {
    private connection: Connection;

    constructor(connection: Connection) {
        this.connection = connection;
    }

    async spellCheck(word: string): Promise<SpellCheckResult> {
        const originalWord = word;
        const cleanedWord = cleanWord(word);

        try {
            // Check if word exists in dictionary
            const response = await this.connection.sendRequest(CheckWordRequest, cleanedWord);

            if (response.exists) {
                return { word: originalWord, corrections: [] };
            }

            const suggestions = await this.getSuggestions(originalWord);
            return { word: originalWord, corrections: suggestions };
        } catch (error) {
            console.error("Error in spellCheck:", error);
            return { word: originalWord, corrections: [] };
        }
    }

    private async getSuggestions(word: string): Promise<string[]> {
        if (!word || word.trim().length === 0) {
            return [];
        }

        try {
            const cleanedWord = cleanWord(word);
            const leadingPunctuation = word.match(/^[^\p{L}\p{N}]+/u)?.[0] || "";
            const trailingPunctuation = word.match(/[^\p{L}\p{N}]+$/u)?.[0] || "";

            // Get all words from the dictionary
            const dictWords = await this.connection.sendRequest(GetSuggestionsRequest, cleanedWord);

            const suggestions = dictWords.map((dictWord) => ({
                word: dictWord,
                distance: this.levenshteinDistance(cleanedWord, dictWord),
            }));

            return suggestions
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 3)
                .map((suggestion) => {
                    let result = suggestion.word;

                    // Preserve original capitalization
                    if (word[0].toUpperCase() === word[0]) {
                        result = result.charAt(0).toUpperCase() + result.slice(1);
                    }

                    // Preserve surrounding punctuation
                    return leadingPunctuation + result + trailingPunctuation;
                });
        } catch (error) {
            console.error("Error in getSuggestions:", error);
            return [];
        }
    }

    async addWords(words: string[]): Promise<void> {
        try {
            const success = await this.connection.sendRequest(AddWordsRequest, words);

            if (success) {
                this.connection.sendNotification("custom/dictionaryUpdated");
            }
        } catch (error) {
            console.error("Error in addWords:", error);
        }
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
        const lines = text.split("\n");

        lines.forEach((line, lineIndex) => {
            const trimmedLine = line.trimStart();
            const match = trimmedLine.match(verseRefRegex);
            const startIndex = match && trimmedLine.startsWith(match[0]) ? match[0].length : 0;

            // Remove HTML tags before processing
            const lineWithoutHtml = line.replace(/<[^>]*>/g, "");
            const words = lineWithoutHtml.slice(startIndex).split(/\s+/);
            let editWindow = startIndex;

            words.forEach(async (word) => {
                if (word.length > 0) {
                    const spellCheckResult = await this.spellChecker.spellCheck(word);
                    if (spellCheckResult.corrections.length > 0) {
                        const range: Range = {
                            start: { line: lineIndex, character: editWindow },
                            end: { line: lineIndex, character: editWindow + word.length },
                        };
                        diagnostics.push({
                            range,
                            message: `Possible spelling mistake. Suggestions: ${spellCheckResult.corrections.join(
                                ", "
                            )}`,
                            severity: DiagnosticSeverity.Information,
                            source: "Spell-Check",
                        });
                    }
                }
                editWindow += word.length + 1; // +1 for space
            });

            // Check for repeated punctuation
            const repeatedPunctuationRegex = /([!?,.])\1+/g;
            let match2;
            while ((match2 = repeatedPunctuationRegex.exec(lineWithoutHtml)) !== null) {
                const range: Range = {
                    start: { line: lineIndex, character: match2.index },
                    end: { line: lineIndex, character: match2.index + match2[0].length },
                };
                diagnostics.push({
                    range,
                    message: `Repeated punctuation: "${match2[0]}"`,
                    severity: DiagnosticSeverity.Information,
                    source: "Punctuation-Check",
                });
            }

            // Check for whitespace around punctuation
            const whitespaceAroundPunctuationRegex = /\s([!?,.])\s/g;
            while ((match2 = whitespaceAroundPunctuationRegex.exec(lineWithoutHtml)) !== null) {
                const range: Range = {
                    start: { line: lineIndex, character: match2.index },
                    end: { line: lineIndex, character: match2.index + match2[0].length },
                };
                diagnostics.push({
                    range,
                    message: `Whitespace around punctuation: "${match2[0]}"`,
                    severity: DiagnosticSeverity.Information,
                    source: "Punctuation-Check",
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

    provideCodeActions(
        document: TextDocument,
        range: Range,
        context: { diagnostics: Diagnostic[] }
    ): CodeAction[] {
        const actions: CodeAction[] = [];
        const diagnostics = context.diagnostics.filter(
            (diag) => diag.source === "Spell-Check" || diag.source === "Punctuation-Check"
        );

        diagnostics.forEach(async (diagnostic) => {
            const word = document.getText(diagnostic.range);
            const cleanedWord = cleanWord(word);
            if (diagnostic.source === "Spell-Check") {
                const spellCheckResult = await this.spellChecker.spellCheck(word);

                spellCheckResult.corrections.forEach((correction: string) => {
                    const action: CodeAction = {
                        title: `${cleanedWord} → ${correction}`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [TextEdit.replace(diagnostic.range, correction)],
                            },
                        },
                    };
                    actions.push(action);
                });

                // Add to dictionary action
                const addToDictionaryAction: CodeAction = {
                    title: `Add '${cleanedWord}' to dictionary`,
                    kind: CodeActionKind.QuickFix,
                    command: {
                        title: "Add to Dictionary",
                        command: "spellcheck.addToDictionary",
                        arguments: [cleanedWord],
                    },
                };
                actions.push(addToDictionaryAction);
            } else if (diagnostic.source === "Punctuation-Check") {
                if (diagnostic.message.startsWith("Repeated punctuation")) {
                    const correctedPunctuation = word[0]; // Just keep the first punctuation mark
                    const action: CodeAction = {
                        title: `Fix repeated punctuation`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [
                                    TextEdit.replace(diagnostic.range, correctedPunctuation),
                                ],
                            },
                        },
                    };
                    actions.push(action);
                } else if (diagnostic.message.startsWith("Whitespace around punctuation")) {
                    const correctedPunctuation = word.trim(); // Remove whitespace around punctuation
                    const action: CodeAction = {
                        title: `Fix whitespace around punctuation`,
                        kind: CodeActionKind.QuickFix,
                        edit: {
                            changes: {
                                [document.uri]: [
                                    TextEdit.replace(diagnostic.range, correctedPunctuation),
                                ],
                            },
                        },
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

    async provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
    ): Promise<CompletionItem[]> {
        const text = document.getText();
        const offset = document.offsetAt(position);
        const linePrefix = text.substr(0, offset);
        const wordMatch = linePrefix.match(/\S+$/);
        if (!wordMatch) {
            return [];
        }

        const currentWord = wordMatch[0];
        const spellCheckResult = await this.spellChecker.spellCheck(currentWord);

        return spellCheckResult.corrections.map((suggestion) => ({
            label: suggestion,
            kind: CompletionItemKind.Text,
            detail: "Spelling suggestion",
        }));
    }
}
