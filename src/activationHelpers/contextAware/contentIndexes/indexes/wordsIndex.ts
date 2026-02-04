import * as vscode from "vscode";
import * as path from "path";
import { FileHandler } from "../../../../utils/fileHandler";
import { updateCompleteDrafts } from "../indexingUtils";
import { getWorkSpaceUri } from "../../../../utils";
import { tokenizeText } from "../../../../utils/nlpUtils";
import { FileData } from "./fileReaders";

// HTML tag regex for stripping HTML
const HTML_TAG_REGEX = /<\/?[^>]+(>|$)/g;

/**
 * Cleans a word for spellchecking by removing non-letter characters
 */
function cleanWord(word: string | undefined | null): string {
    if (word === undefined || word === null) {
        return "";
    }
    return (
        word
            // Remove non-letter/number/mark characters from start and end
            .replace(/^[^\p{L}\p{M}\p{N}']+|[^\p{L}\p{M}\p{N}']+$/gu, "")
            // Replace multiple apostrophes with a single one
            .replace(/''+/g, "'")
            // Remove apostrophes at the start or end of words
            .replace(/(?<!\S)'|'(?!\S)/gu, "")
            // Remove other characters that are not letters, marks, numbers, apostrophes, or whitespace
            .replace(/[^\p{L}\p{M}\p{N}'\s]/gu, "")
    );
}

/**
 * Strips HTML tags from text
 */
function stripHtml(text: string): string {
    return text.replace(HTML_TAG_REGEX, "");
}

/**
 * Maps positions between HTML-stripped text and original text
 * Returns an array where index is position in stripped text and value is position in original text
 */
function createPositionMap(original: string): number[] {
    const stripped = stripHtml(original);
    const positionMap: number[] = new Array(stripped.length);

    let strippedPos = 0;
    let inTag = false;

    for (let origPos = 0; origPos < original.length; origPos++) {
        const char = original[origPos];

        if (char === "<") {
            inTag = true;
        }

        if (!inTag) {
            positionMap[strippedPos] = origPos;
            strippedPos++;
        }

        if (char === ">") {
            inTag = false;
        }
    }

    return positionMap;
}

export interface WordOccurrence {
    word: string;
    context: string;
    leftContext: string;
    rightContext: string;
    fileUri: vscode.Uri;
    fileName: string;
    cellIndex: number;
    lineNumber: number;
    startPosition: number;
    originalStartPosition?: number; // Position in original text (with HTML)
    originalText?: string; // Original text with HTML
}

export interface WordFrequency {
    word: string;
    frequency: number;
    occurrences?: WordOccurrence[];
}

// FIXME: name says it all
const METHOD_SHOULD_BE_STORED_IN_CONFIG = "whitespace_and_punctuation";
const DEFAULT_CONTEXT_SIZE = 30;

export async function initializeWordsIndex(
    initialWordIndex: any,
    targetFiles: FileData[]
): Promise<Map<string, WordOccurrence[]>> {
    // Create a new map for word occurrences
    const result = new Map<string, WordOccurrence[]>();
    let totalWords = 0;

    // Process each target file
    for (const file of targetFiles) {
        const fileName = path.basename(file.uri.fsPath);

        for (let cellIndex = 0; cellIndex < file.cells.length; cellIndex++) {
            const cell = file.cells[cellIndex];
            if (cell.metadata?.type === "text" && cell.value?.trim() !== "") {
                const originalText = cell.value;
                const lines = originalText.split("\n");

                for (let lineNumber = 0; lineNumber < lines.length; lineNumber++) {
                    const originalLine = lines[lineNumber];
                    const strippedLine = stripHtml(originalLine);
                    const positionMap = createPositionMap(originalLine);

                    const words = tokenizeText({
                        method: METHOD_SHOULD_BE_STORED_IN_CONFIG,
                        text: strippedLine,
                    });

                    words.forEach((word: string, idx: number) => {
                        const cleanedWord = cleanWord(word);
                        if (cleanedWord && cleanedWord.length > 1) {
                            // Find the position of this word in the line
                            let startPos = 0;
                            let tempWords = tokenizeText({
                                method: METHOD_SHOULD_BE_STORED_IN_CONFIG,
                                text: strippedLine.substring(0, startPos + 1),
                            });

                            while (tempWords.length <= idx) {
                                startPos = strippedLine.indexOf(word, startPos + 1);
                                if (startPos === -1) break;
                                tempWords = tokenizeText({
                                    method: METHOD_SHOULD_BE_STORED_IN_CONFIG,
                                    text: strippedLine.substring(0, startPos + 1),
                                });
                            }

                            if (startPos === -1) startPos = 0;

                            // Get the original position in the text with HTML
                            const originalStartPos =
                                startPos < positionMap.length ? positionMap[startPos] : startPos;

                            // Get context around the word
                            const leftContext = strippedLine.substring(
                                Math.max(0, startPos - DEFAULT_CONTEXT_SIZE),
                                startPos
                            );
                            const rightContext = strippedLine.substring(
                                startPos + word.length,
                                Math.min(
                                    strippedLine.length,
                                    startPos + word.length + DEFAULT_CONTEXT_SIZE
                                )
                            );

                            const occurrence: WordOccurrence = {
                                word: cleanedWord,
                                context: strippedLine,
                                leftContext,
                                rightContext,
                                fileUri: file.uri,
                                fileName,
                                cellIndex,
                                lineNumber,
                                startPosition: startPos,
                                originalStartPosition: originalStartPos,
                                originalText: originalLine,
                            };

                            if (!result.has(cleanedWord)) {
                                result.set(cleanedWord, []);
                            }
                            result.get(cleanedWord)!.push(occurrence);
                            totalWords++;
                        }
                    });
                }
            }
        }
    }

    console.log(`Total word occurrences processed: ${totalWords}`);
    console.log(`Unique words indexed: ${result.size}`);

    return result;
}

export function getWordFrequency(wordIndex: Map<string, WordOccurrence[]>, word: string): number {
    const occurrences = wordIndex.get(word);
    return occurrences ? occurrences.length : 0;
}

export async function getWordsAboveThreshold(
    wordIndex: Map<string, WordOccurrence[]>,
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
            ([word, occurrences]) =>
                occurrences.length >= threshold &&
                !dictionaryWords.includes(word?.toLowerCase() || "")
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

export function getWordFrequencies(wordIndex: Map<string, WordOccurrence[]>): WordFrequency[] {
    return Array.from(wordIndex.entries()).map(([word, occurrences]) => ({
        word,
        frequency: occurrences.length,
        occurrences,
    }));
}

export function getWordOccurrences(
    wordIndex: Map<string, WordOccurrence[]>,
    word: string
): WordOccurrence[] {
    return wordIndex.get(word) || [];
}
