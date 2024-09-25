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
} from "vscode-languageserver/node";
import { verseRefRegex } from "./types";
import { Dictionary, DictionaryEntry, SpellCheckResult } from "./types";
import * as fs from "fs";
import * as path from "path";
import { URI } from "vscode-uri";
import { Connection } from "vscode-languageserver/node";
import { cleanWord } from "../utils/cleaningUtils";

export class SpellChecker {
    private dictionary: Dictionary | null = null;
    private dictionaryPath: string;

    constructor(workspaceFolder: string | undefined) {
        if (workspaceFolder) {
            const folderUri = URI.parse(workspaceFolder);
            this.dictionaryPath = path.join(folderUri.fsPath, "files", "project.dictionary");
        } else {
            // Fallback to a default path if no workspace folder is provided
            this.dictionaryPath = path.join(process.cwd(), "files", "project.dictionary");
        }
        console.log("Dictionary path: " + this.dictionaryPath);
        this.ensureDictionaryExists();
        this.initializeDictionary();
    }

    async initializeDictionary() {
        try {
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
            const emptyDictionary = ""; // Dictionary is JSONL
            await fs.promises.mkdir(path.dirname(this.dictionaryPath), { recursive: true });
            await fs.promises.writeFile(this.dictionaryPath, emptyDictionary);
            console.log("Created new empty dictionary.");
        }
    }

    private async loadDictionary() {
        console.log(this.dictionaryPath);
        const content = await fs.promises.readFile(this.dictionaryPath, "utf-8");

        // Try parsing as JSON first (for older dictionaries)
        try {
            this.dictionary = JSON.parse(content);
        } catch (e: any) {
            console.log("hit an error in loadDictionary", e);
            // If JSON parsing fails, assume it's JSONL
            const entries: DictionaryEntry[] = [];
            const lines = content.split("\n").filter((line) => line.trim() !== "");
            for (const line of lines) {
                try {
                    const entry = JSON.parse(line.trim());
                    entries.push(entry);
                } catch (error) {
                    console.error(`Error parsing dictionary entry: ${line}`, error);
                }
            }
            this.dictionary = { entries };
        }

        if (this.dictionary && Array.isArray(this.dictionary.entries)) {
            const wordCount = this.dictionary.entries.length;
            console.log(`Dictionary loaded with ${wordCount} words.`);
            console.log(
                `First few words: ${this.dictionary.entries
                    .slice(0, 5)
                    .map((e) => e.headWord)
                    .join(", ")}`
            );
        } else {
            this.dictionary = { entries: [] };
            console.log("Initialized empty dictionary.");
        }
    }

    spellCheck(word: string): SpellCheckResult {
        if (!this.dictionary || this.dictionary.entries.length === 0) {
            return { word, corrections: [] };
        }

        const originalWord = word;
        const cleanedWord = cleanWord(word);
        const isInDictionary = this.dictionary.entries.some((entry) => {
            const entryWithoutPunctuation = entry.headWord.replace(/[^\p{L}\p{N}'-]/gu, "");
            return entryWithoutPunctuation === cleanedWord;
        });

        if (isInDictionary) {
            return { word: originalWord, corrections: [] };
        }

        const suggestions = this.getSuggestions(originalWord);

        return { word: originalWord, corrections: suggestions };
    }
    private getSuggestions(word: string): string[] {
        if (!word || word.trim().length === 0) {
            return [];
        }

        const cleanedWord = cleanWord(word);
        const leadingPunctuation = word.match(/^[^\p{L}\p{N}]+/u)?.[0] || "";
        const trailingPunctuation = word.match(/[^\p{L}\p{N}]+$/u)?.[0] || "";

        return this.dictionary!.entries.map((entry) => ({
            word: entry.headWord,
            distance: this.levenshteinDistance(
                cleanedWord.toLowerCase(),
                entry.headWord.toLowerCase()
            ),
        }))
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
                if (b.charAt(i - 1).toLowerCase() === a.charAt(j - 1).toLowerCase()) {
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

    private async ensureDictionaryWellFormed() {
        const content = await fs.promises.readFile(this.dictionaryPath, "utf8");
        const lines = content.split(/\n|\}\{/).map((line: string) => line.trim());
        const validEntries: DictionaryEntry[] = []; // Store valid entries for writing back to the file

        for (const line of lines) {
            if (!line) continue;
            try {
                let jsonLine = line;
                if (!line.startsWith("{")) jsonLine = "{" + jsonLine;
                if (!line.endsWith("}")) jsonLine = jsonLine + "}";
                const entry = JSON.parse(jsonLine);
                if (!entry.headWord || !entry.hash) {
                    throw new Error("Dictionary entry is missing required fields");
                }
                validEntries.push(entry); // Collect valid entries
            } catch (error) {
                console.error("Error parsing dictionary:", error);
            }
        }

        // If there are valid entries, write them back to the file
        if (validEntries.length > 0) {
            const serializedEntries =
                validEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
            await fs.promises.writeFile(this.dictionaryPath, serializedEntries, "utf8");
        }
    }

    async addWordsToDictionary(words: string[]) {
        console.log("Calling addWordsToDictionary inside server");
        const newEntries: DictionaryEntry[] = [];
        await this.ensureDictionaryWellFormed();

        for (let word of words) {
            word = cleanWord(word);

            if (!this.dictionary) {
                this.dictionary = { entries: [] };
            }

            if (this.dictionary.entries.some((entry) => entry.headWord === word)) {
                continue;
            }

            const newEntry: DictionaryEntry = {
                id: this.generateUniqueId(),
                headWord: word,
                hash: this.generateHash(word),
            };
            this.dictionary.entries.push(newEntry);
            newEntries.push(newEntry);
        }

        if (newEntries.length > 0) {
            try {
                const serializedEntries =
                    newEntries.map((entry) => JSON.stringify(entry)).join("\n") + "\n";
                await fs.promises.appendFile(this.dictionaryPath, serializedEntries, "utf8");
                // No need to reload the dictionary here
            } catch (error) {
                console.error("Error saving dictionary:", error);
            }
        }
    }

    private generateUniqueId(): string {
        return Math.random().toString(36).substr(2, 9);
    }

    private generateHash(word: string): string {
        // FIXME: this should be an image hash
        return word
            .split("")
            .reduce((acc, char) => acc + char.charCodeAt(0), 0)
            .toString();
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

            const words = line.slice(startIndex).split(/\s+/);
            let editWindow = startIndex;

            words.forEach((word) => {
                if (word.length > 0) {
                    const spellCheckResult = this.spellChecker.spellCheck(word);
                    if (spellCheckResult.corrections.length > 0) {
                        const range: Range = {
                            start: { line: lineIndex, character: editWindow },
                            end: { line: lineIndex, character: editWindow + word.length },
                        };
                        diagnostics.push({
                            range,
                            message: `Possible spelling mistake. Suggestions: ${spellCheckResult.corrections.join(", ")}`,
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
            while ((match2 = repeatedPunctuationRegex.exec(line)) !== null) {
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
            while ((match2 = whitespaceAroundPunctuationRegex.exec(line)) !== null) {
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

        diagnostics.forEach((diagnostic) => {
            const word = document.getText(diagnostic.range);
            const cleanedWord = cleanWord(word);
            if (diagnostic.source === "Spell-Check") {
                const spellCheckResult = this.spellChecker.spellCheck(word);

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

        return spellCheckResult.corrections.map((suggestion) => ({
            label: suggestion,
            kind: CompletionItemKind.Text,
            detail: "Spelling suggestion",
        }));
    }
}
