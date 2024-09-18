import * as vscode from 'vscode';
import * as path from 'path';
import { FileHandler } from '../../../../providers/dictionaryTable/utilities/FileHandler';
import { cleanWord } from '../../../../utils/cleaningUtils';
import { updateCompleteDrafts } from '../indexingUtils';
import { getWorkSpaceUri } from '../../../../utils';

interface WordFrequency {
    word: string;
    frequency: number;
}

export async function initializeWordsIndex(initialWordIndex: Map<string, number>, workspaceFolder: string | undefined): Promise<Map<string, number>> {
    if (!workspaceFolder) {
        console.warn('Workspace folder not found for Words Index.');
        return initialWordIndex;
    }

    // Update complete drafts file
    await updateCompleteDrafts();
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

export async function getWordsAboveThreshold(wordIndex: Map<string, number>, threshold: number): Promise<string[]> {
    const workspaceFolderUri = getWorkSpaceUri();
    if (!workspaceFolderUri) {
        console.error("No workspace folder found");
        return [];
    }

    const dictionaryUri = vscode.Uri.joinPath(workspaceFolderUri, 'files', 'project.dictionary');
    let dictionaryWords: string[] = [];

    try {
        const fileContent = await vscode.workspace.fs.readFile(dictionaryUri);
        const data = Buffer.from(fileContent).toString('utf-8');

        if (data) {
            try {
                // Try parsing as JSONL first
                const entries = data.split('\n')
                    .filter(line => line.trim().length > 0)
                    .map(line => JSON.parse(line));
                dictionaryWords = entries.map((entry: any) => entry.headWord?.toLowerCase() || '');
            } catch (jsonlError) {
                try {
                    // If JSONL parsing fails, try parsing as a single JSON object
                    const dictionary = JSON.parse(data);
                    if (Array.isArray(dictionary.entries)) {
                        dictionaryWords = dictionary.entries.map((entry: any) => entry.headWord?.toLowerCase() || '');
                    } else {
                        throw new Error('Invalid JSON format: missing or invalid entries array.');
                    }
                } catch (jsonError) {
                    console.error("Could not parse dictionary as JSONL or JSON:", jsonError);
                }
            }
        }
    } catch (error) {
        console.error("Error reading dictionary file:", error);
    }

    return Array.from(wordIndex.entries())
        .filter(([word, frequency]) => frequency >= threshold && !dictionaryWords.includes(word?.toLowerCase() || ''))
        .map(([word, _]) => word);
}

export function getWordFrequencies(wordIndex: Map<string, number>): WordFrequency[] {
    return Array.from(wordIndex.entries()).map(([word, frequency]) => ({ word, frequency }));
}