import * as vscode from 'vscode';
import { Dictionary } from "codex-types";
import { SpellCheckResult, SpellCheckDiagnostic } from "../../../types";
import { verseRefRegex } from "../verseRefUtils";

// Helper function to calculate Levenshtein distance
export function levenshteinDistance(a: string, b: string): number {
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

// Update spellCheck function to provide suggestions based on edit distance
export function spellCheck(word: string, dictionary: Dictionary): SpellCheckResult {
    const lowercaseWord = word.toLowerCase();
    const isInDictionary = dictionary.entries.some(entry => entry.headWord.toLowerCase() === lowercaseWord);

    if (isInDictionary) {
        return { word, corrections: [] };
    }

    // Find closest words in the dictionary
    const suggestions = dictionary.entries
        .map(entry => ({
            word: entry.headWord,
            distance: levenshteinDistance(lowercaseWord, entry.headWord.toLowerCase())
        }))
        .sort((a, b) => a.distance - b.distance)
        .slice(0, 3)  // Get top 3 suggestions
        .map(suggestion => suggestion.word);

    return { word, corrections: suggestions };
}

// Update provideDiagnostics function to ignore verse references at the beginning of lines
export function provideDiagnostics(document: vscode.TextDocument, dictionary: Dictionary): SpellCheckDiagnostic[] {
    const diagnostics: SpellCheckDiagnostic[] = [];
    const text = document.getText();
    const lines = text.split('\n');

    lines.forEach((line: string, lineIndex: any) => {
        // Skip verse reference at the beginning of the line
        const trimmedLine = line.trimStart();
        const match = trimmedLine.match(verseRefRegex);
        const startIndex = match && trimmedLine.startsWith(match[0]) ? match[0].length : 0;

        const words = line.slice(startIndex).split(/\s+/);
        let editWindow = startIndex;

        words.forEach(word => {
            if (word.length > 0) {
                const spellCheckResult = spellCheck(word, dictionary);
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

// Implement code action provider
export function provideCodeActions(document: vscode.TextDocument, range: vscode.Range, context: vscode.CodeActionContext, token: vscode.CancellationToken, dictionary: Dictionary): vscode.CodeAction[] {
    const actions: vscode.CodeAction[] = [];
    const diagnostics = context.diagnostics.filter(diag => diag.source === 'Spell-Check');

    diagnostics.forEach(diagnostic => {
        const word = document.getText(diagnostic.range);
        const spellCheckResult = spellCheck(word, dictionary);

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

// Function to generate a unique ID
export function generateUniqueId() {
    return Math.random().toString(36).substr(2, 9);
}

// Function to generate a hash
export function generateHash(word: string) {
    // FIXME: this should be an image hash
    return word.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0).toString();
}