import {
    Connection,
    RequestType,
} from "vscode-languageserver/node";
import { verseRefRegex } from "./types";
import { SpellCheckResult } from "./types";
import { URI } from "vscode-uri";
import { cleanWord } from "../utils/cleaningUtils";

let folderUri: URI | undefined;

// Define request types
interface CheckWordResponse {
    exists: boolean;
}

const DEBUG_MODE = false; // Flag for debug mode

// Custom debug function
function debugLog(...args: any[]) {
    if (DEBUG_MODE) {
        console.log(new Date().toISOString(), ...args);
    }
}
const CheckWordRequest = new RequestType<
    { word: string; caseSensitive: boolean },
    CheckWordResponse,
    never
>("custom/checkWord");
const GetSuggestionsRequest = new RequestType<string, string[], never>("custom/getSuggestions");
const AddWordsRequest = new RequestType<string[], boolean, never>("custom/addWords");

export class SpellChecker {
    private connection: Connection;
    private wordCache: Map<string, SpellCheckResult> = new Map();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    async spellCheck(word: string): Promise<SpellCheckResult> {
        if (this.wordCache.has(word)) {
            const cachedResult = this.wordCache.get(word);
            if (cachedResult) {
                return cachedResult;
            }
        }
        const originalWord = word;
        const cleanedWord = cleanWord(word);

        try {
            // Check if word exists in dictionary
            const response = await this.connection.sendRequest(CheckWordRequest, {
                word: cleanedWord,
                caseSensitive: false,
            });
            debugLog("SERVER: CheckWordRequest response:", { response });

            if (response.exists) {
                const result: SpellCheckResult = {
                    word: originalWord,
                    wordIsFoundInDictionary: true,
                    corrections: [],
                };

                this.wordCache.set(word, result);
                return result;
            }

            const suggestions = await this.getSuggestions(originalWord);
            debugLog("SERVER: getSuggestions response:", { suggestions });
            const result: SpellCheckResult = {
                word: originalWord,
                wordIsFoundInDictionary: false,
                corrections: suggestions,
            };
            this.wordCache.set(word, result);
            return result;
        } catch (error) {
            console.error("Error in spellCheck:", error);
            const result: SpellCheckResult = {
                word: originalWord,
                wordIsFoundInDictionary: false,
                corrections: [],
            };
            this.wordCache.set(word, result);
            return result;
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
            debugLog("SERVER: GetSuggestionsRequest response:", { dictWords });

            const suggestions = dictWords.map((dictWord) => ({
                word: dictWord,
                distance: this.levenshteinDistance(cleanedWord, dictWord),
            }));
            debugLog("SERVER: suggestions:", { suggestions });
            return suggestions
                .sort((a, b) => a.distance - b.distance)
                .slice(0, 5)
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
                this.wordCache.clear();
                this.connection.sendNotification("custom/dictionaryUpdated");
            }
        } catch (error) {
            console.error("Error in addWords:", error);
        }
    }

    clearCache(): void {
        this.wordCache.clear();
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