import * as vscode from 'vscode';
import * as path from 'path';
import MiniSearch from 'minisearch';
import { cleanWord } from '../../../../utils/spellingUtils';

interface WordFrequency {
    word: string;
    frequency: number;
}

export class WordsIndex {
    private wordIndex: MiniSearch<WordFrequency>;
    private completeDraftsPath: string;

    constructor(workspaceFolder: string) {
        this.completeDraftsPath = path.join(workspaceFolder, '.project', 'complete_drafts.txt');
        this.wordIndex = new MiniSearch({
            fields: ['word'],
            storeFields: ['word', 'frequency'],
            idField: 'word'
        });
    }

    async indexCompleteDrafts() {
        const fileUri = vscode.Uri.file(this.completeDraftsPath);
        const content = await vscode.workspace.fs.readFile(fileUri);
        const words = Buffer.from(content).toString('utf8').split(/\s+/).map(cleanWord).filter(Boolean);
        const wordFrequency: { [key: string]: number } = {};

        words.forEach(word => {
            wordFrequency[word] = (wordFrequency[word] || 0) + 1;
        });

        const wordFrequencyArray: WordFrequency[] = Object.entries(wordFrequency).map(([word, frequency]) => ({ word, frequency }));
        this.wordIndex.removeAll();
        this.wordIndex.addAll(wordFrequencyArray);
    }

    getWordFrequency(word: string): number {
        const result = this.wordIndex.search(word);
        return result[0]?.frequency || 0;
    }

    getWordsAboveThreshold(threshold: number): string[] {
        return this.wordIndex.search('*', { filter: (result) => result.frequency >= threshold })
            .map(result => result.word);
    }

    async updateCompleteDrafts(newContent: string) {
        const fileUri = vscode.Uri.file(this.completeDraftsPath);
        await vscode.workspace.fs.writeFile(fileUri, Buffer.from(newContent, 'utf8'));
        await this.indexCompleteDrafts();
    }
}

export function createWordsIndex(context: vscode.ExtensionContext, workspaceFolder: string | undefined) {
    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Words Index.');
        return null;
    }

    const wordsIndex = new WordsIndex(workspaceFolder);

    context.subscriptions.push(
        vscode.workspace.onDidSaveTextDocument(async (document) => {
            if (document.fileName.endsWith('.codex')) {
                await wordsIndex.indexCompleteDrafts();
            }
        })
    );

    return wordsIndex;
}