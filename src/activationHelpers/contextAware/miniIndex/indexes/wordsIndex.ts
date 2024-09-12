import * as vscode from 'vscode';
import * as path from 'path';
import { cleanWord } from '../../../../utils/spellingUtils';

interface WordFrequency {
    word: string;
    frequency: number;
}

export async function initializeWordsIndex(initialWordIndex: Map<string, number>, workspaceFolder: string | undefined): Promise<Map<string, number>> {
    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Words Index.');
        return initialWordIndex;
    }

    const completeDraftsPath = path.join(workspaceFolder, '.project', 'complete_drafts.txt');
    const fileUri = vscode.Uri.file(completeDraftsPath);
    const content = await vscode.workspace.fs.readFile(fileUri);
    const words = Buffer.from(content).toString('utf8').split(/\s+/).map(cleanWord).filter(Boolean);

    const wordIndex = new Map<string, number>();
    try {
        words.forEach((word: string) => {
            wordIndex.set(word, (wordIndex.get(word) || 0) + 1);
        });
    } catch (error) {
        console.error(error);
    }
    vscode.window.showInformationMessage(`Indexed ${words.length} words.`);
    return wordIndex;
}

export function getWordFrequency(wordIndex: Map<string, number>, word: string): number {
    return wordIndex.get(word) || 0;
}

export function getWordsAboveThreshold(wordIndex: Map<string, number>, threshold: number): string[] {
    return Array.from(wordIndex.entries())
        .filter(([_, frequency]) => frequency >= threshold)
        .map(([word, _]) => word);
}

export function getWordFrequencies(wordIndex: Map<string, number>): WordFrequency[] {
    return Array.from(wordIndex.entries()).map(([word, frequency]) => ({ word, frequency }));
}