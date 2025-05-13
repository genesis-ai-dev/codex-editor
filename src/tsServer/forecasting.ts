import {
    TextDocument,
    Position,
    CompletionItem,
    CompletionItemKind,
    CancellationToken,
    CompletionContext,
} from "vscode-languageserver/node";
import * asvscode.workspace.fs from "fs";
import * as path from "path";

class MarkovChain {
    private forwardChain: Map<string, Map<string, number>>;
    private backwardChain: Map<string, Map<string, number>>;

    constructor() {
        this.forwardChain = new Map();
        this.backwardChain = new Map();
    }

    addPair(word1: string, word2: string, direction: "forward" | "backward") {
        const chain = direction === "forward" ? this.forwardChain : this.backwardChain;
        if (!chain.has(word1)) {
            chain.set(word1, new Map());
        }
        const nextWords = chain.get(word1)!;
        nextWords.set(word2, (nextWords.get(word2) || 0) + 1);
    }

    getNextWords(word: string, direction: "forward" | "backward"): string[] {
        const chain = direction === "forward" ? this.forwardChain : this.backwardChain;
        const nextWords = chain.get(word);
        if (!nextWords) return [];
        return Array.from(nextWords.entries())
            .sort((a, b) => b[1] - a[1])
            .map((entry) => entry[0]);
    }

    getSimilarWords(word: string): string[] {
        const leftNeighbors = this.getNextWords(word, "backward");
        const rightNeighbors = this.getNextWords(word, "forward");

        const similarWords = new Map<string, number>();

        // Increase the number of neighbors considered
        for (const left of leftNeighbors.slice(0, 5)) {
            for (const right of rightNeighbors.slice(0, 5)) {
                const middleWords = this.getNextWords(left, "forward").filter((w) =>
                    this.getNextWords(w, "forward").includes(right)
                );
                middleWords.forEach((w) => {
                    similarWords.set(w, (similarWords.get(w) || 0) + 1);
                });
            }
        }

        // Add words with similar context
        this.getNextWords(word, "forward").forEach((w) => {
            similarWords.set(w, (similarWords.get(w) || 0) + 2);
        });
        this.getNextWords(word, "backward").forEach((w) => {
            similarWords.set(w, (similarWords.get(w) || 0) + 2);
        });

        // Sort by frequency and similarity score
        const result = Array.from(similarWords.entries())
            .sort((a, b) => b[1] - a[1])
            .map((entry) => entry[0])
            .filter((w) => w !== word);

        return result.slice(0, 10);
    }
}

export class WordSuggestionProvider {
    private markovChain: MarkovChain;

    constructor(workspaceFolder: string) {
        this.markovChain = new MarkovChain();
        this.buildMarkovChain(workspaceFolder);
    }

    private async buildMarkovChain(workspaceFolder: string) {
        const timestamp = Date.now();
        const completeDraftPath = path.join(workspaceFolder, ".project", "complete_drafts.txt");
        console.log(`Attempting to read file at: ${completeDraftPath}`);
        try {
            const stats = awaitvscode.workspace.fs.promises.stat(completeDraftPath);
            console.log(`File exists: ${stats.isFile()}, Size: ${stats.size} bytes`);

            const content = awaitvscode.workspace.fs.promises.readFile(completeDraftPath, "utf8");
            console.log(`Successfully read file. Content length: ${content.length}`);

            const words = content.split(/\s+/).filter((word: string) => word.length > 0);

            for (let i = 0; i < words.length - 1; i++) {
                const word1 = words[i].toLowerCase().replace(/[^\p{L}\s]/gu, "");
                const word2 = words[i + 1].toLowerCase().replace(/[^\p{L}\s]/gu, "");
                if (word1 && word2) {
                    this.markovChain.addPair(word1, word2, "forward");
                    this.markovChain.addPair(word2, word1, "backward");
                }
            }
            const endTime = Date.now();
            console.log(`Time taken to build Markov chain: ${endTime - timestamp} ms`);
        } catch (error) {
            console.error(`Failed to build Markov chain: ${error}`);
            console.error(`Error stack: ${(error as Error).stack}`);
        }
    }

    provideCompletionItems(
        document: TextDocument,
        position: Position,
        token: CancellationToken,
        context: CompletionContext
    ): CompletionItem[] {
        const text = document.getText(); // FIXME: is this right for notebooks?
        const offset = document.offsetAt(position);
        const linePrefix = text.substr(0, offset);
        const words = linePrefix.split(/\s+/).filter((word) => word.length > 0);
        const lastWord = words[words.length - 1].toLowerCase().replace(/[^\p{L}\s]/gu, "");

        let suggestions: string[] = [];
        if (lastWord) {
            suggestions = this.markovChain.getNextWords(lastWord, "forward");
            suggestions = [...suggestions, ...this.markovChain.getSimilarWords(lastWord)];
        }

        if (suggestions.length === 0 && words.length > 1) {
            const secondLastWord = words[words.length - 2]
                .toLowerCase()
                .replace(/[^\p{L}\s]/gu, "");
            suggestions = this.markovChain.getNextWords(secondLastWord, "forward");
            suggestions = [...suggestions, ...this.markovChain.getSimilarWords(secondLastWord)];
        }

        return suggestions.slice(0, 5).map((word) => ({
            label: word,
            kind: CompletionItemKind.Text,
            detail: "Suggested word",
        }));
    }

    getSimilarWords(word: string): string[] {
        const result = this.markovChain.getSimilarWords(
            word.toLowerCase().replace(/[^\p{L}\s]/gu, "")
        );
        return result;
    }
}
