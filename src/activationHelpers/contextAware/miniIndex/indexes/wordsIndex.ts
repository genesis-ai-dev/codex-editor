import * as vscode from "vscode";
import * as path from "path";
import { FileHandler } from "../../../../providers/dictionaryTable/utilities/FileHandler";
import { cleanWord } from "../../../../utils/cleaningUtils";
import { updateCompleteDrafts } from "../indexingUtils";
import { getWorkSpaceUri } from "../../../../utils";
import { tokenizeText } from "../../../../utils/nlpUtils";
import { FileData } from "./fileReaders";

interface WordFrequency {
    word: string;
    frequency: number;
}

// FIXME: name says it all
const METHOD_SHOULD_BE_STORED_IN_CONFIG = "words_and_punctuation";

export async function initializeWordsIndex(
    initialWordIndex: Map<string, number>,
    targetFiles: FileData[]
): Promise<Map<string, number>> {
    const wordIndex = new Map<string, number>(initialWordIndex);
    let totalWords = 0;

    for (const file of targetFiles) {
        for (const cell of file.cells) {
            if (cell.metadata?.type === "text" && cell.value?.trim() !== "") {
                const words = tokenizeText({
                    method: METHOD_SHOULD_BE_STORED_IN_CONFIG,
                    text: cell.value,
                });

                words.forEach((word: string) => {
                    const cleanedWord = cleanWord(word);
                    if (cleanedWord && cleanedWord.length > 1) {
                        wordIndex.set(cleanedWord, (wordIndex.get(cleanedWord) || 0) + 1);
                        totalWords++;
                    }
                });
            }
        }
    }

    console.log(`Total words processed: ${totalWords}`);
    console.log(`Unique words indexed: ${wordIndex.size}`);

    return wordIndex;
}

export function getWordFrequency(wordIndex: Map<string, number>, word: string): number {
    return wordIndex.get(word) || 0;
}

export async function getWordsAboveThreshold(
    wordIndex: Map<string, number>,
    threshold: number
): Promise<string[]> {
    const workspaceFolderUri = getWorkSpaceUri();
    if (!workspaceFolderUri) {
        console.error("No workspace folder found");
        return [];
    }

    const dictionaryUri = vscode.Uri.joinPath(workspaceFolderUri, "files", "project.dictionary");
    let dictionaryWords: string[] = [];

    try {
        const fileContent = await vscode.workspace.fs.readFile(dictionaryUri);
        const data = Buffer.from(fileContent).toString("utf-8");

        if (data) {
            dictionaryWords = parseDictionaryData(data);
        }
    } catch (error) {
        console.error("Error reading dictionary file:", error);
    }

    return Array.from(wordIndex.entries())
        .filter(
            ([word, frequency]) =>
                frequency >= threshold && !dictionaryWords.includes(word?.toLowerCase() || "")
        )
        .map(([word, _]) => word);
}

function parseDictionaryData(data: string): string[] {
    try {
        // Try parsing as JSONL first
        const entries = data
            .split("\n")
            .filter((line) => line.trim().length > 0)
            .map((line) => JSON.parse(line));
        return entries.map((entry: any) => entry.headWord?.toLowerCase() || "");
    } catch (jsonlError) {
        try {
            // If JSONL parsing fails, try parsing as a single JSON object
            const dictionary = JSON.parse(data);
            if (Array.isArray(dictionary.entries)) {
                return dictionary.entries.map((entry: any) => entry.headWord?.toLowerCase() || "");
            } else {
                throw new Error("Invalid JSON format: missing or invalid entries array.");
            }
        } catch (jsonError) {
            console.error("Could not parse dictionary as JSONL or JSON:", jsonError);
            return [];
        }
    }
}

export function getWordFrequencies(wordIndex: Map<string, number>): WordFrequency[] {
    return Array.from(wordIndex.entries()).map(([word, frequency]) => ({ word, frequency }));
}
